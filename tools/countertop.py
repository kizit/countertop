#!/usr/bin/env python3
"""Countertop server: serves the kitchen dashboard and its data feeds.

Start:
    python3 tools/countertop.py --port 8090
    python3 tools/countertop.py --port 8090 --also-tls --tls-port 8443   # also HTTPS (cert in work/tls/)

On the Echo Show (Silk):    http://<server-ip>:8090/dash
Controls (any computer):    http://<server-ip>:8090/control
Grocery list (phone):       http://<server-ip>:8090/list

The dashboard posts heartbeats and page errors to /report; they are appended to work/heartbeat.log.
Controls shows the server's health from /status and offers a redacted bug-report bundle at /diagnostics.
"""
import argparse
import collections
import io
import json
import os
import platform
import sys
import zipfile
import random
import re
import socket
import ssl
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timedelta, timezone
from fractions import Fraction
from pathlib import Path
from urllib.parse import parse_qs, quote, urlencode, urlparse
from urllib.request import Request, urlopen

VERSION = "0.5.0"                 # bump with each release; CHANGELOG.md says what changed
REPO = "kizit/countertop"
HERE = Path(__file__).resolve().parent
# Everything the server saves lives here: tools/../work by default, or COUNTERTOP_DATA (the Mac app keeps it in
# ~/Library/Application Support/Countertop, since the app itself is read-only).
WORK = Path(os.environ.get("COUNTERTOP_DATA") or HERE.parent / "work").expanduser()
LOG = WORK / "heartbeat.log"
OLD_LOG = WORK / "silk_collect.log"     # name used before the rename; moved over once at startup
NOTES = WORK / "notes.json"
NOTES_LOCK = threading.Lock()

ICS_CACHE = {}           # url -> (ts, [events])
LOG_LOCK = threading.Lock()
CAL_STATUS = {}          # calendar id -> {name, at, ok, error, count}: the last time each calendar was fetched
SCREEN = {"beat": None, "at": 0, "errors": collections.deque(maxlen=200)}   # last heartbeat from a screen, recent page errors
CONSOLE = collections.deque(maxlen=800)      # recent console output (also what `docker logs` shows), for diagnostics


class _Tee:
    """Keep printing as before, and keep the last lines in memory so Controls can include them in a diagnostics file."""
    def __init__(self, real):
        self.real, self.buf = real, ""

    def write(self, s):
        try:
            self.real.write(s)
        except Exception:
            pass
        self.buf += s
        while "\n" in self.buf:
            line, self.buf = self.buf.split("\n", 1)
            CONSOLE.append(time.strftime("%Y-%m-%d %H:%M:%S ") + line)
        return len(s)

    def flush(self):
        try:
            self.real.flush()
        except Exception:
            pass

    def __getattr__(self, k):
        return getattr(self.real, k)


def lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def log_entry(e):
    """Append one report (heartbeat, page error, frame refresh...) to work/heartbeat.log as a JSON line."""
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG_LOCK, LOG.open("a") as f:
        f.write(json.dumps(e, ensure_ascii=False) + "\n")
    if e.get("task") != "beat":          # heartbeats every minute would drown the console
        print("%s %s from %s: %s" % (e.get("t"), e.get("task"), e.get("client"),
                                     str(e.get("error") or e.get("result") or "")[:300]), flush=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "Countertop/" + VERSION

    def _send(self, code, body=b"", ctype="text/plain", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if "Cache-Control" not in (extra or {}):
            self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj).encode(), "application/json")

    def _read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            return json.loads(raw.decode("utf-8", "replace"))
        except Exception:
            return {"raw": raw[:4000].decode("utf-8", "replace")}

    def do_GET(self):
        p = self.path.split("?")[0]
        if p in ("/", "/index.html"):
            self._send(302, extra={"Location": "/dash"})
        elif p == "/events":
            self._events()
        elif p == "/sample.ics":
            self._send(200, SAMPLE_ICS.encode(), "text/calendar")
        elif p == "/dash":
            # shell page: owns fullscreen + keep-alive, hosts the dashboard in an iframe
            self._send(200, (HERE / "shell.html").read_bytes(), "text/html; charset=utf-8")
        elif p in ("/dash/content", "/dashboard"):
            self._send(200, (HERE / "dash3.html").read_bytes(), "text/html; charset=utf-8")
        elif p == "/config":
            cfg = config_load()
            if self.path == "/config?starters=1":
                defaults = migrate_v3({})
                main = next(p for p in defaults["pages"]["settings"]["items"] if p["id"] == "main")
                cfg["everyday"] = {"page": main, "tiles": defaults["tiles"]["settings"]["items"]}
            cfg["schema"] = SCHEMA
            cfg["sources"] = sources_public()
            self._json(cfg)
        elif p == "/sources":
            self._json({"sources": sources_public(), "kinds": SOURCE_KINDS})
        elif p == "/control":
            self._send(200, (HERE / "control3.html").read_bytes(), "text/html; charset=utf-8")
        elif p == "/team":
            self._json(team_matches(parse_qs(urlparse(self.path).query).get("id", [""])[0]))
        elif p == "/photos":
            self._json(album_photos(parse_qs(urlparse(self.path).query).get("id", [""])[0]))
        elif p == "/tiles.js":
            # every tile type is one file in tools/tiles; adding a file adds a tile, no build step
            parts = []
            for f in sorted((HERE / "tiles").glob("*.js")):
                parts.append("/* ---- tiles/%s ---- */\n%s" % (f.name, f.read_text()))
            self._send(200, "\n".join(parts).encode(), "application/javascript")
        elif p == "/radar":
            self._json(radar_frames())
        elif p == "/space":
            self._json(space_picture())
        elif p == "/iss":
            self._json(iss_now())
        elif p == "/planes":
            self._json(planes_near(parse_qs(urlparse(self.path).query).get("r", ["15"])[0]))
        elif p == "/stocks":
            self._json(stocks(parse_qs(urlparse(self.path).query).get("s", [""])[0]))
        elif p == "/reddit":
            q = parse_qs(urlparse(self.path).query)
            self._json(reddit_pics(q.get("sub", [""])[0], q.get("t", ["day"])[0]))
        elif p == "/meals":
            q = parse_qs(urlparse(self.path).query)
            self._json(meal_ideas(q.get("meal", ["dinner"])[0], q.get("diet", ["Anything"])[0], q.get("src", [""])[0]))
        elif p == "/cams":
            ids = [x for x in parse_qs(urlparse(self.path).query).get("ids", [""])[0].split(",") if x]
            self._json(live_cams(ids))
        elif p == "/sales":
            q = parse_qs(urlparse(self.path).query)
            if q.get("q"):      # debug: the raw ad search for one word, e.g. /sales?q=ghost
                try:
                    self._json(_flipp(q["q"][0], config_load()["modules"]["deals"]["settings"].get("zip") or ""))
                except Exception as e:
                    self._json({"error": str(e)[:300]})
            elif q.get("library"):
                self._json(purchases_library())
            else:
                self._json(sales_view())
        elif p == "/version":
            # the shell polls this and reloads the iframe when the dashboard page, a tile file, the settings or Setup change
            v = 0
            for f in [HERE / "dash3.html", CONFIG_FILE, SOURCES_FILE] + sorted((HERE / "tiles").glob("*.js")):
                try:
                    v = max(v, int(f.stat().st_mtime))
                except OSError:
                    pass
            # include the server's start time, so a restart also reloads the dashboard (it reads /config at boot)
            self._json({"v": v + SERVER_START, "orientation": dashboard_orientation()})
        elif p == "/status":
            if parse_qs(urlparse(self.path).query).get("check"):
                update_check(force=True)
            self._json(status_view())
        elif p == "/diagnostics":
            name = "countertop-diagnostics-%s.zip" % time.strftime("%Y%m%d-%H%M")
            self._send(200, diagnostics_zip(), "application/zip", {"Content-Disposition": 'attachment; filename="%s"' % name})
        elif p == "/ha/states":
            q = parse_qs(urlparse(self.path).query)
            self._json(ha_view(q.get("src", [""])[0], q.get("ids", [""])[0].split(",")))
        elif p == "/ha/entities":
            self._json(ha_entities(parse_qs(urlparse(self.path).query).get("src", [""])[0]))
        elif p == "/notes":
            q = parse_qs(urlparse(self.path).query)
            lid = (q.get("list") or [""])[0].strip()
            if lid and local_list_source(lid):
                force = (q.get("daily") or [""])[0]
                self._json(local_list_view(lid, True if force in ("1", "true", "yes") else None))
            else:
                self._json(notes_view())
        elif p == "/daily":
            self._json(daily_view())
        elif p == "/list":
            self._send(200, (HERE / "list.html").read_bytes(), "text/html; charset=utf-8")
        elif re.fullmatch(r"/starters/[a-z]+\.jpg", p) and (HERE / p[1:]).is_file():
            self._send(200, (HERE / p[1:]).read_bytes(), "image/jpeg")
        elif p == "/keep.js":
            self._send(200, (HERE / "keep.js").read_bytes(), "application/javascript")
        elif p == "/media.mp3":
            self._send(200, (HERE / "media.mp3").read_bytes(), "audio/mpeg")
        elif p == "/favicon.ico":
            self._send(204)
        elif p.startswith("/fonts/") and re.fullmatch(r"/fonts/[A-Za-z0-9_-]+\.woff2", p) and (HERE / "fonts" / p[7:]).is_file():
            self._send(200, (HERE / "fonts" / p[7:]).read_bytes(), "font/woff2", {"Cache-Control": "max-age=2592000"})
        else:
            self._send(204)

    def do_POST(self):
        p = self.path.split("?")[0]
        if self.headers.get("Origin") == "null":       # a sandboxed tile frame: it may not post anything here
            return self._send(403, b"forbidden")
        body = self._read_json()
        if p == "/report":
            body["t"] = time.strftime("%H:%M:%S")
            body["client"] = self.client_address[0]
            body["kind"] = "report"
            log_entry(body)
            if body.get("task") == "beat":
                SCREEN["beat"], SCREEN["at"] = body.get("result") or {}, time.time()
            elif body.get("task") == "js-error":
                SCREEN["errors"].append({"at": time.time(), "error": str(body.get("error") or "")[:300]})
            self._send(204)
        elif p == "/config":
            try:
                self._json(config_save(body))
            except Exception as e:
                self._json({"error": str(e)}, 400)
        elif p == "/sources":
            try:
                self._json({"sources": sources_apply(body), "kinds": SOURCE_KINDS})
            except Exception as e:
                self._json({"error": str(e)}, 400)
        elif p == "/ha/call":
            code, out = ha_call(body)
            self._json(out, code)
        elif p == "/sources/test":
            self._json(recipes_test(body.get("item") or {}) if body.get("kind") == "recipes" else ha_test(body))
        elif p == "/lists/push":
            code, out = list_push(body)
            self._json(out, code)
        elif p == "/daily":
            self._json(daily_apply(body))
        elif p == "/notes":
            lid = str(body.get("list") or "").strip()
            if lid and local_list_source(lid):
                self._json(local_list_apply(lid, body, True if body.get("daily") else None))
            elif pushed_list() and body.get("op") in ("add", "toggle", "remove", "clear_done"):
                self._json(notes_view())          # the list is kept in another app: read-only here
            elif reminders_list_name() and body.get("op") in ("add", "toggle", "remove", "clear_done"):
                self._json(reminders_apply(body))
            else:
                notes_apply(body)
                self._json(notes_view())
        else:
            self._send(404)

    def _events(self):
        qs = parse_qs(urlparse(self.path).query)
        # calendars come from Setup > Sources; ?cal=id1,id2 limits to some of them (default: all)
        want = [c for c in (qs.get("cal", [""])[0] or "").split(",") if c]
        cals = [c for c in sources_load().get("calendars", []) if c.get("url") and (not want or c.get("id") in want)]
        if qs.get("url", [""])[0]:
            cals = [{"id": "test", "name": "Test", "url": qs["url"][0]}]
        for c in cals:
            u = c["url"].strip()
            c["_u"] = "https://" + u[len("webcal://"):] if u.startswith("webcal://") else u
        cals = [c for c in cals if c["_u"].startswith(("http://", "https://"))]
        urls = [c["_u"] for c in cals]
        if not urls:
            self._json({"events": [], "error": "no calendar configured"}, 200)
            return

        now = time.time()
        merged, errors = [], []
        for cal in cals:
            url = cal["_u"]
            tag = lambda evs: [dict(e, cal=cal.get("id"), color=cal.get("color") or "") for e in evs]
            cached = ICS_CACHE.get(url)
            if cached and now - cached[0] < 300:
                merged.extend(tag(cached[1]))
                continue
            try:
                req = Request(url, headers={"User-Agent": "Mozilla/5.0 Countertop/1.0"})
                raw = urlopen(req, timeout=15).read(3_000_000).decode("utf-8", "replace")
                evs = parse_ics(raw)
                ICS_CACHE[url] = (now, evs)
                try:                                     # last copy kept on this machine only, for troubleshooting
                    cf = WORK / ("calendar_cache_%s.ics" % re.sub(r"[^A-Za-z0-9_-]", "", str(cal.get("id")))[:20])
                    cf.write_text(raw)
                    cf.chmod(0o600)
                except Exception:
                    pass
                merged.extend(tag(evs))
                CAL_STATUS[cal.get("id")] = {"name": cal.get("name") or "Calendar", "at": now, "ok": True, "error": "", "count": len(evs)}
            except Exception as e:
                msg = str(e).replace(url, "(link)")[:120]           # never echo the link: it is the password
                errors.append("%s: %s" % (cal.get("name") or "Calendar", msg))
                last = CAL_STATUS.get(cal.get("id")) or {}
                CAL_STATUS[cal.get("id")] = dict(last, name=cal.get("name") or "Calendar", ok=False, error=msg, tried=now)
        merged.sort(key=lambda e: e["start"])
        seen, deduped = set(), []
        for e in merged:
            k = (e["summary"], e["start"], e.get("cal"))
            if k in seen:
                continue
            seen.add(k)
            deduped.append(e)
        if "month" not in qs:
            # default view (the classic dashboard): from an hour ago through the next 30 days
            lo = (datetime.now() - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S")
            today = datetime.now().strftime("%Y-%m-%d")
            hi = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")
            deduped = [e for e in deduped if (e["start"] >= today if e["allDay"] else e["start"] >= lo) and e["start"] <= hi][:40]
        self._json({"events": deduped, "errors": errors})

    def log_message(self, *a):
        pass


# ---------- Sources: connections set up once (Setup in Controls) and picked by tiles ----------
# work/sources.json, readable only by this user. Fields marked secret (a calendar's private link) are write-only:
# the browser never gets them back, only that one is set.
SOURCES_FILE = WORK / "sources.json"
SOURCES_LOCK = threading.Lock()
PUSHED = "Sent from another app"
FROM_URL = "A web address"
MEALDB_SRC, SPOON_SRC = "TheMealDB", "Spoonacular"
SOURCE_KINDS = {
    "calendars": {"title": "Calendars", "one": "calendar",
        "desc": "Calendars your tiles can show: Google, iCloud, Outlook or any calendar with a private iCal link.",
        "fields": {
            "name": {"label": "Name", "type": "text", "help": "Shown in tile settings, e.g. Family or Work"},
            "color": {"label": "Color", "type": "color", "help": "Events from this calendar get this color"},
            "url": {"label": "Private iCal link", "type": "text", "secret": True,
                    "help": "Starts with webcal:// or https:// and usually ends in .ics. Google: Settings, your calendar, Secret address in iCal format. iCloud: share the calendar as a Public Calendar and copy its link. It stays on the dashboard server and is never shown again."}}},
    "lists": {"title": "Lists", "one": "list",
        "desc": "Shopping or to-do lists for the List tile.",
        "fields": {
            "name": {"label": "Name", "type": "text"},
            "kind": {"label": "Kept in", "type": "choice", "choices": ["This dashboard", "Apple Reminders", PUSHED, FROM_URL],
                     "help": "This dashboard: add and tick items right in Controls → Lists, on the List tile, or from the phone page at /list. Apple Reminders: mirrors a Reminders list (only when the dashboard server runs on a Mac). " + PUSHED + ": another app sends the list here, e.g. Reminders Sync in the Countertop Mac app (updates within seconds) or an iPhone Shortcut. " + FROM_URL + ": the server reads a list that is published online (plain text, a Markdown checklist, JSON or iCal to-dos) every few minutes. See docs/list-sync.md."},
            "daily": {"label": "Clear the ticks every day at 00:00", "type": "bool", "when": {"kind": "This dashboard"},
                      "help": "A daily checklist: the ticks are cleared overnight while the items stay, so the same list is ready every morning."},
            "remName": {"label": "Reminders list name", "type": "text", "help": "Exactly as it appears in the Reminders app", "when": {"kind": "Apple Reminders"}},
            "pushKey": {"label": "Sync key", "type": "text", "when": {"kind": PUSHED},
                        "help": "Made for you when you save. Paste it into Reminders Sync in the Mac app or your Shortcut; anyone on your network with this key can replace the list."},
            "url": {"label": "Address of the list", "type": "text", "secret": True, "when": {"kind": FROM_URL},
                    "help": "A link that shows the list: plain text with one item per line, a Markdown checklist, JSON, or an iCal (.ics) file of to-dos. Checked-off items are skipped. It stays on the server and is never shown again."}}},
    "teams": {"title": "Sports teams", "one": "team",
        "desc": "Teams whose matches show on the Team, Week ahead and Month tiles. Soccer only for now.",
        "fields": {
            "name": {"label": "Team", "type": "text", "help": "The team's full name as ESPN writes it, e.g. Seattle Sounders FC"},
            "league": {"label": "League", "type": "choice", "choices": [["usa.1", "MLS"], ["usa.nwsl", "NWSL"], ["usa.usl.1", "USL Championship"], ["mex.1", "Liga MX"],
                       ["eng.1", "Premier League"], ["esp.1", "LaLiga"], ["ger.1", "Bundesliga"], ["ita.1", "Serie A"], ["fra.1", "Ligue 1"], ["uefa.champions", "Champions League"]]}}},
    "albums": {"title": "Photo albums", "one": "album",
        "desc": "Shared photo albums for the Photo frame tile and the Photos background.",
        "fields": {
            "name": {"label": "Name", "type": "text"},
            "url": {"label": "iCloud shared album link", "type": "text",
                    "help": "In Photos: open the shared album, tap the people icon, turn on Public Website and copy the link."}}},
    "homeassistant": {"title": "Home Assistant", "one": "Home Assistant",
        "desc": "Your Home Assistant, for the Home and Sensor tiles: show lights, doors and sensors, and switch lights and scenes from the screen.",
        "fields": {
            "name": {"label": "Name", "type": "text", "help": "Shown in tile settings, e.g. Home"},
            "url": {"label": "Address", "type": "text",
                    "help": "The address you open Home Assistant at, e.g. http://192.168.1.20:8123. If Countertop runs in Docker, use the IP address: names ending in .local often don't work there."},
            "token": {"label": "Access token", "type": "text", "secret": True,
                      "help": "In Home Assistant, open your profile (bottom left), then the Security tab, then Create token under Long-lived access tokens. Name it Countertop and paste it here. It stays on the dashboard server and is never shown again."}}},
    "recipes": {"title": "Recipes", "one": "recipe source",
        "desc": "Where the Meal ideas tile finds breakfast, lunch, dinner and dessert ideas. With nothing set up, it uses TheMealDB's free key.",
        "fields": {
            "name": {"label": "Name", "type": "text", "help": "Shown in tile settings, e.g. TheMealDB or Spoonacular"},
            "service": {"label": "Service", "type": "choice", "choices": [MEALDB_SRC, SPOON_SRC],
                        "help": "TheMealDB: about 800 meals with photos, free to use. Spoonacular: hundreds of thousands of recipes with cook times; needs your own free API key."},
            "key": {"label": "API key", "type": "text", "secret": True,
                    "help": "TheMealDB: leave blank to use the shared free key, or paste the key you get as a supporter on themealdb.com. Spoonacular: sign up at spoonacular.com/food-api and copy the key from your profile (the free plan has 50 points a day, enough for a tile). It stays on the dashboard server and is never shown again."}}},
    "cams": {"title": "Live cams", "one": "cam",
        "desc": "YouTube live streams (zoo, aquarium, nature cams) for the Live cam tile.",
        "fields": {
            "name": {"label": "Name", "type": "text"},
            "url": {"label": "YouTube channel or video", "type": "text", "help": "A channel like @MontereyBayAquarium, a video link, or a video ID"}}},
}


def _sid():
    return uuid.uuid4().hex[:8]


def sources_seed():
    """First run on an existing install: turn the old per-tile settings and files into sources."""
    src = {k: [] for k in SOURCE_KINDS}
    f = WORK / "calendar_url.txt"
    if f.exists():
        lines = [ln.strip() for ln in f.read_text().splitlines() if ln.strip()]
        for i, u in enumerate(lines):
            src["calendars"].append({"id": _sid(), "name": "Calendar" if len(lines) == 1 else "Calendar %d" % (i + 1), "color": "", "url": u})
    rem = REM_FILE.read_text().strip() if REM_FILE.exists() else ""
    src["lists"].append({"id": "groc", "name": rem or "Grocery", "kind": "Apple Reminders" if rem else "This dashboard", "remName": rem})
    try:
        saved = (json.loads(CONFIG_FILE.read_text()).get("modules") or {})
    except Exception:
        saved = {}
    cs = (saved.get("city") or {}).get("settings") or {}
    if cs.get("team"):
        src["teams"].append({"id": "team1", "name": cs["team"], "league": cs.get("league") or "usa.1"})
    ps = (saved.get("photos") or {}).get("settings") or {}
    if ps.get("album"):
        src["albums"].append({"id": "album1", "name": "Family", "url": ps["album"]})
    st = (saved.get("stage") or {}).get("settings") or {}
    for c in st.get("camList") or []:
        src["cams"].append({"id": _sid(), "name": c.lstrip("@"), "url": c})
    return src


def sources_load():
    with SOURCES_LOCK:
        try:
            d = json.loads(SOURCES_FILE.read_text())
            if isinstance(d, dict):
                for k in SOURCE_KINDS:
                    d.setdefault(k, [])
                return d
        except FileNotFoundError:
            pass
        except Exception:
            return {k: [] for k in SOURCE_KINDS}
    d = sources_seed()
    sources_write(d)
    return d


def sources_write(d):
    with SOURCES_LOCK:
        SOURCES_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = SOURCES_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(d, indent=1, ensure_ascii=False))
        tmp.chmod(0o600)
        tmp.replace(SOURCES_FILE)


