"""API keys for community tiles: the server keeps them, adds them only to requests to the one site each is for, and
no page, frame, file someone shares, log or Status bundle ever gets one back.

Run with: python3 tests/test_tilekeys.py
"""

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import stat
import sys
from tempfile import TemporaryDirectory
import threading
import unittest
import zipfile
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
TMP = TemporaryDirectory()
os.environ["COUNTERTOP_DATA"] = TMP.name
spec = importlib.util.spec_from_file_location("countertop", ROOT / "tools" / "countertop.py")
ct = importlib.util.module_from_spec(spec)
sys.argv = ["countertop.py"]
spec.loader.exec_module(ct)
sbx, tf, tk = ct.sandbox, ct.tilefetch, ct.tilekeys
FIXTURES = ROOT / "tests" / "fixtures" / "community-tiles"
FetchError = tf.FetchError

KEY = "sk-live/abc+123=XYZ"          # has characters that change when written into an address or JSON
ENC = "sk-live%2Fabc%2B123%3DXYZ"
TOKEN = "tok_98765-secret"
PUBLIC = "93.184.215.14"


def fixture(name):
    return json.loads((FIXTURES / (name + ".json")).read_text())


def install(raw):
    sbx.TILES_DIR.mkdir(parents=True, exist_ok=True)
    (sbx.TILES_DIR / (raw["id"] + ".json")).write_text(json.dumps(raw))
    return sbx.community_tile(raw["id"])


def keyed(**secret):
    """A small tile with one key, sent the way `secret` says, and two sites."""
    return {"countertop": "tile", "id": "keyed", "version": 1, "name": "Keyed", "code": "Tile('keyed', {render(){}})",
            "hosts": ["api.example.com", "other.example.net"],
            "settings": {"key": dict({"type": "secret", "label": "API key", "host": "api.example.com"}, **(secret or {"header": "X-Api-Key"}))}}


class Fake:
    """DNS and the network, recorded: `pages` maps (host, path) to (status, headers, body), a path ending in * matching
    any that starts with it; every request is kept with the headers the server added."""
    def __init__(self, pages=None):
        self.pages, self.opened = pages or {}, []

    def open(self, host, ip, path, deadline, extra=None):
        self.opened.append((host, path, dict(extra or {})))
        for (h, p), v in self.pages.items():
            if h == host and (p == path or (p.endswith("*") and path.startswith(p[:-1]))):
                return v
        return (200, {"content-type": "application/json"}, b'{"ok":true}')

    def __enter__(self):
        self.p = [ct.patch_everywhere("FETCH_RESOLVE", lambda h: [PUBLIC]), ct.patch_everywhere("FETCH_OPEN", self.open)]
        for p in self.p:
            p.start()
        tf.FETCH_CACHE.clear()
        return self

    def __exit__(self, *a):
        for p in self.p:
            p.stop()


class Base(unittest.TestCase):
    def setUp(self):
        shutil.rmtree(sbx.TILES_DIR, ignore_errors=True)
        for f in (tk.KEYS_FILE, sbx.SAFE_FILE):
            if f.exists():
                f.unlink()
        tf.FETCH_CACHE.clear()

    def save(self, tile, name, value):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            r = tk.save_key(tile, name, value)
        self.assertNotIn(str(value), out.getvalue(), "the log never shows a key")
        return r


