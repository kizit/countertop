"""A test page for the Echo (/bench): how many sandboxed frames a page can hold, which ways out of a frame Silk blocks,
and whether an endless loop in one frame freezes the whole page. It measures only, and saves only numbers and yes/no
answers (bench.json in the data folder). Nothing links to it and it never contacts anything outside this computer."""
import collections
import json
import secrets
import threading
import time

from server.core import HERE, WORK

BENCH_FILE = WORK / "bench.json"
BENCH_DIR = HERE / "bench"
LOCK = threading.Lock()
HITS = collections.deque(maxlen=2000)         # every /bench/hit: {"t", "via", "run", "ip"}
KINDS = ("perf", "escape")

FRAME_POLICY = ("sandbox allow-scripts; default-src 'none'; script-src 'nonce-%s'; style-src 'unsafe-inline'; "
                "img-src data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'")


def frame_page():
    """(html, headers) for one sandboxed frame. The nonce is new on every request."""
    nonce = secrets.token_hex(16)
    html = (BENCH_DIR / "frame.html").read_text(encoding="utf-8").replace("__NONCE__", nonce)
    return html.encode("utf-8"), {"Content-Security-Policy": FRAME_POLICY % nonce}


def index_page():
    return (BENCH_DIR / "index.html").read_bytes()


def hit(via, run, ip):
    HITS.append({"t": time.time(), "via": str(via)[:30], "run": str(run)[:40], "ip": ip})


def _clean(v, depth=0):
    """Numbers, yes/no answers and short text only, so nothing else can be stored through this page."""
    if isinstance(v, bool) or v is None:
        return v
    if isinstance(v, (int, float)):
        return round(v, 3) if isinstance(v, float) and v == v and abs(v) < 1e12 else (v if isinstance(v, int) else None)
    if isinstance(v, str):
        return v[:160]
    if depth < 3 and isinstance(v, dict):
        return {str(k)[:40]: _clean(x, depth + 1) for k, x in list(v.items())[:40]}
    if depth < 3 and isinstance(v, list):
        return [_clean(x, depth + 1) for x in v[:20]]
    return None


def _load():
    try:
        data = json.loads(BENCH_FILE.read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save(body):
    """Store one measurement: {"kind": "perf", "frames": 6, ...} or {"kind": "escape", ...}."""
    kind = body.get("kind") if isinstance(body, dict) else None
    if kind not in KINDS:
        raise ValueError("unknown kind")
    entry = _clean({k: v for k, v in body.items() if k != "kind"})
    entry["at"] = int(time.time())
    with LOCK:
        data = _load()
        if kind == "perf":
            frames = body.get("frames")
            if not isinstance(frames, int) or not 0 < frames <= 40:
                raise ValueError("frames must be a number from 1 to 40")
            data.setdefault("perf", {})[str(frames)] = entry
        else:
            data["escape"] = entry
        WORK.mkdir(parents=True, exist_ok=True)
        tmp = BENCH_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=1))
        tmp.replace(BENCH_FILE)
    return results()


def _loops(now):
    """Each loop test seen in the hits: did the page's once-a-second beats stop after the loop began?"""
    out = {}
    for h in list(HITS):
        if h["via"] in ("loopstart", "beat", "stall"):
            out.setdefault(h["run"], []).append(h)
    res = []
    for run, hs in out.items():
        start = next((h["t"] for h in hs if h["via"] == "loopstart"), None)
        if start is None:
            continue
        beats = sorted(h["t"] for h in hs if h["via"] == "beat" and h["t"] >= start)
        marks = [start] + beats
        gaps = [b - a for a, b in zip(marks, marks[1:])]
        since = now - marks[-1]
        longest = max(gaps + [since])
        res.append({"run": run, "started": int(start), "beatsAfter": len(beats), "longestSilence": round(longest, 1),
                    "stillSilent": since > 5, "heartbeatsStopped": longest > 3,
                    "stalls": len([h for h in hs if h["via"] == "stall"])})
    return sorted(res, key=lambda r: r["started"])


def results():
    now = time.time()
    counts = collections.Counter(h["via"] for h in HITS if h["via"] not in ("beat", "loopstart", "stall"))
    return {"stored": _load(), "loops": _loops(now), "hits": [dict(h, ago=round(now - h["t"], 1)) for h in list(HITS)[-200:]
            if h["via"] not in ("beat",)], "counts": dict(counts)}


def summary():
    """For Controls > Status: None until the test page has saved something, so most people never see it."""
    data = _load()
    loops = _loops(time.time())
    if not data and not loops:
        return None
    esc = data.get("escape") or {}
    return {"perf": {k: {"fps": v.get("fps"), "longTasks": v.get("longTasks"), "tapMs": v.get("tapMedianMs")}
                     for k, v in sorted((data.get("perf") or {}).items(), key=lambda kv: int(kv[0]))},
            "escape": {"passed": esc.get("passed"), "total": esc.get("total")} if esc else None,
            "loop": loops[-1] if loops else None}
