"""API keys for community tiles: kept on the server, added only to requests to the one site each key is for.

A community tile can ask for a key with a `secret` setting:

    "key": {"type": "secret", "label": "API key", "host": "api.example.com", "header": "X-Api-Key"}

(or `"query": "appid"` to send it as part of the address, and `"prefix": "Bearer "` before it in a header). The person
types the key in the tile's settings. It is saved here, in its own file in the data folder (tile-keys.json, readable
only by this user), never in the settings, so it isn't in shared layouts, exports, backups of the settings or
diagnostics. No browser ever gets it back: the dashboard and the tile's frame only learn whether one is saved.

/tile-fetch adds it, and only when the request goes to exactly the host it was saved for, in exactly the way it was
saved for. If an update to the tile sends the key somewhere else or in another way, the saved key isn't used until the
person types it again. A redirect to another site never carries it, and the answer the tile gets has the key blanked
out, in case the site repeats it.

One key per setting per kind of tile: every copy of a tile on the screens uses the same key.
"""
import json
import re
import threading
import time
from urllib.parse import quote, quote_plus, unquote_plus

from server.core import WORK

KEYS_FILE = WORK / "tile-keys.json"
KEYS_LOCK = threading.Lock()
KEY_MAX = 512
KEY_RE = re.compile(r"^[\x21-\x7e]{6,%d}$" % KEY_MAX)       # printable, no spaces or line breaks: nothing can be slipped into a header
MAX_SECRETS = 3
SECRET_HEADER_RE = re.compile(r"^[A-Za-z][A-Za-z0-9-]{0,39}$")
SECRET_QUERY_RE = re.compile(r"^[A-Za-z0-9_.-]{1,40}$")
SECRET_PREFIX_RE = re.compile(r"^[\x20-\x7e]{0,20}$")
# headers the server sets itself, or that would change where or how the request goes
SECRET_HEADERS_REFUSED = {"host", "content-length", "transfer-encoding", "connection", "keep-alive", "te", "upgrade", "expect",
                          "cookie", "user-agent", "accept", "accept-encoding", "proxy-authorization", "proxy-connection",
                          "forwarded", "x-forwarded-for", "x-forwarded-host", "x-real-ip", "origin", "referer"}
HIDDEN = b"********"
PLACE = ("host", "header", "query", "prefix")        # what a key was saved for; a change means it must be typed again


def clean_secret(name, s, hosts):
    """A `secret` setting from a tile file, checked: {type, label, help, host, header|query, prefix}. ValueError otherwise."""
    from server.tilefetch import FETCH_HOST_RE, host_allowed
    host = str(s.get("host") or "").strip().lower().rstrip(".")
    if not FETCH_HOST_RE.match(host) or host.startswith("*."):
        raise ValueError("setting %s must name the one site its key is sent to, like api.example.com" % name)
    if not host_allowed(host, hosts):
        raise ValueError("setting %s sends its key to %s, which isn't one of the tile's sites" % (name, host))
    header, query = s.get("header"), s.get("query")
    if (header is None) == (query is None):
        raise ValueError("setting %s must say how its key is sent: a header or a query" % name)
    out = {"type": "secret", "label": str(s.get("label") or name)[:60], "help": str(s.get("help") or "")[:300], "host": host}
    if header is not None:
        if not isinstance(header, str) or not SECRET_HEADER_RE.match(header) or header.lower() in SECRET_HEADERS_REFUSED:
            raise ValueError("setting %s can't send its key in that header" % name)
        prefix = s.get("prefix") or ""
        if not isinstance(prefix, str) or not SECRET_PREFIX_RE.match(prefix):
            raise ValueError("setting %s has a prefix Countertop can't send" % name)
        out.update(header=header, prefix=prefix)
    else:
        if not isinstance(query, str) or not SECRET_QUERY_RE.match(query):
            raise ValueError("setting %s can't send its key as that part of the address" % name)
        out["query"] = query
    return out


def _place(d):
    return {k: d.get(k) or "" for k in PLACE}


def _load():
    try:
        d = json.loads(KEYS_FILE.read_text())
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _write(d):
    KEYS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = KEYS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, indent=1))
    tmp.chmod(0o600)
    tmp.replace(KEYS_FILE)


