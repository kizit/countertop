"""Community tiles: the sandbox they run in, and safe mode.

A community tile is one file in the data folder, community/tiles/<id>.json: what it is (name, size, settings, the
shared data it reads, the sites it reads from) and its code. The dashboard shows each one in its own frame, served
here at /tile-frame/<id>, which runs with an opaque origin and no network of its own (two locks: the frame's sandbox
attribute and this page's Content-Security-Policy). Everything the tile gets comes from the dashboard over
postMessage, and web addresses come only through /tile-fetch, for the sites it declared.

Personal data or the internet, never both: a tile that reads events, lists, photos or sales gets no sites at all.

Safe mode turns every community tile off. The person can switch it in Controls → Status, and the server turns it on
by itself when a screen showing a community tile goes quiet for 30 seconds (an endless loop in a frame freezes the
whole page on the Echo, so the page can't save itself), or when a screen reloads 3 times in 10 minutes with
community tiles on it and nothing changed in between.
"""
import collections
import json
import re
import secrets
import threading
import time

from server.core import HERE, WORK

TILES_DIR = WORK / "community" / "tiles"
SAFE_FILE = WORK / "safe-mode.json"
RUNTIME_DIR = HERE / "sandbox"
MAX_FRAMES = 6                 # frames a screen runs at once (the Echo test: 6 stay smooth, 12 don't)
BEAT_EVERY = 5                 # seconds between the dashboard's check-ins while a community tile shows
SILENT_FOR = 30                # seconds of quiet after which the server decides the screen froze
SBX_RELOADS, SBX_RELOAD_WINDOW = 3, 600
SBX_MAX_CODE = 64 * 1024

SBX_FEEDS = ("wx", "aqi", "events", "notes", "team", "photos", "sales")
SBX_PERSONAL = ("events", "notes", "photos", "sales")      # what a household would mind leaving the house
SBX_SETTING_TYPES = ("bool", "int", "number", "text", "list", "choice", "color", "source")
SBX_SOURCE_KINDS = {"calendars": "events", "teams": "team", "lists": "notes", "albums": "photos"}
SBX_ID_RE = re.compile(r"^[a-z][a-z0-9-]{1,39}$")
SBX_SLOT_RE = re.compile(r"^[a-z][a-z0-9_]{0,19}$")
SBX_MAX_DEVICES, SBX_MAX_CONTROLS = 8, 12
SBX_SECURE_DOMAINS = ("lock", "alarm_control_panel", "cover")    # can hold a lock, an alarm or a garage door

SBX_FRAME_POLICY = ("sandbox allow-scripts; default-src 'none'; script-src 'nonce-%s'; style-src 'unsafe-inline'; "
                "img-src data: blob:; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; "
                "frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'")
SBX_OFF_POLICY = "sandbox; default-src 'none'; style-src 'unsafe-inline'"

SBX_LOCK = threading.Lock()
SBX_CACHE = {"sig": None, "tiles": {}, "problems": []}


def builtin_types():
    return {f.stem for f in (HERE / "tiles").glob("*.js")}


def builtin_hosts(type_):
    """The sites a built-in tile declares (`hosts:[...]` in tools/tiles/<type>.js), for its /tile-fetch."""
    from server.tilefetch import clean_hosts
    f = HERE / "tiles" / (type_ + ".js")
    if not re.fullmatch(r"[a-z0-9]+", type_ or "") or not f.is_file():
        return None
    m = re.search(r"\bhosts:\s*\[([^\]]*)\]", f.read_text(encoding="utf-8"))
    return clean_hosts(re.findall(r"""["']([^"']+)["']""", m.group(1))) if m else []


def _sbx_plain(v, depth=0):
    """JSON values only (no surprises from a file someone else wrote), cut down to a sensible size."""
    if isinstance(v, bool) or v is None or isinstance(v, int):
        return v
    if isinstance(v, float):
        return v if v == v and abs(v) < 1e15 else None
    if isinstance(v, str):
        return v[:4000]
    if depth < 6 and isinstance(v, list):
        return [_sbx_plain(x, depth + 1) for x in v[:200]]
    if depth < 6 and isinstance(v, dict):
        return {str(k)[:60]: _sbx_plain(x, depth + 1) for k, x in list(v.items())[:200]}
    return None


