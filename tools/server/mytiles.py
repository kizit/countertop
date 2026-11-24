"""Tile Studio: tiles you make yourself, and what became of Your own tile.

A Tile Studio tile is the same file a community tile is (server/sandbox.py runs both the same way), saved in the data
folder as mytiles/my-<name>.json, with a `mine` note: {from, made, saved, review, backup}.
  from    "studio" (made in Tile Studio), "custom" (converted from a Your own tile) or "import" (came in a shared file)
  review  true until the person says code that came from someone else may run (the trust prompt)
  backup  for a converted Your own tile: {"item": the tile exactly as it was, "lan": whether it could reach the home
          network}. Restore puts it back.

Your own tile is retired. Its code was a whole web page in a frame of its own; a converted one keeps that page, run in
the sandbox: the page is put in the tile, its scripts run in order, `onclick="…"` and the like become listeners, fetch()
reads the tile's sites through the server and pictures from them come through the server too. `precheck` decides
whether a page will still work that way. Ones that will convert by themselves when settings are saved (which the
settings upgrade does once); the rest stay as they are, still working, with the reasons in their settings and a Convert
button that converts them anyway.
"""
import hashlib
import json
import re
import threading
import time
from urllib.parse import urlsplit

from server.sandbox import MINE_DIR, MINE_PREFIX, SBX_ID_RE, SBX_MAX_CODE, builtin_types, clean_tile, community_installed
from server.tilefetch import FETCH_HOST_RE
from server.tilekeys import forget_keys

MINE_LOCK = threading.RLock()
CUSTOM_SIZE = [12, 8, 4, 4]          # Your own tile's size


# ---------- will an old Your own tile work in the sandbox? ----------
_URL_RE = re.compile(r"""(?i)\b(https?)://([^\s"'`<>()\\/?#]+)""")
_LOCAL_NAMES = (".local", ".lan", ".home", ".internal", ".arpa", ".localdomain", ".home.arpa", ".test", ".invalid", ".localhost")
CHECKS = [
    (r"(?is)<script\b[^>]*\bsrc\s*=", "It loads scripts from the web"),
    (r"(?is)<script\b[^>]*\btype\s*=\s*[\"']?module", "It uses JavaScript modules"),
    (r"(?is)<link\b[^>]*\bhref\s*=\s*[\"']?(?:https?:)?//", "It loads styles or fonts from the web"),
    (r"(?i)@import\b", "It loads styles or fonts from the web"),
    (r"(?i)url\(\s*[\"']?\s*(?:https?:)?//", "Its styles use pictures or fonts from the web"),
    (r"(?is)<(?:i?frame|frameset|object|embed|portal)\b", "It contains a frame or an embed"),
    (r"(?is)<(?:video|audio|source|track)\b[^>]*\bsrc\s*=\s*[\"']?(?:https?:)?//", "It plays video or sound from the web"),
    (r"(?is)<a\b[^>]*\bhref\s*=\s*[\"']?(?:https?:)?//", "It has links that open web pages"),
    (r"(?i)\bdocument\s*\.\s*(?:write|writeln|open)\s*\(", "It writes its page with document.write"),
    (r"\bXMLHttpRequest\b", "It reads sites with XMLHttpRequest"),
    (r"\b(?:WebSocket|EventSource|sendBeacon)\b", "It keeps a live connection to a site"),
    (r"(?i)\bmethod\s*:\s*[\"'`](?:POST|PUT|PATCH|DELETE)", "It sends data to a site"),
    (r"(?i)\bimport\s*\(", "It loads code while it runs"),
    (r"(?i)\b(?:location\s*\.\s*(?:href|assign|replace)|location\s*=|window\.open)\b", "It opens other pages"),
    (r"""(?i)["'(=]\s*//[a-z0-9]""", "It uses web addresses without https://"),
    (r"\b(?:eval|Function)\s*\(|\bset(?:Timeout|Interval)\s*\(\s*[\"'`]", "It runs code from text"),
]


def _local_host(h):
    if re.fullmatch(r"[0-9.]+|\[?[0-9a-f:]+\]?(:\d+)?", h, re.I) or ":" in h:
        return True
    return "." not in h or h.endswith(_LOCAL_NAMES)


