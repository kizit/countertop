"""Builds the test galleries in this folder from the test tiles beside it, for trying Library → Community.

  index.json         the first look: Hello there, Moon facts, List count, Front porch (and two that Countertop must hide)
  index-update.json  a day later: Hello there 2 (nothing new), Moon facts 2 (reads one more site, so it asks again),
                     Front porch taken down

Point Countertop at one with COUNTERTOP_GALLERY_URL=file:///…/index.json. Run with: python3 tests/fixtures/community-tiles/gallery/build.py
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
TILES = HERE.parent


def tile(name, version=1, **change):
    t = json.loads((TILES / (name + ".json")).read_text())
    t.update(change)
    if version > 1:
        t["code"] = t["code"].replace("Version 1", "Version %d" % version)
    t.pop("version", None)
    return {"id": "tiles/" + t["id"], "kind": "tile", "name": t["name"], "description": t.get("description", ""),
            "author": t.get("author") or "countertop-tests", "version": version, "updated": "2026-11-2%d" % (3 + version), "item": t}


def write(name, items, revoked=()):
    (HERE / name).write_text(json.dumps({"countertop": "gallery", "format": 1, "updated": "2026-11-23", "items": items,
                                         "revoked": list(revoked)}, indent=1) + "\n")


first = [tile("hello-there"), dict(tile("moon-facts"), shot="items/tiles/moon-facts.png"), tile("list-count"), tile("front-porch"),
         tile("next-up"),                                        # personal data and a site: never listed
         dict(tile("spinner"), id="tiles/someone-else")]          # its id doesn't match the tile inside: never listed
write("index.json", first)
write("index-update.json", [tile("hello-there", 2), dict(tile("moon-facts", 2, hosts=["api.example.com", "api2.example.com"]), shot="items/tiles/moon-facts.png"),
                            tile("list-count"), tile("front-porch")], revoked=["tiles/front-porch"])
