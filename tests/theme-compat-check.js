// Themes must not change how the dashboard looks. For every built-in theme and a few custom ones, this loads the dashboard
// with fixed demo data and compares the computed colors, borders, radius, padding, gaps and shadows of every element with
// a stored snapshot (tests/fixtures/theme-compat.json). Computed styles are exact and the same on every machine,
// unlike screenshots. A change to the snapshot should be intentional: regenerate with
//   node tests/theme-compat-check.js --write
// Needs Node, Python 3 and Playwright with Chromium. Run with: node tests/theme-compat-check.js
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { until, makeDataDir, startServer, runSuite } = require("./pw-helper");

const SNAP = path.join(__dirname, "fixtures", "theme-compat.json");
const WRITE = process.argv.includes("--write");
const CUSTOM = {
  tText: { mode: "Dark", textColor: "#ffcc00", bigColor: "#ff6699", accent: "#44cc88" },
  tWins: { mode: "Light", textColor: "#224466", themeWins: true, tiles: "See-through", opacity: 70 },
  tClear: { tiles: "Clear", bg: "Color", bgColor: "#102030", textScale: 120, titles: false },
};
// Colors, shadows and fonts are checked on every element. Sizes (border, radius, padding, gaps) only on the cards and the page:
// inside a tile the fitter scales content to the machine's fonts, so those sizes differ from one computer to another.
const PROPS = ["color", "backgroundColor", "borderTopColor", "boxShadow", "fontFamily"];
const SIZE_PROPS = ["borderTopWidth", "borderRadius", "paddingTop", "paddingLeft", "rowGap", "columnGap"];

async function main() {
  const ok = await runSuite("theme-compat-check", async ({ openContext, watchErrors, onCleanup }) => {
    const data = makeDataDir("compat", {
      setup: (dir, cfg) => { cfg.modules.look.settings.items = Object.entries(CUSTOM).map(([id, values]) => ({ id, name: id, values })); },
    });
    onCleanup(() => fs.rmSync(data, { recursive: true, force: true }));
    const srv = await startServer(data);
    onCleanup(() => srv.stop());
    const ctx = await openContext({ base: srv.base, viewport: { width: 1920, height: 1080 }, useFixtures: true, interceptReports: true, label: "compat" });
    const page = await ctx.newPage();
    watchErrors(page, [], { prefix: "dash" });
    const ids = ["default"].concat(Object.keys(CUSTOM));
    const got = {};
    const builtins = await (async () => { await page.goto(srv.base + "/dash/content", { waitUntil: "load" }); return page.evaluate(() => THEMELIB.L.map(t => t.id)); })();
    for (const id of builtins.concat(ids)) {
      await page.goto(srv.base + "/dash/content?still=1&theme=" + id, { waitUntil: "load" });
      await until(() => page.evaluate(() => document.querySelectorAll(".card").length > 3), "cards for " + id);
      await page.waitForTimeout(400);
      got[id] = await page.evaluate(([props, sizeProps]) => {
        const out = {}, seen = {}, root = document.documentElement;
        out["html"] = { cls: [...root.classList].sort().join(" "), vars: ["--fg", "--fg2", "--fg3", "--dim", "--faint", "--card", "--line", "--accent", "--big", "--ts"].map(k => getComputedStyle(root).getPropertyValue(k).trim()).join("|") };
        for (const el of document.querySelectorAll("body *")) {
          if (/^(SCRIPT|STYLE|CANVAS|IFRAME|svg|path)$/i.test(el.tagName) || el.closest("#fx,#dimmer")) continue;
          const key0 = el.tagName.toLowerCase() + "." + (el.classList[0] || "") + (el.dataset.mod ? "[" + el.dataset.mod + "]" : "");   // not the later classes: the fitter adds those by size
          const n = seen[key0] = (seen[key0] || 0) + 1;
          if (n > 2) continue;
          const cs = getComputedStyle(el);
          out[key0 + "#" + n] = props.concat(el.matches(".card, .page, .cgrid") ? sizeProps : []).map(p => cs[p]).join("|");
        }
        return out;
      }, [PROPS, SIZE_PROPS]);
    }
    if (WRITE) { fs.writeFileSync(SNAP, JSON.stringify(got, null, 1) + "\n"); console.log("wrote " + SNAP); return; }
    const want = JSON.parse(fs.readFileSync(SNAP, "utf8"));
    for (const id in want) {
      assert.ok(got[id], "theme " + id + " was checked");
      const diff = Object.keys(want[id]).filter(k => JSON.stringify(want[id][k]) !== JSON.stringify(got[id][k]));
      assert.deepEqual(diff.slice(0, 5).map(k => k + ": " + JSON.stringify(want[id][k]) + " -> " + JSON.stringify(got[id][k])), [], id + " looks different");
    }
    console.log("✓ " + Object.keys(want).length + " themes look exactly as before");
  });
  process.exit(ok ? 0 : 1);
}
main();