def clean_tile(raw, builtins=None):
    """A community tile file checked and cut down to what the dashboard uses; ValueError says what's wrong."""
    from server.tilefetch import clean_hosts
    if not isinstance(raw, dict) or raw.get("countertop") != "tile":
        raise ValueError("isn't a Countertop tile")
    tid = raw.get("id")
    if not isinstance(tid, str) or not SBX_ID_RE.match(tid):
        raise ValueError("its id must be 2 to 40 lower-case letters, digits or dashes")
    if tid in (builtin_types() if builtins is None else builtins):
        raise ValueError("its id is the same as a built-in tile's")
    code = raw.get("code")
    if not isinstance(code, str) or not code.strip():
        raise ValueError("has no code")
    if len(code.encode("utf-8")) > SBX_MAX_CODE:
        raise ValueError("its code is larger than 64 KB")
    version = raw.get("version")
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        raise ValueError("needs a version number")
    size = raw.get("size") if isinstance(raw.get("size"), list) else [12, 8, 8, 6]
    if len(size) != 4 or not all(isinstance(n, int) and not isinstance(n, bool) and 2 <= n <= 48 for n in size):
        raise ValueError("its size must be [width, height, min width, min height] on the 48x32 grid")
    feeds = [f for f in raw.get("feeds") or [] if f in SBX_FEEDS] if isinstance(raw.get("feeds"), list) else []
    if isinstance(raw.get("feeds"), list) and len(feeds) != len(raw["feeds"]):
        raise ValueError("it asks for data that doesn't exist: %s" % ", ".join(str(f) for f in raw["feeds"] if f not in SBX_FEEDS)[:80])
    hosts = clean_hosts(raw.get("hosts"))
    if isinstance(raw.get("hosts"), list) and len(hosts) != len(raw["hosts"]):
        raise ValueError("its sites must be public names like api.example.com, not addresses")
    settings = {}
    for k, s in (raw.get("settings") or {}).items() if isinstance(raw.get("settings"), dict) else []:
        if not re.fullmatch(r"[A-Za-z_]\w{0,30}", str(k)) or not isinstance(s, dict) or s.get("type") not in SBX_SETTING_TYPES:
            raise ValueError("setting %s isn't one Countertop knows" % str(k)[:30])
        if s["type"] == "source" and SBX_SOURCE_KINDS.get(s.get("kind")) not in feeds:
            raise ValueError("setting %s picks %s, which needs the matching data in feeds" % (k, str(s.get("kind"))[:20]))
        settings[k] = _sbx_plain(s)
    every = raw.get("every")
    devices, controls = clean_controls(raw)
    # the state of things in the house is personal data too
    personal = [f for f in feeds if f in SBX_PERSONAL] + (["devices"] if devices else [])
    return {
        "id": tid, "type": tid, "version": version,
        "title": str(raw.get("name") or raw.get("title") or tid)[:60],
        "desc": str(raw.get("description") or raw.get("desc") or "")[:400],
        "author": str(raw.get("author") or "")[:39],
        "size": size, "feeds": feeds, "settings": settings,
        "uses": [u for u in raw.get("uses") or [] if u in ("store", "fetch", "events", "sources", "feed")] if isinstance(raw.get("uses"), list) else [],
        # personal data or the internet, never both: a tile that reads personal data gets no sites
        "hosts": [] if personal else hosts, "hostsDropped": bool(personal and hosts), "personal": personal,
        "taps": raw.get("taps") is True,
        "devices": devices, "controls": controls,
        "every": every if isinstance(every, int) and not isinstance(every, bool) and 1 <= every <= 86400 else 0,
        "demo": _sbx_plain(raw.get("demo")) if isinstance(raw.get("demo"), dict) else {},
        "demoData": _sbx_plain(raw.get("demoData")) if isinstance(raw.get("demoData"), dict) else {},
        "lang": _sbx_plain(raw.get("lang")) if isinstance(raw.get("lang"), dict) else {},
        "code": code,
    }