def _saved(tile):
    d = _load().get(tile["id"]) if tile else None
    return d if isinstance(d, dict) else {}


def secrets_of(tile):
    return {k: d for k, d in (tile or {}).get("settings", {}).items() if isinstance(d, dict) and d.get("type") == "secret"}


def key_states(tile):
    """{setting: "set" | "moved" | ""} for a tile's secret settings. "moved": a key is saved, but the tile now sends it
    to another site or in another way, so it isn't used."""
    saved = _saved(tile)
    out = {}
    for k, d in secrets_of(tile).items():
        e = saved.get(k)
        out[k] = "" if not isinstance(e, dict) or not e.get("value") else "set" if _place(e) == _place(d) else "moved"
    return out


def fetch_keys(tile):
    """The keys /tile-fetch may add for this tile: [{host, header|query, prefix, value}], only those still saved for
    exactly what the tile's file says now."""
    if not tile:
        return []
    saved = _saved(tile)
    out = []
    for k, d in secrets_of(tile).items():
        e = saved.get(k)
        if isinstance(e, dict) and isinstance(e.get("value"), str) and KEY_RE.match(e["value"]) and _place(e) == _place(d):
            out.append(dict(_place(d), value=e["value"]))
    return out


def save_key(tile, name, value):
    """Save (or, with value None, remove) the key for one secret setting. Returns key_states(tile)."""
    d = secrets_of(tile).get(name) if tile else None
    if not d:
        raise ValueError("This tile has no such key")
    if value is not None and (not isinstance(value, str) or not KEY_RE.match(value.strip())):
        raise ValueError("That doesn't look like a key: 6 to %d letters, digits or symbols, without spaces" % KEY_MAX)
    with KEYS_LOCK:
        all_ = _load()
        mine = all_.get(tile["id"]) if isinstance(all_.get(tile["id"]), dict) else {}
        if value is None:
            mine.pop(name, None)
        else:
            mine[name] = dict(_place(d), value=value.strip(), at=int(time.time()))
        if mine:
            all_[tile["id"]] = mine
        else:
            all_.pop(tile["id"], None)
        _write(all_)
    print("%s the key for “%s” in the community tile %s" % ("Removed" if value is None else "Saved", d["label"], tile["id"]), flush=True)
    return key_states(tile)


def saved_key_values():
    """Every saved key, for Diagnostics to blank out of anything it bundles."""
    return {e["value"] for t in _load().values() if isinstance(t, dict) for e in t.values()
            if isinstance(e, dict) and isinstance(e.get("value"), str) and len(e["value"]) > 5}


# ---------- used by tilefetch ----------
def apply_keys(host, path, keys):
    """(path, headers) for one request to `host`: the keys meant for exactly this host added, a query key replacing
    anything of the same name the tile put in the address."""
    headers = {}
    for k in keys:
        if k["host"] != host:
            continue
        if k.get("header"):
            headers[k["header"]] = (k.get("prefix") or "") + k["value"]
        else:
            base, _, q = path.partition("?")
            name = k["query"].lower()
            parts = [p for p in q.split("&") if p and unquote_plus(p.split("=", 1)[0]).lower() != name]
            parts.append(quote(k["query"], safe="") + "=" + quote(k["value"], safe=""))
            path = base + "?" + "&".join(parts)
    return path, headers


def _forms(value):
    return {f.encode("utf-8") for f in (value, quote(value, safe=""), quote_plus(value, safe=""), quote(value), json.dumps(value)[1:-1],
                                         json.dumps(value)[1:-1].replace("/", "\\/"))}


def carries_key(text, keys):
    """True when `text` (a redirect's address) holds any of the keys, as typed or written for an address."""
    t = (text or "").encode("utf-8", "replace")
    return any(f in t for k in keys for f in _forms(k["value"]))


def hide_keys(body, keys):
    """The answer with every copy of a key blanked out, so a site that repeats it doesn't hand it to the tile."""
    if not keys:
        return body
    if isinstance(body, str):
        return hide_keys(body.encode("utf-8"), keys).decode("utf-8", "replace")
    for k in keys:
        for f in sorted(_forms(k["value"]), key=len, reverse=True):
            body = body.replace(f, HIDDEN)
    return body
