"""Community tiles on the server: which tile files are accepted, the frame page and its locks, what /tile-fetch lets
each kind of tile read, and safe mode (the Status switch, a screen that goes quiet, a screen that keeps restarting).

Run with: python3 tests/test_sandbox.py
"""

import importlib.util
import json
import os
from pathlib import Path
import re
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
sbx, tf = ct.sandbox, ct.tilefetch
FIXTURES = ROOT / "tests" / "fixtures" / "community-tiles"

POLICY = ("sandbox allow-scripts; default-src 'none'; script-src %s; style-src 'unsafe-inline'; img-src data: blob:; "
          "font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; "
          "worker-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'")


def fixture(name):
    return json.loads((FIXTURES / (name + ".json")).read_text())


def install(*names):
    sbx.TILES_DIR.mkdir(parents=True, exist_ok=True)
    for n in names:
        shutil.copy(FIXTURES / (n + ".json"), sbx.TILES_DIR / (n + ".json"))


class Base(unittest.TestCase):
    def setUp(self):
        shutil.rmtree(sbx.TILES_DIR, ignore_errors=True)
        if sbx.SAFE_FILE.exists():
            sbx.SAFE_FILE.unlink()
        sbx.SBX_SESSIONS.clear()
        sbx.SBX_BOOTS.clear()
        sbx.SBX_NOTES.clear()
        tf.FETCH_CACHE.clear()


class TileFiles(Base):
    def test_the_fixtures_are_good_tiles(self):
        for f in FIXTURES.glob("*.json"):
            t = sbx.clean_tile(json.loads(f.read_text()))
            self.assertEqual(t["id"], f.stem)

    def test_what_is_refused(self):
        good = fixture("moon-facts")
        bad = {
            "not a tile": dict(good, countertop="layout"),
            "id": dict(good, id="Moon Facts!"),
            "built-in": dict(good, id="stocks"),
            "no code": dict(good, code="  "),
            "too big": dict(good, code="x" * (sbx.SBX_MAX_CODE + 1)),
            "version": dict(good, version=0),
            "size": dict(good, size=[100, 8, 8, 6]),
            "feeds": dict(good, feeds=["wx", "passwords"]),
            "hosts": dict(good, hosts=["api.example.com", "192.168.1.1"]),
            "port": dict(good, hosts=["api.example.com:8080"]),
            "setting": dict(good, settings={"x": {"type": "code"}}),
            "source": dict(good, settings={"c": {"type": "source", "kind": "calendars"}}),
        }
        for why, raw in bad.items():
            with self.assertRaises(ValueError, msg=why):
                sbx.clean_tile(raw)

    def test_personal_data_means_no_internet(self):
        t = sbx.clean_tile(fixture("next-up"))
        self.assertEqual(t["personal"], ["events"])
        self.assertEqual(t["hosts"], [])
        self.assertTrue(t["hostsDropped"])
        t = sbx.clean_tile(fixture("moon-facts"))
        self.assertEqual((t["personal"], t["hosts"]), ([], ["api.example.com"]))

    def test_installed_tiles_and_problems(self):
        install("moon-facts", "next-up")
        (sbx.TILES_DIR / "wrong-name.json").write_text(json.dumps(fixture("spinner")))
        (sbx.TILES_DIR / "broken.json").write_text("{")
        got = sbx.community_installed()
        self.assertEqual(sorted(got["tiles"]), ["moon-facts", "next-up"])
        self.assertEqual(sorted(p[0] for p in got["problems"]), ["broken.json", "wrong-name.json"])
        view = sbx.sandbox_view()
        self.assertNotIn("code", view["tiles"]["moon-facts"])
        self.assertEqual((view["max"], view["safe"]), (6, False))
        self.assertTrue(any("wrong-name.json" in p[1] for p in sbx.sandbox_problems()))


