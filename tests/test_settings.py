"""Settings safety: upgrades run once and in order, a damaged file is never written over, backups roll.

Run with: python3 tests/test_settings.py
"""

import importlib.util
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import time
import unittest

ROOT = Path(__file__).resolve().parent.parent
TMP = TemporaryDirectory()
os.environ["COUNTERTOP_DATA"] = TMP.name
spec = importlib.util.spec_from_file_location("countertop", ROOT / "tools" / "countertop.py")
ct = importlib.util.module_from_spec(spec)
sys.argv = ["countertop.py"]
spec.loader.exec_module(ct)

# A settings file from before tiles (v2: one fixed module per tile) and before looks/effects lists.
V2 = {"modules": {
    "general": {"on": True, "settings": {"lat": 38.6, "lon": -90.2}},
    "clock": {"on": True, "settings": {"h24": True}},
    "look": {"on": True, "settings": {"dateFmt": "Long", "items": [{"id": "cozy", "when": {"month": 12}, "values": {}}]}},
    "effects": {"on": True, "settings": {"weather": True, "seasonal": False, "density": 50}},
    "night": {"on": False, "settings": {}},
}}


def reset(data=None, raw=None):
    for f in Path(TMP.name).rglob("*"):
        if f.is_file():
            f.unlink()
    ct.CONFIG_PROBLEM.clear()
    if raw is not None:
        ct.CONFIG_FILE.write_text(raw)
    elif data is not None:
        ct.CONFIG_FILE.write_text(json.dumps(data))


def stored():
    return json.loads(ct.CONFIG_FILE.read_text())


def backups():
    return sorted(ct.BACKUP_DIR.glob("dashboard-*.json")) if ct.BACKUP_DIR.exists() else []


class Upgrades(unittest.TestCase):
    def test_new_install_gets_current_schema(self):
        reset()
        cfg = ct.config_load()
        self.assertEqual(stored()["schema"], ct.CONFIG_SCHEMA)
        self.assertTrue(cfg["modules"]["tiles"]["settings"]["items"])
        self.assertEqual(backups(), [])            # nothing existed to back up

    def test_old_file_is_upgraded_once_with_a_backup_first(self):
        reset(V2)
        ct.config_load()
        s = stored()
        self.assertEqual(s["schema"], ct.CONFIG_SCHEMA)
        self.assertIn("tiles", s["modules"])
        self.assertIn("items", s["modules"]["effects"]["settings"])
        self.assertEqual(s["modules"]["general"]["settings"].get("dateFmt"), "Long")    # moved out of look
        self.assertTrue(any(p.get("id") == "night" for p in s["modules"]["pages"]["settings"]["items"]))
        (b,) = backups()
        self.assertEqual(json.loads(b.read_text()), V2)                               # the original, untouched

    def test_current_file_is_left_alone(self):
        reset()
        ct.config_load()
        before = ct.CONFIG_FILE.read_text()
        ct.config_load()
        self.assertEqual(ct.CONFIG_FILE.read_text(), before)

    def test_unversioned_current_file_is_only_stamped(self):
        reset()
        ct.config_load()
        s = stored()
        del s["schema"]
        reset(s)
        ct.config_load()
        after = stored()
        self.assertEqual(after["schema"], ct.CONFIG_SCHEMA)
        self.assertEqual(after["modules"], s["modules"])


