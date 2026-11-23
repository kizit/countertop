"""Web addresses a tile reads through the server (GET /tile-fetch). A tile never reaches the internet by itself.

Only https:// addresses on the hosts the tile declared. The name is looked up once, and every address it gives must
be a public one: nothing on the home network, loopback, link-local, carrier-grade NAT, multicast, reserved, or IPv6
local and unique-local, and no IPv4 address tucked inside an IPv6 one. The connection then goes to exactly the address
that was checked, so a second lookup can't send it somewhere else. Redirects are followed by hand, at most 3, and each
one is checked again in the same way. At most 1 MB, and 10 seconds for the whole fetch.

A community tile's API keys (server/tilekeys.py) are added here, to requests to exactly the host each one is for, and
nowhere else: a redirect whose address carries a key to another site is refused, and the key is blanked out of the
answer.
"""
import hashlib
import http.client
import ipaddress
import json
import re
import socket
import ssl
import threading
import time
from urllib.parse import urljoin, urlsplit

from server.core import VERSION
from server.tilekeys import apply_keys, carries_key, hide_keys

FETCH_MAX_BYTES = 1_000_000
FETCH_TIMEOUT = 10.0
FETCH_MAX_REDIRECTS = 3
FETCH_USER_AGENT = "Mozilla/5.0 (compatible; Countertop/%s; +https://github.com/kizit/countertop)" % VERSION
# a host a tile may declare: a public name, optionally "*." for one level of subdomain. Never an address.
FETCH_HOST_RE = re.compile(r"^(\*\.)?(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$")
FETCH_TYPES = ("application/json", "text/", "application/xml", "application/rss+xml", "application/atom+xml")

_FETCH_NETS = [ipaddress.ip_network(n) for n in (
    # IPv4: this network, private, carrier-grade NAT, loopback, link-local, IETF and test ranges, 6to4 relay, benchmarking,
    # multicast, reserved and broadcast
    "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24",
    "192.0.2.0/24", "192.88.99.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24",
    "224.0.0.0/4", "240.0.0.0/4",
    # IPv6: unspecified and loopback, IPv4-compatible and IPv4-mapped, NAT64, discard, Teredo and documentation,
    # 6to4, unique-local, link-local, site-local and multicast
    "::/96", "::ffff:0:0/96", "64:ff9b::/96", "64:ff9b:1::/48", "100::/64", "2001::/32", "2001:db8::/32", "2002::/16",
    "fc00::/7", "fe80::/10", "fec0::/10", "ff00::/8")]


class FetchError(Exception):
    """A fetch that was refused or failed. `code` is the HTTP status the dashboard gets."""
    def __init__(self, msg, code=502):
        super().__init__(msg)
        self.code = code


def address_blocked(ip):
    """True for any address that isn't plainly on the public internet."""
    try:
        a = ipaddress.ip_address(str(ip).split("%")[0])
    except ValueError:
        return True
    if any(a.version == n.version and a in n for n in _FETCH_NETS):
        return True
    mapped = getattr(a, "ipv4_mapped", None) or getattr(a, "sixtofour", None) or (a.teredo[1] if getattr(a, "teredo", None) else None)
    if mapped is not None and address_blocked(mapped):
        return True
    return not a.is_global or a.is_private or a.is_loopback or a.is_link_local or a.is_multicast or a.is_reserved or a.is_unspecified


def clean_hosts(hosts):
    """The hosts a tile declared that are allowed at all: public names, lower case, no addresses, ports or paths."""
    out = []
    for h in hosts if isinstance(hosts, (list, tuple)) else []:
        h = str(h).strip().lower().rstrip(".")
        if FETCH_HOST_RE.match(h) and h not in out:
            out.append(h)
    return out[:10]


def host_allowed(host, hosts):
    host = host.lower().rstrip(".")
    for h in hosts:
        if h.startswith("*."):
            base = h[2:]
            if host.endswith("." + base) and "." not in host[:-len(base) - 1]:
                return True
        elif host == h:
            return True
    return False


def check_url(url, hosts):
    """(host, path) for an address the tile may read, or FetchError(403) saying why not. No network is used."""
    if not isinstance(url, str) or len(url) > 2000 or re.search(r"[\x00-\x20\x7f\\]", url):
        raise FetchError("not a web address", 400)
    try:
        u = urlsplit(url)
        port = u.port
    except ValueError:
        raise FetchError("not a web address", 400)
    if u.scheme != "https":
        raise FetchError("only https:// addresses", 403)
    if u.username is not None or u.password is not None or "@" in u.netloc:
        raise FetchError("addresses with a name and password aren't allowed", 403)
    host = (u.hostname or "").lower().rstrip(".")
    if not host:
        raise FetchError("not a web address", 400)
    try:
        ipaddress.ip_address(host)
        raise FetchError("only names, not numeric addresses", 403)
    except ValueError:
        pass
    if port not in (None, 443):
        raise FetchError("only the usual https port", 403)
    if not host_allowed(host, hosts):
        raise FetchError("%s isn't one of this tile's sites" % host, 403)
    return host, (u.path or "/") + ("?" + u.query if u.query else "")


def _resolve(host):
    return [ai[4][0] for ai in socket.getaddrinfo(host, 443, 0, socket.SOCK_STREAM, socket.IPPROTO_TCP)]


