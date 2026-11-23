"""Upgrading settings files saved by older versions (CONFIG_UPGRADES)."""


# ---------- v3: every tile is an instance of a tile type (tools/tiles/*.js) placed in a grid box ----------
# Older settings files had one fixed module per tile, a classic column layout and bundle tiles (big tile,
# little thing). They are converted once, on load (CONFIG_UPGRADES); the old file is copied to work/backups first.
MAIN_CLASSIC = {"clock": [0, 0, 14, 8], "weather": [37, 0, 11, 8], "week": [0, 8, 48, 5], "stage": [0, 13, 27, 19],
                "grocery": [27, 13, 11, 12], "dinner": [38, 13, 10, 12], "city": [27, 25, 11, 7], "fun": [38, 25, 10, 7]}
OLD_ON = {"photos": False, "today": False, "sales": False, "hourly": False}


def migrate_v3(old):
    if "tiles" in old:
        return old
    fresh = not old
    st = lambda k: (old.get(k) or {}).get("settings") or {}
    on = lambda k: (old.get(k) or {}).get("on", OLD_ON.get(k, True))
    pick = lambda d, keys: {k: d[k] for k in keys if k in d}
    tiles, expand, every = [], {}, {}

    def add(iid, typ, settings=None, name=None):
        t = {"id": iid, "type": typ, "settings": settings or {}}
        if name:
            t["name"] = name
        tiles.append(t)
        return iid
    src = sources_load()
    first = lambda kind: ((src.get(kind) or [{}])[0] or {}).get("id", "")
    if on("clock"):
        expand["clock"] = [add("clock", "clock", pick(st("clock"), ["style", "font", "size", "align", "color", "ampm", "date", "seconds", "greeting", "countdowns", "extra"]))]
    if on("weather"):
        expand["weather"] = [add("weather", "weather", pick(st("weather"), ["style", "font", "size", "align", "icon", "cond", "hilo", "air", "sun", "rain"]))]
    if on("week"):
        expand["week"] = [add("week", "week", pick(st("week"), ["days", "perDay"]))]
    if on("hourly"):
        expand["hourly"] = [add("hourly", "hourly", pick(st("hourly"), ["hours"]))]
    if on("photos"):
        expand["photos"] = [add("photos", "photos", dict(pick(st("photos"), ["every", "shuffle", "captions"]), album=first("albums")))]
    if on("today"):
        expand["today"] = [add("today", "agenda", pick(st("today"), ["count"]))]
    if on("city") and not fresh and src.get("teams"):
        s = st("city")
        expand["city"] = [add("city", "team", dict(pick(s, ["count", "within", "always"]), team=first("teams")))]
    if on("grocery"):
        s = st("grocery")
        expand["grocery"] = [add("grocery", "list", {"list": first("lists"), "max": s.get("max", 20), "saleTag": s.get("saleTag", True),
                                                     "deals": s.get("sales", True) and not fresh})]
    if on("sales"):
        expand["sales"] = [add("sales", "sales", pick(st("sales"), ["count"]))]
    if on("dinner"):
        s = st("dinner")
        expand["dinner"] = [add("dinner", "dinner", pick(s, ["every", "season"]))]
        if s.get("sales", True) and not fresh:
            expand["dinner"].append(add("dsales", "sales", {"count": 5, "skipListed": True}, "More on sale"))
            every["dinner"] = s.get("saleEvery", 45)
    if on("stage"):
        s, L = st("stage"), []
        radar = s.get("radar", "when rain is near")
        if radar != "off":
            L.append(add("radar", "radar", {"zoom": s.get("radarZoom", "region"), "hours": s.get("radarHours", 2), "chance": s.get("radarChance", 40),
                                            "onlyRain": radar == "when rain is near", "takeover": radar == "when rain is near"}))
        if s.get("glance", True):
            L.append(add("hours", "nexthours", {"hours": s.get("glanceHours", 18)}))
        for k, typ in (("space", "space"), ("iss", "iss")):     # the old window scene tile is retired
            if s.get(k):
                L.append(add(k, typ))
        if s.get("cams", True) and not fresh:
            L.append(add("cams", "cam", {}))
        expand["stage"] = L or [add("hours", "nexthours")]
        every["stage"] = s.get("every", 75)
    if on("fun"):
        s, L = st("fun"), []
        for k, typ in (("onthisday", "onthisday"), ("jokes", "joke"), ("facts", "tip")):
            if s.get(k, True):
                L.append(add(typ, typ))
        expand["fun"] = L or [add("onthisday", "onthisday")]
        every["fun"] = s.get("every", 90)
    if fresh and on("city"):
        expand["city"] = [add("today", "agenda", {"count": 4})]
    for it in st("mytiles").get("items") or []:
        iid = "u_" + str(it.get("id"))
        add(iid, "custom", pick(it, ["html", "every", "taps", "card", "title"]), it.get("name") or "My tile")
        if it.get("on"):
            expand[iid] = [iid]

    def box(sl):
        mods = []
        for m in [sl.get("mod")] + list(sl.get("more") or []):
            mods += expand.get(m, [m] if any(t["id"] == m for t in tiles) else [])
        out = {k: v for k, v in sl.items() if k not in ("mod", "more", "mode")}
        out["mod"] = mods[0] if mods else None
        if len(mods) > 1:
            out["more"] = mods[1:]
            src_mod = next((m for m in [sl.get("mod")] + list(sl.get("more") or []) if m in every), None)
            if src_mod and not out.get("every"):
                out["every"] = every[src_mod]
        return out
    pages = [dict(p, slots=[box(x) for x in p.get("slots") or []]) for p in (st("pages").get("items") or [])]
    if not any(p.get("id") == "main" for p in pages):
        slots = []
        for m, r in MAIN_CLASSIC.items():
            if m in expand:
                slots.append(box({"id": "m_" + m, "x": r[0], "y": r[1], "w": r[2], "h": r[3], "mod": m}))
        extra = [m for m in ("photos", "today", "sales", "hourly") if m in expand and m not in MAIN_CLASSIC]
        pages.insert(0, {"id": "main", "name": "Main", "on": True, "cols": 48, "slots": slots})
        if extra:
            pages.append({"id": "more", "name": "More", "on": True, "back": 0, "cols": 48,
                          "slots": [box({"id": "x_" + m, "x": (i % 3) * 16, "y": (i // 3) * 16, "w": 16, "h": 16, "mod": m}) for i, m in enumerate(extra[:6])]})
    if (old.get("month") or {}).get("on", True) and not fresh:      # new installs add a Month page from Add page → Full-screen
        add("month", "month")
        pages.append({"id": "month", "name": "Month", "on": True, "back": st("month").get("back", 60), "cols": 48,
                      "slots": [{"id": "mo1", "x": 0, "y": 0, "w": 48, "h": 32, "mod": "month"}]})
    if (old.get("salepage") or {}).get("on", True) and not fresh:
        add("dealcards", "sales", {"layout": "Cards", "count": 12}, "On sale this week")
        pages.append({"id": "deals", "name": "Deals", "on": True, "back": st("salepage").get("back", 90), "cols": 48,
                      "slots": [{"id": "dc1", "x": 0, "y": 0, "w": 48, "h": 32, "mod": "dealcards"}]})
    used = {m for p in pages for sl in p["slots"] for m in [sl.get("mod")] + list(sl.get("more") or [])}
    tiles = [t for t in tiles if t["id"] in used]
    new = {k: old[k] for k in ("general", "effects", "look", "night") if k in old}
    if "sales" in old:
        new["deals"] = {"on": True, "settings": pick(st("sales"), ["zip", "stores", "watch", "recentDays", "always"])}
    new["pages"] = {"on": True, "settings": {"items": pages}}
    new["tiles"] = {"on": True, "settings": {"items": tiles}}
    return new


# Looks rebuild (2026-11-19): themes became looks plus schedule rules, date and emoji preferences moved to
# Location & units, effects became a list of separate effects, and the night clock became a page you can edit.
FX_GROUPS = {"weather": ["rain", "snow", "fog", "clouds", "sun", "stars"],
             "seasonal": ["leaves", "halloween", "thanks", "xmas", "winter", "newyear", "valentine", "spring", "july4", "summer"],
             "shows": ["gust", "bats", "turkey", "santa", "flurry", "fireworks", "heartburst", "butterflies"]}
PREF_KEYS = ["dateFmt", "weekStart", "h24", "emoji", "swap"]


def migrate_looks(m):
    changed = False
    look = (m.get("look") or {}).get("settings")
    if isinstance(look, dict):
        g = m.setdefault("general", {"on": True, "settings": {}}).setdefault("settings", {})
        for k in PREF_KEYS:
            if k in look:
                g.setdefault(k, look.pop(k))
                changed = True
        items = look.get("items") or []
        if "rules" not in look:
            rules = []
            for t in items:
                if not isinstance(t, dict):
                    continue
                if "when" in t:
                    rules.append({"id": "r" + str(t.get("id", "")), "on": t.get("on", True) is not False, "look": t.get("id"), "when": t.get("when") or {}})
                for k in PREF_KEYS:
                    (t.get("values") or {}).pop(k, None)
                for k in ("when", "on"):
                    t.pop(k, None)
            look["rules"] = rules
            changed = True
    fx = (m.get("effects") or {}).get("settings")
    if isinstance(fx, dict) and "items" not in fx and any(k in fx for k in ("weather", "seasonal", "shows", "density", "sky")):
        dens = fx.get("density", 100)
        amount = "Few" if dens < 70 else "Lots" if dens > 140 else "Some"
        out = []
        for grp, ids in FX_GROUPS.items():
            for i in ids:
                e = {"id": i}
                if fx.get(grp) is False:
                    e["on"] = False
                if amount != "Some" and grp != "shows":
                    e["amount"] = amount
                if grp == "shows" and fx.get("showEvery") not in (None, 8):
                    e["every"] = max(5, int(fx.get("showEvery") or 15))
                if len(e) > 1:
                    out.append(e)
        if fx.get("sky") is False and isinstance(look, dict) and look.get("bg", "Sky") == "Sky":
            look["bg"] = "Color"
        m["effects"]["settings"] = {"front": True, "items": out}
        changed = True
    night = m.get("night")
    if isinstance(night, dict) and isinstance(night.get("settings"), dict) and "dim" not in night["settings"]:
        if night.get("on") is False:          # it was off: start from sensible hours if it's ever turned on
            night["settings"].update({"start": 22, "end": 7})
        night["settings"]["dim"] = 45
        changed = True
    pages = ((m.get("pages") or {}).get("settings") or {}).get("items")
    if isinstance(pages, list) and pages and not any(isinstance(p, dict) and p.get("id") == "night" for p in pages):
        pages.append({"id": "night", "name": "Night", "on": True, "cols": 48, "slots": [{"id": "n1", "x": 0, "y": 0, "w": 48, "h": 32, "mod": "nightclock"}]})
        tl = m.setdefault("tiles", {"on": True, "settings": {"items": []}}).setdefault("settings", {}).setdefault("items", [])
        if not any(isinstance(t, dict) and t.get("id") == "nightclock" for t in tl):
            tl.append({"id": "nightclock", "type": "nightclock", "settings": {}})
        changed = True
    return changed


def _upgrade_v3(m):
    return (m, False) if "tiles" in m else (migrate_v3(m), True)


def _upgrade_looks(m):
    return m, migrate_looks(m)


# Network limit (schema 3): Your own tile code may only reach public HTTPS addresses from now on. Every Your own
# tile already saved keeps the access it had (plain HTTP and the home network), marked "lan": true, with a warning
# in its settings and in Status. config_load records these marks next to the settings, where an import can't add one.
def mark_lan_tiles(m):
    items = ((m.get("tiles") or {}).get("settings") or {}).get("items")
    changed = False
    for t in items if isinstance(items, list) else []:
        if isinstance(t, dict) and t.get("type") == "custom" and not t.get("review") and t.get("lan") is not True:
            t["lan"] = True
            changed = True
    return changed


def _upgrade_lan(m):
    return m, mark_lan_tiles(m)


CONFIG_UPGRADES = [(1, _upgrade_v3), (2, _upgrade_looks), (3, _upgrade_lan)]


# names used only inside functions: imported last, so these modules can use each other
from server.sources import sources_load  # noqa: E402
