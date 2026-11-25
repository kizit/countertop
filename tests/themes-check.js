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
    // a new theme setting must be added to the built-ins too, with the same default as Everyday's
    const keys = await ctl.evaluate(() => LOOK_KEYS.filter(k => !(k in THEMELIB.BASE) || JSON.stringify(schema.look.settings[k].default) !== JSON.stringify(THEMELIB.BASE[k])));
    assert.deepEqual(keys, [], "every theme setting is in THEMELIB.BASE with the schema's default");

    // built-ins are complete: Everyday's red accent and bigger text don't leak in
    const glass = await ctl.evaluate(() => lookVals("builtin-glass"));
    assert.equal(glass.accent, "#7cb7ff");
    assert.equal(glass.textScale, 100);
    assert.equal(glass.tiles, "See-through");

    // Themes shows every built-in; opening one saves nothing and offers no Delete or Share
    await ctl.evaluate(() => go("looks"));
    const classicIds = await ctl.evaluate(() => THEMELIB.L.filter(t => t.classic).map(t => t.id));
    assert.ok(classicIds.length > 0 && classicIds.length < before.ids.length, "some built-ins are classic");
    assert.ok(!classicIds.includes("builtin-dark") && !classicIds.includes("builtin-light"), "Dark and Light stay visible");
    const shown = before.ids.length - classicIds.length;
    await until(() => ctl.locator('[data-go^="theme:builtin-"]').count().then(c => c === shown), "only non-classic built-ins on Themes");
    assert.equal(await ctl.locator('[data-go="theme:builtin-glass"]').count(), 0, "a classic theme is hidden by default");
    // the toggle reveals them all, and hides them again
    await ctl.locator('[data-lact="classic"]').click();
    await until(() => ctl.locator('[data-go^="theme:builtin-"]').count().then(c => c === before.ids.length), "Show classic themes lists every built-in");
    await ctl.locator('[data-lact="classic"]').click();
    await until(() => ctl.locator('[data-go^="theme:builtin-"]').count().then(c => c === shown), "Hide classic themes");
    // a classic theme stays resolvable by id even while hidden
    await ctl.evaluate(() => go("theme:builtin-glass"));
    await ctl.locator('[data-lact="use"]').waitFor();
    assert.equal(await ctl.locator('[data-lact="del"], [data-go^="share:"]').count(), 0, "no Delete or Share on a built-in");
    assert.equal(await ctl.evaluate(() => looks().length), 2, "opening a built-in made a copy");
    console.log("✓ built-ins are listed, complete, and opening one saves nothing");

    // Use this theme with a built-in: saved as its id, no copy
    await ctl.locator('[data-lact="use"]').click();
    await until(async () => (await cfg()).use === "builtin-glass", "use saved as the built-in id");
    assert.equal((await cfg()).items.length, 2);
    // Library → Effects: Turn all off / Turn all on change every effect toggle and save
    await ctl.evaluate(() => go("effects"));
    await ctl.locator('[data-lact="fxall"][data-id="off"]').click();
    await until(() => ctl.evaluate(() => FXLIB.L.every(d => !fxC(d.id).on)), "Turn all off");
    assert.equal(await ctl.locator('.fxc[data-go]:not(.off)').count(), 0, "every effect card shows off");
    await ctl.locator('[data-lact="fxall"][data-id="on"]').click();
    await until(() => ctl.evaluate(() => FXLIB.L.every(d => fxC(d.id).on)), "Turn all on");
    await ctl.locator('[data-lact="fxall"][data-id="off"]').click();
    await ctl.locator('[data-fxon]').first().click();
    await until(() => ctl.evaluate(() => FXLIB.L.filter(d => fxC(d.id).on).length === 1), "turn one back on after all off");
    // a classic theme that is in use is listed even though classics are hidden
    await ctl.evaluate(() => go("looks"));
    await until(() => ctl.locator('[data-go="theme:builtin-glass"]').count().then(c => c === 1), "a classic theme in use stays listed");
    assert.equal(await ctl.locator('[data-go="theme:builtin-atmospheric"]').count(), 0, "other classic themes stay hidden");

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

    // Customize on a built-in opens an unsaved draft: Cancel leaves nothing behind
    await ctl.evaluate(() => { go("looks"); go("theme:builtin-glass"); });
    await ctl.locator('.saverow [data-lact="new"]').click();
    await ctl.locator('select[data-lfrom]').waitFor();
    assert.equal(await ctl.evaluate(() => looks().length), 3 - 1, "Customize saved a copy before Save");
    await ctl.locator('[data-lact="cancel"]').click();
    await until(() => ctl.evaluate(() => stack[stack.length - 1] === "theme:builtin-glass" && DRAFT === null), "Cancel goes back with no draft");
    assert.equal(await ctl.evaluate(() => looks().length), 2);
    console.log("✓ Customize on a built-in is a draft, and Cancel keeps nothing");

    // New theme: start from Light, name it, Save & use
    await ctl.evaluate(() => go("looks"));
    await ctl.locator('.lcard[data-lact="new"]').click();
    await ctl.locator('input[data-lk="__name"]').fill("Sunny");
    await ctl.locator('input[data-lk="__name"]').dispatchEvent("change");
    await ctl.locator('select[data-lfrom]').selectOption("builtin-light");
    assert.equal(await ctl.locator('input[data-lk="__name"]').inputValue(), "Sunny", "a typed name stays when Start from changes");
    await ctl.locator('[data-lact="saveuse"]').click();
    await until(async () => { const c = await cfg(); const t = c.items.find(x => x.name === "Sunny"); return t && c.use === t.id && t.values.accent === "#2b7de9" && t.values.textScale === 100; }, "Sunny saved from Light and in use");
    assert.match(await ctl.evaluate(() => stack[stack.length - 1]), /^theme:t/);
    console.log("✓ New theme starts from any theme, and Save & use saves and uses it");

    // with a schedule showing another theme, Use this theme says when it will show
    const msg = await ctl.evaluate(() => { rules().push({ id: "rnow", on: true, look: "builtin-calm-evening", when: {} }); return useText("tOld"); });
    assert.match(msg, /^Old will show when Calm evening's scheduled time ends$/);
    await ctl.evaluate(() => { LS().use = "builtin-glass"; rules().length = 0; save(); });

    // restart: the built-in in use is still there
    await until(async () => { const c = await cfg(); return !(c.rules || []).length && c.use === "builtin-glass"; }, "rules cleared");
    await srv.stop();
    srv = await startServer(data);
    assert.equal((await cfg()).use, "builtin-glass");
    console.log("✓ a built-in in use survives a restart");

    assert.deepEqual(errs, []);
  });
  if (!ok) process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exit(1); });
