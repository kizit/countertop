"""Community tiles from the gallery: what each one can do, Download, Update, Remove, and the daily take-down check.

A gallery tile is listed in the gallery's index.json like any other item (kind "tile", id "tiles/<tile id>"), with its
code inline. Nothing runs until the person downloads it from Library → Community, after a screen that lists everything
it can do (`tile_perms`). Download sends back the list the person saw; the server reads the tile from the gallery itself
(never from the browser), checks it again, and refuses if it can now do anything that wasn't on that list. So an update
that asks for more asks again, and a tile changed between looking and pressing Download asks again too.

The downloaded tile is saved as community/tiles/<id>.json in the data folder (server/sandbox.py runs it from there), with
a `gallery` note: {id, v, by, perms, at}. Tiles never update by themselves.

While any downloaded tile is installed, the server reads the gallery's index once a day for its `revoked` list (an
ordinary download of the public file: it sends nothing about this install). A tile on that list stops: its frame isn't
served, its box says it was taken down, and Status says so. It runs again only if the gallery lists it again.
"""
import json
import threading
import time
from urllib.request import Request, urlopen

from server.core import VERSION
from server.sandbox import SBX_ID_RE, SBX_PERSONAL, TAKEDOWN_FILE, TILES_DIR, clean_tile, community_installed
from server.tilekeys import forget_keys

CHECK_EVERY = 86400          # the take-down check: once a day
RETRY_AFTER = 3600           # after a failed check, try again in an hour
SHOT_MAX = 600_000
CT_LOCK = threading.Lock()

FEED_WORDS = {"wx": "the weather", "aqi": "air quality", "team": "your teams' games", "events": "your calendars",
              "notes": "your lists and notes", "photos": "your photo albums", "sales": "store sales"}
ACTION_WORDS = {"turn_on": "turn on", "turn_off": "turn off", "toggle": "switch", "open_cover": "open", "close_cover": "close",
                "stop_cover": "stop", "set_cover_position": "set how far open", "lock": "lock", "unlock": "unlock", "open": "open the door",
                "press": "press", "arm_home": "arm (home)", "arm_away": "arm (away)", "arm_night": "arm (night)",
                "arm_vacation": "arm (vacation)", "disarm": "disarm", "media_play_pause": "play or pause", "volume_set": "set the volume"}


# ---------- what a tile can do ----------
def tile_perms(t):
    """Everything a cleaned tile can do, as [{k, ks, group, text}]: one line each to show. `ks` are stable keys for each
    single thing on the line (`k` is the first): the person's consent is the set of keys they saw, and a version with a
    key that isn't in it has to ask again. Doing less never asks again."""
    out = []
    for f in t["feeds"]:
        out.append({"k": "feed:" + f, "group": "personal" if f in SBX_PERSONAL else "see",
                    "text": "Can see " + FEED_WORDS.get(f, f)})
    for h in t["hosts"]:
        out.append({"k": "host:" + h, "group": "reach", "text": "Reads from " + h})
    for name, s in sorted(t["settings"].items()):
        if s.get("type") == "secret":
            how = "header " + s["header"] if s.get("header") else "address (" + s["query"] + ")"
            out.append({"k": "key:%s:%s:%s" % (name, s["host"], how), "group": "reach",
                        "text": "Uses an API key you type in, sent only to %s" % s["host"]})
    for slot, d in sorted(t["devices"].items()):
        acts = [c["action"] for c in t["controls"] if c["device"] == slot]
        ks = ["device:%s:%s" % (slot, x) for x in d["domains"]] + ["action:%s:%s" % (slot, a) for a in sorted(set(acts))]
        out.append({"k": ks[0], "ks": ks, "group": "secure" if d["secure"] else "control",
                    "text": "Has buttons for “%s” (%s): %s. You pick which one, and only the buttons work it" % (
                        d["label"], " or ".join(x.replace("_", " ") for x in d["domains"]), ", ".join(dict.fromkeys(ACTION_WORDS.get(a, a.replace("_", " ")) for a in acts)))})
    if t["taps"]:
        out.append({"k": "taps", "group": "tap", "text": "Does something when you tap it"})
    for p in out:
        p.setdefault("ks", [p["k"]])
    return out