class _PinnedHTTPS(http.client.HTTPSConnection):
    """HTTPS to one exact address, with the certificate still checked against the host name."""
    def __init__(self, host, ip, timeout):
        super().__init__(host, 443, timeout=timeout, context=ssl.create_default_context())
        self._ip = ip

    def connect(self):
        sock = socket.create_connection((self._ip, 443), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def _open(host, ip, path, deadline, extra=None):
    """(status, headers, body) from one request to `ip`, reading at most FETCH_MAX_BYTES + 1 bytes before `deadline`.
    `extra` is the headers that carry a tile's keys for this host."""
    left = lambda: max(0.05, deadline - time.monotonic())
    conn = _PinnedHTTPS(host, ip, left())
    try:
        conn.request("GET", path, headers=dict(extra or {}, **{"User-Agent": FETCH_USER_AGENT, "Accept": "application/json, text/*;q=0.9, */*;q=0.5",
                                                                "Accept-Encoding": "identity"}))
        r = conn.getresponse()
        heads = {k.lower(): v for k, v in r.getheaders()}
        body = b""
        if r.status == 200:
            while len(body) <= FETCH_MAX_BYTES:
                if time.monotonic() > deadline:
                    raise FetchError("took longer than %d seconds" % FETCH_TIMEOUT, 504)
                conn.sock.settimeout(left())
                chunk = r.read(min(65536, FETCH_MAX_BYTES + 1 - len(body)))
                if not chunk:
                    break
                body += chunk
        return r.status, heads, body
    except socket.timeout:
        raise FetchError("took longer than %d seconds" % FETCH_TIMEOUT, 504)
    finally:
        conn.close()


# both swapped in tests, so no test needs the network
FETCH_RESOLVE = _resolve
FETCH_OPEN = _open


def fetch_url(url, hosts, keys=()):
    """{"type", "body"} for `url`, following the rules at the top of this file; FetchError otherwise. `keys` are the
    tile's API keys, each added only for its own host."""
    try:
        return _fetch_url(url, hosts, keys)
    except FetchError as e:
        # a message never repeats a key, whatever the other end or the network library put in it
        raise FetchError(hide_keys(str(e), keys), e.code) if keys else e


def _fetch_url(url, hosts, keys):
    deadline = time.monotonic() + FETCH_TIMEOUT
    for hop in range(FETCH_MAX_REDIRECTS + 1):
        host, path = check_url(url, hosts)
        path, extra = apply_keys(host, path, keys)
        try:
            ips = FETCH_RESOLVE(host)
        except (OSError, UnicodeError):
            raise FetchError("%s couldn't be found" % host)
        if not ips:
            raise FetchError("%s couldn't be found" % host)
        if any(address_blocked(ip) for ip in ips):
            raise FetchError("%s points to a private address" % host, 403)
        if time.monotonic() > deadline:
            raise FetchError("took longer than %d seconds" % FETCH_TIMEOUT, 504)
        try:
            status, heads, body = FETCH_OPEN(host, ips[0], path, deadline, extra) if extra else FETCH_OPEN(host, ips[0], path, deadline)
        except FetchError:
            raise
        except (OSError, http.client.HTTPException, ssl.SSLError) as e:
            raise FetchError("%s didn't answer (%s)" % (host, str(e)[:80]))
        if status in (301, 302, 303, 307, 308):
            loc = heads.get("location")
            if not loc:
                raise FetchError("%s sent a redirect without an address" % host)
            if hop == FETCH_MAX_REDIRECTS:
                break
            url = urljoin(url, loc.strip())
            if keys and carries_key(url, [k for k in keys if k["host"] != (urlsplit(url).hostname or "").lower().rstrip(".")]):
                raise FetchError("%s tried to send this tile's key on to another site" % host, 403)
            continue
        if status != 200:
            raise FetchError("%s answered %d" % (host, status))
        if len(body) > FETCH_MAX_BYTES:
            raise FetchError("the answer is larger than 1 MB")
        ctype = (heads.get("content-type") or "").split(";")[0].strip().lower()
        if not ctype.startswith(FETCH_TYPES) and not ctype.endswith("+json"):
            raise FetchError("the answer isn't text or data (%s)" % (ctype or "no type")[:40])
        return {"type": ctype, "body": hide_keys(body, keys)}
    raise FetchError("more than %d redirects" % FETCH_MAX_REDIRECTS)


# answers kept for a while, so screens and redraws don't ask the same site again and again
FETCH_CACHE = {}
FETCH_LOCK = threading.Lock()
FETCH_CACHE_MAX = 200


def cached_fetch(url, hosts, max_age=300, keys=(), scope=""):
    """fetch() with a cache: answers for `max_age` seconds (30 to 3600), failures for 30 seconds. The address is
    checked against `hosts` before the cache is, so a tile never gets another tile's answer for a site it didn't declare.
    An answer read with a tile's keys is kept for that kind of tile (`scope`) and those keys only."""
    check_url(url, hosts)
    slot = url
    if keys:
        sig = hashlib.sha256(json.dumps(sorted(json.dumps(k, sort_keys=True) for k in keys)).encode()).hexdigest()
        slot = "%s\n%s\n%s" % (scope, sig, url)
    try:
        keep = min(3600, max(30, int(max_age)))
    except (TypeError, ValueError):
        keep = 300
    now = time.time()
    with FETCH_LOCK:
        hit = FETCH_CACHE.get(slot)
    if hit and now - hit[0] < (30 if isinstance(hit[1], FetchError) else keep):
        if isinstance(hit[1], FetchError):
            raise hit[1]
        return hit[1]
    try:
        res = fetch_url(url, hosts, keys)
    except FetchError as e:
        if e.code not in (400, 403):
            with FETCH_LOCK:
                FETCH_CACHE[slot] = (now, e)
        raise
    with FETCH_LOCK:
        if len(FETCH_CACHE) >= FETCH_CACHE_MAX:
            for k in sorted(FETCH_CACHE, key=lambda k: FETCH_CACHE[k][0])[:FETCH_CACHE_MAX // 4]:
                del FETCH_CACHE[k]
        FETCH_CACHE[slot] = (now, res)
    return res
