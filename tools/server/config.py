"""Settings: the schema, reading and saving dashboard.json safely, backups, and which tiles are on the saved dashboard."""
import json
import threading
import time
from server import tiledata
from server.core import WORK


# ---------- module platform: config schema, stored settings, team schedule, shared photo album ----------
CONFIG_FILE = WORK / "dashboard.json"
SERVER_START = int(time.time())
CONFIG_LOCK = threading.Lock()
ZONES = ["header-left", "header-right", "strip", "main", "side"]

# Describes every module and its settings. The control page builds its form from this,
# and the dashboard reads the merged values from GET /config.
SCHEMA = {
    "general": {"title": "Location & units", "desc": "Where you are (for weather, radar, sunrise and things overhead), units, and how dates and times are written.", "global": True, "settings": {
        "name": {"type": "text", "label": "Dashboard name", "default": "Kitchen"},
        "place": {"type": "text", "label": "Place name", "default": ""},
        "lat": {"type": "number", "label": "Latitude", "default": 0},
        "lon": {"type": "number", "label": "Longitude", "default": 0},
        "lang": {"type": "choice", "label": "Language", "choices": ["Automatic", "English", "Français"], "default": "Automatic"},
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
        "mine": {"type": "effects", "label": "Your own effects", "default": []},
    }},
    "look": {"title": "Themes", "global": True, "theme": True,
             "desc": "How the dashboard looks. Everyday, plus your own themes: one in use, and others the schedule can switch to.", "settings": {
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
        "items": {"type": "looks", "label": "Other themes", "default": []},
        "use": {"type": "text", "label": "Theme that shows when nothing is scheduled (empty: Everyday)", "default": ""},
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


ORIENTATIONS = ("auto", "landscape", "left", "right")


def dashboard_orientation(saved=None):
    if saved is None:
        try:
            saved = json.loads(CONFIG_FILE.read_text())
        except (OSError, ValueError):
            return "auto"
    mode = saved.get("orientation")
    return mode if mode in ORIENTATIONS else "auto"


# ---------- keeping settings safe ----------
# dashboard.json carries a "schema" number. Each upgrade below runs once, in order, for files saved
# before it existed; add a step (and bump CONFIG_SCHEMA) whenever the stored shape changes.
CONFIG_SCHEMA = 2
BACKUP_DIR = WORK / "backups"
BACKUP_KEEP = 12              # rolling copies of dashboard.json, newest kept
BACKUP_EVERY = 15 * 60        # at most one routine copy per 15 minutes (Controls saves on every change)
tiledata.init(WORK, BACKUP_DIR)
CONFIG_PROBLEM = {}           # set when a settings file couldn't be read: shown in Controls > Status


def config_backup(force=False):
    """Copy the current dashboard.json into work/backups. Routine copies are spaced out; force is for
    just before an upgrade rewrites the file. Call with CONFIG_LOCK held or before taking it."""
    try:
        if not CONFIG_FILE.exists():
            return None
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        have = sorted(BACKUP_DIR.glob("dashboard-*.json"))
        if have and not force and time.time() - have[-1].stat().st_mtime < BACKUP_EVERY:
            return None
        dest = BACKUP_DIR / ("dashboard-%s.json" % time.strftime("%Y%m%d-%H%M%S"))
        n = 1
        while dest.exists():
            n += 1
            dest = BACKUP_DIR / ("dashboard-%s-%d.json" % (time.strftime("%Y%m%d-%H%M%S"), n))
        dest.write_bytes(CONFIG_FILE.read_bytes())
        for old in sorted(BACKUP_DIR.glob("dashboard-*.json"))[:-BACKUP_KEEP]:
            old.unlink()
        return dest
    except OSError as e:
        print("settings backup failed: %s" % e, flush=True)
        return None


def _parse_config(raw):
    saved = json.loads(raw)
    if not isinstance(saved, dict):
        raise ValueError("settings file is not a JSON object")
    return saved


def config_read():
    """The saved settings file as a dict ({} for a new install), or None when it exists but can't be used.

    A file that can't be read is never written over: it is renamed to dashboard.broken-<time>.json and
    the newest readable backup is put back in its place."""
    try:
        return _parse_config(CONFIG_FILE.read_text())
    except FileNotFoundError:
        return {}
    except (OSError, ValueError, UnicodeDecodeError):
        pass
    with CONFIG_LOCK:
        try:                                    # another request may have dealt with it meanwhile
            return _parse_config(CONFIG_FILE.read_text())
        except FileNotFoundError:
            return {}
        except (OSError, ValueError, UnicodeDecodeError) as e:
            why = str(e)[:200]
        kept = CONFIG_FILE.with_name("dashboard.broken-%s.json" % time.strftime("%Y%m%d-%H%M%S"))
        try:
            CONFIG_FILE.rename(kept)
        except OSError as e:
            CONFIG_PROBLEM.update(at=time.time(), why=why, kept="", restored="", stuck=str(e)[:200])
            print("settings file can't be read (%s) or moved aside (%s); using defaults without saving" % (why, e), flush=True)
            return None
        restored, data = "", {}
        for b in sorted(BACKUP_DIR.glob("dashboard-*.json"), reverse=True) if BACKUP_DIR.exists() else []:
            try:
                data = _parse_config(b.read_text())
            except (OSError, ValueError, UnicodeDecodeError):
                continue
            tmp = CONFIG_FILE.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False))
            tmp.replace(CONFIG_FILE)
            restored = b.name
            break
        CONFIG_PROBLEM.update(at=time.time(), why=why, kept=kept.name, restored=restored, stuck="")
        print("settings file couldn't be read (%s): kept it as %s; %s" % (
            why, kept.name, "restored backups/" + restored if restored else "no backup to restore, starting fresh"), flush=True)
        return data


def config_load():
    merged = config_defaults()
    saved = config_read()
    can_save = saved is not None
    saved = saved or {}
    smods = saved.get("modules") if isinstance(saved.get("modules"), dict) else {}
    have = saved.get("schema") if isinstance(saved.get("schema"), int) else 0
    if have < CONFIG_SCHEMA:
        changed = False
        for n, step in CONFIG_UPGRADES:
            if have < n:
                smods, did = step(smods)
                changed = changed or did
        if can_save and not (CONFIG_PROBLEM.get("upgrade_unsaved") and not changed):
            if changed:
                config_backup(force=True)
            try:
                config_save({"modules": smods}, quiet=True)
                CONFIG_PROBLEM.pop("upgrade_unsaved", None)
            except Exception as e:             # a read-only data folder: Status already says so; don't retry every load
                CONFIG_PROBLEM["upgrade_unsaved"] = True
                print("couldn't save upgraded settings: %s" % e, flush=True)
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
        saved["schema"] = CONFIG_SCHEMA
        saved["saved"] = int(time.time())
        config_backup()
        tmp = CONFIG_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(saved, indent=1, ensure_ascii=False))
        tmp.replace(CONFIG_FILE)
        live = _tile_ids(saved.get("modules"))
        if live is not None:              # a save without a tile list (orientation only) leaves tile data alone
            tiledata.sync(live)
    return None if quiet else config_load()


