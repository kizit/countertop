"""Tile Studio on the server: your own tiles (save, versions, delete, import and the trust prompt, drafts for the
preview), pictures through /tile-fetch, and the end of Your own tile (which ones convert, how a converted one runs,
Restore, Convert anyway, and that nothing is converted twice).

Run with: python3 tests/test_studio.py
"""

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
sbx, mt, tf = ct.sandbox, ct.mytiles, ct.tilefetch


def own(iid, html, **extra):
    return dict({"id": iid, "type": "custom", "name": "Tile " + iid, "settings": {"html": html, "taps": True, "frame": False}}, **extra)


STATIC = "<div id=n>0</div><button onclick=\"bump(1)\">+1</button><script>var c = 0; function bump(k){ c += k; document.getElementById('n').textContent = c; }</script>"
FETCHING = "<div id=w></div><img src='https://img.example.com/sun.png'><script>fetch('https://api.example.com/now.json').then(r => r.json()).then(j => { w.textContent = j.t; })</script>"
CAMERA = "<img src='http://192.168.1.20/snap.jpg' style='width:100%'>"


def settings_v3(*tiles, lan=()):
    """A settings file from just before Tile Studio (schema 3), with these Your own tiles on Main."""
    slots = [{"id": "s%d" % i, "x": i * 12, "y": 0, "w": 12, "h": 8, "mod": t["id"]} for i, t in enumerate(tiles)]
    data = {"schema": 3, "modules": {"pages": {"on": True, "settings": {"items": [{"id": "main", "name": "Main", "on": True, "cols": 48, "slots": slots}]}},
                                     "tiles": {"on": True, "settings": {"items": [dict(t, lan=True) if t["id"] in lan else t for t in tiles]}}}}
    if lan:
        data["lanTiles"] = {"ids": sorted(lan), "code": sorted(ct.config._code_hash(t) for t in tiles if t["id"] in lan)}
    return data


def reset(data=None):
    for f in Path(ct.CONFIG_FILE).parent.rglob("*"):
        if f.is_file():
            f.unlink()
    ct.CONFIG_PROBLEM.clear()
    sbx.DRAFTS.clear()
    tf.FETCH_CACHE.clear()
    if data is not None:
        ct.CONFIG_FILE.write_text(json.dumps(data))


def items():
    return {t["id"]: t for t in ct.config_load()["modules"]["tiles"]["settings"]["items"]}


def stored():
    return json.loads(ct.CONFIG_FILE.read_text())


def mine_files():
    return sorted(f.stem for f in sbx.MINE_DIR.glob("*.json")) if sbx.MINE_DIR.is_dir() else []


class Precheck(unittest.TestCase):
    def test_what_still_works_in_the_sandbox(self):
        self.assertEqual(mt.precheck(STATIC), {"ok": True, "reasons": [], "hosts": []})
        self.assertEqual(mt.precheck(FETCHING), {"ok": True, "reasons": [], "hosts": ["img.example.com", "api.example.com"]})
        self.assertTrue(mt.precheck("<p>It's 5 o'clock // somewhere</p><script>// a comment\nvar x = 1;</script>")["ok"])

    def test_what_doesnt(self):
        cases = {
            CAMERA: "home network",
            "<script>fetch('http://weather.example.com/x')</script>": "plain http://",
            "<img src='https://printer.local/status.png'>": "home network",
            "<script>fetch('https://10.0.0.2/x')</script>": "home network",
            "<script src='https://cdn.example.com/lib.js'></script>": "scripts from the web",
            "<link rel=stylesheet href='https://fonts.example.com/a.css'>": "styles or fonts",
            "<style>body{background:url(https://img.example.com/bg.jpg)}</style>": "styles use pictures",
            "<script>var x = new XMLHttpRequest()</script>": "XMLHttpRequest",
            "<script>fetch('https://api.example.com/x', {method: 'POST'})</script>": "sends data",
            "<script>document.write('<b>hi</b>')</script>": "document.write",
            "<script>fetch(base + path)</script>": "can't be checked",
            "<a href='https://example.com/'>more</a>": "links that open",
            "<iframe src='https://example.com'></iframe>": "frame",
            "<script>new WebSocket('wss://example.com')</script>": "live connection",
            "<script>setInterval('tick()', 1000)</script>": "code from text",
        }
        for html, why in cases.items():
            r = mt.precheck(html)
            self.assertFalse(r["ok"], html)
            self.assertTrue(any(why in x for x in r["reasons"]), (html, r["reasons"]))

    def test_page_code(self):
        code = mt.page_code("my-x", STATIC)
        self.assertNotIn("onclick", code)
        self.assertNotIn("<script", code)
        self.assertIn('addEventListener("click", function (event) {\nbump(1)\n})', code)
        self.assertIn("function bump(k)", code)
        self.assertLess(code.index("innerHTML = CT_PAGE"), code.index("function bump(k)"))      # the page first, then its scripts
        self.assertIn('Tile("my-x"', code)
        self.assertIn('data-ct-on=\\"0\\"', code)
        # HTML entities in an attribute are the code's text
        self.assertIn("say('a & b')", mt.page_code("my-y", "<b onclick=\"say('a &amp; b')\">x</b>"))