class TileFiles(Base):
    def test_the_fixture_is_a_good_tile(self):
        t = sbx.clean_tile(fixture("key-check"))
        self.assertEqual(t["settings"]["key"], {"type": "secret", "label": "Test key (sent in a header)", "host": "httpbin.org",
                                                "header": "X-Api-Key", "prefix": "",
                                                "help": "Type anything at least 6 characters long, like test-key-123."})
        self.assertEqual(t["settings"]["token"]["query"], "token")

    def test_what_a_key_setting_may_say(self):
        good = sbx.clean_tile(keyed(header="Authorization", prefix="Bearer ", default="leaked?"))
        self.assertEqual(good["settings"]["key"], {"type": "secret", "label": "API key", "help": "", "host": "api.example.com",
                                                   "header": "Authorization", "prefix": "Bearer "}, "no default, nothing extra")
        sbx.clean_tile(keyed(query="appid"))
        wild = keyed(header="X-Key", host="eu.weather.example")
        wild["hosts"] = ["*.weather.example"]
        sbx.clean_tile(wild)                                       # a site under a declared wildcard is fine
        bad = [
            (keyed(header="X-Key", host="evil.example.org"), "isn't one of the tile's sites"),
            (keyed(header="X-Key", host="*.example.com"), "one site"),
            (keyed(header="X-Key", host="10.0.0.1"), "one site"),
            (keyed(header="X-Key", host=""), "one site"),
            (keyed(header="X-Key", query="k"), "a header or a query"),
            (keyed(label="no way to send"), "a header or a query"),
            (keyed(header="Host"), "that header"),
            (keyed(header="cookie"), "that header"),
            (keyed(header="User-Agent"), "that header"),
            (keyed(header="X Key"), "that header"),
            (keyed(header="X-Key\r\nEvil"), "that header"),
            (keyed(header="X-Key", prefix="Bearer\r\n"), "prefix"),
            (keyed(header="X-Key", prefix=5), "prefix"),
            (keyed(query="a&b"), "part of the address"),
            (keyed(query=""), "part of the address"),
        ]
        for raw, why in bad:
            with self.assertRaises(ValueError, msg=json.dumps(raw["settings"])) as e:
                sbx.clean_tile(raw)
            self.assertIn(why, str(e.exception))

    def test_personal_data_tiles_get_no_keys(self):
        raw = keyed()
        raw["feeds"] = ["events"]
        with self.assertRaises(ValueError) as e:
            sbx.clean_tile(raw)
        self.assertIn("personal data", str(e.exception))

    def test_at_most_three_keys(self):
        raw = keyed()
        for i in range(3):
            raw["settings"]["k%d" % i] = {"type": "secret", "host": "api.example.com", "query": "k%d" % i}
        with self.assertRaises(ValueError):
            sbx.clean_tile(raw)


class Saving(Base):
    def test_saved_in_its_own_private_file_never_in_the_settings(self):
        t = install(keyed())
        self.assertEqual(tk.key_states(t), {"key": ""})
        self.assertEqual(self.save(t, "key", "  " + KEY + " "), {"key": "set"})
        self.assertEqual(stat.S_IMODE(tk.KEYS_FILE.stat().st_mode), 0o600)
        self.assertEqual(json.loads(tk.KEYS_FILE.read_text())["keyed"]["key"]["value"], KEY)
        if ct.CONFIG_FILE.exists():
            self.assertNotIn(KEY, ct.CONFIG_FILE.read_text())
        self.assertNotIn(KEY, (sbx.TILES_DIR / "keyed.json").read_text())
        self.assertEqual(self.save(t, "key", None), {"key": ""})
        self.assertNotIn(KEY, tk.KEYS_FILE.read_text())

    def test_what_isnt_a_key(self):
        t = install(keyed())
        for v in ["short", "has a space in it", "line\nbreak-here", "tab\there-there", "é-accented-key", "x" * 513, 12345678, ["abcdefgh"], ""]:
            with self.assertRaises(ValueError, msg=repr(v)):
                tk.save_key(t, "key", v)
        with self.assertRaises(ValueError):
            tk.save_key(t, "nope", KEY)                 # a setting the tile doesn't have
        with self.assertRaises(ValueError):
            tk.save_key(t, "", KEY)
        self.assertFalse(tk.KEYS_FILE.exists())

    def test_a_tile_update_that_sends_the_key_elsewhere_needs_it_again(self):
        t = install(keyed())
        self.save(t, "key", KEY)
        self.assertEqual(len(tk.fetch_keys(t)), 1)
        for change in ({"header": "X-Other"}, {"query": "key"}, {"header": "X-Api-Key", "prefix": "Token "}, {"header": "X-Api-Key", "host": "other.example.net"}):
            moved = install(dict(keyed(**change), version=2))
            self.assertEqual(tk.key_states(moved), {"key": "moved"}, change)
            self.assertEqual(tk.fetch_keys(moved), [], change)
        back = install(keyed())
        self.assertEqual(tk.key_states(back), {"key": "set"}, "the same file again uses the saved key")

    def test_one_kind_of_tile_never_gets_another_ones_keys(self):
        t = install(keyed())
        self.save(t, "key", KEY)
        other = dict(keyed(), id="keyed-two")
        other["code"] = "Tile('keyed-two', {render(){}})"
        self.assertEqual(tk.fetch_keys(install(other)), [])
        self.assertEqual(tk.fetch_keys(None), [])

    def test_a_damaged_file_means_no_keys(self):
        t = install(keyed())
        for text in ("not json", "[1,2]", '{"keyed": "x"}', '{"keyed": {"key": "x"}}', '{"keyed": {"key": {"value": "a b c d e f"}}}'):
            tk.KEYS_FILE.write_text(text)
            self.assertEqual(tk.fetch_keys(t), [], text)
            self.assertIn(tk.key_states(t)["key"], ("", "moved"), text)