def sources_public():
    out = {}
    for k, items in sources_load().items():
        if k not in SOURCE_KINDS:
            continue
        sec = [f for f, v in SOURCE_KINDS[k]["fields"].items() if v.get("secret")]
        out[k] = [dict({f: v for f, v in it.items() if f not in sec}, **{f + "Set": bool(it.get(f)) for f in sec}) for it in items]
    return out


def sources_apply(body):
    kind, op, item = body.get("kind"), body.get("op"), body.get("item") or {}
    if kind not in SOURCE_KINDS or op not in ("add", "update", "delete"):
        raise ValueError("expected {kind, op: add|update|delete, item}")
    fields = SOURCE_KINDS[kind]["fields"]
    clean = {}
    for f, F in fields.items():
        if f not in item or item[f] is None:
            continue
        clean[f] = bool(item[f]) if F.get("type") == "bool" else str(item[f])[:2000]
    for f, v in list(clean.items()):
        ch = fields[f].get("choices")
        if ch and v not in [c[0] if isinstance(c, list) else c for c in ch]:
            del clean[f]
    d = sources_load()
    L = d[kind]
    if op == "add":
        L.append(dict({"id": _sid()}, **clean))
    else:
        cur = next((x for x in L if x.get("id") == item.get("id")), None)
        if not cur:
            raise ValueError("no such %s" % SOURCE_KINDS[kind]["one"])
        if op == "delete":
            L.remove(cur)
        else:
            for f, v in clean.items():
                if fields[f].get("secret") and not v:
                    continue           # blank = keep the link already saved
                cur[f] = v
    if kind == "lists":
        for x in L:
            if x.get("kind") == PUSHED and not (x.get("pushKey") or "").strip():
                x["pushKey"] = uuid.uuid4().hex[:16]
    sources_write(d)
    ICS_CACHE.clear()
    URL_LISTS.clear()
    HA_CACHE.clear()
    MEAL_CACHE.clear()
    return sources_public()


# ---------- Home Assistant (Setup > Home Assistant; the Home and Sensor tiles) ----------
# The server talks to Home Assistant's REST API with the token from Setup; tiles only ever talk to this server.
# States are fetched on demand and kept for a few seconds, so several tiles share one request.
HA_CACHE = {}             # source id -> {at, states: {entity_id: compact state}, error}
HA_LOCKS = collections.defaultdict(threading.Lock)
HA_STATUS = {}            # source id -> {name, at, ok, error, count, version}
HA_TTL = 4
HA_TAPS = {"light": "toggle", "switch": "toggle", "fan": "toggle", "input_boolean": "toggle", "scene": "turn_on", "script": "turn_on"}


def ha_source(sid=""):
    L = [x for x in sources_load().get("homeassistant") or [] if x.get("url") and x.get("token")]
    return next((x for x in L if x.get("id") == sid), None) or (L[0] if L and not sid else None) or (L[0] if len(L) == 1 else None)


def _ha_url(src):
    u = (src.get("url") or "").strip().rstrip("/")
    if u and "://" not in u:
        u = "http://" + u
    return u


def _ha_error(e, src):
    """A plain-words reason, never the token (urllib errors don't carry request headers; the address is reduced to its host)."""
    host = urlparse(_ha_url(src)).hostname or "Home Assistant"
    code = getattr(e, "code", None)
    if code == 401:
        return "Home Assistant didn't accept the access token. Make a new one and paste it in Setup."
    if code == 404:
        return "%s answered, but it doesn't look like Home Assistant (check the address and port, usually 8123)." % host
    if code:
        return "Home Assistant answered with error %s." % code
    r = str(getattr(e, "reason", e))
    if isinstance(getattr(e, "reason", None), ssl.SSLError) or "CERTIFICATE" in r.upper():
        return "Couldn't check %s's certificate. Try its http:// address on your network instead." % host
    if "Name or service not known" in r or "nodename nor servname" in r or "getaddrinfo" in r or "No address associated" in r:
        return "Couldn't find %s. Use its IP address instead, e.g. http://192.168.1.20:8123%s." % (host, " (names ending in .local often don't work in Docker)" if host.endswith(".local") else "")
    if "refused" in r.lower():
        return "%s refused the connection. Is Home Assistant running, and is the port right (usually 8123)?" % host
    if "timed out" in r.lower():
        return "%s didn't answer in time." % host
    return ("Couldn't reach Home Assistant: " + r.replace(src.get("token") or "\0", "<token>"))[:200]


def ha_request(src, method, path, body=None, timeout=10):
    req = Request(_ha_url(src) + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                  headers={"Authorization": "Bearer " + (src.get("token") or "").strip(), "Content-Type": "application/json",
                           "User-Agent": "Countertop/" + VERSION})
    with urlopen(req, timeout=timeout) as r:
        raw = r.read(8_000_000)
    return json.loads(raw.decode("utf-8", "replace")) if raw else None


def _ha_compact(st):
    a = st.get("attributes") or {}
    eid = st.get("entity_id") or ""
    o = {"id": eid, "domain": eid.split(".")[0], "state": st.get("state"), "name": a.get("friendly_name") or eid,
         "unit": a.get("unit_of_measurement") or "", "dc": a.get("device_class") or "", "icon": a.get("icon") or "",
         "changed": st.get("last_changed") or ""}
    if eid.startswith("light.") and a.get("brightness") is not None:
        o["level"] = round(a["brightness"] / 255 * 100)
    if eid.startswith("fan.") and a.get("percentage") is not None:
        o["level"] = a["percentage"]
    if eid.startswith(("climate.", "water_heater.")):
        o["current"] = a.get("current_temperature")
        o["target"] = a.get("temperature")
    if eid.startswith("weather."):
        o["temp"] = a.get("temperature")
        o["unit"] = a.get("temperature_unit") or ""
    if eid.startswith("cover.") and a.get("current_position") is not None:
        o["level"] = a["current_position"]
    if eid.startswith("media_player.") and a.get("media_title"):
        o["media"] = " \u00b7 ".join(str(x) for x in (a.get("media_title"), a.get("media_artist")) if x)
    return o


def ha_states(src, force=False):
    sid = src.get("id")
    with HA_LOCKS[sid]:
        c = HA_CACHE.get(sid)
        if c and not force and time.time() - c["at"] < HA_TTL:
            return c
        try:
            L = ha_request(src, "GET", "/api/states")
            c = {"at": time.time(), "states": {st["entity_id"]: _ha_compact(st) for st in L or [] if st.get("entity_id")}, "error": ""}
            HA_STATUS[sid] = dict(HA_STATUS.get(sid) or {}, name=src.get("name") or "Home Assistant", at=c["at"], ok=True, error="", count=len(c["states"]))
        except Exception as e:
            msg = _ha_error(e, src)
            old = HA_CACHE.get(sid) or {}
            c = {"at": time.time(), "states": old.get("states") or {}, "error": msg}       # keep showing the last states we had
            HA_STATUS[sid] = dict(HA_STATUS.get(sid) or {}, name=src.get("name") or "Home Assistant", ok=False, error=msg, tried=time.time())
        HA_CACHE[sid] = c
        return c


def ha_view(sid, ids):
    src = ha_source(sid)
    if not src:
        return {"error": "Set up Home Assistant in Controls \u2192 Setup first.", "states": []}
    c = ha_states(src)
    want = [x for x in ids if x]
    S = c["states"]
    return {"error": c["error"], "at": c["at"], "src": src.get("id"),
            "states": [S.get(x) or {"id": x, "domain": x.split(".")[0], "state": "missing", "name": x} for x in want]}


def ha_entities(sid):
    src = ha_source(sid)
    if not src:
        return {"error": "Set up Home Assistant in Controls \u2192 Setup first.", "entities": []}
    c = ha_states(src)
    L = sorted(c["states"].values(), key=lambda o: (o["domain"], o["name"].lower()))
    return {"error": c["error"], "entities": [{"id": o["id"], "name": o["name"], "domain": o["domain"], "state": o["state"], "unit": o["unit"]} for o in L]}


def _ha_allowed(sid, entity):
    """Taps may only switch things a Home tile on the dashboard is set up to switch: anyone on the network can reach this server."""
    try:
        items = config_load()["modules"]["tiles"]["settings"].get("items") or []
    except Exception:
        items = []
    first = (ha_source("") or {}).get("id")
    for it in items:
        s = it.get("settings") or {}
        if it.get("type") != "ha" or s.get("taps") is False:
            continue
        if (s.get("src") or first) != sid:
            continue
        if entity in (s.get("entities") or []):
            return True
    return False


def ha_call(body):
    src = ha_source(str(body.get("src") or ""))
    entity = str(body.get("entity") or "")
    if not src:
        return 400, {"error": "Home Assistant isn't set up"}
    dom = entity.split(".")[0]
    if dom not in HA_TAPS or not re.fullmatch(r"[a-z_]+\.[a-z0-9_]+", entity):
        return 403, {"error": "That can't be switched from the screen"}
    if not _ha_allowed(src.get("id"), entity):
        return 403, {"error": "Add it to a Home tile first"}
    try:
        ha_request(src, "POST", "/api/services/%s/%s" % (dom, HA_TAPS[dom]), {"entity_id": entity})
    except Exception as e:
        return 502, {"error": _ha_error(e, src)}
    log_entry({"t": time.strftime("%H:%M:%S"), "kind": "ha", "task": "tap", "result": entity})
    c = ha_states(src, force=True)
    return 200, {"ok": True, "state": c["states"].get(entity)}


def ha_test(body):
    """Setup's Test button: the fields as typed, with the saved token when the token box was left blank."""
    item = body.get("item") or {}
    saved = next((x for x in sources_load().get("homeassistant") or [] if x.get("id") == item.get("id")), {}) if item.get("id") else {}
    src = {"url": (item.get("url") or saved.get("url") or "").strip(), "token": (item.get("token") or saved.get("token") or "").strip(), "id": "test"}
    if not src["url"]:
        return {"ok": False, "error": "Type the address first."}
    if not src["token"]:
        return {"ok": False, "error": "Paste an access token first."}
    try:
        cfg = ha_request(src, "GET", "/api/config")
        n = len(ha_request(src, "GET", "/api/states") or [])
    except Exception as e:
        return {"ok": False, "error": _ha_error(e, src)}
    return {"ok": True, "version": cfg.get("version"), "name": cfg.get("location_name"), "count": n}


# ---------- shared grocery list + note (work/notes.json) ----------
def notes_load():
    try:
        d = json.loads(NOTES.read_text())
        if isinstance(d, dict) and isinstance(d.get("items"), list):
            d.setdefault("note", "")
            return d
    except Exception:
        pass
    return {"items": [], "note": "", "updated": 0}


# ---------- optional: mirror an Apple Reminders list (work/reminders_list.txt holds its name) ----------
# The Mac's Reminders app (signed in to iCloud) is the source of truth; the server reads it with
# osascript. The first run makes macOS ask whether Terminal may control Reminders: click OK.
REM_FILE = WORK / "reminders_list.txt"
REM = {"items": [], "error": None, "at": 0, "done": {}}   # done: id -> (text, ts) for recently ticked items
REM_LOCK = threading.Lock()

# one bulk request for ids + names: asking item by item is very slow on big iCloud lists
REM_READ = """on run argv
  tell application "Reminders"
    set L to list (item 1 of argv)
    set {theIds, theNames} to {id, name} of (reminders of L whose completed is false)
  end tell
  set out to ""
  repeat with i from 1 to count of theIds
    set out to out & (item i of theIds) & tab & (item i of theNames) & linefeed
  end repeat
  return out
end run"""
REM_ADD = """on run argv
  tell application "Reminders" to make new reminder at end of list (item 1 of argv) with properties {name:(item 2 of argv)}
end run"""
REM_SET = """on run argv
  tell application "Reminders"
    set r to (first reminder of list (item 1 of argv) whose id is (item 2 of argv))
    set completed of r to ((item 3 of argv) is "true")
  end tell
end run"""
REM_DEL = """on run argv
  tell application "Reminders" to delete (first reminder of list (item 1 of argv) whose id is (item 2 of argv))
end run"""


def reminders_list_name():
    # the first list in Setup > Sources kept in Apple Reminders (older installs: work/reminders_list.txt)
    try:
        for L in sources_load().get("lists") or []:
            if L.get("kind") == "Apple Reminders" and (L.get("remName") or "").strip():
                return L["remName"].strip()
        return ""
    except Exception:
        pass
    try:
        return REM_FILE.read_text().strip().splitlines()[0].strip()
    except Exception:
        return ""


REM_READING = threading.Lock()


def _osa(script, *args, timeout=90):
    r = subprocess.run(["osascript", "-", *args], input=script, capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or "osascript failed").strip()[:200])
    return r.stdout


