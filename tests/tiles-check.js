// Renders every built-in tile in tools/tiles/ via ?solo=<type>, verifies Controls loads all of them into
// Library DEFS (no silent catch drops), and checks layout/geometry invariants (no overlap, in-viewport,
// portrait idle-box reflow, and short-height clock/weather text sizing).
// Needs Node, Python 3 and Playwright with Chromium. Run with: node tests/tiles-check.js
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const {
  root, sleep, until, makeDataDir, startServer, runSuite,
  assertNoOverlap, assertInViewport,
} = require("./pw-helper");

const TILE_TYPES = fs.readdirSync(path.join(root, "tools", "tiles"))
  .filter(f => f.endsWith(".js"))
  .map(f => f.slice(0, -3))
  .sort();

async function mockTileApis(ctx, base) {
  await ctx.route(base + "/ha/states*", r => r.fulfill({
    json: {
      error: "",
      states: [
        { id: "light.kitchen", domain: "light", state: "on", name: "Kitchen", level: 75, unit: "", dc: "", icon: "", changed: "2026-11-23T12:00:00Z" },
        { id: "sensor.outside", domain: "sensor", state: "61.3", name: "Outside", unit: "°F", dc: "temperature", icon: "", changed: "2026-11-23T12:00:00Z" },
        { id: "climate.living", domain: "climate", state: "heat", action: "heating", current: 68, target: 70, modes: ["off", "heat"], min: 50, max: 85, name: "Living", unit: "°F", dc: "", icon: "", changed: "2026-11-23T12:00:00Z" },
        { id: "sensor.rte_tempo_couleur_actuelle", domain: "sensor", state: "Bleu", name: "Today", unit: "", dc: "", icon: "", changed: "2026-11-23T12:00:00Z" },
        { id: "sensor.rte_tempo_prochaine_couleur", domain: "sensor", state: "Blanc", name: "Tomorrow", unit: "", dc: "", icon: "", changed: "2026-11-23T12:00:00Z" },
        { id: "sensor.prix_tempo_courant", domain: "sensor", state: "0.1325", name: "Price", unit: "€/kWh", dc: "", icon: "", changed: "2026-11-23T12:00:00Z" },
        { id: "binary_sensor.rte_tempo_heures_creuses", domain: "binary_sensor", state: "on", name: "Off-peak", unit: "", dc: "", icon: "", changed: "2026-11-23T12:00:00Z" },
      ],
    },
  }));
  await ctx.route(base + "/tile-fetch*", r => {
    const q = new URL(r.request().url()).searchParams;
    if (q.get("type") === "stocks") {
      return r.fulfill({
        json: {
          chart: {
            result: [{
              meta: { shortName: "S&P 500", regularMarketPrice: 5932.1, chartPreviousClose: 5901.4 },
              indicators: { quote: [{ close: [5900, 5915, 5925, 5932.1] }] },
            }],
          },
        },
      });
    }
    return r.fulfill({ json: {} });
  });
}

