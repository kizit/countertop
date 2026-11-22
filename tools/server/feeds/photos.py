"""Shared photo albums."""
import json
import re
import socket
import time
from urllib.request import Request, urlopen


# --- photos: iCloud Shared Album ("Public Website" on), cached 30 minutes ---
PHOTO_CACHES = {}          # album link -> {at, key, data}
B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"


# --- photos: an album on a self-hosted Immich server, cached 30 minutes ---
# The screen only ever gets /photos/immich/<sid>/<asset>.jpg links, which this server fills in:
# the API key never leaves this server, and only assets that are in the album are served.


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


def immich_album_photos(src):
    base = (src.get("server") or "").strip()
    key = src.get("apiKey") or ""
    want = (src.get("album") or "").strip()
    if not base or not key:
        return {"photos": [], "album": want, "error": "give Immich's address and an API key in Setup"}
    ck = base + "|" + key + "|" + want.lower()
    cache = PHOTO_CACHES.setdefault("immich:" + src["id"], {"at": 0, "key": ck, "data": None, "assets": set()})
    if cache["data"] is not None and cache["key"] == ck and time.time() - cache["at"] < 1800:
        return cache["data"]
    out = {"photos": [], "error": None, "album": want}
    try:
        albums = _immich_json(base, key, "/api/albums")
        alb = next((a for a in albums if (a.get("albumName") or "").strip().lower() == want.lower()), None)
        if alb is None:
            raise ValueError("no album named “%s” on that Immich" % want if want else "name the album in Setup")
        assets = _immich_album_assets(base, key, alb["id"]) or []
        sid = src["id"]
        for a in assets:
            if (a.get("type") or "").upper() != "IMAGE":
                continue
            ex = a.get("exifInfo") or {}
            out["photos"].append({"url": "/photos/immich/%s/%s.jpg" % (sid, a["id"]),
                                  "caption": ex.get("description") or "",
                                  "date": ex.get("dateTimeOriginal") or "",
                                  "w": int(ex.get("exifImageWidth") or 0),
                                  "h": int(ex.get("exifImageHeight") or 0)})
        cache.update(at=time.time(), key=ck, data=out,
                     assets={a["id"] for a in assets if (a.get("type") or "").upper() == "IMAGE"})     # only what the screen is shown
    except Exception as e:
        if cache["key"] == ck and cache["data"] is not None:
            out = dict(cache["data"], error=str(getattr(e, "reason", e))[:200])       # keep showing what we had
        else:
            out = {"photos": [], "album": want, "error": str(getattr(e, "reason", e))[:200]}
        cache.update(at=time.time(), data=out)
    return out


WRONG_LINK = ("That isn't a shared album link. In Photos, open the shared album, tap the people icon, turn on Public Website "
              "and copy the link. A shared Photo Library has no public link, so it can't be shown.")


def album_token(link):
    """The token in an iCloud shared album link (icloud.com/sharedalbum/#TOKEN, or the bare token), else None."""
    link = (link or "").strip()
    token = link.split("#")[-1].split(";")[0].strip("/ ") if "#" in link else link
    if "/" in link and "#" not in link:
        return None                                  # a link of another kind, e.g. share.icloud.com/photos/...
    if "#" in link and "icloud.com" not in link.split("#")[0]:
        return None
    return token if re.fullmatch(r"[0-9A-Za-z]{8,40}", token) and token[0] in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" else None


def album_error(e):
    """A plain-words reason for a failed album fetch (the technical text goes to the log)."""
    reason = getattr(e, "reason", e)
    code = getattr(e, "code", None)
    if isinstance(e, ValueError) and str(e) == WRONG_LINK:
        return WRONG_LINK
    if code in (401, 403, 404):
        return "Apple says no album is there. Check that Public Website is still on for the shared album."
    if isinstance(reason, socket.gaierror) or "Name or service not known" in str(reason) or "getaddrinfo" in str(reason):
        return ("This computer couldn't look up Apple's photo server. Check that it is online and that the album link is a "
                "shared album's Public Website link. In Docker, check the container's DNS setting.")
    if isinstance(reason, (socket.timeout, TimeoutError)) or "timed out" in str(reason):
        return "Apple's photo server didn't answer in time. It will try again shortly."
    return str(reason)[:200]


def album_photos(sid=""):
    A = sources_load().get("albums") or []
    src = next((a for a in A if a.get("id") == sid), A[0] if A else None)
    if not src:
        return {"photos": [], "error": "no album set up"}
    if (src.get("kind") or "iCloud shared album") == "Immich":
        return immich_album_photos(src)
    link = ((src or {}).get("url") or "").strip()
    if not link:
        return {"photos": [], "error": "no album set up"}
    PHOTO_CACHE = PHOTO_CACHES.setdefault(link, {"at": 0, "key": link, "data": None})
    if PHOTO_CACHE["data"] is not None and time.time() - PHOTO_CACHE["at"] < 1800:
        return PHOTO_CACHE["data"]
    out = {"photos": [], "error": None, "album": ""}
    try:
        token = album_token(link)
        if not token:
            raise ValueError(WRONG_LINK)
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
        out["album"] = stream.get("streamName", "")
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
    except Exception as e:
        print("shared album %s: %s" % (src.get("name") or "", e), flush=True)
        out["error"] = album_error(e)
    PHOTO_CACHE.update(at=time.time(), key=link, data=out)
    return out


# names used only inside functions: imported last, so these modules can use each other
from server.core import _get_json  # noqa: E402
from server.sources import sources_load  # noqa: E402