def precheck(html):
    """{"ok", "reasons": [plain sentences], "hosts": [the https sites it reads]} for a Your own tile's code."""
    html = html if isinstance(html, str) else ""
    reasons, hosts = [], []
    add = lambda r: r not in reasons and reasons.append(r)
    if len(html.encode("utf-8")) > SBX_MAX_CODE - 4096:
        add("Its code is too large (more than 60 KB)")
    for scheme, host in _URL_RE.findall(html):
        host = host.lower().rstrip(".")
        if _local_host(host.split("@")[-1]):
            add("It reaches %s on your home network" % host)
        elif scheme.lower() == "http":
            add("It reads a plain http:// address (%s)" % host)
        elif not FETCH_HOST_RE.match(host):
            add("It reads %s, which isn't a site name Countertop can check" % host[:60])
        elif host not in hosts:
            hosts.append(host)
    for pat, why in CHECKS:
        if re.search(pat, html):
            add(why)
    if re.search(r"\bfetch\s*\(", html) and not hosts:
        add("It builds web addresses that can't be checked")
    if len(hosts) > 10:
        add("It reads more than 10 sites")
    return {"ok": not reasons, "reasons": reasons, "hosts": hosts[:10]}


# ---------- turning a Your own tile's page into a tile ----------
_SCRIPT_RE = re.compile(r"(?is)<script\b([^>]*)>(.*?)</script\s*>")
_TAG_RE = re.compile(r"(?s)<([a-zA-Z][\w:-]*)(\s[^<>]*?)?(/?)>")
_ON_RE = re.compile(r"""(?is)\s(on[a-z]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))""")


def _unescape(s):
    import html as _h
    return _h.unescape(s)


def page_code(tid, html):
    """The code of a converted tile: its page, its scripts in their order, and its on…= attributes as listeners."""
    html = html if isinstance(html, str) else ""
    scripts = []

    def take(m):
        if not re.search(r"(?i)\bsrc\s*=", m.group(1) or ""):
            scripts.append(m.group(2))
        return ""
    body = _SCRIPT_RE.sub(take, html)
    handlers = []

    def tag(m):
        attrs = m.group(2) or ""
        found = []

        def on(a):
            code = a.group(3) if a.group(3) is not None else a.group(4) if a.group(4) is not None else a.group(5)
            found.append((a.group(1).lower()[2:], _unescape(code)))
            return ""
        attrs = _ON_RE.sub(on, attrs)
        if not found:
            return m.group(0)
        n = len(handlers)
        handlers.append(found)
        return "<%s%s data-ct-on=\"%d\"%s>" % (m.group(1), attrs, n, m.group(3))
    body = _TAG_RE.sub(tag, body)
    # a "</script" inside the code would end nothing here (it's its own file), but keep the text the same either way
    lines = ["/* Converted from a Your own tile. Its page goes in the tile, then its scripts run in their order. */",
             "var CT_PAGE = %s;" % json.dumps(body),
             "document.getElementById(\"tile\").className = \"page\";",
             "document.getElementById(\"tile\").innerHTML = CT_PAGE;"]
    for n, found in enumerate(handlers):
        for ev, code in found:
            lines.append("(function (el) { if (el) el.addEventListener(%s, function (event) {\n%s\n}); })"
                         "(document.querySelector('[data-ct-on=\"%d\"]'));" % (json.dumps(ev), code, n))
    for s in scripts:
        lines.append(s.strip("\n"))
        lines.append(";")
    lines.append('Tile(%s, {\n  render(el) {\n'
                 '    var h = document.getElementById("ct-title");\n'
                 '    if (this.s.title && !h) { h = document.createElement("h3"); h.id = "ct-title"; el.insertBefore(h, el.firstChild); }\n'
                 '    if (h) { h.textContent = this.name; h.hidden = !this.s.title; }\n'
                 '    if (+this.s.every > 0) this.reloadIn(this.s.every * 60);\n'
                 '  }\n});' % json.dumps(tid))
    return "\n".join(lines) + "\n"


# ---------- the files ----------
def _path(tid):
    return MINE_DIR / (tid + ".json")


