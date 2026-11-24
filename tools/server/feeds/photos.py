"""Shared photo albums: iCloud (legacy & CloudKit), local folders, Nextcloud/ownCloud, Immich, Plex, Jellyfin and PhotoPrism."""
import base64
import email.utils
import hashlib
import json
import mimetypes
import os
import re
import socket
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, urlencode, urljoin, urlparse
from urllib.request import Request, urlopen


# --- cache and limits ---
PHOTO_CACHES = {}          # cache key -> {at, ttl, key, data, assets, items}
B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
IMAGE_MIMES = {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"}
MAX_ALBUM_PHOTOS = 2000
MAX_IMAGE_BYTES = 30_000_000

# --- iCloud CloudKit shared album constants ---
CK_CONTAINER = "com.apple.photos.cloud"
CK_RESOLVE_URL = "https://ckdatabasews.icloud.com/database/1/%s/production/public/records/resolve" % CK_CONTAINER
CK_QUERY_PATH = "/database/1/%s/production/shared/records/query" % CK_CONTAINER
CK_ASSET_QUERY = "CPLAssetAndMasterByAssetDateWithoutHiddenOrDeleted"
CK_VIDEO_TYPES = {
    "com.apple.quicktime-movie", "public.mpeg-4", "public.movie",
    "public.avi", "com.apple.m4v-video", "public.mpeg",
}
CK_WEB_IMAGE_TYPES = {"public.jpeg", "public.png", "public.webp", "com.compuserve.gif"}
CK_HEADERS = {
    "Origin": "https://photos.icloud.com",
    "Referer": "https://photos.icloud.com/",
    "Content-Type": "text/plain",
    "User-Agent": "Mozilla/5.0",
}

WRONG_LINK = ("That isn't a shared album link. In Photos, open the shared album, tap the people icon, turn on Public Website "
              "and copy the link. A shared Photo Library has no public link, so it can't be shown.")


def _fid(key):
    """Stable opaque item ID for proxied /photos/item/<sid>/<fid> links."""
    return hashlib.sha256(str(key).encode("utf-8")).hexdigest()[:16]


def _http_base(raw):
    """Validate and normalize an http(s) server base address (never allows file:// or other schemes)."""
    raw = (raw or "").strip()
    if not raw:
        return ""
    if "://" not in raw:
        raw = "http://" + raw
    u = urlparse(raw)
    if u.scheme not in ("http", "https") or not u.netloc:
        raise ValueError("Check the server address: it should start with http:// or https://.")
    return raw.rstrip("/")


def _cache_fresh(cache, ck):
    return cache.get("data") is not None and cache.get("key") == ck and time.time() - cache.get("at", 0) < cache.get("ttl", 1800)


def _keep_or_error(cache, ck, album_name, msg, ttl=60):
    if cache.get("key") == ck and cache.get("data") is not None and cache["data"].get("photos"):
        out = dict(cache["data"], error=msg)
    else:
        out = {"photos": [], "album": album_name, "error": msg}
    cache.update(at=time.time(), ttl=ttl, key=ck, data=out)
    return out


def _service_error(e, service):
    """Plain-words error for a self-hosted photo service."""
    reason = getattr(e, "reason", e)
    code = getattr(e, "code", None)
    if isinstance(e, ValueError):
        return str(e)[:200]
    if code in (401, 403):
        return "%s rejected the sign-in. Check the API key, token or password." % service
    if code == 404:
        return "%s didn't find that address or album. Check the server address and album name." % service
    if isinstance(reason, socket.gaierror) or "Name or service not known" in str(reason) or "getaddrinfo" in str(reason):
        return "This computer couldn't find %s on the network. In Docker, use its IP address instead of a .local name." % service
    if isinstance(reason, (socket.timeout, TimeoutError)) or "timed out" in str(reason):
        return "%s didn't answer in time. Check that it is running and reachable from this server." % service
    if isinstance(reason, ConnectionRefusedError) or "Connection refused" in str(reason):
        return "%s refused the connection. Check the address and port." % service
    return str(reason)[:200]


def _fetch_image_bytes(url, headers, timeout=25):
    req = Request(url, headers=headers)
    with urlopen(req, timeout=timeout) as r:
        ct = (r.headers.get("Content-Type") or "image/jpeg").split(";")[0].strip().lower()
        if ct.startswith("text/") or ct == "application/json":
            return None
        if not ct.startswith("image/"):
            ct = "image/jpeg"
        return r.read(MAX_IMAGE_BYTES), ct


# --- Immich (self-hosted, server-proxied) ---


def _immich_json(base, key, path, timeout=30):
    req = Request(base.rstrip("/") + path, headers={"x-api-key": key, "Accept": "application/json"})
    with urlopen(req, timeout=timeout) as r:
        return json.loads(r.read(8_000_000).decode("utf-8", "replace"))


def _immich_album_assets(base, key, alb_id):
    """Every asset in the album, on any Immich generation: /albums/{id}/assets (older versions),
    else the timeline API (v3+: monthly buckets whose answers come as columns, one list per key)."""
    try:
        return _immich_json(base, key, "/api/albums/%s/assets" % alb_id) or []
    except Exception:
        out = []
        for b in _immich_json(base, key, "/api/timeline/buckets?albumId=%s" % alb_id) or []:
            col = _immich_json(base, key, "/api/timeline/bucket?albumId=%s&timeBucket=%s"
                                % (alb_id, b.get("timeBucket") or "")) or {}
            ids, imgs, dates = col.get("id") or [], col.get("isImage") or [], col.get("fileCreatedAt") or []
            for i, aid in enumerate(ids):
                out.append({"id": aid,
                            "type": "IMAGE" if (imgs[i] if i < len(imgs) else True) else "VIDEO",
                            "exifInfo": {"dateTimeOriginal": dates[i] if i < len(dates) else ""}})
        return out


def immich_album_photos(src, use_cache=True):
    want = (src.get("album") or "").strip()
    key = (src.get("apiKey") or "").strip()
    raw_base = (src.get("server") or "").strip()
    if not raw_base or not key:
        return {"photos": [], "album": want, "error": "give Immich's address and an API key in Setup"}
    sid = src.get("id") or "test"
    ck = raw_base + "|" + key + "|" + want.lower()
    cache = PHOTO_CACHES.setdefault("immich:" + sid, {"at": 0, "ttl": 1800, "key": ck, "data": None, "assets": set()}) if use_cache else {"at": 0, "ttl": 1800, "key": ck, "data": None, "assets": set()}
    if use_cache and _cache_fresh(cache, ck):
        return cache["data"]
    out = {"photos": [], "error": None, "album": want}
    try:
        base = _http_base(raw_base)
        albums = _immich_json(base, key, "/api/albums")
        alb = next((a for a in albums if (a.get("albumName") or "").strip().lower() == want.lower()), None)
        if alb is None:
            raise ValueError("no album named “%s” on that Immich" % want if want else "name the album in Setup")
        assets = _immich_album_assets(base, key, alb["id"]) or []
        allowed = set()
        for a in assets:
            if (a.get("type") or "").upper() != "IMAGE":
                continue
            ex = a.get("exifInfo") or {}
            allowed.add(a["id"])
            out["photos"].append({"url": "/photos/immich/%s/%s.jpg" % (sid, a["id"]),
                                  "caption": ex.get("description") or "",
                                  "date": ex.get("dateTimeOriginal") or "",
                                  "w": int(ex.get("exifImageWidth") or 0),
                                  "h": int(ex.get("exifImageHeight") or 0)})
            if len(out["photos"]) >= MAX_ALBUM_PHOTOS:
                break
        cache.update(at=time.time(), ttl=1800, key=ck, data=out, assets=allowed)
    except Exception as e:
        out = _keep_or_error(cache, ck, want, _service_error(e, "Immich"))
    return out


# --- iCloud Shared Albums (legacy sharedstreams + newer CloudKit) ---


def _icloud_host_ok(host):
    h = (host or "").lower().rstrip(".")
    return h in ("icloud.com", "icloud.com.cn") or h.endswith(".icloud.com") or h.endswith(".icloud.com.cn")


def parse_icloud_link(link):
    """Parse an iCloud shared album link into (kind, token) where kind is 'sharedstreams' or 'cloudkit', else (None, None)."""
    link = (link or "").strip()
    if not link:
        return None, None
    # Bare token (no slashes, spaces or fragments)
    if "/" not in link and "#" not in link and not re.search(r"\s", link):
        if re.fullmatch(r"[A-Za-z0-9_-]{20,64}", link):
            return "cloudkit", link
        if re.fullmatch(r"[0-9A-Za-z]{8,19}", link) and link[0] in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789":
            return "sharedstreams", link
        return None, None

    parsed = urlparse(link if "://" in link else "https://" + link)
    host = (parsed.hostname or "").lower()
    if not _icloud_host_ok(host):
        return None, None

    path = parsed.path or ""
    # Newer CloudKit shared album: https://photos.icloud.com/shared/album/<token>
    m = re.search(r"/shared/album/([A-Za-z0-9_-]+)", path)
    if m:
        tok = m.group(1)
        if 20 <= len(tok) <= 64:
            return "cloudkit", tok
        return None, None

    # iCloud link share on share.icloud.com/photos/<token> (CloudKit shortGUIDs are 20+ chars)
    if host == "share.icloud.com":
        m = re.match(r"^/photos/([A-Za-z0-9_-]+)/?$", path)
        if m and 20 <= len(m.group(1)) <= 64:
            return "cloudkit", m.group(1)
        return None, None

    # Fragment form: icloud.com/sharedalbum/#<token> or icloud.com/photos/#<token>
    if parsed.fragment:
        tok = parsed.fragment.split(";")[0].strip("/ ")
        if re.fullmatch(r"[A-Za-z0-9_-]{20,64}", tok):
            return "cloudkit", tok
        if re.fullmatch(r"[0-9A-Za-z]{8,19}", tok) and tok[0] in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789":
            return "sharedstreams", tok
    return None, None


def album_token(link):
    """The token in an iCloud shared album link (legacy or CloudKit, or a bare token), else None."""
    return parse_icloud_link(link)[1]


def album_error(e):
    """A plain-words reason for a failed album fetch (the technical text goes to the log)."""
    reason = getattr(e, "reason", e)
    code = getattr(e, "code", None)
    if isinstance(e, ValueError):
        return str(e)[:200]
    if code in (401, 403, 404):
        return "Apple says no album is there. Check that Public Website is still on for the shared album."
    if isinstance(reason, socket.gaierror) or "Name or service not known" in str(reason) or "getaddrinfo" in str(reason):
        return ("This computer couldn't look up Apple's photo server. Check that it is online and that the album link is a "
                "shared album's Public Website link. In Docker, check the container's DNS setting.")
    if isinstance(reason, (socket.timeout, TimeoutError)) or "timed out" in str(reason):
        return "Apple's photo server didn't answer in time. It will try again shortly."
    return str(reason)[:200]


def _ck_post(url, body, params):
    req = Request(url + "?" + urlencode(params), data=json.dumps(body).encode("utf-8"),
                  headers=CK_HEADERS, method="POST")
    with urlopen(req, timeout=25) as r:
        return json.loads(r.read(16_000_000).decode("utf-8", "replace"))


def _ck_field(rec, name):
    return ((rec.get("fields") or {}).get(name) or {}).get("value")


def _ck_is_video(master):
    item_type = str(_ck_field(master, "itemType") or "").lower()
    return item_type in CK_VIDEO_TYPES or "movie" in item_type or "video" in item_type


def _ck_build_photos(recs):
    """Pair each CloudKit CPLAsset with its CPLMaster and extract web-ready photo entries."""
    masters = {r["recordName"]: r for r in recs
               if r.get("recordType") == "CPLMaster" and not r.get("deleted") and r.get("recordName")}
    photos = []
    for asset in recs:
        if asset.get("recordType") != "CPLAsset" or asset.get("deleted"):
            continue
        mref = _ck_field(asset, "masterRef")
        master = masters.get(mref.get("recordName")) if isinstance(mref, dict) else None
        if master is None or _ck_is_video(master):
            continue
        item_type = str(_ck_field(master, "itemType") or "").lower()
        candidates = [
            (asset, "resJPEGMedRes"), (master, "resJPEGMedRes"),
            (asset, "resJPEGFullRes"), (master, "resJPEGFullRes"),
        ]
        if item_type in CK_WEB_IMAGE_TYPES:
            candidates.extend([(asset, "resOriginalRes"), (master, "resOriginalRes")])
        picked_rec, picked_res = None, None
        for rec, field in candidates:
            res = _ck_field(rec, field)
            if isinstance(res, dict) and res.get("downloadURL"):
                picked_rec, picked_res = rec, res
                break
        if picked_res is None:
            continue
        ms = _ck_field(asset, "assetDate") or _ck_field(master, "originalCreationDate")
        when = ""
        if isinstance(ms, (int, float)) and ms > 0:
            tz_off = _ck_field(asset, "timeZoneOffset") or 0
            try:
                tz = timezone(timedelta(seconds=int(tz_off)))
                when = datetime.fromtimestamp(ms / 1000.0, tz=tz).isoformat()
            except Exception:
                when = ""
        cap = _ck_field(asset, "caption")
        w = int(_ck_field(picked_rec, "resJPEGMedWidth") or _ck_field(picked_rec, "resOriginalWidth") or 0)
        h = int(_ck_field(picked_rec, "resJPEGMedHeight") or _ck_field(picked_rec, "resOriginalHeight") or 0)
        photos.append({
            "url": picked_res["downloadURL"].replace("${f}", "image.jpg"),
            "caption": cap if isinstance(cap, str) else "",
            "date": when,
            "w": w,
            "h": h,
        })
        if len(photos) >= MAX_ALBUM_PHOTOS:
            break
    return photos


def _icloud_cloudkit_album(token):
    """Fetch a public CloudKit-backed iCloud Shared Album (photos.icloud.com/shared/album/<token>)."""
    resolved = _ck_post(CK_RESOLVE_URL, {"shortGUIDs": [{"value": token}]},
                        {"remapEnums": "true", "sharing_url_key": token})
    res = (resolved.get("results") or [None])[0]
    if not res or res.get("serverErrorCode") or "anonymousPublicAccess" not in res:
        raise ValueError("Apple says no public album is at that link. Check that Public Website is still on for the shared album.")
    acc = res["anonymousPublicAccess"]
    partition = (acc.get("databasePartition") or "").replace(":443", "").rstrip("/")
    pu = urlparse(partition)
    if pu.scheme != "https" or not _icloud_host_ok(pu.hostname):
        raise ValueError("Apple returned an unexpected server address for that album.")
    title = ((res.get("share") or {}).get("fields") or {}).get("cloudkit.title") or {}
    zone = res.get("zoneID")
    params = {"remapEnums": "true", "sharing_url_key": token, "publicAccessAuthToken": acc["token"]}
    recs, marker = [], None
    for _ in range(25):       # 200 records/page -> up to 5,000 records (~2,500 photos)
        body = {
            "query": {
                "recordType": CK_ASSET_QUERY,
                "filterBy": [
                    {"fieldName": "startRank", "comparator": "EQUALS", "fieldValue": {"type": "INT64", "value": 0}},
                    {"fieldName": "direction", "comparator": "EQUALS", "fieldValue": {"type": "STRING", "value": "ASCENDING"}},
                ],
            },
            "zoneID": zone,
            "resultsLimit": 200,
        }
        if marker:
            body["continuationMarker"] = marker
        page = _ck_post(partition + CK_QUERY_PATH, body, params)
        recs.extend(page.get("records") or [])
        marker = page.get("continuationMarker")
        if not marker:
            break
    return {"photos": _ck_build_photos(recs), "album": title.get("value") or "", "error": None, "ttl": 600}


def _icloud_sharedstreams_album(token):
    """Fetch a legacy iCloud Shared Album (sharedstreams API)."""
    n = 0
    for ch in (token[1:2] if token[0] == "A" else token[1:3]):
        n = n * 62 + B62.index(ch)
    host = "p%02d-sharedstreams.icloud.com" % n
    base = "https://%s/%s/sharedstreams/" % (host, token)
    try:
        stream = _get_json(base + "webstream", {"streamCtag": None})
    except Exception as e:
        # Apple answers 330 with the right partition host
        hdr = getattr(e, "headers", None)
        moved = hdr.get("X-Apple-MMe-Host") if hdr else None
        if not moved and hasattr(e, "read"):
            try:
                moved = json.loads(e.read().decode()).get("X-Apple-MMe-Host")
            except Exception:
                moved = None
        if not moved:
            raise
        base = "https://%s/%s/sharedstreams/" % (moved, token)
        stream = _get_json(base + "webstream", {"streamCtag": None})
    out = {"photos": [], "error": None, "album": stream.get("streamName", "")}
    photos = stream.get("photos") or []
    guids = [p["photoGuid"] for p in photos if p.get("photoGuid")]
    urls = {}
    for i in range(0, len(guids), 25):
        assets = _get_json(base + "webasseturls", {"photoGuids": guids[i:i + 25]})
        for cs, it in (assets.get("items") or {}).items():
            urls[cs] = "https://" + it["url_location"] + it["url_path"]
    for p in photos:
        ders = p.get("derivatives") or {}
        # largest version that is still a sensible size for a 1920x1080 screen
        best = None
        for d in ders.values():
            w = int(d.get("width") or 0)
            if d.get("checksum") in urls and w <= 2600 and (best is None or w > int(best.get("width") or 0)):
                best = d
        if best:
            out["photos"].append({"url": urls[best["checksum"]], "caption": p.get("caption", ""),
                                  "date": p.get("dateCreated", ""), "w": int(best.get("width") or 0),
                                  "h": int(best.get("height") or 0)})
    return out


def icloud_album_photos(src, use_cache=True):
    link = ((src or {}).get("url") or "").strip()
    if not link:
        return {"photos": [], "error": "no album set up"}
    cache = PHOTO_CACHES.setdefault(link, {"at": 0, "ttl": 1800, "key": link, "data": None}) if use_cache else {"at": 0, "ttl": 1800, "key": link, "data": None}
    if use_cache and _cache_fresh(cache, link):
        return cache["data"]
    try:
        mode, token = parse_icloud_link(link)
        if not token:
            raise ValueError(WRONG_LINK)
        if mode == "cloudkit":
            out = _icloud_cloudkit_album(token)
            ttl = 600   # CloudKit signed download URLs expire after ~15 minutes
        else:
            out = _icloud_sharedstreams_album(token)
            ttl = 1800
        cache.update(at=time.time(), ttl=ttl, key=link, data=out)
    except Exception as e:
        print("shared album %s: %s" % (src.get("name") or "", e), flush=True)
        out = _keep_or_error(cache, link, "", album_error(e))
    return out


# --- Local folder (served directly by this server; symlinks outside root are ignored) ---


def local_folder_photos(src, use_cache=True):
    raw_path = (src.get("path") or "").strip()
    subdirs = bool(src.get("subdirs"))
    if not raw_path:
        return {"photos": [], "album": "", "error": "Type a folder path in Setup → Photo albums."}
    sid = src.get("id") or "test"
    ck = "local|%s|%d" % (raw_path, int(subdirs))
    cache = PHOTO_CACHES.setdefault("src:" + sid, {"at": 0, "ttl": 300, "key": ck, "data": None, "items": {}}) if use_cache else {"at": 0, "ttl": 300, "key": ck, "data": None, "items": {}}
    if use_cache and _cache_fresh(cache, ck):
        return cache["data"]
    try:
        root = Path(raw_path).expanduser().resolve()
        if not root.exists() or not root.is_dir():
            raise ValueError("That folder wasn't found on this server. Check the path (in Docker or Unraid, make sure it is mounted into the container).")
        found = []
        if subdirs:
            for dirpath, dirnames, filenames in os.walk(root):
                dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
                for fn in sorted(filenames):
                    if fn.startswith("."):
                        continue
                    p = Path(dirpath) / fn
                    if p.suffix.lower() in IMAGE_EXTS:
                        found.append(p)
                        if len(found) >= MAX_ALBUM_PHOTOS:
                            break
                if len(found) >= MAX_ALBUM_PHOTOS:
                    break
        else:
            for p in sorted(root.iterdir(), key=lambda x: x.name.lower()):
                if p.name.startswith("."):
                    continue
                if p.suffix.lower() in IMAGE_EXTS:
                    found.append(p)
                    if len(found) >= MAX_ALBUM_PHOTOS:
                        break
        photos, items = [], {}
        for p in found:
            try:
                resolved = p.resolve()
                if not resolved.is_file() or not resolved.is_relative_to(root):
                    continue
                st = resolved.stat()
                if st.st_size <= 0 or st.st_size > MAX_IMAGE_BYTES:
                    continue
                rel = str(p.relative_to(root))
                fid = _fid("local:" + rel)
                mime = mimetypes.guess_type(resolved.name)[0] or "image/jpeg"
                if mime not in IMAGE_MIMES:
                    mime = "image/jpeg"
                when = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat()
                items[fid] = {"kind": "local", "path": resolved, "root": root, "mime": mime}
                photos.append({"url": "/photos/item/%s/%s" % (sid, fid), "caption": "", "date": when, "w": 0, "h": 0})
            except OSError:
                continue
        err = None
        if not photos:
            err = ("No photos (JPG, PNG, WebP or GIF) found in that folder."
                   + ("" if subdirs else " Turn on Include subfolders if they are in nested folders."))
        out = {"photos": photos, "album": src.get("name") or root.name, "error": err, "ttl": 300}
        cache.update(at=time.time(), ttl=300 if not err else 60, key=ck, data=out, items=items)
    except Exception as e:
        out = _keep_or_error(cache, ck, src.get("name") or "", _service_error(e, "Local folder"))
    return out


# --- Nextcloud / ownCloud public shared folder (WebDAV PROPFIND, server-proxied) ---


def parse_nextcloud_link(link):
    """Parse a Nextcloud/ownCloud public share link into (webdav_base_url, token), else (None, None)."""
    link = (link or "").strip()
    if not link:
        return None, None
    u = urlparse(link if "://" in link else "https://" + link)
    if u.scheme not in ("http", "https") or not u.netloc:
        return None, None
    m = re.match(r"^(.*?)(?:/index\.php)?/s/([A-Za-z0-9_-]+)(?:/.*)?$", u.path or "")
    if not m:
        return None, None
    prefix = m.group(1).rstrip("/")
    token = m.group(2)
    return "%s://%s%s/public.php/webdav" % (u.scheme, u.netloc, prefix), token


def _nc_auth_header(token, password):
    cred = base64.b64encode(("%s:%s" % (token, password or "")).encode("utf-8")).decode("ascii")
    return "Basic " + cred


def _xml_local(tag):
    return tag.rsplit("}", 1)[-1].lower()


def _nc_propfind(url, auth_header):
    body = (b'<?xml version="1.0" encoding="utf-8"?>'
            b'<d:propfind xmlns:d="DAV:"><d:prop>'
            b'<d:getcontenttype/><d:getlastmodified/><d:resourcetype/>'
            b'</d:prop></d:propfind>')
    req = Request(url, data=body, method="PROPFIND", headers={
        "Authorization": auth_header,
        "Depth": "1",
        "Content-Type": "application/xml; charset=utf-8",
    })
    with urlopen(req, timeout=25) as r:
        return r.read(8_000_000)


def nextcloud_album_photos(src, use_cache=True):
    link = (src.get("url") or "").strip()
    password = src.get("password") or ""
    subdirs = bool(src.get("subdirs"))
    if not link:
        return {"photos": [], "album": "", "error": "Paste a Nextcloud or ownCloud shared folder link in Setup → Photo albums."}
    sid = src.get("id") or "test"
    ck = "nc|%s|%s|%d" % (link, hashlib.sha256(password.encode()).hexdigest()[:12], int(subdirs))
    cache = PHOTO_CACHES.setdefault("src:" + sid, {"at": 0, "ttl": 1800, "key": ck, "data": None, "items": {}}) if use_cache else {"at": 0, "ttl": 1800, "key": ck, "data": None, "items": {}}
    if use_cache and _cache_fresh(cache, ck):
        return cache["data"]
    try:
        dav_base, token = parse_nextcloud_link(link)
        if not dav_base:
            raise ValueError("That doesn't look like a Nextcloud or ownCloud share link (expected .../s/<token>).")
        base_u = urlparse(dav_base)
        auth = _nc_auth_header(token, password)
        queue = [(dav_base + "/", 0)]
        seen_dirs = {dav_base.rstrip("/") + "/"}
        photos, items = [], {}
        while queue and len(photos) < MAX_ALBUM_PHOTOS and len(seen_dirs) <= 40:
            dir_url, depth = queue.pop(0)
            dir_path = urlparse(dir_url).path.rstrip("/")
            xml_bytes = _nc_propfind(dir_url, auth)
            root_el = ET.fromstring(xml_bytes)
            for resp in root_el.iter():
                if _xml_local(resp.tag) != "response":
                    continue
                href, ctype, lastmod, is_col = "", "", "", False
                for ch in resp.iter():
                    ln = _xml_local(ch.tag)
                    if ln == "href" and ch.text and not href:
                        href = ch.text.strip()
                    elif ln == "getcontenttype" and ch.text:
                        ctype = ch.text.strip().lower()
                    elif ln == "getlastmodified" and ch.text:
                        lastmod = ch.text.strip()
                    elif ln == "collection":
                        is_col = True
                if not href:
                    continue
                full_url = urljoin(dir_url, href)
                fu = urlparse(full_url)
                # Never follow hrefs to another host or scheme (protects Basic auth credentials)
                if fu.scheme != base_u.scheme or fu.netloc != base_u.netloc:
                    continue
                if fu.path.rstrip("/") == dir_path:
                    continue
                if is_col:
                    if subdirs and depth < 3:
                        norm = full_url.rstrip("/") + "/"
                        if norm not in seen_dirs:
                            seen_dirs.add(norm)
                            queue.append((norm, depth + 1))
                    continue
                ext = Path(fu.path).suffix.lower()
                if ctype not in IMAGE_MIMES and ext not in IMAGE_EXTS:
                    continue
                when = ""
                if lastmod:
                    try:
                        when = email.utils.parsedate_to_datetime(lastmod).isoformat()
                    except Exception:
                        when = ""
                fid = _fid("nc:" + fu.path)
                items[fid] = {"kind": "nextcloud", "url": full_url}
                photos.append({"url": "/photos/item/%s/%s" % (sid, fid), "caption": "", "date": when, "w": 0, "h": 0})
                if len(photos) >= MAX_ALBUM_PHOTOS:
                    break
        err = None if photos else "No photos (JPG, PNG, WebP or GIF) found in that shared folder."
        out = {"photos": photos, "album": src.get("name") or "", "error": err}
        cache.update(at=time.time(), ttl=1800 if not err else 60, key=ck, data=out, items=items)
    except Exception as e:
        out = _keep_or_error(cache, ck, src.get("name") or "", _service_error(e, "Nextcloud / ownCloud"))
    return out


# --- Plex (server-proxied, auto-resized via /photo/:/transcode) ---


def _plex_json(base, token, path, timeout=25):
    req = Request(base + path, headers={"X-Plex-Token": token, "Accept": "application/json"})
    with urlopen(req, timeout=timeout) as r:
        return json.loads(r.read(8_000_000).decode("utf-8", "replace"))


def _plex_photo_items(base, token, want):
    """Find matching photos in Plex: by library name, playlist name, collection/album name, or first photo library."""
    secs = (_plex_json(base, token, "/library/sections").get("MediaContainer") or {}).get("Directory") or []
    photo_secs = [s for s in secs if s.get("type") == "photo"]
    if not photo_secs:
        raise ValueError("No photo library was found on that Plex server.")
    wl = want.lower()
    if not wl:
        sec = photo_secs[0]
        mc = _plex_json(base, token, "/library/sections/%s/all?type=13&X-Plex-Container-Start=0&X-Plex-Container-Size=%d"
                        % (sec["key"], MAX_ALBUM_PHOTOS)).get("MediaContainer") or {}
        return sec.get("title") or "", mc.get("Metadata") or []

    # 1. Exact photo library name
    for sec in photo_secs:
        if (sec.get("title") or "").strip().lower() == wl:
            mc = _plex_json(base, token, "/library/sections/%s/all?type=13&X-Plex-Container-Start=0&X-Plex-Container-Size=%d"
                            % (sec["key"], MAX_ALBUM_PHOTOS)).get("MediaContainer") or {}
            return sec.get("title") or want, mc.get("Metadata") or []

    # 2. Photo playlist
    try:
        pls = (_plex_json(base, token, "/playlists?playlistType=photo").get("MediaContainer") or {}).get("Metadata") or []
        for pl in pls:
            if (pl.get("title") or "").strip().lower() == wl and pl.get("key"):
                mc = _plex_json(base, token, pl["key"]).get("MediaContainer") or {}
                return pl.get("title") or want, mc.get("Metadata") or []
    except Exception:
        pass

    # 3. Collection or sub-album inside any photo library
    for sec in photo_secs:
        for path in ("/library/sections/%s/collections" % sec["key"],
                     "/library/sections/%s/all?type=14" % sec["key"]):
            try:
                entries = (_plex_json(base, token, path).get("MediaContainer") or {}).get("Metadata") or []
            except Exception:
                continue
            for en in entries:
                if (en.get("title") or "").strip().lower() == wl and en.get("key"):
                    mc = _plex_json(base, token, en["key"]).get("MediaContainer") or {}
                    return en.get("title") or want, mc.get("Metadata") or []

    raise ValueError("No photo library or album named “%s” was found on that Plex server." % want)


def plex_album_photos(src, use_cache=True):
    raw_base = (src.get("server") or "").strip()
    token = (src.get("apiKey") or "").strip()
    want = (src.get("album") or "").strip()
    if not raw_base or not token:
        return {"photos": [], "album": want, "error": "Give Plex's address and token in Setup → Photo albums."}
    sid = src.get("id") or "test"
    ck = "plex|%s|%s|%s" % (raw_base, hashlib.sha256(token.encode()).hexdigest()[:12], want.lower())
    cache = PHOTO_CACHES.setdefault("src:" + sid, {"at": 0, "ttl": 1800, "key": ck, "data": None, "items": {}}) if use_cache else {"at": 0, "ttl": 1800, "key": ck, "data": None, "items": {}}
    if use_cache and _cache_fresh(cache, ck):
        return cache["data"]
    try:
        base = _http_base(raw_base)
        title, meta = _plex_photo_items(base, token, want)
        photos, items = [], {}
        for m in meta:
            if m.get("type") not in ("photo", None):
                continue
            media = (m.get("Media") or [{}])[0]
            part = (media.get("Part") or [{}])[0]
            part_key = part.get("key") or ""
            thumb = m.get("thumb") or ""
            if not part_key and not thumb:
                continue
            fid = _fid("plex:" + str(m.get("ratingKey") or part_key or thumb))
            when = m.get("originallyAvailableAt") or ""
            if not when and m.get("addedAt"):
                try:
                    when = datetime.fromtimestamp(int(m["addedAt"]), tz=timezone.utc).isoformat()
                except Exception:
                    when = ""
            items[fid] = {"kind": "plex", "path": part_key or thumb, "fallback": thumb or part_key}
            photos.append({
                "url": "/photos/item/%s/%s" % (sid, fid),
                "caption": m.get("summary") or "",
                "date": when,
                "w": int(media.get("width") or 0),
                "h": int(media.get("height") or 0),
            })
            if len(photos) >= MAX_ALBUM_PHOTOS:
                break
        err = None if photos else "No photos were found in that Plex library or album."
        out = {"photos": photos, "album": title or want, "error": err}
        cache.update(at=time.time(), ttl=1800 if not err else 60, key=ck, data=out, items=items)
    except Exception as e:
        out = _keep_or_error(cache, ck, want, _service_error(e, "Plex"))
    return out


# --- Jellyfin (server-proxied, auto-resized via /Items/<id>/Images/Primary) ---


def _jellyfin_headers(key):
    return {
        "X-Emby-Token": key,
        "Authorization": 'MediaBrowser Token="%s"' % key.replace('"', ""),
        "Accept": "application/json",
    }


def _jellyfin_json(base, key, path, timeout=25):
    req = Request(base + path, headers=_jellyfin_headers(key))
    with urlopen(req, timeout=timeout) as r:
        return json.loads(r.read(8_000_000).decode("utf-8", "replace"))


def _jellyfin_query_items(base, key, params):
    """Query /Items directly; fall back to /Users/<first-user>/Items on older Jellyfin servers."""
    qs = urlencode(params)
    try:
        return (_jellyfin_json(base, key, "/Items?" + qs).get("Items")) or []
    except Exception as first_err:
        if getattr(first_err, "code", None) in (401, 403):
            raise
        users = _jellyfin_json(base, key, "/Users")
        if not isinstance(users, list) or not users:
            raise first_err
        uid = users[0].get("Id")
        if not uid:
            raise first_err
        return (_jellyfin_json(base, key, "/Users/%s/Items?%s" % (quote(str(uid), safe=""), qs)).get("Items")) or []


def jellyfin_album_photos(src, use_cache=True):
    raw_base = (src.get("server") or "").strip()
    key = (src.get("apiKey") or "").strip()
    want = (src.get("album") or "").strip()
    if not raw_base or not key:
        return {"photos": [], "album": want, "error": "Give Jellyfin's address and an API key in Setup → Photo albums."}
    sid = src.get("id") or "test"
    ck = "jf|%s|%s|%s" % (raw_base, hashlib.sha256(key.encode()).hexdigest()[:12], want.lower())
    cache = PHOTO_CACHES.setdefault("src:" + sid, {"at": 0, "ttl": 1800, "key": ck, "data": None, "items": {}}) if use_cache else {"at": 0, "ttl": 1800, "key": ck, "data": None, "items": {}}
    if use_cache and _cache_fresh(cache, ck):
        return cache["data"]
    try:
        base = _http_base(raw_base)
        params = {
            "Recursive": "true",
            "IncludeItemTypes": "Photo",
            "Fields": "DateCreated,OriginalTitle,Width,Height",
            "Limit": str(MAX_ALBUM_PHOTOS),
        }
        title = want
        if want:
            containers = _jellyfin_query_items(base, key, {
                "Recursive": "true",
                "IncludeItemTypes": "Folder,PhotoAlbum,CollectionFolder,BoxSet",
                "Limit": "500",
            })
            match = next((c for c in containers if (c.get("Name") or "").strip().lower() == want.lower()), None)
            if not match:
                raise ValueError("No folder or album named “%s” was found on that Jellyfin server." % want)
            params["ParentId"] = match["Id"]
            title = match.get("Name") or want
        entries = _jellyfin_query_items(base, key, params)
        photos, items = [], {}
        for it in entries:
            iid = it.get("Id")
            if not iid:
                continue
            fid = _fid("jf:" + str(iid))
            items[fid] = {"kind": "jellyfin", "item_id": str(iid)}
            photos.append({
                "url": "/photos/item/%s/%s" % (sid, fid),
                "caption": "",
                "date": it.get("PremiereDate") or it.get("DateCreated") or "",
                "w": int(it.get("Width") or 0),
                "h": int(it.get("Height") or 0),
            })
            if len(photos) >= MAX_ALBUM_PHOTOS:
                break
        err = None if photos else "No photos were found in that Jellyfin library or album."
        out = {"photos": photos, "album": title, "error": err}
        cache.update(at=time.time(), ttl=1800 if not err else 60, key=ck, data=out, items=items)
    except Exception as e:
        out = _keep_or_error(cache, ck, want, _service_error(e, "Jellyfin"))
    return out


# --- PhotoPrism (server-proxied, auto-resized via /api/v1/t/<hash>/<previewToken>/fit_1920) ---


def _photoprism_headers(key):
    h = {"Accept": "application/json"}
    if key:
        h["Authorization"] = "Bearer " + key
        h["X-Auth-Token"] = key
    return h


def _photoprism_json(base, key, path, timeout=25):
    req = Request(base + path, headers=_photoprism_headers(key))
    with urlopen(req, timeout=timeout) as r:
        data = json.loads(r.read(8_000_000).decode("utf-8", "replace"))
        return data, r.headers


def photoprism_album_photos(src, use_cache=True):
    raw_base = (src.get("server") or "").strip()
    key = (src.get("apiKey") or "").strip()
    want = (src.get("album") or "").strip()
    if not raw_base:
        return {"photos": [], "album": want, "error": "Give PhotoPrism's address in Setup → Photo albums."}
    sid = src.get("id") or "test"
    ck = "pp|%s|%s|%s" % (raw_base, hashlib.sha256(key.encode()).hexdigest()[:12], want.lower())
    cache = PHOTO_CACHES.setdefault("src:" + sid, {"at": 0, "ttl": 1800, "key": ck, "data": None, "items": {}}) if use_cache else {"at": 0, "ttl": 1800, "key": ck, "data": None, "items": {}}
    if use_cache and _cache_fresh(cache, ck):
        return cache["data"]
    try:
        base = _http_base(raw_base)
        params = {"count": str(MAX_ALBUM_PHOTOS), "offset": "0", "primary": "true"}
        title = want
        if want:
            albums, _ = _photoprism_json(base, key, "/api/v1/albums?count=500&offset=0&type=album")
            alb = next((a for a in (albums or [])
                        if (a.get("Title") or "").strip().lower() == want.lower() or (a.get("UID") or "").lower() == want.lower()), None)
            if alb is None:
                # Also check folders, moments and months if not found among user albums
                all_albs, _ = _photoprism_json(base, key, "/api/v1/albums?count=500&offset=0")
                alb = next((a for a in (all_albs or [])
                            if (a.get("Title") or "").strip().lower() == want.lower() or (a.get("UID") or "").lower() == want.lower()), None)
            if alb is None:
                raise ValueError("No album named “%s” was found on that PhotoPrism server." % want)
            params["s"] = alb["UID"]
            title = alb.get("Title") or want
        entries, hdrs = _photoprism_json(base, key, "/api/v1/photos?" + urlencode(params))
        preview_tok = (hdrs.get("X-Preview-Token") if hdrs else None) or "public"
        photos, items = [], {}
        for p in (entries or []):
            if (p.get("Type") or "").lower() == "video":
                continue
            hsh = p.get("Hash") or ((p.get("Files") or [{}])[0].get("Hash") if p.get("Files") else "")
            if not hsh:
                continue
            fid = _fid("pp:" + hsh)
            items[fid] = {"kind": "photoprism", "hash": hsh, "preview": preview_tok}
            photos.append({
                "url": "/photos/item/%s/%s" % (sid, fid),
                "caption": p.get("Description") or "",
                "date": p.get("TakenAtLocal") or p.get("TakenAt") or "",
                "w": int(p.get("Width") or 0),
                "h": int(p.get("Height") or 0),
            })
            if len(photos) >= MAX_ALBUM_PHOTOS:
                break
        err = None if photos else "No photos were found in that PhotoPrism album."
        out = {"photos": photos, "album": title, "error": err}
        cache.update(at=time.time(), ttl=1800 if not err else 60, key=ck, data=out, items=items)
    except Exception as e:
        out = _keep_or_error(cache, ck, want, _service_error(e, "PhotoPrism"))
    return out


# --- Dispatcher, unified image proxy, and Setup Test button ---


def _dispatch_album(src, use_cache=True):
    kind = (src.get("kind") or "iCloud shared album").strip()
    if kind == "Immich":
        return immich_album_photos(src, use_cache=use_cache)
    if kind == "Local folder":
        return local_folder_photos(src, use_cache=use_cache)
    if kind == "Nextcloud / ownCloud":
        return nextcloud_album_photos(src, use_cache=use_cache)
    if kind == "Plex":
        return plex_album_photos(src, use_cache=use_cache)
    if kind == "Jellyfin":
        return jellyfin_album_photos(src, use_cache=use_cache)
    if kind == "PhotoPrism":
        return photoprism_album_photos(src, use_cache=use_cache)
    return icloud_album_photos(src, use_cache=use_cache)


def album_photos(sid=""):
    A = sources_load().get("albums") or []
    src = next((a for a in A if a.get("id") == sid), A[0] if A else None)
    if not src:
        return {"photos": [], "error": "no album set up"}
    return _dispatch_album(src, use_cache=True)


def album_image(sid, fid):
    """Serve one allowlisted photo for /photos/item/<sid>/<fid>. Secrets stay on this server."""
    src = next((a for a in (sources_load().get("albums") or []) if a.get("id") == sid), None)
    if not src:
        return None
    cache = PHOTO_CACHES.get("src:" + sid) or {}
    item = (cache.get("items") or {}).get(fid)
    if not item:
        # Cache may be cold after a server restart: refresh once and re-check the allowlist
        _dispatch_album(src, use_cache=True)
        cache = PHOTO_CACHES.get("src:" + sid) or {}
        item = (cache.get("items") or {}).get(fid)
    if not item:
        return None
    kind = item.get("kind")
    try:
        if kind == "local":
            root = item["root"]
            target = Path(item["path"]).resolve()
            if not target.is_file() or not target.is_relative_to(root):
                return None
            if target.stat().st_size > MAX_IMAGE_BYTES:
                return None
            return target.read_bytes(), item.get("mime") or "image/jpeg", "public, max-age=3600"
        if kind == "nextcloud":
            _, token = parse_nextcloud_link(src.get("url") or "")
            if not token:
                return None
            got = _fetch_image_bytes(item["url"], {
                "Authorization": _nc_auth_header(token, src.get("password") or ""),
                "Accept": "image/*",
            })
            return (got[0], got[1], "public, max-age=86400") if got else None
        if kind == "plex":
            base = _http_base(src.get("server") or "")
            headers = {"X-Plex-Token": (src.get("apiKey") or "").strip(), "Accept": "image/*"}
            transcode = "%s/photo/:/transcode?width=1920&height=1080&minSize=1&upscale=0&url=%s" % (
                base, quote(item["path"], safe=""))
            try:
                got = _fetch_image_bytes(transcode, headers)
            except Exception:
                got = None
            if not got and item.get("fallback"):
                got = _fetch_image_bytes(base + item["fallback"], headers)
            return (got[0], got[1], "public, max-age=86400") if got else None
        if kind == "jellyfin":
            base = _http_base(src.get("server") or "")
            headers = _jellyfin_headers((src.get("apiKey") or "").strip())
            headers["Accept"] = "image/*"
            url = "%s/Items/%s/Images/Primary?maxWidth=1920&maxHeight=1080&quality=90" % (
                base, quote(item["item_id"], safe=""))
            got = _fetch_image_bytes(url, headers)
            return (got[0], got[1], "public, max-age=86400") if got else None
        if kind == "photoprism":
            base = _http_base(src.get("server") or "")
            headers = _photoprism_headers((src.get("apiKey") or "").strip())
            headers["Accept"] = "image/*"
            url = "%s/api/v1/t/%s/%s/fit_1920" % (
                base, quote(item["hash"], safe=""), quote(item.get("preview") or "public", safe=""))
            got = _fetch_image_bytes(url, headers)
            return (got[0], got[1], "public, max-age=86400") if got else None
    except Exception:
        return None
    return None


def album_test(item):
    """Setup's Test button for a photo album: checks the typed fields (using saved secrets when left blank)."""
    saved = next((x for x in sources_load().get("albums") or [] if x.get("id") == item.get("id")), {}) if item.get("id") else {}
    src = {
        "id": "test",
        "name": (item.get("name") or saved.get("name") or "").strip(),
        "kind": (item.get("kind") or saved.get("kind") or "iCloud shared album").strip(),
        "url": (item.get("url") or saved.get("url") or "").strip(),
        "path": (item.get("path") or saved.get("path") or "").strip(),
        "subdirs": bool(item["subdirs"]) if "subdirs" in item else bool(saved.get("subdirs")),
        "server": (item.get("server") or saved.get("server") or "").strip(),
        "apiKey": (item.get("apiKey") or saved.get("apiKey") or "").strip(),
        "password": (item.get("password") or saved.get("password") or "").strip(),
        "album": (item.get("album") or saved.get("album") or "").strip(),
    }
    res = _dispatch_album(src, use_cache=False)
    photos = res.get("photos") or []
    if res.get("error"):
        return {"ok": False, "error": res["error"]}
    if not photos:
        return {"ok": False, "error": "Connected, but no photos were found in that album."}
    alb = (res.get("album") or "").strip()
    n = len(photos)
    detail = ("%s · " % alb if alb else "") + "%d photo%s found" % (n, "" if n == 1 else "s")
    return {"ok": True, "count": n, "detail": detail}


# names used only inside functions: imported last, so these modules can use each other
from server.core import _get_json  # noqa: E402
from server.sources import sources_load  # noqa: E402