def clean_controls(raw):
    """A control tile's `devices` (the kinds of thing it can work: {slot: {label, domains}}) and `controls` (one
    button each: [{id, device, action, data}]), checked. The tile's code never sends an action: the dashboard draws
    these buttons outside the frame, and the person picks which real device fills each slot (server/controls.py)."""
    from server.homeassistant import HA_ACTIONS, HA_DATA_KEYS
    rd, rc = raw.get("devices"), raw.get("controls")
    if rd is None and rc is None:
        return {}, []
    if not isinstance(rd, dict) or not rd or len(rd) > SBX_MAX_DEVICES:
        raise ValueError("its devices must list 1 to %d kinds of thing it controls" % SBX_MAX_DEVICES)
    devices = {}
    for k, d in rd.items():
        if not SBX_SLOT_RE.match(str(k)) or not isinstance(d, dict):
            raise ValueError("device %s needs a short lower-case name" % str(k)[:20])
        doms = d.get("domains")
        if not isinstance(doms, list) or not doms or not all(isinstance(x, str) and x in HA_ACTIONS for x in doms):
            raise ValueError("device %s must list the Home Assistant kinds it works with, like light or switch" % k)
        devices[k] = {"label": str(d.get("label") or k)[:40], "domains": sorted(set(doms)),
                      "secure": any(x in SBX_SECURE_DOMAINS for x in doms)}
    if not isinstance(rc, list) or not rc or len(rc) > SBX_MAX_CONTROLS:
        raise ValueError("its controls must list 1 to %d buttons" % SBX_MAX_CONTROLS)
    controls, seen = [], set()
    for c in rc:
        if not isinstance(c, dict) or not SBX_SLOT_RE.match(str(c.get("id") or "")) or c["id"] in seen:
            raise ValueError("each control needs its own short lower-case id")
        seen.add(c["id"])
        dev = devices.get(str(c.get("device") or ""))
        if not dev:
            raise ValueError("control %s names a device the tile doesn't list" % c["id"])
        action = c.get("action")
        if not isinstance(action, str) or not all(action in HA_ACTIONS[x] for x in dev["domains"]):
            raise ValueError("control %s: %s isn't something every kind of thing in its device can do" % (c["id"], str(action)[:30]))
        data = c.get("data") if c.get("data") is not None else {}
        if not isinstance(data, dict) or any(k not in HA_DATA_KEYS or k == "code" or not isinstance(v, (int, float, str, bool)) or (isinstance(v, str) and len(v) > 60) for k, v in data.items()):
            raise ValueError("control %s sends data Countertop doesn't pass on" % c["id"])
        controls.append({"id": c["id"], "device": c["device"], "action": action, "data": dict(data)})
    return devices, controls


def community_installed():
    """{"tiles": {id: tile}, "problems": [[file, why]]} for community/tiles/*.json, read again when a file changes."""
    try:
        files = sorted(TILES_DIR.glob("*.json"))
        sig = tuple((f.name, f.stat().st_mtime_ns, f.stat().st_size) for f in files)
    except OSError:
        files, sig = [], ()
    with SBX_LOCK:
        if SBX_CACHE["sig"] == sig:
            return SBX_CACHE
        tiles, problems, builtins = {}, [], builtin_types()
        for f in files:
            try:
                t = clean_tile(json.loads(f.read_text(encoding="utf-8")), builtins)
                if t["id"] != f.stem:
                    raise ValueError("its file must be named %s.json" % t["id"])
                tiles[t["id"]] = t
            except (OSError, ValueError) as e:
                problems.append([f.name, str(e)[:160]])
        SBX_CACHE.update(sig=sig, tiles=tiles, problems=problems)
        return SBX_CACHE


def community_tile(tid):
    return community_installed()["tiles"].get(tid)


def tile_hosts(type_):
    """The sites /tile-fetch may read for this kind of tile, or None when it isn't a tile that may fetch."""
    t = community_tile(type_)
    if t:
        return None if safe_mode()["on"] else t["hosts"]
    return builtin_hosts(type_)


def sandbox_view():
    """What /config tells the dashboard: safe mode, and each community tile without its code."""
    s = safe_mode()
    return {"safe": s["on"], "max": MAX_FRAMES, "beat": BEAT_EVERY,
            "tiles": {k: {x: v for x, v in t.items() if x != "code"} for k, t in community_installed()["tiles"].items()}}