def reminders_refresh():
    name = reminders_list_name()
    if not name or not REM_READING.acquire(blocking=False):
        return                                   # a read is already running
    try:
        t0 = time.time()
        out = _osa(REM_READ, name)
        items = []
        for ln in out.splitlines():
            if "\t" in ln:
                rid, text = ln.split("\t", 1)
                items.append({"id": rid, "text": text.strip(), "done": False})
        with REM_LOCK:
            REM["items"], REM["error"], REM["at"] = items, None, time.time()
            REM["took"] = round(time.time() - t0, 1)
        try:
            purchases_log_list(items)
        except Exception:
            pass
    except subprocess.TimeoutExpired:
        with REM_LOCK:
            REM["error"], REM["at"] = ("Reminders didn't answer in 90 s. Is a permission prompt waiting on the Mac?"), time.time()
    except Exception as e:
        with REM_LOCK:
            REM["error"], REM["at"] = str(e), time.time()
    finally:
        REM_READING.release()


def reminders_loop():
    while True:
        try:
            reminders_refresh()
        except Exception:
            pass
        time.sleep(120)


# ---------- a list read from a web address (a published text file, a Markdown checklist, JSON, iCal to-dos) ----------
URL_LISTS = {}            # list id -> {at, items, error, host, key}
URL_LIST_LOCK = threading.Lock()
_BULLET = re.compile(r"^\s*(?:[-*+\u2022\u25e6\u25aa]|\d+[.)])?\s*(?:\[( |x|X)\]\s*)?")


def _list_from_text(raw):
    raw = raw.lstrip("\ufeff")
    t = raw.strip()
    if t[:1] in "[{":
        try:
            d = json.loads(t)
            if isinstance(d, dict):
                d = next((d[k] for k in ("items", "list", "tasks", "todos", "data") if isinstance(d.get(k), list)), [])
            out = []
            for x in d if isinstance(d, list) else []:
                if isinstance(x, dict):
                    if x.get("done") or x.get("completed") or x.get("checked") or x.get("complete"):
                        continue
                    x = x.get("text") or x.get("title") or x.get("name") or x.get("content") or x.get("summary") or ""
                out.append(str(x))
            return out
        except ValueError:
            pass
    if "BEGIN:VTODO" in raw:
        out = []
        for block in _unfold(raw).split("BEGIN:VTODO")[1:]:
            block = block.split("END:VTODO")[0]
            status = (_field(block, "STATUS") or "").upper()
            if status in ("COMPLETED", "CANCELLED") or _field(block, "COMPLETED"):
                continue
            out.append(_field(block, "SUMMARY") or "")
        return out
    out = []
    for line in raw.splitlines():
        if not line.strip() or line.lstrip().startswith(("#", "//")):
            continue
        m = _BULLET.match(line)
        if m and m.group(1) in ("x", "X"):
            continue                                   # a ticked Markdown checkbox
        out.append(line[m.end():] if m else line)
    return out


def url_list(L, max_age=300):
    """The list at a web address, read at most every five minutes."""
    url = (L.get("url") or "").strip()
    if url.startswith("webcal://"):
        url = "https://" + url[len("webcal://"):]
    host = urlparse(url).hostname or ""
    with URL_LIST_LOCK:
        c = URL_LISTS.get(L["id"])
        if c and c.get("key") == url and time.time() - c["at"] < max_age:
            return c
    try:
        if not url.startswith(("http://", "https://")):
            raise ValueError("the address should start with https://")
        req = Request(url, headers={"User-Agent": "Countertop/%s (+https://github.com/%s)" % (VERSION, REPO),
                                    "Accept": "text/plain, application/json, text/calendar, */*"})
        raw = urlopen(req, timeout=15).read(1_000_000).decode("utf-8", "replace")
        items, seen = [], set()
        for x in _list_from_text(raw)[:300]:
            t = " ".join(str(x).split())[:80]
            if t and t.lower() not in seen:
                seen.add(t.lower())
                items.append({"id": "u%d" % len(items), "text": t, "done": False})
        out = {"at": time.time(), "items": items, "error": None, "host": host, "key": url}
    except Exception as e:
        prev = URL_LISTS.get(L["id"]) or {}
        out = {"at": time.time(), "items": prev.get("items", []) if prev.get("key") == url else [], "host": host, "key": url,
               "error": "Couldn't read the list: " + str(e).replace(url, "(link)")[:140]}
    with URL_LIST_LOCK:
        URL_LISTS[L["id"]] = out
    return out


# ---------- a list another app sends here (Reminders Sync in the Mac app, an iPhone Shortcut, a script) ----------
PUSHED_FILE = WORK / "pushed_lists.json"
PUSHED_LOCK = threading.Lock()


def pushed_list():
    """The first list in Setup kept in another app (sent here, or read from a web address), if it comes before any Reminders list."""
    try:
        for L in sources_load().get("lists") or []:
            if L.get("kind") == PUSHED or (L.get("kind") == FROM_URL and (L.get("url") or "").strip()):
                return L
            if L.get("kind") == "Apple Reminders" and (L.get("remName") or "").strip():
                return None
    except Exception:
        pass
    return None


def pushed_load():
    try:
        d = json.loads(PUSHED_FILE.read_text())
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def list_push(body):
    """POST /lists/push {key, items:[text | {id,text}] or text:"one per line", via?}. Replaces the whole list."""
    key = str(body.get("key") or "").strip()
    target = None
    for L in sources_load().get("lists") or []:
        if L.get("kind") == PUSHED and key and L.get("pushKey") == key:
            target = L
    if not target:
        return 403, {"error": "unknown sync key. Copy it from Controls > Setup > Lists"}
    raw = body.get("items")
    if raw is None:
        raw = body.get("text") if body.get("text") is not None else body.get("raw", "")
    if isinstance(raw, str):
        raw = raw.splitlines()
    if not isinstance(raw, list):
        return 400, {"error": "send items as a list, or text with one item per line"}
    with PUSHED_LOCK:
        all_ = pushed_load()
        prev = {i["text"].lower(): i["id"] for i in (all_.get(target["id"]) or {}).get("items", [])}
        items, seen = [], set()
        for x in raw[:300]:
            rid = ""
            if isinstance(x, dict):
                rid, x = str(x.get("id") or "")[:120], x.get("text") or x.get("title") or ""
            t = " ".join(str(x).split())[:80]
            if not t or t.lower() in seen:
                continue
            seen.add(t.lower())
            items.append({"id": rid or prev.get(t.lower()) or uuid.uuid4().hex[:10], "text": t, "done": False})
        all_[target["id"]] = {"items": items, "at": time.time(), "via": str(body.get("via") or "")[:40]}
        PUSHED_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = PUSHED_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(all_, ensure_ascii=False, indent=1))
        tmp.chmod(0o600)
        tmp.replace(PUSHED_FILE)
    try:
        purchases_log_list(items)
    except Exception:
        pass
    return 200, {"ok": True, "list": target.get("name"), "count": len(items)}


def notes_view():
    d = notes_load()
    pl = pushed_list()
    if pl and pl.get("kind") == FROM_URL:
        got = url_list(pl)
        return dict(d, items=got.get("items", []), source="url", list=pl.get("name") or "List", via=got.get("host") or "",
                    pushedAt=got.get("at") or 0, readonly=True, error=got.get("error"))
    if pl:
        got = pushed_load().get(pl["id"]) or {}
        return dict(d, items=got.get("items", []), source="pushed", list=pl.get("name") or "List", via=got.get("via") or "",
                    pushedAt=got.get("at") or 0, readonly=True,
                    error=None if got else "Nothing sent yet. Turn on Reminders Sync in the Mac app or set up a Shortcut with this list's sync key.")
    name = reminders_list_name()
    if not name:
        # no list from another app: the phone page at /list (which sends no list id) edits the
        # first list kept on this dashboard, as it always did with the shared grocery list
        for L in sources_load().get("lists") or []:
            if (L.get("kind") or LOCAL_LIST) == LOCAL_LIST:
                return local_list_view(L["id"])
        return d
    with REM_LOCK:
        cutoff = time.time() - 3 * 3600
        REM["done"] = {k: v for k, v in REM["done"].items() if v[1] > cutoff}
        open_ids = {i["id"] for i in REM["items"]}
        done = [{"id": k, "text": v[0], "done": True} for k, v in REM["done"].items() if k not in open_ids]
        d = dict(d, items=[dict(i) for i in REM["items"]] + done, source="reminders", list=name,
                 error=REM["error"], took=REM.get("took"))
    return d


def reminders_apply(body):
    name, op, rid = reminders_list_name(), body.get("op"), str(body.get("id") or "")
    try:
        if op == "add":
            for text in [" ".join(str(body.get("text") or "").split())[:80]]:
                if text:
                    _osa(REM_ADD, name, text)
        elif op == "toggle":
            with REM_LOCK:
                was_done = rid in REM["done"]
                text = next((i["text"] for i in REM["items"] if i["id"] == rid), None)
            _osa(REM_SET, name, rid, "false" if was_done else "true")
            with REM_LOCK:
                if was_done:
                    REM["done"].pop(rid, None)
                elif text is not None:
                    REM["done"][rid] = (text, time.time())
        elif op == "remove":
            _osa(REM_DEL, name, rid)
            with REM_LOCK:
                REM["done"].pop(rid, None)
        elif op == "clear_done":
            with REM_LOCK:
                REM["done"].clear()
    except Exception as e:
        with REM_LOCK:
            REM["error"] = str(e)
    reminders_refresh()
    return notes_view()


def notes_apply(body):
    # no list id (the phone page at /list): edit the first list kept on this dashboard
    for L in sources_load().get("lists") or []:
        if (L.get("kind") or LOCAL_LIST) == LOCAL_LIST:
            return local_list_apply(L["id"], body)
    op = str(body.get("op") or "")
    with NOTES_LOCK:
        d = notes_load()
        items = d["items"]
        if op == "add":
            text = " ".join(str(body.get("text") or "").split())[:80]
            if text and len(items) < 80 and not any(
                    i["text"].lower() == text.lower() and not i.get("done") for i in items):
                items.append({"id": uuid.uuid4().hex[:8], "text": text, "done": False})
        elif op == "toggle":
            for i in items:
                if i["id"] == body.get("id"):
                    i["done"] = not i.get("done")
        elif op == "remove":
            d["items"] = [i for i in items if i["id"] != body.get("id")]
        elif op == "clear_done":
            d["items"] = [i for i in items if not i.get("done")]
        elif op == "note":
            d["note"] = str(body.get("text") or "").strip()[:240]
        else:
            return d
        d["updated"] = int(time.time())
        NOTES.parent.mkdir(parents=True, exist_ok=True)
        tmp = NOTES.with_suffix(".tmp")
        tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1))
        tmp.replace(NOTES)
        return d


# ---------- daily to-do list (work/daily.json): kept on this dashboard itself, ticks cleared at midnight ----------
DAILY = WORK / "daily.json"
DAILY_LOCK = threading.Lock()


def _today():
    return datetime.now().strftime("%Y-%m-%d")


def _daily_save(d):
    DAILY.parent.mkdir(parents=True, exist_ok=True)
    tmp = DAILY.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1))
    tmp.replace(DAILY)


def daily_load():
    """Reads the daily list; when the calendar day has changed since the last save, the ticks are cleared
    (the items themselves stay) — that's the 00:00 reset."""
    try:
        d = json.loads(DAILY.read_text())
        if not isinstance(d, dict) or not isinstance(d.get("items"), list):
            d = {"items": []}
    except Exception:
        d = {"items": []}
    d.setdefault("items", [])
    if d.get("date") != _today():
        d = {"date": _today(), "updated": int(time.time()),
             "items": [{"id": i.get("id") or uuid.uuid4().hex[:8], "text": str(i.get("text") or ""), "done": False}
                       for i in d["items"] if str(i.get("text") or "").strip()]}
        try:
            _daily_save(d)
        except Exception:
            pass
    return d


def daily_view():
    with DAILY_LOCK:
        d = daily_load()
    return {"date": d.get("date"), "items": d["items"], "updated": d.get("updated", 0)}


def daily_apply(body):
    op = str(body.get("op") or "")
    with DAILY_LOCK:
        d = daily_load()
        items = d["items"]
        if op == "add":
            text = " ".join(str(body.get("text") or "").split())[:80]
            if text and len(items) < 80 and not any(i["text"].lower() == text.lower() and not i.get("done") for i in items):
                items.append({"id": uuid.uuid4().hex[:8], "text": text, "done": False})
        elif op == "toggle":
            for i in items:
                if i["id"] == body.get("id"):
                    i["done"] = not i.get("done")
        elif op == "remove":
            d["items"] = [i for i in items if i["id"] != body.get("id")]
        elif op == "reset":                     # clear every tick right now (same as the midnight reset)
            for i in items:
                i["done"] = False
        elif op == "clear":                     # empty the whole list
            d["items"] = []
        else:
            return daily_view()
        d["updated"] = int(time.time())
        try:
            _daily_save(d)
        except Exception:
            pass
        return {"date": d.get("date"), "items": d["items"], "updated": d["updated"]}


# ---------- lists kept on this dashboard, one entry per list (work/lists.json) ----------
# A list set up in Sources as "This dashboard" is edited right on the List tile. Its ticks can be
# cleared automatically when the day changes (the items stay), so it works as a daily checklist.
LISTS_FILE = WORK / "lists.json"
LISTS_LOCK = threading.Lock()
LOCAL_LIST = "This dashboard"


def _lists_load():
    try:
        d = json.loads(LISTS_FILE.read_text())
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _lists_save(d):
    LISTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = LISTS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1))
    tmp.chmod(0o600)
    tmp.replace(LISTS_FILE)


def local_list_source(list_id):
    """The list set up in Sources as kept on this dashboard, if list_id names one."""
    for L in sources_load().get("lists") or []:
        if L.get("id") == list_id and (L.get("kind") or LOCAL_LIST) == LOCAL_LIST:
            return L
    return None


def _local_list(rec, daily):
    """The 00:00 reset: on a new calendar day the ticks are cleared, the items stay."""
    today = _today()
    rec.setdefault("items", [])
    rec.setdefault("date", today)
    if daily and rec.get("date") != today:
        for i in rec["items"]:
            i["done"] = False
        rec["date"] = today
    return rec


def _local_daily(L, daily):
    """A list can clear its own ticks overnight (Sources: "Clear the ticks every day at 00:00").
    An explicit True/False from the caller (the daily tile API) overrides that."""
    return bool(L.get("daily")) if daily is None else bool(daily)


def _local_view(L, rec):
    return {"list": L.get("name") or "List", "source": "local", "date": rec.get("date"),
            "items": rec["items"], "updated": rec.get("updated", 0), "note": rec.get("note", ""),
            "daily": bool(L.get("daily")), "readonly": False}


def local_list_view(list_id, daily=None):
    L = local_list_source(list_id) or {"id": list_id, "name": "List"}
    with LISTS_LOCK:
        all_ = _lists_load()
        rec = all_.get(list_id)
        was = rec.get("date") if isinstance(rec, dict) else None
        rec = _local_list(rec or {"items": []}, _local_daily(L, daily))
        if list_id not in all_ or was != rec.get("date"):
            all_[list_id] = rec
            _lists_save(all_)
    return _local_view(L, rec)


def local_list_apply(list_id, body, daily=None):
    op = str(body.get("op") or "")
    L = local_list_source(list_id) or {"id": list_id, "name": "List"}
    with LISTS_LOCK:
        all_ = _lists_load()
        rec = _local_list(all_.get(list_id) or {"items": []}, _local_daily(L, daily))
        items = rec["items"]
        if op == "add":
            text = " ".join(str(body.get("text") or "").split())[:80]
            if text and len(items) < 80 and not any(i["text"].lower() == text.lower() and not i.get("done") for i in items):
                items.append({"id": uuid.uuid4().hex[:8], "text": text, "done": False})
        elif op == "toggle":
            for i in items:
                if i["id"] == body.get("id"):
                    i["done"] = not i.get("done")
        elif op == "remove":
            rec["items"] = [i for i in items if i["id"] != body.get("id")]
        elif op == "reset":                     # clear every tick now (same as the midnight reset)
            for i in items:
                i["done"] = False
        elif op == "clear_done":
            rec["items"] = [i for i in items if not i.get("done")]
        elif op == "clear":                     # empty the whole list
            rec["items"] = []
        elif op == "note":
            rec["note"] = str(body.get("text") or "").strip()[:240]
        rec["updated"] = int(time.time())
        all_[list_id] = rec
        _lists_save(all_)
    return _local_view(L, rec)


# ---------- module platform: config schema, stored settings, team schedule, shared photo album ----------
CONFIG_FILE = WORK / "dashboard.json"
SERVER_START = int(time.time())
CONFIG_LOCK = threading.Lock()
ZONES = ["header-left", "header-right", "strip", "main", "side"]