async function main() {
  await runSuite("tiles-check", async ({ openContext, watchErrors, onCleanup }) => {
    const data = makeDataDir("tiles");
    onCleanup(() => fs.rmSync(data, { recursive: true, force: true }));
    const srv = await startServer(data);
    onCleanup(() => srv.stop());

    // 1. Controls loads every tile file into Library DEFS (no silent syntax/global errors swallowed)
    const ctlCtx = await openContext({ base: srv.base, viewport: { width: 1280, height: 900 }, useFixtures: true, interceptReports: true, label: "controls-defs" });
    const ctlErrors = [];
    const ctl = await ctlCtx.newPage();
    watchErrors(ctl, ctlErrors, { prefix: "controls" });
    await ctl.goto(srv.base + "/control", { waitUntil: "load" });
    const loaded = await until(() => ctl.evaluate(async () => {
      await defsLoad;
      return Object.keys(DEFS).sort();
    }).then(k => k.length >= TILE_TYPES.length ? k : false), "all tile DEFS to load");
    const missing = TILE_TYPES.filter(t => !loaded.includes(t));
    assert.deepEqual(missing, [], "tiles missing from Controls DEFS: " + missing.join(", "));
    assert.deepEqual(ctlErrors, []);
    await ctlCtx.close();
    console.log("✓ Controls loads all " + TILE_TYPES.length + " built-in tile files into DEFS");

    // 2. Render every built-in tile via ?solo=<type>&still=1 in landscape (1920x1080)
    const soloCtx = await openContext({ base: srv.base, viewport: { width: 1920, height: 1080 }, useFixtures: true, interceptReports: true, label: "solo-tiles" });
    await mockTileApis(soloCtx, srv.base);
    const soloErrors = [];
    const page = await soloCtx.newPage();
    watchErrors(page, soloErrors, { prefix: "solo" });

    for (const type of TILE_TYPES) {
      await page.goto(srv.base + "/dash/content?preview=1&solo=" + encodeURIComponent(type) + "&still=1", { waitUntil: "load" });
      const info = await until(() => page.evaluate(t => {
        const el = document.querySelector('[data-type="' + t + '"]');
        if (!el) return null;
        const txt = (el.innerText || "").trim();
        const rich = el.querySelector("canvas,svg,img,iframe,input,button");
        if (!txt && !rich) return null;
        return {
          textLen: txt.length,
          hasRich: !!rich,
          w: el.clientWidth,
          h: el.clientHeight,
          sw: el.scrollWidth,
        };
      }, type), "tile " + type + " to render", 6000);
      assert.ok(info.w > 0 && info.h > 0, type + " rendered with zero dimensions");
      assert.ok(info.sw <= info.w + 8, type + " overflows horizontally: scrollWidth=" + info.sw + " clientWidth=" + info.w);
    }
    assert.deepEqual(soloErrors, [], "errors while solo-rendering built-in tiles");
    console.log("✓ all " + TILE_TYPES.length + " built-in tiles render cleanly via ?solo= with no errors or overflow");

    // Also verify a portrait pass across the tiles most sensitive to narrow/tall layouts
    await page.setViewportSize({ width: 1080, height: 1920 });
    for (const type of ["clock", "weather", "week", "month", "agenda", "list", "daily", "ha", "hasensor", "dinner", "sales", "stocks", "tempo", "nexthours", "radar"]) {
      await page.goto(srv.base + "/dash/content?preview=1&solo=" + encodeURIComponent(type) + "&still=1", { waitUntil: "load" });
      await until(() => page.evaluate(t => {
        const el = document.querySelector('[data-type="' + t + '"]');
        return !!(el && (el.innerText.trim() || el.querySelector("canvas,svg,img,iframe")));
      }, type), "portrait tile " + type, 6000);
    }
    assert.deepEqual(soloErrors, [], "errors while solo-rendering tiles in portrait");
    await soloCtx.close();
    console.log("✓ key tiles render cleanly in portrait (1080×1920)");

    // 3. Demo dashboard grid geometry: no overlapping boxes, all in viewport (landscape + portrait)
    const gridCtx = await openContext({ base: srv.base, viewport: { width: 1920, height: 1080 }, useFixtures: true, interceptReports: true, label: "grid-geometry" });
    const gridErrors = [];
    const gp = await gridCtx.newPage();
    watchErrors(gp, gridErrors, { prefix: "grid" });
    for (const [label, vp] of [["landscape", { width: 1920, height: 1080 }], ["portrait", { width: 1080, height: 1920 }]]) {
      await gp.setViewportSize(vp);
      await gp.goto(srv.base + "/dash/content", { waitUntil: "load" });
      await until(() => gp.locator("#p1 .slot").count().then(c => c > 0), label + " slots");
      await sleep(800);
      const boxes = await gp.evaluate(() => [...document.querySelectorAll("#p1 .slot")]
        .filter(s => !s.hidden && s.offsetParent !== null && getComputedStyle(s).display !== "none")
        .map(s => {
          const r = s.getBoundingClientRect();
          return { id: s.dataset.slot, x: r.x, y: r.y, width: r.width, height: r.height };
        })
        .filter(b => b.width > 0 && b.height > 0));
      assert.ok(boxes.length >= 4, label + " rendered too few slots: " + boxes.length);
      assertNoOverlap(boxes, label + " main page");
      for (const b of boxes) assertInViewport(b, vp, label + " slot " + b.id, 4);
    }
    assert.deepEqual(gridErrors, []);
    await gridCtx.close();
    console.log("✓ demo dashboard slots have no overlap and stay in viewport (landscape & portrait)");

    // 4. Portrait idle-box reflow (regression for b6fb550) & short-height clock/weather text fit (regression for 6a79b69)
    const regData = makeDataDir("tiles-reg", {
      setup(dir, cfg) {
        const m = cfg.modules;
        const main = m.pages.settings.items.find(p => p.id === "main");
        m.tiles.settings.items = [
          { id: "t_clk", type: "clock", settings: { style: "Classic", date: true, greeting: false, countdowns: false } },
          { id: "t_empty", type: "countdown", settings: { dates: [] } }, // has() === false
          { id: "t_wx", type: "weather", settings: { style: "Classic", hilo: true, air: false, sun: false, rain: false } },
          { id: "t_note", type: "note", settings: { text: ["Bottom box"] } },
        ];
        main.slots = [
          { id: "s1", x: 0, y: 0, w: 24, h: 12, mod: "t_clk" },
          { id: "s2", x: 24, y: 0, w: 24, h: 12, mod: "t_empty" },
          { id: "s3", x: 0, y: 12, w: 24, h: 12, mod: "t_wx" },
          { id: "s4", x: 24, y: 12, w: 24, h: 12, mod: "t_note" },
        ];
      },
    });
    onCleanup(() => fs.rmSync(regData, { recursive: true, force: true }));
    const regSrv = await startServer(regData);
    onCleanup(() => regSrv.stop());

    const regCtx = await openContext({ base: regSrv.base, viewport: { width: 1080, height: 1920 }, useFixtures: true, interceptReports: true, label: "portrait-reflow" });
    const regErrors = [];
    const rp = await regCtx.newPage();
    watchErrors(rp, regErrors, { prefix: "reg" });
    await rp.goto(regSrv.base + "/dash/content", { waitUntil: "load" });
    await until(() => rp.locator('[data-mod="t_empty"]').evaluate(e => e.hidden), "empty countdown to hide");
    await sleep(500);
    const portBoxes = await rp.evaluate(() => ["s1", "s3", "s4"].map(id => {
      const s = document.querySelector('[data-slot="' + id + '"]');
      const r = s.getBoundingClientRect();
      return { id, x: r.x, y: r.y, width: r.width, height: r.height };
    }));
    assertNoOverlap(portBoxes, "portrait reflow");
    for (const b of portBoxes) assertInViewport(b, { width: 1080, height: 1920 }, "portrait slot " + b.id, 4);
    assert.ok(portBoxes[0].y <= portBoxes[1].y && portBoxes[1].y <= portBoxes[2].y,
      "portrait reflow broke visual order: " + JSON.stringify(portBoxes));

    // Shortening a tall clock box (h:12 -> h:8 in landscape) keeps text size instead of collapsing it
    await rp.setViewportSize({ width: 1920, height: 1080 });
    await rp.goto(regSrv.base + "/dash/content", { waitUntil: "load" });
    await until(() => rp.locator('[data-mod="t_clk"] [data-part="time"], [data-mod="t_clk"] .time').first().isVisible(), "clock time");
    const fontAt = async () => rp.evaluate(() => {
      const el = document.querySelector('[data-mod="t_clk"] [data-part="time"], [data-mod="t_clk"] .time');
      return parseFloat(getComputedStyle(el).fontSize);
    });
    const tallFs = await fontAt();
    // Shorten the box from 12 rows to 8 rows on the server and reload
    const cfgPath = path.join(regData, "dashboard.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    cfg.modules.pages.settings.items.find(p => p.id === "main").slots.find(s => s.id === "s1").h = 8;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    await rp.reload({ waitUntil: "load" });
    await until(() => rp.locator('[data-mod="t_clk"] [data-part="time"], [data-mod="t_clk"] .time').first().isVisible(), "short clock time");
    const shortFs = await fontAt();
    assert.ok(shortFs >= tallFs * 0.9, `shortening clock box collapsed text: tall=${tallFs}px short=${shortFs}px`);
    assert.deepEqual(regErrors, []);
    await regCtx.close();
    console.log("✓ portrait idle-box reflow keeps order and short clock boxes preserve text size");
  });
}

main().catch(e => { console.error(e); process.exit(1); });
