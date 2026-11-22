"""Shared iCloud albums: which links are accepted, what errors say, and the dashboard name in page titles.

Run with: python3 tests/test_photos.py
"""

from pathlib import Path
import socket
import sys
import unittest
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from server import pages  # noqa: E402
from server.feeds import photos  # noqa: E402


class AlbumLinkTest(unittest.TestCase):
    def test_links_that_are_shared_albums(self):
        for link in ("https://www.icloud.com/sharedalbum/#B0aGeXJQoGAXUkQ", "icloud.com/sharedalbum/#B0aGeXJQoGAXUkQ;extra",
                     "https://icloud.com/sharedalbum/#A1b2C3d4E5f6", "B0aGeXJQoGAXUkQ"):
            self.assertTrue(photos.album_token(link), link)
        self.assertEqual(photos.album_token("https://www.icloud.com/sharedalbum/#B0aGeXJQoGAXUkQ"), "B0aGeXJQoGAXUkQ")

    def test_links_that_are_not(self):
        for link in ("https://share.icloud.com/photos/0abcdefghijklmnop", "https://example.com/#B0aGeXJQoGAXUkQ", "", "photos library", "https://www.icloud.com/photos"):
            self.assertIsNone(photos.album_token(link), link)

    def test_errors_in_plain_words(self):
        dns = URLError(socket.gaierror(-2, "Name or service not known"))
        self.assertIn("couldn't look up", photos.album_error(dns))
        self.assertNotIn("Errno", photos.album_error(dns))
        self.assertIn("Public Website", photos.album_error(HTTPError("u", 404, "nf", {}, None)))
        self.assertEqual(photos.album_error(ValueError(photos.WRONG_LINK)), photos.WRONG_LINK)


class DashboardNameTest(unittest.TestCase):
    def test_name_replaces_kitchen_in_titles(self):
        shell = pages.named(b"<title>Kitchen</title>", "Hoya <home>")
        self.assertEqual(shell, b"<title>Hoya &lt;home&gt;</title>")
        self.assertEqual(pages.named(b"<h1>Kitchen list</h1>", "Hoya"), b"<h1>Hoya list</h1>")

    def test_empty_or_default_keeps_kitchen(self):
        self.assertEqual(pages.named(b"<title>Kitchen</title>", ""), b"<title>Kitchen</title>")
        self.assertEqual(pages.named(b"<title>Kitchen</title>", None), b"<title>Kitchen</title>")


if __name__ == "__main__":
    unittest.main()
