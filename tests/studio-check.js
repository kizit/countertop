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
    // the tile sits centred in the preview box, nothing cut off, at every size
    for (const sz of ["usual", "small", "big"]) {
      await ctl.evaluate(k => { STU.size = k; stuPreview(); }, sz);
      const m = await until(() => ctl.evaluate(() => {
        const f = document.querySelector("#lib .lstu-shot iframe"), box = f && f.parentNode;
        let slot; try { slot = f.contentDocument.querySelector(".slot"); } catch (e) {}
        if (!slot) return null;
        const b = box.getBoundingClientRect(), r = f.getBoundingClientRect(), k = r.width / 1920, s = slot.getBoundingClientRect();
        return {l: r.left + s.left * k - b.left, t: r.top + s.top * k - b.top, rt: b.right - (r.left + s.right * k), bt: b.bottom - (r.top + s.bottom * k)};
      }), "the " + sz + " preview measured");
      assert.ok(Math.abs(m.l - m.rt) < 3 && Math.abs(m.t - m.bt) < 3, sz + " preview centred: " + JSON.stringify(m));
      assert.ok(m.l >= 0 && m.rt >= 0 && m.t >= 0 && m.bt >= 0, sz + " preview not cut off: " + JSON.stringify(m));
    }
    // words on top of each other are reported for the smallest size too, while another size is showing; a clean tile isn't
    await ctl.evaluate(() => { STU.size = "usual"; stuPreview(); });
    await ctl.locator('#lib [data-s="code"]').fill('Tile("my-hello", { render(el) { el.innerHTML = "<div style=\\"font-size:40px\\">First words here</div><div style=\\"position:absolute;left:0;top:0;font-size:40px\\">Second words</div>"; } });');
    await until(() => ctl.locator("#lib .lstu-log").textContent().then(t => /At Smallest: .*Second words.*overlaps/.test(t) || /At Smallest: .*overlaps/.test(t)), "the overlap at the smallest size in the problems list", 30000);
    assert.match(await ctl.locator("#lib .lstu-sz").textContent(), /Usual size: 12 × 8 squares/);
    await ctl.locator('#lib [data-s="code"]').fill('Tile("my-hello", { render(el) { el.innerHTML = "<b class=hi>Hi from the Studio</b>"; } });');
    await until(() => ctl.locator("#lib .lstu-log").textContent().then(t => /No problems so far/.test(t)), "the problems list clear again", 30000);
    const ai = await ctl.evaluate(() => stuAI());
    assert.match(ai, /show only the main thing and hide the secondary lines/);
    await ctl.locator('#lib [data-l="s-save"]').click();
    const hello = await until(() => ctl.evaluate(() => STU.id && !stuDirty() ? STU.id : null), "saved");
    assert.equal(hello, "my-hello-there");
    await ctl.evaluate(id => libAddTile(id, "main"), hello);
    await until(() => ctl.evaluate(id => gpAll().find(p => p.id === "main").slots.some(s => (tileList().find(t => t.id === s.mod) || {}).type === id), hello), "added to a page");
    console.log("✓ write a tile: the preview draws it, mistakes show, Save keeps it, Add puts it on a page");

    // --- let AI fill it in: Copy for chat, then Fill in the form ---
    await ctl.evaluate(() => { libOpen("tiles"); return stuOpen(""); });
    await until(() => ctl.evaluate(() => LIB.view === "studio" && !!document.querySelector("#lib .lstu-ai")), "a new tile open");
    assert.ok(await ctl.evaluate(() => document.querySelector("#lib .lstu-ai").nextElementSibling.querySelector('[data-s="name"]') !== null), "the AI panel is the first panel");
    await ctl.locator('#lib [data-s="ask"]').fill("a traffic light for air quality, and how long the dogs can stay out, thinking about the weather");
    const ask = await ctl.evaluate(() => stuAI());
    for (const want of ["traffic light for air quality", '"aqi"', '"wx"', "this.feed(\"air\")", "size: [width, height", "every:", "taps:", "devices and controls", "ONE code block", "-----CODE-----"]) assert.ok(ask.includes(want), "the copied message has " + want);
    const reply = "Sure!\n```json\n" + JSON.stringify({ name: "Dog time", description: "Air quality light, and how long the dogs can stay out", size: [14, 9, 8, 6], every: 600, taps: false,
      feeds: ["wx", "aqi", "bogus"], hosts: ["api.example.com", "192.168.1.5"], settings: { dogs: { type: "int", label: "Dogs", default: 2, min: 1, max: 9 }, key: { type: "secret", label: "Key", host: "api.example.com" }, mine: { type: "source", kind: "lists" } }, sneaky: true }) +
      "\n```\n```js\nTile(\"my-dog-time\", { render(el){ el.innerHTML = '<b class=dog>Dogs out</b>'; } });\n```";
    await ctl.locator('#lib [data-s="reply"]').fill(reply);
    await ctl.locator('#lib [data-l="s-fill"]').click();
    const filled = await ctl.evaluate(() => JSON.parse(JSON.stringify(STU.t)));
    assert.equal(filled.name, "Dog time");
    assert.deepEqual(filled.feeds, ["wx", "aqi"]);
    assert.deepEqual(filled.size, [14, 9, 8, 6]);
    assert.equal(filled.every, 600);
    assert.deepEqual(filled.hosts, ["api.example.com"]);
    assert.deepEqual(Object.keys(filled.settings), ["dogs"]);
    assert.match(filled.code, /Dogs out/);
    await until(() => ctl.evaluate(() => document.querySelector('#lib [data-s="name"]').value === "Dog time" && document.querySelector('#lib [data-s="feed.aqi"]').classList.contains("on")), "the form shows the filled values");
    const summary = await ctl.locator("#lib .lstu-ai").textContent();
    assert.match(summary, /Filled in: .*name.*reads weather and air quality/);
    assert.match(summary, /Left out: .*bogus.*192\.168\.1\.5.*secret|Left out: .*bogus/);
    assert.ok(/never filled in/.test(summary) && /needs notes in what it reads/.test(summary), "ignored settings are listed");
    assert.equal(await ctl.evaluate(() => stuDirty()), true);
    assert.equal((await fetch(srv.base + "/studio/tile/my-dog-time")).ok, false);   // nothing saved by filling
    await until(() => ctl.evaluate(() => { const f = [...document.querySelectorAll("#lib .lstu-shot iframe")][0]; return !!f; }), "the preview shows it");
    // a reply asking for personal data and sites gets no sites; garbage fills nothing
    const personal = await ctl.evaluate(() => stuParse(JSON.stringify({ feeds: ["events"], hosts: ["api.example.com"] }), STU.t));
    assert.deepEqual(personal.t.hosts, []);
    assert.match(personal.skip.join(" "), /personal data/);
    assert.ok((await ctl.evaluate(() => stuParse("nope", STU.t))).error);
    // a reply that is only code goes into the code; buttons are checked
    const codeOnly = await ctl.evaluate(() => stuParse("Here you go:\n```js\nTile(\"x\", { render(el){} });\n```", STU.t));
    assert.match(codeOnly.t.code, /^Tile\("x"/);
    const btns = await ctl.evaluate(() => stuParse(JSON.stringify({ devices: { lamp: { label: "Lamp", domains: ["light"] } }, controls: [{ id: "on", device: "lamp", action: "turn_on" }, { id: "bad", device: "lamp", action: "unlock" }] }), STU.t));
    assert.equal(btns.t.controls.length, 1);
    assert.deepEqual(btns.t.hosts, []);
    // the reply a real chat gave for the dog-walk idea: plain fences, then the same with the labels pasted in their place, then no markers at all
    const real = fs.readFileSync(require("node:path").join(__dirname, "fixtures", "studio-replies", "dog-walk.txt"), "utf8");
    const shapes = { fences: real, labels: real.replace("```\n{", "json\n{").replace("```\n\n\n```\nTile(", "\njavascript\nTile(").replace(/```\s*$/, ""), bare: real.replace(/```\n?/g, "") };
    const [jsonPart, codePart] = real.split(/```\n\n\n```\n/).map(x => x.replace(/```\n?/g, ""));
    shapes.single = "```\n" + jsonPart.trim() + "\n-----CODE-----\n" + codePart.trim() + "\n```\n";
    shapes.stringCode = JSON.stringify(Object.assign(JSON.parse(jsonPart), { code: codePart.trim() }));
    for (const [how, text] of Object.entries(shapes)) {
      const got = await ctl.evaluate(t => { const r = stuParse(t, stuBlank()); return r.error ? r : { name: r.t.name, desc: r.t.description, size: r.t.size, every: r.t.every, feeds: r.t.feeds, set: Object.keys(r.t.settings), choices: r.t.settings.dogSize.choices, code: r.t.code.slice(0, 18), end: r.t.code.slice(-3), did: r.did }; }, text);
      assert.ok(!got.error, how + ": " + got.error);
      assert.equal(got.name, "Walk the Dog?", how);
      assert.match(got.desc, /^A traffic light/, how);
      assert.deepEqual(got.size, [12, 8, 6, 4], how);
      assert.equal(got.every, 900, how);
      assert.deepEqual(got.feeds, ["wx", "aqi"], how);
      assert.deepEqual(got.set, ["dogSize"], how);
      assert.deepEqual(got.choices, ["Small", "Medium", "Large"], how);
      assert.equal(got.code, 'Tile("dog-walk", {', how);
      assert.equal(got.end, "});", how);
    }
    // other ways of saying it: data by its other names, settings as a list, a size as text
    const alt = await ctl.evaluate(() => stuParse(JSON.stringify({ name: "Alt", size: "10 x 6", feeds: ["weather", "air quality"], settings: [{ key: "n", type: "integer", label: "N", default: 3 }, { name: "u", type: "select", options: ["a", "b"] }] }), stuBlank()));
    assert.deepEqual(alt.t.feeds, ["wx", "aqi"]);
    assert.deepEqual(alt.t.size.slice(0, 2), [10, 6]);
    assert.equal(alt.t.settings.n.type, "int");
    assert.deepEqual(alt.t.settings.u.choices, ["a", "b"]);
    const msg = await ctl.evaluate(() => stuAI());
    assert.ok(msg.includes("don't search the web") && msg.includes("is just a number") && msg.includes("ONE code block") && msg.includes("-----CODE-----"));
    console.log("✓ a real chat reply fills the form whatever its fences look like");
    // the preview's made-up data includes the air quality (a number) as well as the weather
    const feedDraft = await (await fetch(srv.base + "/studio/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tile: { name: "Feeds", size: [12, 8, 6, 4], feeds: ["wx", "aqi"], hosts: [], settings: {}, code: 'Tile("my-feeds", { render(el){ el.innerHTML = "<b id=o>" + JSON.stringify(this.feed("air")) + "|" + (this.feed("weather") && this.feed("weather").current.temperature_2m) + "</b>"; } });' }, of: "" }) })).json();
    const fpg = await ctx.newPage();
    await fpg.goto(srv.base + "/dash/content?preview=1&solo=" + feedDraft.id + "&draft=" + feedDraft.id + "&w=12&h=8");
    const fed = await until(async () => { for (const f of fpg.frames()) { const t = await f.evaluate(() => { const o = document.querySelector("#o"); return o && o.textContent; }).catch(() => null); if (t && !/^null\|null/.test(t)) return t; } return null; }, "the preview feeds");
    assert.equal(fed, "28|62");
    await fpg.close();
    console.log("✓ the preview's made-up data has the air quality number and the weather");
    // the fill left two versions under the preview, and v1 shows the form as it was
    assert.equal(await ctl.locator('#lib .lstu-ver [data-l="s-ver"]').allTextContents().then(t => t.join(",")), "v1,v2");
    await ctl.locator('#lib .lstu-ver [data-l="s-ver"]').first().click();
    await until(() => ctl.evaluate(() => STU.t.name === "My tile" && STU.cur === 0), "v1 restored the form");
    await ctl.evaluate(id => stuOpen(id), hello);
    await until(() => ctl.evaluate(id => LIB.view === "studio" && STU.id === id && !!STU.t, hello), "the saved tile open again");
    console.log("✓ let AI fill it in: the message lists the levers, the reply fills the form checked like typing, nothing is saved or granted, versions restore");

    // --- change it: point at a part of the preview, say what to change, copy the request ---
    const PICKCODE = 'window.__loaded = 1; document.addEventListener("click", () => { window.__clicks = (window.__clicks || 0) + 1; });\nTile("my-pick", { render(el){ el.innerHTML = \'<div class="card"><div class="big">72</div><span class="why">Windy later</span></div>\'; }, css: ".big{font-size:40px}" });';
    await ctl.evaluate(code => { libOpen("tiles"); return stuOpen("").then(() => { STU.t.name = "Pick me"; STU.t.code = code; stuChanged(true); }); }, PICKCODE);
    const tileFrame = () => ctl.frames().filter(f => /\/tile-frame\/draft-/.test(f.url()) && /&w=12&h=8/.test(f.parentFrame().url())).pop();      // the one in the preview, not the hidden smallest-size check
    await until(async () => { const f = tileFrame(); return f && await f.evaluate(() => (document.querySelector(".big") || {}).textContent === "72").catch(() => false); }, "the preview drawing the tile to point at", 30000);
    assert.ok(await ctl.evaluate(() => /Point at something/.test(document.querySelector("#lib .lstu-pk").textContent)), "the Change it panel is under the preview");
    // a frame can't start picking itself, and a forged answer is ignored while nothing was asked
    await tileFrame().evaluate(() => { window.postMessage({ ct: "pick", on: true, text: true, pins: [] }, "*"); parent.postMessage({ ct: "picked", sel: ":scope", tag: "div", cls: [], path: [], box: [0, 0, 10, 10] }, "*"); });
    await tileFrame().evaluate(() => document.querySelector(".big").click());
    assert.equal(await tileFrame().evaluate(() => window.__clicks), 1, "the tile still gets its own clicks when nothing is being picked");
    assert.equal(await ctl.evaluate(() => STU.pend), null);
    // point at the big number
    await ctl.locator('#lib [data-l="s-pick"]').click();
    await until(() => ctl.evaluate(() => STU.picking && document.querySelector("#lib .lstu-shot").classList.contains("pick")), "picking on");
    await until(() => ctl.evaluate(() => { const f = document.querySelector("#lib .lstu-shot iframe"); return f.contentWindow.dashSbxPickKey === stuPickCfg().key; }), "the preview page told");
    await tileFrame().locator(".big").click();
    await until(() => ctl.evaluate(() => !!STU.pend), "the tapped part came back");
    const got = await ctl.evaluate(() => STU.pend);
    assert.equal(got.text, "72");
    assert.equal(got.tag, "div");
    assert.deepEqual(got.cls, ["big"]);
    assert.deepEqual(got.path, ["div.card", "div.big"]);
    assert.equal(got.sel, ":scope>div:nth-child(1)>div:nth-child(1)");
    assert.ok(got.fs >= 30, "its text size is reported");
    assert.equal(await tileFrame().evaluate(() => window.__clicks), 1, "the tile's own click handler didn't run for the pick");
    // a note on it: pin 1 appears over the part
    await ctl.locator('#lib [data-s="pend"]').fill("make it bigger");
    await ctl.locator('#lib [data-l="s-phrase"][data-id="2"]').click();      // "Move up"
    assert.equal(await ctl.evaluate(() => STU.pendNote), "make it bigger, move up");
    await ctl.locator('#lib [data-l="s-pickadd"]').click();
    await until(() => ctl.evaluate(() => STU.notes.length === 1 && !STU.picking), "the note kept");
    await until(async () => await tileFrame().evaluate(() => { const p = document.querySelector("[data-pin='1']"); return !!p && p.textContent === "1" && !/bigger/.test(document.body.innerHTML); }).catch(() => false), "pin 1 drawn, with no note text in the frame");
    await ctl.locator('#lib [data-s="gen"]').fill("put the number on the left");
    // the request
    const req = await ctl.evaluate(() => stuAI(true));
    for (const want of ["Please change a tile", "Make these changes and keep everything else the same", '1. the text "72"', "div.card > div.big", "make it bigger, move up", "Overall: put the number on the left", "Send the whole tile again", "ONE code block", "-----CODE-----"]) assert.ok(req.includes(want), "the change request has " + want);
    // forged answers while picking are cut down: text only with made-up data, bad selectors dropped
    await ctl.locator('#lib [data-l="s-pick"]').click();
    await until(() => ctl.evaluate(() => { const f = document.querySelector("#lib .lstu-shot iframe"); return STU.picking && f.contentWindow.dashSbxPickKey === stuPickCfg().key; }), "picking again");
    await tileFrame().evaluate(() => parent.postMessage({ ct: "picked", sel: "body > img[onerror=x]", tag: "div", cls: [], path: [], box: [0, 0, 10, 10] }, "*"));
    await tileFrame().evaluate(() => parent.postMessage({ ct: "picked", sel: ":scope>div:nth-child(1)", tag: "div", cls: ["a b", "ok-1", 5, "x".repeat(80)], path: ["p".repeat(500)], box: [-5, 500, 10, 10], text: "t".repeat(300) + "<b>", fs: 9999 }, "*"));
    await until(() => ctl.evaluate(() => !!STU.pend), "a forged answer, cut down");
    const forged = await ctl.evaluate(() => STU.pend);
    assert.equal(forged.sel, ":scope>div:nth-child(1)");
    assert.deepEqual(forged.cls, ["ok-1", "x".repeat(40)]);
    assert.ok(forged.path[0].length <= 60 && forged.text.length <= 40 && forged.fs === 400);
    assert.deepEqual(forged.box.slice(0, 2), [0, 100]);
    await ctl.locator('#lib [data-l="s-pickno"]').click();
    assert.equal(await ctl.evaluate(() => STU.notes.length), 1);
    // with your own data showing, the words never leave the frame
    await ctl.locator('#lib [data-l="s-real"]').click();
    await until(() => ctl.evaluate(() => STU.real && !!document.querySelector("#lib .lstu-shot iframe")), "real data preview");
    await until(async () => { const f = tileFrame(); return f && await f.evaluate(() => !!document.querySelector(".big")).catch(() => false); }, "the real-data preview drawn", 30000);
    await ctl.locator('#lib [data-l="s-pick"]').click();
    await until(() => ctl.evaluate(() => { const f = document.querySelector("#lib .lstu-shot iframe"); return STU.picking && f.contentWindow.dashSbxPickKey === stuPickCfg().key; }), "picking with real data");
    await tileFrame().locator(".big").click();
    await until(() => ctl.evaluate(() => !!STU.pend), "a part with real data");
    assert.equal(await ctl.evaluate(() => STU.pend.text), "", "no words with real data");
    await ctl.locator('#lib [data-l="s-pickno"]').click();
    await ctl.locator('#lib [data-l="s-real"]').click();
    // a reply answers the notes: it adds a version, each version keeps its own notes; five versions are kept
    const answer = n => "```\n" + JSON.stringify({ name: "Pick " + n }) + "\n-----CODE-----\n" + PICKCODE.replace("72", String(n)) + "\n```";
    const vers = () => ctl.locator('#lib .lstu-ver [data-l="s-ver"]').allTextContents().then(t => t.join(","));
    await ctl.evaluate(r => { STU.reply = r; stuFill(); }, answer(1));
    await until(() => ctl.evaluate(() => STU.t.name === "Pick 1" && STU.notes.length === 0 && STU.gen === ""), "the fill answered the notes");
    assert.equal(await vers(), "v1,v2");
    assert.ok(await ctl.evaluate(() => document.querySelector("#lib .lstu-ver [data-l='s-ver'].on").textContent === "v2"), "the new version is the one shown");
    await ctl.locator('#lib .lstu-ver [data-l="s-ver"]').first().click();
    await until(() => ctl.evaluate(() => STU.t.name === "Pick me" && STU.notes.length === 1 && STU.gen === "put the number on the left"), "v1 brought the form and its notes back");
    await until(async () => await tileFrame().evaluate(() => !!document.querySelector("[data-pin='1']")).catch(() => false), "v1's pin is back in the preview", 30000);
    await ctl.locator('#lib .lstu-ver [data-l="s-ver"]').nth(1).click();
    await until(() => ctl.evaluate(() => STU.t.name === "Pick 1" && STU.notes.length === 0), "v2 shown again");
    await until(async () => await tileFrame().evaluate(() => (document.querySelector(".big") || {}).textContent === "1" && !document.querySelector("[data-pin]")).catch(() => false), "v2 is what the preview draws", 30000);
    for (let i = 2; i <= 8; i++) await ctl.evaluate(r => { STU.reply = r; stuFill(); }, answer(i));
    assert.equal(await vers(), "v5,v6,v7,v8,v9", "the last five versions are kept");
    await ctl.locator('#lib .lstu-ver [data-l="s-ver"]').first().click();
    await until(() => ctl.evaluate(() => STU.t.name === "Pick 4"), "the oldest kept version shows");
    // a change made while a version shows stays with it
    await ctl.evaluate(() => { STU.t.name = "Edited"; });
    await ctl.locator('#lib .lstu-ver [data-l="s-ver"]').last().click();
    await until(() => ctl.evaluate(() => STU.t.name === "Pick 8"), "the newest version shows");
    await ctl.locator('#lib .lstu-ver [data-l="s-ver"]').first().click();
    await until(() => ctl.evaluate(() => STU.t.name === "Edited"), "the edit stayed with its version");
    // Save keeps only the version shown, and the others are let go
    await ctl.locator('#lib [data-l="s-save"]').click();
    const kept = await until(() => ctl.evaluate(() => STU.id && !stuDirty() ? STU.id : null), "saved the shown version");
    assert.equal(await ctl.evaluate(() => STU.vers.length), 0);
    assert.equal(await ctl.locator("#lib .lstu-ver").count(), 0, "the version chips are gone after Save");
    const savedFile = await (await fetch(srv.base + "/studio/tile/" + encodeURIComponent(kept))).json();
    assert.equal(savedFile.name, "Edited");
    assert.ok(savedFile.code.includes(">4<"), "the saved code is the shown version's");
    await fetch(srv.base + "/studio/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: kept }) });
    await ctl.evaluate(() => { STU.t = null; STU.id = ""; });          // leave it unsaved: the next checks start from the saved tile
    await ctl.evaluate(id => stuOpen(id), hello);
    await until(() => ctl.evaluate(id => LIB.view === "studio" && STU.id === id && !!STU.t, hello), "the saved tile open again");
    console.log("✓ change it: point at a part, note it, a pin shows, the request names it, with real data no words, a frame can't start it, versions keep five and Save keeps the one shown");

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

    // --- Tile Studio form polish: setting key focus, personal feed clears hosts, clean errors, secret query sync, no-hosts fetch log, Escape confirm ---
    await ctl.evaluate(() => stuOpen(""));
    await ctl.locator('#lib [data-s="set.text.key"]').click();
    await ctl.locator('#lib [data-s="set.text.key"]').fill("greeting");
    await ctl.locator('#lib [data-s="set.text.key"]').blur();
    assert.deepEqual(await ctl.evaluate(() => Object.keys(STU.t.settings)), ["greeting"]);
    await ctl.locator('#lib [data-l="s-adddev"]').click();
    await until(() => ctl.locator("#lib .lstu-log").textContent().then(t => /its controls must list 1 to 12 buttons/.test(t)), "clean control error");
    assert.doesNotMatch(await ctl.locator("#lib .lstu-log").textContent(), /\bit its\b/);
    await ctl.locator('#lib [data-l="s-deldev"]').click();
    await ctl.locator('#lib [data-s="hosts"]').fill("api.example.com");
    await ctl.locator('#lib button.sw[data-s="feed.events"]').click();
    assert.deepEqual(await ctl.evaluate(() => STU.t.hosts), []);
    await ctl.locator('#lib button.sw[data-s="feed.events"]').click();
    await ctl.locator('#lib [data-s="set.greeting.type"]').selectOption("secret");
    await ctl.locator('#lib [data-s="set.greeting.query"]').fill("apikey");
    assert.equal(await ctl.locator('#lib [data-s="set.greeting.header"]').inputValue(), "");
    await ctl.evaluate(() => stuOpen(""));
    await ctl.locator('#lib [data-s="code"]').fill('Tile("my-tile", { render(el) { this.fetch("https://api.example.com/x"); el.textContent = "hi"; } });');
    await until(() => ctl.locator("#lib .lstu-log").textContent().then(t => /can't reach the internet/.test(t)), "no-hosts fetch logged");
    let escDialogs = 0;
    const onDlg = d => { escDialogs++; d.dismiss(); };
    ctl.removeAllListeners("dialog");
    ctl.on("dialog", onDlg);
    await ctl.keyboard.press("Escape");
    assert.equal(escDialogs, 1);
    assert.equal(await ctl.evaluate(() => LIB.view === "studio" && !libEl().hidden), true);
    ctl.removeListener("dialog", onDlg);
    ctl.on("dialog", d => d.accept());
    await ctl.keyboard.press("Escape");
    await until(() => ctl.evaluate(() => LIB.view === "tiles" && STU.t === null), "Escape leaves Studio after confirm");
    console.log("✓ Tile Studio form editing, error wording, no-hosts fetch log, and Escape guard work");

    // --- Controls save() serialization: an in-flight POST /config must never overwrite a newer edit ---
    let slowOnce = true;
    await ctx.route(srv.base + "/config", async route => {
      if (route.request().method() === "POST" && slowOnce) {
        slowOnce = false;
        const resp = await route.fetch();
        await new Promise(r => setTimeout(r, 250));
        return route.fulfill({ response: resp });
      }
      return route.continue();
    });
    await ctl.evaluate(() => { mods.general.settings.name = "First"; save(true); });
    await new Promise(r => setTimeout(r, 500));
    await ctl.evaluate(() => { mods.general.settings.name = "Second"; save(true); });
    await until(async () => (await cfg()).modules.general.settings.name === "Second", "newer edit preserved over in-flight save");
    assert.equal(await ctl.evaluate(() => mods.general.settings.name), "Second");
    console.log("✓ an in-flight Controls save never clobbers a newer edit");

    assert.deepEqual(cerrs, []);
    assert.deepEqual(errs, []);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
