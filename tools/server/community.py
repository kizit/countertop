"""Community: the gallery's list of layouts, themes and effects, for Library → Community.

The gallery is a separate repository (github.com/kizit/countertop-gallery) that publishes one index.json on GitHub Pages:
every item inline, and a `revoked` list of items that were taken down. This reads it when someone opens Community in
Controls, keeps it for ten minutes, and sends nothing about this install. Layouts, themes and effects are checked again
in the browser when they're downloaded, exactly as a shared file from a friend is. Tiles are checked here, and only the
server downloads them (server/commtiles.py), which also reads the index once a day while a downloaded tile is installed,
for its take-downs.
"""
import json
import os
import re
import threading
import time
from urllib.request import Request, urlopen

from server.commtiles import gallery_tile, gallery_view, note_index
from server.core import VERSION

GALLERY_URL = "https://kizit.github.io/countertop-gallery/index.json"
KEEP_FOR = 600
MAX_BYTES = 8_000_000
KINDS = {"layout": "layouts", "theme": "themes", "effect": "effects", "tile": "tiles"}
ID = re.compile(r"^(layouts|themes|effects|tiles)/[a-z0-9][a-z0-9-]{0,60}$")
SHOT = re.compile(r"^items/tiles/[a-z0-9][a-z0-9-]{0,60}\.(png|jpg)$")
CACHE = {"at": 0.0, "data": None}
LOCK = threading.Lock()


def _clean(raw):
    """The index, keeping only items that look right (the browser checks each one's contents when it's downloaded)."""
    if not isinstance(raw, dict) or raw.get("countertop") != "gallery" or not isinstance(raw.get("items"), list):
        raise ValueError("that isn't a Countertop gallery")
    if not isinstance(raw.get("format"), int) or raw["format"] > 1:
        raise ValueError("this gallery needs a newer Countertop")
    items = []
    for i in raw["items"]:
        if not isinstance(i, dict) or not isinstance(i.get("item"), dict):
            continue
        iid, kind = i.get("id"), i.get("kind")
        if not isinstance(iid, str) or not ID.match(iid) or kind not in KINDS or not iid.startswith(KINDS[kind] + "/"):
            continue
        if i["item"].get("countertop") != kind or not isinstance(i.get("version"), int) or isinstance(i["version"], bool) or i["version"] < 1:
            continue
        e = {"id": iid, "kind": kind, "name": str(i.get("name") or i["item"].get("name") or "")[:80],
             "description": str(i.get("description") or "")[:500], "author": str(i.get("author") or "")[:39],
             "version": i["version"], "updated": str(i.get("updated") or "")[:10], "item": i["item"]}
        if kind == "tile":
            try:
                e["tile"] = gallery_view(gallery_tile(i))      # what it can do, worked out here
            except ValueError:
                continue
            if isinstance(i.get("shot"), str) and SHOT.match(i["shot"]):
                e["shot"] = i["shot"]
        items.append(e)
    revoked = [x for x in raw.get("revoked") or [] if isinstance(x, str) and ID.match(x)]
    return {"items": items, "revoked": revoked, "updated": str(raw.get("updated") or "")[:10]}


def _why(e):
    """A short reason for the person to read, not Python's own words."""
    if isinstance(e, ValueError) and not isinstance(e, json.JSONDecodeError):
        return str(e)[:100]
    if isinstance(e, json.JSONDecodeError):
        return "its list couldn't be read"
    return str(getattr(e, "reason", None) or e)[:100]


def gallery_url():
    return os.environ.get("COUNTERTOP_GALLERY_URL") or GALLERY_URL


def community_index(refresh=False):
    """{items, revoked, updated, fetched, error}. On a failure the last good list is kept and the error says why."""
    with LOCK:
        now = time.time()
        if CACHE["data"] and not refresh and now - CACHE["at"] < KEEP_FOR:
            return dict(CACHE["data"], error="")
        try:
            url = gallery_url()
            req = Request(url, headers={"User-Agent": "Countertop/" + VERSION, "Accept": "application/json"})
            data = _clean(json.loads(urlopen(req, timeout=12).read(MAX_BYTES).decode("utf-8")))
            data["fetched"] = int(now)
            CACHE.update(at=now, data=data)
            try:
                note_index(data, now)          # take-downs of downloaded tiles, whoever asked for the index
            except Exception as e:
                print("couldn't note the gallery's take-downs: %s" % e, flush=True)
            return dict(data, error="")
        except Exception as e:
            if CACHE["data"]:
                return dict(CACHE["data"], error="Couldn't reach the gallery just now (%s). Showing what was loaded earlier." % _why(e))
            return {"items": [], "revoked": [], "updated": "", "fetched": 0, "error": "Couldn't reach the gallery (%s). Check your internet connection and try again." % _why(e)}
