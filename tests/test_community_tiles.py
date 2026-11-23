"""Community tiles from the gallery: what Community lists, the permission list, Download and Update (only with the
person's consent to everything the tile can do), Remove, and the daily take-down check that stops a revoked tile.

Run with: python3 tests/test_community_tiles.py
"""

import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
from tempfile import TemporaryDirectory
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
TMP = TemporaryDirectory()
os.environ["COUNTERTOP_DATA"] = TMP.name
spec = importlib.util.spec_from_file_location("countertop", ROOT / "tools" / "countertop.py")
ct = importlib.util.module_from_spec(spec)
sys.argv = ["countertop.py"]
spec.loader.exec_module(ct)
sbx, commtiles, tilekeys = ct.sandbox, ct.commtiles, ct.tilekeys
community = sys.modules["server.community"]          # this copy's (each test file loads its own)

FIXTURES = ROOT / "tests" / "fixtures" / "community-tiles"
GALLERY = FIXTURES / "gallery"
INDEX = Path(TMP.name) / "index.json"
DAY = 86400


def fixture(name):
    return json.loads((FIXTURES / (name + ".json")).read_text())


def entry(name, version=1, **change):
    t = dict(fixture(name), **change)
    t.pop("version", None)
    return {"id": "tiles/" + t["id"], "kind": "tile", "name": t["name"], "description": "", "author": "someone",
            "version": version, "updated": "2026-11-23", "item": t}


def publish(items, revoked=()):
    INDEX.write_text(json.dumps({"countertop": "gallery", "format": 1, "updated": "2026-11-23", "items": items, "revoked": list(revoked)}))
    community.CACHE.update(at=0.0, data=None)


def listed(gid):
    return next(e for e in ct.community_index()["items"] if e["id"] == gid)


def consent(gid):
    return [k for p in listed(gid)["tile"]["perms"] for k in p["ks"]]


def download(gid):
    return commtiles.install(gid, consent(gid), ct.community_index(True))


class Base(unittest.TestCase):
    def setUp(self):
        os.environ["COUNTERTOP_GALLERY_URL"] = INDEX.as_uri()
        community.CACHE.update(at=0.0, data=None)
        shutil.rmtree(sbx.TILES_DIR.parent, ignore_errors=True)
        for f in (sbx.SAFE_FILE, tilekeys.KEYS_FILE):
            if f.exists():
                f.unlink()


class Listing(Base):
    def test_lists_tiles_with_what_each_can_do(self):
        publish([entry("hello-there"), entry("moon-facts"), entry("list-count"), entry("front-porch"), entry("key-check")])
        by = {e["id"]: e for e in ct.community_index()["items"]}
        self.assertEqual(by["tiles/hello-there"]["tile"]["perms"], [])
        self.assertEqual([p["k"] for p in by["tiles/moon-facts"]["tile"]["perms"]], ["feed:wx", "host:api.example.com", "taps"])
        self.assertEqual(by["tiles/list-count"]["tile"]["personal"], ["notes"])
        self.assertEqual(by["tiles/list-count"]["tile"]["perms"][0]["group"], "personal")
        porch = by["tiles/front-porch"]["tile"]
        self.assertTrue(porch["secure"])
        lock = next(p for p in porch["perms"] if p["k"].startswith("device:lock"))
        self.assertEqual(lock["ks"], ["device:lock:lock", "action:lock:lock", "action:lock:unlock"])
        self.assertIn("unlock", next(p["text"] for p in porch["perms"] if p["k"].startswith("device:lock")))
        keys = [p for p in by["tiles/key-check"]["tile"]["perms"] if p["k"].startswith("key:")]
        self.assertEqual(len(keys), 2)
        self.assertTrue(all("sent only to httpbin.org" in p["text"] for p in keys))

    def test_hides_tiles_that_dont_check_out(self):
        clash = entry("spinner", id="clock")
        clash["id"] = "tiles/clock"
        publish([entry("hello-there"),
                 entry("next-up"),                                          # personal data and a site
                 dict(entry("spinner"), id="tiles/someone-else"),           # gallery id doesn't match the tile
                 clash,                                                     # same id as a built-in tile
                 entry("hello-there", code=""),                             # no code
                 entry("hello-there", feeds=["passwords"]),                 # asks for data that doesn't exist
                 dict(entry("hello-there"), kind="theme")])                 # the file inside isn't a theme
        self.assertEqual([e["id"] for e in ct.community_index()["items"]], ["tiles/hello-there"])

    def test_screenshots_only_from_the_gallerys_own_tiles_folder(self):
        publish([dict(entry("moon-facts"), shot="items/tiles/moon-facts.png"), dict(entry("hello-there"), shot="https://elsewhere.example/x.png"),
                 dict(entry("list-count"), shot="../../secret.png")])
        by = {e["id"]: e for e in ct.community_index()["items"]}
        self.assertEqual(by["tiles/moon-facts"]["shot"], "items/tiles/moon-facts.png")
        self.assertNotIn("shot", by["tiles/hello-there"])
        self.assertNotIn("shot", by["tiles/list-count"])

    def test_the_test_galleries_load(self):
        os.environ["COUNTERTOP_GALLERY_URL"] = (GALLERY / "index.json").as_uri()
        self.assertEqual([e["id"] for e in ct.community_index(True)["items"]], ["tiles/hello-there", "tiles/moon-facts", "tiles/list-count", "tiles/front-porch"])
        got = commtiles.gallery_shot("tiles/moon-facts", ct.community_index(), community.gallery_url())
        self.assertEqual(got[1], "image/png")
        os.environ["COUNTERTOP_GALLERY_URL"] = (GALLERY / "index-update.json").as_uri()
        d = ct.community_index(True)
        self.assertEqual(d["revoked"], ["tiles/front-porch"])
        self.assertEqual({e["id"]: e["version"] for e in d["items"]}["tiles/moon-facts"], 2)


