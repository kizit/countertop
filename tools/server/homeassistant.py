"""Home Assistant: reading states and calling services for the Home and Sensor tiles."""
import collections
import json
import re
import ssl
import threading
import time
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from server.actions import TILE_ACTIONS


# ---------- Home Assistant (Setup > Home Assistant; the Home and Sensor tiles) ----------
# The server talks to Home Assistant's REST API with the token from Setup; tiles only ever talk to this server.
# States are fetched on demand and kept for a few seconds, so several tiles share one request.
HA_CACHE = {}             # source id -> {at, states: {entity_id: compact state}, error}
HA_LOCKS = collections.defaultdict(threading.Lock)
HA_STATUS = {}            # source id -> {name, at, ok, error, count, version}
HA_TTL = 4
# What the dashboard may do to an entity, per domain. The service called is /api/services/<domain>/<action>.
# A plain tap (no action given) uses HA_DEFAULT.
HA_ACTIONS = {
    "light": {"toggle", "turn_on", "turn_off"},
    "switch": {"toggle", "turn_on", "turn_off"},
    "fan": {"toggle", "turn_on", "turn_off", "set_percentage"},
    "input_boolean": {"toggle", "turn_on", "turn_off"},
    "scene": {"turn_on"},
    "script": {"turn_on"},
    "climate": {"toggle", "turn_on", "turn_off", "set_temperature", "set_hvac_mode"},
    "water_heater": {"toggle", "turn_on", "turn_off", "set_temperature", "set_away_mode", "set_operation_mode"},
    "cover": {"toggle", "open_cover", "close_cover", "stop_cover", "set_cover_position"},
    "lock": {"lock", "unlock", "open"},
    "media_player": {"toggle", "media_play_pause", "media_play", "media_pause", "media_stop",
                     "media_next_track", "media_previous_track", "volume_set", "volume_up", "volume_down"},
    "vacuum": {"start", "pause", "stop", "return_to_base", "toggle"},
    "alarm_control_panel": {"disarm", "arm_home", "arm_away", "arm_night", "arm_vacation"},
    "number": {"set_value"},
    "input_number": {"set_value"},
    "select": {"select_option", "select_next", "select_previous"},
    "input_select": {"select_option", "select_next", "select_previous"},
    "text": {"set_value"},
    "input_text": {"set_value"},
    "button": {"press"},
    "input_button": {"press"},
}
# refresh any entity (a sensor's reading, a binary sensor's state) — harmless, so allowed for every domain
HA_REFRESH = "update_entity"
HA_DEFAULT = {"light": "toggle", "switch": "toggle", "fan": "toggle", "input_boolean": "toggle",
              "scene": "turn_on", "script": "turn_on", "climate": "toggle", "cover": "toggle",
              "vacuum": "toggle", "media_player": "media_play_pause", "water_heater": "toggle",
              "sensor": HA_REFRESH, "binary_sensor": HA_REFRESH, "device_tracker": HA_REFRESH, "person": HA_REFRESH,
              "button": "press", "input_button": "press"}
# keys allowed in the optional "data" payload forwarded to Home Assistant (scalars only, nothing else is sent)
HA_DATA_KEYS = {"temperature", "hvac_mode", "operation_mode", "away_mode", "brightness_pct", "brightness",
                "percentage", "position", "volume_level", "code", "value", "option"}


def ha_source(sid=""):
    L = [x for x in sources_load().get("homeassistant") or [] if x.get("url") and x.get("token")]
    return next((x for x in L if x.get("id") == sid), None) or (L[0] if L and not sid else None) or (L[0] if len(L) == 1 else None)


def _ha_url(src):
    u = (src.get("url") or "").strip().rstrip("/")
    if u and "://" not in u:
        u = "http://" + u
    return u


def _ha_error(e, src):
    """A plain-words reason, never the token (urllib errors don't carry request headers; the address is reduced to its host)."""
    host = urlparse(_ha_url(src)).hostname or "Home Assistant"
    code = getattr(e, "code", None)
    if code == 401:
        return "Home Assistant didn't accept the access token. Make a new one and paste it in Setup."
    if code == 404:
        return "%s answered, but it doesn't look like Home Assistant (check the address and port, usually 8123)." % host
    if code:
        return "Home Assistant answered with error %s." % code
    r = str(getattr(e, "reason", e))
    if isinstance(getattr(e, "reason", None), ssl.SSLError) or "CERTIFICATE" in r.upper():
        return "Couldn't check %s's certificate. Try its http:// address on your network instead." % host
    if "Name or service not known" in r or "nodename nor servname" in r or "getaddrinfo" in r or "No address associated" in r:
        return "Couldn't find %s. Use its IP address instead, e.g. http://192.168.1.20:8123%s." % (host, " (names ending in .local often don't work in Docker)" if host.endswith(".local") else "")
    if "refused" in r.lower():
        return "%s refused the connection. Is Home Assistant running, and is the port right (usually 8123)?" % host
    if "timed out" in r.lower():
        return "%s didn't answer in time." % host
    return ("Couldn't reach Home Assistant: " + r.replace(src.get("token") or "\0", "<token>"))[:200]


