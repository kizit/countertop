"""Sports: team schedules and scores (MLS stats, ESPN)."""
import re
import threading
import time
from datetime import datetime, timedelta, timezone


# --- soccer: ESPN's public scoreboard, cached 10 minutes ---
TEAM_CACHES = {}           # "team|league" -> {at, key, data}


def _score(v):
    # the scoreboard gives "2"; the team schedule gives {"value": 2.0, "displayValue": "2", ...}
    if isinstance(v, dict):
        v = v.get("displayValue", v.get("value"))
    if v is None or v == "":
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return str(v)


# --- MLS's own stats service (what the club sites use).
# It lists matches in seven-day windows, so each window is cached on its own: windows near today
# refresh often (every minute around kickoff), far ones rarely.
MLS_BASE = "https://stats-api.mlssoccer.com"
MLS_COMPS = [("MLS-COM-000001", "MLS"), ("MLS-COM-000002", "MLS Cup Playoffs"), ("MLS-COM-000006", "Leagues Cup"),
             ("MLS-COM-00002U", "U.S. Open Cup"), ("MLS-COM-00000K", "Champions Cup"), ("MLS-COM-000007", "Campeones Cup")]
MLS_SEASONS = {}     # (comp_id, year) -> (fetched_at, season_id or None)
MLS_WINDOWS = {}     # (season_id, comp_id, start) -> (fetched_at, rows)
MLS_LOCK = threading.Lock()


def _mls_get(path, params=None):
    from urllib.error import HTTPError
    from urllib.parse import urlencode
    url = MLS_BASE + path + ("?" + urlencode(params) if params else "")
    try:
        return _get_json(url, timeout=15)
    except HTTPError as e:
        if e.code == 404:          # MLS answers 404 for "nothing in this window"
            return None
        raise


def _mls_season(comp_id, year):
    with MLS_LOCK:
        hit = MLS_SEASONS.get((comp_id, year))
    if hit and time.time() - hit[0] < 12 * 3600:
        return hit[1]
    sid = None
    data = _mls_get("/competitions/%s/seasons" % comp_id) or {}
    for item in data.get("seasons") or []:
        if item.get("season") == year:
            sid = item.get("season_id")
    with MLS_LOCK:
        MLS_SEASONS[(comp_id, year)] = (time.time(), sid)
    return sid


def _mls_window(sid, comp_id, start, ttl):
    key = (sid, comp_id, start.isoformat())
    with MLS_LOCK:
        hit = MLS_WINDOWS.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    end = start + timedelta(days=6)
    data = _mls_get("/matches/seasons/%s" % sid, {
        "match_date[gte]": start.isoformat(), "match_date[lte]": end.isoformat(),
        "competition_id": comp_id, "per_page": "100", "sort": "planned_kickoff_time:asc"})
    rows = (data or {}).get("schedule") or []
    with MLS_LOCK:
        MLS_WINDOWS[key] = (time.time(), rows)
    return rows


def _mls_is_us(m, side, want):
    name = str(m.get(side + "_team_name") or m.get(side + "_team_short_name") or "")
    reserve = re.compile(r"\s(2|ii)$", re.I)          # MLS NEXT Pro reserve sides, e.g. "... 2" or "... II"
    if reserve.search(name.strip()) and not reserve.search(want):
        return False
    n = name.lower().replace(".", "")
    if want and (want in n or n in want):
        return True
    code = str(m.get(side + "_team_three_letter_code") or "").lower()
    return bool(code) and want == code               # the team's three-letter code also works, e.g. "SEA"