def perm_keys(t):
    return sorted(k for p in tile_perms(t) for k in p["ks"])


def gallery_tile(entry):
    """The tile in a gallery index entry, checked (ValueError says why it can't be used). Its version is the gallery's."""
    item = entry.get("item")
    if not isinstance(item, dict):
        raise ValueError("has no tile in it")
    t = clean_tile(dict(item, version=entry.get("version")))
    if entry.get("id") != "tiles/" + t["id"]:
        raise ValueError("its gallery id doesn't match the tile inside")
    if t["hostsDropped"]:
        raise ValueError("it reads personal data and also asks for sites")
    return t


def gallery_view(t):
    """What Community shows about a gallery tile, beside the item itself: its permissions and the parts that decide them."""
    return {"type": t["id"], "size": t["size"], "personal": t["personal"], "perms": tile_perms(t),
            "secure": any(d["secure"] for d in t["devices"].values())}


# ---------- what's downloaded ----------
def _gallery_note(raw):
    g = raw.get("gallery") if isinstance(raw, dict) else None
    if not isinstance(g, dict) or not isinstance(g.get("id"), str) or not g["id"].startswith("tiles/"):
        return None
    return {"id": g["id"][:50], "v": g.get("v") if isinstance(g.get("v"), int) else 0, "by": str(g.get("by") or "")[:39],
            "perms": [str(x)[:200] for x in g.get("perms") or []][:60] if isinstance(g.get("perms"), list) else [], "at": g.get("at") or 0}