class DamagedFile(unittest.TestCase):
    def test_damaged_file_is_kept_and_last_backup_restored(self):
        reset()
        ct.config_load()
        good = stored()
        good["modules"].setdefault("general", {"on": True, "settings": {}})["settings"]["lat"] = 12.5
        ct.CONFIG_FILE.write_text(json.dumps(good))
        ct.config_backup(force=True)
        ct.CONFIG_FILE.write_text('{"modules": {"general": ')          # cut off mid-write
        cfg = ct.config_load()
        self.assertEqual(cfg["modules"]["general"]["settings"]["lat"], 12.5)
        (kept,) = Path(TMP.name).glob("dashboard.broken-*.json")
        self.assertEqual(kept.read_text(), '{"modules": {"general": ')
        self.assertTrue(ct.CONFIG_PROBLEM["restored"])
        self.assertTrue(any("couldn't be read" in p for p in ct.status_view()["problems"]))

    def test_damaged_file_without_backup_starts_fresh_but_is_kept(self):
        reset(raw="not json at all")
        cfg = ct.config_load()
        self.assertIn("tiles", cfg["modules"])
        (kept,) = Path(TMP.name).glob("dashboard.broken-*.json")
        self.assertEqual(kept.read_text(), "not json at all")
        self.assertEqual(ct.CONFIG_PROBLEM["restored"], "")

    def test_non_object_json_counts_as_damaged(self):
        reset(raw="[]")
        ct.config_load()
        self.assertEqual(len(list(Path(TMP.name).glob("dashboard.broken-*.json"))), 1)


class ScreenOrientation(unittest.TestCase):
    def test_every_choice_is_kept_and_a_layout_save_leaves_it(self):
        reset()
        ct.config_load()
        for mode in ("landscape", "left", "right", "auto"):
            ct.config_save({"orientation": mode}, quiet=True)
            self.assertEqual(ct.dashboard_orientation(), mode)
        ct.config_save({"orientation": "landscape"}, quiet=True)
        ct.config_save({"modules": stored()["modules"]}, quiet=True)
        self.assertEqual(ct.dashboard_orientation(), "landscape")

    def test_unknown_choice_is_refused(self):
        reset()
        ct.config_load()
        with self.assertRaises(ValueError):
            ct.config_save({"orientation": "sideways"}, quiet=True)


class Backups(unittest.TestCase):
    def test_routine_saves_are_spaced_and_capped(self):
        reset()
        ct.config_load()
        mods = stored()["modules"]
        ct.config_save({"modules": mods}, quiet=True)
        ct.config_save({"modules": mods}, quiet=True)
        self.assertEqual(len(backups()), 1)        # second save inside BACKUP_EVERY: no new copy
        for _ in range(ct.BACKUP_KEEP + 3):
            ct.config_backup(force=True)
        self.assertEqual(len(backups()), ct.BACKUP_KEEP)

    def test_backup_after_quiet_period(self):
        reset()
        ct.config_load()
        mods = stored()["modules"]
        ct.config_save({"modules": mods}, quiet=True)
        (b,) = backups()
        old = time.time() - ct.BACKUP_EVERY - 5
        os.utime(b, (old, old))
        ct.config_save({"modules": mods}, quiet=True)
        self.assertEqual(len(backups()), 2)


class Language(unittest.TestCase):
    def test_defaults_to_automatic_and_keeps_a_chosen_language(self):
        reset()
        self.assertEqual(ct.config_load()["modules"]["general"]["settings"]["lang"], "Automatic")
        mods = ct.config_load()["modules"]
        mods["general"]["settings"]["lang"] = "Français"
        ct.config_save({"modules": mods})
        self.assertEqual(ct.config_load()["modules"]["general"]["settings"]["lang"], "Français")

    def test_every_language_choice_has_a_catalog(self):
        codes = {"English": "en", "Français": "fr"}
        for choice in ct.SCHEMA["general"]["settings"]["lang"]["choices"]:
            if choice == "Automatic" or codes[choice] == "en":
                continue
            json.loads((ROOT / "tools" / "lang" / (codes[choice] + ".json")).read_text())



class Themes(unittest.TestCase):
    def test_everyday_until_a_theme_is_picked_and_the_pick_is_kept(self):
        reset()
        look = ct.config_load()["modules"]["look"]["settings"]
        self.assertEqual(look["use"], "")            # older files have no pick: Everyday shows
        mods = ct.config_load()["modules"]
        mods["look"]["settings"]["items"] = [{"id": "tglass", "name": "Glass", "values": {"tiles": "See-through"}}]
        mods["look"]["settings"]["use"] = "tglass"
        ct.config_save({"modules": mods})
        self.assertEqual(ct.config_load()["modules"]["look"]["settings"]["use"], "tglass")


