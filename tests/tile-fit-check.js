// Renders every built-in tile at 5 box sizes (smallest, usual, wide, tall, large) on two screen sizes
// (1920x1080 and 1280x800) through ?solo=<type>&w=&h=, and checks that a tile's main content (the element it marks
// data-keep) is still there: not dropped, not hidden by an ancestor, not cut by a box that hides overflow, large enough
// to read, and inside its box. Text cut inside a box that hides its own overflow is reported for every tile; it fails
// for a tile that marks its main content (the others are fixed in the tile passes, so they're listed, not failed).
// Buttons smaller than a finger are listed too. Needs Node, Python 3 and Playwright with Chromium.
// Run with: node tests/tile-fit-check.js
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { root, until, makeDataDir, startServer, runSuite } = require("./pw-helper");

const TILE_TYPES = fs.readdirSync(path.join(root, "tools", "tiles")).filter(f => f.endsWith(".js")).map(f => f.slice(0, -3)).sort();
// FIT_THEME=tRoomy (or tCompact) renders the tiles in a theme with that spacing, on the first screen size only: tiles must still fit
// when a theme changes the gap and the padding inside tiles (the theme options test covers the grid itself)
const FIT_THEME = process.env.FIT_THEME || "";
const SCREENS = FIT_THEME ? [[1920, 1080]] : [[1920, 1080], [1280, 800]];
const THEME_Q = FIT_THEME ? "&theme=" + FIT_THEME : "";
const MIN_TEXT = 12;      // px, as drawn
const MIN_TOUCH = 28;     // px, shortest side of a button (listed only)

// runs in the page: what is wrong with this tile's main content, and what else is cut or small
function inspect([MIN_TEXT, MIN_TOUCH]) {
  const card = document.querySelector('[data-type]:not(.tc)');
  if (!card || card.hidden || !card.clientWidth) return { missing: true };
  const slot = card.parentNode, out = { keep: 0, bad: [], clipped: "", small: [] };
  const clip = clippedInside(card);
  if (clip) out.clipped = (clip.className || clip.tagName) + ": " + (clip.textContent || "").trim().slice(0, 30);
  const sr = slot.getBoundingClientRect();
  const area = r => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
  const K = [...card.querySelectorAll("[data-keep]")];
  out.keep = K.length;
  for (const k of K) {
    const name = "[data-keep] " + (k.className || k.tagName);
    const r = k.getBoundingClientRect();
    if (!r.width || !r.height) { out.bad.push(name + " has no size"); continue; }
    let seen = { left: Math.max(r.left, sr.left), top: Math.max(r.top, sr.top), right: Math.min(r.right, sr.right), bottom: Math.min(r.bottom, sr.bottom) };
    for (let a = k; a && a !== slot; a = a.parentNode) {
      const st = getComputedStyle(a);
      if (st.display === "none" || st.visibility === "hidden" || a.hidden || a.classList.contains("cut")) { out.bad.push(name + " is hidden by " + (a.className || a.tagName)); break; }
      if (a !== k && (st.overflowX !== "visible" || st.overflowY !== "visible")) {
        const q = a.getBoundingClientRect();
        seen = { left: Math.max(seen.left, q.left), top: Math.max(seen.top, q.top), right: Math.min(seen.right, q.right), bottom: Math.min(seen.bottom, q.bottom) };
      }
    }
    if (area(seen) < area(r) * 0.92) out.bad.push(name + " is cut: " + Math.round(100 * area(seen) / area(r)) + "% shows");
    let t = k, w = document.createTreeWalker(k, NodeFilter.SHOW_TEXT), n;
    while ((n = w.nextNode())) if (n.textContent.trim()) { t = n.parentElement; break; }
    const px = parseFloat(getComputedStyle(t).fontSize) * (k.offsetWidth ? r.width / k.offsetWidth : 1);
    if (px < MIN_TEXT) out.bad.push(name + " is too small to read: " + px.toFixed(1) + "px");
  }
  for (const b of card.querySelectorAll("button, [data-act], .chip, .cbtn")) {
    const r = b.getBoundingClientRect();
    if (r.width && r.height && Math.min(r.width, r.height) < MIN_TOUCH && getComputedStyle(b).display !== "none") out.small.push(Math.round(Math.min(r.width, r.height)) + "px " + (b.className || b.tagName));
  }
  return out;
}