def ha_request(src, method, path, body=None, timeout=10):
    req = Request(_ha_url(src) + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                  headers={"Authorization": "Bearer " + (src.get("token") or "").strip(), "Content-Type": "application/json",
                           "User-Agent": "Countertop/" + VERSION})
    with urlopen(req, timeout=timeout) as r:
        raw = r.read(8_000_000)
    return json.loads(raw.decode("utf-8", "replace")) if raw else None


def _ha_compact(st):
    a = st.get("attributes") or {}
    eid = st.get("entity_id") or ""
    o = {"id": eid, "domain": eid.split(".")[0], "state": st.get("state"), "name": a.get("friendly_name") or eid,
         "unit": a.get("unit_of_measurement") or "", "dc": a.get("device_class") or "", "icon": a.get("icon") or "",
         "changed": st.get("last_changed") or ""}
    if eid.startswith("light."):
        if a.get("brightness") is not None:
            o["level"] = round(a["brightness"] / 255 * 100)
            o["min"], o["max"] = 1, 100                      # brightness_pct range
    if eid.startswith("fan.") and a.get("percentage") is not None:
        o["level"] = a["percentage"]
        o["min"], o["max"] = 0, 100
    if eid.startswith("climate."):
        o["current"] = a.get("current_temperature")
        o["target"] = a.get("temperature")
        o["modes"] = a.get("hvac_modes") or []
        o["min"] = a.get("min_temp")
        o["max"] = a.get("max_temp")
        o["action"] = a.get("hvac_action") or ""      # heating, idle, off... what the thermostat is doing right now
    if eid.startswith("water_heater."):
        o["current"] = a.get("current_temperature")
        o["target"] = a.get("temperature")
        o["modes"] = a.get("operation_list") or []
        o["min"] = a.get("min_temp")
        o["max"] = a.get("max_temp")
        o["away"] = bool(a.get("away_mode"))
    if eid.startswith("weather."):
        o["temp"] = a.get("temperature")
        o["unit"] = a.get("temperature_unit") or ""
    if eid.startswith("cover.") and a.get("current_position") is not None:
        o["level"] = a["current_position"]
        o["min"], o["max"] = 0, 100
    if eid.startswith("media_player."):
        if a.get("media_title"):
            o["media"] = " \u00b7 ".join(str(x) for x in (a.get("media_title"), a.get("media_artist")) if x)
        if a.get("volume_level") is not None:
            o["vol"] = round(a["volume_level"] * 100)
    if eid.startswith("alarm_control_panel."):
        o["feats"] = a.get("supported_features") or 0
    if eid.startswith(("number.", "input_number.")):
        o["min"] = a.get("min"); o["max"] = a.get("max"); o["step"] = a.get("step") or 1
    if eid.startswith(("select.", "input_select.")):
        o["options"] = a.get("options") or []
    return o


def ha_states(src, force=False):
    sid = src.get("id")
    with HA_LOCKS[sid]:
        c = HA_CACHE.get(sid)
        if c and not force and time.time() - c["at"] < HA_TTL:
            return c
        try:
            L = ha_request(src, "GET", "/api/states")
            c = {"at": time.time(), "states": {st["entity_id"]: _ha_compact(st) for st in L or [] if st.get("entity_id")}, "error": ""}
            HA_STATUS[sid] = dict(HA_STATUS.get(sid) or {}, name=src.get("name") or "Home Assistant", at=c["at"], ok=True, error="", count=len(c["states"]))
        except Exception as e:
            msg = _ha_error(e, src)
            old = HA_CACHE.get(sid) or {}
            c = {"at": time.time(), "states": old.get("states") or {}, "error": msg}       # keep showing the last states we had
            HA_STATUS[sid] = dict(HA_STATUS.get(sid) or {}, name=src.get("name") or "Home Assistant", ok=False, error=msg, tried=time.time())
        HA_CACHE[sid] = c
        return c


def ha_view(sid, ids):
    src = ha_source(sid)
    if not src:
        return {"error": "Set up Home Assistant in Controls \u2192 Setup first.", "states": []}
    c = ha_states(src)
    want = [x for x in ids if x]
    S = c["states"]
    return {"error": c["error"], "at": c["at"], "src": src.get("id"),
            "states": [S.get(x) or {"id": x, "domain": x.split(".")[0], "state": "missing", "name": x} for x in want]}


def ha_entities(sid):
    src = ha_source(sid)
    if not src:
        return {"error": "Set up Home Assistant in Controls \u2192 Setup first.", "entities": []}
    c = ha_states(src)
    L = sorted(c["states"].values(), key=lambda o: (o["domain"], o["name"].lower()))
    return {"error": c["error"], "entities": [{"id": o["id"], "name": o["name"], "domain": o["domain"], "state": o["state"], "unit": o["unit"]} for o in L]}


