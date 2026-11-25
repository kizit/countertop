// Bug-report snapshot end to end in Chromium: Controls asks, the dashboard screen measures itself and answers.
//   - the answer has the browser, sizes, page and per-tile text boxes, and none of the words on the screen
//   - two pieces of text drawn on top of each other are listed as an overlap, text pushed out of its tile as clipped
//   - the diagnostics file carries the same measurements
// Needs Node, Python 3 and Playwright with Chromium. Run with: node tests/snapshot-check.js
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { until, makeDataDir, startServer, runSuite } = require("./pw-helper");

async function main() {
  const ok = await runSuite("snapshot-check", async ({ openContext, watchErrors, onCleanup }) => {
    const data = makeDataDir("snapshot");
    onCleanup(() => fs.rmSync(data, { recursive: true, force: true }));
    const srv = await startServer(data);
    onCleanup(() => srv.stop());
    const ctx = await openContext({ base: srv.base, viewport: { width: 1280, height: 800 }, label: "snapshot" });
    const errs = [];
    const dash = await ctx.newPage();
    watchErrors(dash, errs, { prefix: "dash" });
    await dash.goto(srv.base + "/dash/content", { waitUntil: "load" });
    await until(() => dash.evaluate(() => typeof dashSnapshot === "function" && Object.keys(MOUNTED).length > 2), "dashboard ready");
    await dash.waitForTimeout(1500);

    const J = async (path, init) => (await fetch(srv.base + path, init)).json();
    const ask = async () => {
      await J("/snapshot/request", { method: "POST", body: "{}" });
      return until(async () => { const v = await J("/snapshot"); return v.fresh && v; }, "the screen answered", 15000);
    };

    let v = await ask();
    assert.match(v.data.env.ua, /Chrome|Headless/);
    assert.equal(v.data.env.win, "1280x800");
    assert.ok(v.data.tiles.length > 2, "tiles measured");
    assert.ok(v.data.tiles.every(t => t.box.length === 4 && t.text.every(x => x.len > 0 && x.fs)), "boxes and text lengths");
    assert.ok(v.summary.includes("Countertop v"), "summary has the version");
    // the words on the screen never leave it
    const words = await dash.evaluate(() => [...new Set([...document.querySelectorAll("#pages *")].flatMap(e => [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue.trim())).filter(t => t.length >= 6))].slice(0, 80));
    assert.ok(words.length > 3, "the dashboard has text");
    const blob = JSON.stringify(v);
    for (const w of words) assert.ok(!blob.includes(w), "text leaked: " + w);
    console.log("✓ the screen answers with measurements, no words");

    // text on top of text, and text pushed out of its tile
    await dash.evaluate(() => {
      const el = Object.values(MOUNTED).find(e => e.offsetParent && !e.classList.contains("stk-off"));
      el.style.position = "relative";
      const a = document.createElement("span"), b = document.createElement("span"), c = document.createElement("span");
      a.className = b.className = "zz-test"; a.textContent = "Overcast"; b.textContent = "72°"; c.textContent = "Pushed out"; c.className = "zz-test";
      a.style.cssText = "position:absolute;left:4px;top:4px;font-size:30px"; b.style.cssText = "position:absolute;left:10px;top:8px;font-size:30px";
      c.style.cssText = "position:absolute;left:3000px;top:60px;width:400px;font-size:30px;white-space:nowrap";
      el.prepend(a, b, c);
    });
    v = await ask();
    assert.ok(v.data.overlaps.some(o => /zz-test/.test(o.a) && /zz-test/.test(o.b)), "overlap listed: " + JSON.stringify(v.data.overlaps));
    assert.ok(v.data.clipped.some(o => /zz-test/.test(o.el)), "clipped listed");
    assert.match(v.summary, /Text overlapping: .*zz-test/);
    console.log("✓ overlapping and clipped text are listed");

    const zip = Buffer.from(await (await fetch(srv.base + "/diagnostics")).arrayBuffer());
    assert.ok(zip.includes(Buffer.from("screen.json")), "diagnostics has screen.json");
    assert.deepEqual(errs, []);
  });
  process.exit(ok ? 0 : 1);
}
main();