class Conversion(unittest.TestCase):
    def test_the_upgrade_converts_what_works_and_leaves_the_rest(self):
        reset(settings_v3(own("count", STATIC), own("cam", CAMERA), own("weather", FETCHING), lan=("cam", "count")))
        t = items()
        self.assertTrue(t["count"]["type"].startswith("my-"))
        self.assertEqual(t["count"]["settings"], {"frame": False})        # its box looks the same; the code moved into the tile
        self.assertEqual(t["cam"]["type"], "custom")
        self.assertTrue(t["cam"]["lan"])                                   # still working as before, with its access
        self.assertTrue(t["weather"]["type"].startswith("my-"))
        self.assertEqual(stored()["schema"], ct.CONFIG_SCHEMA)
        self.assertEqual(sorted(stored()["lanTiles"]["ids"]), ["cam"])
        tiles = sbx.community_installed()["tiles"]
        c, w = tiles[t["count"]["type"]], tiles[t["weather"]["type"]]
        self.assertEqual((c["mine"]["from"], c["mine"]["backup"], c["mine"]["lan"]), ("custom", True, True))
        self.assertTrue(c["taps"])
        self.assertEqual(c["hosts"], [])
        self.assertEqual(w["hosts"], ["img.example.com", "api.example.com"])
        self.assertEqual(w["uses"], ["fetch"])
        self.assertEqual(sbx.community_installed()["problems"], [])
        legacy = ct.mytiles.legacy_view(ct.config_load()["modules"]["tiles"]["settings"]["items"])
        self.assertEqual(list(legacy), ["cam"])
        self.assertIn("192.168.1.20", legacy["cam"]["reasons"][0])

    def test_an_old_copy_of_the_settings_never_converts_twice(self):
        reset(settings_v3(own("count", STATIC)))
        ct.config_load()
        made = mine_files()
        self.assertEqual(len(made), 1)
        # a Controls page still holding the old settings saves them again
        ct.config_save(settings_v3(own("count", STATIC)))
        self.assertEqual(mine_files(), made)
        self.assertEqual(items()["count"]["type"], made[0])

    def test_restore_puts_the_original_back_with_its_access(self):
        reset(settings_v3(own("count", STATIC), lan=("count",)))
        tid = items()["count"]["type"]
        self.assertNotIn("lanTiles", stored())
        out = ct.config.tile_restore(tid)
        self.assertEqual(out, {"restored": 1, "id": "count"})
        t = items()["count"]
        self.assertEqual((t["type"], t["lan"], t["keep"]), ("custom", True, True))
        self.assertEqual(t["settings"]["html"], STATIC)
        self.assertEqual(stored()["lanTiles"]["ids"], ["count"])
        self.assertNotIn(tid, mine_files())
        # put back on purpose: a later save leaves it alone
        ct.config_save({"modules": ct.config_load()["modules"]})
        self.assertEqual(items()["count"]["type"], "custom")
        with self.assertRaises(ValueError):
            ct.config.tile_restore(tid)

    def test_convert_anyway(self):
        reset(settings_v3(own("cam", CAMERA), lan=("cam",)))
        self.assertEqual(items()["cam"]["type"], "custom")
        tid = ct.config.tile_convert("cam")["type"]
        self.assertEqual(items()["cam"]["type"], tid)
        raw = mt.read(tid)
        self.assertEqual(raw["mine"]["backup"]["lan"], True)
        self.assertIn("home network", raw["mine"]["backup"]["reasons"][0])
        self.assertEqual(raw["hosts"], [])                    # a LAN address never becomes one of its sites
        self.assertNotIn("lanTiles", stored())
        with self.assertRaises(ValueError):
            ct.config.tile_convert("nope")
        ct.config.tile_restore(tid)
        self.assertTrue(items()["cam"]["lan"])

    def test_shared_code_converts_after_run(self):
        reset(settings_v3())
        mods = ct.config_load()["modules"]
        mods["tiles"]["settings"]["items"].append(own("imp", STATIC, review=True))
        ct.config_save({"modules": mods})
        self.assertEqual(items()["imp"]["type"], "custom")          # waits for Run
        self.assertTrue(ct.tile_trust("imp"))
        t = items()["imp"]
        self.assertTrue(t["type"].startswith("my-"))
        self.assertFalse(mt.read(t["type"])["mine"]["backup"]["lan"])

    def test_a_client_cant_claim_access_for_a_backup(self):
        reset(settings_v3())
        mods = ct.config_load()["modules"]
        mods["tiles"]["settings"]["items"].append(own("new", STATIC, lan=True))
        ct.config_save({"modules": mods})
        tid = items()["new"]["type"]
        self.assertFalse(mt.read(tid)["mine"]["backup"]["lan"])
        ct.config.tile_restore(tid)
        self.assertNotIn("lan", items()["new"])

    def test_restore_keeps_current_box_id_and_refuses_when_missing(self):
        reset(settings_v3(own("count", STATIC), lan=("count",)))
        tid = items()["count"]["type"]
        # simulate the tile being in a box with a new id (removed and re-added, or copied)
        mods = ct.config_load()["modules"]
        mods["tiles"]["settings"]["items"] = [dict(t, id="moved_box") if t["id"] == "count" else t for t in mods["tiles"]["settings"]["items"]]
        ct.config_save({"modules": mods})
        out = ct.config.tile_restore(tid)
        self.assertEqual(out, {"restored": 1, "id": "moved_box"})
        self.assertIn("moved_box", items())
        self.assertNotIn("count", items())
        self.assertTrue(items()["moved_box"]["lan"])
        self.assertEqual(stored()["lanTiles"]["ids"], ["moved_box"])
        # restoring a converted tile that is no longer in any box refuses instead of deleting it
        reset(settings_v3(own("count", STATIC)))
        tid2 = items()["count"]["type"]
        mods = ct.config_load()["modules"]
        mods["tiles"]["settings"]["items"] = [t for t in mods["tiles"]["settings"]["items"] if t["id"] != "count"]
        ct.config_save({"modules": mods})
        with self.assertRaises(ValueError):
            ct.config.tile_restore(tid2)
        self.assertIn(tid2, mine_files())

    def test_precheck_svg_and_ports(self):
        svg = mt.precheck('<img src="https://cdn.example.com/icon.svg">')
        self.assertFalse(svg["ok"])
        self.assertTrue(any("SVG" in r for r in svg["reasons"]))
        p443 = mt.precheck('<script>fetch("https://api.example.com:443/v1")</script>')
        self.assertTrue(p443["ok"])
        self.assertEqual(p443["hosts"], ["api.example.com"])
        p8443 = mt.precheck('<script>fetch("https://api.example.com:8443/v1")</script>')
        self.assertFalse(p8443["ok"])
        self.assertTrue(any("port" in r for r in p8443["reasons"]))
        self.assertFalse(any("home network" in r for r in p8443["reasons"]))


