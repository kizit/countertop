// Built-in themes (tools/shared/themes.js) end to end in Chromium, on a config from before they existed:
//   - your own themes, Everyday and the theme in use load as they were
//   - built-ins look the same whatever Everyday looks like, and opening one saves nothing
//   - Use this theme and the schedule work with built-ins and with Everyday, on Controls and on the dashboard
//   - an id the dashboard doesn't know shows Everyday
//   - starter layouts bring their built-in theme, but a copy made earlier still wins
//   - a built-in in use survives a restart
// Needs Node, Python 3 and Playwright with Chromium. Run with: node tests/themes-check.js
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { until, makeDataDir, startServer, runSuite } = require("./pw-helper");

async function main() {
  const ok = await runSuite("themes-check", async ({ openContext, watchErrors, onCleanup }) => {
    const data = makeDataDir("themes", {
      setup: (dir, cfg) => {
        const L = cfg.modules.look.settings;
        Object.assign(L, { accent: "#ff0000", textScale: 115 });
        L.items = [{ id: "tOld", name: "Old", values: { accent: "#123456" } },
          { id: "tMin", name: "Minimal", values: { mode: "Light", accent: "#376a63" }, from: "starter:minimal" }];
        L.rules = [];
        L.use = "tOld";
      },
    });
    onCleanup(() => fs.rmSync(data, { recursive: true, force: true }));
    let srv = await startServer(data);
    onCleanup(() => srv.stop());
    const cfg = async () => (await (await fetch(srv.base + "/config")).json()).modules.look.settings;

    const ctx = await openContext({ base: srv.base, viewport: { width: 1280, height: 900 }, label: "themes" });
    const errs = [];
    const ctl = await ctx.newPage();
    watchErrors(ctl, errs, { prefix: "ctl", ignoreConsole: t => /reported: config: TypeError: Failed to fetch/.test(t) });
    await ctl.goto(srv.base + "/control", { waitUntil: "load" });
    await until(() => ctl.evaluate(() => typeof mods === "object" && !!mods.look), "Controls loaded");

    // an older config loads as it was
    const before = await ctl.evaluate(() => ({ used: usedLook(), n: looks().length, ids: THEMELIB.L.map(t => t.id) }));
    assert.equal(before.used, "tOld");
    assert.equal(before.n, 2);
    assert.ok(before.ids.every(id => /^builtin-[a-z-]+$/.test(id)), "built-in ids are reserved and fit ?theme=");
    assert.equal(new Set(before.ids).size, before.ids.length, "built-in ids are unique");

    // built-ins are complete: Everyday's red accent and bigger text don't leak in
    const glass = await ctl.evaluate(() => lookVals("builtin-glass"));
    assert.equal(glass.accent, "#7cb7ff");
    assert.equal(glass.textScale, 100);
    assert.equal(glass.tiles, "See-through");

    // Themes shows every built-in; opening one saves nothing and offers no Delete or Share
    await ctl.evaluate(() => go("looks"));
    await until(() => ctl.locator('[data-go^="theme:builtin-"]').count().then(c => c === before.ids.length), "built-in cards on Themes");
    await ctl.evaluate(() => go("theme:builtin-glass"));
    await ctl.locator('[data-lact="use"]').waitFor();
    assert.equal(await ctl.locator('[data-lact="del"], [data-go^="share:"]').count(), 0, "no Delete or Share on a built-in");
    assert.equal(await ctl.evaluate(() => looks().length), 2, "opening a built-in made a copy");
    console.log("✓ built-ins are listed, complete, and opening one saves nothing");

    // Use this theme with a built-in: saved as its id, no copy
    await ctl.locator('[data-lact="use"]').click();
    await until(async () => (await cfg()).use === "builtin-glass", "use saved as the built-in id");
    assert.equal((await cfg()).items.length, 2);

    const dash = await ctx.newPage();
    watchErrors(dash, errs, { prefix: "dash" });
    await dash.goto(srv.base + "/dash/content", { waitUntil: "load" });
    await until(() => dash.evaluate(() => typeof THEME !== "undefined" && !!THEME && THEME.id === "builtin-glass"), "dashboard shows Glass");
    const dv = await dash.evaluate(() => ({ accent: THEMEV.accent, ts: THEMEV.textScale }));
    assert.deepEqual(dv, { accent: "#7cb7ff", ts: 100 });
    console.log("✓ Use this theme works with a built-in on Controls and the dashboard");

    // the schedule can show Everyday, and a built-in, over the theme in use
    await ctl.evaluate(() => { rules().push({ id: "rev", on: true, look: "default", when: {} }); save(); });
    await until(async () => ((await cfg()).rules || []).some(r => r.look === "default"), "Everyday rule saved");
    assert.equal(await ctl.evaluate(() => curLook()), "default");
    await dash.reload({ waitUntil: "load" });
    await until(() => dash.evaluate(() => typeof THEMEV === "object" && THEMEV.accent === "#ff0000" && THEME === null), "dashboard shows Everyday from the schedule");
    await ctl.evaluate(() => { rules().push({ id: "rcalm", on: true, look: "builtin-calm-evening", when: {} }); save(); });
    assert.equal(await ctl.evaluate(() => curLook()), "builtin-calm-evening");
    await ctl.evaluate(() => go("rule:rev"));
    const opts = await ctl.locator('select[data-rk="look"] option').evaluateAll(o => o.map(x => x.value));
    assert.ok(opts.includes("default") && opts.includes("builtin-calm-evening") && opts.includes("tOld"), "schedule offers Everyday, built-ins and yours");
    console.log("✓ the schedule works with Everyday and built-ins");

    // an id this dashboard doesn't know shows Everyday
    await dash.goto(srv.base + "/dash/content?theme=builtin-from-the-future", { waitUntil: "load" });
    await until(() => dash.evaluate(() => typeof THEMEV === "object" && THEMEV.accent === "#ff0000" && THEME === null), "unknown id falls back to Everyday");
    console.log("✓ an unknown theme id falls back to Everyday");

    // starters: built-in theme, unless a copy was made before
    const st = await ctl.evaluate(() => ({ min: layoutTheme("minimal", STARTERS.minimal).id, wx: layoutTheme("weather", STARTERS.weather).id,
      same: STARTERS.weather.look === THEMELIB.get("builtin-weather-station").values }));
    assert.deepEqual(st, { min: "tMin", wx: "builtin-weather-station", same: true });
    console.log("✓ starter layouts bring their built-in theme; earlier copies still win");

    // New theme copies a built-in as it is
    await ctl.evaluate(() => { go("looks"); go("newlook"); });
    await ctl.locator('[data-lact="make"][data-id="builtin-light"]').click();
    await until(() => ctl.evaluate(() => looks().some(t => t.name === "Light" && t.values.accent === "#2b7de9" && t.values.textScale === 100)), "copy of Light");

    // restart: the built-in in use is still there
    await ctl.evaluate(() => { rules().length = 0; save(); });
    await until(async () => !((await cfg()).rules || []).length, "rules cleared");
    await srv.stop();
    srv = await startServer(data);
    assert.equal((await cfg()).use, "builtin-glass");
    console.log("✓ a built-in in use survives a restart");

    assert.deepEqual(errs, []);
  });
  if (!ok) process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exit(1); });
