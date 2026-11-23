// API keys for community tiles, end to end in the shell the Echo runs, with real touches: hold the tile, type a key in
// its settings, tap Save key. The key reaches the server's own file and nowhere else: not the settings, not /config,
// not the page, not the tile's frame (which only learns that a key is saved), not a shared layout. Then Remove key.
// Also: shared layouts never carry a Home Assistant tile's lock switch, taps setting or renamed things.
// The test tile is tests/fixtures/community-tiles/key-check.json; its site reads are answered here (no internet).
// Needs Node, Python 3 and Playwright with Chromium. Run with: node tests/key-check.js
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
const KEY = "sk-test/KEY+check=42", TOKEN = "tok-check-98765";

async function main() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "countertop-keys-"));
  for (const f of fs.readdirSync(path.join(root, "demo", "work"))) fs.copyFileSync(path.join(root, "demo", "work", f), path.join(data, f));
  fs.mkdirSync(path.join(data, "community", "tiles"), { recursive: true });
  fs.copyFileSync(path.join(root, "tests", "fixtures", "community-tiles", "key-check.json"), path.join(data, "community", "tiles", "key-check.json"));
  const cfgFile = path.join(data, "dashboard.json"), cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8")), m = cfg.modules;
  m.night.on = false;
  m.tiles.settings.items.push({ id: "kc_a", type: "key-check", settings: {} });
  const main = m.pages.settings.items.find(p => p.id === "main");
  main.slots = [{ id: "a1", mod: "kc_a", x: 0, y: 0, w: 24, h: 16 }];
  m.pages.settings.items = [main];
  fs.writeFileSync(cfgFile, JSON.stringify(cfg));

  const port = await freePort(), base = "http://127.0.0.1:" + port;
  const server = spawn(process.env.PYTHON || "python3", [path.join(root, "tools", "countertop.py"), "--port", String(port)],
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
    const sent = [];
    await ctx.route("**/*", r => { const u = r.request().url(); if (r.request().postData()) sent.push(u + " " + r.request().postData()); return u.startsWith(base) || u.startsWith("data:") || u.startsWith("blob:") ? r.continue() : r.abort(); });
    // the sites, as the server hands them to the tile: the keys' own site saw them (blanked out), the other didn't
    await ctx.route(base + "/tile-fetch*", async r => {
      const url = new URL(r.request().url()).searchParams.get("url");
      const keys = JSON.parse(fs.readFileSync(path.join(data, "tile-keys.json"), "utf8").toString() || "{}")["key-check"] || {};
      if (url.startsWith("https://httpbin.org/anything")) return r.fulfill({ json: { headers: keys.key ? { "X-Api-Key": "********" } : {}, args: keys.token ? { token: "********" } : {} } });
      return r.fulfill({ json: { headers: {}, args: {} } });
    });
    await ctx.addInitScript(() => { Element.prototype.requestFullscreen = function () { return Promise.resolve(); }; });
    fs.writeFileSync(path.join(data, "tile-keys.json"), "{}");
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    const tap = async (x, y) => { await touch("touchStart", x, y); await sleep(60); await touch("touchEnd"); };
    const hold = async (x, y, ms = 1000) => { await touch("touchStart", x, y); await sleep(ms); await touch("touchEnd"); };
    const centre = async loc => { await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
    const dashL = () => page.frameLocator("iframe >> nth=-1");
    const dash = () => page.frames().find(f => /\/dash\/content/.test(f.url()));
    const D = async fn => (await until(dash, "the dashboard")).evaluate(fn);
    const tileFrame = () => page.frames().find(f => f.url().includes("/tile-frame/key-check?"));
    const inTile = async sel => (await until(tileFrame, "the tile's frame")).evaluate(s => (document.querySelector(s) || {}).innerText || "", sel);
    // everything the page and the tile's frame hold: their HTML, input values and the dashboard's state
    const everything = async () => {
      let all = "";
      for (const f of page.frames()) all += await f.evaluate(() => document.documentElement.outerHTML + [...document.querySelectorAll("input")].map(i => i.value).join(" ")).catch(() => "");
      all += await D(() => JSON.stringify({ CFG, SBX: { tiles: SBX.tiles }, s: MODULES.kc_a.s }));
      return all;
    };

    await page.goto(base + "/dash");
    await until(async () => /Header key saved: no/.test(await inTile("body")), "the tile, with no keys yet");
    console.log("✓ the tile starts with no keys, and says so");

    // --- hold the tile, type the key in its settings, tap Save key ---
    const fb = await (await until(() => dashL().locator('[data-mod="kc_a"] iframe').boundingBox(), "the frame")).valueOf();
    await hold(fb.x + 60, fb.y + 60);
    await until(() => D(() => EDIT.on && EDIT.tile === "kc_a"), "the editor with the tile picked");
    const field = dashL().locator('input[data-tk="key"]');
    await field.waitFor();
    assert.match(await dashL().locator('.sbxkey[data-key="key"]').innerText(), /No key saved yet[\s\S]*Sent only to httpbin\.org/);
    assert.equal(await field.getAttribute("type"), "password");
    await tap(...await centre(field));
    await page.keyboard.type(KEY);
    await tap(...await centre(dashL().locator('[data-act="tksave"][data-k="key"]')));
    await until(async () => /A key is saved/.test(await dashL().locator('.sbxkey[data-key="key"]').innerText()), "the field to say the key is saved");
    const saved = JSON.parse(fs.readFileSync(path.join(data, "tile-keys.json"), "utf8"));
    assert.equal(saved["key-check"].key.value, KEY);
    assert.equal(saved["key-check"].key.host, "httpbin.org");
    assert.equal(fs.statSync(path.join(data, "tile-keys.json")).mode & 0o777, 0o600);
    assert.equal(await field.inputValue(), "", "the field is emptied");
    console.log("✓ a tap on Save key saves it on the server, in its own private file, and empties the field");

    // the address key too, then Save the editor: the settings never hold either one
    await tap(...await centre(dashL().locator('input[data-tk="token"]')));
    await page.keyboard.type(TOKEN);
    await tap(...await centre(dashL().locator('[data-act="tksave"][data-k="token"]')));
    await until(async () => /A key is saved/.test(await dashL().locator('.sbxkey[data-key="token"]').innerText()), "the second key saved");
    await tap(...await centre(dashL().locator("#edsave")));
    await until(() => D(() => !EDIT.on), "the editor to close");
    await until(async () => /Header key saved: yes[\s\S]*address key saved: yes/.test(await inTile("body")), "the tile to see both keys are saved");
    assert.match(await inTile("body"), /What this tile's code sees for the keys: \[true,true\]/);
    await until(async () => /keys' site\): header key arrived, hidden from the tile; address key arrived, hidden from the tile/.test(await inTile("body")), "the keys' site row");
    assert.match(await inTile("body"), /another site\): header key not sent; address key not sent/);
    console.log("✓ the tile learns only that its keys are saved; its site gets them, the other site doesn't");

    for (const k of [KEY, TOKEN]) {
      assert.ok(!fs.readFileSync(cfgFile, "utf8").includes(k), "the settings never hold a key");
      assert.ok(!(await (await fetch(base + "/config")).text()).includes(k), "/config never has a key");
      assert.ok(!(await (await fetch(base + "/status")).text()).includes(k), "Status never has a key");
      assert.ok(!(await everything()).includes(k), "no page or frame holds a key");
      assert.ok(!sent.filter(s => !s.includes("/tile-key ")).some(s => s.includes(k)), "only the save itself carried the key");
      assert.ok(!log.includes(k), "the server's log never shows a key");
    }
    console.log("✓ neither key is in the settings, /config, Status, any page or frame, any other request, or the log");

    // a layout shared from Controls leaves key settings out, whatever is written in them
    const ctl = await ctx.newPage();
    await ctl.goto(base + "/control");
    const packed = await until(() => ctl.evaluate(() => {
      if (typeof libPack !== "function" || !mods.tiles) return null;
      DEFS["key-check"] = { settings: { key: { type: "secret" }, token: { type: "secret" }, label: { type: "text" } } };
      const it = tileList().find(t => t.id === "kc_a");
      it.settings = { key: "typed-into-settings", token: "typed-too", label: "kept" };
      return JSON.stringify(libPack(mods.pages.settings.items.find(p => p.id === "main"), null, "Mine", ""));
    }), "Controls to pack the layout");
    assert.match(packed, /"type":"key-check","settings":\{"label":"kept"\}/);
    assert.ok(!/typed/.test(packed), "no key settings in a shared layout");
    for (const k of [KEY, TOKEN]) assert.ok(!packed.includes(k));
    console.log("✓ a shared layout holds the tile but none of its key settings");

    // Home Assistant tiles: "Allow locks…", how many taps they need, and the renamed things never travel in a layout,
    // so an imported one can't arrive with locks already allowed on one tap
    const ha = await ctl.evaluate(() => {
      const it = { id: "ha_x", type: "ha", settings: { title: "Hall", secure: true, confirm: "One tap", names: "lock.front_door = Kid's door" } };
      const sn = { id: "hs_x", type: "hasensor", settings: { secure: true, confirm: "One tap", names: "Kid's room" } };
      tileList().push(it, sn);
      const pg = { id: "p_x", name: "X", slots: [{ id: "x1", mod: "ha_x", x: 0, y: 0, w: 12, h: 12 }, { id: "x2", mod: "hs_x", x: 12, y: 0, w: 12, h: 12 }] };
      const out = JSON.stringify(libPack(pg, null, "Mine", "").pkg);
      // a file made elsewhere that sets them anyway
      const read = libRead({ countertop: "layout", pages: [{ boxes: [{ x: 0, y: 0, w: 12, h: 12, tiles: [{ type: "ha", settings: { secure: true, confirm: "One tap", names: "a = b", title: "Hall" } },
        { type: "hasensor", settings: { secure: true, confirm: "One tap", names: "c = d" } }] }] }] });
      return { out, read: JSON.stringify(read.boxes) };
    });
    assert.match(ha.out, /"type":"ha"/);
    assert.ok(!/secure|One tap|confirm|Kid/.test(ha.out), "exported: " + ha.out);
    assert.match(ha.read, /"type":"ha","settings":\{\}/);
    assert.ok(!/secure|One tap|confirm|names/.test(ha.read), "imported: " + ha.read);
    await ctl.close();
    console.log("✓ Home Assistant tiles never share or import their lock switch, their taps setting or renamed things");

    // --- Remove key ---
    const fb2 = await dashL().locator('[data-mod="kc_a"] iframe').boundingBox();
    await hold(fb2.x + 60, fb2.y + 60);
    await until(() => D(() => EDIT.on && EDIT.tile === "kc_a"), "the editor again");
    await tap(...await centre(dashL().locator('[data-act="tkrm"][data-k="key"]')));
    await until(async () => /No key saved yet/.test(await dashL().locator('.sbxkey[data-key="key"]').innerText()), "the key removed");
    assert.equal(JSON.parse(fs.readFileSync(path.join(data, "tile-keys.json"), "utf8"))["key-check"].key, undefined);
    await tap(...await centre(dashL().locator("#edcancel")));
    await until(async () => /Header key saved: no[\s\S]*address key saved: yes/.test(await inTile("body")), "the tile to see the key is gone");
    console.log("✓ Remove key takes it off the server, and the tile sees it's gone");

    assert.deepEqual(errors, []);
    console.log("✓ no page errors");
  } finally {
    if (browser) await browser.close();
    server.kill();
    fs.rmSync(data, { recursive: true, force: true });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