def sandbox_version():
    """Changes when a community tile is added, changed or removed, or someone switches safe mode in Status: the screen
    reloads then. Safe mode turning itself on doesn't reload the screen: a frozen page can't, and a page that was only
    cut off for a while gets the chance to check in again and turn it back off."""
    sig = community_installed()["sig"] or ()
    return sum(n[1] // 1_000_000_000 + n[2] for n in sig) % 1_000_000 + safe_mode()["gen"]


# ---------- the frame page ----------
def _sbx_read(name):
    return (RUNTIME_DIR / name).read_text(encoding="utf-8")


def tile_frame_page(tid):
    """(status, html, headers) for /tile-frame/<id>: the runtime, then the tile's code, both allowed by a fresh nonce."""
    t = community_tile(tid) if isinstance(tid, str) and SBX_ID_RE.match(tid) else None
    if not t:
        return 404, b"no such tile", {}
    if safe_mode()["on"]:
        body = '<!doctype html><meta charset="utf-8"><style>body{margin:0;color:#ccc;font:16px sans-serif}</style><p>Off: safe mode is on.</p>'
        return 200, body.encode("utf-8"), {"Content-Security-Policy": SBX_OFF_POLICY}
    nonce = secrets.token_hex(16)
    html = (_sbx_read("frame.html").replace("__RUNTIME__", _sbx_read("runtime.js"))
            .replace("__CODE__", "/tile-frame/%s/tile.js?v=%d" % (t["id"], t["version"]))
            .replace("__NONCE__", nonce))
    return 200, html.encode("utf-8"), {"Content-Security-Policy": SBX_FRAME_POLICY % nonce, "X-Content-Type-Options": "nosniff",
                                       "Referrer-Policy": "no-referrer"}


def tile_frame_code(tid):
    """(status, js) for /tile-frame/<id>/tile.js. Nothing in safe mode."""
    t = community_tile(tid) if isinstance(tid, str) and SBX_ID_RE.match(tid) else None
    if not t or safe_mode()["on"]:
        return 404, b"// off"
    return 200, t["code"].encode("utf-8")


# ---------- safe mode ----------
def safe_mode():
    try:
        d = json.loads(SAFE_FILE.read_text())
        if isinstance(d, dict):
            return {"on": d.get("on") is True, "why": str(d.get("why") or ""), "tiles": [str(x)[:60] for x in d.get("tiles") or []][:10],
                    "at": d.get("at") or 0, "by": str(d.get("by") or ""), "gen": d.get("gen") if isinstance(d.get("gen"), int) else 0}
    except (OSError, ValueError):
        pass
    return {"on": False, "why": "", "tiles": [], "at": 0, "by": "", "gen": 0}


def set_safe_mode(on, why="", tiles=(), by="", reload=True):
    """Turn safe mode on or off. `why` is "person", "froze" or "reloads". `reload` makes the screens start again."""
    gen = safe_mode()["gen"] + (1 if reload else 0)
    with SBX_LOCK:
        WORK.mkdir(parents=True, exist_ok=True)
        tmp = SAFE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps({"on": bool(on), "why": why if on else "", "tiles": list(tiles)[:10] if on else [],
                                   "at": int(time.time()), "by": by if on else "", "gen": gen}))
        tmp.replace(SAFE_FILE)
        if not on:
            SBX_BOOTS.clear()
    if on:
        print("Safe mode on (%s)%s" % (why, ": " + ", ".join(tiles) if tiles else ""), flush=True)
    return safe_mode()


SBX_SESSIONS = {}          # page session -> {"at", "showing": [tile names], "ip", "tripped"}
SBX_BOOTS = collections.deque(maxlen=20)        # (time, version) of each dashboard start with community tiles on it
SBX_NOTES = collections.deque(maxlen=20)        # things Status mentions: a tile stopped for leaving its frame, a page over the limit
SBX_SESSION_RE = re.compile(r"^[A-Za-z0-9_-]{4,40}$")


def _names(v):
    return [str(x)[:60] for x in v[:20]] if isinstance(v, list) else []


