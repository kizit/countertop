// Touch and tap behaviour on the screen, the way the Echo gets it: real touch events (Chromium's touch emulation,
// through the DevTools input API, which the page can't tell from a finger) inside the shell the Echo runs. Covers:
//   - holding a tile to edit (normal, community frame, slight jitter vs drag cancel)
//   - swiping between pages (also across a framed tile, and under rotated display orientation)
//   - on-screen editor touch drag-to-move, drag-to-resize, Undo/Redo, touchCancel recovery, and Save persistence
//   - tile Designer touch drag of clock parts
//   - Controls touch drag-to-reorder pages without triggering row navigation
//   - Save, Cancel, Done and Settings → Edit the screen returning to the right page
//   - trips to Settings leaving community tiles on
//   - tapping dashboard-drawn control buttons vs tapping inside the tile frame
//   - Echo Show 4x CPU-throttled touch smoke check
//   - a community tile from the gallery, all by touch: Library → Community, Allow and download, Add it to Main,
//     the gallery taking it down (its box says so), and Remove
// Needs Node, Python 3 and Playwright with Chromium. Run with: node tests/touch-check.js
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
const {
  root, sleep, until, makeDataDir, startServer, startFakeHA, runSuite, touchSession,
} = require("./pw-helper");

const galleryFile = dir => path.join(dir, "gallery-index.json");

