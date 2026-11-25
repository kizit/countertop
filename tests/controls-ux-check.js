// Controls, Library, Phone list and Night-mode UI/UX journeys end to end in Chromium:
//   - First-run Setup Guide walkthrough (location search, calendar, list, starter, finish)
//   - Controls → Lists + phone /list touch flow (comma-separated add, toggle, delete, clear, dirty note, readonly)
//   - Theme customize & New Custom Effect: emoji preview redraw + typing then immediate tap Save (regressions b732808, ff7b5f3)
//   - Library → Add tile on a page with room vs a full page (regression ada87d5)
//   - Share → Import round-trip verifying share:false, sources and Home Assistant lock/rename settings stay out
//   - Community Download → Update (preserving active theme, schedule rules & effect config) → Revoked → Remove
//   - Night page takeover, touch-to-peek and automatic return after 60 s (deterministic page.clock)
//   - Touch-target reachability audit on Echo Controls (/control?echo=1) and phone /list
// Needs Node, Python 3 and Playwright with Chromium. Run with: node tests/controls-ux-check.js
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
const {
  sleep, until, makeDataDir, startServer, runSuite, touchSession,
} = require("./pw-helper");

async function main() {
  await runSuite("controls-ux-check", async ({ openContext, watchErrors, onCleanup }) => {
    // 1. First-run Setup Guide walkthrough (fresh install, no lat/lon, setupDone: false)
    const wizData = makeDataDir("ux-wiz", { empty: true });
    onCleanup(() => fs.rmSync(wizData, { recursive: true, force: true }));
    const wizSrv = await startServer(wizData);
    onCleanup(() => wizSrv.stop());

    const wizCtx = await openContext({ base: wizSrv.base, viewport: { width: 1280, height: 900 }, useFixtures: false, interceptReports: true, label: "setup-guide" });
    await wizCtx.route("https://geocoding-api.open-meteo.com/**", r => r.fulfill({
      json: { results: [{ name: "Denver", admin1: "Colorado", country: "United States", latitude: 39.7392, longitude: -104.9903 }] },
    }));
    const wizErrs = [];
    const wp = await wizCtx.newPage();
    watchErrors(wp, wizErrs, {
      prefix: "wiz",
      ignoreConsole: t => /reported: config: TypeError: Failed to fetch/.test(t),
    });
    await wp.goto(wizSrv.base + "/control", { waitUntil: "load" });
    await wp.locator('[data-act="wiznext"]').waitFor();
    await wp.locator('[data-act="wiznext"]').click(); // Welcome -> Location
    await wp.locator('[data-act="locate"]').click();
    await wp.locator("#locq").fill("Denver");
    await wp.locator('[data-loc]').first().waitFor();
    await wp.locator('[data-loc]').first().click();
    await until(() => wp.locator(".big").textContent().then(t => /Where are you/.test(t) && true), "location picked");
    await wp.locator('[data-act="wiznext"]').click(); // Location -> Calendar
    await wp.locator("#wcname").fill("Family");
    await wp.locator("#wcurl").fill("https://example.invalid/family.ics");
    await wp.locator('[data-act="wizcal"]').click();
    await until(() => wp.locator("text=Family").first().isVisible(), "calendar added");
    await wp.locator('[data-act="wiznext"]').click(); // Calendar -> Grocery list
    await wp.locator('[data-act="wizlist"]').click(); // Grocery list -> Dashboard
    await wp.locator('[data-act="wiznext"]').click(); // Dashboard -> All set
    await wp.locator('[data-act="wizdone"]').click(); // Finish
    await until(() => wp.evaluate(() => stack[stack.length - 1] === "root"), "return to root");
    const savedWiz = await until(async () => {
      const j = await (await fetch(wizSrv.base + "/config")).json();
      return j.modules.general.settings.setupDone ? j : false;
    }, "Setup Guide to save setupDone");
    assert.equal(savedWiz.modules.general.settings.place, "Denver");
    assert.equal(savedWiz.sources.calendars.length, 1);
    assert.equal(savedWiz.sources.calendars[0].name, "Family");
    assert.deepEqual(wizErrs, []);
    await wizCtx.close();
    console.log("✓ first-run Setup Guide saves location, calendar, list and marks setup done");

    // 2. Main Controls, Library, Community, Lists & Share/Import suite
    const galleryFile = path.join(wizData, "ux-gallery.json");
    const writeGallery = (ver = 1, revoked = [], accent = "#ff9f5a") => fs.writeFileSync(galleryFile, JSON.stringify({
      countertop: "gallery", format: 1, updated: "2026-11-23", revoked,
      items: [
        {
          id: "themes/calm", kind: "theme", name: "Calm", description: "Warm evening look", author: "tester", version: ver, updated: "2026-11-23",
          item: { countertop: "theme", format: 1, name: "Calm", values: { accent, tiles: "See-through" } },
        },
        {
          id: "effects/hearts", kind: "effect", name: "Hearts", description: "Floating hearts", author: "tester", version: ver, updated: "2026-11-23",
          item: { countertop: "effect", format: 1, name: "Hearts", effect: { glyphs: ver === 1 ? ["💕"] : ["💖", "✨"], motion: "rise", size: "Medium", speed: "Normal" } },
        },
      ],
    }));
    writeGallery(1);

    const data = makeDataDir("ux-main", {
      setup(dir, cfg) {
        const m = cfg.modules;
        // Add a full page (48x32) and a roomy page for Library -> Add tile tests
        m.tiles.settings.items.push(
          { id: "full_n", type: "note", settings: { text: ["Secret Wi-Fi pass"] } },
          { id: "share_cd", type: "countdown", settings: { dates: ["Secret trip, 2099-05-01"] } },
          { id: "share_img", type: "image", settings: { url: "https://private.invalid/cam.jpg" } },
          { id: "share_ha", type: "ha", settings: { src: "ha1", entities: ["lock.front_door"], secure: true, confirm: "One tap", names: "lock.front_door = My Front Door" } },
        );
        const main = m.pages.settings.items.find(p => p.id === "main");
        main.slots = [
          { id: "ms1", x: 0, y: 0, w: 12, h: 8, mod: "full_n" },
          { id: "ms2", x: 12, y: 0, w: 12, h: 8, mod: "share_cd" },
          { id: "ms3", x: 24, y: 0, w: 12, h: 8, mod: "share_img" },
          { id: "ms4", x: 0, y: 8, w: 16, h: 12, mod: "share_ha" },
        ];
        m.pages.settings.items.push(
          { id: "roomy", name: "Roomy", on: true, cols: 48, slots: [] },
          { id: "packed", name: "Packed", on: true, cols: 48, slots: [{ id: "pk1", x: 0, y: 0, w: 48, h: 32, mod: "full_n" }] },
        );
      },
    });
    onCleanup(() => fs.rmSync(data, { recursive: true, force: true }));
    const srv = await startServer(data, { COUNTERTOP_GALLERY_URL: pathToFileURL(galleryFile).href });
    onCleanup(() => srv.stop());

    // 2a. Controls (touch-enabled) — Theme customize & New Effect focus->immediate tap + emoji redraw
    const ctlCtx = await openContext({ base: srv.base, viewport: { width: 1280, height: 900 }, hasTouch: true, useFixtures: true, realSaves: true, interceptReports: true, label: "controls-ux" });
    const ctlErrs = [];
    const ctl = await ctlCtx.newPage();
    watchErrors(ctl, ctlErrs, {
      prefix: "ctl",
      // libClose() navigates the live preview iframe to about:blank, which can abort its in-flight /config fetch
      ignoreConsole: t => /reported: config: TypeError: Failed to fetch/.test(t),
    });
    const T = await touchSession(ctlCtx, ctl);
    await ctl.goto(srv.base + "/control", { waitUntil: "load" });
    await until(() => ctl.evaluate(() => typeof mods === "object" && !!mods.look), "Controls loaded");

    // Theme customize: type a name and immediately tap Save without blurring first (regression b732808)
    await ctl.evaluate(() => go("looks"));
    await ctl.locator('.lcard[data-lact="new"]').click();
    const themeInp = ctl.locator('input[data-lk="__name"]');
    await themeInp.waitFor();
    await themeInp.fill("Cozy Dusk");
    // Tap Save right away while input is still focused
    await T.tap(...await T.centre(ctl.locator('[data-lact="save"]')));
    await until(() => ctl.evaluate(() => looks().some(t => t.name === "Cozy Dusk")), "theme saved on first tap after typing");
    console.log("✓ typing a theme name and tapping Save immediately saves on the first tap");

    // Theme editor: tapping an option redraws the screen for the preview but keeps the scroll position and the tab (Library, where Themes live)
    await ctl.evaluate(() => { libOpen("themes"); LIB.sub.push("look:new"); draftNew(""); LTAB = "surface"; libShow(); });
    await ctl.waitForSelector('#lib .ltabs button.on');
    const lastOpt = ctl.locator('#lib [data-lk][data-lv]:not(.on)').last();
    await lastOpt.scrollIntoViewIfNeeded();
    const scrolled = await ctl.evaluate(() => { const b = document.querySelector("#lib .lmain"); return Math.max(b.scrollTop, scrollY); });
    console.log("  scrolled to", scrolled);
    await lastOpt.click();
    await sleep(1500);
    const after = await ctl.evaluate(() => ({ top: Math.max(document.querySelector("#lib .lmain").scrollTop, scrollY), tab: document.querySelector("#lib .ltabs button.on").dataset.id }));
    assert.equal(after.top, scrolled, "theme editor jumped after tapping an option");
    assert.equal(after.tab, "surface", "theme editor changed tab after tapping an option");
    await ctl.evaluate(() => libClose());
    console.log("✓ tapping a theme option keeps the scroll position and tab");

    // The same on Controls' own theme editor screen (page scroll), as used without the Library
    await ctl.evaluate(() => { stack = ["root", "looks"]; show(); draftNew(""); LTAB = "type"; go("look:new"); });
    await ctl.waitForSelector('#screen .ltabs button.on');
    const lastC = ctl.locator('#screen [data-lk][data-lv]:not(.on)').last();
    await lastC.scrollIntoViewIfNeeded();
    const pageTop = await ctl.evaluate(() => scrollY);
    console.log("  page scrolled to", pageTop);
    assert.ok(pageTop > 0, "Controls theme editor not scrollable in test");
    await lastC.click();
    await sleep(1500);
    const pageAfter = await ctl.evaluate(() => ({ y: scrollY, tab: document.querySelector("#screen .ltabs button.on").dataset.id }));
    assert.equal(pageAfter.y, pageTop, "Controls theme editor jumped after tapping an option");
    assert.equal(pageAfter.tab, "type");
    await ctl.evaluate(() => { DRAFT = null; stack = ["root"]; show(); });
    console.log("✓ tapping an option on Controls' theme editor keeps the page position");

    // Opening Theme or Effects from Controls' home renders the live preview, also the second time after closing the Library
    for (const [row, label] of [["themes", "Theme"], ["effects", "Effects"], ["themes", "Theme (again)"]]) {
      await ctl.evaluate(() => { stack = ["root"]; show(); });
      await ctl.locator('[data-act="lib"][data-id="' + row + '"]').click();
      await until(() => ctl.evaluate(() => { const f = document.getElementById("libpv"); return !!f && /\/dash\/content\?preview=1/.test(f.getAttribute("src") || "") && f.classList.contains("on"); }), label + " preview rendered", 15000);
      await ctl.evaluate(() => { libClose(); show(); });
    }
    console.log("✓ Theme and Effects opened from Controls' home show the live preview, every time");

    // New custom effect: change emoji -> preview canvas redraws (ff7b5f3) + immediate tap Save (b732808)
    await ctl.evaluate(() => { stack = ["root", "effects"]; show(); });
    await ctl.locator('[data-fxa="new"]').click();
    await ctl.locator('input[data-fxd="name"]').fill("Autumn Leaves");
    const canvasBefore = await ctl.evaluate(() => document.querySelector(".fxc.big canvas").toDataURL());
    const emoInp = ctl.locator('input[data-fxd="glyphs"]');
    await emoInp.fill("🍂 🎃");
    // Change event fires on blur when Save is tapped, and preview updates before/during save
    await emoInp.dispatchEvent("change");
    const fxCheck = await ctl.evaluate(() => ({
      draftGlyphs: FXDRAFT && FXDRAFT.glyphs,
      libDesc: FXDRAFT && FXLIB.BY[FXDRAFT.id] && FXLIB.BY[FXDRAFT.id].desc,
      shown: document.querySelector('input[data-fxd="glyphs"]').previousElementSibling.querySelector("b").textContent,
      canvasAfter: document.querySelector(".fxc.big canvas").toDataURL(),
    }));
    assert.deepEqual(fxCheck.draftGlyphs, ["🍂", "🎃"]);
    assert.match(fxCheck.libDesc, /🍂 🎃/, "effect preview library didn't receive new emoji");
    assert.equal(fxCheck.shown, "🍂 🎃");
    assert.notEqual(fxCheck.canvasAfter, canvasBefore, "New effect preview canvas didn't redraw when emoji changed");
    // Now type name again and tap Save directly while focused
    await ctl.locator('input[data-fxd="name"]').fill("Fall Party");
    await T.tap(...await T.centre(ctl.locator('[data-fxa="save"]')));
    await until(() => ctl.evaluate(() => mineList().some(m => m.name === "Fall Party" && m.glyphs.join(" ") === "🍂 🎃")),
      "custom effect saved on first tap after typing");
    console.log("✓ New effect updates emoji preview and saves on the first tap after typing");

    // 2b. Library -> Add tile on roomy page vs full page (regression ada87d5)
    await ctl.evaluate(() => libOpen("tiles"));
    await until(() => ctl.locator('#lib [data-l="addtile"]').count().then(c => c > 5), "Library tiles loaded");
    // every toast is kept: the theme's own "Saved" can arrive right after and cover the warning
    await ctl.evaluate(() => { window.__toasts = []; new MutationObserver(() => window.__toasts.push(document.querySelector("#toast").textContent))
      .observe(document.querySelector("#toast"), { childList: true, subtree: true, characterData: true }); });
    await ctl.evaluate(() => libAddTile("clock", "packed"));
    await until(() => ctl.evaluate(() => window.__toasts.some(t => /is full/.test(t))), "full-page warning toast");
    const packedCount = await ctl.evaluate(() => gpAll().find(p => p.id === "packed").slots.length);
    assert.equal(packedCount, 1, "full page should not gain a box");
    await ctl.evaluate(() => libAddTile("clock", "roomy"));
    await until(() => ctl.evaluate(() => gpAll().find(p => p.id === "roomy").slots.length === 1), "tile added to roomy page");
    console.log("✓ Library Add tile refuses a full page cleanly and adds to a page with room");

    // 2c. Share -> Import round-trip: verify share:false, sources & HA lock/rename settings stay out
    await ctl.evaluate(() => { LIB.shareOf = "main"; libOpen("share"); });
    await ctl.locator('#lib [data-l="codebox"]').waitFor();
    const shareCode = await ctl.locator('#lib [data-l="codebox"]').inputValue();
    assert.match(shareCode, /^CT1\./);
    const decoded = await ctl.evaluate(code => libParse(code), shareCode);
    const rawJson = JSON.stringify(decoded);
    for (const secret of ["Secret Wi-Fi pass", "Secret trip", "private.invalid", "lock.front_door", "My Front Door", "One tap"]) {
      assert.ok(!rawJson.includes(secret), "shared layout leaked personal/sensitive value: " + secret);
    }
    const haExported = decoded.pages[0].boxes.flatMap(b => b.tiles).find(t => t.type === "ha");
    assert.ok(haExported, "HA tile missing from shared layout");
    assert.equal(haExported.settings.secure, undefined, "HA secure flag must not be exported");
    assert.equal(haExported.settings.confirm, undefined, "HA confirm setting must not be exported");
    assert.equal(haExported.settings.names, undefined, "HA names must not be exported");
    // Now paste into Import a file: bad text shows error, valid code opens preview
    await ctl.evaluate(() => libGo("import"));
    await ctl.locator('#lib [data-l="paste"]').fill("not-a-valid-code");
    await ctl.locator('#lib [data-l="openpaste"]').click();
    await until(() => ctl.locator("#lib").textContent().then(t => /isn't a Countertop/.test(t)), "bad import error");
    await ctl.locator('#lib [data-l="paste"]').fill(shareCode);
    await ctl.locator('#lib [data-l="openpaste"]').click();
    await until(() => ctl.evaluate(() => !!LIB.imp && LIB.item === "import"), "shared layout opened in Import");
    console.log("✓ Share → Import strips share:false, sources, and HA lock/rename settings, and rejects bad input");

    // 2d. Community: Download -> Update (keeping active theme, schedule rule & effect settings) -> Revoked -> Remove
    await ctl.evaluate(() => libGo("community"));
    await until(() => ctl.locator('#lib .lc[data-id="themes/calm"]').isVisible(), "community theme card");
    await ctl.locator('#lib .lc[data-id="themes/calm"]').click();
    await ctl.locator('#lib [data-l="c-dl"]').click();
    await until(() => ctl.evaluate(() => looks().some(t => t.gallery && t.gallery.id === "themes/calm")), "theme downloaded");
    await ctl.locator('#lib [data-l="c-back"]').click();
    await ctl.locator('#lib .lc[data-id="effects/hearts"]').click();
    await ctl.locator('#lib [data-l="c-dl"]').click();
    await until(() => ctl.evaluate(() => mineList().some(m => m.gallery && m.gallery.id === "effects/hearts")), "effect downloaded");

    // Put the downloaded theme in use, attach a schedule rule, and give the effect custom settings
    const oldIds = await ctl.evaluate(() => {
      const th = looks().find(t => t.gallery && t.gallery.id === "themes/calm");
      const fx = mineList().find(m => m.gallery && m.gallery.id === "effects/hearts");
      LS().use = th.id;
      rules().push({ id: "rcalm", on: true, look: th.id, when: { from: "18:00", to: "22:00" } });
      fxItemsC().push({ id: fx.id, on: true, amount: "Lots" });
      save();
      return { th: th.id, fx: fx.id };
    });

    // Ship v2 in the gallery, refresh, and update both
    writeGallery(2, [], "#22cc88");
    await ctl.locator('#lib [data-l="c-back"]').click();
    await ctl.locator('#lib [data-l="c-refresh"]').click();
    await until(() => ctl.locator('#lib .lbadge.up').count().then(c => c === 2), "two update badges");
    await ctl.locator('#lib .lc[data-id="themes/calm"]').click();
    await ctl.locator('#lib [data-l="c-up"]').click();
    await until(() => ctl.evaluate(() => {
      const th = looks().find(t => t.gallery && t.gallery.id === "themes/calm");
      return th && th.gallery.v === 2;
    }), "theme updated to v2");
    await ctl.locator('#lib [data-l="c-back"]').click();
    await ctl.locator('#lib .lc[data-id="effects/hearts"]').click();
    await ctl.locator('#lib [data-l="c-up"]').click();
    await until(() => ctl.evaluate(() => {
      const fx = mineList().find(m => m.gallery && m.gallery.id === "effects/hearts");
      return fx && fx.gallery.v === 2;
    }), "effect updated to v2");

    const updated = await ctl.evaluate(() => {
      const th = looks().find(t => t.gallery && t.gallery.id === "themes/calm");
      const fx = mineList().find(m => m.gallery && m.gallery.id === "effects/hearts");
      const rule = rules().find(r => r.id === "rcalm");
      const fxc = fxItemsC().find(x => x.id === fx.id);
      return {
        useMatch: LS().use === th.id,
        ruleMatch: rule && rule.look === th.id,
        accent: th.values.accent,
        fxAmount: fxc && fxc.amount,
        fxGlyphs: fx.glyphs,
      };
    });
    assert.equal(updated.useMatch, true, "Update lost active theme selection");
    assert.equal(updated.ruleMatch, true, "Update broke schedule rule reference");
    assert.equal(updated.accent, "#22cc88");
    assert.equal(updated.fxAmount, "Lots", "Update lost effect user settings");
    assert.deepEqual(updated.fxGlyphs, ["💖", "✨"]);
    assert.ok(oldIds.th && oldIds.fx);

    // Revoke themes/calm -> shows "taken down" warning, then remove cleanly
    writeGallery(2, ["themes/calm"], "#22cc88");
    await ctl.locator('#lib [data-l="c-back"]').click();
    await ctl.locator('#lib [data-l="c-refresh"]').click();
    await until(() => ctl.locator("#lib").textContent().then(t => /was taken down from the gallery/.test(t)), "taken down banner");
    await ctl.locator('#lib [data-l="c-open"][data-id="themes/calm"]').first().click();
    await ctl.locator('#lib [data-l="c-rm"]').click();
    await ctl.locator('#lib [data-l="c-rm"]').click();
    await until(() => ctl.evaluate(() => !looks().some(t => t.gallery && t.gallery.id === "themes/calm")), "revoked theme removed");
    console.log("✓ Community Download → Update (preserving active theme, rule & effect config) → Revoked → Remove");

    // 2e. Controls -> Lists UI (add, toggle, delete, reset)
    await ctl.evaluate(() => { libClose(); stack = ["root", "src:lists", "srci:lists:groc"]; show(); });
    await ctl.locator("#lladd").waitFor();
    await ctl.locator("#lladd").fill("Avocados");
    await ctl.locator('[data-ladd]').click();
    await until(() => ctl.locator("#llitems").textContent().then(t => /Avocados/.test(t)), "Avocados added in Controls");
    await ctl.locator('#llitems [data-litog]').first().click();
    await until(() => ctl.locator("#llcount").textContent().then(t => /1 \/ 1 done/.test(t)), "Avocados toggled done");
    await ctl.locator('[data-llop="reset"]').click();
    await until(() => ctl.locator("#llcount").textContent().then(t => /0 \/ 1 done/.test(t)), "ticks reset");
    await ctl.locator('#llitems [data-lidel]').first().click();
    await until(() => ctl.locator("#llitems").textContent().then(t => /Nothing on the list/.test(t)), "Avocados deleted");
    assert.deepEqual(ctlErrs, []);
    await ctlCtx.close();
    console.log("✓ Controls → Lists adds, ticks, resets and deletes items");

    // 3. Phone list (/list) at mobile viewport (390x844, touch) + dirty note + readonly + touch-target audit
    const mobCtx = await openContext({ base: srv.base, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, label: "phone-list" });
    const mobErrs = [];
    const mob = await mobCtx.newPage();
    watchErrors(mob, mobErrs, { prefix: "list" });
    const MT = await touchSession(mobCtx, mob);
    await mob.goto(srv.base + "/list", { waitUntil: "load" });
    await until(() => mob.locator("#items").textContent().then(t => /Nothing on the list/.test(t)), "empty phone list");

    // Touch-target size & viewport reachability audit on phone /list
    const mobButtons = await mob.evaluate(() => [...document.querySelectorAll("button, input, textarea")]
      .filter(el => el.offsetParent !== null)
      .map(el => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { tag: el.tagName, id: el.id, w: r.width, h: r.height, x: r.x, right: r.right, reachable: !!(hit && (el === hit || el.contains(hit))) };
      }));
    for (const b of mobButtons) {
      assert.ok(b.h >= 38, "phone control too short for touch: " + JSON.stringify(b));
      assert.ok(b.x >= 0 && b.right <= 390 + 2, "phone control overflows viewport: " + JSON.stringify(b));
      assert.ok(b.reachable, "phone control covered by another element: " + JSON.stringify(b));
    }

    // Comma-separated add -> toggle -> delete -> clear checked
    await mob.locator("#item").fill("Milk, Eggs, Bread");
    await MT.tap(...await MT.centre(mob.locator("#add button")));
    await until(() => mob.locator("#items li[data-id]").count().then(c => c === 3), "3 items added");
    await MT.tap(...await MT.centre(mob.locator('#items li', { hasText: "Milk" }).locator(".tx")));
    await until(() => mob.locator('#items li.done', { hasText: "Milk" }).count().then(c => c === 1), "Milk ticked");
    await MT.tap(...await MT.centre(mob.locator('#items li', { hasText: "Eggs" }).locator("[data-del]")));
    await until(() => mob.locator("#items li[data-id]").count().then(c => c === 2), "Eggs deleted");
    await MT.tap(...await MT.centre(mob.locator("#clear")));
    await until(() => mob.locator("#items li[data-id]").count().then(c => c === 1), "checked cleared");
    assert.match(await mob.locator("#items li").first().innerText(), /Bread/);

    // Dirty note survives background poll, then saves & persists across reload
    await mob.locator("#note").fill("Dog has been fed");
    await mob.evaluate(() => call()); // simulate 10 s background poll while user is typing
    await sleep(300);
    assert.equal(await mob.locator("#note").inputValue(), "Dog has been fed", "poll clobbered unsaved note");
    await MT.tap(...await MT.centre(mob.locator("#savenote")));
    await sleep(300);
    await mob.reload({ waitUntil: "load" });
    await until(() => mob.locator("#note").inputValue().then(v => v === "Dog has been fed"), "note persisted after reload");

    // Readonly mode when backed by a pushed list
    await fetch(srv.base + "/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "lists", op: "update", item: { id: "groc", name: "Grocery", kind: "Sent from another app" } }),
    });
    await mob.reload({ waitUntil: "load" });
    await until(() => mob.locator("#add").evaluate(e => e.hidden), "readonly hides Add form");
    assert.equal(await mob.locator("#clear").evaluate(e => e.hidden), true);
    assert.deepEqual(mobErrs, []);
    await mobCtx.close();
    console.log("✓ phone /list touch flow, dirty-note protection, readonly mode & touch targets");

    // 4. Touch-target reachability audit on Echo Controls (/control?echo=1)
    const echoCtx = await openContext({ base: srv.base, viewport: { width: 1920, height: 1080 }, hasTouch: true, useFixtures: true, label: "echo-controls" });
    const echoErrs = [];
    const ep = await echoCtx.newPage();
    watchErrors(ep, echoErrs, { prefix: "echo-ctl" });
    await ep.goto(srv.base + "/control?echo=1", { waitUntil: "load" });
    await ep.locator("#done").waitFor();
    const echoTargets = await ep.evaluate(() => [...document.querySelectorAll("#done, [data-act='echoedit'], .row[data-go]")]
      .filter(el => el.offsetParent !== null)
      .slice(0, 10)
      .map(el => {
        const r = el.getBoundingClientRect();
        const inView = r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
        const hit = inView ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
        return { text: el.innerText.trim().slice(0, 30), w: r.width, h: r.height, inView, reachable: !inView || !!(hit && (el === hit || el.contains(hit))) };
      }));
    assert.ok(echoTargets.filter(t => t.inView).length >= 4, "expected at least 4 visible interactive targets on Echo Controls");
    for (const t of echoTargets) {
      assert.ok(t.h >= 36, "Echo control too small for touch: " + JSON.stringify(t));
      assert.ok(t.reachable, "Echo control covered: " + JSON.stringify(t));
    }
    // On the Echo itself the theme editor is a full screen in the Library: tapping an option keeps the scroll position and tab
    await ep.evaluate(() => { libOpen("themes"); LIB.sub.push("look:new"); draftNew(""); LTAB = "surface"; libShow(); });
    await ep.waitForSelector('#lib .ltabs button.on');
    const eLast = ep.locator('#lib [data-lk][data-lv]:not(.on)').last();
    await eLast.scrollIntoViewIfNeeded();
    const eTop = await ep.evaluate(() => Math.max(document.querySelector("#lib .lmain").scrollTop, scrollY));
    assert.ok(eTop > 0, "Echo theme editor not scrollable in test");
    await eLast.click();
    await sleep(500);
    const eAfter = await ep.evaluate(() => ({ top: Math.max(document.querySelector("#lib .lmain").scrollTop, scrollY), tab: document.querySelector("#lib .ltabs button.on").dataset.id }));
    assert.equal(eAfter.top, eTop, "Echo theme editor jumped after tapping an option");
    assert.equal(eAfter.tab, "surface");
    console.log("✓ tapping a theme option on the Echo keeps the scroll position");
    assert.deepEqual(echoErrs, []);
    await echoCtx.close();
    console.log("✓ Echo Controls (/control?echo=1) touch targets are sized and reachable");

    // 5. Night page takeover, touch-to-peek and return after 60 s (using Playwright page.clock)
    const nightData = makeDataDir("ux-night", {
      keepNight: true,
      setup(dir, cfg) {
        cfg.modules.night.on = true;
        cfg.modules.night.settings.start = 22;
        cfg.modules.night.settings.end = 7;
      },
    });
    onCleanup(() => fs.rmSync(nightData, { recursive: true, force: true }));
    const nightSrv = await startServer(nightData);
    onCleanup(() => nightSrv.stop());

    const nightCtx = await openContext({ base: nightSrv.base, viewport: { width: 1920, height: 1080 }, hasTouch: true, useFixtures: true, label: "night-mode" });
    const nightErrs = [];
    const np = await nightCtx.newPage();
    watchErrors(np, nightErrs, { prefix: "night" });
    await np.clock.install({ time: new Date(2026, 10, 23, 23, 0, 0) }); // 23:00 local time
    const NT = await touchSession(nightCtx, np);
    await np.goto(nightSrv.base + "/dash/content", { waitUntil: "load" });
    await until(async () => {
      await np.clock.runFor(1100);
      return np.evaluate(() => document.body.classList.contains("night") && pageList()[PAGE] === "night");
    }, "night page takeover");
    const dimOp = await np.evaluate(() => parseFloat(document.getElementById("dimmer").style.opacity));
    assert.ok(dimOp > 0.1, "night dimmer should be active, got opacity=" + dimOp);

    // Touch screen -> peeks at main page
    await NT.tap(960, 540);
    await until(async () => {
      await np.clock.runFor(1100);
      return np.evaluate(() => document.body.classList.contains("peek") && !document.body.classList.contains("night") && pageList()[PAGE] === "main");
    }, "touch-to-peek waking main page");

    // 65 s later -> returns to night page automatically
    await np.clock.fastForward(65000);
    await until(async () => {
      await np.clock.runFor(1100);
      return np.evaluate(() => document.body.classList.contains("night") && pageList()[PAGE] === "night");
    }, "automatic return to night page after peek");
    assert.deepEqual(nightErrs, []);
    await nightCtx.close();
    console.log("✓ Night page takes over at night, wakes on touch-to-peek, and returns after 60 s");

    // 6. Desktop mode (Playwright without hasTouch): detection, overrides, tighter CSS, wheel scrolling, right-click/⋯ menus, keyboard shortcuts & editor
    // 6a. Silk / Echo user agent always stays in touch mode, even without hasTouch or with ?input=desktop
    const silkCtx = await openContext({
      base: srv.base, viewport: { width: 1280, height: 800 }, hasTouch: false, useFixtures: true,
      userAgent: "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Silk/120.0.1 Chrome/120.0.0.0 Safari/537.36",
      label: "silk-ua",
    });
    const silkErrs = [];
    const sp = await silkCtx.newPage();
    watchErrors(sp, silkErrs, { prefix: "silk" });
    await sp.goto(srv.base + "/control?input=desktop", { waitUntil: "load" });
    await until(() => sp.evaluate(() => typeof CT === "object" && typeof mods === "object" && !!mods.look), "Silk Controls loaded");
    assert.equal(await sp.evaluate(() => CT.input), "touch", "Silk UA must always resolve to touch");
    assert.equal(await sp.evaluate(() => document.documentElement.dataset.input), "touch");
    assert.deepEqual(silkErrs, []);
    await silkCtx.close();
    console.log("✓ Echo / Silk user agent always stays in touch mode");

    // 6b. Desktop detection, URL/localStorage override, Controls > Screen dropdown, tighter CSS & tooltips
    const deskCtx = await openContext({ base: srv.base, viewport: { width: 1280, height: 800 }, hasTouch: false, useFixtures: true, realSaves: true, interceptReports: true, label: "controls-desktop" });
    const deskErrs = [];
    const dp = await deskCtx.newPage();
    watchErrors(dp, deskErrs, {
      prefix: "desk",
      ignoreConsole: t => /reported: config: TypeError: Failed to fetch/.test(t),
    });
    await dp.goto(srv.base + "/control", { waitUntil: "load" });
    await until(() => dp.evaluate(() => typeof CT === "object" && typeof mods === "object" && !!mods.look), "Desktop Controls loaded");
    assert.equal(await dp.evaluate(() => CT.input), "desktop");
    assert.equal(await dp.evaluate(() => document.documentElement.dataset.input), "desktop");
    const deskMetrics = await dp.evaluate(() => {
      const row = document.querySelector(".row[data-go]");
      const grip = document.querySelector("[data-grip]");
      const more = document.querySelector(".morebtn");
      return {
        rowH: row.getBoundingClientRect().height,
        gripTouch: grip ? getComputedStyle(grip).touchAction : "",
        moreVis: more ? getComputedStyle(more).display !== "none" : false,
        moreTitle: more ? more.getAttribute("title") : "",
        pveditTitle: document.getElementById("pvedit").getAttribute("title"),
      };
    });
    assert.equal(deskMetrics.moreVis, true, "⋯ menu button should be visible in desktop mode");
    assert.equal(deskMetrics.gripTouch, "auto", "grip should not override touch-action in desktop mode");
    assert.ok(deskMetrics.moreTitle && deskMetrics.pveditTitle, "desktop icon/action buttons should have tooltips");

    // Override to touch via URL: saved in localStorage, tidied from URL, persists across reload, restores touch sizes
    await dp.goto(srv.base + "/control?input=touch", { waitUntil: "load" });
    await until(() => dp.evaluate(() => typeof CT === "object" && typeof mods === "object" && !!mods.look), "Touch override loaded");
    assert.ok(!/[?&]input=/.test(dp.url()), "input query parameter should be tidied from URL");
    assert.equal(await dp.evaluate(() => localStorage.getItem("countertop.input")), "touch");
    assert.equal(await dp.evaluate(() => CT.input), "touch");
    assert.equal(await dp.evaluate(() => document.documentElement.dataset.input), "touch");
    const touchMetrics = await dp.evaluate(() => ({
      rowH: document.querySelector(".row[data-go]").getBoundingClientRect().height,
      gripTouch: getComputedStyle(document.querySelector("[data-grip]")).touchAction,
      moreVis: getComputedStyle(document.querySelector(".morebtn")).display !== "none",
    }));
    assert.ok(deskMetrics.rowH < touchMetrics.rowH, `desktop rows (${deskMetrics.rowH}) should be tighter than touch rows (${touchMetrics.rowH})`);
    assert.equal(touchMetrics.gripTouch, "none", "touch mode grip should keep touch-action:none");
    assert.equal(touchMetrics.moreVis, false, "⋯ menu button stays hidden in touch mode");

    await dp.goto(srv.base + "/control", { waitUntil: "load" });
    await until(() => dp.evaluate(() => typeof CT === "object" && typeof mods === "object" && !!mods.look), "Reloaded with saved override");
    assert.equal(await dp.evaluate(() => CT.input), "touch", "touch override should persist across reload");

    // Controls > Screen > "This browser only" dropdown switches input mode and clears override on Automatic
    await dp.evaluate(() => go("display"));
    await dp.locator("#display-input").waitFor();
    assert.equal(await dp.inputValue("#display-input"), "touch");
    await dp.selectOption("#display-input", "desktop");
    assert.equal(await dp.evaluate(() => CT.input), "desktop");
    assert.equal(await dp.evaluate(() => document.documentElement.dataset.input), "desktop");
    assert.equal(await dp.evaluate(() => localStorage.getItem("countertop.input")), "desktop");
    await dp.selectOption("#display-input", "");
    assert.equal(await dp.evaluate(() => localStorage.getItem("countertop.input")), null);
    assert.equal(await dp.evaluate(() => CT.input), "desktop");

    // /control?input=auto also clears a saved override
    await dp.goto(srv.base + "/control?input=touch", { waitUntil: "load" });
    await dp.goto(srv.base + "/control?input=auto", { waitUntil: "load" });
    await until(() => dp.evaluate(() => typeof CT === "object" && typeof mods === "object" && !!mods.look), "Auto override loaded");
    assert.equal(await dp.evaluate(() => localStorage.getItem("countertop.input")), null);
    assert.equal(await dp.evaluate(() => CT.input), "desktop");
    console.log("✓ desktop/touch detection, ?input= URL override, Controls > Screen setting and tighter desktop CSS");

    // 6c. Native wheel scrolling in long lists (Controls root + Library Tiles)
    const navBox = await dp.locator(".nav").boundingBox();
    await dp.mouse.move(navBox.x + navBox.width / 2, 200);
    await dp.mouse.wheel(0, 600);
    await until(() => dp.evaluate(() => window.scrollY > 50), "native wheel scroll on Controls root");
    await dp.evaluate(() => window.scrollTo(0, 0));

    await dp.evaluate(() => libOpen("tiles"));
    await until(() => dp.locator('#lib [data-l="addtile"]').count().then(c => c > 10), "Library tiles loaded for wheel scroll");
    const lmainBox = await dp.locator("#lib .lmain").boundingBox();
    await dp.mouse.move(lmainBox.x + lmainBox.width / 2, lmainBox.y + 200);
    await dp.mouse.wheel(0, 800);
    await until(() => dp.evaluate(() => document.querySelector("#lib .lmain").scrollTop > 50), "native wheel scroll in Library tiles");
    await dp.keyboard.press("Escape");
    await until(() => dp.evaluate(() => document.getElementById("lib").hidden), "Esc closes Library");
    console.log("✓ native wheel scrolling works in Controls and Library lists, and Esc closes Library");

    // 6d. Right-click menu and visible ⋯ button on pages & themes
    await dp.locator('[data-pid="roomy"]').click({ button: "right" });
    await dp.locator("#ctxmenu").waitFor({ state: "visible" });
    await dp.locator('#ctxmenu button', { hasText: "Hide page" }).click();
    await until(() => dp.evaluate(() => cpById("roomy").on === false), "right-click Hide page toggled roomy off");
    await dp.locator('[data-pid="roomy"] .morebtn').click();
    await dp.locator("#ctxmenu").waitFor({ state: "visible" });
    assert.equal(await dp.evaluate(() => stack[stack.length - 1]), "root", "clicking ⋯ must not navigate into row");
    await dp.locator('#ctxmenu button', { hasText: "Show page" }).click();
    await until(() => dp.evaluate(() => cpById("roomy").on !== false), "⋯ menu Show page toggled roomy back on");
    await dp.locator('[data-pid="roomy"]').click({ button: "right" });
    await dp.locator("#ctxmenu").waitFor({ state: "visible" });
    await dp.keyboard.press("Escape");
    await until(() => dp.evaluate(() => document.getElementById("ctxmenu").hidden), "Esc closes context menu");

    await dp.evaluate(() => go("looks"));
    await dp.locator('.lcard[data-ctx="theme:default"]').click({ button: "right" });
    await dp.locator("#ctxmenu").waitFor({ state: "visible" });
    assert.ok(await dp.locator('#ctxmenu button', { hasText: "Customize" }).isVisible());
    await dp.keyboard.press("Escape");
    await until(() => dp.evaluate(() => document.getElementById("ctxmenu").hidden), "Esc closes theme context menu");
    console.log("✓ right-click and visible ⋯ menus work on pages and themes, and Esc closes them");

    // 6e. Keyboard shortcuts on drafts: Ctrl+S saves, Esc cancels
    await dp.locator('.lcard[data-lact="new"]').click();
    await dp.locator('input[data-lk="__name"]').waitFor();
    await dp.locator('input[data-lk="__name"]').fill("Desk Saved");
    await dp.keyboard.press("Control+s");
    await until(() => dp.evaluate(() => !DRAFT && looks().some(t => t.name === "Desk Saved")), "Ctrl+S saved theme draft");
    await dp.evaluate(() => { stack = ["root", "looks"]; show(); });
    await dp.locator('.lcard[data-lact="new"]').click();
    await dp.locator('input[data-lk="__name"]').waitFor();
    await dp.locator('input[data-lk="__name"]').fill("Desk Discarded");
    await dp.keyboard.press("Escape");
    await until(() => dp.evaluate(() => !DRAFT && stack[stack.length - 1] === "looks"), "Esc closed theme draft");
    assert.equal(await dp.evaluate(() => looks().some(t => t.name === "Desk Discarded")), false, "Esc should not save discarded theme");

    await dp.evaluate(() => { stack = ["root", "effects"]; show(); });
    await dp.locator('[data-fxa="new"]').click();
    await dp.locator('input[data-fxd="name"]').waitFor();
    await dp.locator('input[data-fxd="name"]').fill("Desk FX");
    await dp.keyboard.press("Control+s");
    await until(() => dp.evaluate(() => !FXDRAFT && mineList().some(m => m.name === "Desk FX")), "Ctrl+S saved effect draft");
    await dp.evaluate(() => { stack = ["root", "effects"]; show(); });
    await dp.locator('[data-fxa="new"]').click();
    await dp.locator('input[data-fxd="name"]').waitFor();
    await dp.locator('input[data-fxd="name"]').fill("Desk FX Cancel");
    await dp.keyboard.press("Escape");
    await until(() => dp.evaluate(() => !FXDRAFT && stack[stack.length - 1] === "effects"), "Esc closed effect draft");
    assert.equal(await dp.evaluate(() => mineList().some(m => m.name === "Desk FX Cancel")), false, "Esc should not save discarded effect");
    console.log("✓ Ctrl+S saves drafts and Esc closes drafts without saving");

    // 6f. Desktop 3-pane PC layout studio: pulled-out right inspector, unified toolbar, sidebar toggle, Grid toggle,
    //     Add-a-tile search, wheel scroll, cross-pane tile drag, Duplicate box, right-click menu, mouse drag, Arrow nudge, Ctrl+Z & Ctrl+S
    await dp.evaluate(() => { stack = ["root"]; show(); });
    await until(() => dp.evaluate(() => {
      const f = document.getElementById("pvf");
      return f && f.contentWindow && typeof f.contentWindow.dashEdit === "function" && f.contentWindow.document.querySelector('[data-mod]');
    }), "preview iframe ready");
    await dp.locator("#pvedit").click();
    await until(() => dp.evaluate(() => pvWin().dashEditing() && document.body.classList.contains("editing-desk") && !document.getElementById("insp").hidden), "3-pane PC studio entered");
    const pvFrame = dp.frameLocator("#pvf");
    await pvFrame.locator('.eslot[data-slot="ms3"]').waitFor();

    // Verify pulled-out right inspector, hidden duplicate iframe chrome, and auto-collapsed sidebar at 1280px (< 1400px)
    const studioState = await dp.evaluate(() => {
      const d = pvWin().document;
      return {
        slotCursor: getComputedStyle(d.querySelector(".eslot")).cursor,
        iframeBarHidden: getComputedStyle(d.getElementById("edbar")).display === "none",
        iframePanelHidden: getComputedStyle(d.getElementById("edpanel")).display === "none",
        inspH: document.getElementById("insp").getBoundingClientRect().height,
        navCollapsed: document.body.classList.contains("nav-collapsed"),
        addPgBtn: !!document.querySelector('#pvpage [data-edtab="+"]'),
      };
    });
    assert.equal(studioState.slotCursor, "pointer", "layout editor boxes should use pointer cursor in desktop mode");
    assert.equal(studioState.iframeBarHidden, true, "iframe #edbar should be hidden in PC host mode");
    assert.equal(studioState.iframePanelHidden, true, "iframe #edpanel should be hidden in PC host mode");
    assert.ok(studioState.inspH >= 790, "pulled-out right inspector should span full viewport height, got " + studioState.inspH);
    assert.equal(studioState.navCollapsed, true, "left sidebar should auto-collapse below 1400px while editing");
    assert.equal(studioState.addPgBtn, true, "unified toolbar should include + Page tab");

    // Sidebar toggle expands and collapses left nav; wide viewport (>= 1400px) shows all 3 panes automatically
    await dp.locator("#pvnav").click();
    assert.equal(await dp.evaluate(() => document.body.classList.contains("nav-collapsed")), false, "clicking #pvnav should show sidebar");
    await dp.locator("#pvnav").click();
    assert.equal(await dp.evaluate(() => document.body.classList.contains("nav-collapsed")), true, "clicking #pvnav again should hide sidebar");

    // Grid toggle in unified top toolbar
    await dp.locator("#pvgrid").click();
    assert.equal(await dp.evaluate(() => pvWin().document.body.classList.contains("ed-grid") && document.getElementById("pvgrid").classList.contains("on")), true, "Grid toggle should show snap grid");
    await dp.locator("#pvgrid").click();
    assert.equal(await dp.evaluate(() => !pvWin().document.body.classList.contains("ed-grid")), true, "Grid toggle should hide snap grid");

    // Pulled-out right inspector: Add a tile search + native wheel scrolling + cross-pane drag onto canvas
    await dp.locator('#insp-body [data-act="add"]').click();
    await dp.locator('#insp-body input[data-addq="1"]').waitFor();
    const allTileCards = await dp.locator("#insp-body .tc").count();
    await dp.locator('#insp-body input[data-addq="1"]').fill("clock");
    const filteredCards = await dp.locator("#insp-body .tc").count();
    assert.ok(filteredCards >= 1 && filteredCards < allTileCards, "search should filter Add a tile list");
    await dp.locator('#insp-body input[data-addq="1"]').fill("");

    const inspBox = await dp.locator("#insp-body").boundingBox();
    await dp.mouse.move(inspBox.x + inspBox.width / 2, inspBox.y + 200);
    await dp.mouse.wheel(0, 700);
    await until(() => dp.evaluate(() => document.getElementById("insp-body").scrollTop > 40), "native wheel scroll in pulled-out right inspector");
    await dp.evaluate(() => { document.getElementById("insp-body").scrollTop = 0; });

    // Cross-pane drag a tile from #insp-body onto empty space in the middle canvas (#pvf)
    const slotsBeforeDrag = await dp.evaluate(() => pvWin().curPg().slots.length);
    const noteCard = dp.locator('#insp-body .tc[data-type="note"]').first();
    await noteCard.scrollIntoViewIfNeeded();
    const ncBox = await noteCard.boundingBox();
    const pvBox = await dp.locator("#pvf").boundingBox();
    await dp.mouse.move(ncBox.x + ncBox.width / 2, ncBox.y + ncBox.height / 2);
    await dp.mouse.down();
    await dp.mouse.move(pvBox.x + pvBox.width * 0.85, pvBox.y + pvBox.height * 0.72, { steps: 12 });
    await dp.mouse.up();
    await until(() => dp.evaluate(n => pvWin().curPg().slots.length === n + 1, slotsBeforeDrag), "cross-pane tile drag added a box");
    await dp.locator("#pvundo").click();
    await until(() => dp.evaluate(n => pvWin().curPg().slots.length === n, slotsBeforeDrag), "Undo button removed cross-pane dropped box");
    await dp.locator('#insp-body [data-act="back"]').click();

    // Right-click a box in the middle canvas -> desktop context menu opens with Duplicate box & Remove box
    await pvFrame.locator('.eslot[data-slot="ms3"]').click({ button: "right" });
    await dp.locator("#ctxmenu").waitFor({ state: "visible" });
    assert.ok(await dp.locator('#ctxmenu button', { hasText: "Remove box" }).isVisible());
    await dp.locator('#ctxmenu button', { hasText: "Duplicate box" }).click();
    await until(() => dp.evaluate(n => pvWin().curPg().slots.length === n + 1, slotsBeforeDrag), "Duplicate box created a copy");
    await dp.keyboard.press("Control+z");
    await until(() => dp.evaluate(n => pvWin().curPg().slots.length === n, slotsBeforeDrag), "Ctrl+Z undid Duplicate box");

    // Arrow key nudges selected tile (ms3 is at x=24, y=0, w=12, h=8), Ctrl+Z undoes it
    await pvFrame.locator('.eslot[data-slot="ms3"]').click();
    await until(() => dp.evaluate(() => !!pvWin().document.querySelector('.eslot.sel[data-slot="ms3"]')), "ms3 selected");
    await dp.keyboard.press("ArrowRight");
    await until(() => dp.evaluate(() => pvWin().curPg().slots.find(s => s.id === "ms3").x === 25), "ArrowRight nudged ms3");
    await dp.keyboard.press("Control+z");
    await until(() => dp.evaluate(() => pvWin().curPg().slots.find(s => s.id === "ms3").x === 24), "Ctrl+Z undid ms3 nudge");

    // Mouse drag moves ms3 into empty space to the right, then Ctrl+S saves and exits 3-pane studio cleanly
    const ms3Box = await until(() => pvFrame.locator('.eslot[data-slot="ms3"]').boundingBox(), "ms3 bounding box");
    await dp.mouse.move(ms3Box.x + ms3Box.width / 2, ms3Box.y + ms3Box.height / 2);
    await dp.mouse.down();
    await dp.mouse.move(ms3Box.x + ms3Box.width / 2 + 80, ms3Box.y + ms3Box.height / 2 + 60, { steps: 10 });
    await dp.mouse.up();
    const draggedPos = await until(() => dp.evaluate(() => {
      const s = pvWin().curPg().slots.find(v => v.id === "ms3");
      return s && (s.x > 24 || s.y > 0) ? { x: s.x, y: s.y } : false;
    }), "mouse drag moved ms3 in layout editor");
    await dp.keyboard.press("Control+s");
    await until(() => {
      const saved = JSON.parse(fs.readFileSync(path.join(data, "dashboard.json"), "utf8"))
        .modules.pages.settings.items.find(p => p.id === "main").slots.find(s => s.id === "ms3");
      return saved && saved.x === draggedPos.x && saved.y === draggedPos.y;
    }, "Ctrl+S saved layout editor changes");
    await until(() => dp.evaluate(() => !document.body.classList.contains("editing-desk") && document.getElementById("insp").hidden), "Save exited 3-pane studio");

    // Desktop mode keeps today's Library fixes: Theme and Effects opened from Controls' home show the live preview every time, and the preview size buttons are touch-only
    for (const [row, label] of [["themes", "Theme"], ["effects", "Effects"], ["themes", "Theme (again)"]]) {
      await dp.evaluate(() => { stack = ["root"]; show(); });
      await dp.locator('[data-act="lib"][data-id="' + row + '"]').click();
      await until(() => dp.evaluate(() => { const f = document.getElementById("libpv"); return !!f && /\/dash\/content\?preview=1/.test(f.getAttribute("src") || "") && f.classList.contains("on"); }), "desktop " + label + " preview rendered", 15000);
      await dp.evaluate(() => { libClose(); show(); });
    }
    assert.equal(await dp.evaluate(() => document.getElementById("pvsize").hidden), true, "preview size buttons are hidden in desktop mode");

    assert.deepEqual(deskErrs, []);
    await deskCtx.close();
    console.log("✓ desktop 3-pane PC studio: pulled-out inspector, unified toolbar, Grid toggle, search, cross-pane drag, Duplicate, Arrow nudge, Ctrl+Z & Ctrl+S");
  });
}

main().catch(e => { console.error(e); process.exit(1); });
