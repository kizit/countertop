"""Wallpapers: only real PNG/JPEG/WebP pictures under the size limit are stored, and only those are served.

Run with: python3 tests/test_wallpaper.py
"""
import base64
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
os.environ["COUNTERTOP_DATA"] = tempfile.mkdtemp(prefix="ct-wall-")
sys.path.insert(0, str(ROOT / "tools"))
from server import wallpaper  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 40
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 40
WEBP = b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 20
b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731


class WallpaperTests(unittest.TestCase):
    def test_accepts_the_three_types_and_serves_them_back(self):
        for data, kind in ((PNG, "image/png"), (JPEG, "image/jpeg"), (WEBP, "image/webp")):
            wid = wallpaper.save("data:%s;base64,%s" % (kind, b64(data)))["id"]
            self.assertRegex(wid, r"^w-[0-9a-f]{12}$")
            self.assertEqual(wallpaper.read(wid), (data, kind))

    def test_same_picture_same_id(self):
        self.assertEqual(wallpaper.save(b64(PNG)), wallpaper.save(b64(PNG)))

    def test_rejects_other_types_whatever_they_claim(self):
        for data in (b'<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>', b"GIF89a....", b"<html></html>", b"MZ\x90\x00"):
            with self.assertRaises(wallpaper.WallpaperError):
                wallpaper.save("data:image/png;base64," + b64(data))

    def test_rejects_junk_and_too_big(self):
        for raw in ("", None, "not base64 !!", "data:image/png;base64,@@@"):
            with self.assertRaises(wallpaper.WallpaperError):
                wallpaper.save(raw)
        with self.assertRaises(wallpaper.WallpaperError):
            wallpaper.save(b64(PNG + b"\x00" * wallpaper.MAX_BYTES))

    def test_only_stored_ids_are_served(self):
        for wid in ("", "../config", "w-000000000000", "w-../../etc", "w-0123456789abc"):
            self.assertIsNone(wallpaper.read(wid))

    def test_delete(self):
        wid = wallpaper.save(b64(JPEG + b"x"))["id"]
        self.assertTrue(wallpaper.delete(wid))
        self.assertIsNone(wallpaper.read(wid))
        self.assertFalse(wallpaper.delete(wid))

    def test_limit_on_how_many(self):
        for i in range(wallpaper.MAX_FILES + 2):
            try:
                wallpaper.save(b64(PNG + bytes([i]) * 3))
            except wallpaper.WallpaperError:
                break
        self.assertLessEqual(len(list(wallpaper.WALL_DIR.glob("w-*"))), wallpaper.MAX_FILES)
        with self.assertRaises(wallpaper.WallpaperError):
            wallpaper.save(b64(PNG + b"unique-new"))


if __name__ == "__main__":
    unittest.main()
