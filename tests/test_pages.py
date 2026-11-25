"""The dashboard and Controls pages are put together from their parts in tools/dash/, tools/control/ and tools/shared/.

Run with: python3 tests/test_pages.py
"""

from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from server import pages  # noqa: E402


class PagesTest(unittest.TestCase):
    def test_pages_are_whole(self):
        for name, title in (("dash", b"<title>Countertop</title>"), ("control", b"<title>Dashboard settings</title>")):
            html = pages.page(name)
            self.assertTrue(html.startswith(b"<!doctype html>"), name)
            self.assertIn(title, html)
            self.assertNotIn(b"<!--#include", html, name)
            self.assertIn(b"const FXLIB = (function(){", html, name)      # the shared effects library is in both

    def test_every_part_is_used(self):
        used = set()
        for name in ("dash", "control"):
            used |= set(pages.INCLUDE.findall((ROOT / "tools" / name / "index.html").read_text()))
        parts = {str(f.relative_to(ROOT / "tools")) for f in pages.page_files("dash", "control") if f.name != "index.html"}
        self.assertEqual(parts - used, set(), "files in the page folders that no page includes")

    def test_a_change_to_a_part_is_noticed(self):
        files = [str(f.relative_to(ROOT / "tools")) for f in pages.page_files("dash")]
        self.assertIn("dash/editor.js", files)
        self.assertIn("shared/effects.js", files)

    def test_only_files_under_tools(self):
        tmp = ROOT / "tools" / "dash" / "_test"
        tmp.mkdir(exist_ok=True)
        try:
            (tmp / "index.html").write_text("<!--#include ../README.md-->\n")
            with self.assertRaises(ValueError):
                pages.page("dash/_test")
        finally:
            (tmp / "index.html").unlink()
            tmp.rmdir()

if __name__ == "__main__":
    unittest.main(verbosity=2)