class Fetching(Base):
    def keys(self, raw=None, **values):
        t = install(raw or keyed())
        for k, v in values.items():
            self.save(t, k, v)
        return t, tk.fetch_keys(t)

    def test_a_header_key_goes_to_its_site_only(self):
        t, keys = self.keys(key=KEY)
        with Fake() as f:
            tf.fetch_url("https://api.example.com/v1?q=1", t["hosts"], keys)
            tf.fetch_url("https://other.example.net/v1?q=1", t["hosts"], keys)
        self.assertEqual(f.opened, [("api.example.com", "/v1?q=1", {"X-Api-Key": KEY}), ("other.example.net", "/v1?q=1", {})])

    def test_a_prefix(self):
        t, keys = self.keys(keyed(header="Authorization", prefix="Bearer "), key=KEY)
        with Fake() as f:
            tf.fetch_url("https://api.example.com/", t["hosts"], keys)
        self.assertEqual(f.opened[0][2], {"Authorization": "Bearer " + KEY})

    def test_a_query_key_replaces_any_the_tile_wrote(self):
        t, keys = self.keys(keyed(query="appid"), key=KEY)
        with Fake() as f:
            tf.fetch_url("https://api.example.com/w?q=Paris&appid=MINE&APPID=x&appid", t["hosts"], keys)
            tf.fetch_url("https://api.example.com/w", t["hosts"], keys)
            tf.fetch_url("https://other.example.net/w?appid=MINE", t["hosts"], keys)
        self.assertEqual([o[1] for o in f.opened], ["/w?q=Paris&appid=" + ENC, "/w?appid=" + ENC, "/w?appid=MINE"])
        self.assertEqual([o[2] for o in f.opened], [{}, {}, {}])

    def test_a_subdomain_of_the_site_doesnt_get_it(self):
        raw = keyed()
        raw["hosts"] = ["api.example.com", "*.api.example.com"]
        t, keys = self.keys(raw, key=KEY)
        with Fake() as f:
            tf.fetch_url("https://eu.api.example.com/", t["hosts"], keys)
        self.assertEqual(f.opened[0][2], {})

    def test_redirects_to_another_site_never_carry_it(self):
        t, keys = self.keys(keyed(query="appid"), key=KEY)
        # an ordinary redirect to another declared site: followed, without the key
        with Fake({("api.example.com", "/go*"): (302, {"location": "https://other.example.net/there"}, b"")}) as f:
            tf.fetch_url("https://api.example.com/go", t["hosts"], keys)
        self.assertEqual(f.opened[1], ("other.example.net", "/there", {}))
        # a redirect whose address repeats the key, in any spelling, to another site: refused before anything is sent
        for loc in ["https://other.example.net/x?appid=" + ENC, "https://other.example.net/x?k=" + KEY,
                    "https://other.example.net/" + KEY, "//other.example.net/x?appid=" + ENC]:
            with Fake({("api.example.com", "/go*"): (302, {"location": loc}, b"")}) as f:
                with self.assertRaises(FetchError) as e:
                    tf.fetch_url("https://api.example.com/go", t["hosts"], keys)
            self.assertEqual(e.exception.code, 403, loc)
            self.assertEqual(len(f.opened), 1, loc)
            self.assertNotIn("abc", str(e.exception))
        # back to its own site: the key goes again
        with Fake({("api.example.com", "/go*"): (302, {"location": "/here?x=1"}, b"")}) as f:
            tf.fetch_url("https://api.example.com/go", t["hosts"], keys)
        self.assertEqual(f.opened[1][1], "/here?x=1&appid=" + ENC)

    def test_a_redirect_to_an_undeclared_site_is_still_refused(self):
        t, keys = self.keys(key=KEY)
        with Fake({("api.example.com", "/go"): (302, {"location": "https://evil.example.org/"}, b"")}) as f:
            with self.assertRaises(FetchError):
                tf.fetch_url("https://api.example.com/go", t["hosts"], keys)
        self.assertEqual(len(f.opened), 1)

    def test_a_site_that_repeats_the_key_has_it_blanked_out(self):
        t, keys = self.keys(keyed(query="appid"), key=KEY)
        # as sent in the address, as typed, and as JSON may write it (with \/)
        body = (b'{"url":"https://api.example.com/w?appid=sk-live%2Fabc%2B123%3DXYZ","key":"sk-live/abc+123=XYZ",'
                b'"escaped":"sk-live\\/abc+123=XYZ"}')
        with Fake({("api.example.com", "/w*"): (200, {"content-type": "application/json"}, body)}):
            res = tf.fetch_url("https://api.example.com/w", t["hosts"], keys)
        self.assertNotIn(b"abc", res["body"])
        self.assertEqual(json.loads(res["body"])["key"], "********", "still JSON the tile can read")

    def test_error_messages_never_repeat_it(self):
        t, keys = self.keys(keyed(query="appid"), key=KEY)

        def boom(host, ip, path, deadline, extra=None):
            raise OSError("connection reset while reading " + path)
        with ct.patch_everywhere("FETCH_RESOLVE", lambda h: [PUBLIC]), ct.patch_everywhere("FETCH_OPEN", boom):
            with self.assertRaises(FetchError) as e:
                tf.fetch_url("https://api.example.com/w", t["hosts"], keys)
        self.assertNotIn("abc", str(e.exception))

    def test_answers_read_with_a_key_are_kept_for_that_tile_and_key(self):
        t, keys = self.keys(key=KEY)
        with Fake({("api.example.com", "/data"): (200, {"content-type": "application/json"}, b'{"for":"keyed"}')}) as f:
            self.assertEqual(tf.cached_fetch("https://api.example.com/data", t["hosts"], 300, keys, "keyed")["body"], b'{"for":"keyed"}')
            tf.cached_fetch("https://api.example.com/data", t["hosts"], 300, keys, "keyed")
            self.assertEqual(len(f.opened), 1, "the same tile and key: from the cache")
            tf.cached_fetch("https://api.example.com/data", t["hosts"], 300)            # a tile without the key asks again
            self.assertEqual(f.opened[-1][2], {})
            tf.cached_fetch("https://api.example.com/data", t["hosts"], 300, keys, "another")
            new = [dict(keys[0], value="another-key-1")]
            tf.cached_fetch("https://api.example.com/data", t["hosts"], 300, new, "keyed")
            self.assertEqual(len(f.opened), 4, "another tile, and a changed key, each read again")
            self.assertEqual(f.opened[-1][2], {"X-Api-Key": "another-key-1"})
        self.assertFalse(any(KEY in str(k) for k in tf.FETCH_CACHE), "the cache isn't filed under the key itself")


