// A representative stress matrix for the whole dashboard: screen sizes (1920x1080, 1280x800, and two portrait screens) x themes
// (the six new built-ins, Dark and Light, a Compact and a Roomy one) x content (the demo data, extremes with long names and
// many events, and nothing at all). Each combination must draw without errors, fit the screen without scrolling, keep every tile
// inside the screen and off its neighbors, and keep each tile's main content (data-keep) in view. Needs Node, Python 3 and
// Playwright with Chromium. Run with: node tests/stress-matrix-check.js
// SHOTS=<folder> also saves a screenshot of every combination there.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { until, makeDataDir, startServer, runSuite, assertNoOverlap, assertInViewport } = require("./pw-helper");

const SCREENS = [[1920, 1080], [1280, 800], [1080, 1920], [800, 1280]];
const THEMES = ["builtin-retro-digital", "builtin-newspaper", "builtin-mid-century", "builtin-japandi", "builtin-nordic", "builtin-after-hours",
  "builtin-dark", "builtin-light", "tCompact", "tRoomy"];
const CONTENT = ["demo", "extreme", "empty"];
const SHOTS = process.env.SHOTS || "";

// Realistic worst cases, laid over the demo data through fetch: very long names, a crowded day, a long list, a team with a long name; or none of it
function contentScript(mode) {
  return `;(() => {
    const MODE = ${JSON.stringify(mode)};
    if (MODE === "demo") return;
    const f = window.fetch, p2 = v => String(v).padStart(2, "0"), now = new Date();
    const at = (n, h, m) => { const d = new Date(now); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + "T" + p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":00"; };
    const day = n => at(n, 0, 0).slice(0, 10);
    const LONG = ["Parent-teacher conference with Mrs. Featherstonehaugh-Wigglesworth about the extended science fair", "Dr. Alexandra Papadopoulos-Montgomery, annual check-up and bloodwork", "Wolverhampton Wanderers under-21s versus Brighton & Hove Albion women's team", "Pick up grandmother's anniversary cake from the bakery on the corner of Maple and Fifth"];
    const json = d => Promise.resolve(new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json" } }));
    window.fetch = function (input, opt) {
      const u = typeof input === "string" ? input : input.url, path = u.replace(/^https?:\\/\\/[^/]+/, "");
      if (!opt || !opt.method || opt.method === "GET") {
        if (/^\\/events/.test(path)) {
          if (MODE === "empty") return json({ events: [] });
          const E = [];
          for (let d = 0; d < 6; d++) for (let i = 0; i < 9; i++) E.push({ summary: LONG[(d + i) % LONG.length], start: at(d, 7 + i, i % 2 ? 30 : 0), end: at(d, 8 + i, 20), cal: "fam", color: i % 3 ? "#7cb7ff" : "#f4a259", location: "Room 214, Building C, Riverside Community Center" });
          for (let d = 0; d < 6; d++) E.push({ summary: "Grandparents' visit from out of town", start: day(d), allDay: true, cal: "fam", color: "#7cb7ff" });
          return json({ events: E });
        }
        if (/^\\/notes/.test(path)) {
          if (MODE === "empty") return json({ list: "Grocery", source: "dashboard", note: "", items: [] });
          return json({ list: "Grocery", source: "dashboard", note: "Remember to bring the folding chairs and the extension cord for the party on Saturday evening",
            items: [...Array(45)].map((_, i) => ({ id: "x" + i, text: i % 4 ? "Organic free-range chicken thighs, family pack" : "Milk", done: i % 7 === 0 })) });
        }
        if (/^\\/team/.test(path)) {
          if (MODE === "empty") return json({ team: "", next: null, last: null, error: "no team set up" });
          const g = (n, opp, home) => ({ date: new Date(at(n, 19, 30)).toISOString(), home, opp, note: "UEFA Champions League · Knockout round" });
          return json({ team: "Brighton & Hove Albion Women's Football Club", colors: ["#fedd00", "#000000"], upcoming: [g(0, "Wolverhampton Wanderers Under-21s", true), g(3, "Real Sociedad de Fútbol", false), g(8, "Borussia Mönchengladbach", true)],
            next: Object.assign(g(0, "Wolverhampton Wanderers Under-21s", true), { us: 1, them: 0, done: false, live: true, clock: "67'" }), last: { date: new Date(at(-4, 15, 0)).toISOString(), home: false, opp: "Borussia Mönchengladbach", us: 12, them: 11, done: true, winner: true, note: "Final" } });
        }
      }
      return f.apply(this, arguments);
    };
  })();`;
}

