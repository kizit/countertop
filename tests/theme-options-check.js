// The theme options (fonts, tile edges and corners, spacing, backgrounds, tint, per-theme effects) end to end in Chromium:
//   - each option changes what the dashboard draws, and the grid editor places boxes with the theme's spacing
//   - an uploaded wallpaper is checked (PNG/JPEG/WebP, size), stays on this server, and never travels in a shared theme,
//     a shared layout or a gallery submission (a theme on a wallpaper falls back to a gradient; photo albums never leave)
// Needs Node, Python 3 and Playwright with Chromium. Run with: node tests/theme-options-check.js
const fs = require("node:fs");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { until, makeDataDir, startServer, runSuite, assertNoOverlap } = require("./pw-helper");

const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(60, 7)]);
const WALL = "w-" + crypto.createHash("sha256").update(PNG).digest("hex").slice(0, 12);
const THEMES = {
  tFont: { fontBody: "Nunito", fontDisplay: "Bebas Neue" },
  tShape: { shape: "Square", surface: "Glass" },
  tSoft: { shape: "Soft", surface: "Soft" },
  tOutline: { surface: "Outline" },
  tFlat: { surface: "Flat" },
  tCompact: { density: "Compact" },
  tRoomy: { density: "Roomy" },
  tGrad: { bg: "Gradient", gradient: "Forest" },
  tTex: { bg: "Texture", texture: "Linen", bgColor: "#223344" },
  tWall: { bg: "Wallpaper", wallpaper: WALL, album: "family", mode: "Light" },
  tTint: { bg: "Color", tint: "#ff8800", tintAmt: 30 },
  tPick: { fxPick: ["snow"] },
};