class FramePage(Base):
    def test_policy_and_code(self):
        install("moon-facts")
        code, html1, h1 = sbx.tile_frame_page("moon-facts", "kitchen.local:8090")
        self.assertEqual(code, 200)
        # scripts by their exact address, never a nonce: tile code can read a nonce and load a script from anywhere with it
        self.assertEqual(h1["Content-Security-Policy"], POLICY % (
            "http://kitchen.local:8090/tile-frame/moon-facts/runtime.js http://kitchen.local:8090/tile-frame/moon-facts/tile.js"))
        self.assertNotIn("nonce", h1["Content-Security-Policy"] + html1.decode())
        text = html1.decode()
        self.assertIn('src="/tile-frame/moon-facts/tile.js?v=1"', text)
        self.assertRegex(text, r'src="/tile-frame/moon-facts/runtime\.js\?v=\d+"')
        self.assertNotIn("__", re.sub(r"__proto__", "", text))
        self.assertNotIn('Tile("moon-facts"', text)            # the code comes as its own script, never pasted into the page
        self.assertLess(text.index("runtime.js"), text.index("tile.js?v=1"))
        self.assertEqual(sbx.tile_frame_code("moon-facts"), (200, fixture("moon-facts")["code"].encode()))
        self.assertIn(b"stripRTC(W)", sbx.tile_frame_runtime("moon-facts")[1])
        self.assertEqual(sbx.tile_frame_page("nope")[0], 404)
        self.assertEqual(sbx.tile_frame_page("../etc")[0], 404)
        self.assertEqual(sbx.tile_frame_code("nope")[0], 404)
        self.assertEqual(sbx.tile_frame_runtime("nope")[0], 404)
        # a Host that could break out of the policy isn't used
        for bad in ("", "a b", "x; script-src *", "evil.com/x", None):
            self.assertEqual(sbx.tile_frame_page("moon-facts", bad)[0], 400, bad)
        self.assertEqual(sbx.tile_frame_page("moon-facts", "[::1]:8090")[0], 200)

    def test_safe_mode_serves_nothing(self):
        install("moon-facts")
        sbx.set_safe_mode(True, "person")
        code, html, h = sbx.tile_frame_page("moon-facts")
        self.assertEqual(code, 200)
        self.assertNotIn(b"<script", html)
        self.assertTrue(h["Content-Security-Policy"].startswith("sandbox;"))
        self.assertEqual(sbx.tile_frame_code("moon-facts")[0], 404)


class Hosts(Base):
    def test_who_may_fetch_what(self):
        install("moon-facts", "next-up", "spinner")
        self.assertEqual(sbx.tile_hosts("stocks"), ["query1.finance.yahoo.com", "stooq.com"])
        self.assertEqual(sbx.tile_hosts("note"), [])
        self.assertIsNone(sbx.tile_hosts("nope"))
        self.assertEqual(sbx.tile_hosts("moon-facts"), ["api.example.com"])
        self.assertEqual(sbx.tile_hosts("next-up"), [])
        self.assertEqual(sbx.tile_hosts("spinner"), [])
        sbx.set_safe_mode(True, "person")
        self.assertIsNone(sbx.tile_hosts("moon-facts"))
        self.assertEqual(sbx.tile_hosts("stocks"), ["query1.finance.yahoo.com", "stooq.com"])   # built-ins carry on