def _mls_games(team):
    from concurrent.futures import ThreadPoolExecutor
    want = team.lower().replace(".", "").strip()
    today = datetime.now().date()
    first = today - timedelta(days=today.weekday() + 14)
    starts = [first + timedelta(days=7 * i) for i in range(13)]            # two weeks back to ~11 weeks out
    near_kickoff = any(abs((datetime.fromisoformat(g["date"].replace("Z", "+00:00")).timestamp() - time.time())) < 4 * 3600
                       for g in (MLS_LAST.get("games") or []) if g.get("date"))
    jobs = []
    for comp_id, comp_name in MLS_COMPS:
        for year in sorted({today.year, (today + timedelta(days=80)).year}):
            sid = _mls_season(comp_id, year)
            if not sid:
                continue
            for st in starts:
                here = st <= today <= st + timedelta(days=6)
                ttl = 60 if (here and near_kickoff) else 900 if st <= today + timedelta(days=14) else 6 * 3600
                jobs.append((sid, comp_id, comp_name, st, ttl))
    if not jobs:
        raise RuntimeError("MLS: no season IDs found")
    games, errors = {}, []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futs = [(j, pool.submit(_mls_window, j[0], j[1], j[3], j[4])) for j in jobs]
        for (sid, comp_id, comp_name, st, ttl), f in futs:
            try:
                rows = f.result()
            except Exception as e:
                errors.append("%s %s: %s" % (comp_name, st, e))
                continue
            for m in rows:
                home, away = _mls_is_us(m, "home", want), _mls_is_us(m, "away", want)
                if home == away:
                    continue
                st_raw = re.sub(r"[^a-z0-9]", "", str(m.get("match_status") or "").lower())
                done = st_raw in ("fulltime", "finished", "complete", "completed", "final", "ft", "afterpenalties", "afterextratime")
                live = st_raw in ("live", "inplay", "inprogress", "halftime", "firsthalf", "secondhalf", "extratime", "penalties")
                if st_raw in ("canceled", "cancelled", "postponed", "abandoned"):
                    continue
                hg, ag = m.get("home_team_goals"), m.get("away_team_goals")
                if (hg is None or ag is None) and re.fullmatch(r"\s*\d+\s*[:\-]\s*\d+\s*", str(m.get("result") or "")):
                    hg, ag = [int(x) for x in re.split(r"[:\-]", str(m["result"]))]
                us, them = (_score(hg), _score(ag)) if home else (_score(ag), _score(hg))
                kick = _iso_ts(m.get("planned_kickoff_time") or "")
                if not done and not live and kick and time.time() - kick > 3 * 3600 and us is not None:
                    done = True                    # MLS status words vary; a match with goals 3 h after kickoff is over
                if not done and not live:
                    us = them = None
                opp = (m.get("away_team_short_name") or m.get("away_team_name")) if home else \
                      (m.get("home_team_short_name") or m.get("home_team_name"))
                when = str(m.get("planned_kickoff_time") or "")
                if when and not re.search(r"(Z|[+-]\d\d:?\d\d)$", when):
                    when += "Z"
                minute = m.get("minute_of_play")
                note = comp_name if comp_name != "MLS" else ""
                if m.get("section_name") and comp_name != "MLS":
                    note = "%s · %s" % (comp_name, m["section_name"])
                games[m.get("match_id") or when + str(opp)] = {
                    "date": when, "home": home, "opp": opp or "?", "us": us, "them": them,
                    "done": done, "live": live, "clock": ("%s'" % minute) if (live and minute) else ("HT" if st_raw == "halftime" else ""),
                    "winner": (us > them) if (done and isinstance(us, int) and isinstance(them, int)) else None,
                    "note": note, "venue": m.get("stadium_name") or "", "status": m.get("match_status"),
                }
    out = sorted(games.values(), key=lambda g: g["date"])
    if errors and not out:
        raise RuntimeError("MLS: " + " | ".join(errors[:3]))
    MLS_LAST["games"] = out
    return out, errors


MLS_LAST = {}


def _espn_events(league, team, out):
    """ESPN rejects some scoreboard date ranges (HTTP 400), so try a few request shapes,
    from one wide range down to week-sized chunks, then the team's own schedule."""
    base = "https://site.api.espn.com/apis/site/v2/sports/soccer/%s/" % league
    now = datetime.now()
    d0, d1 = now - timedelta(days=4), now + timedelta(days=45)
    fmt = lambda d: d.strftime("%Y%m%d")
    errors = []
    for url in (base + "scoreboard?dates=%s-%s" % (fmt(d0), fmt(d1)),
                base + "scoreboard?limit=100&dates=%s-%s" % (fmt(d0), fmt(d1))):
        try:
            out["source"] = url
            return _get_json(url).get("events") or []
        except Exception as e:
            errors.append(str(e))
    try:   # week-sized chunks
        evs, d = [], d0
        while d < d1:
            e2 = min(d + timedelta(days=6), d1)
            out["source"] = base + "scoreboard?dates=%s-%s (chunks)" % (fmt(d0), fmt(d1))
            evs += _get_json(base + "scoreboard?dates=%s-%s" % (fmt(d), fmt(e2))).get("events") or []
            d = e2 + timedelta(days=1)
        return evs
    except Exception as e:
        errors.append("chunks: " + str(e))
    try:   # the team's own schedule (regular season and postseason)
        want = team.lower().replace(".", "")
        teams = _get_json(base + "teams").get("sports", [{}])[0].get("leagues", [{}])[0].get("teams", [])
        tid = next(t["team"]["id"] for t in teams if want in t["team"].get("displayName", "").lower().replace(".", ""))
        evs = []
        for st in ("", "?seasontype=3", "?fixture=true"):
            try:
                evs += _get_json(base + "teams/%s/schedule%s" % (tid, st)).get("events") or []
            except Exception as e:
                errors.append("schedule%s: %s" % (st, e))
        seen, uniq = set(), []
        for ev in evs:
            if ev.get("id") not in seen:
                seen.add(ev.get("id")); uniq.append(ev)
        out["source"] = base + "teams/%s/schedule" % tid
        if uniq:
            return uniq
    except Exception as e:
        errors.append("teams: " + str(e))
    raise RuntimeError(" | ".join(errors)[:300])


