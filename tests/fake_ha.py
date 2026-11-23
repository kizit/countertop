"""A stand-in Home Assistant for trying control tiles without real devices.

It answers the few API calls Countertop makes (/api/config, /api/states, /api/services/<domain>/<action>), keeps a
porch light, a kitchen light, a front door lock, a garage door and an alarm in memory, changes them when a service is
called, and prints each call. Nothing in the house is touched.

    python3 tests/fake_ha.py                 # listens on port 8123, token: countertop-test
    python3 tests/fake_ha.py --port 8124

Then in Controls → Setup → Home Assistant, add http://<this computer's address>:8123 with the token countertop-test.
The tests use it too (tests/test_control_tiles.py).
"""
import argparse
import copy
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading

TOKEN = "countertop-test"
START = {
    "light.porch": {"state": "off", "attributes": {"friendly_name": "Porch light"}},
    "light.kitchen": {"state": "on", "attributes": {"friendly_name": "Kitchen", "brightness": 200}},
    "switch.fountain": {"state": "off", "attributes": {"friendly_name": "Fountain"}},
    "lock.front_door": {"state": "locked", "attributes": {"friendly_name": "Front door"}},
    "cover.garage": {"state": "closed", "attributes": {"friendly_name": "Garage door", "device_class": "garage"}},
    "alarm_control_panel.home": {"state": "armed_away", "attributes": {"friendly_name": "Alarm"}},
}
# what each service does to a state here (anything else is accepted and changes nothing)
AFTER = {"turn_on": "on", "turn_off": "off", "lock": "locked", "unlock": "unlocked", "open": "open", "open_cover": "open",
         "close_cover": "closed", "disarm": "disarmed", "arm_home": "armed_home", "arm_away": "armed_away"}


class FakeHA(BaseHTTPRequestHandler):
    states = copy.deepcopy(START)
    calls = []
    lock = threading.Lock()
    quiet = False

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
            self._send(200, {"version": "2026.11.0", "location_name": "Stand-in home"})
        elif self.path == "/api/states":
            with self.lock:
                self._send(200, [dict(v, entity_id=k, last_changed="2026-11-20T12:00:00+00:00") for k, v in self.states.items()])
        else:
            self._send(404, {})

    def do_POST(self):
        if not self._authed():
            return
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        parts = self.path.split("/")              # /api/services/<domain>/<action>
        action = parts[-1] if len(parts) == 5 else ""
        with self.lock:
            self.calls.append((self.path, body))
            st = self.states.get(body.get("entity_id"))
            if st and action == "toggle":
                st["state"] = "off" if st["state"] == "on" else "on"
            elif st and action in AFTER:
                st["state"] = AFTER[action]
        if not self.quiet:
            print("called %s for %s" % (self.path, body.get("entity_id")), flush=True)
        self._send(200, [])

    def log_message(self, *a):
        pass

    @classmethod
    def reset(cls):
        with cls.lock:
            cls.states = copy.deepcopy(START)
            cls.calls.clear()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="A stand-in Home Assistant for trying control tiles.")
    ap.add_argument("--port", type=int, default=8123)
    port = ap.parse_args().port
    print("Stand-in Home Assistant on port %d. Token: %s. Ctrl-C stops it." % (port, TOKEN), flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), FakeHA).serve_forever()
