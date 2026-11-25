"""Screen snapshot: what the dashboard's own browser measured, for bug reports.

Controls asks (POST /snapshot/request); the dashboard screen, which polls /snapshot/want, measures itself and posts the
result to /snapshot. Only measurements are kept: sizes, positions, font sizes and text lengths. Text from the screen
(event titles, list items, notes) is never in it. It lives in memory only, and goes out only if the person downloads the
diagnostics file or presses the bug report button and submits the form.
"""
import json
import threading
import time

SNAP = {"want": 0, "data": None, "at": 0.0}
SNAP_LOCK = threading.Lock()
WANT_FOR = 60          # seconds a request stays open for a screen to pick it up
MAX_BYTES = 200_000


def request_capture(now=None):
    now = time.time() if now is None else now
    with SNAP_LOCK:
        SNAP["want"] = int(now * 1000)
        return {"id": SNAP["want"]}


def wanted(now=None):
    now = time.time() if now is None else now
    with SNAP_LOCK:
        w = SNAP["want"]
    return {"id": w if w and now * 1000 - w < WANT_FOR * 1000 else 0}


def _clean(v, R, depth=0):
    if depth > 8:
        return None
    if isinstance(v, dict):
        return {str(k)[:60]: _clean(x, R, depth + 1) for k, x in list(v.items())[:200]}
    if isinstance(v, list):
        return [_clean(x, R, depth + 1) for x in v[:600]]
    if isinstance(v, str):
        return R(v[:300])
    return v if isinstance(v, (int, float, bool)) or v is None else None


def store(body, now=None):
    now = time.time() if now is None else now
    if not isinstance(body, dict) or not isinstance(body.get("data"), dict):
        raise ValueError("bad snapshot")
    if len(json.dumps(body)) > MAX_BYTES:
        raise ValueError("snapshot too big")
    from server.status import redact, _secrets
    sec = _secrets()
    data = _clean(body["data"], lambda t: redact(t, sec))
    with SNAP_LOCK:
        SNAP.update(data=data, at=now)
    return {"ok": True}


def current(now=None):
    now = time.time() if now is None else now
    with SNAP_LOCK:
        return SNAP["data"], SNAP["at"], SNAP["want"], now


def view(now=None):
    data, at, want, now = current(now)
    out = {"at": at, "ago": int(now - at) if at else None, "fresh": bool(at and want and at * 1000 >= want), "data": data}
    out["summary"] = summary(data, out["ago"]) if data else ""
    return out


def summary(d, ago=None):
    """A short plain-text version for the bug form: small enough for a link, and nothing the person can't read first."""
    from server.core import SCREEN, VERSION
    from server.status import _where
    env = d.get("env") or {}
    L = ["Countertop v%s on %s" % (VERSION, _where()),
         "Browser: %s" % env.get("ua", "?"),
         "Screen %s, window %s at %sx, %s%s" % (env.get("screen", "?"), env.get("win", "?"), env.get("dpr", "?"), env.get("orientation", "?"),
                                            ", full screen" if env.get("fullscreen") else ""),
         "Page: %s. Look: %s" % (d.get("page", "?"), json.dumps(d.get("look") or {}, separators=(",", ":")))]
    ov = d.get("overlaps") or []
    cl = d.get("clipped") or []
    L.append("Text overlapping: %s" % ("none found" if not ov else "; ".join("%s: %s over %s (%s px)" % (o.get("tile"), o.get("a"), o.get("b"), o.get("by")) for o in ov[:5])
                                      + (" (+%d more)" % (len(ov) - 5) if len(ov) > 5 else "")))
    L.append("Text clipped or off screen: %s" % ("none found" if not cl else "; ".join("%s: %s" % (o.get("tile"), o.get("el")) for o in cl[:5])
                                                 + (" (+%d more)" % (len(cl) - 5) if len(cl) > 5 else "")))
    errs = [e["error"] for e in list(SCREEN["errors"])[-3:]]
    L.append("Page errors: %s" % ("none" if not errs else " | ".join(e[:120] for e in errs)))
    if ago is not None:
        L.append("Measured %s ago" % ("%d s" % ago if ago < 90 else "%d min" % (ago // 60)))
    return "\n".join(L)[:1800]
