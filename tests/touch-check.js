// Touch and tap behaviour on the screen, the way the Echo gets it: real touch events (Chromium's touch emulation,
// through the DevTools input API, which the page can't tell from a finger) inside the shell the Echo runs. Covers
// holding a tile to edit (a normal one and a community tile in its frame), swiping between pages (also across a
// framed tile), Save, Cancel and Done coming back to the page you were on, Settings → Edit the screen opening on that
// page, trips to Settings not turning community tiles off, and a tap on a control button the dashboard draws versus a
// tap inside the tile's frame.
// Needs Node, Python 3 and Playwright with Chromium. Run with: node tests/touch-check.js
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, what, ms = 10000) => { const t0 = Date.now(); for (;;) { const v = await Promise.resolve().then(f).catch(() => false); if (v) return v; if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what); await sleep(100); } };
const py = process.env.PYTHON || "python3";

async function main() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "countertop-touch-"));
  for (const f of fs.readdirSync(path.join(root, "demo", "work"))) fs.copyFileSync(path.join(root, "demo", "work", f), path.join(data, f));
  fs.mkdirSync(path.join(data, "community", "tiles"), { recursive: true });
  fs.copyFileSync(path.join(root, "tests", "fixtures", "community-tiles", "front-porch.json"), path.join(data, "community", "tiles", "front-porch.json"));

  const haPort = await freePort();
  const ha = spawn(py, [path.join(root, "tests", "fake_ha.py"), "--port", String(haPort)], { stdio: ["ignore", "pipe", "pipe"] });
  let haLog = "";
  ha.stdout.on("data", d => haLog += d);
  const calls = () => haLog.split("\n").filter(l => l.startsWith("called "));
  const srcFile = path.join(data, "sources.json");
  const sources = fs.existsSync(srcFile) ? JSON.parse(fs.readFileSync(srcFile, "utf8")) : {};
  sources.homeassistant = [{ id: "ha1", name: "Home", url: "http://127.0.0.1:" + haPort, token: "countertop-test" }];
  fs.writeFileSync(srcFile, JSON.stringify(sources));

  // main: a note and the control tile; Two and Three: a note each
  const cfgFile = path.join(data, "dashboard.json"), cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8")), m = cfg.modules;
  m.night.on = false;
  m.tiles.settings.items.push({ id: "porch_a", type: "front-porch", settings: { "@src": "ha1", "@light": "light.porch", "@lock": "lock.front_door" } },
    { id: "note_a", type: "note", settings: { text: ["Main page"] } }, { id: "note_b", type: "note", settings: { text: ["Page two"] } },
    { id: "note_c", type: "note", settings: { text: ["Page three"] } });
  const main = m.pages.settings.items.find(p => p.id === "main");
  main.slots = [{ id: "a1", mod: "note_a", x: 0, y: 0, w: 16, h: 16 }, { id: "a2", mod: "porch_a", x: 24, y: 0, w: 20, h: 20 }];
  m.pages.settings.items = [main, { id: "two", name: "Two", on: true, slots: [{ id: "b1", mod: "note_b", x: 0, y: 0, w: 16, h: 16 }] },
    { id: "three", name: "Three", on: true, slots: [{ id: "c1", mod: "note_c", x: 0, y: 0, w: 16, h: 16 }] }];
  fs.writeFileSync(cfgFile, JSON.stringify(cfg));

  const port = await freePort(), base = "http://127.0.0.1:" + port;
  const server = spawn(py, [path.join(root, "tools", "countertop.py"), "--port", String(port)],
    { env: { ...process.env, COUNTERTOP_DATA: data, COUNTERTOP_NO_UPDATE_CHECK: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  server.stdout.on("data", d => log += d);
  server.stderr.on("data", d => log += d);
  let browser;
  try {
    for (let i = 0; ; i++) {
      try { if ((await fetch(base + "/version")).ok) break; } catch (e) { /* not up yet */ }
      if (i > 50) throw new Error("server didn't start:\n" + log);
      await sleep(200);
    }
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, hasTouch: true });
    await ctx.route("**/*", r => { const u = r.request().url(); return u.startsWith(base) || u.startsWith("data:") || u.startsWith("blob:") ? r.continue() : r.abort(); });
    // headless Chromium has no real fullscreen to go to; the shell asks for it on every tap
    await ctx.addInitScript(() => { Element.prototype.requestFullscreen = function () { return Promise.resolve(); }; });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    const tap = async (x, y) => { await touch("touchStart", x, y); await sleep(60); await touch("touchEnd"); };
    const hold = async (x, y, ms = 1000) => { await touch("touchStart", x, y); await sleep(ms); await touch("touchEnd"); };
    const swipe = async (x, y, dx) => { await touch("touchStart", x, y); for (let i = 1; i <= 8; i++) { await touch("touchMove", x + dx * i / 8, y); await sleep(16); } await touch("touchEnd"); };
    const centre = async loc => { const b = await loc.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };

    // the dashboard inside the shell, as on the Echo
    const dash = () => page.frames().find(f => /\/dash\/content/.test(f.url()));
    const D = async fn => (await until(dash, "the dashboard")).evaluate(fn);
    const ready = async () => until(async () => (await D(() => typeof pageList === "function" && pageList().includes("c:three") && document.querySelector('[data-mod="note_a"]'))), "the dashboard to start").then(() => sleep(600));
    // and the slide to it has finished (0.6 s): nobody holds a tile while the page is still moving
    const onPage = async name => { await until(async () => (await D(() => pageList()[PAGE])) === name, "page " + name); await sleep(800); };
    const tileLoc = id => page.frameLocator("iframe >> nth=-1").locator('[data-mod="' + id + '"]').first();
    const status = async () => (await (await fetch(base + "/status")).json()).sandbox;
    await page.goto(base + "/dash");
    await ready();
    await until(async () => (await status()).showing.includes("Front porch"), "the community tile to check in");

    // --- holding a finger on a tile starts editing with it picked: a normal tile, then a community tile in its frame ---
    await hold(...await centre(tileLoc("note_a")));
    await until(async () => (await D(() => EDIT.on && EDIT.tile)) === "note_a", "the editor with the note picked");
    await tap(...await centre(page.frameLocator("iframe >> nth=-1").locator("#edcancel")));
    await ready();
    const porchFrame = () => page.frameLocator("iframe >> nth=-1").locator('[data-mod="porch_a"] iframe');
    await until(async () => (await porchFrame().count()) === 1, "the community tile's frame");
    const fb = await porchFrame().boundingBox();
    await hold(fb.x + 40, fb.y + 40);
    await until(async () => (await D(() => EDIT.on && EDIT.tile)) === "porch_a", "the editor with the community tile picked");
    await tap(...await centre(page.frameLocator("iframe >> nth=-1").locator("#edcancel")));
    await ready();
    console.log("✓ holding a tile opens the editor with it picked, a community tile in its frame too");

    // --- swiping turns the page, across a normal tile and across a framed tile ---
    let [x, y] = await centre(tileLoc("note_a"));
    await swipe(x, y, -400);
    await onPage("c:two");
    await swipe(900, 600, 400);
    await onPage("main");
    const inner = page.frameLocator("iframe >> nth=-1").frameLocator('[data-mod="porch_a"] iframe');
    await until(async () => (await inner.locator(".tried").count()) === 1, "the community tile drawn");
    const fb2 = await porchFrame().boundingBox();
    await swipe(fb2.x + fb2.width - 40, fb2.y + 60, -300);
    await onPage("c:two");
    await swipe(900, 600, 400);
    await onPage("main");
    console.log("✓ swiping turns the page, also across a community tile that takes taps");

    // --- Cancel and Save come back to the page being edited ---
    await swipe(900, 600, -400);
    await onPage("c:two");
    await hold(...await centre(tileLoc("note_b")));
    await until(() => D(() => EDIT.on && EDIT.page === "c:two"), "the editor on page two");
    await tap(...await centre(page.frameLocator("iframe >> nth=-1").locator("#edcancel")));
    await ready();
    await onPage("c:two");
    await hold(...await centre(tileLoc("note_b")));
    await until(() => D(() => EDIT.on && EDIT.page === "c:two"), "the editor on page two again");
    await tap(...await centre(page.frameLocator("iframe >> nth=-1").locator("#edsave")));
    await ready();
    await onPage("c:two");
    // the shell notices the saved settings (it looks every 30 s) and swaps in a new dashboard: still page two
    const oldDash = dash();
    await page.evaluate(() => shellRefresh("dashboard.html changed"));
    await until(() => dash() && dash() !== oldDash && /page=c%3Atwo|\/dash\/content$/.test(dash().url()), "the shell's new dashboard");
    await ready();
    await onPage("c:two");
    console.log("✓ Cancel and Save come back to the page being edited, also after the screen reloads for the new settings");

    // --- Settings → Edit the screen opens on this page, and Done comes back to it ---
    const ctl = () => page.frames().find(f => /\/control/.test(f.url()));
    // headless Chromium now and then drops a touch that lands while the page is still settling; a person taps again
    const gear = async () => {
      for (let i = 0; ; i++) {
        await tap(...await centre(page.frameLocator("iframe >> nth=-1").locator("#gear")));
        try { return await until(ctl, "Controls", 4000); } catch (e) { if (i) throw e; }
      }
    };
    await gear();
    await tap(...await centre(page.frameLocator("iframe >> nth=-1").locator('[data-act="echoedit"]').first()));
    await until(() => D(() => EDIT.on && pageList()[PAGE] === "c:two" && EDIT.page === "c:two"), "Edit the screen on page two");
    await tap(...await centre(page.frameLocator("iframe >> nth=-1").locator("#edcancel")));
    await ready();
    await onPage("c:two");
    await gear();
    await tap(...await centre(page.frameLocator("iframe >> nth=-1").locator("#done")));
    await ready();
    await onPage("c:two");
    console.log("✓ Settings → Edit the screen opens on the page you were on, and Done comes back to it");

    // --- trips to Settings and back don't turn community tiles off ---
    await swipe(900, 600, 400);
    await onPage("main");
    for (let i = 0; i < 4; i++) {
      await gear();
      await until(async () => !(await status()).showing.length, "the dashboard's goodbye");
      await tap(...await centre(page.frameLocator("iframe >> nth=-1").locator("#done")));
      await ready();
      await until(async () => (await status()).showing.length, "the community tile to check in again");
    }
    assert.equal((await status()).safe, false);
    assert.equal(await porchFrame().count(), 1);
    console.log("✓ four trips to Settings and back leave community tiles on");

    // --- a tap on a button the dashboard draws works the device; a tap inside the frame works nothing ---
    const before = calls().length;
    const btn = page.frameLocator("iframe >> nth=-1").locator('[data-mod="porch_a"] [data-sbxc="on"]');
    await until(async () => /Porch light/.test(await btn.textContent()), "the button");
    await tap(...await centre(btn));
    await until(() => calls().length === before + 1, "the light to turn on");
    assert.match(calls()[before], /light\/turn_on for light\.porch/);
    const fb3 = await porchFrame().boundingBox();
    await tap(fb3.x + 40, fb3.y + 40);
    await until(async () => /act refused/.test(await inner.locator(".tried").textContent()), "the tile's own attempt");
    await sleep(800);
    assert.equal(calls().length, before + 1, "a tap inside the frame works nothing");
    await tap(...await centre(page.frameLocator("iframe >> nth=-1").locator('[data-mod="porch_a"] [data-sbxc="unlock"]')));
    await sleep(800);
    assert.equal(calls().length, before + 1, "the lock needs its switch");
    console.log("✓ a tap on a dashboard-drawn button works its device; a tap inside the tile's frame works nothing");

    assert.deepEqual(errors, []);
    console.log("✓ no page errors");
  } finally {
    if (browser) await browser.close();
    server.kill();
    ha.kill();
    fs.rmSync(data, { recursive: true, force: true });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