def _iso_ts(v):
    try:
        v = str(v).replace("Z", "+00:00")
        d = datetime.fromisoformat(v)
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d.timestamp()
    except Exception:
        return 0


TEAM_COLOR_CACHE = {}      # league -> (fetched_at, {team name: [main, alternate]})
_HEX6 = re.compile(r"^[0-9a-fA-F]{6}$")


def team_colors(league, team):
    """The team's own colors, [main, alternate] as "#rrggbb", from ESPN's list of the league's teams (cached a day; an hour
    after a failure). None when the league or the team isn't there: the Team tile then keeps its usual colors."""
    now = time.time()
    hit = TEAM_COLOR_CACHE.get(league)
    if not hit or now - hit[0] > (86400 if hit[1] else 3600):
        names = {}
        try:
            url = "https://site.api.espn.com/apis/site/v2/sports/soccer/%s/teams" % league
            for t in (_get_json(url).get("sports", [{}])[0].get("leagues", [{}])[0].get("teams") or []):
                t = t.get("team") or {}
                main = str(t.get("color") or "")
                if not _HEX6.match(main):
                    continue
                alt = str(t.get("alternateColor") or "")
                cols = ["#" + main.lower(), "#" + (alt if _HEX6.match(alt) else main).lower()]
                for key in (t.get("displayName"), t.get("shortDisplayName"), t.get("abbreviation")):
                    if key:
                        names[str(key).lower().replace(".", "").strip()] = cols
        except Exception:
            names = {}
        hit = TEAM_COLOR_CACHE[league] = (now, names)
    want = team.lower().replace(".", "").strip()
    if want in hit[1]:
        return hit[1][want]
    for name, cols in hit[1].items():
        if want and len(want) >= 3 and (want in name or name in want):
            return cols
    return None


def team_matches(sid=""):
    T = sources_load().get("teams") or []
    src = next((t for t in T if t.get("id") == sid), T[0] if T else None)
    if not src:
        return {"team": "", "next": None, "last": None, "error": "no team set up"}
    team, league = src.get("name") or "", src.get("league") or "usa.1"
    key = team + "|" + league
    TEAM_CACHE = TEAM_CACHES.setdefault(key, {"at": 0, "key": key, "data": None})
    d = TEAM_CACHE["data"]
    hot = bool(d and d.get("next") and (d["next"].get("live") or abs(_iso_ts(d["next"].get("date")) - time.time()) < 3 * 3600))
    if d is not None and time.time() - TEAM_CACHE["at"] < (60 if hot else 600):
        return TEAM_CACHE["data"]
    out = {"team": team, "league": league, "next": None, "last": None, "error": None}
    try:
        games = None
        if league.startswith("usa.1"):
            try:
                games, warn = _mls_games(team)
                out["source"] = "mls"
                if warn:
                    out["warnings"] = warn[:3]
                if not games:
                    games = None
            except Exception as e:
                out["mls_error"] = str(e)[:200]
        if games is None:
            j = {"events": _espn_events(league, team, out)}
            want = team.lower().replace(".", "")
            games = []
            for ev in j.get("events") or []:
                comp = (ev.get("competitions") or [{}])[0]
                sides = comp.get("competitors") or []
                mine = [c for c in sides if want in (c.get("team", {}).get("displayName", "").lower().replace(".", ""))]
                if not mine:
                    continue
                me = mine[0]
                opp = next((c for c in sides if c is not me), {})
                st = (comp.get("status") or ev.get("status") or {}).get("type", {})
                notes = " ".join(n.get("headline", "") for n in (comp.get("notes") or []))
                games.append({
                    "date": ev.get("date"), "home": me.get("homeAway") == "home",
                    "opp": opp.get("team", {}).get("shortDisplayName") or opp.get("team", {}).get("displayName", "?"),
                    "us": _score(me.get("score")), "them": _score(opp.get("score")),
                    "done": bool(st.get("completed")), "live": st.get("state") == "in",
                    "clock": st.get("shortDetail", ""), "winner": me.get("winner"),
                    "note": notes, "venue": (comp.get("venue") or {}).get("fullName", ""),
                })
        games.sort(key=lambda g: g["date"] or "")
        done = [g for g in games if g["done"]]
        upcoming = [g for g in games if not g["done"] and (g["live"] or _iso_ts(g["date"]) > time.time() - 3 * 3600)]
        out["last"] = done[-1] if done else None
        out["next"] = upcoming[0] if upcoming else None
        out["upcoming"] = upcoming[:5]
    except Exception as e:
        out["error"] = str(e)[:200]
    try:
        out["colors"] = team_colors(league, team)
    except Exception:
        out["colors"] = None
    TEAM_CACHE.update(at=time.time(), key=key, data=out)
    return out


# names used only inside functions: imported last, so these modules can use each other
from server.core import _get_json  # noqa: E402
from server.sources import sources_load  # noqa: E402
