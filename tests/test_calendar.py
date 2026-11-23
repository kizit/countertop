"""Calendar feeds: time zones, all-day events, repeats, skipped and moved instances, cancelled events.

Repeating events are expanded by python-dateutil when it is installed (Docker, the Mac app) and by the
built-in expander when it isn't (a clone run with a stock python3). Every test runs against both, so the
two can't drift apart. Run with: python3 tests/test_calendar.py
"""

import importlib.util
import os
from datetime import datetime, timedelta
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import time
import unittest

os.environ["TZ"] = "America/Chicago"
time.tzset()
ROOT = Path(__file__).resolve().parent.parent
TMP = TemporaryDirectory()
os.environ["COUNTERTOP_DATA"] = TMP.name
spec = importlib.util.spec_from_file_location("countertop", ROOT / "tools" / "countertop.py")
ct = importlib.util.module_from_spec(spec)
sys.argv = ["countertop.py"]
spec.loader.exec_module(ct)

try:
    import dateutil.rrule  # noqa: F401
    HAVE_DATEUTIL = True
except ImportError:
    HAVE_DATEUTIL = False

# Fixed points a few days ahead, so every event lands inside the parser's window whatever today is.
TODAY = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
MONDAY = TODAY + timedelta(days=7 - TODAY.weekday())          # next Monday, 1–7 days away


def d(dt):
    return dt.strftime("%Y%m%d")


def dt(x):
    return x.strftime("%Y%m%dT%H%M%S")


def ics(*events):
    body = "".join("BEGIN:VEVENT\r\n" + "\r\n".join(e) + "\r\nEND:VEVENT\r\n" for e in events)
    return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n" + body + "END:VCALENDAR\r\n"


def starts(events, name):
    return [e["start"] for e in events if e["summary"] == name]