class Download(Base):
    def test_downloads_only_with_consent_to_everything(self):
        publish([entry("moon-facts")])
        with self.assertRaises(PermissionError) as e:
            commtiles.install("tiles/moon-facts", ["feed:wx", "taps"], ct.community_index(True))
        self.assertEqual(len(e.exception.perms), 3)
        self.assertFalse((sbx.TILES_DIR / "moon-facts.json").exists())
        self.assertEqual(download("tiles/moon-facts"), {"type": "moon-facts", "version": 1})
        t = sbx.community_tile("moon-facts")
        self.assertEqual(t["gallery"], {"id": "tiles/moon-facts", "v": 1, "by": "someone", "perms": ["feed:wx", "host:api.example.com", "taps"]})
        self.assertEqual(sbx.tile_hosts("moon-facts"), ["api.example.com"])
        self.assertEqual(sbx.tile_frame_page("moon-facts")[0], 200)

    def test_the_code_comes_from_the_gallery_not_the_browser(self):
        publish([entry("hello-there")])
        commtiles.install("tiles/hello-there", [], dict(ct.community_index(True)))
        self.assertEqual(sbx.community_tile("hello-there")["code"], fixture("hello-there")["code"])

    def test_refuses_what_the_gallery_doesnt_list_or_took_down(self):
        publish([entry("hello-there")], revoked=["tiles/moon-facts"])
        for gid, why in (("tiles/moon-facts", "took this tile down"), ("tiles/gone", "doesn't list"), ("themes/calm", "isn't a community tile"), (None, "isn't")):
            with self.assertRaises(ValueError) as e:
                commtiles.install(gid, [], ct.community_index(True))
            self.assertIn(why, str(e.exception))

    def test_doesnt_replace_a_tile_put_there_by_hand(self):
        sbx.TILES_DIR.mkdir(parents=True)
        (sbx.TILES_DIR / "hello-there.json").write_text(json.dumps(fixture("hello-there")))
        publish([entry("hello-there")])
        with self.assertRaises(ValueError) as e:
            download("tiles/hello-there")
        self.assertIn("already installed", str(e.exception))

    def test_update_with_nothing_new_and_with_more(self):
        publish([entry("moon-facts")])
        download("tiles/moon-facts")
        old = consent("tiles/moon-facts")
        publish([entry("moon-facts", 2, code=fixture("moon-facts")["code"] + "\n// v2\n")])
        commtiles.install("tiles/moon-facts", old, ct.community_index(True))        # same permissions: the old list is enough
        self.assertEqual(sbx.community_tile("moon-facts")["version"], 2)
        self.assertIn("// v2", sbx.community_tile("moon-facts")["code"])
        publish([entry("moon-facts", 3, hosts=["api.example.com", "api2.example.com"])])
        with self.assertRaises(PermissionError):
            commtiles.install("tiles/moon-facts", old, ct.community_index(True))     # a new site asks again
        self.assertEqual(sbx.community_tile("moon-facts")["version"], 2)
        download("tiles/moon-facts")
        self.assertEqual(sbx.community_tile("moon-facts")["hosts"], ["api.example.com", "api2.example.com"])

    def test_a_new_button_asks_again(self):
        publish([entry("front-porch")])
        download("tiles/front-porch")
        old = consent("tiles/front-porch")
        more = fixture("front-porch")["controls"] + [{"id": "toggle", "device": "light", "action": "toggle"}]
        publish([entry("front-porch", 2, controls=more)])
        with self.assertRaises(PermissionError):
            commtiles.install("tiles/front-porch", old, ct.community_index(True))
        less = [c for c in fixture("front-porch")["controls"] if c["id"] != "unlock"]
        publish([entry("front-porch", 2, controls=less)])
        commtiles.install("tiles/front-porch", old, ct.community_index(True))        # fewer things: no need to ask
        self.assertEqual(sbx.community_tile("front-porch")["version"], 2)

    def test_a_new_key_or_personal_data_asks_again(self):
        publish([entry("hello-there")])
        download("tiles/hello-there")
        for change in ({"feeds": ["notes"]}, {"taps": True}, {"hosts": ["api.example.com"], "settings": {
                "k": {"type": "secret", "label": "Key", "host": "api.example.com", "header": "X-Key"}}}):
            publish([entry("hello-there", 2, **change)])
            with self.assertRaises(PermissionError):
                commtiles.install("tiles/hello-there", [], ct.community_index(True))

    def test_remove_drops_the_tile_and_its_keys(self):
        publish([entry("key-check")])
        download("tiles/key-check")
        tilekeys.save_key(sbx.community_tile("key-check"), "key", "test-key-123")
        tilekeys.save_key(sbx.community_tile("key-check"), "token", "test-token-456")
        commtiles.remove("key-check")
        self.assertIsNone(sbx.community_tile("key-check"))
        self.assertNotIn("test-key-123", tilekeys.KEYS_FILE.read_text())
        self.assertEqual(tilekeys.saved_key_values(), set())
        with self.assertRaises(ValueError):
            commtiles.remove("key-check")
        (sbx.TILES_DIR.parent.parent / "dashboard.json").write_text("{}")
        for bad in ("../../dashboard", "../takedowns", "", None, "Key-Check"):
            with self.assertRaises(ValueError):
                commtiles.remove(bad)
        self.assertTrue((sbx.TILES_DIR.parent.parent / "dashboard.json").exists())


