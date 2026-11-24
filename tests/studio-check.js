// Tile Studio end to end in Chromium:
//   - the Tile Studio upgrade: a Your own tile that works sealed off becomes one of your tiles and still answers taps;
//     one that reads its pictures and data with plain fetch() and <img> keeps working through the tile's own sites;
//     one that can't move stays a Your own tile, with Convert in Controls → Library → Tiles
//   - Restore puts the original back, and Convert makes it one of your tiles again
//   - write a tile: the preview draws it, a mistake shows in the problems list, Save keeps it, Add puts it on a page
//   - a tile file: Copy as text and import it again, waiting for Let it run
//   - a shared layout carries the code of a tile made here, and it arrives waiting for Let it run
//   - Submit opens the gallery's form with the tile filled in
// Needs Node, Python 3 and Playwright with Chromium. Run with: node tests/studio-check.js
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { until, makeDataDir, startServer, runSuite } = require("./pw-helper");

const STATIC = "<div id=n>0</div><button id=b onclick=\"bump(1)\">+1</button><script>var c = 0; function bump(k){ c += k; document.getElementById('n').textContent = c; }</script>";
const FETCHING = "<div id=w>…</div><img id=sun src='https://img.example.com/sun.png'><script>fetch('https://api.example.com/now.json').then(r => r.json()).then(j => { w.textContent = j.t; })</script>";
const CAMERA = "<img src='http://192.168.1.20/snap.jpg' style='width:100%'>";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function main() {
  await runSuite("studio-check", async ({ openContext, watchErrors, onCleanup }) => {
    const data = makeDataDir("studio", {
      setup(dir, cfg) {
        const m = cfg.modules, own = (id, html) => ({ id, type: "custom", name: "Own " + id, settings: { html, taps: true, frame: false } });
        cfg.schema = 3;                          // saved before Tile Studio: the next start converts
        m.tiles.settings.items.push(own("own_count", STATIC), own("own_weather", FETCHING), own("own_cam", CAMERA));
        const main = m.pages.settings.items.find(p => p.id === "main");
        main.slots = [
          { id: "s1", mod: "own_count", x: 0, y: 0, w: 12, h: 8 },
          { id: "s2", mod: "own_weather", x: 12, y: 0, w: 12, h: 8 },
          { id: "s3", mod: "own_cam", x: 24, y: 0, w: 12, h: 8 },
        ];
      },
    });
    onCleanup(() => fs.rmSync(data, { recursive: true, force: true }));
    const srv = await startServer(data);
    onCleanup(() => srv.stop());
    const cfg = async () => (await fetch(srv.base + "/config")).json();
    const tileOf = async id => (await cfg()).modules.tiles.settings.items.find(t => t.id === id);

    // --- the upgrade ---
    const count = await tileOf("own_count"), weather = await tileOf("own_weather"), cam = await tileOf("own_cam");
    assert.match(count.type, /^my-/);
    assert.match(weather.type, /^my-/);
    assert.equal(cam.type, "custom");
    const legacy = (await cfg()).legacy;
    assert.deepEqual(Object.keys(legacy), ["own_cam"]);

    const ctx = await openContext({ base: srv.base, viewport: { width: 1920, height: 1080 }, label: "dashboard" });
    const fetches = [];
    await ctx.route(srv.base + "/tile-fetch*", r => {
      const q = new URL(r.request().url()).searchParams;
      fetches.push([q.get("type"), q.get("url"), q.get("as") || ""]);
      if (q.get("as") === "image") return r.fulfill({ json: { data: PNG } });
      return r.fulfill({ json: { t: "Sunny" } });
    });
    const errs = [];
    const dash = await ctx.newPage();
    watchErrors(dash, errs, { prefix: "dash", ignoreConsole: t => /violates the following Content Security Policy directive: "img-src/.test(t) });   // pictures the page policy stops before the server shows them
    await dash.goto(srv.base + "/dash/content");
    const frameOf = type => dash.frames().find(f => f.url().includes("/tile-frame/" + type + "?"));
    const inFrame = async (type, fn, what) => {
      const f = await until(() => frameOf(type), type + " frame");
      return until(() => f.evaluate(fn).catch(() => null), what);
    };
    await inFrame(count.type, () => document.querySelector("#n") && document.querySelector("#n").textContent === "0", "the converted page drawn");
    const box = await until(async () => {
      const b = await dash.locator("iframe[src*='/tile-frame/" + count.type + "?']").boundingBox();
      return b && b.width > 0 ? b : null;
    }, "the count frame on screen");
    const btn = await inFrame(count.type, () => { const r = document.querySelector("#b").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, "its button");
    await dash.mouse.click(box.x + btn.x, box.y + btn.y);
    await inFrame(count.type, () => document.querySelector("#n").textContent === "1", "the tap to count");
    console.log("✓ a converted Your own tile draws sealed off and its onclick still works");

    await inFrame(weather.type, () => document.querySelector("#w").textContent === "Sunny", "plain fetch() through the tile's site");
    await inFrame(weather.type, () => document.querySelector("#sun").getAttribute("src").startsWith("data:image/png") && document.querySelector("#sun").naturalWidth === 1, "the picture through the server");
    assert.ok(fetches.some(f => f[0] === weather.type && f[1] === "https://api.example.com/now.json" && f[2] === ""));
    assert.ok(fetches.some(f => f[0] === weather.type && f[1] === "https://img.example.com/sun.png" && f[2] === "image"));
    console.log("✓ fetch() and <img> from the tile's own sites arrive through the server");

    assert.deepEqual(errs, []);

    // --- Controls → Library → Tiles ---
    const ctl = await ctx.newPage();
    const cerrs = [];
    watchErrors(ctl, cerrs, { prefix: "ctl", ignoreConsole: t => /Failed to fetch|violates the following Content Security Policy directive: "img-src/.test(t) });
    ctl.on("dialog", d => d.accept());
    await ctl.goto(srv.base + "/control", { waitUntil: "load" });
    await until(() => ctl.evaluate(() => typeof mods === "object" && !!mods.look), "Controls loaded");
    await ctl.evaluate(() => libOpen("tiles"));
    await ctl.locator('#lib [data-l="s-convert"][data-id="own_cam"]').waitFor();
    assert.match(await ctl.locator("#lib").textContent(), /192\.168\.1\.20/);
    console.log("✓ a Your own tile that can't move is listed with why, and Convert");

    // Restore the converted count tile, then Convert it again
    await ctl.evaluate(t => stuOpen(t), count.type);
    await ctl.locator('#lib [data-l="s-restore"]').first().click();
    await until(async () => (await tileOf("own_count")).type === "custom", "the original back");
    assert.equal((await tileOf("own_count")).settings.html, STATIC);
    await ctl.locator('#lib [data-l="s-convert"][data-id="own_count"]').waitFor();
    await ctl.locator('#lib [data-l="s-convert"][data-id="own_count"]').click();
    await until(async () => /^my-/.test((await tileOf("own_count")).type), "converted again");
    await until(() => ctl.evaluate(() => LIB.view === "studio" && /^my-/.test(STU.id)), "the Studio opened on it");
    console.log("✓ Restore puts the original back, and Convert makes it one of your tiles again");

    // --- write a tile ---
    await ctl.locator('#lib [data-l="s-back"]').click();
    await ctl.locator('#lib [data-l="s-new"]').click();
    await ctl.locator('#lib [data-s="name"]').fill("Hello there");
    await ctl.locator('#lib [data-s="code"]').fill('Tile("my-hello", { render(el) { el.innerHTML = "<b>" + nope + "</b>"; } });');
    await until(() => ctl.locator("#lib .lstu-log").textContent().then(t => /nope is not defined/.test(t)), "the mistake in the problems list");
    await ctl.locator('#lib [data-s="code"]').fill('Tile("my-hello", { render(el) { el.innerHTML = "<b class=hi>Hi from the Studio</b>"; } });');
    const preview = await until(async () => {
      const f = ctl.frames().find(x => /\/dash\/content\?preview=1&solo=draft-/.test(x.url()));
      if (!f) return null;
      const inner = f.childFrames()[0];
      const ok = inner && await inner.evaluate(() => { const b = document.querySelector(".hi"); return b && b.textContent; }).catch(() => null);
      return ok === "Hi from the Studio" ? ok : null;
    }, "the preview drawing the tile", 30000);
    assert.equal(preview, "Hi from the Studio");
    await ctl.locator('#lib [data-l="s-save"]').click();
    const hello = await until(() => ctl.evaluate(() => STU.id && !stuDirty() ? STU.id : null), "saved");
    assert.equal(hello, "my-hello-there");
    await ctl.evaluate(id => libAddTile(id, "main"), hello);
    await until(() => ctl.evaluate(id => gpAll().find(p => p.id === "main").slots.some(s => (tileList().find(t => t.id === s.mod) || {}).type === id), hello), "added to a page");
    console.log("✓ write a tile: the preview draws it, mistakes show, Save keeps it, Add puts it on a page");

    // --- a tile file, and Let it run ---
    const file = await ctl.evaluate(() => JSON.stringify(stuPublic()));
    assert.equal(JSON.parse(file).id, "hello-there");
    assert.match(JSON.parse(file).code, /Tile\("hello-there"/);
    await ctl.evaluate(t => stuImportFile(t), file);
    const imported = await until(() => ctl.evaluate(() => STU.id && STU.id !== "my-hello-there" ? STU.id : null), "the file imported");
    await ctl.locator('#lib [data-l="s-trust"]').first().waitFor();
    let raw = await (await fetch(srv.base + "/studio/tile/" + imported)).json();
    assert.equal(raw.mine.review, true);
    await ctl.locator('#lib [data-l="s-trust"]').first().click();
    await until(async () => !(await (await fetch(srv.base + "/studio/tile/" + imported)).json()).mine.review, "allowed to run");
    console.log("✓ a tile file imports as a new tile that waits for Let it run");

    // --- Submit ---
    await ctl.evaluate(id => stuOpen(id), hello);
    await ctl.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return null; }; });
    await ctl.locator('#lib [data-l="s-submit"]').click();
    const sub = new URL(await until(() => ctl.evaluate(() => window.__opened[0]), "the gallery form"));
    assert.equal(sub.origin + sub.pathname, "https://github.com/kizit/countertop-gallery/issues/new");
    assert.match(sub.searchParams.get("title"), /Hello there/);
    assert.equal(JSON.parse(sub.searchParams.get("code")).id, "hello-there");
    console.log("✓ Submit opens the gallery form with the tile filled in");

    // --- a shared layout carries the code ---
    await ctl.evaluate(() => save(true));
    await until(async () => (await cfg()).modules.pages.settings.items.find(p => p.id === "main").slots.length === 4, "the page saved");
    await ctl.evaluate(() => { LIB.shareOf = "main"; libOpen("share"); });
    await ctl.locator('#lib [data-l="codebox"]').waitFor();
    const code = await ctl.locator('#lib [data-l="codebox"]').inputValue();
    const parsed = await ctl.evaluate(c => libParse(c), code);
    const carried = parsed.pages[0].boxes.flatMap(b => b.tiles).find(t => t.type === hello);
    assert.ok(carried && carried.tile && /Hi from the Studio/.test(carried.tile.code), "the layout carries the tile's code");
    await ctl.evaluate(() => libGo("import"));
    await ctl.locator('#lib [data-l="paste"]').fill(code);
    await ctl.locator('#lib [data-l="openpaste"]').click();
    await until(() => ctl.evaluate(() => !!LIB.imp && LIB.item === "import"), "the layout opened");
    assert.match(await ctl.locator("#lib").textContent(), /Comes with 3 tiles someone made: .*Hello there/);
    await ctl.locator('#lib [data-l="use"][data-id="page"]').click();
    const newType = await until(() => ctl.evaluate(h => {
      const t = tileList().find(x => /^my-hello-there-/.test(x.type) && x.type !== h);
      return t ? t.type : null;
    }, hello), "the carried tile added and used");
    raw = await (await fetch(srv.base + "/studio/tile/" + newType)).json();
    assert.equal(raw.mine.review, true);
    console.log("✓ a shared layout carries the tile's code, and it arrives waiting for Let it run");

    assert.deepEqual(cerrs, []);
    assert.deepEqual(errs, []);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