class MyTiles(unittest.TestCase):
    def setUp(self):
        reset(settings_v3())

    def tile(self, **kw):
        return dict({"name": "Moon facts", "size": [12, 8, 6, 4], "settings": {"text": {"type": "text", "label": "Text", "default": "hi"}},
                     "code": 'Tile("my-tile", { render(el){ el.textContent = this.s.text; } });'}, **kw)

    def test_save_versions_and_delete(self):
        out = mt.save({"tile": self.tile()})
        self.assertEqual(out, {"id": "my-moon-facts", "version": 1})
        self.assertEqual(mt.save({"tile": self.tile(name="Moon facts")}), {"id": "my-moon-facts-2", "version": 1})
        self.assertEqual(mt.save({"id": "my-moon-facts", "tile": self.tile(description="Now with craters")})["version"], 2)
        t = sbx.community_tile("my-moon-facts")
        self.assertEqual((t["version"], t["desc"], t["mine"]["from"], t["gallery"]), (2, "Now with craters", "studio", None))
        self.assertTrue(sbx.tile_runs(t))
        self.assertEqual(sbx.tile_frame_page("my-moon-facts")[0], 200)
        view = mt.studio_view("my-moon-facts")
        self.assertIn("code", view)
        self.assertEqual(view["mine"]["from"], "studio")
        with self.assertRaises(ValueError):
            mt.save({"tile": self.tile(code="")})
        with self.assertRaises(ValueError):
            mt.save({"tile": self.tile(feeds=["events"], hosts=["api.example.com"], settings={"k": {"type": "secret", "label": "Key", "host": "api.example.com", "header": "X-Key"}})})
        with self.assertRaises(ValueError):
            mt.save({"id": "my-nope", "tile": self.tile()})
        mt.delete("my-moon-facts")
        self.assertIsNone(sbx.community_tile("my-moon-facts"))
        with self.assertRaises(ValueError):
            mt.delete("my-moon-facts")

    def test_ids_stay_apart_from_the_gallery(self):
        self.assertEqual(mt.save({"tile": self.tile(name="Clock")})["id"], "my-clock")
        # a community tile can't take a my- id, and a file in mytiles must have one
        sbx.TILES_DIR.mkdir(parents=True, exist_ok=True)
        (sbx.TILES_DIR / "my-sneaky.json").write_text(json.dumps(dict(self.tile(), countertop="tile", id="my-sneaky", version=1)))
        (sbx.MINE_DIR / "plain.json").write_text(json.dumps(dict(self.tile(), countertop="tile", id="plain", version=1)))
        inst = sbx.community_installed()
        self.assertNotIn("my-sneaky", inst["tiles"])
        self.assertNotIn("plain", inst["tiles"])
        self.assertEqual(len(inst["problems"]), 2)
        entry = {"id": "tiles/my-sneaky", "kind": "tile", "version": 1, "item": dict(self.tile(), countertop="tile", id="my-sneaky")}
        with self.assertRaises(ValueError):
            ct.commtiles.gallery_tile(entry)

    def test_import_waits_for_run(self):
        shared = dict(self.tile(), countertop="tile", id="moon", version=4, code='Tile("moon", { render(el){} });')
        tid = mt.import_tile({"tile": shared})["id"]
        self.assertEqual(tid, "my-moon")
        self.assertEqual(mt.import_tile({"tile": shared})["id"], "my-moon-2")       # never replaces one you have
        t = sbx.community_tile(tid)
        self.assertEqual((t["version"], t["mine"]["review"]), (1, True))
        self.assertIn('Tile("my-moon"', mt.read(tid)["code"])
        self.assertFalse(sbx.tile_runs(t))
        self.assertIn(b"waiting for you", sbx.tile_frame_page(tid)[1])
        self.assertEqual(sbx.tile_frame_code(tid)[0], 404)
        mt.trust(tid)
        self.assertTrue(sbx.tile_runs(sbx.community_tile(tid)))
        with self.assertRaises(ValueError):
            mt.import_tile({"tile": {"countertop": "layout"}})

    def test_drafts_for_the_preview(self):
        mt.save({"tile": self.tile(hosts=["api.example.com"], settings={"key": {"type": "secret", "label": "Key", "host": "api.example.com", "header": "X-Key"}})})
        ct.tilekeys.save_key(sbx.community_tile("my-moon-facts"), "key", "abc123456")
        did = sbx.draft_put(self.tile(hosts=["api.example.com"], settings={"key": {"type": "secret", "label": "Key", "host": "api.example.com", "header": "X-Key"}}), "my-moon-facts")
        self.assertRegex(did, r"^draft-[0-9a-f]{12}$")
        d = sbx.community_tile(did)
        self.assertEqual((d["id"], d["hosts"]), (did, ["api.example.com"]))
        self.assertEqual(ct.tilekeys.fetch_keys(sbx.keys_tile(d))[0]["value"], "abc123456")      # the saved tile's key, for its draft
        self.assertNotIn(did, sbx.sandbox_view()["tiles"])
        v = sbx.sandbox_view(did)["tiles"][did]
        self.assertEqual(v["keys"], {"key": "set"})
        self.assertNotIn("code", v)
        self.assertNotIn("keysOf", v)
        sbx.set_safe_mode(True, "person")
        self.assertEqual(sbx.tile_frame_page(did)[0], 200)            # the preview runs in Controls even in safe mode
        self.assertFalse(sbx.tile_runs(sbx.community_tile("my-moon-facts")))
        sbx.set_safe_mode(False)
        other = sbx.draft_put(self.tile(), "")
        self.assertIsNone(sbx.keys_tile(sbx.community_tile(other)))
        with self.assertRaises(ValueError):
            sbx.draft_put(self.tile(code=""))
        self.assertIsNone(sbx.community_tile("draft-000000000000"))