# Describes every module and its settings. The control page builds its form from this,
# and the dashboard reads the merged values from GET /config.
SCHEMA = {
    "general": {"title": "Location & units", "desc": "Where you are (for weather, radar, sunrise and things overhead), units, and how dates and times are written.", "global": True, "settings": {
        "place": {"type": "text", "label": "Place name", "default": ""},
        "lat": {"type": "number", "label": "Latitude", "default": 0},
        "lon": {"type": "number", "label": "Longitude", "default": 0},
        "units": {"type": "choice", "label": "Temperature", "choices": ["F", "C"], "default": "F"},
        "h24": {"type": "bool", "label": "24-hour time", "default": False},
        "dateFmt": {"type": "choice", "label": "Date format", "choices": ["Wednesday, November 18", "Wed, Nov 18", "18 November", "11/18"], "default": "Wednesday, November 18"},
        "weekStart": {"type": "choice", "label": "Weeks start on", "choices": ["Sunday", "Monday"], "default": "Sunday"},
        "emoji": {"type": "choice", "label": "Icons", "choices": ["Emoji", "Simple symbols", "No emoji"], "default": "Emoji"},
        "swap": {"type": "list", "label": "Swap emoji, one per line as old = new (leave new empty to remove it), e.g. ⚽ = 🥅", "default": []},
        "gear": {"type": "bool", "label": "Show a ⚙ settings button on the screen", "default": True},
        "updates": {"type": "bool", "label": "Check GitHub for new versions", "default": True},
        "setupDone": {"type": "bool", "label": "First-run setup finished", "default": False},
    }},
    "effects": {"title": "Effects", "global": True, "desc": "Little animations on the screen: weather, the seasons and short shows. Turn on the ones you like and choose when they play.", "settings": {
        "front": {"type": "bool", "label": "Rain, snow and falling things in front of the tiles", "default": True},
        "items": {"type": "effects", "label": "Effects", "default": []},
    }},
    "look": {"title": "Looks", "global": True, "theme": True,
             "desc": "How the dashboard looks. Your everyday look, plus other looks the schedule can switch to.", "settings": {
        "mode": {"type": "choice", "label": "Light or dark", "choices": ["Dark", "Light"], "default": "Dark"},
        "accent": {"type": "color", "label": "Accent color", "default": "#7cb7ff"},
        "holiday": {"type": "bool", "label": "Holiday colors", "default": False},
        "tiles": {"type": "choice", "label": "Tiles", "choices": ["Solid", "See-through", "Clear"], "default": "Solid"},
        "opacity": {"type": "int", "label": "See-through tiles: how solid (%)", "default": 60, "min": 10, "max": 100},
        "textScale": {"type": "int", "label": "Text size (%)", "default": 100, "min": 80, "max": 140},
        "titles": {"type": "bool", "label": "Tile titles", "default": True},
        "bg": {"type": "choice", "label": "Background", "choices": ["Sky", "Color", "Photos"], "default": "Sky"},
        "bgColor": {"type": "color", "label": "Background color", "default": "#0a0c0f"},
        "dim": {"type": "int", "label": "Dim the screen (%)", "default": 0, "min": 0, "max": 80},
        "fx": {"type": "choice", "label": "Effects", "choices": ["On", "Off"], "default": "On"},
        "items": {"type": "looks", "label": "Other looks", "default": []},
        "rules": {"type": "rules", "label": "Schedule", "default": []},
    }},
    "night": {"title": "Night page", "global": True, "desc": "A page of its own that takes over the screen at night, dimmed. Touch the screen to see the main page for a minute.", "settings": {
        "start": {"type": "int", "label": "Starts at (hour, 0-23)", "default": 22, "min": 0, "max": 23},
        "end": {"type": "int", "label": "Ends at (hour, 0-23)", "default": 7, "min": 0, "max": 23},
        "dim": {"type": "int", "label": "How dark (%)", "default": 45, "min": 0, "max": 85},
        "drift": {"type": "bool", "label": "Move slightly every minute", "default": True},
    }},
    "deals": {"title": "Store deals", "global": True, "setup": True,
              "desc": "Finds things you usually buy in this week's store ads. Needs your ZIP code and your stores; purchase history makes it smarter.", "settings": {
        "zip": {"type": "text", "label": "ZIP code for the weekly ads", "default": ""},
        "stores": {"type": "list", "label": "Stores to check (as the ads name them)", "default": []},
        "watch": {"type": "int", "label": "How many of your usual items to watch", "default": 40, "min": 5, "max": 120},
        "recentDays": {"type": "int", "label": "Count an item as usual if bought in the last (days)", "default": 180, "min": 30, "max": 730},
        "always": {"type": "list", "label": "Always watch these (e.g. coffee)", "default": []},
    }},
    "pages": {"title": "Custom pages", "global": True, "hidden": True, "settings": {
        "items": {"type": "pages", "label": "Custom pages", "default": []},
    }},
    "tiles": {"title": "Tiles", "global": True, "hidden": True, "settings": {
        "items": {"type": "tiles", "label": "Tiles", "default": []},
        "designs": {"type": "designs", "label": "Saved tile designs", "default": {}},
    }},
}


def config_defaults():
    out = {}
    for mid, m in SCHEMA.items():
        out[mid] = {"on": m.get("on", True), "settings": {k: v["default"] for k, v in m["settings"].items()}}
    return out


# ---------- v3: every tile is an instance of a tile type (tools/tiles/*.js) placed in a grid box ----------
# Older settings files had one fixed module per tile, a classic column layout and bundle tiles (big tile,
# little thing). They are converted once, on load; the old file is kept as work/dashboard.pre-v3.json.
MAIN_CLASSIC = {"clock": [0, 0, 14, 8], "weather": [37, 0, 11, 8], "week": [0, 8, 48, 5], "stage": [0, 13, 27, 19],
                "grocery": [27, 13, 11, 12], "dinner": [38, 13, 10, 12], "city": [27, 25, 11, 7], "fun": [38, 25, 10, 7]}
OLD_ON = {"photos": False, "today": False, "sales": False, "hourly": False}