class TakeDowns(Base):
    def setUp(self):
        super().setUp()
        publish([entry("hello-there"), entry("moon-facts")])
        download("tiles/hello-there")
        download("tiles/moon-facts")
        if sbx.TAKEDOWN_FILE.exists():
            sbx.TAKEDOWN_FILE.unlink()

    def test_a_take_down_stops_the_tile_and_a_relisting_starts_it(self):
        publish([entry("hello-there"), entry("moon-facts")], revoked=["tiles/moon-facts"])
        v = ct.dash_version()
        self.assertTrue(commtiles.takedown_check(ct.community_index, now=1e9))
        self.assertEqual(sbx.taken_down(), {"moon-facts"})
        self.assertEqual(sbx.tile_frame_code("moon-facts")[0], 404)
        self.assertIn(b"taken down", sbx.tile_frame_page("moon-facts")[1])
        self.assertIsNone(sbx.tile_hosts("moon-facts"))
        self.assertTrue(sbx.sandbox_view()["tiles"]["moon-facts"]["revoked"])
        self.assertNotIn("revoked", sbx.sandbox_view()["tiles"]["hello-there"])
        self.assertEqual(sbx.tile_frame_code("hello-there")[0], 200)
        self.assertNotEqual(ct.dash_version(), v)                    # the screens start again without it
        self.assertEqual(sbx.sandbox_status()["takenDown"], ["Moon facts"])
        self.assertTrue(any("taken down" in t for _, t in sbx.sandbox_problems()))
        publish([entry("hello-there"), entry("moon-facts")])
        self.assertTrue(commtiles.takedown_check(ct.community_index, now=1e9 + DAY + 1))
        self.assertEqual(sbx.taken_down(), set())
        self.assertEqual(sbx.tile_frame_code("moon-facts")[0], 200)

    def test_once_a_day_and_an_hour_after_a_failure(self):
        calls = []

        def fetch(refresh):
            calls.append(refresh)
            return ct.community_index(refresh)
        self.assertTrue(commtiles.takedown_check(fetch, now=1e9))
        self.assertFalse(commtiles.takedown_check(fetch, now=1e9 + DAY - 60))
        self.assertTrue(commtiles.takedown_check(fetch, now=1e9 + DAY + 1))
        self.assertEqual(calls, [True, True])
        INDEX.write_text("not json")
        community.CACHE.update(at=0.0, data=None)
        self.assertTrue(commtiles.takedown_check(fetch, now=1e9 + 2 * DAY + 2))
        st = commtiles.takedowns()
        self.assertTrue(st["error"])
        self.assertEqual(st["checked"], int(1e9 + DAY + 1))
        self.assertFalse(commtiles.takedown_check(fetch, now=1e9 + 2 * DAY + 600))        # not again within the hour
        self.assertTrue(commtiles.takedown_check(fetch, now=1e9 + 2 * DAY + 3700))

    def test_nothing_is_read_without_a_downloaded_tile(self):
        for t in ("hello-there", "moon-facts"):
            commtiles.remove(t)
        sbx.TILES_DIR.mkdir(parents=True, exist_ok=True)
        (sbx.TILES_DIR / "spinner.json").write_text(json.dumps(fixture("spinner")))      # one put there by hand
        self.assertFalse(commtiles.takedown_check(lambda r: self.fail("read the gallery"), now=1e9))

    def test_the_check_reads_the_plain_index_and_sends_nothing(self):
        seen = []

        class Spy:
            def __init__(self, req):
                seen.append(req)
        real = community.urlopen
        community.urlopen = lambda req, timeout=None: (Spy(req), real(req, timeout=timeout))[1]
        try:
            commtiles.takedown_check(ct.community_index, now=1e9)
        finally:
            community.urlopen = real
        self.assertEqual(len(seen), 1)
        req = seen[0]
        self.assertEqual(req.full_url, INDEX.as_uri())
        self.assertIsNone(req.data)
        self.assertEqual(sorted(k.lower() for k in req.headers), ["accept", "user-agent"])

    def test_opening_community_notes_take_downs_too(self):
        publish([entry("hello-there")], revoked=["tiles/hello-there"])
        ct.community_index(True)
        self.assertEqual(sbx.taken_down(), {"hello-there"})


