"""The status page flags a calendar only after two fetches in a row fail. Run with: python3 tests/test_calendar_status.py"""

import importlib.util
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

ROOT = Path(__file__).resolve().parent.parent
TMP = TemporaryDirectory()
os.environ["COUNTERTOP_DATA"] = TMP.name
os.environ["COUNTERTOP_NO_UPDATE_CHECK"] = "1"
(Path(TMP.name) / "sources.json").write_text(json.dumps({"calendars": [{"id": "c1", "name": "Family", "url": "https://calendar.example.com/x.ics"}]}))

spec = importlib.util.spec_from_file_location("countertop", ROOT / "tools" / "countertop.py")
ct = importlib.util.module_from_spec(spec)
sys.argv = ["countertop.py"]
spec.loader.exec_module(ct)
from server.core import CAL_STATUS  # noqa: E402


def view():
    v = ct.status.status_view()
    texts = [p[1] for p in v["problems"]] if isinstance(v.get("problems"), list) and v["problems"] and isinstance(v["problems"][0], list) \
        else [str(p) for p in v.get("problems", [])]
    return v, [t for t in texts if "didn't load" in t]


class CalendarStatus(unittest.TestCase):
    def test_one_failure_is_not_flagged(self):
        CAL_STATUS["c1"] = {"name": "Family", "at": 1, "ok": False, "error": "timed out", "fails": 1}
        v, flagged = view()
        self.assertEqual(flagged, [])
        self.assertIsNot(v["calendars"][0]["ok"], False)

    def test_two_failures_in_a_row_are_flagged(self):
        CAL_STATUS["c1"] = {"name": "Family", "at": 1, "ok": False, "error": "timed out", "fails": 2}
        v, flagged = view()
        self.assertEqual(len(flagged), 1)
        self.assertIn("timed out", flagged[0])
        self.assertIs(v["calendars"][0]["ok"], False)


if __name__ == "__main__":
    unittest.main()
