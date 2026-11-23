"""Control tiles on the server: what a tile file may declare, and that a button works only the device the person
picked for that tile, only the way the tile file says, with locks behind their switch and a confirm. Tile code
can't send actions at all.

Run with: python3 tests/test_control_tiles.py
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
sys.path.insert(0, str(ROOT / "tests"))
from fake_ha import TOKEN, FakeHA  # noqa: E402

sbx = ct.sandbox
from server import actions, config, homeassistant  # noqa: E402
FIXTURES = ROOT / "tests" / "fixtures" / "community-tiles"
PORCH = json.loads((FIXTURES / "front-porch.json").read_text())


def tile_file(**change):
    t = copy.deepcopy(PORCH)
    t.update(change)
    return t


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        FakeHA.quiet = True
        cls.ha = ct.ThreadingHTTPServer(("127.0.0.1", 0), FakeHA)
        threading.Thread(target=cls.ha.serve_forever, daemon=True).start()
        src = {"id": "ha1", "name": "Home", "url": "http://127.0.0.1:%d" % cls.ha.server_address[1], "token": TOKEN}
        ct.sources.sources_write(dict(ct.sources.sources_load(), homeassistant=[src]))

    @classmethod
    def tearDownClass(cls):
        cls.ha.shutdown()

    def setUp(self):
        FakeHA.reset()
        homeassistant.HA_CACHE.clear()
        actions.CONFIRMS.clear()
        shutil.rmtree(sbx.TILES_DIR, ignore_errors=True)
        sbx.TILES_DIR.mkdir(parents=True)
        shutil.copy(FIXTURES / "front-porch.json", sbx.TILES_DIR / "front-porch.json")
        if sbx.SAFE_FILE.exists():
            sbx.SAFE_FILE.unlink()

    def save(self, *tiles):
        mods = config.config_load()["modules"]
        mods["tiles"]["settings"]["items"] = list(tiles)
        config.config_save({"modules": mods}, quiet=True)

    def porch(self, **grants):
        s = {"@src": "ha1", "@light": "light.porch", "@lock": "lock.front_door"}
        s.update(grants)
        return {"id": "t_porch", "type": "front-porch", "settings": {k: v for k, v in s.items() if v is not None}}

    def press(self, control, tid="t_porch", **more):
        return actions.tile_act(tid, {"action": "tile.control", "args": dict({"control": control}, **more)})

    def called(self):
        return [(p.split("/")[-1], b.get("entity_id")) for p, b in FakeHA.calls]


class TileFiles(unittest.TestCase):
    def test_the_fixture(self):
        t = sbx.clean_tile(PORCH)
        self.assertEqual(sorted(t["devices"]), ["light", "lock"])
        self.assertEqual(t["devices"]["light"], {"label": "Porch light", "domains": ["light", "switch"], "secure": False})
        self.assertTrue(t["devices"]["lock"]["secure"])
        self.assertEqual([c["id"] for c in t["controls"]], ["on", "off", "lock", "unlock"])
        self.assertIn("devices", t["personal"])         # the state of the house is personal: no internet

    def test_a_control_tile_gets_no_sites(self):
        t = sbx.clean_tile(tile_file(hosts=["api.example.com"]))
        self.assertEqual((t["hosts"], t["hostsDropped"]), ([], True))

    def test_tiles_without_controls_are_unchanged(self):
        t = sbx.clean_tile(json.loads((FIXTURES / "moon-facts.json").read_text()))
        self.assertEqual((t["devices"], t["controls"]), ({}, []))
        self.assertNotIn("devices", t["personal"])

    def test_what_is_refused(self):
        dev = {"light": {"label": "Lamp", "domains": ["light"]}}
        ctl = [{"id": "on", "device": "light", "action": "turn_on"}]
        bad = {
            "no devices": dict(devices={}, controls=ctl),
            "controls only": dict(devices=None, controls=ctl),
            "no controls": dict(devices=dev, controls=[]),
            "unknown kind": dict(devices={"x": {"domains": ["shell_command"]}}, controls=[{"id": "go", "device": "x", "action": "turn_on"}]),
            "bad slot name": dict(devices={"Big Lamp": {"domains": ["light"]}}, controls=ctl),
            "undeclared device": dict(devices=dev, controls=[{"id": "on", "device": "lock", "action": "unlock"}]),
            "action the kind can't do": dict(devices=dev, controls=[{"id": "go", "device": "light", "action": "unlock"}]),
            "action only one kind can do": dict(devices={"x": {"domains": ["light", "lock"]}}, controls=[{"id": "go", "device": "x", "action": "unlock"}]),
            "a code in the data": dict(devices={"a": {"domains": ["alarm_control_panel"]}}, controls=[{"id": "off", "device": "a", "action": "disarm", "data": {"code": "1234"}}]),
            "data Countertop doesn't pass on": dict(devices=dev, controls=[{"id": "on", "device": "light", "action": "turn_on", "data": {"entity_id": "lock.front_door"}}]),
            "nested data": dict(devices=dev, controls=[{"id": "on", "device": "light", "action": "turn_on", "data": {"brightness_pct": [50]}}]),
            "same id twice": dict(devices=dev, controls=ctl + ctl),
            "too many": dict(devices=dev, controls=[{"id": "c%d" % i, "device": "light", "action": "toggle"} for i in range(13)]),
        }
        for why, change in bad.items():
            raw = tile_file(**change)
            if change.get("devices") is None:
                raw.pop("devices")
            with self.assertRaises(ValueError, msg=why):
                sbx.clean_tile(raw)
        ok = sbx.clean_tile(tile_file(devices=dev, controls=[{"id": "dim", "device": "light", "action": "turn_on", "data": {"brightness_pct": 30}}]))
        self.assertEqual(ok["controls"][0]["data"], {"brightness_pct": 30})

    def test_a_tile_cant_name_settings_like_the_grants(self):
        with self.assertRaises(ValueError):
            sbx.clean_tile(tile_file(settings={"@lock": {"type": "text", "default": "lock.front_door"}}))


class Buttons(Base):
    def test_a_granted_button_does_its_one_thing(self):
        self.save(self.porch())
        code, out = self.press("on")
        self.assertEqual(code, 200, out)
        self.assertEqual(out["state"]["state"], "on")
        self.assertEqual(self.called(), [("turn_on", "light.porch")])

    def test_only_the_button_id_counts(self):
        # whatever else the request says, the tile file and the grant decide what happens
        self.save(self.porch())
        code, out = self.press("on", entity="lock.front_door", action="unlock", data={"code": "1"})
        self.assertEqual(code, 200, out)
        self.assertEqual(self.called(), [("turn_on", "light.porch")])

    def test_an_ungranted_device_is_refused(self):
        self.save(self.porch(**{"@light": None}))
        code, out = self.press("on")
        self.assertEqual(code, 403)
        self.assertIn("Porch light", out["error"])
        self.assertEqual(self.called(), [])

    def test_a_grant_of_the_wrong_kind_is_refused(self):
        # a lock put where the tile expects a light (by hand in the settings file, say) is no grant at all
        self.save(self.porch(**{"@light": "lock.front_door"}))
        self.assertEqual(self.press("on")[0], 403)
        self.assertEqual(self.called(), [])

    def test_unknown_buttons_and_other_tiles(self):
        self.save(self.porch(), {"id": "t_moon", "type": "moon-facts", "settings": {}},
                  {"id": "t_home", "type": "ha", "settings": {"src": "ha1", "entities": ["light.kitchen"]}})
        self.assertEqual(self.press("explode")[0], 403)
        self.assertEqual(self.press("")[0], 403)
        self.assertEqual(self.press("on", tid="t_moon")[0], 403)          # not installed / no controls
        self.assertEqual(self.press("on", tid="t_home")[0], 403)          # a built-in tile has no tile controls
        self.assertEqual(self.press("on", tid="t_nowhere")[0], 404)       # not on the saved dashboard
        self.assertEqual(self.called(), [])

    def test_a_community_tile_cant_use_the_home_tiles_action(self):
        self.save(self.porch())
        code, out = actions.tile_act("t_porch", {"action": "ha.call", "args": {"entity": "lock.front_door", "action": "unlock"}})
        self.assertEqual(code, 403)
        code, out = actions.tile_act("t_porch", {"action": "ha.call", "args": {"entity": "light.porch"}})
        self.assertEqual(code, 403)
        self.assertEqual(self.called(), [])

    def test_a_lock_without_its_switch_is_refused(self):
        self.save(self.porch())
        code, out = self.press("unlock")
        self.assertEqual(code, 403)
        self.assertIn("Allow locks", out["error"])
        self.assertEqual(self.called(), [])

    def test_a_lock_always_needs_the_confirm(self):
        # even set to "One tap" the way the Home tile can be: a community tile always asks
        self.save(self.porch(**{"@secure": True, "confirm": "One tap"}))
        code, out = self.press("unlock")
        self.assertEqual(code, 200)
        self.assertEqual((out["name"], out["seconds"]), ("Front door", actions.CONFIRM_SECONDS))
        self.assertEqual(self.called(), [])
        tok = out["confirm"]
        self.assertEqual(self.press("unlock", confirm="made-up")[1].get("confirm") is not None, True)
        self.assertEqual(self.called(), [])
        code, out = self.press("unlock", confirm=tok)
        self.assertEqual(code, 200, out)
        self.assertEqual(self.called(), [("unlock", "lock.front_door")])
        self.assertIn("confirm", self.press("unlock", confirm=tok)[1])        # a token works once
        self.assertEqual(len(self.called()), 1)

    def test_a_confirm_is_for_one_button(self):
        self.save(self.porch(**{"@secure": True}))
        tok = self.press("lock")[1]["confirm"]
        self.assertIn("confirm", self.press("unlock", confirm=tok)[1])
        self.assertEqual(self.called(), [])

    def test_a_garage_door_counts_as_secure(self):
        t = tile_file(devices={"door": {"label": "Door", "domains": ["cover"]}}, controls=[{"id": "open", "device": "door", "action": "open_cover"}])
        (sbx.TILES_DIR / "front-porch.json").write_text(json.dumps(t))
        self.save({"id": "t_porch", "type": "front-porch", "settings": {"@src": "ha1", "@door": "cover.garage"}})
        self.assertEqual(self.press("open")[0], 403)
        self.save({"id": "t_porch", "type": "front-porch", "settings": {"@src": "ha1", "@door": "cover.garage", "@secure": True}})
        self.assertIn("confirm", self.press("open")[1])
        self.assertEqual(self.called(), [])

    def test_safe_mode_stops_buttons(self):
        self.save(self.porch())
        sbx.set_safe_mode(True, "person")
        self.assertEqual(self.press("on")[0], 403)
        self.assertEqual(self.called(), [])

    def test_a_removed_tile_file_stops_buttons(self):
        self.save(self.porch())
        (sbx.TILES_DIR / "front-porch.json").unlink()
        self.assertEqual(self.press("on")[0], 403)
        self.assertEqual(self.called(), [])


class Routes(Base):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.srv = ct.ThreadingHTTPServer(("127.0.0.1", 0), ct.Handler)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        super().tearDownClass()

    def post(self, path, body, headers=None):
        req = Request(self.base + path, data=json.dumps(body).encode(), headers=dict({"Content-Type": "application/json"}, **(headers or {})))
        try:
            with urlopen(req) as r:
                return r.status, json.loads(r.read() or b"null")
        except HTTPError as e:
            return e.code, e.read()

    def test_the_route(self):
        self.save(self.porch())
        self.assertEqual(self.post("/tile-act/t_porch", {"action": "tile.control", "args": {"control": "on"}})[0], 200)
        self.assertEqual(self.called(), [("turn_on", "light.porch")])

    def test_a_tile_frame_cant_press(self):
        self.save(self.porch())
        self.assertEqual(self.post("/tile-act/t_porch", {"action": "tile.control", "args": {"control": "off"}}, {"Origin": "null"})[0], 403)
        self.assertEqual(self.called(), [])

    def test_config_carries_the_controls_but_not_the_code(self):
        with urlopen(self.base + "/config") as r:
            cfg = json.loads(r.read())
        t = cfg["sandbox"]["tiles"]["front-porch"]
        self.assertEqual(len(t["controls"]), 4)
        self.assertNotIn("code", t)


if __name__ == "__main__":
    unittest.main()