class Pictures(unittest.TestCase):
    PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 40

    def setUp(self):
        tf.FETCH_CACHE.clear()
        self.saved = (tf.FETCH_RESOLVE, tf.FETCH_OPEN)
        tf.FETCH_RESOLVE = lambda host: ["93.184.216.34"]

    def tearDown(self):
        tf.FETCH_RESOLVE, tf.FETCH_OPEN = self.saved

    def answer(self, body, ctype):
        tf.FETCH_OPEN = lambda host, ip, path, deadline, extra=None: (200, {"content-type": ctype}, body)

    def test_pictures_only(self):
        self.answer(self.PNG, "image/png")
        self.assertEqual(tf.cached_fetch("https://img.example.com/a.png", ["img.example.com"], image=True), {"type": "image/png", "body": self.PNG})
        with self.assertRaises(tf.FetchError):          # a picture isn't text, so it can't be read as text
            tf.fetch_url("https://img.example.com/a.png", ["img.example.com"])
        self.answer(b"<svg xmlns='http://www.w3.org/2000/svg'><script>x</script></svg>", "image/svg+xml")
        with self.assertRaises(tf.FetchError):
            tf.fetch_url("https://img.example.com/a.svg", ["img.example.com"], image=True)
        self.answer(self.PNG, "image/jpeg")             # a site that says one thing and sends another
        with self.assertRaises(tf.FetchError):
            tf.fetch_url("https://img.example.com/a.jpg", ["img.example.com"], image=True)
        self.answer(b"\xff\xd8\xff\xe0rest", "application/octet-stream")
        self.assertEqual(tf.fetch_url("https://img.example.com/b", ["img.example.com"], image=True)["type"], "image/jpeg")
        with self.assertRaises(tf.FetchError):
            tf.fetch_url("https://other.example.com/a.png", ["img.example.com"], image=True)