def migrate_v3(old):
    if "tiles" in old:
        return old
    fresh = not old
    st = lambda k: (old.get(k) or {}).get("settings") or {}
    on = lambda k: (old.get(k) or {}).get("on", OLD_ON.get(k, True))
    pick = lambda d, keys: {k: d[k] for k in keys if k in d}
    tiles, expand, every = [], {}, {}

    def add(iid, typ, settings=None, name=None):
        t = {"id": iid, "type": typ, "settings": settings or {}}
        if name:
            t["name"] = name
        tiles.append(t)
        return iid
    src = sources_load()
    first = lambda kind: ((src.get(kind) or [{}])[0] or {}).get("id", "")
    if on("clock"):
        expand["clock"] = [add("clock", "clock", pick(st("clock"), ["style", "font", "size", "align", "color", "ampm", "date", "seconds", "greeting", "countdowns", "extra"]))]
    if on("weather"):
        expand["weather"] = [add("weather", "weather", pick(st("weather"), ["style", "font", "size", "align", "icon", "cond", "hilo", "air", "sun", "rain"]))]
    if on("week"):
        expand["week"] = [add("week", "week", pick(st("week"), ["days", "perDay"]))]
    if on("hourly"):
        expand["hourly"] = [add("hourly", "hourly", pick(st("hourly"), ["hours"]))]
    if on("photos"):
        expand["photos"] = [add("photos", "photos", dict(pick(st("photos"), ["every", "shuffle", "captions"]), album=first("albums")))]
    if on("today"):
        expand["today"] = [add("today", "agenda", pick(st("today"), ["count"]))]
    if on("city") and not fresh and src.get("teams"):
        s = st("city")
        expand["city"] = [add("city", "team", dict(pick(s, ["count", "within", "always"]), team=first("teams")))]
    if on("grocery"):
        s = st("grocery")
        expand["grocery"] = [add("grocery", "list", {"list": first("lists"), "max": s.get("max", 20), "saleTag": s.get("saleTag", True),
                                                     "deals": s.get("sales", True) and not fresh})]
    if on("sales"):
        expand["sales"] = [add("sales", "sales", pick(st("sales"), ["count"]))]
    if on("dinner"):
        s = st("dinner")
        expand["dinner"] = [add("dinner", "dinner", pick(s, ["every", "season"]))]
        if s.get("sales", True) and not fresh:
            expand["dinner"].append(add("dsales", "sales", {"count": 5, "skipListed": True}, "More on sale"))
            every["dinner"] = s.get("saleEvery", 45)
    if on("stage"):
        s, L = st("stage"), []
        radar = s.get("radar", "when rain is near")
        if radar != "off":
            L.append(add("radar", "radar", {"zoom": s.get("radarZoom", "region"), "hours": s.get("radarHours", 2), "chance": s.get("radarChance", 40),
                                            "onlyRain": radar == "when rain is near", "takeover": radar == "when rain is near"}))
        if s.get("glance", True):
            L.append(add("hours", "nexthours", {"hours": s.get("glanceHours", 18)}))
        for k, typ in (("space", "space"), ("iss", "iss")):     # the old window scene tile is retired
            if s.get(k):
                L.append(add(k, typ))
        if s.get("cams", True) and not fresh:
            L.append(add("cams", "cam", {}))
        expand["stage"] = L or [add("hours", "nexthours")]
        every["stage"] = s.get("every", 75)
    if on("fun"):
        s, L = st("fun"), []
        for k, typ in (("onthisday", "onthisday"), ("jokes", "joke"), ("facts", "tip")):
            if s.get(k, True):
                L.append(add(typ, typ))
        expand["fun"] = L or [add("onthisday", "onthisday")]
        every["fun"] = s.get("every", 90)
    if fresh and on("city"):
        expand["city"] = [add("today", "agenda", {"count": 4})]
    for it in st("mytiles").get("items") or []:
        iid = "u_" + str(it.get("id"))
        add(iid, "custom", pick(it, ["html", "every", "taps", "card", "title"]), it.get("name") or "My tile")
        if it.get("on"):
            expand[iid] = [iid]

    def box(sl):
        mods = []
        for m in [sl.get("mod")] + list(sl.get("more") or []):
            mods += expand.get(m, [m] if any(t["id"] == m for t in tiles) else [])
        out = {k: v for k, v in sl.items() if k not in ("mod", "more", "mode")}
        out["mod"] = mods[0] if mods else None
        if len(mods) > 1:
            out["more"] = mods[1:]
            src_mod = next((m for m in [sl.get("mod")] + list(sl.get("more") or []) if m in every), None)
            if src_mod and not out.get("every"):
                out["every"] = every[src_mod]
        return out
    pages = [dict(p, slots=[box(x) for x in p.get("slots") or []]) for p in (st("pages").get("items") or [])]
    if not any(p.get("id") == "main" for p in pages):
        slots = []
        for m, r in MAIN_CLASSIC.items():
            if m in expand:
                slots.append(box({"id": "m_" + m, "x": r[0], "y": r[1], "w": r[2], "h": r[3], "mod": m}))
        extra = [m for m in ("photos", "today", "sales", "hourly") if m in expand and m not in MAIN_CLASSIC]
        pages.insert(0, {"id": "main", "name": "Main", "on": True, "cols": 48, "slots": slots})
        if extra:
            pages.append({"id": "more", "name": "More", "on": True, "back": 0, "cols": 48,
                          "slots": [box({"id": "x_" + m, "x": (i % 3) * 16, "y": (i // 3) * 16, "w": 16, "h": 16, "mod": m}) for i, m in enumerate(extra[:6])]})
    if (old.get("month") or {}).get("on", True) and not fresh:      # new installs add a Month page from Add page → Full-screen
        add("month", "month")
        pages.append({"id": "month", "name": "Month", "on": True, "back": st("month").get("back", 60), "cols": 48,
                      "slots": [{"id": "mo1", "x": 0, "y": 0, "w": 48, "h": 32, "mod": "month"}]})
    if (old.get("salepage") or {}).get("on", True) and not fresh:
        add("dealcards", "sales", {"layout": "Cards", "count": 12}, "On sale this week")
        pages.append({"id": "deals", "name": "Deals", "on": True, "back": st("salepage").get("back", 90), "cols": 48,
                      "slots": [{"id": "dc1", "x": 0, "y": 0, "w": 48, "h": 32, "mod": "dealcards"}]})
    used = {m for p in pages for sl in p["slots"] for m in [sl.get("mod")] + list(sl.get("more") or [])}
    tiles = [t for t in tiles if t["id"] in used]
    new = {k: old[k] for k in ("general", "effects", "look", "night") if k in old}
    if "sales" in old:
        new["deals"] = {"on": True, "settings": pick(st("sales"), ["zip", "stores", "watch", "recentDays", "always"])}
    new["pages"] = {"on": True, "settings": {"items": pages}}
    new["tiles"] = {"on": True, "settings": {"items": tiles}}
    return new


# Looks rebuild (2026-11-19): themes became looks plus schedule rules, date and emoji preferences moved to
# Location & units, effects became a list of separate effects, and the night clock became a page you can edit.
FX_GROUPS = {"weather": ["rain", "snow", "fog", "clouds", "sun", "stars"],
             "seasonal": ["leaves", "halloween", "thanks", "xmas", "winter", "newyear", "valentine", "spring", "july4", "summer"],
             "shows": ["gust", "bats", "turkey", "santa", "flurry", "fireworks", "heartburst", "butterflies"]}
PREF_KEYS = ["dateFmt", "weekStart", "h24", "emoji", "swap"]


def migrate_looks(m):
    changed = False
    look = (m.get("look") or {}).get("settings")
    if isinstance(look, dict):
        g = m.setdefault("general", {"on": True, "settings": {}}).setdefault("settings", {})
        for k in PREF_KEYS:
            if k in look:
                g.setdefault(k, look.pop(k))
                changed = True
        items = look.get("items") or []
        if "rules" not in look:
            rules = []
            for t in items:
                if not isinstance(t, dict):
                    continue
                if "when" in t:
                    rules.append({"id": "r" + str(t.get("id", "")), "on": t.get("on", True) is not False, "look": t.get("id"), "when": t.get("when") or {}})
                for k in PREF_KEYS:
                    (t.get("values") or {}).pop(k, None)
                for k in ("when", "on"):
                    t.pop(k, None)
            look["rules"] = rules
            changed = True
    fx = (m.get("effects") or {}).get("settings")
    if isinstance(fx, dict) and "items" not in fx and any(k in fx for k in ("weather", "seasonal", "shows", "density", "sky")):
        dens = fx.get("density", 100)
        amount = "Few" if dens < 70 else "Lots" if dens > 140 else "Some"
        out = []
        for grp, ids in FX_GROUPS.items():
            for i in ids:
                e = {"id": i}
                if fx.get(grp) is False:
                    e["on"] = False
                if amount != "Some" and grp != "shows":
                    e["amount"] = amount
                if grp == "shows" and fx.get("showEvery") not in (None, 8):
                    e["every"] = max(5, int(fx.get("showEvery") or 15))
                if len(e) > 1:
                    out.append(e)
        if fx.get("sky") is False and isinstance(look, dict) and look.get("bg", "Sky") == "Sky":
            look["bg"] = "Color"
        m["effects"]["settings"] = {"front": True, "items": out}
        changed = True
    night = m.get("night")
    if isinstance(night, dict) and isinstance(night.get("settings"), dict) and "dim" not in night["settings"]:
        if night.get("on") is False:          # it was off: start from sensible hours if it's ever turned on
            night["settings"].update({"start": 22, "end": 7})
        night["settings"]["dim"] = 45
        changed = True
    pages = ((m.get("pages") or {}).get("settings") or {}).get("items")
    if isinstance(pages, list) and pages and not any(isinstance(p, dict) and p.get("id") == "night" for p in pages):
        pages.append({"id": "night", "name": "Night", "on": True, "cols": 48, "slots": [{"id": "n1", "x": 0, "y": 0, "w": 48, "h": 32, "mod": "nightclock"}]})
        tl = m.setdefault("tiles", {"on": True, "settings": {"items": []}}).setdefault("settings", {}).setdefault("items", [])
        if not any(isinstance(t, dict) and t.get("id") == "nightclock" for t in tl):
            tl.append({"id": "nightclock", "type": "nightclock", "settings": {}})
        changed = True
    return changed


ORIENTATIONS = ("auto", "left", "right")


def dashboard_orientation(saved=None):
    if saved is None:
        try:
            saved = json.loads(CONFIG_FILE.read_text())
        except (OSError, ValueError):
            return "auto"
    mode = saved.get("orientation")
    return mode if mode in ORIENTATIONS else "auto"


def config_load():
    merged = config_defaults()
    try:
        saved = json.loads(CONFIG_FILE.read_text())
    except Exception:
        saved = {}
    smods = saved.get("modules") or {}
    if "tiles" not in smods:
        with CONFIG_LOCK:
            try:
                bak = CONFIG_FILE.with_name("dashboard.pre-v3.json")
                if CONFIG_FILE.exists() and not bak.exists():
                    bak.write_text(CONFIG_FILE.read_text())
            except Exception:
                pass
        smods = migrate_v3(smods)
        try:
            config_save({"modules": smods}, quiet=True)
        except Exception:
            pass
    if migrate_looks(smods):
        try:
            bak = CONFIG_FILE.with_name("dashboard.before-looks.json")
            if CONFIG_FILE.exists() and not bak.exists():
                bak.write_text(CONFIG_FILE.read_text())
            config_save({"modules": smods}, quiet=True)
        except Exception:
            pass
    for mid, c in smods.items():
        if mid not in merged or not isinstance(c, dict):
            continue
        m = merged[mid]
        if isinstance(c.get("on"), bool):
            m["on"] = c["on"]
        for k, v in (c.get("settings") or {}).items():
            if k in m["settings"]:
                m["settings"][k] = v
    return {"modules": merged, "orientation": dashboard_orientation(saved)}


def config_save(body, quiet=False):
    mods = body.get("modules") if isinstance(body, dict) else None
    orientation_edit = isinstance(body, dict) and "orientation" in body
    if orientation_edit and body["orientation"] not in ORIENTATIONS:
        raise ValueError("unknown screen orientation")
    if not isinstance(mods, dict) and not (orientation_edit and "modules" not in body):
        raise ValueError("expected modules or screen orientation")
    with CONFIG_LOCK:
        CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(mods, dict):
            # Layout editors send a snapshot of the modules. Preserve the current mount.
            saved = {"modules": mods, "orientation": dashboard_orientation()}
        else:
            try:
                saved = json.loads(CONFIG_FILE.read_text())
            except FileNotFoundError:
                saved = {}
        if orientation_edit:
            saved["orientation"] = body["orientation"]
        saved["saved"] = int(time.time())
        tmp = CONFIG_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(saved, indent=1, ensure_ascii=False))
        tmp.replace(CONFIG_FILE)
    return None if quiet else config_load()


def setting(mid, key):
    return config_load()["modules"][mid]["settings"][key]


def _get_json(url, data=None, timeout=15):
    hdr = {"User-Agent": "Mozilla/5.0 kitchen-dashboard", "Accept": "application/json"}
    if data is not None:
        hdr["Content-Type"] = "text/plain"
    req = Request(url, data=json.dumps(data).encode() if data is not None else None, headers=hdr)
    with urlopen(req, timeout=timeout) as r:
        return json.loads(r.read(4_000_000).decode("utf-8", "replace"))


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
    out = {"team": team, "next": None, "last": None, "error": None}
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
    TEAM_CACHE.update(at=time.time(), key=key, data=out)
    return out


# --- big tile data: rain radar frames, NASA picture of the day, space station position ---
RADAR_CACHE = {"at": 0, "data": None}


def radar_frames():
    if RADAR_CACHE["data"] and time.time() - RADAR_CACHE["at"] < 300:
        return RADAR_CACHE["data"]
    try:
        j = _get_json("https://api.rainviewer.com/public/weather-maps.json")
        rad = j.get("radar") or {}
        out = {"host": j.get("host") or "https://tilecache.rainviewer.com",
               "past": rad.get("past") or [], "nowcast": rad.get("nowcast") or [], "error": None}
        RADAR_CACHE.update(at=time.time(), data=out)
        return out
    except Exception as e:
        return dict(RADAR_CACHE["data"] or {"host": "", "past": [], "nowcast": []}, error=str(e)[:200])


SPACE_CACHE = {"day": "", "at": 0, "data": None}


def space_picture():
    day = datetime.now().strftime("%Y-%m-%d")
    if SPACE_CACHE["data"] and (SPACE_CACHE["day"] == day or time.time() - SPACE_CACHE["at"] < 1800):
        return SPACE_CACHE["data"]
    try:
        j = _get_json("https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY&thumbs=true")
        out = {k: j.get(k) for k in ("title", "date", "url", "media_type", "thumbnail_url", "explanation", "copyright")}
        out["error"] = None
        SPACE_CACHE.update(day=j.get("date") or day, at=time.time(), data=out)
        return out
    except Exception as e:
        SPACE_CACHE["at"] = time.time()
        return dict(SPACE_CACHE["data"] or {}, error=str(e)[:200])


# ---------- planes overhead: adsb.lol (free, no key; community ADS-B receivers), cached 15 s ----------
PLANE_CACHE = {}


def planes_near(radius_mi=15):
    g = config_load()["modules"]["general"]["settings"]
    lat, lon = g.get("lat"), g.get("lon")
    if lat in (None, "") or lon in (None, ""):
        return {"planes": [], "error": "no location set"}
    r_nm = max(2, min(50, round(float(radius_mi) / 1.15078)))
    key = "%s,%s,%s" % (lat, lon, r_nm)
    c = PLANE_CACHE.get(key)
    if c and time.time() - c["at"] < 15:
        return c["data"]
    out = {"planes": [], "error": None, "lat": lat, "lon": lon, "radius": radius_mi}
    try:
        j = None
        for url in ("https://api.adsb.lol/v2/point/%s/%s/%s" % (lat, lon, r_nm),
                    "https://api.airplanes.live/v2/point/%s/%s/%s" % (lat, lon, r_nm)):
            try:
                j = _get_json(url, timeout=8)
                break
            except Exception as e:
                out["error"] = str(e)[:160]
        if j is not None:
            out["error"] = None
            for a in (j.get("ac") or j.get("aircraft") or [])[:200]:
                if a.get("lat") is None or a.get("lon") is None:
                    continue
                alt = a.get("alt_baro")
                out["planes"].append({
                    "flight": (a.get("flight") or "").strip(), "reg": a.get("r") or "", "type": a.get("t") or "",
                    "desc": a.get("desc") or "", "lat": a.get("lat"), "lon": a.get("lon"),
                    "alt": None if alt in (None, "ground") else alt, "ground": alt == "ground",
                    "speed": a.get("gs"), "track": a.get("track"), "from": a.get("orig") or "", "to": a.get("dest") or ""})
        PLANE_CACHE.clear()
        PLANE_CACHE[key] = {"at": time.time(), "data": out}
    except Exception as e:
        out["error"] = str(e)[:200]
    return out


# ---------- stocks: Yahoo's chart API (no key), Stooq as a fallback; cached 5 minutes ----------
STOCK_CACHE = {}


def _stock_one(sym):
    sym = re.sub(r"[^A-Za-z0-9.^=\-]", "", sym)[:15].upper()
    if not sym:
        return None
    c = STOCK_CACHE.get(sym)
    if c and time.time() - c["at"] < 300:
        return c["data"]
    d = {"sym": sym, "error": None}
    try:
        req = Request("https://query1.finance.yahoo.com/v8/finance/chart/%s?range=1d&interval=5m" % quote(sym),
                      headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", "Accept": "application/json"})
        with urlopen(req, timeout=10) as r:
            j = json.loads(r.read(2_000_000).decode("utf-8", "replace"))
        res = j["chart"]["result"][0]
        m = res["meta"]
        closes = [x for x in ((res.get("indicators") or {}).get("quote") or [{}])[0].get("close") or [] if x is not None]
        d.update(name=m.get("shortName") or m.get("longName") or sym, price=m.get("regularMarketPrice"),
                 prev=m.get("chartPreviousClose") or m.get("previousClose"), cur=m.get("currency") or "USD",
                 spark=[round(x, 4) for x in closes[::max(1, len(closes) // 60)]], at=m.get("regularMarketTime"))
    except Exception as e:
        d["error"] = "yahoo: " + str(e)[:120]
        try:
            q = sym.lower() if "." in sym or sym.startswith("^") else sym.lower() + ".us"
            req = Request("https://stooq.com/q/l/?s=%s&f=sd2t2ohlcv&h&e=csv" % quote(q), headers={"User-Agent": "Mozilla/5.0 kitchen-dashboard"})
            with urlopen(req, timeout=10) as r:
                rows = r.read(20000).decode("utf-8", "replace").strip().splitlines()
            v = dict(zip(rows[0].split(","), rows[1].split(",")))
            if v.get("Close") not in (None, "", "N/D"):
                d.update(name=sym, price=float(v["Close"]), prev=float(v["Open"]), cur="USD", spark=[], error=None, approx=True)
        except Exception as e2:
            d["error"] += "; stooq: " + str(e2)[:80]
    STOCK_CACHE[sym] = {"at": time.time(), "data": d}
    return d


def stocks(syms):
    L = [x for x in (_stock_one(s) for s in syms.split(",")[:12]) if x]
    return {"stocks": L}


# ---------- subreddit pictures: top image posts (safe for work only), cached 30 minutes ----------
REDDIT_CACHE = {}


REDDIT_UA = "macos:home-dashboard:v1.0 (personal kitchen display; picture tile, about two requests a day)"


def _reddit_get(url):
    # identifies itself honestly, as Reddit asks of scripts; no browser disguise
    with urlopen(Request(url, headers={"User-Agent": REDDIT_UA}), timeout=12) as r:
        return r.read(6_000_000).decode("utf-8", "replace")


def _reddit_from_json(txt):
    posts = []
    for ch in (json.loads(txt).get("data") or {}).get("children") or []:
        d = ch.get("data") or {}
        if d.get("over_18") or d.get("spoiler") or d.get("is_video"):
            continue
        url = d.get("url_overridden_by_dest") or d.get("url") or ""
        prev = ((d.get("preview") or {}).get("images") or [{}])[0]
        res = [x for x in (prev.get("resolutions") or []) if x.get("width", 0) >= 1000]
        img = (res[0]["url"] if res else (prev.get("source") or {}).get("url")) if prev else None
        if not img and re.search(r"\.(jpe?g|png|webp)$", url, re.I):
            img = url
        if img:
            posts.append({"title": d.get("title") or "", "img": img, "by": d.get("author") or "", "score": d.get("score") or 0,
                          "link": "https://www.reddit.com" + (d.get("permalink") or "")})
    return posts


def _reddit_from_rss(txt):
    # Reddit's public Atom feed; it has no adult flag per post, so titles marked NSFW or spoiler are skipped
    import html as _html
    posts = []
    for e in re.findall(r"<entry>(.*?)</entry>", txt, re.S):
        title = _html.unescape((re.search(r"<title>(.*?)</title>", e, re.S) or [None, ""])[1])
        if re.search(r"\bnsfw\b|\bspoiler\b", title, re.I):
            continue
        body = _html.unescape((re.search(r"<content[^>]*>(.*?)</content>", e, re.S) or [None, ""])[1])
        m = re.search(r'href="(https://i\.redd\.it/[^"]+\.(?:jpe?g|png|webp))"', body) or re.search(r'href="(https://i\.imgur\.com/[^"]+\.(?:jpe?g|png))"', body)
        if not m:
            continue
        who = re.search(r"<name>/?u/([^<]+)</name>", e)
        link = re.search(r'<link href="([^"]+)"', e)
        posts.append({"title": title, "img": m.group(1), "by": who.group(1) if who else "", "score": 0, "link": link.group(1) if link else ""})
    return posts


def reddit_pics(sub, period="day"):
    """Top pictures from a subreddit, fetched at most every 12 hours (an hour after a failure) and kept
    in work/reddit_cache.json so a server restart doesn't fetch again. The tile rotates through them."""
    sub = re.sub(r"[^A-Za-z0-9_]", "", sub or "")[:40]
    period = period if period in ("hour", "day", "week", "month", "year", "all") else "day"
    if not sub:
        return {"posts": [], "error": "no subreddit"}
    key = sub.lower() + "|" + period
    f = WORK / "reddit_cache.json"
    if not REDDIT_CACHE:
        try:
            REDDIT_CACHE.update(json.loads(f.read_text()))
        except Exception:
            pass
    c = REDDIT_CACHE.get(key)
    if c and time.time() - c["at"] < (12 * 3600 if c["data"]["posts"] else 3600):
        return c["data"]
    out = {"sub": sub, "posts": [], "error": None}
    errs = []
    try:
        out["posts"] = _reddit_from_json(_reddit_get("https://www.reddit.com/r/%s/top.json?t=%s&limit=40&raw_json=1" % (sub, period)))[:20]
    except Exception as e:
        errs.append("json: " + str(e)[:80])
        try:
            out["posts"] = _reddit_from_rss(_reddit_get("https://www.reddit.com/r/%s/top/.rss?t=%s&limit=40" % (sub, period)))[:20]
        except Exception as e2:
            errs.append("rss: " + str(e2)[:80])
    if errs and not out["posts"]:
        out["error"] = "Reddit refused the request (" + "; ".join(errs) + ")"
    elif not out["posts"]:
        out["error"] = "no pictures found (is the name right?)"
    if not out["posts"] and c and c["data"]["posts"]:
        out = dict(c["data"], stale=True)            # keep showing the last good pictures
    REDDIT_CACHE[key] = {"at": time.time(), "data": out}
    try:
        f.write_text(json.dumps(REDDIT_CACHE))
    except Exception:
        pass
    return out


ISS_CACHE = {"at": 0, "now": None, "track_at": 0, "track": []}


def iss_now():
    base = "https://api.wheretheiss.at/v1/satellites/25544"
    out = {"error": None}
    try:
        if time.time() - ISS_CACHE["at"] > 4:
            ISS_CACHE.update(at=time.time(), now=_get_json(base, timeout=8))
        if time.time() - ISS_CACHE["track_at"] > 600:
            t0 = int(time.time())
            stamps = [t0 + 120 * i for i in range(-15, 31)]            # -30 min to +60 min, every 2 min
            track = []
            for i in range(0, len(stamps), 10):                          # the API takes 10 at a time
                track += _get_json(base + "/positions?units=kilometers&timestamps=" +
                                   ",".join(str(x) for x in stamps[i:i + 10]), timeout=10)
            ISS_CACHE.update(track_at=time.time(), track=[{"t": p["timestamp"], "lat": p["latitude"], "lon": p["longitude"]} for p in track])
    except Exception as e:
        out["error"] = str(e)[:200]
    n = ISS_CACHE["now"] or {}
    out.update(lat=n.get("latitude"), lon=n.get("longitude"), alt=n.get("altitude"), vel=n.get("velocity"),
               vis=n.get("visibility"), t=n.get("timestamp"), track=ISS_CACHE["track"])
    return out


# ---------- Meal ideas: breakfast, lunch, dinner and dessert ideas from a recipe service ----------
# Setup > Recipes picks the service. With nothing set up, TheMealDB's shared free key is used.
# TheMealDB: the free key browses by category and looks recipes up by id, which is all this needs.
#   A supporter key (a one-time purchase on themealdb.com) replaces the shared one. Credit TheMealDB.
# Spoonacular: each person's own key (the free plan has 50 points a day). Its terms allow keeping
#   recipe details for at most an hour, so ideas live in memory only and are fetched again after that.
#   Credit the recipe's own site and spoonacular.
MEALDB, SPOON = MEALDB_SRC, SPOON_SRC
MEAL_KINDS = ("breakfast", "lunch", "dinner", "dessert")
MEALDB_CATS = {"breakfast": ["Breakfast"], "lunch": ["Starter", "Side", "Pasta", "Miscellaneous"],
               "dinner": ["Beef", "Chicken", "Lamb", "Pork", "Seafood", "Pasta", "Vegetarian", "Vegan", "Goat"],
               "dessert": ["Dessert"]}
DIETS = ("Anything", "Vegetarian", "Vegan", "No pork", "No seafood", "No pork or seafood")
_MEAT = r"beef|steak|chicken|turkey|duck|lamb|mutton|goat|veal|venison|pork|bacon|ham|sausage|chorizo|salami|pancetta|prosciutto|pepperoni|mince|meatball|gelatin|lard|suet|anchov|stock cube|oxtail|kidney|liver"
_PORK = r"pork|bacon|\bham\b|sausage|chorizo|salami|pancetta|prosciutto|pepperoni|lard|gammon"
_FISH = r"fish|salmon|tuna|cod\b|haddock|mackerel|sardine|anchov|trout|prawn|shrimp|crab|lobster|clam|mussel|oyster|scallop|squid|calamari|octopus|kedgeree|saltfish"
_ANIMAL = _MEAT + r"|egg|milk|butter|cream|cheese|yogurt|yoghurt|honey|ghee|parmesan|mozzarella|cheddar|feta|ricotta|mascarpone|" + _FISH
DIET_BLOCK = {"Vegetarian": _MEAT + "|" + _FISH, "Vegan": _ANIMAL, "No pork": _PORK, "No seafood": _FISH, "No pork or seafood": _PORK + "|" + _FISH}
SPOON_DIET = {"Vegetarian": {"diet": "vegetarian"}, "Vegan": {"diet": "vegan"}, "No pork": {"excludeIngredients": "pork,bacon,ham,sausage"},
              "No seafood": {"intolerances": "seafood,shellfish"}, "No pork or seafood": {"excludeIngredients": "pork,bacon,ham,sausage", "intolerances": "seafood,shellfish"}}
SPOON_TYPE = {"breakfast": [{"type": "breakfast"}], "lunch": [{"type": "salad"}, {"type": "soup"}, {"query": "sandwich"}],
              "dinner": [{"type": "main course"}], "dessert": [{"type": "dessert"}]}
MEAL_CACHE = {}           # (source id, meal, diet) -> {at, day, ideas, error}
MEAL_LOOKUPS = {}         # TheMealDB id -> parsed recipe (TheMealDB lets us keep these)
MEAL_LOCK = threading.Lock()
MEAL_STATUS = {}          # source id -> {name, service, at, ok, error}
# pantry staples nobody needs a reason for, or a list item for
STAPLES = {"water", "salt", "pepper", "black pepper", "salt and pepper", "sea salt", "oil", "olive oil", "vegetable oil", "sugar", "ice", "boiling water", "cold water"}


def recipe_source(sid=""):
    """The recipe service a tile asked for: a Setup source by id, else the first one, else TheMealDB's free key."""
    L = [x for x in sources_load().get("recipes") or [] if x.get("service") in (MEALDB, SPOON, None, "")]
    src = next((x for x in L if x.get("id") == sid), None) or (L[0] if L else None)
    if not src:
        return {"id": "", "name": MEALDB, "service": MEALDB, "key": ""}
    return dict(src, service=src.get("service") or MEALDB)


def _diet_ok(diet, ings):
    pat = DIET_BLOCK.get(diet)
    return not pat or not any(re.search(pat, (n or "").lower()) for _, n in ings)


def _mealdb_parse(m):
    ings = []
    for n in range(1, 21):
        ing, mea = (m.get("strIngredient%d" % n) or "").strip(), (m.get("strMeasure%d" % n) or "").strip()
        if ing:
            ings.append([mea, ing])
    steps = [x.strip() for x in re.split(r"\r?\n+", m.get("strInstructions") or "") if x.strip()]
    steps = [re.sub(r"(?i)^(step\s*)?\d+[.):]\s*", "", x) for x in steps if not re.fullmatch(r"(?i)(step\s*)?\d+[.):]?", x)]
    thumb = m.get("strMealThumb") or ""
    return {"id": str(m.get("idMeal") or ""), "title": (m.get("strMeal") or "").strip(), "thumb": thumb + "/medium" if thumb else "", "big": thumb,
            "cat": m.get("strCategory") or "", "area": m.get("strArea") or "", "ingredients": ings, "steps": [x for x in steps if x],
            "link": m.get("strSource") or "", "credit": "TheMealDB"}


def _mealdb_ideas(src, meal, diet, want=4):
    key = (src.get("key") or "").strip() or "1"
    base = "https://www.themealdb.com/api/json/v1/%s/" % quote(key, safe="")
    cats = MEALDB_CATS[meal]
    if diet == "Vegetarian" and meal == "dinner":
        cats = ["Vegetarian", "Vegan", "Pasta"]
    elif diet == "Vegan" and meal in ("lunch", "dinner"):
        cats = ["Vegan", "Vegetarian", "Pasta"] + (["Side", "Starter"] if meal == "lunch" else [])
    pool = []
    for c in cats:
        for m in _get_json(base + "filter.php?c=" + quote(c), timeout=10).get("meals") or []:
            pool.append(str(m.get("idMeal")))
    pool = sorted(set(pool))
    if not pool:
        return []
    rnd = random.Random(datetime.now().strftime("%Y-%m-%d") + meal + diet)   # the same ideas all day, new ones tomorrow
    rnd.shuffle(pool)
    out = []
    for mid in pool[:want * 4]:
        r = MEAL_LOOKUPS.get(mid)
        if r is None:
            got = (_get_json(base + "lookup.php?i=" + quote(mid), timeout=10).get("meals") or [None])[0]
            if not got:
                continue
            r = MEAL_LOOKUPS[mid] = _mealdb_parse(got)
        if r["title"] and _diet_ok(diet, r["ingredients"]):
            out.append(dict(r))
        if len(out) >= want:
            break
    return out


def _spoon_ideas(src, meal, diet, want=4):
    q = {"apiKey": (src.get("key") or "").strip(), "number": want, "sort": "random", "addRecipeInformation": "true",
         "fillIngredients": "true", "instructionsRequired": "true"}
    opts = SPOON_TYPE[meal]
    q.update(opts[datetime.now().toordinal() % len(opts)])
    q.update(SPOON_DIET.get(diet, {}))
    j = _get_json("https://api.spoonacular.com/recipes/complexSearch?" + urlencode(q), timeout=15)
    out = []
    for r in j.get("results") or []:
        ings = [[(" ".join(x for x in [_amt(i.get("amount")), i.get("unit") or ""] if x)).strip(), i.get("name") or i.get("originalName") or ""]
                for i in r.get("extendedIngredients") or []]
        steps = [s.get("step", "").strip() for b in r.get("analyzedInstructions") or [] for s in b.get("steps") or []]
        mins = r.get("readyInMinutes")
        out.append({"id": str(r.get("id")), "title": (r.get("title") or "").strip(), "thumb": r.get("image") or "", "big": r.get("image") or "",
                    "cat": ("Ready in %d min" % mins) if mins else "", "area": (r.get("cuisines") or [""])[0],
                    "ingredients": [x for x in ings if x[1]], "steps": [s for s in steps if s],
                    "link": r.get("sourceUrl") or "", "credit": (r.get("sourceName") or "").strip() or "spoonacular", "via": "spoonacular.com"})
    return out


def _amt(a):
    if not a:
        return ""
    f = Fraction(a).limit_denominator(8)
    whole, part = divmod(f.numerator, f.denominator)
    frac = {"1/2": "½", "1/3": "⅓", "2/3": "⅔", "1/4": "¼", "3/4": "¾", "1/8": "⅛"}.get("%d/%d" % (part, f.denominator), "") if part else ""
    if part and not frac:
        return ("%g" % round(float(a), 2))
    return (str(whole) if whole else "") + frac or "0"


def _recipe_error(e, src):
    key = (src.get("key") or "").strip()
    code = getattr(e, "code", None)
    if src["service"] == SPOON and code == 402:
        return "Spoonacular's daily limit is used up. It resets at midnight UTC."
    if code in (401, 403):
        return "%s didn't accept the API key. Check it in Setup, Recipes." % src["service"]
    msg = str(getattr(e, "reason", None) or e)
    return ("Couldn't reach %s: %s" % (src["service"], msg.replace(key, "<key>") if key else msg))[:200]


def _norm_words(t):
    return [w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w for w in re.findall(r"[a-z]+", (t or "").lower())]


def _uses(ing, thing):
    """Whether a recipe ingredient and a list item or deal are the same food: all the words of the shorter one appear in the longer one."""
    a, b = _norm_words(ing), _norm_words(thing)
    if not a or not b or " ".join(a) in STAPLES:
        return False
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    return all(w in long_ for w in short) and len(" ".join(short)) >= 3


def meal_reason(idea, list_items, deals):
    names = [n for _, n in idea.get("ingredients") or []]
    for d in deals:
        want = d.get("want") or d.get("name") or ""
        hit = next((n for n in names if _uses(n, want)), None)
        if hit:
            return "Uses %s, on sale%s" % (hit.lower(), " at " + d["store"] if d.get("store") else "")
    for t in list_items:
        hit = next((n for n in names if _uses(n, t)), None)
        if hit:
            return "Uses %s from your list" % hit.lower()
    return ""


def meal_ideas(meal="dinner", diet="Anything", sid=""):
    meal = meal if meal in MEAL_KINDS else "dinner"
    diet = diet if diet in DIETS else "Anything"
    src = recipe_source(sid)
    day = datetime.now().strftime("%Y-%m-%d")
    ck = (src.get("id") or "", src["service"], meal, diet)
    # TheMealDB: the same ideas all day. Spoonacular: at most an hour, as its terms ask.
    ttl = 3600 if src["service"] == SPOON else 6 * 3600
    with MEAL_LOCK:
        c = MEAL_CACHE.get(ck)
        fresh = c and time.time() - c["at"] < (ttl if c["ideas"] else 600) and (src["service"] == SPOON or c["day"] == day)
        if not fresh:
            err, ideas = None, []
            try:
                ideas = (_spoon_ideas if src["service"] == SPOON else _mealdb_ideas)(src, meal, diet)
                if not ideas:
                    err = "No %s ideas matched. Try another diet setting." % meal
            except Exception as e:
                err = _recipe_error(e, src)
            if not ideas and c and c["ideas"] and src["service"] != SPOON:
                ideas = c["ideas"]                     # keep yesterday's ideas rather than an empty tile
            c = MEAL_CACHE[ck] = {"at": time.time(), "day": day, "ideas": ideas, "error": err}
            MEAL_STATUS[src.get("id") or ""] = {"name": src.get("name") or src["service"], "service": src["service"], "at": time.time(),
                                                 "ok": not err or bool(ideas), "error": err}
    try:
        nv = notes_view()
        list_items = [i["text"] for i in nv.get("items", []) if not i.get("done")]
        can_add = not nv.get("readonly")
        list_name = nv.get("list") or "Grocery"
    except Exception:
        list_items, can_add, list_name = [], False, ""
    deals = [d for d in ((SALES.get("data") or {}).get("deals") or [])]
    ideas = [dict(i, why=meal_reason(i, list_items, deals)) for i in c["ideas"]]
    ideas.sort(key=lambda i: not i["why"])               # a reason to cook it goes first
    return {"meal": meal, "diet": diet, "ideas": ideas, "error": c["error"] if not ideas else None, "service": src["service"],
            "list": {"name": list_name, "canAdd": can_add, "items": list_items}}


def recipes_test(item):
    """Setup's Test button for a recipe source: one small request with the key as typed (or the saved one)."""
    saved = next((x for x in sources_load().get("recipes") or [] if x.get("id") == item.get("id")), {}) if item.get("id") else {}
    src = {"service": item.get("service") or saved.get("service") or MEALDB, "key": (item.get("key") or saved.get("key") or "").strip()}
    if src["service"] == SPOON and not src["key"]:
        return {"ok": False, "error": "Paste your Spoonacular API key first."}
    try:
        if src["service"] == SPOON:
            j = _get_json("https://api.spoonacular.com/recipes/complexSearch?" + urlencode({"apiKey": src["key"], "number": 1, "query": "soup"}), timeout=15)
            return {"ok": True, "detail": "Spoonacular · %s recipes for soup" % "{:,}".format(j.get("totalResults") or 0)}
        j = _get_json("https://www.themealdb.com/api/json/v1/%s/categories.php" % quote(src["key"] or "1", safe=""), timeout=10)
        return {"ok": True, "detail": "TheMealDB · %d categories" % len(j.get("categories") or []) + ("" if src["key"] else " · free key")}
    except Exception as e:
        return {"ok": False, "error": _recipe_error(e, src)}


# ---------- sales: what you usually buy vs this week's store ads ----------
# work/purchases/ holds store exports and the library built from them: any *.csv with the columns
# date,store,brand,item,size,price (one row per item bought; see _parse_csv) from any store, or a
# Schnucks receipts export (schnucks_receipts.json from tools/schnucks_export.js). Everything stays on this machine; only short search words (e.g. "ghost energy")
# and the ZIP code go to Flipp, the weekly-ad service most US chains publish through.
PURCH_DIR = WORK / "purchases"
LIB_FILE = PURCH_DIR / "library.json"
LISTLOG_FILE = PURCH_DIR / "list_log.json"
SALES_FILE = PURCH_DIR / "sales_cache.json"
SALES = {"at": 0, "key": "", "data": None, "busy": False}
SALES_LOCK = threading.Lock()
_STOP = set("a an and the with of in for to or zero sugar free original classic pack count ct oz lb gr g fl size party king "
            "family value bag box can cans bottle bottles each pk pkg ounce ounces x".split())


def _words(s):
    return [w for w in re.findall(r"[a-z0-9]+", (s or "").lower().replace("'", "")) if w not in _STOP and not w.isdigit() and len(w) > 1]


def _parse_schnucks(d):
    """Schnucks' in-store purchase pages, saved as page text: item, $paid, Price: q/unit, Rewards Points, n."""
    out = []
    for r in d.get("receipts", []):
        t = r.get("text") or ""
        m = re.search(r"Date:\s*\n\s*(\d+/\d+/\d{4})", t)
        L = [x.strip() for x in t.split("\n")]
        start = next((k for k, x in enumerate(L) if x.startswith("Items Purchased")), None)
        if not m or start is None:
            continue
        day = datetime.strptime(m.group(1), "%m/%d/%Y").date().isoformat()
        for k in range(start + 1, len(L) - 2):
            if re.fullmatch(r"-?\$\d+\.\d\d", L[k + 1]) and L[k + 2].startswith("Price:"):
                paid = float(L[k + 1].replace("$", ""))
                pm = re.match(r"Price:\s*([\d.]+)\s*/\s*([\d.]+)", L[k + 2])
                q, unit = (float(pm.group(1)), float(pm.group(2))) if pm else (1.0, paid)
                sm = re.match(r"(?:(.+?) - )?(.+?)(?: \(([^)]*)\))?$", L[k])
                out.append({"store": "Schnucks", "day": day, "brand": sm.group(1) or "", "name": sm.group(2), "size": sm.group(3) or "",
                            "paid": paid, "reg": unit, "sale": q >= 1 and paid < round(q * unit, 2) - 0.01})
    return out


def _parse_csv(path):
    """Generic purchase history, one row per item bought. Columns (header row, any order, case ignored):
    date (YYYY-MM-DD or M/D/YYYY), store, brand (optional), item, size (optional), price (what you paid),
    regular (optional: the usual price, to spot sales). Other columns are ignored."""
    import csv
    out = []
    with open(path, newline="", encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh):
            r = {(k or "").strip().lower(): (v or "").strip() for k, v in r.items()}
            name, raw = r.get("item") or r.get("name") or "", r.get("date") or ""
            if not name or not raw:
                continue
            day = None
            for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
                try:
                    day = datetime.strptime(raw[:10], fmt).date().isoformat()
                    break
                except ValueError:
                    pass
            if not day:
                continue
            money = lambda v: float(re.sub(r"[^\d.]", "", v) or 0)
            paid = money(r.get("price") or r.get("paid") or "")
            reg = money(r.get("regular") or "") or paid
            out.append({"store": r.get("store") or "", "day": day, "brand": r.get("brand") or "", "name": name,
                        "size": r.get("size") or "", "paid": paid, "reg": reg, "sale": paid < reg - 0.01})
    return out


def purchases_library():
    """Rebuild library.json when an export is newer; returns {items:[...]}"""
    try:
        exports = sorted(PURCH_DIR.glob("*_receipts.json")) + sorted(PURCH_DIR.glob("*.csv"))
    except Exception:
        exports = []
    newest = max([f.stat().st_mtime for f in exports] or [0])
    if LIB_FILE.exists() and LIB_FILE.stat().st_mtime >= newest:
        try:
            return json.loads(LIB_FILE.read_text())
        except Exception:
            pass
    lines = []
    for f in exports:
        try:
            if f.suffix.lower() == ".csv":
                lines += _parse_csv(f)
                continue
            d = json.loads(f.read_text())
            if "schnucks" in f.name.lower() or "schnucks" in str(d.get("store", "")).lower():
                lines += _parse_schnucks(d)
        except Exception:
            continue
    agg = {}
    for x in lines:
        key = (x["brand"] + " - " + x["name"]).lower().strip(" -")
        e = agg.setdefault(key, {"key": key, "brand": x["brand"], "name": x["name"], "size": x["size"], "stores": set(),
                                 "days": set(), "count": 0, "paid": [], "reg": 0, "saleHits": 0})
        e["stores"].add(x["store"]); e["days"].add(x["day"]); e["count"] += 1; e["paid"].append(x["paid"])
        e["reg"] = max(e["reg"], x["reg"]); e["saleHits"] += x["sale"]
    items = []
    for e in agg.values():
        days = sorted(e.pop("days"))
        items.append(dict(e, stores=sorted(e["stores"]), trips=len(days), first=days[0], last=days[-1],
                          avg=round(sum(e["paid"]) / len(e["paid"]), 2), paid=None))
    for i in items:
        i.pop("paid")
    items.sort(key=lambda i: (-i["trips"], -i["count"]))
    lib = {"built": datetime.now().isoformat(timespec="seconds"), "lines": len(lines), "items": items}
    if exports:
        PURCH_DIR.mkdir(parents=True, exist_ok=True)
        LIB_FILE.write_text(json.dumps(lib, indent=1))
    return lib


def purchases_log_list(items):
    """Count each grocery-list entry once (by its id) so things you add often count as usual items too."""
    try:
        log = json.loads(LISTLOG_FILE.read_text()) if LISTLOG_FILE.exists() else {}
    except Exception:
        log = {}
    seen, words, today, changed = set(log.get("seen", [])), log.get("words", {}), datetime.now().date().isoformat(), False
    for i in items:
        if i.get("id") in seen or not i.get("text"):
            continue
        seen.add(i["id"]); changed = True
        k = " ".join(_words(i["text"]))
        if k:
            w = words.setdefault(k, {"text": i["text"], "count": 0, "first": today})
            w["count"] += 1; w["last"] = today; w["text"] = i["text"]
    if changed:
        PURCH_DIR.mkdir(parents=True, exist_ok=True)
        LISTLOG_FILE.write_text(json.dumps({"seen": sorted(seen)[-3000:], "words": words}, indent=1))


def _wanted(s, list_items):
    """Things worth watching: on the list now, bought often (recently weighted), added to the list often, or named in settings."""
    lib, want = purchases_library(), []
    cut = (datetime.now() - timedelta(days=max(30, s.get("recentDays") or 180))).date().isoformat()
    for i in lib.get("items", []):
        if i["trips"] >= 2 and (i["last"] >= cut or i["trips"] >= 4):
            score = i["trips"] + (3 if i["last"] >= cut else 0)
            want.append({"label": i["name"], "brand": i["brand"], "avg": i["avg"], "reg": i["reg"], "trips": i["trips"], "score": score, "why": "usual"})
    want.sort(key=lambda w: -w["score"])
    want = want[:max(5, s.get("watch") or 40)]
    try:
        log = json.loads(LISTLOG_FILE.read_text()).get("words", {}) if LISTLOG_FILE.exists() else {}
    except Exception:
        log = {}
    for w in log.values():
        if w["count"] >= 2:
            want.append({"label": w["text"], "brand": "", "score": w["count"], "why": "list"})
    for t in s.get("always") or []:
        if t.strip():
            want.append({"label": t.strip(), "brand": "", "score": 99, "why": "always"})
    for i in list_items:
        want.append({"label": i, "brand": "", "score": 100, "why": "onlist"})
    return want


def _query(w, stores):
    """Search by brand when there is one (one search covers all its flavors); else by the first product words."""
    store_words = {x for st in stores for x in _words(st)}
    b = [x for x in _words(w["brand"]) if x not in store_words][:2]   # a store's own brand rarely shows in other ads
    n = [x for x in _words(w["label"]) if x not in b]
    return (" ".join(b) if b else " ".join(n[:3])), b, n


def _flipp(q, zip_code):
    url = ("https://backflipp.wishabi.com/flipp/items/search?locale=en-us&postal_code=" + re.sub(r"\D", "", zip_code)[:5] +
           "&q=" + re.sub(r"\s+", "+", q))
    return _get_json(url, timeout=15)


def _price(it):
    p, pre, post = it.get("current_price"), (it.get("pre_price_text") or "").strip(), (it.get("post_price_text") or "").strip()
    if p in (None, "", 0):
        return (it.get("sale_story") or "").strip()
    try:
        p = "$%.2f" % float(p)
    except Exception:
        p = str(p)
    return (pre + (" " if pre and not pre.endswith("/") else "") + p + ((" " + post) if post else "")).strip()


def sales_refresh(s, list_items):
    stores = [x.strip() for x in (s.get("stores") or []) if x.strip()]
    store_keys = [" ".join(_words(x)) for x in stores]
    want, seen_q, deals, errs, checked = _wanted(s, list_items), {}, [], [], 0
    for w in want:
        q, bw, nw = _query(w, stores)
        if not q:
            continue
        if q not in seen_q:
            try:
                seen_q[q] = _flipp(q, s.get("zip") or "")
                checked += 1
            except Exception as e:
                seen_q[q] = {}
                errs.append(str(e)[:120])
            time.sleep(0.4)
        best = None
        for it in (seen_q[q].get("items") or []):
            merch = " ".join(_words(it.get("merchant_name") or it.get("merchant") or ""))
            if store_keys and not any(k and (k in merch or merch in k) for k in store_keys):
                continue
            name = set(_words(it.get("name")))
            if bw and not all(x in name for x in bw):
                continue
            hit = len(name & set(nw))
            if not bw and hit < min(2, len(nw)):
                continue
            score = hit + (2 if bw else 0)
            if not best or score > best[0]:
                best = (score, it)
        if best:
            it = best[1]
            try:
                now_p = float(it.get("current_price")) if it.get("current_price") not in (None, "") else None
                m = re.match(r"\s*(\d+)\s*/", it.get("pre_price_text") or "")
                if now_p and m and int(m.group(1)) > 1:
                    now_p = round(now_p / int(m.group(1)), 2)          # "2/$5" is $2.50 each
            except Exception:
                now_p = None
            deals.append({"want": w["label"], "brand": w.get("brand", ""), "why": w["why"], "score": w["score"],
                          "name": it.get("name"), "store": it.get("merchant_name") or it.get("merchant") or "",
                          "price": _price(it), "now": now_p, "was": it.get("original_price"), "story": it.get("sale_story") or "",
                          "usual": w.get("avg"), "until": it.get("valid_to") or "", "img": it.get("clean_image_url") or it.get("clipping_image_url") or ""})
    seen, out = set(), []
    for d in sorted(deals, key=lambda d: (d["now"] is None, -d["score"])):
        k = (d["name"], d["store"])
        if k in seen:
            continue
        seen.add(k)
        # skip "deals" that cost more than you usually pay
        if d["usual"] and d["now"] and d["now"] > d["usual"] * 1.05 and d["why"] == "usual":
            continue
        if d["story"].strip().lower() in ("sale", "on sale", d["price"].strip().lower()):
            d["story"] = ""                                  # Target writes just "SALE": not worth repeating
        out.append(d)
    return {"deals": out[:30], "checked": checked, "watching": len(want), "at": int(time.time()),
            "error": (errs[0] if errs and not out and len(errs) >= checked else None), "library": bool(LIB_FILE.exists())}


def sales_view():
    s = config_load()["modules"].get("deals", {}).get("settings", {})
    try:
        nv = notes_view()
        list_items = [i["text"] for i in nv.get("items", []) if not i.get("done")]
    except Exception:
        list_items = []
    key = json.dumps([s.get("zip"), s.get("stores"), s.get("always"), s.get("watch"), sorted(list_items)])
    if SALES["data"] is None and SALES_FILE.exists():
        try:
            c = json.loads(SALES_FILE.read_text())
            SALES.update(at=c["at"], key=c["key"], data=c["data"])
        except Exception:
            pass
    age = time.time() - SALES["at"]
    stale = age > 6 * 3600 or (SALES["key"] != key and age > 300)
    if stale and not SALES["busy"]:
        SALES["busy"] = True

        def run():
            try:
                data = sales_refresh(s, list_items)
                SALES.update(at=time.time(), key=key, data=data)
                PURCH_DIR.mkdir(parents=True, exist_ok=True)
                SALES_FILE.write_text(json.dumps({"at": SALES["at"], "key": key, "data": data}))
            except Exception as e:
                SALES.update(at=time.time() - 6 * 3600 + 900, data={"deals": [], "error": str(e)[:200]})
            finally:
                SALES["busy"] = False
        threading.Thread(target=run, daemon=True).start()
    return dict(SALES["data"] or {"deals": [], "loading": True}, busy=SALES["busy"])


# --- live cams: resolve YouTube links / @channels to streams that are live right now (cached 20 min) ---
CAM_CACHE = {"at": 0, "key": "", "data": None}


def _yt_page(url):
    req = Request(url, headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
                                "Accept-Language": "en-US,en;q=0.9", "Cookie": "CONSENT=YES+1"})
    with urlopen(req, timeout=15) as r:
        return r.read(3_000_000).decode("utf-8", "replace")


def _yt_resolve(item):
    item = item.strip()
    m = re.search(r"(?:v=|youtu\.be/|/live/|/embed/)([\w-]{11})", item) or re.fullmatch(r"([\w-]{11})", item)
    if m:
        vid, page = m.group(1), _yt_page("https://www.youtube.com/watch?v=" + m.group(1))
    else:
        h = item if item.startswith("http") else "https://www.youtube.com/" + (item if item.startswith("@") else "@" + item)
        page = _yt_page(h.rstrip("/") + "/live")
        c = re.search(r'<link rel="canonical" href="https://www\.youtube\.com/watch\?v=([\w-]{11})"', page)
        if not c:
            raise RuntimeError("not live right now")
        vid = c.group(1)
    if '"isLiveNow":true' not in page and '"isLive":true' not in page:
        raise RuntimeError("not live right now")
    if '"playableInEmbed":false' in page:
        raise RuntimeError("owner doesn't allow embedding")
    t = re.search(r'<meta name="title" content="([^"]*)"', page) or re.search(r"<title>(.*?)</title>", page)
    title = (t.group(1) if t else "").replace(" - YouTube", "")
    ch = re.search(r'"ownerChannelName":"([^"]*)"', page)
    import html as _h
    return {"id": vid, "title": _h.unescape(title)[:120], "channel": _h.unescape(ch.group(1)) if ch else ""}


def live_cams(ids=None):
    items = [c.get("url") or "" for c in sources_load().get("cams") or [] if not ids or c.get("id") in ids]
    items = [x for x in items if str(x).strip()]
    key = "|".join(items)
    if CAM_CACHE["data"] is not None and CAM_CACHE["key"] == key and time.time() - CAM_CACHE["at"] < 1200:
        return CAM_CACHE["data"]
    from concurrent.futures import ThreadPoolExecutor
    cams, errors = [], []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for item, f in [(i, pool.submit(_yt_resolve, i)) for i in items]:
            try:
                c = f.result()
                if c["id"] not in [x["id"] for x in cams]:
                    cams.append(dict(c, source=item))
            except Exception as e:
                errors.append("%s: %s" % (item, str(e)[:100]))
    out = {"cams": cams, "errors": errors}
    CAM_CACHE.update(at=time.time(), key=key, data=out)
    return out


# --- photos: iCloud Shared Album ("Public Website" on), cached 30 minutes ---
PHOTO_CACHES = {}          # album link -> {at, key, data}
B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"


def album_photos(sid=""):
    A = sources_load().get("albums") or []
    src = next((a for a in A if a.get("id") == sid), A[0] if A else None)
    link = ((src or {}).get("url") or "").strip()
    if not link:
        return {"photos": [], "error": "no album set up"}
    PHOTO_CACHE = PHOTO_CACHES.setdefault(link, {"at": 0, "key": link, "data": None})
    if PHOTO_CACHE["data"] is not None and time.time() - PHOTO_CACHE["at"] < 1800:
        return PHOTO_CACHE["data"]
    out = {"photos": [], "error": None, "album": ""}
    try:
        token = link.split("#")[-1].split(";")[0].strip("/")
        n = 0
        for ch in (token[1:2] if token[0] == "A" else token[1:3]):
            n = n * 62 + B62.index(ch)
        host = "p%02d-sharedstreams.icloud.com" % n
        base = "https://%s/%s/sharedstreams/" % (host, token)
        try:
            stream = _get_json(base + "webstream", {"streamCtag": None})
        except Exception as e:
            # Apple answers 330 with the right partition host
            hdr = getattr(e, "headers", None)
            moved = hdr.get("X-Apple-MMe-Host") if hdr else None
            if not moved and hasattr(e, "read"):
                try:
                    moved = json.loads(e.read().decode()).get("X-Apple-MMe-Host")
                except Exception:
                    moved = None
            if not moved:
                raise
            base = "https://%s/%s/sharedstreams/" % (moved, token)
            stream = _get_json(base + "webstream", {"streamCtag": None})
        out["album"] = stream.get("streamName", "")
        photos = stream.get("photos") or []
        guids = [p["photoGuid"] for p in photos if p.get("photoGuid")]
        urls = {}
        for i in range(0, len(guids), 25):
            assets = _get_json(base + "webasseturls", {"photoGuids": guids[i:i + 25]})
            for cs, it in (assets.get("items") or {}).items():
                urls[cs] = "https://" + it["url_location"] + it["url_path"]
        for p in photos:
            ders = p.get("derivatives") or {}
            # largest version that is still a sensible size for a 1920x1080 screen
            best = None
            for d in ders.values():
                w = int(d.get("width") or 0)
                if d.get("checksum") in urls and w <= 2600 and (best is None or w > int(best.get("width") or 0)):
                    best = d
            if best:
                out["photos"].append({"url": urls[best["checksum"]], "caption": p.get("caption", ""),
                                      "date": p.get("dateCreated", ""), "w": int(best.get("width") or 0),
                                      "h": int(best.get("height") or 0)})
    except Exception as e:
        out["error"] = str(e)[:200]
    PHOTO_CACHE.update(at=time.time(), key=link, data=out)
    return out


# ---------- health, update notice and diagnostics (Controls > Status) ----------
LATEST = {"at": 0, "tag": "", "name": "", "url": "", "error": "", "checked": 0}
LATEST_LOCK = threading.Lock()


def _vtuple(v):
    m = re.match(r"v?(\d+)\.(\d+)\.(\d+)", str(v or "").strip())
    return tuple(int(x) for x in m.groups()) if m else None


def _where():
    if Path("/.dockerenv").exists() or os.environ.get("COUNTERTOP_DOCKER"):
        return "Docker"
    if os.environ.get("COUNTERTOP_APP"):
        return "Mac app"
    return {"Darwin": "Mac", "Linux": "Linux", "Windows": "Windows"}.get(platform.system(), platform.system())


def updates_on():
    if os.environ.get("COUNTERTOP_NO_UPDATE_CHECK"):
        return False
    try:
        return config_load()["modules"]["general"]["settings"].get("updates", True) is not False
    except Exception:
        return True


def update_check(force=False):
    """Ask GitHub for the newest release, at most twice a day (or now, from Controls). Sends nothing about this install."""
    if not force and (not updates_on() or time.time() - LATEST["checked"] < 12 * 3600):
        return
    with LATEST_LOCK:
        LATEST["checked"] = time.time()
        try:
            req = Request("https://api.github.com/repos/%s/releases/latest" % REPO,
                          headers={"User-Agent": "Countertop/" + VERSION, "Accept": "application/vnd.github+json"})
            d = json.loads(urlopen(req, timeout=10).read().decode())
            LATEST.update(at=time.time(), tag=d.get("tag_name") or "", name=d.get("name") or "", url=d.get("html_url") or "", error="")
        except Exception as e:
            LATEST["error"] = str(e)[:160]


def update_loop():
    time.sleep(45)
    while True:
        try:
            update_check()
        except Exception:
            pass
        time.sleep(1800)


def _ago(ts):
    return int(time.time() - ts) if ts else None


def status_view():
    now = time.time()
    probs = []                  # [level, text]: "bad" = something is broken, "warn" = worth a look
    try:
        g = config_load()["modules"]["general"]["settings"]
    except Exception:
        g = {}
    work = WORK
    writable = os.access(work, os.W_OK) if work.exists() else os.access(work.parent, os.W_OK)
    if not writable:
        probs.append(["bad", "The server can't save settings: the data folder isn't writable. Check its owner (Docker: PUID/PGID, Unraid: 99:100)."])
    if not (g.get("lat") or g.get("lon")):
        probs.append(["warn", "Set your location so the weather can load."])

    beat = SCREEN["beat"] or {}
    seen = SCREEN["at"]
    if not seen:
        probs.append(["warn", "No screen has checked in since the server started. Open /dash on your display."])
    elif now - seen > 300:
        probs.append(["warn", "The screen last checked in %d minutes ago." % ((now - seen) // 60)])
    feeds = beat.get("feeds") or {}
    if feeds.get("wxErr"):
        probs.append(["warn", "The screen couldn't load the weather: " + str(feeds["wxErr"])[:120]])
    recent = [e for e in SCREEN["errors"] if now - e["at"] < 3600]
    if recent:
        probs.append(["warn", "%d page error%s in the last hour. The diagnostics file has the details." % (len(recent), "" if len(recent) == 1 else "s")])

    try:
        src = sources_load()
    except Exception:
        src = {}
    cals = []
    for c in src.get("calendars") or []:
        st = CAL_STATUS.get(c.get("id")) or {}
        cals.append({"name": c.get("name") or "Calendar", "at": st.get("at") or 0, "ok": st.get("ok"), "error": st.get("error") or "", "count": st.get("count")})
        if st.get("ok") is False:
            probs.append(["bad", "Calendar \u201c%s\u201d didn't load: %s" % (c.get("name") or "Calendar", st.get("error"))])

    homes = []
    for h in src.get("homeassistant") or []:
        st = HA_STATUS.get(h.get("id")) or {}
        homes.append({"name": h.get("name") or "Home Assistant", "at": st.get("at") or 0, "ok": st.get("ok"), "error": st.get("error") or "", "count": st.get("count")})
        if st.get("ok") is False:
            probs.append(["bad", "Home Assistant \u201c%s\u201d: %s" % (h.get("name") or "Home Assistant", st.get("error"))])

    recipes = []
    for sid, st in sorted(MEAL_STATUS.items()):
        recipes.append({"name": st["name"], "service": st["service"], "at": st["at"], "ok": st["ok"], "error": st.get("error") or ""})
        if not st["ok"]:
            probs.append(["warn", "Meal ideas (%s): %s" % (st["name"], st["error"])])

    lst = None
    try:
        nv = notes_view()
        lst = {"name": nv.get("list") or "Grocery list", "source": nv.get("source") or "dashboard", "count": len([i for i in nv.get("items") or [] if not i.get("done")]),
               "at": nv.get("pushedAt") or nv.get("updated") or 0, "error": nv.get("error") or ""}
        if lst["error"]:
            probs.append(["warn", "List: " + str(lst["error"])[:160]])
    except Exception as e:
        lst = {"error": str(e)[:160]}

    cur, new = _vtuple(VERSION), _vtuple(LATEST["tag"])
    update = bool(cur and new and new > cur)
    level = "bad" if any(p[0] == "bad" for p in probs) else "warn" if probs else "ok"
    return {
        "version": VERSION, "repo": REPO,
        "latest": {"tag": LATEST["tag"], "name": LATEST["name"], "url": LATEST["url"], "checkedAgo": _ago(LATEST["checked"]),
                   "error": LATEST["error"], "on": updates_on()},
        "update": update,
        "server": {"startedAgo": int(now - SERVER_START), "where": _where(), "git": (HERE.parent / ".git").exists(), "python": platform.python_version(),
                   "tz": time.strftime("%Z"), "writable": writable},
        "screen": {"seenAgo": _ago(seen), "fullscreen": beat.get("fs"), "wxAgo": int(now - feeds["wx"] / 1000) if feeds.get("wx") else None},
        "calendars": [dict(c, ago=_ago(c["at"])) for c in cals],
        "homeassistant": [dict(h, ago=_ago(h["at"])) for h in homes],
        "recipes": [dict(r, ago=_ago(r["at"])) for r in recipes],
        "list": dict(lst, ago=_ago(lst.get("at"))) if lst else None,
        "level": level, "problems": [p[1] for p in probs],
    }


# Diagnostics: one zip a person can attach to a GitHub issue. Private links, keys, the home location and
# network addresses are removed; list items, notes and purchase history are left out entirely.
_URL_RE = re.compile(r"(?i)\b(https?|webcal)://([^/\s\"'<>?#]+)[^\s\"'<>]*")
_JWT_RE = re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")
_EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b")
_IP_RE = re.compile(r"\b(?!127\.0\.0\.1\b)(?:\d{1,3}\.){3}\d{1,3}\b")
_SAFE_HOSTS = ("api.open-meteo.com", "geocoding-api.open-meteo.com", "air-quality-api.open-meteo.com", "api.github.com", "github.com",
               "stats-api.mlssoccer.com", "site.api.espn.com", "api.rainviewer.com", "tilecache.rainviewer.com", "tile.openstreetmap.org")


def _secret_fields(kind):
    """Fields never shown in full: every field Setup marks secret, plus links and sync keys of any kind."""
    return sorted({"url", "pushKey"} | {f for f, v in (SOURCE_KINDS.get(kind) or {}).get("fields", {}).items() if v.get("secret")})


def _secrets():
    out = set()
    try:
        for kind, items in sources_load().items():
            sec = _secret_fields(kind)
            for it in items or []:
                for f in sec:
                    v = str(it.get(f) or "").strip()
                    if len(v) > 5 and not (kind == "cams" and f == "url"):
                        out.add(v)
    except Exception:
        pass
    try:
        m = config_load()["modules"]
        g = m["general"]["settings"]
        out.update(str(x) for x in (g.get("place"), m.get("deals", {}).get("settings", {}).get("zip")) if x and len(str(x)) > 2)
        for k in ("lat", "lon"):
            if g.get(k):
                out.add(str(g[k]))
                out.add(("%.2f" % float(g[k])))
    except Exception:
        pass
    return sorted(out, key=len, reverse=True)


def redact(text, secrets=None):
    text = str(text)
    for s in secrets if secrets is not None else _secrets():
        text = text.replace(s, "<removed>")
    home = str(Path.home())
    if len(home) > 1:
        text = text.replace(home, "~")

    def url(m):
        host = m.group(2).split("@")[-1]
        name = host.split(":")[0].lower()
        if name in _SAFE_HOSTS and "?" not in m.group(0):
            return m.group(0)
        if _IP_RE.fullmatch(name) or name in ("localhost", "127.0.0.1") or name.endswith(".local"):
            return m.group(0).split("?")[0].split("#")[0]           # this server: keep the page, drop anything after ?
        return "%s://%s/<removed>" % (m.group(1), host)
    text = _JWT_RE.sub("<token>", text)              # Home Assistant tokens and anything like them
    text = _URL_RE.sub(url, text)
    text = _EMAIL_RE.sub("<email>", text)
    return _IP_RE.sub("<ip>", text)


def _tail(path, n=400, max_bytes=400_000):
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - max_bytes))
            lines = f.read().decode("utf-8", "replace").splitlines()
        return "\n".join(lines[-n:]) + "\n"
    except FileNotFoundError:
        return "(no file)\n"
    except Exception as e:
        return "(couldn't read: %s)\n" % e


def diagnostics_zip():
    sec = _secrets()
    R = lambda t: redact(t, sec)
    work = WORK
    mods = config_load()["modules"]
    g = mods["general"]["settings"]
    for k in ("place", "lat", "lon"):
        if g.get(k):
            g[k] = "<removed>"
    if mods.get("deals", {}).get("settings", {}).get("zip"):
        mods["deals"]["settings"]["zip"] = "<removed>"
    for it in (mods.get("tiles", {}).get("settings", {}).get("items") or []):
        for k, v in list((it.get("settings") or {}).items()):
            if k in ("text", "note", "body") and isinstance(v, str) and v:
                it["settings"][k] = "<%d characters removed>" % len(v)
    srcs = {}
    for kind, items in sources_load().items():
        srcs[kind] = []
        sec = _secret_fields(kind)
        for it in items or []:
            o = {k: v for k, v in it.items() if k not in sec}
            if it.get("url"):
                o["url"] = "set (%s)" % (urlparse(it["url"].replace("webcal://", "https://")).hostname or "?")
            for f in sec:
                if f != "url" and it.get(f):
                    o[f] = "set"
            srcs[kind].append(o)
    files = []
    for f in sorted(work.rglob("*")) if work.exists() else []:
        try:
            if f.is_file():
                st = f.stat()
                files.append("%10d  %s  %s" % (st.st_size, time.strftime("%Y-%m-%d %H:%M", time.localtime(st.st_mtime)), f.relative_to(work)))
        except Exception:
            pass
    info = {"version": VERSION, "made": time.strftime("%Y-%m-%d %H:%M:%S %Z"), "where": _where(), "python": sys.version.split()[0],
            "os": platform.platform(), "tz": os.environ.get("TZ") or time.strftime("%Z"), "uptime_s": int(time.time() - SERVER_START)}
    status = status_view()
    readme = (
        "Countertop diagnostics\n======================\n\n"
        "Made by Countertop %s on %s. Attach this file to a bug report at https://github.com/%s/issues\n\n"
        "What's inside:\n"
        "  info.json        version, Python, operating system, time zone\n"
        "  status.json      what Controls > Status shows\n"
        "  settings.json    your dashboard settings\n"
        "  sources.json     your calendars, lists, teams, albums, cams and Home Assistant, without links, sync keys or tokens\n"
        "  heartbeat.log    the last check-ins and page errors from your screen\n"
        "  console.log      the server's recent output (the same as `docker logs`)\n"
        "  server.log       the end of work/server.log, if your setup writes one\n"
        "  files.txt        the names and sizes of the files in the data folder (not their contents)\n\n"
        "What was removed before saving: calendar, album and list links, sync keys, Home Assistant tokens, your place name, latitude and\n"
        "longitude, ZIP code, email addresses, IP addresses and the paths of any other web links. Grocery and to-do\n"
        "items, notes, photos and purchase history are not included. Open the files to check before you share them.\n"
    ) % (VERSION, info["made"], REPO)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("README.txt", readme)
        z.writestr("info.json", json.dumps(info, indent=1))
        z.writestr("status.json", R(json.dumps(status, indent=1, ensure_ascii=False)))
        z.writestr("settings.json", R(json.dumps(mods, indent=1, ensure_ascii=False)))
        z.writestr("sources.json", R(json.dumps(srcs, indent=1, ensure_ascii=False)))
        z.writestr("heartbeat.log", R(_tail(LOG)))
        z.writestr("console.log", R("\n".join(CONSOLE) + "\n"))
        z.writestr("server.log", R(_tail(work / "server.log")))
        z.writestr("files.txt", "\n".join(files) + "\n")
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser(description="Countertop dashboard server")
    ap.add_argument("--port", type=int, default=8090)
    ap.add_argument("--tls", action="store_true")
    ap.add_argument("--cert", default=str(WORK / "tls" / "cert.pem"))
    ap.add_argument("--key", default=str(WORK / "tls" / "key.pem"))
    ap.add_argument("--also-tls", action="store_true", help="also listen HTTPS on --tls-port sharing state")
    ap.add_argument("--tls-port", type=int, default=8443)
    a = ap.parse_args()
    WORK.mkdir(parents=True, exist_ok=True)
    sys.stdout, sys.stderr = _Tee(sys.stdout), _Tee(sys.stderr)
    print("Countertop %s starting (Python %s, %s)" % (VERSION, platform.python_version(), platform.system()), flush=True)
    if OLD_LOG.exists() and not LOG.exists():
        try:
            OLD_LOG.rename(LOG)
        except OSError:
            pass
    threading.Thread(target=reminders_loop, daemon=True).start()
    threading.Thread(target=update_loop, daemon=True).start()
    ip = lan_ip()
    scheme = "https" if a.tls else "http"
    srv = ThreadingHTTPServer(("0.0.0.0", a.port), Handler)
    if a.tls:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(a.cert, a.key)
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    if a.also_tls and not (Path(a.cert).exists() and Path(a.key).exists()):
        print("HTTPS not started: no certificate at %s (only needed for older Echo setups)" % a.cert, flush=True)
        a.also_tls = False
    if a.also_tls:
        tls_srv = ThreadingHTTPServer(("0.0.0.0", a.tls_port), Handler)
        ctx2 = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx2.load_cert_chain(a.cert, a.key)
        tls_srv.socket = ctx2.wrap_socket(tls_srv.socket, server_side=True)
        threading.Thread(target=tls_srv.serve_forever, daemon=True).start()
        print("dashboard (TLS): https://%s:%d/dash" % (ip, a.tls_port))
    print("dashboard    : %s://%s:%d/dash" % (scheme, ip, a.port))
    print("controls     : %s://%s:%d/control" % (scheme, ip, a.port))
    print("heartbeat log: %s" % LOG, flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


# served at /sample.ics; the demo data (demo/work/sources.json) uses it as its calendar
SAMPLE_ICS = """BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
SUMMARY:One-off event\r
DTSTART;TZID=America/Chicago:20261120T100000\r
DTEND;TZID=America/Chicago:20261120T110000\r
END:VEVENT\r
BEGIN:VEVENT\r
SUMMARY:Weekly standup\r
DTSTART;TZID=America/Chicago:20260105T093000\r
DTEND;TZID=America/Chicago:20260105T094500\r
RRULE:FREQ=WEEKLY;BYDAY=MO,WE\r
END:VEVENT\r
BEGIN:VEVENT\r
SUMMARY:All day thing\r
DTSTART;VALUE=DATE:20261124\r
END:VEVENT\r
END:VCALENDAR\r
"""


def _unfold(text):
    return re.sub(r"\r?\n[ \t]", "", text)


def _field(block, name):
    m = re.search(r"^" + name + r"(?:;[^:]*)?:(.*)$", block, re.M)
    return m.group(1).strip() if m else None


def _raw(block, name):
    """Return (params, value) for a property."""
    m = re.search(r"^(" + name + r"(?:;[^:]*)?):(.*)$", block, re.M)
    if not m:
        return None, None
    return m.group(1), m.group(2).strip()


def _parse_dt(val):
    if not val:
        return None, False
    v = val.strip()
    if re.fullmatch(r"\d{8}", v):
        return "%s-%s-%s" % (v[0:4], v[4:6], v[6:8]), True
    m = re.fullmatch(r"(\d{8})T(\d{6})(Z?)", v)
    if m:
        d, t, z = m.groups()
        iso = "%s-%s-%sT%s:%s:%s" % (d[0:4], d[4:6], d[6:8], t[0:2], t[2:4], t[4:6])
        return (iso + "Z" if z else iso), False
    return None, False


def _local_naive(val, params):
    """Parse a DTSTART/EXDATE-style value into a naive datetime in the Mac's local time.
    Handles UTC (Z), TZID=..., floating times and VALUE=DATE."""
    v = (val or "").strip()
    if re.fullmatch(r"\d{8}", v):
        return datetime.strptime(v, "%Y%m%d"), True
    m = re.fullmatch(r"(\d{8}T\d{6})(Z?)", v)
    if not m:
        return None, False
    dt = datetime.strptime(m.group(1), "%Y%m%dT%H%M%S")
    try:
        from datetime import timezone
        if m.group(2):
            return dt.replace(tzinfo=timezone.utc).astimezone().replace(tzinfo=None), False
        tz = re.search(r"TZID=([^;:]+)", params or "")
        if tz:
            from zoneinfo import ZoneInfo
            return dt.replace(tzinfo=ZoneInfo(tz.group(1).strip('"'))).astimezone().replace(tzinfo=None), False
    except Exception:
        pass
    return dt, False


def _all_raw(block, name):
    return re.findall(r"^(" + name + r"(?:;[^:]*)?):(.*)$", block, re.M)


def _to_dt(iso, all_day):
    if not iso:
        return None
    try:
        if all_day:
            return datetime.strptime(iso, "%Y-%m-%d")
        return datetime.fromisoformat(iso.replace("Z", ""))
    except Exception:
        return None


def _rrule_expand(rule, dtstart, cursor, window_end, limit=400):
    """Small RRULE expander (no dateutil needed): DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL,
    BYDAY (incl. 2TU / -1FR), BYMONTHDAY and BYMONTH. Returns starts within [cursor, window_end]."""
    import calendar
    P = dict(kv.split("=", 1) for kv in rule.split(";") if "=" in kv)
    freq, iv = P.get("FREQ", "").upper(), max(1, int(P.get("INTERVAL", "1") or 1))
    count = int(P["COUNT"]) if P.get("COUNT", "").isdigit() else None
    until = None
    if P.get("UNTIL"):
        u = P["UNTIL"]
        until = datetime.strptime(u[:15], "%Y%m%dT%H%M%S") if "T" in u else datetime.strptime(u[:8], "%Y%m%d").replace(hour=23, minute=59, second=59)
    days = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
    byday = [(int(m.group(1) or 0), days.index(m.group(2))) for m in (re.match(r"([+-]?\d*)(MO|TU|WE|TH|FR|SA|SU)$", x.strip().upper()) for x in P.get("BYDAY", "").split(",") if x.strip()) if m]
    bymd = [int(x) for x in P.get("BYMONTHDAY", "").split(",") if x.strip().lstrip("-").isdigit()]
    bymon = [int(x) for x in P.get("BYMONTH", "").split(",") if x.strip().isdigit()] or None
    t = (dtstart.hour, dtstart.minute, dtstart.second)

    def at(d):
        return datetime(d.year, d.month, d.day, *t)

    def month_days(y, m):
        n = calendar.monthrange(y, m)[1]
        out = set()
        for x in bymd:
            if 1 <= abs(x) <= n:
                out.add(x if x > 0 else n + 1 + x)
        for nth, wd in byday:
            ds = [d for d in range(1, n + 1) if datetime(y, m, d).weekday() == wd]
            if nth == 0:
                out.update(ds)
            elif 1 <= abs(nth) <= len(ds):
                out.add(ds[nth - 1] if nth > 0 else ds[nth])
        if not out:
            out.add(dtstart.day) if dtstart.day <= n else None
        return sorted(out)

    def periods():
        if freq == "DAILY":
            d = dtstart
            while True:
                yield [d]
                d += timedelta(days=iv)
        elif freq == "WEEKLY":
            wk = dtstart - timedelta(days=dtstart.weekday())
            wds = sorted({wd for _, wd in byday}) or [dtstart.weekday()]
            while True:
                yield [at(wk + timedelta(days=w)) for w in wds]
                wk += timedelta(weeks=iv)
        elif freq == "MONTHLY":
            y, m = dtstart.year, dtstart.month
            while True:
                yield [datetime(y, m, d, *t) for d in month_days(y, m)]
                m += iv
                y, m = y + (m - 1) // 12, (m - 1) % 12 + 1
        elif freq == "YEARLY":
            y = dtstart.year
            while True:
                out = []
                for m in (bymon or [dtstart.month]):
                    if byday or bymd:
                        out += [datetime(y, m, d, *t) for d in month_days(y, m)]
                    elif dtstart.day <= calendar.monthrange(y, m)[1]:
                        out.append(datetime(y, m, dtstart.day, *t))
                yield sorted(out)
                y += iv
        else:
            yield [dtstart]
            return

    res, n, guard = [], 0, 0
    for group in periods():
        guard += 1
        if guard > 100000:
            break
        for o in group:
            if o < dtstart or (bymon and o.month not in bymon):
                continue
            if (until and o > until) or o > window_end or (count is not None and n >= count):
                return res
            n += 1
            if o >= cursor:
                res.append(o)
                if len(res) >= limit:
                    return res
    return res


def parse_ics(text, horizon_days=45, past_days=35):
    """Parse VEVENTs, expanding RRULE recurrences within the horizon."""
    text = _unfold(text)
    out = []
    now = datetime.now() - timedelta(days=past_days)     # keep recent past too, for the month page
    window_end = datetime.now() + timedelta(days=horizon_days)

    blocks = re.findall(r"BEGIN:VEVENT(.*?)END:VEVENT", text, re.S)
    # (uid, local start) of every instance that has its own override block (moved or cancelled)
    overridden = set()
    for block in blocks:
        params, rid = _raw(block, "RECURRENCE-ID")
        if rid:
            when, _ = _local_naive(rid, params)
            if when:
                overridden.add(((_field(block, "UID") or ""), when))

    for block in blocks:
        if (_field(block, "STATUS") or "").upper() == "CANCELLED":
            continue
        summary = _field(block, "SUMMARY") or "(untitled)"
        summary = summary.replace("\\,", ",").replace("\\n", " ").replace("\\;", ";")
        uid = _field(block, "UID") or ""
        sparams, sval = _raw(block, "DTSTART")
        start_dt, all_day = _local_naive(sval, sparams)
        eparams, evalue = _raw(block, "DTEND")
        end_dt, _ = _local_naive(evalue, eparams)
        if not start_dt:
            continue
        excluded = set()
        for xparams, xval in _all_raw(block, "EXDATE"):
            for part in xval.split(","):
                when, _ = _local_naive(part.strip(), xparams)
                if when:
                    excluded.add(when.date() if all_day else when)
        duration = (end_dt - start_dt) if (start_dt and end_dt) else timedelta(days=1)
        if not end_dt and not all_day:
            duration = timedelta(hours=1)
        if duration.total_seconds() < 0:
            duration = timedelta(hours=1)

        _, rrule_val = _raw(block, "RRULE")
        occurrences = []
        if rrule_val and start_dt:
            try:
                from dateutil.rrule import rrulestr
                # dtstart is naive local time, so UNTIL must be naive too (dateutil rejects a mix)
                def _until(m):
                    u, _ = _local_naive(m.group(1), "")
                    return "UNTIL=" + (u.strftime("%Y%m%d") if len(m.group(1)) == 8 else u.strftime("%Y%m%dT%H%M%S")) if u else m.group(0)
                rrule_val = re.sub(r"UNTIL=([0-9TZ]+)", _until, rrule_val)
                rule = rrulestr("RRULE:" + rrule_val, dtstart=start_dt)
                cursor = max(start_dt, now - duration)
                for occ in rule.xafter(cursor, count=150, inc=True):
                    if occ > window_end:
                        break
                    occurrences.append(occ)
            except Exception:                       # no dateutil (e.g. the Mac's stock python3): use the built-in expander
                try:
                    occurrences = _rrule_expand(rrule_val, start_dt, max(start_dt, now - duration), window_end)
                except Exception:
                    occurrences = [start_dt] if start_dt >= now - duration else []
        else:
            if start_dt and (start_dt + duration) >= now - timedelta(hours=1):
                occurrences = [start_dt]

        if rrule_val:
            occurrences = [o for o in occurrences
                           if (o.date() if all_day else o) not in excluded and (uid, o) not in overridden]
        for occ in occurrences:
            end_occ = occ + duration
            out.append({
                "summary": summary,
                "start": occ.strftime("%Y-%m-%dT%H:%M:%S") if not all_day else occ.strftime("%Y-%m-%d"),
                "end": end_occ.strftime("%Y-%m-%dT%H:%M:%S") if not all_day else None,
                "allDay": all_day,
                "location": _field(block, "LOCATION"),
            })

    out.sort(key=lambda e: e["start"])
    return out[:600]


if __name__ == "__main__":
    main()
