"""/tile-fetch: a tile reads only https:// addresses on the sites it declared, and never anything on the home network,
however the address is dressed up, wherever its name points, and wherever a redirect sends it.

Run with: python3 tests/test_tilefetch.py
"""

import importlib.util
import os
from pathlib import Path
import socket
import ssl
import sys
from tempfile import TemporaryDirectory
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parent.parent
TMP = TemporaryDirectory()
os.environ["COUNTERTOP_DATA"] = TMP.name
spec = importlib.util.spec_from_file_location("countertop", ROOT / "tools" / "countertop.py")
ct = importlib.util.module_from_spec(spec)
sys.argv = ["countertop.py"]
spec.loader.exec_module(ct)
tf = ct.tilefetch
FetchError = tf.FetchError

HOSTS = ["api.example.com", "*.weather.example"]
PUBLIC = "93.184.215.14"


class Fake:
    """Stands in for DNS and the network: `names` maps a host to the addresses it resolves to (a list per lookup, so a
    second lookup can answer differently), `pages` maps (host, path) to (status, headers, body)."""
    def __init__(self, names=None, pages=None):
        self.names, self.pages, self.lookups, self.opened = names or {}, pages or {}, [], []

    def resolve(self, host):
        self.lookups.append(host)
        v = self.names.get(host, [PUBLIC])
        return v.pop(0) if v and isinstance(v[0], list) else v

    def open(self, host, ip, path, deadline):
        self.opened.append((host, ip, path))
        return self.pages.get((host, path), (200, {"content-type": "application/json"}, b'{"ok":true}'))

    def __enter__(self):
        self.p = [ct.patch_everywhere("FETCH_RESOLVE", self.resolve), ct.patch_everywhere("FETCH_OPEN", self.open)]
        for p in self.p:
            p.start()
        tf.FETCH_CACHE.clear()
        return self

    def __exit__(self, *a):
        for p in self.p:
            p.stop()


class AddressRules(unittest.TestCase):
    def test_every_private_and_local_range_is_blocked(self):
        for ip in ["10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.254", "192.168.1.1", "127.0.0.1", "127.8.8.8",
                   "169.254.169.254", "100.64.0.1", "100.127.255.254", "0.0.0.0", "0.1.2.3", "224.0.0.1", "239.255.255.250",
                   "240.0.0.1", "255.255.255.255", "192.0.0.8", "198.18.0.1", "192.0.2.1", "198.51.100.1", "203.0.113.1",
                   "::", "::1", "fe80::1", "fe80::1%eth0", "fc00::1", "fd12:3456::1", "fec0::1", "ff02::1",
                   "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:192.168.0.1", "::ffff:169.254.169.254", "::127.0.0.1",
                   "64:ff9b::7f00:1", "64:ff9b::a00:1", "2002:7f00:1::1", "2002:c0a8:101::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2",
                   "2001:db8::1", "100::1", "not an address", ""]:
            self.assertTrue(tf.address_blocked(ip), ip)

    def test_public_addresses_pass(self):
        for ip in [PUBLIC, "1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e"]:
            self.assertFalse(tf.address_blocked(ip), ip)

    def test_declared_hosts_are_names_only(self):
        self.assertEqual(tf.clean_hosts(["API.Example.com.", "*.weather.example", "10.0.0.1", "localhost", "a.b:8080",
                                         "http://x.com", "*.*.x.com", "x.com/path", "[::1]", "user@x.com", 5]),
                         ["api.example.com", "*.weather.example"])

    def test_one_level_of_subdomain_for_a_wildcard(self):
        self.assertTrue(tf.host_allowed("eu.weather.example", HOSTS))
        self.assertFalse(tf.host_allowed("a.b.weather.example", HOSTS))
        self.assertFalse(tf.host_allowed("weather.example", HOSTS))
        self.assertFalse(tf.host_allowed("evilweather.example", HOSTS))
        self.assertFalse(tf.host_allowed("api.example.com.evil.net", HOSTS))


