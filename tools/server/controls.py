"""Control tiles: community tiles that can work things in the house, without their code ever sending an action.

A control tile lists the kinds of thing it works (`devices`, e.g. a lamp that is a light or a switch) and one button
per thing it can do (`controls`, e.g. turn the lamp on). The tile's code runs in its sandboxed frame and can only show
state. The dashboard draws the buttons itself, outside the frame, and a real tap on one sends exactly that button's
id here. Everything else comes from what's saved, never from the request:

- the button, its device slot and its Home Assistant action come from the installed tile file;
- which real device fills the slot is the person's grant, saved in that tile's own settings (`@<slot>`);
- locks, alarms and garage doors also need the tile's own "Allow locks, garage doors and alarms" (`@secure`), and
  always a second tap on a confirm the dashboard draws, answered here with a short-lived token.
"""
from server.actions import TILE_ACTIONS

GRANT = "@"             # settings keys the dashboard adds to a control tile: @src, @secure, @<device slot>


def control_grants(tile_settings, devices):
    """{slot: entity id} for the slots the person filled in, each checked against the kinds the slot allows."""
    s = tile_settings if isinstance(tile_settings, dict) else {}
    out = {}
    for slot, d in (devices or {}).items():
        e = s.get(GRANT + slot)
        if isinstance(e, str) and "." in e and e.split(".")[0] in d["domains"]:
            out[slot] = e
    return out


def act_control(tile, args):
    """this button, on this tile: {"control": id, "confirm": token}. Nothing else in the request is used."""
    t = community_tile(str(tile.get("type") or ""))
    if not t or not t.get("controls"):
        return 403, {"error": "This tile has no controls"}
    if safe_mode()["on"]:
        return 403, {"error": "Community tiles are off (safe mode)"}
    cid = str(args.get("control") or "")
    c = next((x for x in t["controls"] if x["id"] == cid), None)
    if not c:
        return 403, {"error": "This tile has no such control"}
    s = tile.get("settings") if isinstance(tile.get("settings"), dict) else {}
    dev = t["devices"][c["device"]]
    entity = control_grants(s, t["devices"]).get(c["device"])
    if not entity:
        return 403, {"error": "Pick the %s for this tile in its settings first" % dev["label"]}
    if c["action"] not in HA_ACTIONS.get(entity.split(".")[0], ()):
        return 403, {"error": "That action isn't allowed here"}
    src = ha_source(str(s.get(GRANT + "src") or ""))
    if not src:
        return 400, {"error": "Home Assistant isn't set up"}
    if ha_secure(src, entity):
        if s.get(GRANT + "secure") is not True:
            return 403, {"error": "Turn on \"Allow locks, garage doors and alarms\" in this tile's settings first"}
        # always two taps for a community tile, whatever the built-in tiles are set to
        what = ("control", tile.get("id"), cid, entity)
        if not confirm_take(args.get("confirm"), what):
            st = (ha_states(src).get("states") or {}).get(entity) or {}
            return 200, {"confirm": confirm_make(what), "seconds": CONFIRM_SECONDS, "name": st.get("name") or entity}
    return ha_run(src, entity, c["action"], c["data"])


TILE_ACTIONS["tile.control"] = act_control


# names used only inside functions: imported last, so these modules can use each other
from server.actions import CONFIRM_SECONDS, confirm_make, confirm_take  # noqa: E402
from server.homeassistant import HA_ACTIONS, ha_run, ha_secure, ha_source, ha_states  # noqa: E402
from server.sandbox import community_tile, safe_mode  # noqa: E402
