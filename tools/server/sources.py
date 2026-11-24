"""Sources: connections set up once in Setup (calendars, lists, teams, albums, cams, Home Assistant, recipes) and picked by tiles."""
import json
import threading
import uuid
from server.core import WORK


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
        "desc": "Photo albums and folders for the Photo frame tile and the Photos background: iCloud, a local folder, Nextcloud or ownCloud, Immich, Plex, Jellyfin or PhotoPrism.",
        "fields": {
            "name": {"label": "Name", "type": "text"},
            "kind": {"label": "Kept in", "type": "choice",
                     "choices": ["iCloud shared album", "Local folder", "Nextcloud / ownCloud", "Immich", "Plex", "Jellyfin", "PhotoPrism"],
                     "help": "Pick where your photos live. For local folders and self-hosted servers, this server fetches the photos so keys and passwords stay off the screen."},
            "url": {"label": "iCloud shared album link", "type": "text",
                    "when": {"kind": ["iCloud shared album", "Nextcloud / ownCloud"]},
                    "labelBy": {
                        "iCloud shared album": "iCloud shared album link",
                        "Nextcloud / ownCloud": "Shared folder link",
                    },
                    "helpBy": {
                        "iCloud shared album": "In Photos: open the shared album, tap the people icon, turn on Public Website and copy the link. Works with both newer photos.icloud.com and older icloud.com/sharedalbum links. A shared Photo Library has no public link and can't be used.",
                        "Nextcloud / ownCloud": "Share a folder as a public link and paste it here, e.g. https://cloud.example.com/s/AbCdEf123. This server fetches the photos so the screen never talks to your cloud directly.",
                    },
                    "help": "In Photos: open the shared album, tap the people icon, turn on Public Website and copy the link."},
            "password": {"label": "Share password (optional)", "type": "text", "secret": True,
                         "when": {"kind": "Nextcloud / ownCloud"},
                         "help": "Leave blank if the shared folder has no password. It stays on the dashboard server and is never shown again."},
            "path": {"label": "Folder path", "type": "text", "when": {"kind": "Local folder"},
                     "help": "A folder on the computer running Countertop, e.g. /photos or /home/pi/Pictures. In Docker or Unraid, mount your photo folder into the container first (for example at /photos)."},
            "subdirs": {"label": "Include subfolders", "type": "bool",
                        "when": {"kind": ["Local folder", "Nextcloud / ownCloud"]},
                        "help": "Also show photos kept inside subfolders."},
            "server": {"label": "Server address", "type": "text",
                       "when": {"kind": ["Immich", "Plex", "Jellyfin", "PhotoPrism"]},
                       "labelBy": {
                           "Immich": "Immich address",
                           "Plex": "Plex address",
                           "Jellyfin": "Jellyfin address",
                           "PhotoPrism": "PhotoPrism address",
                       },
                       "helpBy": {
                           "Immich": "Where you open Immich, e.g. http://192.168.1.20:2283. If Countertop runs in Docker, use the IP address: names ending in .local often don't work there.",
                           "Plex": "Where you open Plex, e.g. http://192.168.1.20:32400. In Docker, use the IP address rather than a .local name.",
                           "Jellyfin": "Where you open Jellyfin, e.g. http://192.168.1.20:8096. In Docker, use the IP address rather than a .local name.",
                           "PhotoPrism": "Where you open PhotoPrism, e.g. http://192.168.1.20:2342. In Docker, use the IP address rather than a .local name.",
                       },
                       "help": "Where you open the photo server on your home network."},
            "apiKey": {"label": "API key", "type": "text", "secret": True,
                       "when": {"kind": ["Immich", "Plex", "Jellyfin", "PhotoPrism"]},
                       "labelBy": {
                           "Immich": "Immich API key",
                           "Plex": "Plex token",
                           "Jellyfin": "Jellyfin API key",
                           "PhotoPrism": "PhotoPrism access token",
                       },
                       "helpBy": {
                           "Immich": "In Immich: your account → API keys → New API key. Name it Countertop and paste it here. It stays on the dashboard server and is never shown again.",
                           "Plex": "Your X-Plex-Token (open any item in Plex → Get Info → View XML, and copy the X-Plex-Token value from the address bar). It stays on the server and is never shown again.",
                           "Jellyfin": "In Jellyfin: Dashboard → API Keys → + to make a key named Countertop. It stays on the dashboard server and is never shown again.",
                           "PhotoPrism": "An app password or API access token from Settings → Account → Apps and Devices (leave blank only if your PhotoPrism runs in public mode). It stays on the server and is never shown again.",
                       },
                       "help": "Stays on the dashboard server and is never shown again."},
            "album": {"label": "Album name", "type": "text",
                      "when": {"kind": ["Immich", "Plex", "Jellyfin", "PhotoPrism"]},
                      "labelBy": {
                          "Immich": "Immich album name",
                          "Plex": "Library or album name (optional)",
                          "Jellyfin": "Folder or album name (optional)",
                          "PhotoPrism": "Album name (optional)",
                      },
                      "helpBy": {
                          "Immich": "Exactly as the album is named in Immich. Make one just for the dashboard if you like.",
                          "Plex": "The name of a Plex photo library, album, collection or photo playlist. Leave blank to use the first photo library.",
                          "Jellyfin": "The name of a Jellyfin photo library, folder or album. Leave blank to show photos from across Jellyfin.",
                          "PhotoPrism": "Exactly as the album is named in PhotoPrism (or leave blank to show photos from your library).",
                      },
                      "help": "Exactly as the album is named on your photo server."}}},
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
    PHOTO_CACHES.clear()
    return sources_public()


# names used only inside functions: imported last, so these modules can use each other
from server.config import CONFIG_FILE  # noqa: E402
from server.core import ICS_CACHE  # noqa: E402
from server.feeds.meals import MEAL_CACHE  # noqa: E402
from server.feeds.photos import PHOTO_CACHES  # noqa: E402
from server.homeassistant import HA_CACHE  # noqa: E402
from server.lists import REM_FILE, URL_LISTS  # noqa: E402
