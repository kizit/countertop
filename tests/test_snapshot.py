"""Screen snapshot for bug reports: a screen answers a request with measurements only; it is scrubbed, kept in memory,
summarised for the bug form and included in the diagnostics file. Run with: python3 tests/test_snapshot.py
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
shutil.copy(ROOT / "demo" / "work" / "dashboard.json", Path(TMP.name) / "dashboard.json")
(Path(TMP.name) / "sources.json").write_text(json.dumps({"calendars": [{"id": "c1", "name": "Family", "url": "https://cal.example.com/private-9f8e7d/basic.ics"}]}))

spec = importlib.util.spec_from_file_location("countertop", ROOT / "tools" / "countertop.py")
ct = importlib.util.module_from_spec(spec)
sys.argv = ["countertop.py"]
spec.loader.exec_module(ct)
snap = ct.snapshot

DATA = {"env": {"ua": "Mozilla/5.0 (Linux; Android) Silk/130 like Chrome", "win": "1280x800", "screen": "1280x800", "dpr": 1.5,
                "orientation": "landscape", "fullscreen": True},
        "page": "main", "look": {"mode": "Dark"},
        "overlaps": [{"tile": "weather", "a": "span.deg", "b": "div.cond", "by": "9x14"}],
        "clipped": [], "tiles": [{"id": "weather", "type": "weather", "box": [10, 10, 300, 200], "text": []}],
        "note": "see https://cal.example.com/private-9f8e7d/basic.ics from 192.168.1.20"}


class Snapshot(unittest.TestCase):
    def setUp(self):
        snap.SNAP.update(want=0, data=None, at=0.0)

    def test_request_is_open_for_a_minute(self):
        r = snap.request_capture(now=1000.0)
        self.assertEqual(snap.wanted(now=1010.0)["id"], r["id"])
        self.assertEqual(snap.wanted(now=1100.0)["id"], 0)

    def test_stored_and_scrubbed(self):
        snap.request_capture(now=1000.0)
        snap.store({"id": 1, "data": DATA}, now=1002.0)
        v = snap.view(now=1004.0)
        self.assertTrue(v["fresh"])
        self.assertEqual(v["ago"], 2)
        text = json.dumps(v)
        self.assertNotIn("private-9f8e7d", text)
        self.assertNotIn("192.168.1.20", text)
        self.assertIn("Silk/130", v["summary"])
        self.assertIn("span.deg over div.cond", v["summary"])

    def test_old_snapshot_is_not_fresh(self):
        snap.store({"id": 1, "data": DATA}, now=1000.0)
        snap.request_capture(now=2000.0)
        self.assertFalse(snap.view(now=2001.0)["fresh"])

    def test_bad_snapshots_are_refused(self):
        for body in ({}, {"data": "x"}, {"data": {"a": "x" * 300000}}):
            with self.assertRaises(ValueError):
                snap.store(body)

    def test_diagnostics_has_screen_json(self):
        def files():
            with zipfile.ZipFile(io.BytesIO(ct.status.diagnostics_zip())) as z:
                return {n: z.read(n).decode() for n in z.namelist()}
        self.assertFalse(json.loads(files()["screen.json"])["measured"])
        snap.store({"id": 1, "data": DATA})
        f = files()
        j = json.loads(f["screen.json"])
        self.assertTrue(j["measured"])
        self.assertEqual(j["screen"]["page"], "main")
        self.assertNotIn("private-9f8e7d", f["screen.json"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
