"""Wallpapers: pictures people upload for a theme's background.

They live in the data folder (wallpapers/w-<12 hex>.<ext>) and never leave it: a theme only names the id, and shared themes
drop it (tools/shared/themes.js, THEMELIB.portable). Only PNG, JPEG and WebP are accepted, checked by their first bytes, up to
MAX_BYTES each. Nothing else (SVG included, which can carry script) is stored or served.
"""
import base64
import binascii
import hashlib
import re
import threading

from server.core import WORK

WALL_DIR = WORK / "wallpapers"
MAX_BYTES = 8_000_000
MAX_FILES = 12
ID_RE = re.compile(r"w-[0-9a-f]{12}")
TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
LOCK = threading.Lock()


class WallpaperError(ValueError):
    pass


def sniff(data):
    """The image type from the first bytes, or None."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _find(wid):
    if not ID_RE.fullmatch(wid or ""):
        return None
    return next(iter(sorted(WALL_DIR.glob(wid + ".*"))), None) if WALL_DIR.is_dir() else None


def save(raw):
    """raw: a data: URL or plain base64 of the picture. Returns {"id": ...}."""
    if not isinstance(raw, str) or not raw:
        raise WallpaperError("no picture was sent")
    b64 = raw.split(",", 1)[1] if raw.startswith("data:") and "," in raw else raw
    if len(b64) > MAX_BYTES * 4 // 3 + 16:
        raise WallpaperError("That picture is too big (the limit is %d MB)." % (MAX_BYTES // 1_000_000))
    try:
        data = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError):
        raise WallpaperError("That isn't a picture.")
    if len(data) > MAX_BYTES:
        raise WallpaperError("That picture is too big (the limit is %d MB)." % (MAX_BYTES // 1_000_000))
    kind = sniff(data)
    if not kind:
        raise WallpaperError("Wallpapers must be PNG, JPEG or WebP pictures.")
    wid = "w-" + hashlib.sha256(data).hexdigest()[:12]
    with LOCK:
        if not _find(wid):
            WALL_DIR.mkdir(parents=True, exist_ok=True)
            if len(list(WALL_DIR.glob("w-*"))) >= MAX_FILES:
                raise WallpaperError("Too many wallpapers: delete one you don't use first.")
            tmp = WALL_DIR / (wid + ".tmp")
            tmp.write_bytes(data)
            tmp.replace(WALL_DIR / (wid + "." + TYPES[kind]))
    return {"id": wid}


def read(wid):
    """(bytes, content type) or None."""
    f = _find(wid)
    if not f:
        return None
    data = f.read_bytes()
    return (data, sniff(data) or "application/octet-stream") if sniff(data) else None


def delete(wid):
    with LOCK:
        f = _find(wid)
        if f:
            f.unlink()
        return bool(f)