class UrlRules(unittest.TestCase):
    def refused(self, url, code=403):
        with Fake() as f:
            with self.assertRaises(FetchError) as cm:
                tf.fetch_url(url, HOSTS)
            self.assertEqual(cm.exception.code, code, url)
            self.assertEqual(f.lookups, [], "refused before any lookup: " + str(url))
            self.assertEqual(f.opened, [])

    def test_only_https_on_declared_hosts(self):
        self.refused("http://api.example.com/x")
        self.refused("ftp://api.example.com/x")
        self.refused("file:///etc/passwd")
        self.refused("https://other.example.com/x")
        self.refused("https://api.example.com.evil.net/x")
        self.refused("//api.example.com/x")

    def test_tricks_in_the_address(self):
        self.refused("https://user:pw@api.example.com/x")
        self.refused("https://api.example.com@127.0.0.1/x")
        self.refused("https://api.example.com:8443/x")
        self.refused("https://127.0.0.1/x")
        self.refused("https://2130706433/x")              # 127.0.0.1 as one number
        self.refused("https://0x7f.1/x")
        self.refused("https://[::1]/x")
        self.refused("https://api.example.com\\@127.0.0.1/x", 400)
        self.refused("https://api.example.com/x y", 400)
        self.refused("https://api.example.com/\x00", 400)
        self.refused("https://api.example.com:99999/x", 400)
        self.refused("https://" + "a" * 2000, 400)
        self.refused(None, 400)

    def test_a_declared_name_that_points_home_is_refused(self):
        for addrs in (["127.0.0.1"], ["192.168.1.10"], ["::1"], ["::ffff:10.0.0.1"], [PUBLIC, "10.0.0.5"], ["169.254.169.254"]):
            with Fake(names={"api.example.com": addrs}) as f:
                with self.assertRaises(FetchError) as cm:
                    tf.fetch_url("https://api.example.com/x", HOSTS)
                self.assertEqual(cm.exception.code, 403)
                self.assertIn("private address", str(cm.exception))
                self.assertEqual(f.opened, [], addrs)

    def test_looked_up_once_and_connected_to_the_checked_address(self):
        # DNS rebinding: a public address for the check, a private one for any second lookup
        with Fake(names={"api.example.com": [[PUBLIC], ["127.0.0.1"]]}) as f:
            self.assertEqual(tf.fetch_url("https://api.example.com/v1?q=1", HOSTS)["body"], b'{"ok":true}')
            self.assertEqual(f.lookups, ["api.example.com"])
            self.assertEqual(f.opened, [("api.example.com", PUBLIC, "/v1?q=1")])

    def test_names_that_dont_resolve(self):
        with Fake(names={"api.example.com": []}):
            with self.assertRaises(FetchError):
                tf.fetch_url("https://api.example.com/x", HOSTS)

        def boom(host):
            raise socket.gaierror("nope")
        with Fake(), ct.patch_everywhere("FETCH_RESOLVE", boom):
            with self.assertRaises(FetchError):
                tf.fetch_url("https://api.example.com/x", HOSTS)


class Redirects(unittest.TestCase):
    def go(self, loc, names=None):
        return Fake(names=names, pages={("api.example.com", "/a"): (302, {"location": loc}, b"")})

    def test_a_redirect_to_another_declared_host_is_followed_and_checked(self):
        with self.go("https://eu.weather.example/b") as f:
            self.assertEqual(tf.fetch_url("https://api.example.com/a", HOSTS)["body"], b'{"ok":true}')
            self.assertEqual(f.lookups, ["api.example.com", "eu.weather.example"])

    def test_relative_redirects(self):
        with self.go("/b") as f:
            tf.fetch_url("https://api.example.com/a", HOSTS)
            self.assertEqual(f.opened[-1], ("api.example.com", PUBLIC, "/b"))

    def test_redirects_that_leave_are_refused(self):
        for loc in ("https://evil.example.net/", "http://api.example.com/b", "https://127.0.0.1/", "https://192.168.1.1/",
                    "https://[::1]/", "https://api.example.com:8080/", "https://u@api.example.com/", "file:///etc/passwd"):
            with self.go(loc) as f:
                with self.assertRaises(FetchError, msg=loc):
                    tf.fetch_url("https://api.example.com/a", HOSTS)
                self.assertEqual(len(f.opened), 1, loc)

    def test_a_redirect_to_a_declared_name_that_points_home(self):
        with self.go("https://eu.weather.example/b", names={"eu.weather.example": ["10.1.2.3"]}) as f:
            with self.assertRaises(FetchError) as cm:
                tf.fetch_url("https://api.example.com/a", HOSTS)
            self.assertIn("private address", str(cm.exception))
            self.assertEqual(len(f.opened), 1)

    def test_at_most_three_redirects(self):
        pages = {("api.example.com", "/%d" % i): (301, {"location": "/%d" % (i + 1)}, b"") for i in range(10)}
        with Fake(pages=pages) as f:
            with self.assertRaises(FetchError) as cm:
                tf.fetch_url("https://api.example.com/0", HOSTS)
            self.assertIn("redirects", str(cm.exception))
            self.assertEqual(len(f.opened), 4)
        pages[("api.example.com", "/3")] = (200, {"content-type": "application/json"}, b"[]")
        with Fake(pages=pages):
            self.assertEqual(tf.fetch_url("https://api.example.com/0", HOSTS)["body"], b"[]")

    def test_a_redirect_without_an_address(self):
        with Fake(pages={("api.example.com", "/a"): (302, {}, b"")}):
            with self.assertRaises(FetchError):
                tf.fetch_url("https://api.example.com/a", HOSTS)


