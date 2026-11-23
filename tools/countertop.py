"""Countertop server: serves the kitchen dashboard and its data feeds.

Start:
    python3 tools/countertop.py --port 8090
    python3 tools/countertop.py --port 8090 --also-tls --tls-port 8443   # also HTTPS (cert in work/tls/)

On the Echo Show (Silk):    http://<server-ip>:8090/dash
Controls (any computer):    http://<server-ip>:8090/control
Grocery list (phone):       http://<server-ip>:8090/list

The dashboard posts heartbeats and page errors to /report; they are appended to work/heartbeat.log.
Controls shows the server's health from /status and offers a redacted bug-report bundle at /diagnostics.
"""
import sys
from pathlib import Path

VERSION = "0.6.1"                 # bump with each release; CHANGELOG.md says what changed

# The server's code lives in tools/server/, one file per area. Everything is re-exported here so
# `python3 tools/countertop.py` and `import countertop` work as before.
sys.path.insert(0, str(Path(__file__).resolve().parent))
# Loading this file again (each test file does, with its own data folder) loads the server's parts again too.
for _k in [k for k in sys.modules if k == "server" or k.startswith("server.")]:
    del sys.modules[_k]
from server import core, app, sources, homeassistant, lists, config, upgrades, actions, library, community, pages, status, tiledata, bench  # noqa: E402
from server.feeds import sports, sky, stocks, meals, sales, cams, photos, calendar  # noqa: E402

for _m in (core, app, sources, homeassistant, lists, config, upgrades, actions, library, community, pages, status, tiledata, bench, sports, sky, stocks, meals, sales, cams, photos, calendar):
    globals().update({k: v for k, v in vars(_m).items() if not k.startswith("__") and k not in ("VERSION", "sys", "Path")})
del _m
from server.app import main  # noqa: E402


class patch_everywhere:
    """For tests: swap `name` for `value` in every part of the server that has it, like unittest.mock.patch.object
    on each (with-statement, or start() and stop())."""
    def __init__(self, name, value):
        import unittest.mock
        self.p = [unittest.mock.patch.object(m, name, value) for m in (core, app, sources, homeassistant, lists, config, upgrades, actions, library, community, pages, status, tiledata, sports, sky, stocks, meals, sales, cams, photos, calendar) if name in vars(m)]

    def start(self):
        for x in self.p:
            x.start()

    def stop(self):
        for x in self.p:
            x.stop()

    def __enter__(self):
        self.start()

    def __exit__(self, *a):
        self.stop()


if __name__ == "__main__":
    main()