class SafeMode(Base):
    def beat(self, sid="screenA", showing=("Moon facts",), t=1000, **kw):
        return sbx.sandbox_beat(dict({"session": sid, "showing": list(showing)}, **kw), "10.0.0.9", 1, now=t)

    def test_a_quiet_screen_turns_it_on_without_a_reload(self):
        install("moon-facts")
        v0 = sbx.sandbox_version()
        self.beat(t=1000)
        self.assertFalse(sbx.safe_freeze_check(now=1025))
        self.assertTrue(sbx.safe_freeze_check(now=1031))
        s = sbx.safe_mode()
        self.assertEqual((s["on"], s["why"], s["tiles"]), (True, "froze", ["Moon facts"]))
        self.assertEqual(sbx.sandbox_version(), v0, "a frozen page can't reload, and one that was only cut off may come back")
        self.assertIn("stopped answering", sbx.sandbox_problems()[0][1])
        self.assertIn("Moon facts", sbx.sandbox_problems()[0][1])

    def test_a_page_that_comes_back_had_only_lost_its_connection(self):
        self.beat(t=1000)
        sbx.safe_freeze_check(now=1040)
        self.assertTrue(sbx.safe_mode()["on"])
        self.assertEqual(self.beat(t=1045, gap=1100), {"safe": False})
        self.assertFalse(sbx.safe_mode()["on"])

    def test_a_page_that_was_stuck_stays_off(self):
        self.beat(t=1000)
        sbx.safe_freeze_check(now=1040)
        self.assertEqual(self.beat(t=1200, gap=190000), {"safe": True})
        self.assertEqual(self.beat("screenB", t=1201, gap=10), {"safe": True})

    def test_nothing_showing_means_nothing_to_watch(self):
        self.beat(t=1000)
        self.beat(t=1003, showing=())
        self.assertFalse(sbx.safe_freeze_check(now=2000))
        self.assertFalse(sbx.safe_mode()["on"])

    def test_three_restarts_in_ten_minutes(self):
        for i, t in enumerate((1000, 1100)):
            self.assertEqual(sbx.sandbox_beat({"session": "boot%d" % i, "boot": True, "onPage": ["Moon facts"]}, "x", 7, now=t), {"safe": False})
        # a restart because the settings changed doesn't count
        self.assertEqual(sbx.sandbox_beat({"session": "boot2", "boot": True, "onPage": ["Moon facts"]}, "x", 8, now=1200), {"safe": False})
        self.assertEqual(sbx.sandbox_beat({"session": "boot3", "boot": True, "onPage": ["Moon facts"]}, "x", 7, now=1300), {"safe": True})
        s = sbx.safe_mode()
        self.assertEqual((s["why"], s["tiles"]), ("reloads", ["Moon facts"]))

    def test_coming_back_from_controls_isnt_a_restart(self):
        # the page before closed normally (to Controls, say) and left a note, so the start after it is "clean"
        for i, t in enumerate((1000, 1050, 1100, 1150, 1200)):
            self.assertEqual(sbx.sandbox_beat({"session": "back%d" % i, "boot": True, "clean": True, "onPage": ["Moon facts"]}, "x", 7, now=t), {"safe": False})
        self.assertEqual(len(sbx.SBX_BOOTS), 0)

    def test_a_goodbye_means_its_quiet_isnt_a_freeze(self):
        sbx.sandbox_beat({"session": "leaving1", "showing": ["Moon facts"]}, "x", 7, now=1000)
        sbx.sandbox_beat({"session": "leaving1", "showing": [], "bye": True}, "x", 7, now=1003)
        self.assertFalse(sbx.safe_freeze_check(now=1100))
        self.assertFalse(sbx.safe_mode()["on"])

    def test_a_check_in_that_arrives_after_the_goodbye_is_ignored(self):
        sbx.sandbox_beat({"session": "leaving2", "showing": ["Moon facts"]}, "x", 7, now=1000)
        sbx.sandbox_beat({"session": "leaving2", "showing": [], "bye": True}, "x", 7, now=1004)
        sbx.sandbox_beat({"session": "leaving2", "showing": ["Moon facts"]}, "x", 7, now=1005)      # sent before it, arrived after
        self.assertFalse(sbx.safe_freeze_check(now=1100))
        self.assertFalse(sbx.safe_mode()["on"])

    def test_restarts_spread_out_dont_count(self):
        for i, t in enumerate((1000, 1700, 2400, 3100)):
            self.assertEqual(sbx.sandbox_beat({"session": "boot%d" % i, "boot": True}, "x", 7, now=t), {"safe": False})

    def test_the_status_switch(self):
        v0 = sbx.sandbox_version()
        sbx.set_safe_mode(True, "person")
        self.assertNotEqual(sbx.sandbox_version(), v0, "the screen reloads without community tiles")
        self.assertEqual(sbx.sandbox_status()["why"], "person")
        sbx.set_safe_mode(False)
        self.assertFalse(sbx.safe_mode()["on"])
        self.assertIsNone(sbx.sandbox_status())

    def test_bad_check_ins(self):
        for body in (None, [], {"session": "a b"}, {"session": "<script>"}, {"session": ""}):
            with self.assertRaises(ValueError):
                sbx.sandbox_beat(body, "x", 1)
        sbx.sandbox_beat({"session": "ok12", "showing": ["x" * 500] * 50, "notes": ["n"] * 30}, "x", 1)
        s = sbx.SBX_SESSIONS["ok12"]
        self.assertEqual((len(s["showing"]), len(s["showing"][0])), (20, 60))


