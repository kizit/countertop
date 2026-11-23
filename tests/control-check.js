// Control tiles end to end in Chromium, against the stand-in Home Assistant (tests/fake_ha.py): the dashboard draws
// the buttons outside the tile's frame, labelled from the device that was picked; a real tap works that one device;
// a scripted click, and everything the tile's own code tries, works nothing; a lock asks to confirm over the tile;
// the frame sees device states but not which devices were picked; nothing works while editing.
// Needs Node, Python 3 and Playwright with Chromium. Run with: node tests/control-check.js
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
const until = async (f, what, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = await f(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what); await sleep(100); } };
const py = process.env.PYTHON || "python3";

async function main() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "countertop-controls-"));
  for (const f of fs.readdirSync(path.join(root, "demo", "work"))) fs.copyFileSync(path.join(root, "demo", "work", f), path.join(data, f));
  const dir = path.join(data, "community", "tiles");
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(root, "tests", "fixtures", "community-tiles", "front-porch.json"), path.join(dir, "front-porch.json"));

  const haPort = await freePort();
  const ha = spawn(py, [path.join(root, "tests", "fake_ha.py"), "--port", String(haPort)], { stdio: ["ignore", "pipe", "pipe"] });
  let haLog = "";
  ha.stdout.on("data", d => haLog += d);
  const calls = () => haLog.split("\n").filter(l => l.startsWith("called ")).map(l => l.replace(/^called \/api\/services\/\w+\//, ""));
  const srcFile = path.join(data, "sources.json");
  const sources = fs.existsSync(srcFile) ? JSON.parse(fs.readFileSync(srcFile, "utf8")) : {};
  sources.homeassistant = [{ id: "ha1", name: "Home", url: "http://127.0.0.1:" + haPort, token: "countertop-test" }];
  fs.writeFileSync(srcFile, JSON.stringify(sources));

  const cfgFile = path.join(data, "dashboard.json"), cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8")), m = cfg.modules;
  m.tiles.settings.items.push({ id: "porch_a", type: "front-porch", settings: { "@src": "ha1", "@light": "light.porch", "@lock": "lock.front_door", "@secure": true, note: "hi" } });
  const main = m.pages.settings.items.find(p => p.id === "main");
  m.night.on = false;
  main.slots = [{ id: "b1", mod: "porch_a", x: 0, y: 0, w: 16, h: 16 }];
  m.pages.settings.items = m.pages.settings.items.filter(p => p.id === "main" || p.id === "night");
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
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await ctx.route("**/*", r => { const u = r.request().url(); return u.startsWith(base) || u.startsWith("data:") || u.startsWith("blob:") ? r.continue() : r.abort(); });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(base + "/dash/content");
    const frame = () => page.frames().find(f => f.url().includes("/tile-frame/front-porch?"));
    const inFrame = async (sel, want) => {
      const f = await until(frame, "the tile's frame");
      return until(async () => { const h = await f.evaluate(s => { const e = document.querySelector(s); return e ? e.textContent : null; }, sel).catch(() => null);
        return h != null && (!want || want.test(h)) ? h || " " : null; }, sel + (want ? " to match " + want : ""));
    };
    const tile = page.locator('[data-mod="porch_a"]');
    const btn = id => tile.locator('.sbxc [data-sbxc="' + id + '"]');

    // --- the buttons: in the page, beside the frame, labelled from the picked device ---
    await until(async () => (await tile.locator(".sbxc button").count()) === 4, "four buttons");
    await until(async () => /Porch light/.test(await btn("on").textContent()), "the device's own name on its button");
    assert.deepEqual(await tile.locator(".sbxc button").evaluateAll(b => b.map(x => x.firstChild.textContent)), ["Turn on", "Turn off", "Lock", "Unlock"]);
    assert.match(await btn("unlock").textContent(), /Front door/);
    const [fb, cb] = [await tile.locator("iframe").boundingBox(), await tile.locator(".sbxc").boundingBox()];
    assert.ok(cb.y >= fb.y + fb.height, "the buttons sit below the frame, not over it");
    await inFrame("[data-dev]", /off/);
    assert.equal(await inFrame(".keys"), "note", "the frame doesn't see which devices were picked");
    console.log("✓ the dashboard draws the tile's buttons below its frame, named after the picked devices");

    // --- a real tap works that one device, and the tile sees the new state ---
    await btn("on").click();
    await until(() => calls().length === 1, "the light to be turned on");
    assert.deepEqual(calls(), ["turn_on for light.porch"]);
    await inFrame("[data-dev]", /^on$/);
    console.log("✓ a real tap turns on the porch light, and the tile shows it");

    // --- a click from a script isn't a tap ---
    await page.evaluate(() => document.querySelector('[data-sbxc="off"]').click());
    await page.evaluate(() => document.querySelector('[data-sbxc="off"]').dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await sleep(800);
    assert.equal(calls().length, 1, "scripted clicks do nothing");
    console.log("✓ scripted clicks on the buttons do nothing");

    // --- the tile's own code tries to work the lock: act, messages to the dashboard, clicking the dashboard ---
    await tile.locator("iframe").click({ position: { x: 40, y: 40 } });
    const tried = await inFrame(".tried", /refused/);
    assert.match(tried, /act refused/);
    assert.match(tried, /can't reach the dashboard/);
    await sleep(800);
    assert.equal(calls().length, 1, "nothing the tile's code does works a device");
    assert.equal(await tile.locator(".sbxconf").count(), 0, "and no confirm appears");
    console.log("✓ the tile's code can't press its buttons: act is refused, its messages are ignored, the page is out of reach");

    // --- a lock: the dashboard asks first, over the tile ---
    await btn("unlock").click();
    await until(async () => (await tile.locator(".sbxconf").count()) === 1, "the confirm");
    assert.match(await tile.locator(".sbxconf p").textContent(), /^Unlock Front door\?$/);
    await page.evaluate(() => document.querySelector(".sbxconf .yes").click());          // a script can't say yes either
    await sleep(500);
    assert.equal(calls().length, 1);
    await tile.locator(".sbxconf .no").click();
    assert.equal(await tile.locator(".sbxconf").count(), 0);
    assert.equal(calls().length, 1, "Cancel does nothing");
    await btn("unlock").click();
    await tile.locator(".sbxconf .yes").click();
    await until(() => calls().length === 2, "the lock to open");
    assert.equal(calls()[1], "unlock for lock.front_door");
    console.log("✓ unlocking asks on the screen first; Cancel and scripted taps do nothing, Unlock unlocks");

    // --- editing: the buttons don't work ---
    await page.evaluate(() => { EDIT.on = true; render(); });
    await sleep(300);
    assert.equal(await tile.locator(".sbxc").evaluate(e => getComputedStyle(e).pointerEvents), "none");
    await page.evaluate(() => { EDIT.on = false; render(); });
    console.log("✓ the buttons are off while the screen is being edited");

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