class CalendarTests:
    """Mixed into two TestCases below: one with dateutil, one without."""

    def parse(self, text):
        return ct.parse_ics(text)

    def test_single_event_floating_time(self):
        at = MONDAY + timedelta(hours=9)
        ev = self.parse(ics(["UID:a", "SUMMARY:Dentist", "DTSTART:" + dt(at), "DTEND:" + dt(at + timedelta(minutes=30)),
                             "LOCATION:Main St"]))
        self.assertEqual(ev, [{"summary": "Dentist", "start": at.isoformat(), "end": (at + timedelta(minutes=30)).isoformat(),
                               "allDay": False, "location": "Main St"}])

    def test_utc_and_other_zone_become_local_time(self):
        at = MONDAY + timedelta(hours=15)                          # 15:00 UTC
        ny = MONDAY + timedelta(hours=10)                          # 10:00 New York = 09:00 Chicago
        ev = self.parse(ics(["UID:u", "SUMMARY:UTC", "DTSTART:" + dt(at) + "Z"],
                            ["UID:n", "SUMMARY:NY", "DTSTART;TZID=America/New_York:" + dt(ny)]))
        utc_local = at.replace(tzinfo=ct.timezone.utc).astimezone().replace(tzinfo=None)
        self.assertEqual(starts(ev, "UTC"), [utc_local.isoformat()])
        self.assertEqual(starts(ev, "NY"), [(ny - timedelta(hours=1)).isoformat()])

    def test_all_day(self):
        ev = self.parse(ics(["UID:b", "SUMMARY:Birthday", "DTSTART;VALUE=DATE:" + d(MONDAY),
                             "DTEND;VALUE=DATE:" + d(MONDAY + timedelta(days=1))]))
        self.assertEqual(ev[0]["start"], MONDAY.strftime("%Y-%m-%d"))
        self.assertTrue(ev[0]["allDay"])
        self.assertIsNone(ev[0]["end"])

    def test_cancelled_is_skipped_and_text_unescaped(self):
        at = MONDAY + timedelta(hours=9)
        ev = self.parse(ics(["UID:c", "SUMMARY:Gone", "STATUS:CANCELLED", "DTSTART:" + dt(at)],
                            ["UID:e", "SUMMARY:Lunch\\, Sam", "DTSTART:" + dt(at)]))
        self.assertEqual([e["summary"] for e in ev], ["Lunch, Sam"])

    def test_weekly_by_day_with_count(self):
        at = MONDAY + timedelta(hours=18)
        ev = self.parse(ics(["UID:w", "SUMMARY:Practice", "DTSTART:" + dt(at), "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4"]))
        want = [at, at + timedelta(days=2), at + timedelta(days=7), at + timedelta(days=9)]
        self.assertEqual(starts(ev, "Practice"), [w.isoformat() for w in want])

    def test_daily_until_in_utc(self):
        at = MONDAY + timedelta(hours=7)
        until = (MONDAY + timedelta(days=2, hours=23)).replace(tzinfo=None)
        ev = self.parse(ics(["UID:dd", "SUMMARY:Walk", "DTSTART:" + dt(at), "RRULE:FREQ=DAILY;UNTIL=" + dt(until) + "Z"]))
        self.assertEqual(starts(ev, "Walk"), [(at + timedelta(days=i)).isoformat() for i in range(3)])

    def test_daily_until_in_utc_evening(self):
        # 19:00 Chicago is 00:00 or 01:00 UTC the next day, so a 23:00Z end stops before the third evening
        at = MONDAY + timedelta(hours=19)
        until = (MONDAY + timedelta(days=2, hours=23)).replace(tzinfo=None)
        ev = self.parse(ics(["UID:de", "SUMMARY:Dinner", "DTSTART:" + dt(at), "RRULE:FREQ=DAILY;UNTIL=" + dt(until) + "Z"]))
        self.assertEqual(starts(ev, "Dinner"), [(at + timedelta(days=i)).isoformat() for i in range(2)])

    def test_every_other_week(self):
        at = MONDAY + timedelta(hours=8)
        ev = self.parse(ics(["UID:o", "SUMMARY:Recycling", "DTSTART:" + dt(at), "RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3"]))
        self.assertEqual(starts(ev, "Recycling"), [(at + timedelta(days=14 * i)).isoformat() for i in range(3)])

    def test_monthly_second_tuesday(self):
        tue = MONDAY + timedelta(days=1, hours=19)
        ev = self.parse(ics(["UID:m", "SUMMARY:Club", "DTSTART:" + dt(tue), "RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=2"]))
        got = [datetime.fromisoformat(s) for s in starts(ev, "Club")]
        self.assertTrue(got)
        for g in got:
            self.assertEqual(g.weekday(), 1)
            self.assertTrue(8 <= g.day <= 14, g)
            self.assertEqual(g.hour, 19)

    def test_skipped_and_moved_instances(self):
        at = MONDAY + timedelta(hours=18)
        moved_from, moved_to = at + timedelta(days=2), at + timedelta(days=2, hours=1)
        ev = self.parse(ics(
            ["UID:r", "SUMMARY:Swim", "DTSTART:" + dt(at), "RRULE:FREQ=DAILY;COUNT=4", "EXDATE:" + dt(at + timedelta(days=1))],
            ["UID:r", "SUMMARY:Swim", "RECURRENCE-ID:" + dt(moved_from), "DTSTART:" + dt(moved_to)]))
        self.assertEqual(starts(ev, "Swim"), [at.isoformat(), moved_to.isoformat(), (at + timedelta(days=3)).isoformat()])

    def test_folded_lines(self):
        at = MONDAY + timedelta(hours=9)
        text = ics(["UID:f", "SUMMARY:A very long", " title", "DTSTART:" + dt(at)])
        self.assertEqual(self.parse(text)[0]["summary"], "A very longtitle")

    def test_old_events_are_dropped(self):
        old = TODAY - timedelta(days=90)
        self.assertEqual(self.parse(ics(["UID:x", "SUMMARY:Old", "DTSTART:" + dt(old)])), [])

    def test_sample_calendar_parses(self):
        self.assertTrue(self.parse(ct.SAMPLE_ICS))


class WithDateutil(CalendarTests, unittest.TestCase):
    def setUp(self):
        if not HAVE_DATEUTIL:
            self.skipTest("python-dateutil isn't installed")


class WithoutDateutil(CalendarTests, unittest.TestCase):
    """As on a stock python3: importing dateutil fails, so the built-in expander runs."""

    def setUp(self):
        self.saved = {k: v for k, v in sys.modules.items() if k == "dateutil" or k.startswith("dateutil.")}
        for k in self.saved:
            del sys.modules[k]
        sys.modules["dateutil"] = None

    def tearDown(self):
        del sys.modules["dateutil"]
        sys.modules.update(self.saved)


if __name__ == "__main__":
    unittest.main()