class Routes(Base):
    @classmethod
    def setUpClass(cls):
        cls.srv = ct.ThreadingHTTPServer(("127.0.0.1", 0), ct.Handler)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def get(self, path, headers=None):
        try:
            with urlopen(Request(self.base + path, headers=headers or {})) as r:
                return r.status, dict(r.headers), r.read()
        except HTTPError as e:
            return e.code, dict(e.headers), e.read()

    def post(self, path, body, headers=None):
        req = Request(self.base + path, data=json.dumps(body).encode(), headers=dict({"Content-Type": "application/json"}, **(headers or {})))
        try:
            with urlopen(req) as r:
                return r.status, json.loads(r.read() or b"null")
        except HTTPError as e:
            return e.code, e.read()

    def test_frame_routes(self):
        install("moon-facts")
        code, h, body = self.get("/tile-frame/moon-facts")
        self.assertEqual(code, 200)
        self.assertTrue(h["Content-Security-Policy"].startswith("sandbox allow-scripts; default-src 'none'"))
        code, h, body = self.get("/tile-frame/moon-facts/tile.js?v=1")
        self.assertEqual((code, h["Content-Type"].split(";")[0], h["X-Content-Type-Options"]), (200, "application/javascript", "nosniff"))
        self.assertEqual(self.get("/tile-frame/missing")[0], 404)

    def test_config_and_version(self):
        v0 = json.loads(self.get("/version")[2])["v"]
        install("moon-facts")
        cfg = json.loads(self.get("/config")[2])
        self.assertIn("moon-facts", cfg["sandbox"]["tiles"])
        self.assertNotIn("code", json.dumps(cfg["sandbox"]))
        self.assertNotEqual(json.loads(self.get("/version")[2])["v"], v0)

    def test_tile_fetch_route(self):
        install("moon-facts", "next-up")
        q = "/tile-fetch?type={}&url=https%3A%2F%2Fapi.example.com%2Fmoon.json"
        with ct.patch_everywhere("FETCH_RESOLVE", lambda h: ["93.184.215.14"]), \
                ct.patch_everywhere("FETCH_OPEN", lambda h, ip, p, d: (200, {"content-type": "application/json"}, b'{"fact":"far"}')):
            code, h, body = self.get(q.format("moon-facts"))
            self.assertEqual((code, json.loads(body)), (200, {"fact": "far"}))
            self.assertTrue(h["Content-Security-Policy"].startswith("sandbox;"))
            for t in ("next-up", "note", "nope", "../x"):          # personal data, a tile with no sites, unknown kinds
                code, h, body = self.get(q.format(t))
                self.assertEqual(code, 403, t)
            code, h, body = self.get("/tile-fetch?type=moon-facts&url=https%3A%2F%2F127.0.0.1%2F")
            self.assertEqual(code, 403)
            sbx.set_safe_mode(True, "person")
            self.assertEqual(self.get(q.format("moon-facts"))[0], 403)

    def test_beat_safe_switch_and_status(self):
        install("moon-facts")
        self.assertEqual(self.post("/sandbox/beat", {"session": "abcd", "showing": ["Moon facts"]}), (200, {"safe": False}))
        self.assertEqual(self.post("/sandbox/beat", {"session": "no good"})[0], 400)
        self.assertEqual(self.post("/sandbox/safe", {"on": True}), (200, {"safe": True}))
        st = json.loads(self.get("/status")[2])
        self.assertTrue(st["sandbox"]["safe"])
        self.assertTrue(any("Community tiles are off" in p for p in st["problems"]))
        self.assertEqual(self.post("/sandbox/safe", {"on": False}), (200, {"safe": False}))

    def test_a_tile_frame_cant_post(self):
        self.assertEqual(self.post("/sandbox/safe", {"on": False}, {"Origin": "null"})[0], 403)
        self.assertEqual(self.post("/sandbox/beat", {"session": "abcd"}, {"Origin": "null"})[0], 403)


if __name__ == "__main__":
    unittest.main()
