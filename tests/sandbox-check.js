// Community tiles in their sandboxed frames, end to end in Chromium: they draw, get only what they declared, keep
// their own data, read declared sites through the server, answer has() for their box, and a hostile tile can't
// get out (no WebRTC, no inner frames, no network, no other tile's data). Also: the four built-in tiles on the tile
// API draw the same in a frame as in the page, a 7th frame on a page is refused, a frame that navigates is removed,
// and safe mode turns them all off.
// Needs Node, Python 3 and Playwright with Chromium. Run with: node tests/sandbox-check.js
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const fixtures = fs.readFileSync(path.join(root, "demo", "fixtures", "demo-data.js"), "utf8");
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, what, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = await f(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what); await sleep(100); } };
const BUILTINS = { countdown: { dates: ["Trip, 2099-06-14", "Party, 2099-03-02"] }, note: { text: ["Wi-Fi: <home>", "pass"], title: true },
  agenda: { count: 4 }, stocks: { syms: ["^GSPC", "ACME"] } };

async function main() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "countertop-sandbox-"));
  for (const f of fs.readdirSync(path.join(root, "demo", "work"))) fs.copyFileSync(path.join(root, "demo", "work", f), path.join(data, f));
  const dir = path.join(data, "community", "tiles");
  fs.mkdirSync(dir, { recursive: true });
  const fx = path.join(root, "tests", "fixtures", "community-tiles");      // the test tiles (not the test gallery folder beside them)
  for (const f of fs.readdirSync(fx).filter(f => f.endsWith(".json"))) fs.copyFileSync(path.join(fx, f), path.join(dir, f));
  // the four built-ins on the tile API, as community tiles: their own file, unchanged but for the name
  for (const type of Object.keys(BUILTINS)) {
    const src = fs.readFileSync(path.join(root, "tools", "tiles", type + ".js"), "utf8");
    let def = null;
    require("node:vm").runInNewContext(src, { Tile: (t, d) => { def = d; } });
    const field = k => JSON.parse(JSON.stringify(def[k] || []));
    const settings = JSON.parse(JSON.stringify(def.settings || {}));
    fs.writeFileSync(path.join(dir, "x-" + type + ".json"), JSON.stringify({ countertop: "tile", id: "x-" + type, version: 1, name: "x " + type,
      feeds: field("feeds"), hosts: field("hosts"), uses: field("uses"), settings, code: src.replace('Tile("' + type + '"', 'Tile("x-' + type + '"') }));
  }
  const cfgFile = path.join(data, "dashboard.json"), cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8")), m = cfg.modules;
  const T = (id, type, settings, name) => ({ id, type, settings: settings || {}, ...(name ? { name } : {}) });
  const box = (id, mod, x, y, w = 12, h = 16) => ({ id, mod, x, y, w, h });
  m.tiles.settings.items.push(T("moon_a", "moon-facts", { label: "Taps" }), T("next_a", "next-up"), T("soon_a", "soon-days"), T("hostile_a", "hostile"),
    T("soon_b", "soon-days", { date: "2099-01-01" }), T("soon_c", "soon-days"), T("leave_a", "leaver"));
  const main = m.pages.settings.items.find(p => p.id === "main");
  m.night.on = false;
  main.slots = [box("b1", "moon_a", 0, 0), box("b2", "next_a", 12, 0), box("b3", "soon_a", 24, 0), box("b4", "hostile_a", 36, 0),
    { id: "b5", mod: "soon_c", more: ["soon_b"], every: 5, x: 0, y: 16, w: 12, h: 16 }];
  // page 2: each built-in in the page and in a frame, side by side
  const cmp = { id: "cmp", name: "Compare", on: true, slots: [] };
  Object.keys(BUILTINS).forEach((type, i) => {
    m.tiles.settings.items.push(T("in_" + type, type, BUILTINS[type], "Same"), T("fr_" + type, "x-" + type, BUILTINS[type], "Same"));
    cmp.slots.push(box("ci" + i, "in_" + type, i * 12, 0), box("cf" + i, "fr_" + type, i * 12, 16));
  });
  // page 3: seven community tiles, one more than a screen runs
  const full = { id: "full", name: "Full", on: true, slots: [] };
  for (let i = 0; i < 7; i++) { m.tiles.settings.items.push(T("spin_" + i, "spinner", {}, "Spin " + i)); full.slots.push(box("f" + i, "spin_" + i, (i % 4) * 12, i < 4 ? 0 : 16)); }
  const away = { id: "away", name: "Away", on: true, slots: [box("l1", "leave_a", 0, 0)] };
  m.pages.settings.items = m.pages.settings.items.filter(p => p.id === "main" || p.id === "night").concat([cmp, full, away]);
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
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    // made-up feeds for the dashboard only; the frames get nothing injected
    await ctx.addInitScript({ content: "if (!location.pathname.startsWith('/tile-frame')) {" + fixtures + "}" });
    const outside = [], fetches = [];
    await ctx.route("**/*", r => { const u = r.request().url(); if (u.startsWith(base) || u.startsWith("data:") || u.startsWith("blob:")) return r.continue(); outside.push(u); return r.abort(); });
    // the server's site reader, answered here (the test has no internet): it records who asked for what
    await ctx.route(base + "/tile-fetch*", r => {
      const q = new URL(r.request().url()).searchParams, type = q.get("type"), url = q.get("url");
      fetches.push([type, url]);
      if (type === "moon-facts") return r.fulfill({ json: { fact: "The moon is drifting away." } });
      const y = /finance\/chart\/([^?]+)/.exec(url);
      if (type.endsWith("stocks") && y) {
        const sym = decodeURIComponent(y[1]), P = sym === "^GSPC" ? ["S&P 500", 5932.1, 5901.4] : ["Acme <Corp>", 182.44, 179.9];
        return r.fulfill({ json: { chart: { result: [{ meta: { shortName: P[0], regularMarketPrice: P[1], chartPreviousClose: P[2] }, indicators: { quote: [{ close: [1, 2, 3, 2.5] }] } }] } } });
      }
      return r.fulfill({ status: 403, json: { error: "This tile can't reach the internet." } });
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    const reports = [];
    page.on("request", rq => { if (rq.url().endsWith("/report") && rq.postData()) reports.push(rq.postData()); });
    await page.goto(base + "/dash/content");
    const frameOf = type => page.frames().find(f => f.url().includes("/tile-frame/" + type + "?"));
    // the HTML of `sel` in a tile's frame, once it matches `want` (any HTML at all when there's no `want`)
    const inFrame = async (type, sel, want) => {
      const f = await until(() => frameOf(type), type + " frame");
      return until(async () => { const h = await f.evaluate(s => { const e = document.querySelector(s); return e ? e.innerHTML : null; }, sel).catch(() => null);
        return h != null && (!want || want.test(h)) ? h || " " : null; }, type + " " + sel + (want ? " to match " + want : ""));
    };

    // --- a tile with a site and a public feed ---
    await inFrame("moon-facts", ".fact", /drifting away/);
    await inFrame("moon-facts", ".wx", /Weather here/);
    const policy = (await (await fetch(base + "/tile-frame/moon-facts")).headers.get("content-security-policy"));
    assert.match(policy, /^sandbox allow-scripts; default-src 'none'; script-src http:\/\/127\.0\.0\.1:\d+\/tile-frame\/moon-facts\/runtime\.js http:\/\/127\.0\.0\.1:\d+\/tile-frame\/moon-facts\/tile\.js https:\/\/127\.0\.0\.1:\d+\/tile-frame\/moon-facts\/runtime\.js https:\/\/127\.0\.0\.1:\d+\/tile-frame\/moon-facts\/tile\.js;/);
    assert.equal(await page.locator('[data-mod="moon_a"] iframe').getAttribute("sandbox"), "allow-scripts");
    console.log("✓ a community tile draws in its frame, with its site's answer and the weather");

    // its own stored data, through the dashboard: a tap in the frame counts
    await page.locator('[data-mod="moon_a"] iframe').click();
    await inFrame("moon-facts", ".n", /<b>1<\/b>/);
    const stored = async () => (await (await fetch(base + "/tile-data?since=0")).json()).tiles;
    await until(async () => ((await stored()).moon_a || {}).taps === 1, "the tap to be saved");
    console.log("✓ taps reach the tile and its data is saved for that tile");

    // --- personal data: events answered over the bridge, with real Dates, and no internet ---
    await inFrame("next-up", ".isdate", /^true$/);
    await inFrame("next-up", ".ev", /\w/);
    await inFrame("next-up", ".cals", /^[1-9]/);
    assert.equal(await inFrame("next-up", ".teams"), "0", "it didn't declare teams");
    await inFrame("next-up", ".neterr", /can't reach the internet/);
    assert.ok(!fetches.some(([t]) => t === "next-up"), "the dashboard never asks the server for a personal-data tile");
    console.log("✓ events arrive with dates; sources only for what it declared; no internet for personal data");

    // --- has(): a tile with nothing to show hides, without a render on the page; in a box it's skipped ---
    await until(() => page.locator('[data-mod="soon_a"]').first().evaluate(e => e.hidden), "the empty tile to hide");
    await until(async () => page.locator('.slot [data-mod="soon_b"]:not(.stk-off)').count(), "the box to skip the empty tile");
    await until(async () => (await page.locator('.slot [data-mod="soon_c"].stk-off').count()) === 1, "the empty tile to stay skipped", 12000);
    console.log("✓ has() comes back from the frame: the empty tile hides and its box shows the other");

    // --- the hostile tile ---
    const out = JSON.parse((await inFrame("hostile", "#out", /^\{/)).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
    assert.equal(out.rtc, "undefined/undefined/undefined/undefined", "WebRTC is gone");
    assert.equal(out.rtcNames, "none");
    assert.equal(out.rtcDelete, "undefined");
    assert.equal(out.rtcProto, "undefined/undefined/undefined");
    for (const k of ["iframeCreate", "iframeNS", "iframeHTML", "iframeAdjacent", "iframeOuter", "iframeParsed", "iframeInDiv", "iframeRange",
      "iframeShadow", "iframeShadowMove", "iframeOnload", "embed", "write", "customElements"]) assert.match(out[k], /^refused/, k + ": " + out[k]);
    assert.equal(out.onloadLeak, undefined);
    assert.equal(out.frames, "0");
    assert.match(out.parent, /^refused/);
    assert.match(out.cookie, /^refused/);
    assert.match(out.storage, /^refused/);
    assert.equal(out.origin, "null");
    for (const k of ["fetchConfig", "fetchLan", "tileFetch"]) assert.match(out[k], /^refused/, k + ": " + out[k]);
    assert.ok(/blocked|refused/.test(out.postConfig), "postConfig: " + out.postConfig);
    assert.match(out.img, /blocked|no answer/);
    for (const k of ["scriptOut", "scriptHere", "scriptTileFetch"]) assert.match(out[k], /blocked|no answer/, k + ": " + out[k]);
    assert.ok(!outside.some(u => u.includes("leak.example.com")), "a script from elsewhere is never even requested");
    assert.equal(out.open, "blocked");
    assert.equal(out.fontSelf, "sent");
    assert.deepEqual(await frameOf("hostile").evaluate(() => [...document.fonts].map(f => f.family)), [], "the fonts message the tile sent to itself was ignored: no font exists in its frame");
    for (const k of ["fontUrl", "fontSame"]) assert.match(out[k], /blocked|refused|no answer/, k + ": a tile can't load a font by address (" + out[k] + ")");
    assert.equal(out.events, "[]", "it didn't declare events");
    assert.equal(out.weather, "null", "it didn't declare the weather");
    assert.match(out.act, /^refused/);
    assert.equal(page.url(), base + "/dash/content", "the dashboard stayed put");
    const st = await stored();
    assert.equal(st.moon_a.taps, 1, "another tile's data is untouched");
    assert.equal(st.hostile_a.taps, 999, "a message naming another tile changes only the sender's own data");
    assert.equal(Object.getPrototypeOf(st.hostile_a), Object.prototype);
    assert.ok(!fetches.some(([t]) => t === "hostile"), "it never got a site read for it");
    console.log("✓ the hostile tile: no WebRTC (every way back tried), no inner frames, no network, no other tile's data, no actions");

    // --- theme tokens and fonts: bytes sent by the dashboard, never loaded by address ---
    const hostFrame = frameOf("moon-facts");
    await page.evaluate(() => { const r = document.documentElement.style; r.setProperty("--font", '"Outfit", sans-serif'); r.setProperty("--font-display", '"Fraunces", serif'); r.setProperty("--ok", "#123456"); sbxThemeChanged(); });
    const themed = async () => hostFrame.evaluate(() => ({ ok: getComputedStyle(document.documentElement).getPropertyValue("--ok").trim(), font: getComputedStyle(document.documentElement).getPropertyValue("--font").trim(),
      fg: getComputedStyle(document.documentElement).getPropertyValue("--fg").trim(), outfit: [...document.fonts].filter(f => /Outfit/.test(f.family) && f.status === "loaded").length, fraunces: [...document.fonts].filter(f => /Fraunces/.test(f.family) && f.status === "loaded").length, nunito: [...document.fonts].filter(f => /Nunito/.test(f.family)).length }));
    let th = null;
    for (let i = 0; i < 40; i++){ th = await themed(); if (th.ok === "#123456" && th.outfit && th.fraunces) break; await page.evaluate(() => window.dashGoPage && 0); await sleep(250); }
    assert.equal(th.ok, "#123456", "the semantic tokens reach the frame");
    assert.ok(th.fg, "the old names still arrive");
    assert.match(th.font, /Outfit/);
    assert.ok(th.outfit && th.fraunces, "the theme's body and display fonts load from bytes sent by the dashboard");
    assert.equal(th.nunito, 0, "only the fonts the theme names are sent");
    assert.equal(th.outfit, 1, "each font once");
    console.log("✓ theme tokens and the theme's fonts reach the frame as data; the policy still refuses a font by address");

    // --- the four built-ins draw the same in a frame as in the page ---
    await page.evaluate(() => window.dashGoPage("c:cmp"));
    for (const type of Object.keys(BUILTINS)) {
      const own = await until(async () => { const h = await page.locator('[data-mod="in_' + type + '"]').innerHTML(); return /Loading/.test(h) ? null : h; }, type + " in the page");
      const fr = await inFrame("x-" + type, "#tile", /^(?![\s\S]*Loading)[\s\S]+/);
      assert.equal(fr, own, type + " draws differently in a frame");
    }
    console.log("✓ Stocks, Agenda, Countdown and Note draw the same in a frame as in the page");
    assert.ok(fetches.some(([t, u]) => t === "stocks" && u.startsWith("https://query1.finance.yahoo.com/")), "built-in Stocks reads Yahoo through /tile-fetch");

    // --- at most 6 frames: the 7th tile on a page waits and says why ---
    await page.evaluate(() => window.dashGoPage("c:full"));
    await until(async () => (await page.locator('.cpage[data-page="full"] iframe.sbxf').count()) === 6, "6 frames on the full page");
    await sleep(1500);
    assert.equal(await page.locator('.cpage[data-page="full"] iframe.sbxf').count(), 6);
    assert.match(await page.locator('.cpage[data-page="full"] .sbxmsg').first().innerText(), /up to 6 community tiles/);
    assert.ok(await page.evaluate(() => SBX.frames.size) <= 6, "never more than 6 frames on the screen");
    console.log("✓ a 7th frame is refused, and its box says why");

    // --- a frame that leaves its page is removed ---
    await page.evaluate(() => window.dashGoPage("c:away"));
    await until(async () => /tried to leave its box/.test(await page.locator('[data-mod="leave_a"]').innerText()), "the leaving tile to be stopped");
    assert.equal(await page.locator('[data-mod="leave_a"] iframe').count(), 0);
    await until(async () => (await (await fetch(base + "/status")).json()).problems.some(p => /“Leaver” tried to leave its box/.test(p)), "Status to say which tile left");
    assert.ok((await (await fetch(base + "/status")).json()).problems.filter(p => /up to 6 community tiles/.test(p)).join("|").replace(/Spin 6/, "") === "A screen runs up to 6 community tiles at once, so “” isn't running. Move it to another page, or stack it in a box with another tile.", "Status says which tile is waiting, and only that one");
    console.log("✓ a frame that navigates is removed and Status names it");

    // --- check-ins while community tiles show ---
    const beats = await until(async () => { const s = (await (await fetch(base + "/status")).json()).sandbox; return s && s.showing.length ? s : null; }, "a check-in");
    assert.ok(beats.showing.length >= 1);

    // --- safe mode: the switch in Status, and the screen comes back without community tiles ---
    await fetch(base + "/sandbox/safe", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"on":true}' });
    await page.reload();
    await page.locator('[data-mod="moon_a"] .sbxmsg').waitFor();
    assert.match(await page.locator('[data-mod="moon_a"]').innerText(), /safe mode/);
    assert.equal(await page.locator("iframe.sbxf").count(), 0);
    assert.equal((await fetch(base + "/tile-frame/moon-facts/tile.js")).status, 404);
    console.log("✓ safe mode: no frames, and each box says why");

    // Controls → Status shows the switch, and turning it off brings the tiles back
    const ctl = await ctx.newPage();
    await ctl.goto(base + "/control");
    await ctl.evaluate(() => { go("status"); });
    const sw = ctl.locator('[data-act="stsafe"]');
    await sw.waitFor();
    assert.equal(await sw.getAttribute("aria-checked"), "true");
    await sw.click();
    await until(async () => !(await (await fetch(base + "/status")).json()).sandbox.safe, "safe mode to turn off from Controls");
    await page.reload();
    await inFrame("moon-facts", ".fact", /drifting away/);
    console.log("✓ Controls → Status switches safe mode off again");

    assert.deepEqual(outside, [], "nothing left this computer");
    assert.deepEqual(errors, []);
    const bad = reports.filter(r => /js-error/.test(r) && !/community tile (hostile|leaver)/.test(r));
    assert.deepEqual(bad, [], "no page errors except the two test tiles'");
  } finally {
    if (browser) await browser.close();
    server.kill();
    fs.rmSync(data, { recursive: true, force: true });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