async function main() {
  await runSuite("touch-check", async ({ openContext, watchErrors, onCleanup }) => {
    const ha = await startFakeHA();
    onCleanup(() => ha.stop());

    const data = makeDataDir("touch", {
      setup(dir, cfg) {
        fs.mkdirSync(path.join(dir, "community", "tiles"), { recursive: true });
        fs.copyFileSync(path.join(root, "tests", "fixtures", "community-tiles", "front-porch.json"),
          path.join(dir, "community", "tiles", "front-porch.json"));
        // a gallery of test tiles (tests/fixtures/community-tiles/gallery), read from the data folder instead of the real gallery
        fs.writeFileSync(galleryFile(dir), fs.readFileSync(path.join(root, "tests", "fixtures", "community-tiles", "gallery", "index.json")));

        const srcFile = path.join(dir, "sources.json");
        const sources = fs.existsSync(srcFile) ? JSON.parse(fs.readFileSync(srcFile, "utf8")) : {};
        sources.homeassistant = [{ id: "ha1", name: "Home", url: ha.url, token: "countertop-test" }];
        fs.writeFileSync(srcFile, JSON.stringify(sources));

        // main: a note and the control tile; Two: a note; Three: a clock (for Designer touch drag)
        const m = cfg.modules;
        m.tiles.settings.items.push(
          { id: "porch_a", type: "front-porch", settings: { "@src": "ha1", "@light": "light.porch", "@lock": "lock.front_door" } },
          { id: "note_a", type: "note", settings: { text: ["Main page"] } },
          { id: "note_b", type: "note", settings: { text: ["Page two"] } },
          { id: "clk_c", type: "clock", settings: { style: "Classic", date: true } },
        );
        const main = m.pages.settings.items.find(p => p.id === "main");
        main.slots = [
          { id: "a1", mod: "note_a", x: 0, y: 0, w: 16, h: 16 },
          { id: "a2", mod: "porch_a", x: 24, y: 0, w: 20, h: 20 },
        ];
        m.pages.settings.items = [
          main,
          { id: "two", name: "Two", on: true, cols: 48, slots: [{ id: "b1", mod: "note_b", x: 0, y: 0, w: 16, h: 16 }] },
          { id: "three", name: "Three", on: true, cols: 48, slots: [{ id: "c1", mod: "clk_c", x: 0, y: 0, w: 20, h: 14 }] },
        ];
      },
    });
    onCleanup(() => fs.rmSync(data, { recursive: true, force: true }));
    const srv = await startServer(data, { COUNTERTOP_GALLERY_URL: pathToFileURL(galleryFile(data)).href });
    onCleanup(() => srv.stop());
    const base = srv.base;

    const ctx = await openContext({ base, viewport: { width: 1920, height: 1080 }, hasTouch: true, label: "echo-touch" });
    const page = await ctx.newPage();
    const errors = [];
    watchErrors(page, errors, { prefix: "touch" });
    const T = await touchSession(ctx, page);

    // the dashboard inside the shell, as on the Echo
    const dash = () => page.frames().find(f => /\/dash\/content/.test(f.url()));
    const D = async fn => (await until(dash, "the dashboard")).evaluate(fn);
    const frameLoc = () => page.frameLocator("iframe >> nth=-1");
    const ready = async () => until(async () => (await D(() => typeof pageList === "function" && pageList().includes("c:three") && document.querySelector('[data-mod="note_a"]'))), "the dashboard to start").then(() => sleep(600));
    // and the slide to it has finished (0.6 s): nobody holds a tile while the page is still moving
    const onPage = async name => { await until(async () => (await D(() => pageList()[PAGE])) === name, "page " + name); await sleep(800); };
    const tileLoc = id => frameLoc().locator('[data-mod="' + id + '"]').first();
    const status = async () => (await (await fetch(base + "/status")).json()).sandbox;
    await page.goto(base + "/dash");
    await ready();
    await until(async () => (await status()).showing.includes("Front porch"), "the community tile to check in");

    // --- holding a finger on a tile starts editing (also with slight jitter, and on a community tile in its frame) ---
    await T.hold(...await T.centre(tileLoc("note_a")), 1000, 3);
    await until(async () => (await D(() => EDIT.on && EDIT.tile)) === "note_a", "the editor with the note picked");
    await T.tap(...await T.centre(frameLoc().locator("#edcancel")));
    await ready();

    // Moving >12 px during a hold cancels edit entry (so a slow drag doesn't open the editor)
    const [nx, ny] = await T.centre(tileLoc("note_a"));
    await T.touch("touchStart", nx, ny);
    await sleep(200);
    await T.touch("touchMove", nx + 35, ny);
    await sleep(700);
    await T.touch("touchEnd");
    await sleep(150);
    assert.equal(await D(() => EDIT.on), false, "moving >12px during hold should cancel edit mode");

    const porchFrame = () => frameLoc().locator('[data-mod="porch_a"] iframe');
    await until(async () => (await porchFrame().count()) === 1, "the community tile's frame");
    const fb = await porchFrame().boundingBox();
    await T.hold(fb.x + 40, fb.y + 40);
    await until(async () => (await D(() => EDIT.on && EDIT.tile)) === "porch_a", "the editor with the community tile picked");
    await T.tap(...await T.centre(frameLoc().locator("#edcancel")));
    await ready();
    console.log("✓ holding a tile opens the editor (with slight jitter and in a community frame); moving cancels it");

    // --- swiping turns the page, across a normal tile and across a framed tile ---
    let [x, y] = await T.centre(tileLoc("note_a"));
    await T.swipe(x, y, -400);
    await onPage("c:two");
    await T.swipe(900, 600, 400);
    await onPage("main");
    const inner = frameLoc().frameLocator('[data-mod="porch_a"] iframe');
    await until(async () => (await inner.locator(".tried").count()) === 1, "the community tile drawn");
    const fb2 = await porchFrame().boundingBox();
    await T.swipe(fb2.x + fb2.width - 40, fb2.y + 60, -300);
    await onPage("c:two");
    await T.swipe(900, 600, 400);
    await onPage("main");
    console.log("✓ swiping turns the page, also across a community tile that takes taps");

    // --- Cancel and Save come back to the page being edited ---
    await T.swipe(900, 600, -400);
    await onPage("c:two");
    await T.hold(...await T.centre(tileLoc("note_b")));
    await until(() => D(() => EDIT.on && EDIT.page === "c:two"), "the editor on page two");
    await T.tap(...await T.centre(frameLoc().locator("#edcancel")));
    await ready();
    await onPage("c:two");

    // --- On-screen editor touch drag-to-move, drag-to-resize, Undo/Redo, touchCancel recovery & Save ---
    await T.hold(...await T.centre(tileLoc("note_b")));
    await until(() => D(() => EDIT.on && EDIT.page === "c:two"), "the editor on page two again");
    const boxB1 = frameLoc().locator('.eslot[data-slot="b1"]');
    await boxB1.waitFor();
    const b1Start = await boxB1.boundingBox();
    // Drag b1 down and right into empty grid space
    await T.drag(b1Start.x + b1Start.width / 2, b1Start.y + b1Start.height / 2,
      b1Start.x + b1Start.width / 2 + 240, b1Start.y + b1Start.height / 2 + 180, 14, 20);
    const moved = await until(() => D(() => {
      const s = curPg().slots.find(v => v.id === "b1");
      return s && (s.x > 0 || s.y > 0) ? { x: s.x, y: s.y, w: s.w, h: s.h } : false;
    }), "b1 box moved by touch drag");

    // Resize b1 using its south-east handle (.hd.se)
    const se = frameLoc().locator('.eslot[data-slot="b1"] .hd.se');
    await se.waitFor();
    const [sex, sey] = await T.centre(se);
    await T.drag(sex, sey, sex + 120, sey + 90, 12, 20);
    const resized = await until(() => D(() => {
      const s = curPg().slots.find(v => v.id === "b1");
      return EDIT.drag === null && EDIT.hist.length >= 2 && s && (s.w !== 16 || s.h !== 16) ? { x: s.x, y: s.y, w: s.w, h: s.h } : false;
    }), "b1 box resized by touch drag");
    assert.ok(resized.w > moved.w || resized.h > moved.h, "expected b1 to grow: " + JSON.stringify({ moved, resized }));
    await sleep(150);

    // Undo restores moved geometry; Redo restores resized geometry
    await T.tap(...await T.centre(frameLoc().locator("#edundo")));
    await until(async () => {
      const s = await D(() => curPg().slots.find(v => v.id === "b1"));
      return s.w === moved.w && s.h === moved.h;
    }, "Undo to restore pre-resize size");
    await sleep(150);
    await T.tap(...await T.centre(frameLoc().locator("#edredo")));
    await until(async () => {
      const s = await D(() => curPg().slots.find(v => v.id === "b1"));
      return s.w === resized.w && s.h === resized.h;
    }, "Redo to restore resized size");

    // Mid-drag touchCancel leaves editor state clean
    const b1Now = await boxB1.boundingBox();
    await T.cancelDrag(b1Now.x + b1Now.width / 2, b1Now.y + b1Now.height / 2, b1Now.x + 200, b1Now.y + 100);
    await sleep(150);
    assert.equal(await D(() => EDIT.drag === null && !document.body.classList.contains("ed-drag")), true, "touchCancel left editor stuck in drag");
    const beforeSave = await D(() => {
      const s = curPg().slots.find(v => v.id === "b1");
      return { x: s.x, y: s.y, w: s.w, h: s.h };
    });

    // Save persists geometry and stays on page two (even after shellRefresh)
    await T.tap(...await T.centre(frameLoc().locator("#edsave")));
    await ready();
    await onPage("c:two");
    const persisted = JSON.parse(fs.readFileSync(path.join(data, "dashboard.json"), "utf8"))
      .modules.pages.settings.items.find(p => p.id === "two").slots.find(s => s.id === "b1");
    assert.deepEqual({ x: persisted.x, y: persisted.y, w: persisted.w, h: persisted.h }, beforeSave, "touch move/resize didn't persist on Save");

    const oldDash = dash();
    await page.evaluate(() => shellRefresh("dashboard.html changed"));
    await until(() => dash() && dash() !== oldDash && /page=c%3Atwo|\/dash\/content$/.test(dash().url()), "the shell's new dashboard");
    await ready();
    await onPage("c:two");
    console.log("✓ editor touch move, resize, Undo/Redo, touchCancel recovery and Save persistence on page two");

    // --- Tile Designer touch drag (page three has clk_c) ---
    await T.swipe(900, 600, -400);
    await onPage("c:three");
    await T.hold(...await T.centre(tileLoc("clk_c")));
    await until(() => D(() => EDIT.on && EDIT.tile === "clk_c"), "editor on clock tile");
    await T.tap(...await T.centre(frameLoc().locator('[data-act="dznew"]')));
    const timeHandle = frameLoc().locator('#edfocus [data-dzp="time"]');
    await timeHandle.waitFor();
    const beforeTime = await D(() => Object.assign({}, designOf(MODULES.clk_c).parts.time));
    const [tx, ty] = await T.centre(timeHandle);
    await T.drag(tx, ty, tx + 80, ty + 60, 10, 20);
    const afterTime = await until(() => D(() => {
      const p = designOf(MODULES.clk_c).parts.time;
      return (p.x !== undefined && p.y !== undefined) ? { x: p.x, y: p.y } : false;
    }), "clock time part dragged");
    assert.ok(afterTime.x !== beforeTime.x || afterTime.y !== beforeTime.y,
      "Designer touch drag didn't move time part: " + JSON.stringify({ beforeTime, afterTime }));
    await T.tap(...await T.centre(frameLoc().locator('[data-act="dzdone"]').last()));
    await until(() => D(() => !EDIT.focus), "Designer closed");
    await T.tap(...await T.centre(frameLoc().locator("#edcancel")));
    await ready();
    await onPage("c:three");
    console.log("✓ Tile Designer touch drag moves clock parts cleanly");

    // Return to page two for Settings → Edit the screen + Controls grip reorder
    await T.swipe(900, 600, 400);
    await onPage("c:two");

    // --- Settings → Edit the screen opens on this page, and Done comes back to it ---
    const ctl = () => page.frames().find(f => /\/control/.test(f.url()));
    const gear = async () => {
      for (let i = 0; ; i++) {
        await T.tap(...await T.centre(frameLoc().locator("#gear")));
        try { return await until(ctl, "Controls", 4000); } catch (e) { if (i) throw e; }
      }
    };
    await gear();
    await T.tap(...await T.centre(frameLoc().locator('[data-act="echoedit"]').first()));
    await until(() => D(() => EDIT.on && pageList()[PAGE] === "c:two" && EDIT.page === "c:two"), "Edit the screen on page two");
    await T.tap(...await T.centre(frameLoc().locator("#edcancel")));
    await ready();
    await onPage("c:two");

    await gear();
    await T.tap(...await T.centre(frameLoc().locator("#done")));
    await ready();
    await onPage("c:two");
    console.log("✓ Settings → Edit the screen opens on the page you were on, and Done comes back to it");

    // --- Controls touch drag-to-reorder pages (⋮⋮ grip on tablet/phone /control) without firing a row click ---
    const ctlPage = await ctx.newPage();
    watchErrors(ctlPage, errors, { prefix: "ctl-grip" });
    const CT = await touchSession(ctx, ctlPage);
    await ctlPage.goto(base + "/control", { waitUntil: "load" });
    const grip3 = ctlPage.locator('[data-pid="three"] [data-grip]');
    const row2 = ctlPage.locator('[data-pid="two"]');
    await grip3.waitFor();
    const g3 = await grip3.boundingBox(), r2 = await row2.boundingBox();
    const reordered = () => ctlPage.evaluate(() => cpList().map(p => p.id).join(",") === "three,two");
    for (let i = 0; i < 3 && !(await reordered().catch(() => false)); i++) {      // a drag can land while the page is still settling on a slow runner
      await CT.drag(g3.x + g3.width / 2, g3.y + g3.height / 2, g3.x + g3.width / 2, r2.y + r2.height / 2 - 12, 12, 22);
      await sleep(400);
    }
    await until(reordered, "pages reordered by touch grip");
    assert.equal(await ctlPage.evaluate(() => stack[stack.length - 1]), "root", "releasing grip should not navigate into page row");
    const grip3b = ctlPage.locator('[data-pid="three"] [data-grip]');
    const row2b = ctlPage.locator('[data-pid="two"]');
    const g3b = await grip3b.boundingBox(), r2b = await row2b.boundingBox();
    await CT.drag(g3b.x + g3b.width / 2, g3b.y + g3b.height / 2, g3b.x + g3b.width / 2, r2b.y + r2b.height / 2 + 12, 12, 22);
    await until(() => ctlPage.evaluate(() => cpList().map(p => p.id).join(",") === "two,three"), "pages restored by touch grip");
    await sleep(600);
    await ctlPage.close();
    console.log("✓ Controls touch grip reorders pages without triggering row navigation");

    // --- trips to Settings and back don't turn community tiles off ---
    await T.swipe(900, 600, 400);
    await onPage("main");
    for (let i = 0; i < 4; i++) {
      await gear();
      await until(async () => !(await status()).showing.length, "the dashboard's goodbye");
      await T.tap(...await T.centre(frameLoc().locator("#done")));
      await ready();
      await until(async () => (await status()).showing.length, "the community tile to check in again");
    }
    assert.equal((await status()).safe, false);
    assert.equal(await porchFrame().count(), 1);
    console.log("✓ four trips to Settings and back leave community tiles on");

    // --- a tap on a button the dashboard draws works the device; a tap inside the frame works nothing ---
    const before = ha.calls().length;
    const btn = frameLoc().locator('[data-mod="porch_a"] [data-sbxc="on"]');
    await until(async () => /Porch light/.test(await btn.textContent()), "the button");
    await T.tap(...await T.centre(btn));
    await until(() => ha.calls().length === before + 1, "the light to turn on");
    assert.match(ha.calls()[before], /light\/turn_on for light\.porch/);
    const fb3 = await porchFrame().boundingBox();
    await T.tap(fb3.x + 40, fb3.y + 40);
    await until(async () => /act refused/.test(await inner.locator(".tried").textContent()), "the tile's own attempt");
    await sleep(800);
    assert.equal(ha.calls().length, before + 1, "a tap inside the frame works nothing");
    await T.tap(...await T.centre(frameLoc().locator('[data-mod="porch_a"] [data-sbxc="unlock"]')));
    await sleep(800);
    assert.equal(ha.calls().length, before + 1, "the lock needs its switch");
    console.log("✓ a tap on a dashboard-drawn button works its device; a tap inside the tile's frame works nothing");

    // --- a tile from the gallery, by touch: Library → Community → Allow and download → Add it to Main ---
    const C = sel => frameLoc().locator(sel).first();
    const tapC = async sel => { await until(async () => (await C(sel).count()) && (await C(sel).isVisible()), sel); await C(sel).scrollIntoViewIfNeeded(); await sleep(150); await T.tap(...await T.centre(C(sel))); };
    await gear();
    await tapC('[data-act="lib"][data-id="layouts"]');
    await tapC('[data-l="view"][data-id="community"]');
    await tapC('[data-l="c-open"][data-id="tiles/hello-there"]');
    await until(async () => /Nothing beyond its own box/.test(await C(".ctperms").textContent()), "the permission list");
    await tapC('[data-l="c-dl"]');
    await until(() => fs.existsSync(path.join(data, "community", "tiles", "hello-there.json")), "the download");
    await tapC('[data-l="addtile"]');
    // on the Echo, adding a tile goes back to the screen with the editor open on it
    await until(() => D(() => EDIT.on), "the editor on the new tile");
    await T.tap(...await T.centre(frameLoc().locator("#edsave")));
    const hello = () => frameLoc().locator('[data-mod^="hello-"] iframe');
    await until(async () => (await hello().count()) === 1, "the downloaded tile on Main", 15000);
    const helloIn = frameLoc().frameLocator('[data-mod^="hello-"] iframe');
    await until(async () => /Version 1/.test(await helloIn.locator("small").textContent()), "the downloaded tile drawn");
    console.log("✓ a gallery tile downloads after its permission list and goes on Main, all by touch");

    // --- the gallery takes it down: its box says so, and Remove (tapped twice) clears it ---
    const gallery = JSON.parse(fs.readFileSync(galleryFile(data), "utf8"));
    gallery.revoked = ["tiles/hello-there"];
    fs.writeFileSync(galleryFile(data), JSON.stringify(gallery));
    await fetch(base + "/community?refresh=1");          // what the daily check does
    await until(async () => (await status()).takenDown.includes("Hello there"), "the take-down");
    await until(async () => /taken down/i.test(await frameLoc().locator('[data-mod^="hello-"]').textContent()), "the box saying it was taken down (the shell looks for changes every 30 s)", 45000);
    assert.equal(await hello().count(), 0, "a taken-down tile has no frame");
    await gear();
    await tapC('[data-act="lib"][data-id="layouts"]');
    await tapC('[data-l="view"][data-id="community"]');
    await tapC('.lpick.warn [data-l="c-open"]');
    await tapC('[data-l="c-rm"]');
    await sleep(300);
    await tapC('[data-l="c-rm"]');
    await until(() => !fs.existsSync(path.join(data, "community", "tiles", "hello-there.json")), "the removal");
    await until(async () => !JSON.parse(fs.readFileSync(path.join(data, "dashboard.json"), "utf8")).modules.tiles.settings.items.some(t => t.type === "hello-there"), "its box gone from the settings");
    await tapC('[data-l="close"]');
    await T.tap(...await T.centre(frameLoc().locator("#done")));
    await ready();
    assert.equal(await frameLoc().locator('[data-mod^="hello-"]').count(), 0);
    console.log("✓ a taken-down tile stops and says so in its box; Remove clears it and its box");

    // --- rotated display orientation ("left"): vertical framebuffer swipes turn pages ---
    await fetch(base + "/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"orientation":"left"}' });
    await page.goto(base + "/dash");
    await ready();
    await until(() => page.evaluate(() => document.documentElement.dataset.orientation === "left"), "left orientation applied");
    // Under rotate(-90deg), moving +Y on the 1920x1080 framebuffer is moving -X (swipe left -> next page) inside the rotated iframe
    await T.swipe(960, 260, 0, 420);
    await onPage("c:two");
    await T.swipe(960, 820, 0, -420);
    await onPage("main");
    await fetch(base + "/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"orientation":"auto"}' });
    console.log("✓ rotated screen orientation ('left') maps touch swipes cleanly");

    // --- Echo Show 4x CPU-throttled touch check ---
    await page.goto(base + "/dash");
    await ready();
    await T.cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await T.swipe(900, 600, -400);
    await onPage("c:two");
    await T.hold(...await T.centre(tileLoc("note_b")), 1100);
    await until(() => D(() => EDIT.on && EDIT.page === "c:two"), "editor under 4x CPU throttle");
    await T.tap(...await T.centre(frameLoc().locator("#edcancel")));
    await T.cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await ready();
    await onPage("c:two");
    console.log("✓ swipe + hold-to-edit + Cancel succeed under 4× CPU throttling");

    assert.deepEqual(errors, []);
    console.log("✓ no page errors");
  });
}

main().catch(e => { console.error(e); process.exit(1); });