class Routes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ct.ThreadingHTTPServer(("127.0.0.1", 0), ct.Handler)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def call(self, path, body=None, headers=None):
        req = Request(self.base + path, data=None if body is None else json.dumps(body).encode(),
                      headers=dict({"Content-Type": "application/json"}, **(headers or {})))
        try:
            with urlopen(req) as r:
                return r.status, json.loads(r.read() or b"null")
        except HTTPError as e:
            return e.code, json.loads(e.read() or b"null")

    def test_the_studio_routes(self):
        reset(settings_v3(own("cam", CAMERA)))
        code, out = self.call("/studio/save", {"tile": {"name": "Hello", "code": 'Tile("x", { render(el){ el.textContent = "hi"; } });'}})
        self.assertEqual((code, out), (200, {"id": "my-hello", "version": 1}))
        code, t = self.call("/studio/tile/my-hello")
        self.assertEqual((code, t["name"], t["mine"]["from"]), (200, "Hello", "studio"))
        self.assertEqual(self.call("/studio/tile/hello")[0], 404)
        code, d = self.call("/studio/draft", {"tile": {"name": "Hello", "code": 'Tile("x", {});'}})
        self.assertEqual(code, 200)
        code, cfg = self.call("/config?draft=" + d["id"])
        self.assertIn(d["id"], cfg["sandbox"]["tiles"])
        self.assertIn("my-hello", cfg["sandbox"]["tiles"])
        self.assertEqual(list(cfg["legacy"]), ["cam"])
        self.assertEqual(self.call("/studio/draft", {"tile": {"name": "x"}})[0], 400)
        self.assertEqual(self.call("/tile-key", {"type": d["id"], "name": "k", "value": "secret123456"})[0], 400)
        self.assertEqual(self.call("/studio/convert", {"id": "cam"})[0], 200)
        self.assertEqual(self.call("/config")[1]["legacy"], {})
        code, out = self.call("/studio/check", {"html": CAMERA})
        self.assertFalse(out["ok"])
        # a tile frame may never post anything
        self.assertEqual(self.call("/studio/delete", {"id": "my-hello"})[0], 200)
        self.assertEqual(self.call("/studio/delete", {"id": "my-hello"})[0], 400)

    def test_a_frame_cant_post(self):
        req = Request(self.base + "/studio/save", data=b"{}", headers={"Content-Type": "application/json", "Origin": "null"})
        with self.assertRaises(HTTPError) as e:
            urlopen(req)
        self.assertEqual(e.exception.code, 403)


if __name__ == "__main__":
    unittest.main()