class Routes(Base):
    @classmethod
    def setUpClass(cls):
        cls.srv = ct.ThreadingHTTPServer(("127.0.0.1", 0), ct.Handler)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def get(self, path):
        try:
            with urlopen(self.base + path) as r:
                return r.status, r.read()
        except HTTPError as e:
            return e.code, e.read()

    def post(self, path, body, headers=None):
        req = Request(self.base + path, data=json.dumps(body).encode(), headers=dict({"Content-Type": "application/json"}, **(headers or {})))
        try:
            with urlopen(req) as r:
                return r.status, json.loads(r.read() or b"null")
        except HTTPError as e:
            return e.code, e.read()

    def quietly(self, *a):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            r = self.post(*a)
        self.assertNotIn(KEY, out.getvalue())
        self.assertNotIn(TOKEN, out.getvalue())
        return r

    def test_saving_answers_only_whether_one_is_saved(self):
        install(fixture("key-check"))
        self.assertEqual(self.quietly("/tile-key", {"type": "key-check", "name": "key", "value": KEY}), (200, {"keys": {"key": "set", "token": ""}}))
        self.assertEqual(self.quietly("/tile-key", {"type": "key-check", "name": "token", "value": TOKEN}), (200, {"keys": {"key": "set", "token": "set"}}))
        self.assertEqual(self.post("/tile-key", {"type": "key-check", "name": "key", "value": "no"})[0], 400)
        self.assertEqual(self.post("/tile-key", {"type": "nope", "name": "key", "value": KEY})[0], 400)
        self.assertEqual(self.post("/tile-key", {"type": "key-check", "name": "key", "value": "frame-key-123"}, {"Origin": "null"})[0], 403,
                         "a tile's frame can't replace the key")
        self.assertEqual(tk.fetch_keys(sbx.community_tile("key-check"))[0]["value"], KEY)
        self.assertEqual(self.quietly("/tile-key", {"type": "key-check", "name": "token", "remove": True}), (200, {"keys": {"key": "set", "token": ""}}))

    def test_no_page_and_no_bundle_ever_gets_it(self):
        install(fixture("key-check"))
        install(fixture("moon-facts"))
        self.quietly("/tile-key", {"type": "key-check", "name": "key", "value": KEY})
        cfg = self.get("/config")[1].decode()
        self.assertNotIn(KEY, cfg)
        self.assertEqual(json.loads(cfg)["sandbox"]["tiles"]["key-check"]["keys"], {"key": "set", "token": ""})
        self.assertNotIn("keys", json.loads(cfg)["sandbox"]["tiles"]["moon-facts"], "only tiles with keys say anything about them")
        for path in ("/status", "/sources", "/tile-frame/key-check", "/tile-frame/key-check/tile.js", "/version", "/tile-data?since=0"):
            self.assertNotIn(KEY, self.get(path)[1].decode("utf-8", "replace"), path)
        # Diagnostics: even if a key somehow got into the server's output, it's blanked out of the bundle
        ct.CONSOLE.append("oops " + KEY)
        code, z = self.get("/diagnostics")
        self.assertEqual(code, 200)
        with zipfile.ZipFile(io.BytesIO(z)) as zf:
            self.assertIn("oops", zf.read("console.log").decode())
            for n in zf.namelist():
                self.assertNotIn(KEY, zf.read(n).decode("utf-8", "replace"), n)
            self.assertIn("tile-keys.json", zf.read("files.txt").decode(), "the file's name is listed, never its contents")

    def test_tile_fetch_adds_it_and_blanks_it_out_of_the_answer(self):
        install(fixture("key-check"))
        self.quietly("/tile-key", {"type": "key-check", "name": "key", "value": KEY})
        self.quietly("/tile-key", {"type": "key-check", "name": "token", "value": TOKEN})
        seen = []

        def echo(*a):
            seen.append(a)
            host, ip, path = a[:3]
            extra = a[4] if len(a) > 4 else {}
            return 200, {"content-type": "application/json"}, json.dumps({"host": host, "path": path, "headers": extra}).encode()
        q = "/tile-fetch?type=key-check&url="
        with ct.patch_everywhere("FETCH_RESOLVE", lambda h: [PUBLIC]), ct.patch_everywhere("FETCH_OPEN", echo):
            code, body = self.get(q + "https%3A%2F%2Fhttpbin.org%2Fanything%3Fa%3D1")
            self.assertEqual(code, 200)
            got = json.loads(body)
            self.assertEqual(got["headers"], {"X-Api-Key": "********"})
            self.assertEqual(got["path"], "/anything?a=1&token=********")
            self.assertEqual(seen[-1][2], "/anything?a=1&token=" + TOKEN, "the site itself got the real key")
            self.assertEqual(seen[-1][4], {"X-Api-Key": KEY})
            code, body = self.get(q + "https%3A%2F%2Fpostman-echo.com%2Fget")
            self.assertEqual(json.loads(body)["headers"], {})
            self.assertEqual(len(seen[-1]), 4, "nothing added for the other site")
            # safe mode: no fetches at all
            sbx.set_safe_mode(True, "person")
            n = len(seen)
            self.assertEqual(self.get(q + "https%3A%2F%2Fhttpbin.org%2Fanything%3Fb%3D1")[0], 403)
            self.assertEqual(len(seen), n)

    def test_saved_settings_never_hold_it(self):
        # a key setting written into the settings (by hand, or by an imported layout) is just text, never the key,
        # and can't change the saved one
        install(fixture("key-check"))
        self.quietly("/tile-key", {"type": "key-check", "name": "key", "value": KEY})
        mods = ct.config_load()["modules"]
        mods["tiles"]["settings"]["items"].append({"id": "kc_a", "type": "key-check", "settings": {"key": "typed-into-a-layout"}})
        self.assertEqual(self.post("/config", {"modules": mods})[0], 200)
        self.assertNotIn(KEY, ct.CONFIG_FILE.read_text())
        self.assertEqual(tk.fetch_keys(sbx.community_tile("key-check"))[0]["value"], KEY)


if __name__ == "__main__":
    unittest.main()
