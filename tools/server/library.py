"""Library: previewing and trying a layout without saving it."""
import json
import threading
import time
import uuid


# ---------- Library: preview a layout without saving it ----------
# Controls sends a page list, tiles and look; the dashboard asks for /config?trial=<id> to draw them (the live
# preview on a layout's page), or gets them from plain /config for a few minutes ("Try it on the screen").
# Nothing here is written to disk, and everything else (sources, settings, the night page's hours) stays as saved.
TRIALS = {}
TRIAL_SCREEN = {"id": "", "until": 0.0}
TRIAL_LOCK = threading.Lock()


def trial_add(body):
    if not isinstance(body, dict):
        raise ValueError("expected a layout")
    pages, tiles, look = body.get("pages"), body.get("tiles"), body.get("look")
    if not isinstance(pages, list) or not isinstance(tiles, list) or not isinstance(look or {}, dict):
        raise ValueError("expected pages, tiles and look")
    if not any(isinstance(x, dict) and x.get("id") == "main" for x in pages):
        raise ValueError("the layout has no main page")
    if len(json.dumps(body)) > 2_000_000:
        raise ValueError("that layout is too big")
    lan_check(tiles, lan_ledger())           # a layout being tried only keeps home-network access its tiles were granted
    tid = uuid.uuid4().hex[:12]
    with TRIAL_LOCK:
        TRIALS[tid] = {"pages": pages, "tiles": tiles, "look": look or {}, "name": str(body.get("name") or "Layout")[:80], "at": time.time()}
        for old in sorted(TRIALS, key=lambda k: TRIALS[k]["at"])[:-12]:
            if old != TRIAL_SCREEN["id"]:
                del TRIALS[old]
        out = {"id": tid}
        if body.get("screen"):
            try:
                secs = int(body.get("seconds") or 120)
            except (TypeError, ValueError):
                secs = 120
            TRIAL_SCREEN.update(id=tid, until=time.time() + max(10, min(600, secs)))
            out["until"] = int(TRIAL_SCREEN["until"])
    return out


def trial_screen():
    with TRIAL_LOCK:
        tid = TRIAL_SCREEN["id"]
        if not tid or time.time() >= TRIAL_SCREEN["until"] or tid not in TRIALS:
            return None
        return {"id": tid, "name": TRIALS[tid]["name"], "until": TRIAL_SCREEN["until"]}


def trial_stop():
    with TRIAL_LOCK:
        TRIAL_SCREEN.update(id="", until=0.0)


def trial_version():
    live = trial_screen()
    return int(live["id"][:6], 16) % 100000 + 1 if live else 0


def trial_apply(cfg, tid):
    with TRIAL_LOCK:
        t = TRIALS.get(tid)
    if not t:
        return cfg
    m = cfg["modules"]
    m["pages"]["settings"]["items"] = t["pages"]
    m["tiles"]["settings"]["items"] = t["tiles"]
    look = m["look"]["settings"]
    for k, v in t["look"].items():
        if k in look and k not in ("items", "rules"):
            look[k] = v
    return cfg


# names used only inside functions: imported last, so these modules can use each other
from server.config import lan_check, lan_ledger  # noqa: E402