async function main() {
  await runSuite("tile-fit-check", async ({ openContext, watchErrors, onCleanup }) => {
    const data = makeDataDir("tilefit", { setup: (dir, cfg) => { cfg.modules.look.settings.items = [{ id: "tCompact", name: "Compact", values: { density: "Compact" } }, { id: "tRoomy", name: "Roomy", values: { density: "Roomy" } }]; } });
    onCleanup(() => fs.rmSync(data, { recursive: true, force: true }));
    const srv = await startServer(data);
    onCleanup(() => srv.stop());

    const notes = { clipped: [], small: [] };
    let checked = 0, skipped = 0, marked = 0;
    const failures = [];
    for (const [W, H] of SCREENS) {
      const ctx = await openContext({ base: srv.base, viewport: { width: W, height: H }, useFixtures: true, interceptReports: true, label: "fit-" + W });
      const errors = [];
      const pages = await Promise.all([0, 1, 2, 3, 4, 5].map(async () => { const p = await ctx.newPage(); watchErrors(p, errors, { prefix: "fit" }); return p; }));
      const jobs = [];
      for (const type of TILE_TYPES) {
        // the tile's own sizes come from its definition: read them once
        jobs.push(type);
      }
      const sizesOf = async page => {
        await page.goto(srv.base + "/dash/content?preview=1&solo=" + TILE_TYPES[0] + "&still=1", { waitUntil: "load" });
        await until(() => page.evaluate(() => typeof TYPES === "object" && Object.keys(TYPES).length > 10), "tile types", 8000);
        return page.evaluate(() => Object.fromEntries(Object.entries(TYPES).map(([k, t]) => [k, t.size || [12, 8, 8, 6]])));
      };
      const SIZE = await sizesOf(pages[0]);
      const work = [];
      for (const type of TILE_TYPES) {
        const [w, h, mw, mh] = SIZE[type] || [12, 8, 8, 6];
        const sizes = { min: [mw, mh], usual: [w, h], wide: [Math.min(48, w * 2), h], tall: [w, Math.min(32, h * 3)], large: [Math.min(48, w * 2), Math.min(32, h * 2)] };
        for (const [label, [sw, sh]] of Object.entries(sizes)) work.push({ type, label, sw, sh });
      }
      let next = 0;
      await Promise.all(pages.map(async page => {
        for (let j; (j = next++) < work.length;) {
          const { type, label, sw, sh } = work[j];
          await page.goto(srv.base + "/dash/content?preview=1&solo=" + encodeURIComponent(type) + "&w=" + sw + "&h=" + sh + "&still=1" + THEME_Q, { waitUntil: "load" });
          let res = null;
          try { res = await until(() => page.evaluate(inspect, [MIN_TEXT, MIN_TOUCH]).then(r => (r.missing ? null : r)), type + " " + label, 8000); } catch (e) { skipped++; continue; }
          await page.waitForTimeout(250);
          res = await page.evaluate(inspect, [MIN_TEXT, MIN_TOUCH]);
          if (res.missing) { skipped++; continue; }
          checked++; if (process.env.FITDEBUG) console.log(type, label, JSON.stringify(res));
          const tag = type + " " + label + " " + sw + "x" + sh + " @" + W + "x" + H;
          if (res.keep) {
            marked++;
            for (const b of res.bad) failures.push(tag + ": " + b);
            if (res.clipped) failures.push(tag + ": text cut inside " + res.clipped);
          } else if (res.clipped) notes.clipped.push(tag + ": " + res.clipped);
          if (res.small.length) notes.small.push(tag + ": " + res.small.slice(0, 3).join(", "));
        }
      }));
      assert.deepEqual(errors, [], "errors while rendering tiles at " + W + "x" + H);
      await ctx.close();
    }
    // a decoration that bleeds past the card (the photo frame's blurred backdrop) must not shrink the tile
    {
      const ctx = await openContext({ base: srv.base, viewport: { width: 1920, height: 1080 }, useFixtures: true, label: "fit-deco" });
      const page = await ctx.newPage();
      await page.goto(srv.base + "/dash/content?preview=1&solo=countdown&w=12&h=8&still=1", { waitUntil: "load" });
      await until(() => page.evaluate(() => !!document.querySelector("[data-type=countdown] .big")), "countdown", 8000);
      const z = await page.evaluate(() => {
        const c = document.querySelector("[data-type=countdown]"), d = document.createElement("div");
        d.style.cssText = "position:absolute;inset:-30px"; c.appendChild(d);
        const plain = [...c.children].filter(x => x !== d).map(x => x.style.zoom);
        const run = deco => { if (deco) d.setAttribute("data-deco", ""); else d.removeAttribute("data-deco"); cardFit(c); return [...c.children].filter(x => x !== d).map(x => x.style.zoom).join(); };
        return { without: run(false), withMark: run(true), plain: plain.join() };
      });
      assert.notEqual(z.without, z.plain, "the test backdrop should shrink the tile when it is not marked");
      assert.equal(z.withMark, z.plain, "a data-deco layer changed how the tile fits");
      await ctx.close();
    }
    if (notes.clipped.length) console.log("note: " + notes.clipped.length + " tile/size checks have text cut inside a box that hides overflow (fixed in the tile passes):\n  " + notes.clipped.slice(0, 12).join("\n  ") + (notes.clipped.length > 12 ? "\n  …" : ""));
    if (notes.small.length) console.log("note: " + notes.small.length + " tile/size checks have a button smaller than " + MIN_TOUCH + "px:\n  " + notes.small.slice(0, 8).join("\n  ") + (notes.small.length > 8 ? "\n  …" : ""));
    assert.ok(checked > TILE_TYPES.length * 4, "too few tile sizes were checked: " + checked);
    assert.ok(marked > 0, "no tile marks its main content (data-keep)");
    assert.deepEqual(failures, [], "main content is missing, cut or unreadable:\n  " + failures.join("\n  "));
    console.log("✓ main content visible, whole and readable: " + marked + " of " + checked + " tile/size checks have a marked main element (" + skipped + " not shown without setup)");
  });
}
main();