async function main() {
  const ok = await runSuite("theme-options-check", async ({ openContext, watchErrors, onCleanup }) => {
    const data = makeDataDir("options", {
      setup: (dir, cfg) => { cfg.modules.look.settings.items = Object.entries(THEMES).map(([id, values]) => ({ id, name: id, values })); },
    });
    onCleanup(() => fs.rmSync(data, { recursive: true, force: true }));
    const srv = await startServer(data);
    onCleanup(() => srv.stop());
    const post = (p, body) => fetch(srv.base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

    // ----- uploads are checked, and a stored wallpaper is served back as the picture it is
    let r = await post("/wallpaper", { data: "data:image/png;base64," + PNG.toString("base64") });
    assert.equal((await r.json()).id, WALL);
    r = await fetch(srv.base + "/wallpaper/" + WALL);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "image/png");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    for (const [what, data] of [["svg", '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'], ["html", "<html></html>"], ["junk", "!!"]]) {
      r = await post("/wallpaper", { data: "data:image/png;base64," + Buffer.from(data).toString("base64") });
      assert.equal(r.status, 400, what + " is refused");
    }
    r = await post("/wallpaper", { data: PNG.toString("base64") + Buffer.alloc(11_000_000).toString("base64") });
    assert.equal(r.status, 400, "a picture over the limit is refused");
    assert.equal((await fetch(srv.base + "/wallpaper/w-000000000000")).status, 404);
    assert.equal((await fetch(srv.base + "/wallpaper/..%2fdashboard.json")).status, 404);

    const ctx = await openContext({ base: srv.base, viewport: { width: 1920, height: 1080 }, useFixtures: true, interceptReports: true, label: "options" });
    const page = await ctx.newPage();
    watchErrors(page, [], { prefix: "dash" });
    const load = async id => {
      await page.goto(srv.base + "/dash/content?still=1&theme=" + id, { waitUntil: "load" });
      await until(() => page.evaluate(() => document.querySelectorAll(".card").length > 3), "cards for " + id);
      await page.waitForTimeout(250);
    };
    const css = (sel, prop) => page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [sel, prop]);
    const rootVar = k => page.evaluate(k => getComputedStyle(document.documentElement).getPropertyValue(k).trim(), k);

    // ----- fonts: body text and the big numbers
    await load("tFont");
    assert.match(await css("body", "fontFamily"), /Nunito/);
    assert.match(await css(".m-clock .t", "fontFamily"), /Bebas Neue/, "the clock's big numbers use the Big numbers font");
    assert.match(await css(".m-weather .tt", "fontFamily"), /Bebas Neue/);
    assert.match(await rootVar("--font-display"), /Bebas Neue/);
    await load("default");
    assert.doesNotMatch(await css("body", "fontFamily"), /Nunito/);

    // ----- tile edges and corners
    await load("tShape");
    assert.equal(await css(".card", "borderTopLeftRadius"), "6px");
    assert.match(await css(".card", "boxShadow"), /inset/, "Glass has a shine");
    await load("tSoft");
    assert.equal(await css(".card", "borderTopLeftRadius"), "30px");
    assert.equal(await css(".card", "borderTopWidth"), "0px");
    assert.notEqual(await css(".card", "boxShadow"), "none");
    await load("tOutline");
    assert.equal(await css(".card", "borderTopWidth"), "2px");
    await load("tFlat");
    assert.equal(await css(".card", "borderTopWidth"), "0px");
    assert.equal(await css(".card", "boxShadow"), "none");

    // ----- spacing: the gap, the padding in tiles and the margin around the page; the editor uses the same gap; nothing overlaps
    const want = { default: [16, 16, 20, 22, 36], tCompact: [10, 10, 14, 14, 24], tRoomy: [22, 20, 26, 30, 48] };
    for (const id in want) {
      await load(id);
      const got = await page.evaluate(() => { const g = document.querySelector(".cgrid"), gs = getComputedStyle(g), cards = [...document.querySelectorAll(".card")].map(c => getComputedStyle(c));
        return { gap: parseFloat(gs.rowGap), py: Math.max(...cards.map(c => parseFloat(c.paddingTop))), px: Math.max(...cards.map(c => parseFloat(c.paddingLeft))), top: parseFloat(gs.top), left: parseFloat(gs.left), editor: gapPx() }; });
      assert.deepEqual([got.gap, got.py, got.px, got.top, got.left], want[id], id + " spacing");
      assert.equal(got.editor, want[id][0], id + ": the grid editor places boxes with the same gap");
      const boxes = await page.evaluate(() => [...document.querySelectorAll("#p1 .slot")].filter(e => e.offsetWidth).map(e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }));
      assert.ok(boxes.length > 3);
      assertNoOverlap(boxes, id + " boxes");
      assert.ok(boxes.every(b => b.x >= 0 && b.y >= 0 && b.x + b.width <= 1921 && b.y + b.height <= 1081), id + ": every box is on the screen");
    }
    // the editor's cells line up with the real boxes at every spacing
    for (const id of ["tCompact", "tRoomy"]) {
      await load(id);
      const off = await page.evaluate(() => { EDIT.k = 1; EDIT.page = "main"; const G = pgGrid(); const s = gridOf("main").slots[0], r = cellRect(s), el = document.querySelector('#p1 .slot[data-slot="' + s.id + '"]') || document.querySelector("#p1 .slot");
        const b = el.getBoundingClientRect(); return { dl: Math.abs(r.left - b.left), dt: Math.abs(r.top - b.top), dw: Math.abs(r.width - b.width), dh: Math.abs(r.height - b.height), G: !!G }; });
      assert.ok(off.G && off.dl < 1.5 && off.dt < 1.5 && off.dw < 1.5 && off.dh < 1.5, id + ": editor cell matches the real box " + JSON.stringify(off));
    }

    // ----- backgrounds, tint and per-theme effects
    await load("tGrad");
    assert.match(await css("#skyA", "backgroundImage"), /linear-gradient/);
    await load("tTex");
    assert.match(await css("#skyA", "backgroundImage"), /repeating-linear-gradient/);
    await load("tWall");
    assert.match(await css("#skyA", "backgroundImage"), new RegExp("/wallpaper/" + WALL));
    await load("tTint");
    assert.equal(await css("#tinter", "opacity"), "0.3");
    assert.equal(await css("#tinter", "backgroundColor"), "rgb(255, 136, 0)");
    await load("default");
    assert.equal(await css("#tinter", "opacity"), "0");
    await load("tPick");
    assert.deepEqual(await page.evaluate(() => FXCFG.pick), ["snow"]);
    await load("default");
    assert.equal(await page.evaluate(() => FXCFG.pick), null);

    // ----- nothing local leaves: shared theme, shared layout, gallery submission
    const ctl = await ctx.newPage();
    watchErrors(ctl, [], { prefix: "ctl", ignoreConsole: t => /reported: config: TypeError: Failed to fetch/.test(t) });
    await ctl.goto(srv.base + "/control", { waitUntil: "load" });
    await until(() => ctl.evaluate(() => typeof mods === "object" && !!mods.look), "Controls loaded");
    const shared = await ctl.evaluate(() => {
      const pkg = sharePack("theme:tWall"), code = libCode(pkg), back = JSON.parse(b64dec(code.slice(4)));
      const layout = libPack({id:"x", name:"x", slots:[]}, lookVals("tWall"), "x", "").pkg;
      return { values: pkg.values, code: JSON.stringify(back), layout: JSON.stringify(layout.look), every: THEMELIB.portable({ wallpaper: "w-1", album: "a", bg: "Photos", fxPick: ["snow", "my-1"] }, { fxOk: id => id === "snow" }) };
    });
    assert.equal(shared.values.bg, "Gradient", "a theme on a wallpaper falls back to a gradient");
    assert.ok(!("wallpaper" in shared.values) && !("album" in shared.values));
    for (const s of [shared.code, shared.layout]) { assert.ok(!s.includes(WALL), "the wallpaper id doesn't travel"); assert.ok(!s.includes("family"), "the album doesn't travel"); }
    assert.deepEqual(shared.every, { bg: "Photos", fxPick: ["snow"], ...Object.fromEntries(Object.entries(await ctl.evaluate(() => THEMELIB.BASE)).filter(([k]) => false)) });
    // and a file or code that carries them in is ignored on the way in
    const read = await ctl.evaluate(() => themeRead({ values: { accent: "#112233", wallpaper: "w-aaaaaaaaaaaa", album: "x", bg: "Wallpaper" } }).values);
    assert.deepEqual(read, { accent: "#112233", bg: "Wallpaper" });
    console.log("✓ theme options draw, fit the grid editor, and keep local wallpapers and albums home");
  });
  process.exit(ok ? 0 : 1);
}
main();