def ha_run(src, entity, action, data):
    """Call one Home Assistant service for one entity: the domain's allowlist (HA_ACTIONS) and the scalar-only data
    keys (HA_DATA_KEYS) apply. Whether this tile may do it at all is checked first, in the tile action."""
    if not re.fullmatch(r"[a-z_]+\.[a-z0-9_]+", entity):
        return 403, {"error": "Bad entity id"}
    dom = entity.split(".")[0]
    action = str(action or "").strip() or HA_DEFAULT.get(dom, "")
    if not re.fullmatch(r"[a-z_]+", action):
        return 403, {"error": "That action isn't allowed here"}
    if action == HA_REFRESH:
        allowed, svc_dom = {HA_REFRESH}, "homeassistant"     # refresh any entity's state
    else:
        allowed = HA_ACTIONS.get(dom)
        if not allowed:
            return 403, {"error": "That can't be controlled from the screen"}
        svc_dom = dom
    if action not in allowed:
        return 403, {"error": "That action isn't allowed here"}
    payload = {"entity_id": entity}
    if isinstance(data, dict):
        for k, v in data.items():
            if k in HA_DATA_KEYS and isinstance(v, (int, float, str, bool)):
                payload[k] = v
    try:
        ha_request(src, "POST", "/api/services/%s/%s" % (svc_dom, action), payload)
    except Exception as e:
        return 502, {"error": _ha_error(e, src)}
    log_entry({"t": time.strftime("%H:%M:%S"), "kind": "ha", "task": action, "result": entity,
               "data": {k: ("<set>" if k == "code" else payload[k]) for k in payload if k != "entity_id"}})
    c = ha_states(src, force=True)
    return 200, {"ok": True, "action": action, "state": c["states"].get(entity)}


# Locks, alarm panels and garage doors, gates and doors (covers) can let someone in. A tile controls them only when
# "Allow locks, garage doors and alarms" is on in its settings, and asks for a second tap unless it's set to one.
HA_SECURE_DOMAINS = {"lock", "alarm_control_panel"}
HA_SECURE_COVERS = {"garage", "gate", "door"}


def ha_secure(src, entity):
    dom = entity.split(".")[0]
    if dom in HA_SECURE_DOMAINS:
        return True
    if dom != "cover":
        return False
    st = (ha_states(src).get("states") or {}).get(entity) or {}
    return st.get("dc", "") in HA_SECURE_COVERS or not st      # a cover we can't see yet counts as secure


def ha_tile_entities(tile):
    s = tile.get("settings") or {}
    if tile.get("type") == "ha":
        return [e for e in (s.get("entities") or []) if isinstance(e, str)]
    if tile.get("type") == "hasensor":
        return [e for e in (s.get("entity"), s.get("control")) if isinstance(e, str) and e]
    return []


def act_ha_call(tile, args):
    """this.act("ha.call", {entity, action, data, confirm}) from a Home or Sensor tile."""
    s = tile.get("settings") or {}
    entity = str(args.get("entity") or "")
    if entity not in ha_tile_entities(tile):
        return 403, {"error": "Add it to this tile first"}
    src = ha_source(str(s.get("src") or ""))
    if not src:
        return 400, {"error": "Home Assistant isn't set up"}
    action = str(args.get("action") or "")
    if s.get("taps") is False:
        return 403, {"error": "This tile is set to only show things"}
    if action != HA_REFRESH:                       # refreshing a reading changes nothing in the house
        if ha_secure(src, entity):
            if not s.get("secure"):
                return 403, {"error": "Turn on \"Allow locks, garage doors and alarms\" in this tile's settings first"}
            if s.get("confirm") != "One tap":
                what = (tile.get("id"), entity, action or HA_DEFAULT.get(entity.split(".")[0], ""))
                if not confirm_take(args.get("confirm"), what):
                    return 200, {"confirm": confirm_make(what), "seconds": CONFIRM_SECONDS}
    return ha_run(src, entity, action, args.get("data"))


TILE_ACTIONS["ha.call"] = act_ha_call


def ha_test(body):
    """Setup's Test button: the fields as typed, with the saved token when the token box was left blank."""
    item = body.get("item") or {}
    saved = next((x for x in sources_load().get("homeassistant") or [] if x.get("id") == item.get("id")), {}) if item.get("id") else {}
    src = {"url": (item.get("url") or saved.get("url") or "").strip(), "token": (item.get("token") or saved.get("token") or "").strip(), "id": "test"}
    if not src["url"]:
        return {"ok": False, "error": "Type the address first."}
    if not src["token"]:
        return {"ok": False, "error": "Paste an access token first."}
    try:
        cfg = ha_request(src, "GET", "/api/config")
        n = len(ha_request(src, "GET", "/api/states") or [])
    except Exception as e:
        return {"ok": False, "error": _ha_error(e, src)}
    return {"ok": True, "version": cfg.get("version"), "name": cfg.get("location_name"), "count": n}


# names used only inside functions: imported last, so these modules can use each other
from server.actions import CONFIRM_SECONDS, confirm_make, confirm_take  # noqa: E402
from server.core import VERSION, log_entry  # noqa: E402
from server.sources import sources_load  # noqa: E402
