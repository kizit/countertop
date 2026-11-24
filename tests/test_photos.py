"""Shared photo albums: iCloud (legacy & CloudKit), local folders, Nextcloud/ownCloud, Plex, Jellyfin, PhotoPrism,
error wording, diagnostics redaction, and dashboard name in page titles.

Run with: python3 tests/test_photos.py
"""

import base64
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
import zipfile
import io

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from server import pages  # noqa: E402
from server.feeds import photos  # noqa: E402

TINY_JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9"
TINY_PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x00IEND\xaeB`\x82"


def _start_mock_server(handler_cls):
    srv = HTTPServer(("127.0.0.1", 0), handler_cls)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv, "http://127.0.0.1:%d" % srv.server_address[1]


class AlbumLinkTest(unittest.TestCase):
    def test_links_that_are_shared_albums(self):
        for link in ("https://www.icloud.com/sharedalbum/#B0aGeXJQoGAXUkQ", "icloud.com/sharedalbum/#B0aGeXJQoGAXUkQ;extra",
                     "https://icloud.com/sharedalbum/#A1b2C3d4E5f6", "B0aGeXJQoGAXUkQ"):
            self.assertTrue(photos.album_token(link), link)
            self.assertEqual(photos.parse_icloud_link(link)[0], "sharedstreams", link)
        self.assertEqual(photos.album_token("https://www.icloud.com/sharedalbum/#B0aGeXJQoGAXUkQ"), "B0aGeXJQoGAXUkQ")

    def test_cloudkit_links(self):
        tok = "B0aGeXJQoGAXUkQ1234567890"
        for link in (
            "https://photos.icloud.com/shared/album/" + tok,
            "https://photos.icloud.com/shared/album/" + tok + "/",
            "photos.icloud.com/shared/album/" + tok,
            "https://www.icloud.com/photos/#" + tok,
            "https://www.icloud.com/sharedalbum/#" + tok,
            "https://share.icloud.com/photos/" + tok,
            tok,
        ):
            self.assertEqual(photos.parse_icloud_link(link), ("cloudkit", tok), link)
            self.assertEqual(photos.album_token(link), tok, link)

    def test_links_that_are_not(self):
        for link in (
            "https://share.icloud.com/photos/0abcdefghijklmnop",
            "https://example.com/#B0aGeXJQoGAXUkQ",
            "https://example.com/shared/album/B0aGeXJQoGAXUkQ1234567890",
            "",
            "photos library",
            "https://www.icloud.com/photos",
        ):
            self.assertIsNone(photos.album_token(link), link)

    def test_errors_in_plain_words(self):
        dns = URLError(socket.gaierror(-2, "Name or service not known"))
        self.assertIn("couldn't look up", photos.album_error(dns))
        self.assertNotIn("Errno", photos.album_error(dns))
        self.assertIn("Public Website", photos.album_error(HTTPError("u", 404, "nf", {}, None)))
        self.assertEqual(photos.album_error(ValueError(photos.WRONG_LINK)), photos.WRONG_LINK)

    def test_http_base_rejects_non_http_schemes(self):
        self.assertEqual(photos._http_base("http://192.168.1.20:32400/"), "http://192.168.1.20:32400")
        self.assertEqual(photos._http_base("192.168.1.20:8096"), "http://192.168.1.20:8096")
        with self.assertRaises(ValueError):
            photos._http_base("file:///etc/passwd")
        with self.assertRaises(ValueError):
            photos._http_base("ftp://example.com/photos")


class CloudKitAlbumTest(unittest.TestCase):
    def setUp(self):
        photos.PHOTO_CACHES.clear()

    def test_cloudkit_resolve_pages_and_builds_photos(self):
        calls = []

        def fake_ck_post(url, body, params):
            calls.append((url, body, params))
            if url.endswith("/records/resolve"):
                return {
                    "results": [{
                        "zoneID": {"zoneName": "SharedZone"},
                        "share": {"fields": {"cloudkit.title": {"value": "Summer Trip"}}},
                        "anonymousPublicAccess": {
                            "databasePartition": "https://p55-ckdatabasews.icloud.com:443",
                            "token": "pub-access-tok",
                        },
                    }]
                }
            if not body.get("continuationMarker"):
                return {
                    "continuationMarker": "page2",
                    "records": [
                        {"recordType": "CPLMaster", "recordName": "m1", "fields": {
                            "itemType": {"value": "public.heic"},
                            "resJPEGMedRes": {"value": {"downloadURL": "https://cvws.icloud-content.com/m1/${f}"}},
                            "originalCreationDate": {"value": 1700000000000},
                        }},
                        {"recordType": "CPLAsset", "recordName": "a1", "fields": {
                            "masterRef": {"value": {"recordName": "m1"}},
                            "resJPEGMedRes": {"value": {"downloadURL": "https://cvws.icloud-content.com/a1-edited/${f}"}},
                            "assetDate": {"value": 1700000000000},
                            "timeZoneOffset": {"value": -28800},
                            "caption": {"value": "Sunset"},
                        }},
                        {"recordType": "CPLMaster", "recordName": "m_vid", "fields": {
                            "itemType": {"value": "com.apple.quicktime-movie"},
                            "resJPEGMedRes": {"value": {"downloadURL": "https://cvws.icloud-content.com/vid/${f}"}},
                        }},
                        {"recordType": "CPLAsset", "recordName": "a_vid", "fields": {
                            "masterRef": {"value": {"recordName": "m_vid"}},
                        }},
                    ],
                }
            return {
                "records": [
                    {"recordType": "CPLMaster", "recordName": "m2", "fields": {
                        "itemType": {"value": "public.jpeg"},
                        "resJPEGFullRes": {"value": {"downloadURL": "https://cvws.icloud-content.com/m2-full/${f}"}},
                    }},
                    {"recordType": "CPLAsset", "recordName": "a2", "fields": {
                        "masterRef": {"value": {"recordName": "m2"}},
                    }},
                    {"recordType": "CPLAsset", "recordName": "a_del", "deleted": True, "fields": {
                        "masterRef": {"value": {"recordName": "m2"}},
                    }},
                ],
            }

        tok = "B0aGeXJQoGAXUkQ1234567890"
        with patch.object(photos, "_ck_post", side_effect=fake_ck_post):
            out = photos.icloud_album_photos({"name": "Family", "url": "https://photos.icloud.com/shared/album/" + tok}, use_cache=False)

        self.assertIsNone(out["error"])
        self.assertEqual(out["album"], "Summer Trip")
        self.assertEqual(out["ttl"], 600)
        self.assertEqual(len(out["photos"]), 2)
        self.assertEqual(out["photos"][0]["url"], "https://cvws.icloud-content.com/a1-edited/image.jpg")
        self.assertEqual(out["photos"][0]["caption"], "Sunset")
        self.assertIn("-08:00", out["photos"][0]["date"])
        self.assertEqual(out["photos"][1]["url"], "https://cvws.icloud-content.com/m2-full/image.jpg")
        self.assertEqual(len(calls), 3)

    def test_cloudkit_rejects_untrusted_partition_host(self):
        def fake_ck_post(url, body, params):
            return {
                "results": [{
                    "zoneID": {"zoneName": "Z"},
                    "anonymousPublicAccess": {
                        "databasePartition": "https://evil.example.com",
                        "token": "tok",
                    },
                }]
            }

        tok = "B0aGeXJQoGAXUkQ1234567890"
        with patch.object(photos, "_ck_post", side_effect=fake_ck_post):
            out = photos.icloud_album_photos({"name": "Family", "url": "https://photos.icloud.com/shared/album/" + tok}, use_cache=False)
        self.assertIn("unexpected server address", out["error"])

    def test_cloudkit_non_public_album_error(self):
        with patch.object(photos, "_ck_post", return_value={"results": [{"serverErrorCode": "NOT_FOUND"}]}):
            out = photos.icloud_album_photos({"name": "Family", "url": "https://photos.icloud.com/shared/album/B0aGeXJQoGAXUkQ1234567890"}, use_cache=False)
        self.assertIn("Public Website", out["error"])


class LocalFolderAlbumTest(unittest.TestCase):
    def setUp(self):
        photos.PHOTO_CACHES.clear()

    def test_local_folder_scans_filters_and_blocks_escaping_symlinks(self):
        with tempfile.TemporaryDirectory() as td, tempfile.TemporaryDirectory() as outside:
            root = Path(td)
            (root / "a.jpg").write_bytes(TINY_JPEG)
            (root / ".hidden.jpg").write_bytes(TINY_JPEG)
            (root / "._appledouble.jpg").write_bytes(TINY_JPEG)
            (root / "notes.txt").write_text("not an image")
            sub = root / "nested"
            sub.mkdir()
            (sub / "b.png").write_bytes(TINY_PNG)
            secret_img = Path(outside) / "secret.jpg"
            secret_img.write_bytes(TINY_JPEG)
            os.symlink(secret_img, root / "escape.jpg")

            src = {"id": "loc1", "name": "Kitchen", "kind": "Local folder", "path": str(root), "subdirs": False}
            with patch.object(photos, "sources_load", return_value={"albums": [src]}):
                res = photos.album_photos("loc1")
                self.assertIsNone(res["error"])
                self.assertEqual(len(res["photos"]), 1)
                fid = res["photos"][0]["url"].rsplit("/", 1)[-1]
                got = photos.album_image("loc1", fid)
                self.assertIsNotNone(got)
                self.assertEqual(got[0], TINY_JPEG)
                self.assertEqual(got[1], "image/jpeg")
                self.assertIsNone(photos.album_image("loc1", "0000000000000000"))

                # With subdirs enabled, nested/b.png is also included, while escape.jpg is still blocked
                src["subdirs"] = True
                res2 = photos.album_photos("loc1")
                self.assertIsNone(res2["error"])
                self.assertEqual(len(res2["photos"]), 2)

    def test_local_folder_missing_path_gives_friendly_error(self):
        res = photos.local_folder_photos({"id": "loc2", "kind": "Local folder", "path": "/nonexistent/countertop/photos"}, use_cache=False)
        self.assertIn("wasn't found", res["error"])
        self.assertEqual(res["photos"], [])


class NextcloudAlbumTest(unittest.TestCase):
    def setUp(self):
        photos.PHOTO_CACHES.clear()

    def test_parse_nextcloud_link(self):
        self.assertEqual(
            photos.parse_nextcloud_link("https://cloud.example.com/s/AbCdEf123"),
            ("https://cloud.example.com/public.php/webdav", "AbCdEf123"),
        )
        self.assertEqual(
            photos.parse_nextcloud_link("https://cloud.example.com/nextcloud/index.php/s/Token_99/"),
            ("https://cloud.example.com/nextcloud/public.php/webdav", "Token_99"),
        )
        self.assertEqual(photos.parse_nextcloud_link("https://cloud.example.com/files/nope"), (None, None))

    def test_nextcloud_propfind_and_proxy(self):
        expected_auth = "Basic " + base64.b64encode(b"ShareTok:s3cret").decode("ascii")

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_PROPFIND(self):
                if self.headers.get("Authorization") != expected_auth:
                    self.send_response(401)
                    self.end_headers()
                    return
                if self.path.rstrip("/") == "/public.php/webdav":
                    xml = (
                        '<?xml version="1.0"?>'
                        '<d:multistatus xmlns:d="DAV:">'
                        '<d:response><d:href>/public.php/webdav/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>'
                        '<d:response><d:href>/public.php/webdav/pic1.jpg</d:href><d:propstat><d:prop><d:getcontenttype>image/jpeg</d:getcontenttype><d:getlastmodified>Mon, 15 Jun 2026 10:00:00 GMT</d:getlastmodified><d:resourcetype/></d:prop></d:propstat></d:response>'
                        '<d:response><d:href>/public.php/webdav/sub/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>'
                        '<d:response><d:href>https://evil.example.com/steal.jpg</d:href><d:propstat><d:prop><d:getcontenttype>image/jpeg</d:getcontenttype><d:resourcetype/></d:prop></d:propstat></d:response>'
                        '</d:multistatus>'
                    ).encode()
                else:
                    xml = (
                        '<?xml version="1.0"?>'
                        '<d:multistatus xmlns:d="DAV:">'
                        '<d:response><d:href>/public.php/webdav/sub/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>'
                        '<d:response><d:href>/public.php/webdav/sub/pic2.png</d:href><d:propstat><d:prop><d:getcontenttype>image/png</d:getcontenttype><d:resourcetype/></d:prop></d:propstat></d:response>'
                        '</d:multistatus>'
                    ).encode()
                self.send_response(207)
                self.send_header("Content-Type", "application/xml")
                self.end_headers()
                self.wfile.write(xml)

            def do_GET(self):
                if self.headers.get("Authorization") != expected_auth:
                    self.send_response(401)
                    self.end_headers()
                    return
                if self.path.endswith("pic1.jpg"):
                    self.send_response(200)
                    self.send_header("Content-Type", "image/jpeg")
                    self.end_headers()
                    self.wfile.write(TINY_JPEG)
                else:
                    self.send_response(404)
                    self.end_headers()

        srv, base = _start_mock_server(Handler)
        try:
            src = {"id": "nc1", "name": "Cloud", "kind": "Nextcloud / ownCloud",
                   "url": base + "/s/ShareTok", "password": "s3cret", "subdirs": True}
            with patch.object(photos, "sources_load", return_value={"albums": [src]}):
                res = photos.album_photos("nc1")
                self.assertIsNone(res["error"])
                self.assertEqual(len(res["photos"]), 2)
                fid = res["photos"][0]["url"].rsplit("/", 1)[-1]
                got = photos.album_image("nc1", fid)
                self.assertIsNotNone(got)
                self.assertEqual(got[0], TINY_JPEG)
        finally:
            srv.shutdown()
            srv.server_close()


class SelfHostedPhotoServersTest(unittest.TestCase):
    def setUp(self):
        photos.PHOTO_CACHES.clear()

    def test_plex_album_and_transcode_proxy(self):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                if self.headers.get("X-Plex-Token") != "plex-tok":
                    self.send_response(401)
                    self.end_headers()
                    return
                p = self.path.split("?")[0]
                if p == "/library/sections":
                    body = {"MediaContainer": {"Directory": [{"key": "7", "type": "photo", "title": "Family Photos"}]}}
                elif p == "/library/sections/7/all":
                    body = {"MediaContainer": {"Metadata": [{
                        "ratingKey": "101", "type": "photo", "originallyAvailableAt": "2026-05-01",
                        "thumb": "/library/metadata/101/thumb",
                        "Media": [{"width": 1600, "height": 1200, "Part": [{"key": "/library/parts/101/photo.jpg"}]}],
                    }]}}
                elif p == "/photo/:/transcode":
                    self.send_response(200)
                    self.send_header("Content-Type", "image/jpeg")
                    self.end_headers()
                    self.wfile.write(TINY_JPEG)
                    return
                else:
                    self.send_response(404)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(body).encode())

        srv, base = _start_mock_server(Handler)
        try:
            src = {"id": "px1", "name": "Plex", "kind": "Plex", "server": base, "apiKey": "plex-tok", "album": "Family Photos"}
            with patch.object(photos, "sources_load", return_value={"albums": [src]}):
                res = photos.album_photos("px1")
                self.assertIsNone(res["error"])
                self.assertEqual(len(res["photos"]), 1)
                self.assertEqual(res["photos"][0]["w"], 1600)
                fid = res["photos"][0]["url"].rsplit("/", 1)[-1]
                got = photos.album_image("px1", fid)
                self.assertEqual(got[0], TINY_JPEG)
        finally:
            srv.shutdown()
            srv.server_close()

    def test_jellyfin_album_and_proxy(self):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                if self.headers.get("X-Emby-Token") != "jf-key":
                    self.send_response(401)
                    self.end_headers()
                    return
                u = urlparse(self.path)
                q = parse_qs(u.query)
                if u.path == "/Items" and "Folder" in (q.get("IncludeItemTypes") or [""])[0]:
                    body = {"Items": [{"Id": "alb99", "Name": "Holidays"}]}
                elif u.path == "/Items" and q.get("ParentId") == ["alb99"]:
                    body = {"Items": [{"Id": "img42", "DateCreated": "2026-07-04T00:00:00Z", "Width": 1080, "Height": 1920}]}
                elif u.path == "/Items/img42/Images/Primary":
                    self.send_response(200)
                    self.send_header("Content-Type", "image/png")
                    self.end_headers()
                    self.wfile.write(TINY_PNG)
                    return
                else:
                    self.send_response(404)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(body).encode())

        srv, base = _start_mock_server(Handler)
        try:
            src = {"id": "jf1", "name": "Jellyfin", "kind": "Jellyfin", "server": base, "apiKey": "jf-key", "album": "Holidays"}
            with patch.object(photos, "sources_load", return_value={"albums": [src]}):
                res = photos.album_photos("jf1")
                self.assertIsNone(res["error"])
                self.assertEqual(len(res["photos"]), 1)
                self.assertEqual(res["photos"][0]["h"], 1920)
                fid = res["photos"][0]["url"].rsplit("/", 1)[-1]
                got = photos.album_image("jf1", fid)
                self.assertEqual(got[0], TINY_PNG)
                self.assertEqual(got[1], "image/png")
        finally:
            srv.shutdown()
            srv.server_close()

    def test_photoprism_album_and_proxy(self):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                if self.headers.get("Authorization") != "Bearer pp-tok":
                    self.send_response(401)
                    self.end_headers()
                    return
                u = urlparse(self.path)
                q = parse_qs(u.query)
                if u.path == "/api/v1/albums":
                    body = [{"UID": "albuid1", "Title": "Favorites"}]
                    hdrs = {}
                elif u.path == "/api/v1/photos" and q.get("s") == ["albuid1"]:
                    body = [
                        {"Hash": "abc123def", "Type": "image", "Description": "Beach", "TakenAt": "2026-08-12T12:00:00Z", "Width": 2000, "Height": 1500},
                        {"Hash": "vid999", "Type": "video", "Description": "Clip"},
                    ]
                    hdrs = {"X-Preview-Token": "prev777"}
                elif u.path == "/api/v1/t/abc123def/prev777/fit_1920":
                    self.send_response(200)
                    self.send_header("Content-Type", "image/jpeg")
                    self.end_headers()
                    self.wfile.write(TINY_JPEG)
                    return
                else:
                    self.send_response(404)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                for k, v in hdrs.items():
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(json.dumps(body).encode())

        srv, base = _start_mock_server(Handler)
        try:
            src = {"id": "pp1", "name": "PhotoPrism", "kind": "PhotoPrism", "server": base, "apiKey": "pp-tok", "album": "Favorites"}
            with patch.object(photos, "sources_load", return_value={"albums": [src]}):
                res = photos.album_photos("pp1")
                self.assertIsNone(res["error"])
                self.assertEqual(len(res["photos"]), 1)
                self.assertEqual(res["photos"][0]["caption"], "Beach")
                fid = res["photos"][0]["url"].rsplit("/", 1)[-1]
                got = photos.album_image("pp1", fid)
                self.assertEqual(got[0], TINY_JPEG)
                # Test button merges saved apiKey when blank
                tested = photos.album_test({"id": "pp1", "kind": "PhotoPrism", "server": base, "apiKey": "", "album": "Favorites"})
                self.assertTrue(tested["ok"])
                self.assertIn("1 photo found", tested["detail"])
        finally:
            srv.shutdown()
            srv.server_close()


class DiagnosticsPhotoPrivacyTest(unittest.TestCase):
    def test_local_folder_path_and_password_are_redacted(self):
        from server import status
        fake_sources = {
            "albums": [{
                "id": "a1", "name": "Kids", "kind": "Local folder",
                "path": "/Users/personal-name/PrivateKidsFolder",
            }, {
                "id": "a2", "name": "Cloud", "kind": "Nextcloud / ownCloud",
                "url": "https://cloud.example.com/s/SuperSecretShare",
                "password": "my-share-password",
            }]
        }
        with patch.object(status, "sources_load", return_value=fake_sources):
            raw = status.diagnostics_zip()
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            srcs = z.read("sources.json").decode("utf-8")
        self.assertNotIn("PrivateKidsFolder", srcs)
        self.assertNotIn("SuperSecretShare", srcs)
        self.assertNotIn("my-share-password", srcs)


class PhotoRoutesEndToEndTest(unittest.TestCase):
    def test_local_folder_over_http_routes_and_sources_test(self):
        import subprocess
        import time
        from urllib.request import Request, urlopen

        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        base = "http://127.0.0.1:%d" % port
        with tempfile.TemporaryDirectory() as work_dir, tempfile.TemporaryDirectory() as photo_dir:
            (Path(photo_dir) / "family.jpg").write_bytes(TINY_JPEG)
            env = dict(os.environ, COUNTERTOP_DATA=work_dir, COUNTERTOP_NO_UPDATE_CHECK="1")
            proc = subprocess.Popen([sys.executable, str(ROOT / "tools" / "countertop.py"), "--port", str(port)],
                                    env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            try:
                for _ in range(100):
                    try:
                        urlopen(base + "/version", timeout=1)
                        break
                    except Exception:
                        time.sleep(0.05)
                else:
                    self.fail("server didn't start")

                def post_json(path, payload):
                    req = Request(base + path, data=json.dumps(payload).encode(),
                                  headers={"Content-Type": "application/json"})
                    with urlopen(req, timeout=10) as r:
                        return r.status, json.loads(r.read())

                # Test before saving via POST /sources/test
                code, tested = post_json("/sources/test", {
                    "kind": "albums",
                    "item": {"name": "NAS", "kind": "Local folder", "path": photo_dir, "subdirs": False},
                })
                self.assertEqual(code, 200)
                self.assertTrue(tested["ok"])
                self.assertEqual(tested["count"], 1)

                # Save source and fetch photos list
                code, saved = post_json("/sources", {
                    "kind": "albums", "op": "add",
                    "item": {"name": "NAS", "kind": "Local folder", "path": photo_dir, "subdirs": False},
                })
                self.assertEqual(code, 200)
                sid = [a["id"] for a in saved["sources"]["albums"] if a["name"] == "NAS"][0]

                with urlopen(base + "/photos?id=" + sid, timeout=10) as r:
                    listing = json.loads(r.read())
                self.assertIsNone(listing["error"])
                self.assertEqual(len(listing["photos"]), 1)
                img_url = listing["photos"][0]["url"]
                self.assertTrue(img_url.startswith("/photos/item/%s/" % sid))

                # Fetch allowlisted image via /photos/item/<sid>/<fid>
                with urlopen(base + img_url, timeout=10) as r:
                    self.assertEqual(r.status, 200)
                    self.assertEqual(r.headers.get("Content-Type"), "image/jpeg")
                    self.assertEqual(r.headers.get("X-Content-Type-Options"), "nosniff")
                    self.assertEqual(r.read(), TINY_JPEG)

                # Unknown fid returns 404
                with self.assertRaises(HTTPError) as ctx:
                    urlopen(base + "/photos/item/%s/0000000000000000" % sid, timeout=10)
                self.assertEqual(ctx.exception.code, 404)
            finally:
                proc.terminate()
                proc.communicate(timeout=10)


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