def _tile_ids(mods):
    """Tile id -> tile type for every tile in a saved modules dict (None when it has no tile list)."""
    try:
        items = mods["tiles"]["settings"]["items"]
    except (KeyError, TypeError):
        return None
    if not isinstance(items, list):
        return None
    return {t["id"]: str(t.get("type") or "") for t in items if isinstance(t, dict) and isinstance(t.get("id"), str)}


LIVE_TILES = {"mtime": None, "ids": {}}


def live_tiles():
    """The tiles on the saved dashboard (id -> type); a layout being previewed or tried isn't saved, so its tiles aren't here."""
    try:
        mt = CONFIG_FILE.stat().st_mtime_ns
    except OSError:
        return {}
    if LIVE_TILES["mtime"] != mt:
        try:
            LIVE_TILES["ids"] = _tile_ids(json.loads(CONFIG_FILE.read_text()).get("modules")) or {}
        except (OSError, ValueError, AttributeError):
            LIVE_TILES["ids"] = {}
        LIVE_TILES["mtime"] = mt
    return LIVE_TILES["ids"]


def setting(mid, key):
    return config_load()["modules"][mid]["settings"][key]


# names used only inside functions: imported last, so these modules can use each other
from server.upgrades import CONFIG_UPGRADES  # noqa: E402