class OwnEffects(unittest.TestCase):
    def test_own_effects_are_kept(self):
        reset()
        mods = ct.config_load()["modules"]
        self.assertEqual(mods["effects"]["settings"]["mine"], [])
        mine = [{"id": "myab12", "name": "Pumpkin fall", "glyphs": ["\U0001F383"], "motion": "fall", "size": "Big", "speed": "Slow", "spin": True, "from": "10-1", "to": "10-31"}]
        mods["effects"]["settings"]["mine"] = mine
        ct.config_save({"modules": mods})
        self.assertEqual(ct.config_load()["modules"]["effects"]["settings"]["mine"], mine)


# A settings file from before the network limit (schema 2): two Your own tiles and a clock.
def own(iid, html, **extra):
    return dict({"id": iid, "type": "custom", "name": "Tile " + iid, "settings": {"html": html}}, **extra)


V2_OWN = {"schema": 2, "modules": {
    "pages": {"on": True, "settings": {"items": [{"id": "main", "name": "Main", "on": True, "cols": 48, "slots": [
        {"id": "s1", "x": 0, "y": 0, "w": 12, "h": 8, "mod": "cam"}, {"id": "s2", "x": 12, "y": 0, "w": 12, "h": 8, "mod": "pihole"},
        {"id": "s3", "x": 24, "y": 0, "w": 12, "h": 8, "mod": "clock"}]}]}},
    "tiles": {"on": True, "settings": {"items": [own("cam", "<img src='http://192.168.1.20/snap.jpg'>"), own("pihole", "<b>pi</b><img src='http://pi.hole/admin/img/logo.png'>"),
                                                  {"id": "clock", "type": "clock", "settings": {}}]}},
}}


def items(mods=None):
    mods = mods or ct.config_load()["modules"]
    return {t["id"]: t for t in mods["tiles"]["settings"]["items"]}


