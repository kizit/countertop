// Opens the dashboard, Controls and the phone list in headless Chromium with the demo settings and
// fails on any uncaught error or console.error. Outside addresses are blocked; the demo fixture answers
// the data feeds, so this needs no network.
// Needs Node, Python 3 and Playwright with Chromium. Run with: node tests/browser-check.js
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const fixtures = fs.readFileSync(path.join(root, "demo", "fixtures", "demo-data.js"), "utf8");

const freePort = () => new Promise(res => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "countertop-check-"));
  for (const f of fs.readdirSync(path.join(root, "demo", "work"))) fs.copyFileSync(path.join(root, "demo", "work", f), path.join(data, f));
  const gallery = path.join(data, "gallery-index.json");        // Library > Community reads this instead of the real gallery
  fs.writeFileSync(gallery, JSON.stringify({ countertop: "gallery", format: 1, updated: "2026-11-22", revoked: [], items: [
    { id: "themes/calm", kind: "theme", name: "Calm", description: "", author: "someone", version: 1, updated: "2026-11-22",
      item: { countertop: "theme", format: 1, name: "Calm", values: { accent: "#ff9f5a", tiles: "See-through" } } },
    { id: "effects/hearts", kind: "effect", name: "Hearts", description: "", author: "someone", version: 1, updated: "2026-11-22",
      item: { countertop: "effect", format: 1, name: "Hearts", effect: { glyphs: ["💕"], motion: "rise" } } }] }));
  const port = await freePort();
  const base = "http://127.0.0.1:" + port;
  const server = spawn(process.env.PYTHON || "python3", [path.join(root, "tools", "countertop.py"), "--port", String(port)],
    { env: { ...process.env, COUNTERTOP_DATA: data, COUNTERTOP_NO_UPDATE_CHECK: "1", COUNTERTOP_GALLERY_URL: require("node:url").pathToFileURL(gallery).href }, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  server.stdout.on("data", d => log += d);
  server.stderr.on("data", d => log += d);
  const problems = [];
  let browser;
  try {
    for (let i = 0; ; i++) {
      try { if ((await fetch(base + "/version")).ok) break; } catch (e) { /* not up yet */ }
      if (i > 50) throw new Error("server didn't start:\n" + log);
      await sleep(200);
    }
    browser = await chromium.launch();
    const pages = [
      ["dashboard", "/dash/content", { width: 1920, height: 1080 }],
      ["dashboard, portrait", "/dash/content", { width: 1080, height: 1920 }],
      ["controls", "/control", { width: 1280, height: 900 }],
      ["controls preview", "/dash/content?preview=1", { width: 960, height: 540 }],
      ["phone list", "/list", { width: 390, height: 844 }],
    ];
    // the same dashboard with Language set to French: the page says so, and the weather and dates use French words
    pages.push(["dashboard in French", "/dash/content", { width: 1920, height: 1080 }, async page => {
      const t = await page.evaluate(() => ({ lang: document.documentElement.lang, text: document.body.innerText }));
      if (t.lang !== "fr") throw new Error("html lang is " + JSON.stringify(t.lang) + ", not fr");
      const fr = Object.values(JSON.parse(fs.readFileSync(path.join(root, "tools", "lang", "fr.json"), "utf8"))).filter(w => w.length > 4 && !/[{]/.test(w));
      if (!fr.some(w => t.text.includes(w))) throw new Error("no French words on the screen");
    }, () => {
      const f = path.join(data, "dashboard.json"), d = JSON.parse(fs.readFileSync(f, "utf8"));
      d.modules.general.settings.lang = "Français";
      fs.writeFileSync(f, JSON.stringify(d));
    }]);
    // a tile's own lang block: the Tempo tile brings its French labels with it
    pages.push(["Tempo tile in French", "/dash/content?solo=tempo", { width: 960, height: 640 }, async page => {
      const text = await page.evaluate(() => document.body.textContent);
      for (const w of ["Aujourd'hui", "Bleu", "Rouge", "Heures creuses", "0,1325"])
        if (!text.includes(w)) throw new Error("missing " + JSON.stringify(w) + " in " + JSON.stringify(text.slice(0, 300)));
    }]);
    // the editor on a portrait screen edits a portrait page: a tall canvas on a 32x48 grid. Moving a box there gives
    // the page its own portrait arrangement and leaves landscape as it was; turning the screen shows the 48x32 grid.
    pages.push(["editor, portrait", "/dash/content?preview=1", { width: 1080, height: 1920 }, async page => {
      const r = await page.evaluate(async () => {
        window.dashEdit(true);
        await new Promise(res => setTimeout(res, 800));
        const c = document.getElementById("edcanvas").getBoundingClientRect(), pg = curPg(), s = pg.slots[0];
        const land = JSON.stringify([s.x, s.y, s.w, s.h]), cols = getComputedStyle(document.getElementById("edgrid")).gridTemplateColumns.split(" ").length;
        const before = portOwn(pg);
        EDIT.sel = s.id; const g = RG(s); remember(); touch(pg); Object.assign(RG(s), {h: Math.max(1, g.h - 2)}); relayout();
        const after = {own: portOwn(pg), land: JSON.stringify([s.x, s.y, s.w, s.h]), p: !!s.p};
        return {tall: c.height > c.width, cols, before, after, land};
      });
      await page.setViewportSize({ width: 1920, height: 1080 });
      await sleep(600);
      r.lcols = await page.evaluate(() => {
        const lcols = getComputedStyle(document.getElementById("edgrid")).gridTemplateColumns.split(" ").length;
        return lcols;
      });
      if (!r.tall) throw new Error("the editor's canvas isn't portrait");
      if (r.cols !== 32 || r.lcols !== 48) throw new Error("grid columns " + r.cols + " / " + r.lcols + ", not 32 / 48");
      if (r.before || !r.after.own || !r.after.p) throw new Error("moving a box didn't give the page a portrait arrangement");
      if (r.after.land !== r.land) throw new Error("changing portrait moved the landscape box");
    }]);
    // Library > Effects opened straight from a fresh Controls session: the live preview beside it loads, so Play works
    pages.push(["library effects preview", "/control", { width: 1280, height: 900 }, async page => {
      await page.evaluate(() => libOpen("effects"));
      await sleep(2500);
      const r = await page.evaluate(() => { const f = document.getElementById("libpv"); return { src: f && f.getAttribute("src"), fun: !!(f && f.contentWindow && f.contentWindow.FUN) }; });
      if (!r.src) throw new Error("the Effects preview never started loading");
      if (!r.fun) throw new Error("the Effects preview loaded without its effects engine");
    }]);
    // Library > Community: the gallery's items show, and Download puts a copy in the Library (and only then)
    pages.push(["library community", "/control", { width: 1280, height: 900 }, async page => {
      await page.evaluate(() => libOpen("community"));
      await sleep(2500);
      const r = await page.evaluate(() => ({ cards: document.querySelectorAll("#lib .lc").length, mine: looks().length, fx: mineList().length }));
      if (r.cards !== 2) throw new Error("Community shows " + r.cards + " items, not 2");
      await page.evaluate(() => document.querySelector('#lib .lc[data-id="themes/calm"]').click());
      await sleep(600);
      if (!(await page.$('#lib [data-l="c-dl"]'))) throw new Error("an item's page has no Download button");
      if (await page.evaluate(() => looks().length) !== r.mine) throw new Error("opening an item changed the Library");
      await page.evaluate(() => document.querySelector('#lib [data-l="c-dl"]').click());
      await sleep(400);
      const after = await page.evaluate(() => ({ t: looks().filter(t => t.gallery).map(t => t.gallery.id), up: !!document.querySelector('#lib [data-l="c-rm"]') }));
      if (after.t.join() !== "themes/calm" || !after.up) throw new Error("Download didn't add the theme to the Library");
      await page.evaluate(() => document.querySelector('#lib [data-l="c-rm"]').click());
      await page.evaluate(() => document.querySelector('#lib [data-l="c-rm"]').click());
      await sleep(300);
      if (await page.evaluate(() => looks().some(t => t.gallery))) throw new Error("Remove didn't take the theme out");
    }]);
    // /bench, the sandbox test page: one busy frame, then the escape checks. Every way out must be blocked except leaving
    // the frame's own page, which arrives at the server and shows as a second load. (The endless-loop test is for the Echo, not here.)
    pages.push(["sandbox test page", "/bench?secs=3", { width: 1280, height: 800 }, async page => {
      const run = await page.evaluate(() => window.bench.perf(1));
      if (!run || !(run.fps > 1)) throw new Error("the 1-frame run measured nothing: " + JSON.stringify(run));
      const r = await page.evaluate(() => window.bench.escapes());
      const bad = Object.entries(r.checks).filter(([, c]) => !c.ok).map(([k, c]) => k + ": " + c.note);
      if (bad.length) throw new Error("not as expected: " + bad.join("; ") + " | reports " + r.violations);
      if (r.passed !== 8 || r.total !== 8) throw new Error("checked " + r.total + " things, passed " + r.passed);
      if (!/connect-src/.test(r.violations)) throw new Error("the browser reported no connect-src policy violation: " + JSON.stringify(r.violations));
      const stored = await (await fetch(base + "/bench/results")).json();
      if (!stored.stored.perf["1"] || !stored.stored.escape) throw new Error("results weren't saved");
      for (const via of ["fetch", "img", "prefetch", "open", "top"])
        if (stored.counts[via]) throw new Error("the server saw a hit by " + via);
      if (stored.counts.nav !== 1) throw new Error("the self-navigation hit arrived " + stored.counts.nav + " times, not once");
    }]);
    for (const [name, url, viewport, check, before] of pages) {
      if (before) before();
      const context = await browser.newContext({ viewport });
      // The pages catch a tile that throws and post it to /report; the fixture answers fetch itself, so
      // wrap fetch once more and turn those reports into console errors this script sees.
      await context.addInitScript({ content: fixtures + `
        ;(() => { const f = window.fetch;
          window.fetch = function (u, o) {
            if (String(u).endsWith("/report") && o && o.body) {
              try { const b = JSON.parse(o.body); if (b.task === "js-error") console.error("reported: " + b.error); } catch (e) {}
            }
            return f.apply(this, arguments);
          }; })();` });
      await context.route("**/*", route => route.request().url().startsWith(base) || route.request().url().startsWith("data:")
        ? route.continue() : route.abort());
      // Home Assistant answers for the Tempo tile's French check
      await context.route(base + "/ha/states*", route => route.fulfill({ json: { states: [
        { id: "sensor.rte_tempo_couleur_actuelle", state: "Bleu" }, { id: "sensor.rte_tempo_prochaine_couleur", state: "Rouge" },
        { id: "sensor.prix_tempo_courant", state: "0.1325" }, { id: "binary_sensor.rte_tempo_heures_creuses", state: "on" }] } }));
      const page = await context.newPage();
      page.on("pageerror", e => problems.push(name + ": " + (e.stack || e.message)));
      page.on("console", m => {
        // the sandbox test page tries to break out on purpose: the browser's own refusals are what it expects to see
        const expected = name === "sandbox test page" && /Content Security Policy|sandboxed/.test(m.text());
        if (m.type() === "error" && !expected && !/Failed to load resource|net::ERR_/.test(m.text())) problems.push(name + ": console.error " + m.text());
      });
      await page.goto(base + url, { waitUntil: "load" });
      await sleep(4000);                    // let tiles render and take a turn or two
      if (check) await check(page).catch(e => problems.push(name + ": " + e.message));
      console.log((problems.some(p => p.startsWith(name + ":")) ? "✗ " : "✓ ") + name);
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
    fs.rmSync(data, { recursive: true, force: true });
  }
  if (problems.length) {
    console.error("\n" + [...new Set(problems)].join("\n\n"));
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