class Routes(Base):
    @classmethod
    def setUpClass(cls):
        cls.srv = ct.ThreadingHTTPServer(("127.0.0.1", 0), ct.Handler)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def post(self, path, body, headers=None):
        req = Request(self.base + path, data=json.dumps(body).encode(), headers=dict({"Content-Type": "application/json"}, **(headers or {})))
        try:
            with urlopen(req) as r:
                return r.status, json.loads(r.read() or b"null")
        except HTTPError as e:
            return e.code, json.loads(e.read() or b"null") if e.code != 403 else None

    def test_download_update_and_remove(self):
        publish([entry("moon-facts")])
        self.assertEqual(self.post("/community/tile", {"id": "tiles/moon-facts", "consent": []})[0], 409)
        code, j = self.post("/community/tile", {"id": "tiles/moon-facts", "consent": ["feed:wx"]})
        self.assertEqual((code, j["ask"], len(j["perms"])), (409, True, 3))
        self.assertEqual(self.post("/community/tile", {"id": "tiles/moon-facts", "consent": consent("tiles/moon-facts")}), (200, {"type": "moon-facts", "version": 1}))
        with urlopen(self.base + "/config") as r:
            self.assertEqual(json.loads(r.read())["sandbox"]["tiles"]["moon-facts"]["gallery"]["v"], 1)
        self.assertEqual(self.post("/community/tile/remove", {"type": "moon-facts"}), (200, {"removed": "moon-facts"}))
        self.assertEqual(self.post("/community/tile/remove", {"type": "moon-facts"})[0], 400)

    def test_a_tile_frame_cant_download_or_remove(self):
        publish([entry("hello-there")])
        self.assertEqual(self.post("/community/tile", {"id": "tiles/hello-there", "consent": []}, {"Origin": "null"})[0], 403)
        self.assertFalse((sbx.TILES_DIR / "hello-there.json").exists())

    def test_screenshot(self):
        shutil.copytree(GALLERY / "items", INDEX.parent / "items", dirs_exist_ok=True)
        publish([dict(entry("moon-facts"), shot="items/tiles/moon-facts.png"), entry("hello-there")])
        with urlopen(self.base + "/community/shot?id=tiles/moon-facts") as r:
            self.assertEqual((r.status, r.headers["Content-Type"]), (200, "image/png"))
        for gid in ("tiles/hello-there", "tiles/nope", "../index.json"):
            with self.assertRaises(HTTPError):
                urlopen(self.base + "/community/shot?id=" + gid)


if __name__ == "__main__":
    unittest.main()
