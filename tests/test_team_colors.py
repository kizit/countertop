"""Team colors: the Team tile gets a team's own colors from the league's team list, and nothing breaks without them.

Run with: python3 tests/test_team_colors.py
"""

import importlib.util
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

ROOT = Path(__file__).resolve().parent.parent
TMP = TemporaryDirectory()
os.environ["COUNTERTOP_DATA"] = TMP.name
spec = importlib.util.spec_from_file_location("countertop", ROOT / "tools" / "countertop.py")
ct = importlib.util.module_from_spec(spec)
sys.argv = ["countertop.py"]
spec.loader.exec_module(ct)
sports = sys.modules["server.feeds.sports"]

TEAMS = {"sports": [{"leagues": [{"teams": [
    {"team": {"displayName": "Seattle Sounders FC", "shortDisplayName": "Seattle", "abbreviation": "SEA", "color": "005595", "alternateColor": "658d1b"}},
    {"team": {"displayName": "D.C. United", "shortDisplayName": "DC United", "abbreviation": "DC", "color": "000000"}},
    {"team": {"displayName": "No Color FC", "shortDisplayName": "No Color"}},
    {"team": {"displayName": "Broken FC", "color": "javascript"}},
]}]}]}


class TeamColors(unittest.TestCase):
    def setUp(self):
        sports.TEAM_COLOR_CACHE.clear()
        self.calls = []
        self.real = sports._get_json
        sports._get_json = self.fake

    def tearDown(self):
        sports._get_json = self.real

    def fake(self, url, data=None, timeout=15):
        self.calls.append(url)
        if "fail" in url:
            raise OSError("offline")
        return TEAMS

    def test_finds_a_team_by_name_short_name_or_code(self):
        self.assertEqual(sports.team_colors("usa.1", "Seattle Sounders FC"), ["#005595", "#658d1b"])
        self.assertEqual(sports.team_colors("usa.1", "seattle"), ["#005595", "#658d1b"])
        self.assertEqual(sports.team_colors("usa.1", "SEA"), ["#005595", "#658d1b"])
        self.assertEqual(sports.team_colors("usa.1", "D.C. United"), ["#000000", "#000000"])      # one color: used twice

    def test_unknown_or_bad_colors_give_none(self):
        self.assertIsNone(sports.team_colors("usa.1", "Nowhere Rovers"))
        self.assertIsNone(sports.team_colors("usa.1", "No Color FC"))
        self.assertIsNone(sports.team_colors("usa.1", "Broken FC"))

    def test_asks_the_league_once_and_survives_failure(self):
        sports.team_colors("usa.1", "Seattle")
        sports.team_colors("usa.1", "DC")
        self.assertEqual(len(self.calls), 1)
        self.assertIsNone(sports.team_colors("fail.1", "Seattle"))
        self.assertIsNone(sports.team_colors("fail.1", "Seattle"))
        self.assertEqual(len(self.calls), 2, "a failed league is not asked again at once")


if __name__ == "__main__":
    unittest.main()