def downloaded():
    """{tile id: gallery note} for every community tile that came from the gallery."""
    out = {}
    for f in sorted(TILES_DIR.glob("*.json")) if TILES_DIR.is_dir() else []:
        try:
            g = _gallery_note(json.loads(f.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
        if g:
            out[f.stem] = g
    return out


def _write_tile(tid, raw):
    TILES_DIR.mkdir(parents=True, exist_ok=True)
    tmp = TILES_DIR / (".%s.tmp" % tid)
    tmp.write_text(json.dumps(raw, indent=1), encoding="utf-8")
    tmp.replace(TILES_DIR / (tid + ".json"))


def install(gid, consent, index):
    """Download (or update) gallery tile `gid` from `index` (community_index()). `consent` is the list of permission
    keys the person saw. Returns {"type", "version"}; ValueError with a reason the person can read otherwise, and
    PermissionError when the tile now asks for something they haven't seen (with .perms, the new list)."""
    if not isinstance(gid, str) or not gid.startswith("tiles/"):
        raise ValueError("That isn't a community tile")
    entry = next((e for e in index.get("items") or [] if e.get("id") == gid and e.get("kind") == "tile"), None)
    if gid in (index.get("revoked") or []):
        raise ValueError("The gallery took this tile down, so it can't be downloaded")
    if not entry:
        raise ValueError("The gallery doesn't list this tile any more")
    t = gallery_tile(entry)
    keys = perm_keys(t)
    seen = set(x for x in consent if isinstance(x, str)) if isinstance(consent, list) else set()
    missing = [k for k in keys if k not in seen]
    if missing:
        e = PermissionError("This tile can do more than the list you saw. Look over what it can do again.")
        e.perms = tile_perms(t)
        raise e
    with CT_LOCK:
        f = TILES_DIR / (t["id"] + ".json")
        if f.exists():
            try:
                had = _gallery_note(json.loads(f.read_text(encoding="utf-8")))
            except (OSError, ValueError):
                had = None
            if not had or had["id"] != gid:
                raise ValueError("A different tile called %s is already installed" % t["id"])
        raw = dict(entry["item"], countertop="tile", id=t["id"], version=entry["version"],
                   gallery={"id": gid, "v": entry["version"], "by": entry.get("author") or "", "perms": keys, "at": int(time.time())})
        _write_tile(t["id"], raw)
    print("Downloaded the community tile %s, version %d" % (t["id"], entry["version"]), flush=True)
    return {"type": t["id"], "version": entry["version"]}


def remove(tid):
    """Remove a community tile (from the gallery or put there by hand), and the API keys saved for it."""
    if not isinstance(tid, str) or not SBX_ID_RE.match(tid) or not (TILES_DIR / (tid + ".json")).is_file():
        raise ValueError("That tile isn't installed")
    with CT_LOCK:
        try:
            (TILES_DIR / (tid + ".json")).unlink()
        except FileNotFoundError:
            pass
    forget_keys(tid)
    print("Removed the community tile %s" % tid, flush=True)
    return {"removed": tid}


# ---------- the take-down check ----------
def takedowns():
    """{"checked": time of the last good check, "tried": last try, "revoked": [gallery ids of downloaded tiles], "error"}."""
    try:
        d = json.loads(TAKEDOWN_FILE.read_text())
        if isinstance(d, dict):
            return {"checked": d.get("checked") or 0, "tried": d.get("tried") or 0, "error": str(d.get("error") or "")[:200],
                    "revoked": [x for x in d.get("revoked") or [] if isinstance(x, str)][:200]}
    except (OSError, ValueError):
        pass
    return {"checked": 0, "tried": 0, "revoked": [], "error": ""}


def _save_takedowns(d):
    TAKEDOWN_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = TAKEDOWN_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(d))
    tmp.replace(TAKEDOWN_FILE)


def note_index(index, now=None):
    """A fresh gallery index was read (the daily check, or someone opening Community): remember which downloaded tiles
    it takes down. A tile the gallery lists again runs again."""
    if not index or index.get("error") or not index.get("fetched"):
        return
    now = time.time() if now is None else now
    have = {g["id"] for g in downloaded().values()}
    revoked = sorted(have & set(index.get("revoked") or []))
    with CT_LOCK:
        old = takedowns()
        _save_takedowns({"checked": int(now), "tried": int(now), "revoked": revoked, "error": ""})
    for gid in sorted(set(revoked) - set(old["revoked"])):
        print("The gallery took down the community tile %s; it's off now" % gid, flush=True)


def takedown_check(fetch, now=None):
    """The daily check, reading the index with fetch(refresh) (community_index). Does nothing unless a downloaded tile
    is installed and a day has passed (an hour after a failure). Returns True when it read the gallery."""
    now = time.time() if now is None else now
    if not downloaded():
        return False
    st = takedowns()
    if now - st["checked"] < CHECK_EVERY or now - st["tried"] < RETRY_AFTER:
        return False
    idx = fetch(True)
    if idx.get("error") or not idx.get("fetched"):
        with CT_LOCK:
            _save_takedowns(dict(st, tried=int(now), error=idx.get("error") or "the gallery didn't answer"))
        return True
    note_index(idx, now)
    return True


def takedown_loop(fetch):
    time.sleep(60)          # let the server start first
    while True:
        try:
            takedown_check(fetch)
        except Exception as e:
            print("take-down check failed: %s" % e, flush=True)
        time.sleep(600)


# ---------- the gallery's picture of a tile ----------
SHOT_CACHE = {}


def gallery_shot(gid, index, base_url):
    """(bytes, type) of a tile's screenshot, read from the gallery and kept in memory; None when there's none."""
    from urllib.parse import urljoin
    entry = next((e for e in index.get("items") or [] if e.get("id") == gid and e.get("kind") == "tile"), None)
    shot = entry and entry.get("shot")
    if not shot:
        return None
    key = (gid, entry["version"])
    if key in SHOT_CACHE:
        return SHOT_CACHE[key]
    data = urlopen(Request(urljoin(base_url, shot), headers={"User-Agent": "Countertop/" + VERSION}), timeout=12).read(SHOT_MAX + 1)
    if len(data) > SHOT_MAX:
        return None
    kind = "image/png" if data[:8] == b"\x89PNG\r\n\x1a\n" else "image/jpeg" if data[:3] == b"\xff\xd8\xff" else None
    if not kind:
        return None
    if len(SHOT_CACHE) > 40:
        SHOT_CACHE.clear()
    SHOT_CACHE[key] = (data, kind)
    return SHOT_CACHE[key]
