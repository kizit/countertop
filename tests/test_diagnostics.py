"""Download diagnostics: the bundle someone attaches to a bug report. Every saved key, link, sync key and token, the
place, latitude, longitude and ZIP code are blanked out of every file in it, wherever they turn up (the server's
output, the screen's check-ins, server.log, settings), and the text of Note, Countdown and clock countdown tiles is
left out. Run with: python3 tests/test_diagnostics.py
"""

import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import sys
from tempfile import TemporaryDirectory
import unittest
import zipfile

ROOT = Path(__file__).resolve().parent.parent
TMP = TemporaryDirectory()
os.environ["COUNTERTOP_DATA"] = TMP.name
os.environ["COUNTERTOP_NO_UPDATE_CHECK"] = "1"
WORK = Path(TMP.name)

# secrets that look nothing like a Home Assistant token, so only the saved-value list can catch them
IMMICH_KEY = "imm1chK3yAbcdef0123456789"
PUSH_KEY = "pushSyncKey-77aa31"
CAL_URL = "https://calendar.example.com/private-feed-9f8e7d/basic.ics"
PLACE, ZIP, LAT, LON = "Webster Groves", "63119", 38.5926, -90.3573
NOTE = ["Guest Wi-Fi: Hunter2Hunter2", "Back door code 4417"]
DATES = ["Anniversary, 2027-05-02"]
EXTRA = ["Surgery, 2027-01-15"]

shutil.copy(ROOT / "demo" / "work" / "dashboard.json", WORK / "dashboard.json")
cfg = json.loads((WORK / "dashboard.json").read_text())
g = cfg["modules"]["general"]["settings"]
g.update(place=PLACE, lat=LAT, lon=LON)
cfg["modules"]["deals"].setdefault("settings", {})["zip"] = ZIP
items = cfg["modules"]["tiles"]["settings"]["items"]
items += [{"id": "note1", "type": "note", "name": "Note", "settings": {"text": NOTE}},
          {"id": "cd1", "type": "countdown", "name": "Countdown", "settings": {"dates": DATES}},
          {"id": "img1", "type": "image", "name": "Picture", "settings": {"url": "https://cams.example.com/yard/snap.jpg"}}]
next(i for i in items if i["type"] == "clock").setdefault("settings", {})["extra"] = EXTRA
(WORK / "dashboard.json").write_text(json.dumps(cfg))
(WORK / "sources.json").write_text(json.dumps({
    "calendars": [{"id": "c1", "name": "Family", "url": CAL_URL}],
    "lists": [{"id": "l1", "name": "Groceries", "kind": "Sent from another app", "pushKey": PUSH_KEY}],
    "albums": [{"id": "a1", "name": "Kitchen", "kind": "Immich", "server": "http://192.168.1.20:2283", "apiKey": IMMICH_KEY, "album": "Kitchen"}]}))

spec = importlib.util.spec_from_file_location("countertop", ROOT / "tools" / "countertop.py")
ct = importlib.util.module_from_spec(spec)
sys.argv = ["countertop.py"]
spec.loader.exec_module(ct)


def bundle():
    with zipfile.ZipFile(io.BytesIO(ct.status.diagnostics_zip())) as z:
        return {n: z.read(n).decode() for n in z.namelist()}


class Diagnostics(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        leak = "Immich said no to key %s; list key %s; calendar %s; weather for %s %s at %s,%s (%.2f,%.2f)" % (
            IMMICH_KEY, PUSH_KEY, CAL_URL, PLACE, ZIP, LAT, LON, LAT, LON)
        ct.core.CONSOLE.append("oops " + leak)
        ct.core.LOG.write_text(json.dumps({"kind": "page-error", "msg": "oops " + leak}) + "\n")
        (WORK / "server.log").write_text("oops " + leak + "\n")
        cls.files = bundle()

    def test_saved_secrets_and_location_are_removed_everywhere(self):
        for name, text in self.files.items():
            for s in (IMMICH_KEY, PUSH_KEY, CAL_URL, "private-feed-9f8e7d", PLACE, ZIP, str(LAT), str(LON), "%.2f" % LAT, "%.2f" % LON):
                self.assertNotIn(s, text, "%s in %s" % (s, name))
        for name in ("console.log", "heartbeat.log", "server.log"):
            self.assertIn("oops", self.files[name], name)        # the line is kept, only the secrets go
            self.assertIn("<removed>", self.files[name], name)

    def test_tile_text_is_left_out(self):
        text = self.files["settings.json"]
        for s in NOTE + DATES + EXTRA:
            self.assertNotIn(s, text)
        tiles = {i["id"]: i for i in json.loads(text)["tiles"]["settings"]["items"]}
        self.assertEqual(tiles["note1"]["settings"]["text"], "<2 lines removed>")
        self.assertEqual(tiles["cd1"]["settings"]["dates"], "<1 line removed>")

    def test_field_names_are_not_mistaken_for_secrets(self):
        # setting and field names stay readable: only saved values are blanked out
        self.assertIn('"pushKey": "set"', self.files["sources.json"])
        self.assertIn('"url": "set (calendar.example.com)"', self.files["sources.json"])
        self.assertIn('"url": "https://cams.example.com/<removed>"', self.files["settings.json"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