def sandbox_beat(body, ip, version, now=None):
    """A check-in from a dashboard: {"session", "showing": [names], "gap": ms, "boot": bool, "clean": bool, "notes": [...]}.
    A page that closes normally (to Controls, or reloading after a settings change) checks in once more showing
    nothing, so its silence afterwards isn't taken for a freeze, and the next start says `clean`: not a restart.
    `gap` is the longest pause the page's own timers saw since the last check-in, so a page that was stuck can be told
    from a network that dropped for a while."""
    now = time.time() if now is None else now
    if not isinstance(body, dict) or not SBX_SESSION_RE.match(str(body.get("session") or "")):
        raise ValueError("bad check-in")
    sid = body["session"]
    with SBX_LOCK:
        prev = SBX_SESSIONS.get(sid)
        if prev and prev.get("bye"):
            # a check-in still on its way when the page closed: the goodbye already came, the page is gone
            return {"safe": safe_mode()["on"]}
        SBX_SESSIONS[sid] = {"at": now, "showing": [] if body.get("bye") else _names(body.get("showing")), "ip": ip, "tripped": False,
                             "bye": body.get("bye") is True}
        for n in [str(x)[:200] for x in body.get("notes")[:5]] if isinstance(body.get("notes"), list) else []:
            if not any(x["text"] == n for x in SBX_NOTES):
                SBX_NOTES.append({"at": now, "text": n})
        if body.get("boot") and not body.get("clean"):        # a start after the last page closed normally isn't a restart
            SBX_BOOTS.append((now, version))
    s = safe_mode()
    if prev and prev.get("tripped") and s["on"] and s["why"] == "froze" and s["by"] == sid:
        try:
            gap = float(body.get("gap") or 0)
        except (TypeError, ValueError):
            gap = 0
        if gap < 20000:
            # the same page is back, and its timers never stopped: the connection dropped, the screen didn't freeze
            s = set_safe_mode(False)
            SBX_NOTES.append({"at": now, "text": "A screen stopped checking in for a while, but it hadn't frozen, so community tiles were turned back on."})
    if body.get("boot") and not body.get("clean") and not s["on"]:
        with SBX_LOCK:
            same = [t for t, v in SBX_BOOTS if now - t < SBX_RELOAD_WINDOW and v == version]
        if len(same) >= SBX_RELOADS:
            s = set_safe_mode(True, "reloads", _names(body.get("onPage")), sid, reload=False)
    return {"safe": s["on"]}


def safe_freeze_check(now=None):
    """Called every few seconds: a screen that was showing a community tile and has gone quiet has frozen."""
    now = time.time() if now is None else now
    with SBX_LOCK:
        quiet = [(sid, s) for sid, s in SBX_SESSIONS.items() if s["showing"] and not s["tripped"] and now - s["at"] > SILENT_FOR]
        for sid, s in SBX_SESSIONS.items():
            if not s["showing"] and now - s["at"] > 86400:
                s["gone"] = True
        for sid in [k for k, s in SBX_SESSIONS.items() if s.get("gone") or (s["tripped"] and now - s["at"] > 600)]:
            del SBX_SESSIONS[sid]
        for sid, s in quiet:
            s["tripped"] = True
    if quiet and not safe_mode()["on"]:
        sid, s = quiet[0]
        set_safe_mode(True, "froze", s["showing"], sid, reload=False)
    return bool(quiet)


def safe_loop():
    while True:
        time.sleep(BEAT_EVERY)
        try:
            safe_freeze_check()
        except Exception as e:
            print("safe mode check failed: %s" % e, flush=True)


def sandbox_status():
    """For Controls → Status: None when no community tile is installed and safe mode is off, so most people never see it."""
    inst, s = community_installed(), safe_mode()
    if not inst["tiles"] and not inst["problems"] and not s["on"]:
        return None
    now = time.time()
    return {"safe": s["on"], "why": s["why"], "tiles": s["tiles"], "since": s["at"], "installed": len(inst["tiles"]),
            "problems": inst["problems"], "notes": [n["text"] for n in SBX_NOTES if now - n["at"] < 86400][-5:],
            "showing": sorted({n for x in SBX_SESSIONS.values() if now - x["at"] < 60 for n in x["showing"]})}


def sandbox_problems():
    """[level, text] lines for the top of Status."""
    st = sandbox_status()
    if not st:
        return []
    out = []
    if st["safe"]:
        names = ", ".join("“%s”" % n for n in st["tiles"])
        out.append(["warn", {
            "froze": "Community tiles are off: the screen stopped answering while %s was showing. Restart the browser on the screen if it's still stuck, then turn community tiles back on in Status when you're ready." % (names or "a community tile"),
            "reloads": "Community tiles are off: the screen restarted 3 times in 10 minutes with %s on it. Turn them back on in Status when you're ready." % (names or "community tiles"),
        }.get(st["why"], "Community tiles are off (safe mode). Turn them back on in Status.")])
    for f, why in st["problems"]:
        out.append(["warn", "The community tile in %s can't be used: %s." % (f, why)])
    for n in st["notes"]:
        out.append(["warn", n])
    return out