class Answers(unittest.TestCase):
    def test_errors_sizes_and_types(self):
        big = b"x" * (tf.FETCH_MAX_BYTES + 1)
        cases = {"/404": (404, {}, b""), "/big": (200, {"content-type": "text/plain"}, big),
                 "/img": (200, {"content-type": "image/png"}, b"\x89PNG"), "/html": (200, {"content-type": "text/html"}, b"<p>"),
                 "/feed": (200, {"content-type": "application/rss+xml; charset=utf-8"}, b"<rss/>"),
                 "/ld": (200, {"content-type": "application/ld+json"}, b"{}")}
        with Fake(pages={("api.example.com", k): v for k, v in cases.items()}):
            for path, ok in (("/404", False), ("/big", False), ("/img", False), ("/html", True), ("/feed", True), ("/ld", True)):
                if ok:
                    tf.fetch_url("https://api.example.com" + path, HOSTS)
                else:
                    with self.assertRaises(FetchError, msg=path):
                        tf.fetch_url("https://api.example.com" + path, HOSTS)

    def test_cache_keeps_answers_but_checks_hosts_first(self):
        with Fake() as f:
            tf.cached_fetch("https://api.example.com/c", HOSTS, 300)
            tf.cached_fetch("https://api.example.com/c", HOSTS, 300)
            self.assertEqual(len(f.opened), 1)
            with self.assertRaises(FetchError):              # another tile, without that site, gets nothing from the cache
                tf.cached_fetch("https://api.example.com/c", ["other.example.org"], 300)

    def test_slow_sites_stop_at_the_time_limit(self):
        # a real server on this computer that never answers: _open's own clock stops it
        srv = socket.socket()
        srv.bind(("127.0.0.1", 0))
        srv.listen(1)
        port = srv.getsockname()[1]
        conns = []
        threading.Thread(target=lambda: conns.append(srv.accept()), daemon=True).start()

        class Slow(tf._PinnedHTTPS):
            def connect(self):
                self.sock = socket.create_connection(("127.0.0.1", port), self.timeout)
        with ct.patch_everywhere("_PinnedHTTPS", Slow):
            t0 = time.monotonic()
            with self.assertRaises(FetchError) as cm:
                tf._open("api.example.com", "127.0.0.1", "/", time.monotonic() + 0.5)
            self.assertLess(time.monotonic() - t0, 3)
            self.assertEqual(cm.exception.code, 504)
        srv.close()

    def test_the_real_connection_checks_the_certificate_against_the_name(self):
        c = tf._PinnedHTTPS("api.example.com", PUBLIC, 5)
        self.assertEqual(c.host, "api.example.com")
        self.assertEqual(c._ip, PUBLIC)
        self.assertEqual(c._context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(c._context.check_hostname)

    def test_localhost_by_name_is_refused_with_the_real_lookup(self):
        with self.assertRaises(FetchError) as cm:
            tf.fetch_url("https://localhost/x", ["localhost.example.com", "localhost"])
        self.assertEqual(cm.exception.code, 403)

    def test_falls_back_to_next_checked_ip(self):
        tried = []
        def open_second(host, ip, path, deadline):
            tried.append(ip)
            if ip == "2606:4700:4700::1111":
                raise OSError("Network is unreachable")
            return 200, {"content-type": "application/json"}, b'{"ok":true}'
        with ct.patch_everywhere("FETCH_RESOLVE", lambda h: ["2606:4700:4700::1111", PUBLIC]), \
                ct.patch_everywhere("FETCH_OPEN", open_second):
            res = tf.fetch_url("https://api.example.com/x", HOSTS)
        self.assertEqual(res["body"], b'{"ok":true}')
        self.assertEqual(tried, ["2606:4700:4700::1111", PUBLIC])


if __name__ == "__main__":
    unittest.main()
