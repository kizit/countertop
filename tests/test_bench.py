"""The /bench test page: the frame's policy header, hits, and results saved and read back.

Run with: python3 tests/test_bench.py
"""

import importlib.util
import os
from pathlib import Path
import re
import sys
from tempfile import TemporaryDirectory
import unittest

ROOT = Path(__file__).resolve().parent.parent
TMP = TemporaryDirectory()
os.environ["COUNTERTOP_DATA"] = TMP.name
spec = importlib.util.spec_from_file_location("countertop", ROOT / "tools" / "countertop.py")
ct = importlib.util.module_from_spec(spec)
sys.argv = ["countertop.py"]
spec.loader.exec_module(ct)
bench = ct.bench

POLICY = ("sandbox allow-scripts; default-src 'none'; script-src 'nonce-%s'; style-src 'unsafe-inline'; img-src data: blob:; "
          "connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'")


class BenchTest(unittest.TestCase):
    def setUp(self):
        bench.HITS.clear()
        if bench.BENCH_FILE.exists():
            bench.BENCH_FILE.unlink()

    def test_frame_policy_is_exact_with_a_fresh_nonce(self):
        html1, h1 = bench.frame_page()
        html2, h2 = bench.frame_page()
        n1 = re.search(r"'nonce-([0-9a-f]{32})'", h1["Content-Security-Policy"]).group(1)
        n2 = re.search(r"'nonce-([0-9a-f]{32})'", h2["Content-Security-Policy"]).group(1)
        self.assertNotEqual(n1, n2)
        self.assertEqual(h1["Content-Security-Policy"], POLICY % n1)
        self.assertIn(b'nonce="%s"' % n1.encode(), html1)
        self.assertNotIn(b"__NONCE__", html1)

    def test_hits_are_recorded(self):
        bench.hit("img", "r1", "10.0.0.5")
        bench.hit("nav", "r1", "10.0.0.5")
        res = bench.results()
        self.assertEqual(res["counts"], {"img": 1, "nav": 1})
        self.assertEqual([h["via"] for h in res["hits"]], ["img", "nav"])

    def test_results_are_saved_and_read_back(self):
        bench.save({"kind": "perf", "frames": 6, "fps": 41.2, "longTasks": 3, "tapMedianMs": 24.5, "browser": "Silk"})
        bench.save({"kind": "escape", "passed": 8, "total": 8, "checks": {"fetch": {"ok": True, "note": "blocked"}}})
        saved = bench.results()["stored"]
        self.assertEqual(saved["perf"]["6"]["fps"], 41.2)
        self.assertEqual(saved["escape"]["passed"], 8)
        self.assertTrue(bench.BENCH_FILE.exists())
        self.assertEqual(bench.summary()["perf"]["6"]["fps"], 41.2)

    def test_only_measurements_are_stored(self):
        with self.assertRaises(ValueError):
            bench.save({"kind": "config", "modules": {}})
        with self.assertRaises(ValueError):
            bench.save({"kind": "perf", "frames": "many"})
        bench.save({"kind": "perf", "frames": 1, "note": "x" * 5000, "deep": {"a": {"b": {"c": {"d": 1}}}}})
        e = bench.results()["stored"]["perf"]["1"]
        self.assertEqual(len(e["note"]), 160)
        self.assertEqual(e["deep"], {"a": {"b": None}})

    def test_nothing_to_show_until_used(self):
        self.assertIsNone(bench.summary())

    def test_loop_result_notices_stopped_beats(self):
        t = bench.time.time()
        for off, via in [(-20, "beat"), (-19, "beat"), (-18, "loopstart"), (-17, "beat"), (-16, "beat"), (-5, "beat")]:
            bench.HITS.append({"t": t + off, "via": via, "run": "L", "ip": "x"})
        loop = bench.results()["loops"][0]
        self.assertTrue(loop["heartbeatsStopped"])
        self.assertGreaterEqual(loop["longestSilence"], 10)
        self.assertEqual(loop["beatsAfter"], 3)


if __name__ == "__main__":
    unittest.main()