def read(tid):
    """A Tile Studio tile's file as saved, or None."""
    if not isinstance(tid, str) or not tid.startswith(MINE_PREFIX) or not SBX_ID_RE.match(tid):
        return None
    try:
        raw = json.loads(_path(tid).read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else None
    except (OSError, ValueError):
        return None


def _write(tid, raw):
    MINE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = MINE_DIR / (".%s.tmp" % tid)
    tmp.write_text(json.dumps(raw, indent=1, ensure_ascii=False), encoding="utf-8")
    tmp.replace(_path(tid))


def _slug(name):
    s = re.sub(r"[^a-z0-9]+", "-", str(name or "").lower()).strip("-")
    s = re.sub(r"^[^a-z]+", "", s)[:30].strip("-")
    return s or "tile"


def _new_id(name):
    taken = set(community_installed()["tiles"]) | builtin_types()
    base = MINE_PREFIX + re.sub(r"^my-(?=.)", "", _slug(name))
    tid, n = base, 1
    while tid in taken or _path(tid).exists():
        n += 1
        tid = "%s-%d" % (base[:37], n)
    return tid


FIELDS = ("name", "description", "author", "size", "uses", "feeds", "hosts", "taps", "every", "settings", "devices", "controls",
          "demo", "demoData", "lang", "code")


def public(raw):
    """The tile file without anything that's only about this Countertop (the note, the backup)."""
    return {k: raw[k] for k in ("countertop", "id", "version") + FIELDS if k in raw}


def save(body):
    """Tile Studio's Save: {id (empty for a new tile), tile: {name, code, …}}. Returns {id, version}."""
    tile = body.get("tile") if isinstance(body, dict) else None
    if not isinstance(tile, dict):
        raise ValueError("Nothing to save")
    with MINE_LOCK:
        tid = body.get("id") or ""
        old = read(tid) if tid else None
        if tid and not old:
            raise ValueError("That tile isn't one of yours any more")
        tid = tid or _new_id(tile.get("name"))
        now = int(time.time())
        raw = {k: tile[k] for k in FIELDS if k in tile}
        raw.update(countertop="tile", id=tid, version=(old or {}).get("version", 0) + 1 if old else 1)
        note = dict((old or {}).get("mine") or {}, saved=now)
        note.setdefault("from", "studio")
        note.setdefault("made", now)
        note.pop("review", None)            # saving it yourself is saying it may run
        raw["mine"] = note
        clean_tile(raw)                     # ValueError says what's wrong, before anything is written
        _write(tid, raw)
    print("Saved the tile %s (version %d)" % (tid, raw["version"]), flush=True)
    return {"id": tid, "version": raw["version"]}


def delete(tid):
    with MINE_LOCK:
        if not read(tid):
            raise ValueError("That tile isn't one of yours")
        _path(tid).unlink()
    forget_keys(tid)
    print("Deleted the tile %s" % tid, flush=True)
    return {"deleted": tid}


def import_tile(body):
    """A tile from someone else (a .countertop tile file, or one inside a shared layout) saved as one of yours, waiting
    for the person to let it run. Returns {id}: a new id, so it never replaces a tile you have."""
    tile = body.get("tile") if isinstance(body, dict) else None
    if not isinstance(tile, dict) or tile.get("countertop") != "tile":
        raise ValueError("That isn't a Countertop tile")
    with MINE_LOCK:
        raw = {k: tile[k] for k in FIELDS if k in tile}
        name = re.sub(r"^my-", "", str(tile.get("id") or "")) or tile.get("name")
        tid = _new_id(name)
        now = int(time.time())
        raw.update(countertop="tile", id=tid, version=1, mine={"from": "import", "made": now, "saved": now, "review": True})
        raw["code"] = _retarget(raw.get("code"), tile.get("id"), tid)
        clean_tile(raw)
        _write(tid, raw)
    print("Imported the tile %s; it waits until it's allowed to run" % tid, flush=True)
    return {"id": tid}


def _retarget(code, was, tid):
    """Tile("<old id>", …) → Tile("<new id>", …) (the runtime takes the first Tile() either way; this keeps it readable)."""
    if not isinstance(code, str) or not isinstance(was, str) or not was:
        return code
    return re.sub(r"""\bTile\(\s*(["'])%s\1""" % re.escape(was), 'Tile("%s"' % tid, code, count=1)


def trust(tid):
    """Run: a tile that came from someone else may run from now on."""
    with MINE_LOCK:
        raw = read(tid)
        if not raw:
            raise ValueError("That tile isn't one of yours")
        if (raw.get("mine") or {}).pop("review", None) is not None:
            _write(tid, raw)
    return {"id": tid}


def studio_view(tid):
    """GET /studio/tile/<id>: the whole file for Tile Studio, with the note but not the backup's code."""
    raw = read(tid)
    if not raw:
        return None
    out = public(raw)
    m = raw.get("mine") if isinstance(raw.get("mine"), dict) else {}
    b = m.get("backup") if isinstance(m.get("backup"), dict) else None
    out["mine"] = {"from": m.get("from") or "studio", "made": m.get("made") or 0, "saved": m.get("saved") or 0,
                   "review": m.get("review") is True, "backup": bool(b), "lan": bool(b and b.get("lan") is True),
                   "reasons": (b or {}).get("reasons") or []}
    return out


# ---------- Your own tiles: convert, and Restore ----------
def _code_of(item):
    s = item.get("settings") if isinstance(item.get("settings"), dict) else {}
    return s.get("html") if isinstance(s.get("html"), str) else ""


def _hash(item):
    return hashlib.sha256(_code_of(item).encode("utf-8")).hexdigest()


def _converted_from(item):
    """The Tile Studio tile already made from this exact Your own tile (same box, same code), if any."""
    h = _hash(item)
    for f in sorted(MINE_DIR.glob("my-*.json")) if MINE_DIR.is_dir() else []:
        raw = read(f.stem)
        b = ((raw or {}).get("mine") or {}).get("backup")
        if isinstance(b, dict) and isinstance(b.get("item"), dict) and b["item"].get("id") == item.get("id") and _hash(b["item"]) == h:
            return f.stem
    return None


def convert_item(item, force=False):
    """Make a Tile Studio tile from a Your own tile (a settings item), keeping the original as its backup. Returns the
    new item for the same box, or None when it wouldn't work in the sandbox and `force` isn't set."""
    if not isinstance(item, dict) or item.get("type") != "custom" or not isinstance(item.get("id"), str):
        return None
    html = _code_of(item)
    chk = precheck(html)
    if not chk["ok"] and not force:
        return None
    s = item.get("settings") if isinstance(item.get("settings"), dict) else {}
    with MINE_LOCK:
        tid = _converted_from(item)
        if not tid:
            tid = _new_id(item.get("name") or "my tile")
            now = int(time.time())
            hosts = [h for h in chk["hosts"] if FETCH_HOST_RE.match(h)][:10]
            raw = {"countertop": "tile", "id": tid, "version": 1, "name": str(item.get("name") or "My tile")[:60],
                   "description": "Made from a Your own tile.", "size": CUSTOM_SIZE, "taps": s.get("taps") is True,
                   "hosts": hosts, "uses": ["fetch"] if hosts else [],
                   "settings": {"every": {"type": "int", "label": "Start again every (minutes, 0 = never)", "default": 0, "min": 0, "max": 1440},
                                "frame": {"type": "bool", "label": "Show on a card", "default": True},
                                "title": {"type": "bool", "label": "Show its name as a title", "default": False}},
                   "code": page_code(tid, html),
                   "mine": {"from": "custom", "made": now, "saved": now,
                            "backup": {"item": json.loads(json.dumps(item)), "lan": item.get("lan") is True,
                                       "reasons": chk["reasons"], "at": now}}}
            if len(raw["code"].encode("utf-8")) > SBX_MAX_CODE:
                return None
            clean_tile(raw)
            _write(tid, raw)
            print("Converted the Your own tile %s into %s" % (item["id"], tid), flush=True)
    new = {"id": item["id"], "type": tid,
           "settings": {k: s[k] for k in ("every", "frame", "title") if k in s and k != "every" or (k == "every" and isinstance(s.get(k), int))}}
    if item.get("name"):
        new["name"] = item["name"]
    return new


def convert_items(items):
    """At every settings save: Your own tiles that will work in the sandbox become Tile Studio tiles. Leaves alone
    ones waiting for Run, ones put back with Restore (`keep`), and ones that wouldn't work. True when any changed."""
    changed = False
    for i, t in enumerate(items if isinstance(items, list) else []):
        if isinstance(t, dict) and t.get("type") == "custom" and not t.get("review") and not t.get("keep"):
            try:
                new = convert_item(t)
            except (OSError, ValueError) as e:
                print("couldn't convert the Your own tile %s: %s" % (t.get("id"), e), flush=True)
                new = None
            if new:
                items[i] = new
                changed = True
    return changed


def legacy_view(items):
    """For /config: each Your own tile still on the dashboard, with why it wasn't converted."""
    out = {}
    for t in items if isinstance(items, list) else []:
        if isinstance(t, dict) and t.get("type") == "custom" and isinstance(t.get("id"), str):
            chk = precheck(_code_of(t))
            out[t["id"]] = {"ok": chk["ok"], "reasons": chk["reasons"], "kept": t.get("keep") is True}
    return out


def restore_item(tid):
    """The Your own tile a converted tile was made from: (original item, lan) or ValueError."""
    raw = read(tid)
    b = ((raw or {}).get("mine") or {}).get("backup")
    if not isinstance(b, dict) or not isinstance(b.get("item"), dict):
        raise ValueError("This tile has no original to put back")
    item = json.loads(json.dumps(b["item"]))
    item.pop("lan", None)
    item.pop("review", None)
    item["keep"] = True                 # put back on purpose: it isn't converted again by itself
    return item, b.get("lan") is True