class YourOwnTileNetwork(unittest.TestCase):
    """Your own tiles made before the limit keep home-network access; nothing that arrives later can claim it."""

    def test_upgrade_grandfathers_existing_tiles_and_records_them(self):
        reset(V2_OWN)
        t = items()
        self.assertTrue(t["cam"]["lan"] and t["pihole"]["lan"])
        self.assertNotIn("lan", t["clock"])
        s = stored()
        self.assertEqual(s["schema"], ct.CONFIG_SCHEMA)
        self.assertEqual(sorted(s["lanTiles"]["ids"]), ["cam", "pihole"])
        self.assertEqual(len(backups()), 1)                       # the schema-2 file was kept first
        self.assertEqual(items()["cam"].get("lan"), True)         # loading again changes nothing

    def test_a_shared_tile_waiting_for_run_is_not_grandfathered(self):
        data = json.loads(json.dumps(V2_OWN))
        data["modules"]["tiles"]["settings"]["items"][1]["review"] = True
        data["modules"]["tiles"]["settings"]["items"][1]["lan"] = True
        reset(data)
        t = items()
        self.assertTrue(t["cam"]["lan"])
        self.assertNotIn("lan", t["pihole"])

    def test_new_installs_have_no_grandfathered_tiles(self):
        reset()
        ct.config_load()
        self.assertNotIn("lanTiles", stored())

    def test_a_new_tile_cant_claim_the_mark(self):
        reset(V2_OWN)
        mods = ct.config_load()["modules"]
        L = mods["tiles"]["settings"]["items"]
        L.append(own("new1", "<script>fetch('http://192.168.1.1/')</script>", lan=True))      # added after the upgrade
        L.append(dict(id="clk2", type="clock", settings={}, lan=True))
        ct.config_save({"modules": mods})
        t = items()
        self.assertNotIn("lan", t["new1"])
        self.assertNotIn("lan", t["clk2"])
        self.assertTrue(t["cam"]["lan"])
        self.assertNotIn("new1", stored()["lanTiles"]["ids"])

    def test_editing_a_grandfathered_tile_keeps_its_access(self):
        reset(V2_OWN)
        mods = ct.config_load()["modules"]
        items(mods)["cam"]["settings"]["html"] = "<img src='http://192.168.1.21/snap.jpg'>"
        ct.config_save({"modules": mods})
        self.assertTrue(items()["cam"]["lan"])

    def test_a_copy_with_the_same_code_keeps_it_other_code_doesnt(self):
        reset(V2_OWN)
        mods = ct.config_load()["modules"]
        L = mods["tiles"]["settings"]["items"]
        cam = items(mods)["cam"]
        L.append(dict(json.loads(json.dumps(cam)), id="pg2_0"))             # "Use on Main" from My layouts copies tiles
        L.append(dict(json.loads(json.dumps(cam)), id="pg2_1", settings={"html": "<script>evil()</script>"}))
        ct.config_save({"modules": mods})
        t = items()
        self.assertTrue(t["pg2_0"]["lan"])
        self.assertNotIn("lan", t["pg2_1"])

    def test_a_removed_tile_loses_its_record(self):
        reset(V2_OWN)
        mods = ct.config_load()["modules"]
        mods["tiles"]["settings"]["items"] = [t for t in mods["tiles"]["settings"]["items"] if t["id"] != "pihole"]
        ct.config_save({"modules": mods})
        self.assertEqual(stored()["lanTiles"]["ids"], ["cam"])
        mods = ct.config_load()["modules"]                        # a later tile with the same id and other code
        mods["tiles"]["settings"]["items"].append(own("pihole", "<script>other()</script>", lan=True))
        ct.config_save({"modules": mods})
        self.assertNotIn("lan", items()["pihole"])

    def test_a_hand_made_mark_does_nothing(self):
        reset()
        ct.config_load()
        s = stored()
        s["modules"]["tiles"]["settings"]["items"].append(own("x1", "<b>x</b>", lan=True))
        ct.CONFIG_FILE.write_text(json.dumps(s))
        self.assertNotIn("lan", items()["x1"])

    def test_a_tried_layout_keeps_only_granted_marks(self):
        reset(V2_OWN)
        cam = items()["cam"]
        tiles = [dict(cam), own("imp1", "<b>i</b>", lan=True)]
        out = ct.trial_add({"pages": [{"id": "main", "slots": []}], "tiles": tiles, "look": {}})
        kept = {t["id"]: t for t in ct.TRIALS[out["id"]]["tiles"]}
        self.assertTrue(kept["cam"]["lan"])
        self.assertNotIn("lan", kept["imp1"])

    def test_status_warns_about_grandfathered_tiles(self):
        reset(V2_OWN)
        ct.config_load()
        warn = [p for p in ct.status_view()["problems"] if "home network" in p]
        self.assertEqual(len(warn), 1)
        self.assertIn("\u201cTile cam\u201d", warn[0])
        self.assertIn("\u201cTile pihole\u201d", warn[0])
        reset()
        ct.config_load()
        self.assertFalse([p for p in ct.status_view()["problems"] if "home network" in p])


class TrustPrompt(unittest.TestCase):
    def test_run_is_saved_once(self):
        reset(V2_OWN)
        mods = ct.config_load()["modules"]
        mods["tiles"]["settings"]["items"].append(own("imp1", "<b>shared</b><img src='http://192.168.1.9/x.png'>", review=True))
        ct.config_save({"modules": mods})
        self.assertTrue(items()["imp1"]["review"])
        self.assertTrue(ct.tile_trust("imp1"))
        self.assertNotIn("review", items()["imp1"])
        self.assertNotIn("lan", items()["imp1"])                  # running it doesn't grant home-network access
        self.assertTrue(ct.tile_trust("imp1"))                    # already running: still fine
        self.assertTrue(items()["cam"]["lan"])                    # the rest is untouched
        self.assertFalse(ct.tile_trust("nope"))
        self.assertFalse(ct.tile_trust("clock"))                  # only Your own tiles wait for Run


if __name__ == "__main__":
    unittest.main()
