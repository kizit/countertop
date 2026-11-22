"""Home Assistant support: talks to a stand-in Home Assistant and checks the token never leaves the server.

Run with: python3 tests/test_home_assistant.py
"""

import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
from tempfile import TemporaryDirectory
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import zipfile

ROOT = Path(__file__).resolve().parent.parent
TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJjb3VudGVydG9wLXRlc3QifQ.c2VjcmV0LXNpZ25hdHVyZS1mb3ItdGVzdHM"
STATES = {
    "light.kitchen": {"state": "off", "attributes": {"friendly_name": "Kitchen", "brightness": 128}},
    "sensor.outside": {"state": "61.3", "attributes": {"friendly_name": "Outside", "unit_of_measurement": "°F", "device_class": "temperature"}},
    "lock.front_door": {"state": "locked", "attributes": {"friendly_name": "Front door"}},
    "climate.living": {"state": "heat", "attributes": {"friendly_name": "Living", "current_temperature": 19.4, "temperature": 21,
                                                       "hvac_action": "heating", "hvac_modes": ["off", "heat"], "min_temp": 7, "max_temp": 35}},
}
CALLS = []


class FakeHA(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authed(self):
        if self.headers.get("Authorization") != "Bearer " + TOKEN:
            self._send(401, {"message": "Invalid authentication"})
            return False
        return True

    def do_GET(self):
        if not self._authed():
            return
        if self.path == "/api/config":
            self._send(200, {"version": "2026.11.0", "location_name": "Test home"})
        elif self.path == "/api/states":
            self._send(200, [dict(v, entity_id=k, last_changed="2026-11-20T12:00:00+00:00") for k, v in STATES.items()])
        else:
            self._send(404, {})

    def do_POST(self):
        if not self._authed():
            return
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        CALLS.append((self.path, body))
        if self.path == "/api/services/light/toggle":
            st = STATES[body["entity_id"]]
            st["state"] = "on" if st["state"] == "off" else "off"
        self._send(200, [])

    def log_message(self, *a):
        pass


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class HomeAssistantTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ha = ThreadingHTTPServer(("127.0.0.1", 0), FakeHA)
        threading.Thread(target=cls.ha.serve_forever, daemon=True).start()
        cls.ha_url = "http://127.0.0.1:%d" % cls.ha.server_address[1]
        cls.tmp = TemporaryDirectory()
        port = free_port()
        cls.base = "http://127.0.0.1:%d" % port
        env = dict(os.environ, COUNTERTOP_DATA=cls.tmp.name, COUNTERTOP_NO_UPDATE_CHECK="1")
        cls.proc = subprocess.Popen([sys.executable, str(ROOT / "tools" / "countertop.py"), "--port", str(port)], env=env,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        for _ in range(100):
            try:
                urlopen(cls.base + "/version", timeout=1)
                break
            except Exception:
                time.sleep(0.1)
        else:
            raise RuntimeError("server didn't start")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        out = cls.proc.communicate(timeout=10)[0]
        cls.ha.shutdown()
        cls.tmp.cleanup()
        assert TOKEN.encode() not in out, "the token was printed to the console"

    def req(self, path, payload=None):
        r = Request(self.base + path, data=json.dumps(payload).encode() if payload is not None else None, headers={"Content-Type": "application/json"})
        try:
            with urlopen(r, timeout=10) as resp:
                raw = resp.read()
                return resp.status, raw
        except HTTPError as e:
            return e.code, e.read()

    def json(self, path, payload=None):
        code, raw = self.req(path, payload)
        return code, json.loads(raw)

    def act(self, tile, args, action="ha.call"):
        return self.json("/tile-act/" + tile, {"action": action, "args": args})

    def save_tiles(self, ha, sensor=None):
        _, cfg = self.json("/config")
        mods = cfg["modules"]
        mods["tiles"]["settings"]["items"] = [{"id": "t_ha", "type": "ha", "settings": ha},
                                              {"id": "t_sensor", "type": "hasensor", "settings": sensor or {"entity": "sensor.outside"}}]
        self.json("/config", {"modules": mods})

    def test_1_test_button(self):
        _, j = self.json("/sources/test", {"kind": "homeassistant", "item": {"url": self.ha_url, "token": "wrong"}})
        self.assertFalse(j["ok"])
        self.assertIn("token", j["error"])
        _, j = self.json("/sources/test", {"kind": "homeassistant", "item": {"url": self.ha_url, "token": TOKEN}})
        self.assertTrue(j["ok"], j)
        self.assertEqual(j["count"], 4)

    def test_2_flow(self):
        _, j = self.json("/sources", {"kind": "homeassistant", "op": "add", "item": {"name": "Home", "url": self.ha_url, "token": TOKEN}})
        src = j["sources"]["homeassistant"][0]
        self.assertTrue(src["tokenSet"])
        self.assertNotIn("token", src)

        _, j = self.json("/ha/states?ids=light.kitchen,sensor.outside,light.missing")
        self.assertEqual(j["error"], "")
        self.assertEqual([s["state"] for s in j["states"]], ["off", "61.3", "missing"])
        self.assertEqual(j["states"][0]["level"], 50)

        # a thermostat carries what it is doing right now, so a temperature tile can colour itself
        _, j = self.json("/ha/states?ids=climate.living")
        th = j["states"][0]
        self.assertEqual((th["state"], th["action"], th["current"], th["target"]), ("heat", "heating", 19.4, 21))

        _, j = self.json("/ha/entities")
        self.assertEqual(len(j["entities"]), 4)

        # a tile that isn't on the saved dashboard can't control anything
        code, j = self.act("t_ha", {"entity": "light.kitchen"})
        self.assertEqual(code, 404)

        self.save_tiles({"entities": ["light.kitchen", "lock.front_door"]})
        code, j = self.act("t_ha", {"entity": "light.kitchen"})
        self.assertEqual(code, 200, j)
        self.assertEqual(j["state"]["state"], "on")
        self.assertEqual(CALLS[-1], ("/api/services/light/toggle", {"entity_id": "light.kitchen"}))
        code, _ = self.act("t_ha", {"entity": "sensor.outside"})                # not in this tile
        self.assertEqual(code, 403)
        code, _ = self.act("t_sensor", {"entity": "light.kitchen", "action": "toggle"})   # in another tile, not this one
        self.assertEqual(code, 403)

        # locks: shown, but not controllable until the tile allows it
        n = len(CALLS)
        code, j = self.act("t_ha", {"entity": "lock.front_door", "action": "unlock"})
        self.assertEqual(code, 403)
        self.assertIn("Allow locks", j["error"])
        self.save_tiles({"entities": ["light.kitchen", "lock.front_door"], "secure": True})
        code, j = self.act("t_ha", {"entity": "lock.front_door", "action": "unlock"})   # two taps by default
        self.assertEqual(code, 200)
        self.assertTrue(j["confirm"])
        self.assertEqual(len(CALLS), n, "the first tap must not unlock")
        code, again = self.act("t_ha", {"entity": "lock.front_door", "action": "unlock", "confirm": "made-up"})
        self.assertIn("confirm", again)
        self.assertEqual(len(CALLS), n)
        code, j2 = self.act("t_ha", {"entity": "lock.front_door", "action": "lock", "confirm": again["confirm"]})
        self.assertIn("confirm", j2, "a token is only good for the action it was given for")
        code, j3 = self.act("t_ha", {"entity": "lock.front_door", "action": "lock", "confirm": j2["confirm"]})
        self.assertEqual(code, 200, j3)
        self.assertEqual(CALLS[-1], ("/api/services/lock/lock", {"entity_id": "lock.front_door"}))
        code, j = self.act("t_ha", {"entity": "lock.front_door", "action": "lock", "confirm": j2["confirm"]})
        self.assertIn("confirm", j, "a token works once")
        self.save_tiles({"entities": ["light.kitchen", "lock.front_door"], "secure": True, "confirm": "One tap"})
        code, j = self.act("t_ha", {"entity": "lock.front_door", "action": "unlock"})
        self.assertEqual(code, 200, j)
        self.assertEqual(CALLS[-1], ("/api/services/lock/unlock", {"entity_id": "lock.front_door"}))

        # the Sensor tile: a reading can be refreshed
        code, j = self.act("t_sensor", {"entity": "sensor.outside", "action": "update_entity"})
        self.assertEqual(code, 200, j)
        self.assertEqual(CALLS[-1], ("/api/services/homeassistant/update_entity", {"entity_id": "sensor.outside"}))
        # "only show things": nothing at all, on either kind of tile
        self.save_tiles({"entities": ["light.kitchen"], "taps": False}, {"entity": "sensor.outside", "taps": False})
        code, _ = self.act("t_ha", {"entity": "light.kitchen"})
        self.assertEqual(code, 403)
        code, _ = self.act("t_sensor", {"entity": "sensor.outside", "action": "update_entity"})
        self.assertEqual(code, 403)
        code, _ = self.act("t_ha", {"entity": "light.kitchen"}, action="no.such")
        self.assertEqual(code, 400)

        # an allowed action with data: only known scalar keys are passed on
        self.save_tiles({"entities": ["light.kitchen", "lock.front_door"]})
        code, j = self.act("t_ha", {"entity": "light.kitchen", "action": "turn_on",
                                    "data": {"brightness_pct": 40, "rgb_color": [1, 2, 3], "flash": "long"}})
        self.assertEqual(code, 200, j)
        self.assertEqual(CALLS[-1], ("/api/services/light/turn_on", {"entity_id": "light.kitchen", "brightness_pct": 40}))
        # an action the domain doesn't have
        code, _ = self.act("t_ha", {"entity": "light.kitchen", "action": "set_temperature", "data": {"temperature": 20}})
        self.assertEqual(code, 403)
        # with the setting off, a lock shown on a tile can't be changed in any way
        n = len(CALLS)
        for action in ("unlock", "lock", "open"):
            code, _ = self.act("t_ha", {"entity": "lock.front_door", "action": action})
            self.assertEqual(code, 403, action)
        self.assertEqual(len(CALLS), n)

        # an update with the token left blank keeps the saved one
        self.json("/sources", {"kind": "homeassistant", "op": "update", "item": {"id": src["id"], "name": "House", "url": self.ha_url, "token": ""}})
        _, j = self.json("/ha/states?ids=light.kitchen")
        self.assertEqual(j["error"], "")

    def test_3_token_stays_on_server(self):
        for path in ("/config", "/sources", "/status", "/ha/states?ids=light.kitchen", "/ha/entities"):
            _, raw = self.req(path)
            self.assertNotIn(TOKEN.encode(), raw, path)
            self.assertNotIn(TOKEN.split(".")[2].encode(), raw, path)
        _, raw = self.req("/diagnostics")
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            blob = b"".join(z.read(n) for n in z.namelist())
        self.assertNotIn(TOKEN.encode(), blob)
        self.assertNotIn(TOKEN.split(".")[2].encode(), blob)
        self.assertIn(b'"token": "set"', blob)


if __name__ == "__main__":
    unittest.main(verbosity=2)
