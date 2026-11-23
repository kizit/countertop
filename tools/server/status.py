"""Health, the update notice and the diagnostics bundle (Controls > Status)."""
import io
import json
import os
import platform
import re
import sys
import threading
import time
import zipfile
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen


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
        mods = config_load()["modules"]
    except Exception:
        mods = {}
    g = (mods.get("general") or {}).get("settings") or {}
    work = WORK
    writable = os.access(work, os.W_OK) if work.exists() else os.access(work.parent, os.W_OK)
    if not writable:
        probs.append(["bad", "The server can't save settings: the data folder isn't writable. Check its owner (Docker: PUID/PGID, Unraid: 99:100)."])
    if not (g.get("lat") or g.get("lon")):
        probs.append(["warn", "Set your location so the weather can load."])
    lan = sorted({str(t.get("name") or "Your own tile")[:60] for t in lan_tiles(mods)})
    if lan:
        one = len(lan) == 1
        probs.append(["warn", "%s can reach plain http:// addresses, including devices on your home network. %s made before Your own tiles were "
                              "limited to https:// addresses, so %s kept that access. Keep %s only if you wrote %s or trust whoever did." % (
                                  ", ".join("\u201c%s\u201d" % n for n in lan), "It was" if one else "They were",
                                  "it" if one else "they", "it" if one else "them", "it" if one else "them")])
    probs.extend(sandbox.sandbox_problems())
    if CONFIG_PROBLEM.get("stuck"):
        probs.append(["bad", "The settings file can't be read, and the server couldn't move it aside, so changes aren't being saved. "
                             "Check the data folder: " + CONFIG_PROBLEM["stuck"]])
    elif CONFIG_PROBLEM.get("kept"):
        probs.append(["warn", "The settings file couldn't be read, so it was kept as %s in the data folder and %s." % (
            CONFIG_PROBLEM["kept"], "your last backup (%s) was put back" % CONFIG_PROBLEM["restored"]
            if CONFIG_PROBLEM["restored"] else "Countertop started fresh. No backup was found")])

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
        "bench": bench.summary(),
        "sandbox": sandbox.sandbox_status(),
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
    out.update(saved_key_values())          # community tiles' API keys
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
        fields = _secret_fields(kind)
        for it in items or []:
            o = {k: v for k, v in it.items() if k not in fields}
            if it.get("url"):
                o["url"] = "set (%s)" % (urlparse(it["url"].replace("webcal://", "https://")).hostname or "?")
            for f in fields:
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


# names used only inside functions: imported last, so these modules can use each other
from server import bench, sandbox  # noqa: E402
from server.config import CONFIG_PROBLEM, SERVER_START, config_load, lan_tiles  # noqa: E402
from server.core import CAL_STATUS, CONSOLE, HERE, LOG, REPO, SCREEN, VERSION, WORK  # noqa: E402
from server.feeds.meals import MEAL_STATUS  # noqa: E402
from server.homeassistant import HA_STATUS  # noqa: E402
from server.lists import notes_view  # noqa: E402
from server.sources import SOURCE_KINDS, sources_load  # noqa: E402
from server.tilekeys import saved_key_values  # noqa: E402