// runs in the page: what is wrong with the drawn dashboard
function inspect() {
  const bad = [], vw = innerWidth, vh = innerHeight, de = document.documentElement;
  if (de.scrollWidth > vw + 1 || de.scrollHeight > vh + 1) bad.push("the page scrolls (" + de.scrollWidth + "x" + de.scrollHeight + " in " + vw + "x" + vh + ")");
  // the pages sit side by side: only the one on screen (and a tile in a stack that isn't showing has no size)
  const onScreen = c => { const pg = c.closest(".page"), r = pg ? pg.getBoundingClientRect() : { left: 0, right: vw }; return r.left < vw - 5 && r.right > 5; };
  const cards = [...document.querySelectorAll(".slot > .card")].filter(c => !c.hidden && c.clientWidth && c.getBoundingClientRect().width > 0 && onScreen(c));
  const boxes = cards.map(c => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, name: c.dataset.type || c.dataset.mod || c.className }; });
  for (const b of boxes) if (b.x < -2 || b.y < -2 || b.x + b.width > vw + 2 || b.y + b.height > vh + 2) bad.push(b.name + " leaves the screen");
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j], ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    if (ox > 2 && oy > 2) bad.push(a.name + " overlaps " + b.name);
  }
  const area = r => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
  for (const card of cards) {
    const sr = card.parentNode.getBoundingClientRect();
    for (const k of card.querySelectorAll("[data-keep]")) {
      const r = k.getBoundingClientRect();
      if (!r.width || !r.height) { bad.push((card.dataset.type || "tile") + ": main content has no size"); continue; }
      let seen = { left: Math.max(r.left, sr.left), top: Math.max(r.top, sr.top), right: Math.min(r.right, sr.right), bottom: Math.min(r.bottom, sr.bottom) }, hidden = "";
      for (let a = k; a && a !== card.parentNode; a = a.parentNode) {
        const st = getComputedStyle(a);
        if (st.display === "none" || st.visibility === "hidden" || a.hidden || a.classList.contains("cut")) { hidden = a.className || a.tagName; break; }
        if (a !== k && (st.overflowX !== "visible" || st.overflowY !== "visible")) { const q = a.getBoundingClientRect(); seen = { left: Math.max(seen.left, q.left), top: Math.max(seen.top, q.top), right: Math.min(seen.right, q.right), bottom: Math.min(seen.bottom, q.bottom) }; }
      }
      if (hidden) bad.push((card.dataset.type || "tile") + ": main content hidden by " + hidden);
      else if (area(seen) < area(r) * 0.92) bad.push((card.dataset.type || "tile") + ": main content cut (" + Math.round(100 * area(seen) / area(r)) + "% shows)");
    }
  }
  return { bad, cards: cards.length };
}

async function main() {
  const ok = await runSuite("stress-matrix-check", async ({ openContext, watchErrors, onCleanup }) => {
    const data = makeDataDir("stress", { setup: (dir, cfg) => { cfg.modules.look.settings.items = [{ id: "tCompact", name: "Compact", values: { density: "Compact" } }, { id: "tRoomy", name: "Roomy", values: { density: "Roomy" } }]; } });
    onCleanup(() => fs.rmSync(data, { recursive: true, force: true }));
    const srv = await startServer(data);
    onCleanup(() => srv.stop());
    if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
    const failures = [], errors = [];
    let checked = 0;
    for (const [W, H] of SCREENS) {
      for (const mode of CONTENT) {
        const ctx = await openContext({ base: srv.base, viewport: { width: W, height: H }, useFixtures: true, interceptReports: true, label: "stress-" + W + "-" + mode, trace: false });
        await ctx.addInitScript({ content: contentScript(mode) });
        const pages = await Promise.all([0, 1, 2].map(async () => { const p = await ctx.newPage(); watchErrors(p, errors, { prefix: W + "x" + H + " " + mode }); return p; }));
        let next = 0;
        await Promise.all(pages.map(async page => {
          for (let j; (j = next++) < THEMES.length;) {
            const theme = THEMES[j], tag = theme + " " + W + "x" + H + " " + mode;
            await page.goto(srv.base + "/dash/content?still=1&theme=" + theme, { waitUntil: "load" });
            await until(() => page.evaluate(() => document.querySelectorAll(".slot > .card").length > 2), "cards for " + tag, 10000);
            await page.evaluate(() => document.fonts.ready);
            await page.waitForTimeout(600);
            const res = await page.evaluate(inspect);
            checked++;
            for (const b of res.bad) failures.push(tag + ": " + b);
            if (!res.cards) failures.push(tag + ": no tiles drawn");
            if (SHOTS) await page.screenshot({ path: path.join(SHOTS, theme.replace("builtin-", "") + "-" + W + "x" + H + "-" + mode + ".png") });
          }
        }));
        await ctx.close();
      }
    }
    assert.deepEqual(errors, [], "errors while drawing");
    assert.ok(checked === SCREENS.length * CONTENT.length * THEMES.length, "every combination was checked: " + checked);
    assert.deepEqual(failures, [], "the dashboard breaks in " + failures.length + " places:\n  " + failures.join("\n  "));
    console.log("✓ stress matrix: " + checked + " combinations (" + SCREENS.length + " screens x " + THEMES.length + " themes x " + CONTENT.length + " kinds of content) draw cleanly");
  });
  process.exit(ok ? 0 : 1);
}
main();
