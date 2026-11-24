// Theme text colors in Chromium, on a config from before they existed:
//   - a dark theme without the new settings looks exactly as before
//   - light themes: the Clock's date line and the Weather's details follow the theme (they used to stay light gray)
//   - Text color and Big numbers color reach every tile, but text over photos stays light
//   - the Clock's own time color wins, unless "Theme colors win over tile colors" is on
//   - the theme editor: Automatic / Pick, Same as text / Pick, the hard-to-read note, and the switch
// Needs Node, Python 3 and Playwright with Chromium. Run with: node tests/text-colors-check.js
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { until, makeDataDir, startServer, runSuite } = require("./pw-helper");

async function main() {
  const ok = await runSuite("text-colors-check", async ({ openContext, watchErrors, onCleanup }) => {
    const data = makeDataDir("textcolors", {
      setup: (dir, cfg) => {
        const L = cfg.modules.look.settings;
        L.items = [
          { id: "tOld", name: "Old", values: { accent: "#123456" } },
          { id: "tInk", name: "Ink", values: { mode: "Light", bg: "Color", bgColor: "#dce4cf", textColor: "#7a1f1f", bigColor: "#123456" } },
          { id: "tInkDark", name: "Ink dark", values: { textColor: "#7a1f1f" } },
          { id: "tWins", name: "Wins", values: { bigColor: "#123456", themeWins: true } }];
        L.rules = []; L.use = "";
        const clock = cfg.modules.tiles.settings.items.find(x => x.type === "clock");
        clock.settings.color = "#ff0000";          // a Clock with its own time color
      },
    });
    onCleanup(() => fs.rmSync(data, { recursive: true, force: true }));
    const srv = await startServer(data);
    onCleanup(() => srv.stop());

    const ctx = await openContext({ base: srv.base, viewport: { width: 1280, height: 800 }, label: "textcolors" });
    const errs = [];
    const dash = await ctx.newPage();
    watchErrors(dash, errs, { prefix: "dash" });
    const show = async theme => {
      await dash.goto(srv.base + "/dash/content" + (theme ? "?theme=" + theme : ""), { waitUntil: "load" });
      await until(() => dash.evaluate(() => !!document.querySelector(".m-clock .d") && document.querySelector(".m-clock .d").textContent.length > 0), "clock drawn");
      return dash.evaluate(() => {
        const c = s => { const e = document.querySelector(s); return e ? getComputedStyle(e).color : null; };
        const ph = document.createElement("div"); ph.className = "m-stage"; ph.innerHTML = "<span>x</span>"; document.body.appendChild(ph);
        const photo = getComputedStyle(ph.firstChild).color; ph.remove();
        return { date: c(".m-clock .d"), count: c(".m-clock .c"), time: c(".m-clock .t"), photo, tcol: document.documentElement.classList.contains("tcol"), wins: !!THEMEV.themeWins };
      });
    };

    // Everyday (dark, no new settings): as before
    let v = await show("");
    assert.equal(v.date, "rgb(213, 219, 227)");
    assert.equal(v.count, "rgb(195, 202, 211)");
    assert.equal(v.time, "rgb(255, 0, 0)", "the Clock's own time color shows");
    assert.equal(v.tcol, false);
    v = await show("tOld");
    assert.equal(v.date, "rgb(213, 219, 227)", "an older theme looks the same");
    console.log("✓ themes without the new settings look as before");

    // Kitchen table (light): the date line is dark now
    v = await show("builtin-kitchen-table");
    assert.equal(v.date, "rgb(43, 51, 61)");
    assert.equal(v.count, "rgb(74, 84, 97)");
    assert.equal(v.photo, "rgb(233, 236, 241)", "text over photos stays light");
    console.log("✓ light themes: the Clock and Weather details follow light mode");

    // a theme text color reaches the tiles; big numbers have their own; photos stay light
    v = await show("tInk");
    assert.equal(v.date, "rgba(122, 31, 31, 0.88)");
    assert.equal(v.count, "rgba(122, 31, 31, 0.8)");
    assert.equal(v.time, "rgb(255, 0, 0)", "a tile's own color wins while the switch is off");
    assert.equal(v.photo, "rgb(233, 236, 241)");
    const tile = await dash.evaluate(() => { const e = document.querySelector(".card.m-groc"); return e ? getComputedStyle(e).color : null; });
    assert.equal(tile, "rgb(122, 31, 31)", "tiles use the text color");
    v = await show("tInkDark");
    assert.equal(v.date, "rgba(122, 31, 31, 0.88)", "works on a dark theme too");
    assert.equal(v.photo, "rgb(233, 236, 241)", "text over photos stays light on a dark theme with a text color");
    console.log("✓ Text color and Big numbers color reach the tiles; text over photos stays light");

    // the switch: the theme's big numbers color wins over the Clock's own
    v = await show("tWins");
    assert.equal(v.wins, true);
    assert.equal(v.time, "rgb(18, 52, 86)");
    console.log("✓ Theme colors win over tile colors when the switch is on");

    // the theme editor
    const ctl = await ctx.newPage();
    watchErrors(ctl, errs, { prefix: "ctl", ignoreConsole: t => /reported: config: TypeError: Failed to fetch/.test(t) });
    await ctl.goto(srv.base + "/control", { waitUntil: "load" });
    await until(() => ctl.evaluate(() => typeof mods === "object" && !!mods.look), "Controls loaded");
    await ctl.evaluate(() => { go("looks"); go("theme:tOld"); go("look:tOld"); });
    await ctl.locator('[data-lk="textColor"][data-lv=""].on').waitFor();
    assert.equal(await ctl.locator('input[type=color][data-lk="textColor"]').count(), 0, "no picker while Automatic");
    await ctl.locator('[data-lk="textColor"][data-lv]:not([data-lv=""])').click();
    await ctl.locator('input[type=color][data-lk="textColor"]').waitFor();
    assert.equal(await ctl.evaluate(() => DRAFT.values.textColor), "#e9ecf1", "Pick starts from the automatic color");
    assert.equal(await ctl.locator(".lnote.warn").count(), 0);
    await ctl.evaluate(() => { lookSet("tOld", "mode", "Light"); show(); });
    assert.equal(await ctl.evaluate(() => DRAFT.values.textColor), "#e9ecf1", "switching to Light keeps a picked text color");
    await ctl.locator(".lnote.warn").waitFor();
    await ctl.locator('[data-lk="themeWins"]').click();
    assert.equal(await ctl.evaluate(() => DRAFT.values.themeWins), true);
    await ctl.locator('[data-lk="textColor"][data-lv=""]').click();
    assert.equal(await ctl.evaluate(() => DRAFT.values.textColor), "");
    await ctl.locator('[data-lact="save"]').click();
    await until(async () => { const c = (await (await fetch(srv.base + "/config")).json()).modules.look.settings;
      const t = c.items.find(x => x.id === "tOld"); return t.values.themeWins === true && t.values.textColor === "" && t.values.mode === "Light"; }, "saved");
    console.log("✓ the theme editor: Automatic or Pick, the hard-to-read note, and the switch");

    assert.deepEqual(errs, []);
  });
  if (!ok) process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exit(1); });
