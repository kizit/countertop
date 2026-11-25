// Theme Studio end to end in Chromium:
//   - what an AI pastes back is checked strictly: schema, allowed values, color formats, lengths, and nothing that could carry CSS,
//     links or code (hostile and random input never throws and never gets past the checks)
//   - the prompt lists every setting and never includes a wallpaper, album or other private reference
//   - a palette picked from a picture is deterministic, readable and never uploaded
//   - a checked theme opens as an ordinary new-theme draft: same preview, Save and Cancel, nothing saved until Save
//   - a theme's category travels in the share file and is checked on the way in
// Needs Node, Python 3 and Playwright with Chromium. Run with: node tests/theme-studio-check.js
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { until, makeDataDir, startServer, runSuite } = require("./pw-helper");

async function main() {
  const ok = await runSuite("theme-studio-check", async ({ openContext, watchErrors, onCleanup }) => {
    const data = makeDataDir("tstudio", {
      setup: (dir, cfg) => {
        cfg.modules.look.settings.items = [{ id: "tWall", name: "Cozy corner", values: { bg: "Wallpaper", wallpaper: "w-0123456789ab", album: "family", accent: "#c0ffee" }, category: "Cozy" }];
      },
    });
    onCleanup(() => fs.rmSync(data, { recursive: true, force: true }));
    const srv = await startServer(data);
    onCleanup(() => srv.stop());
    const cfg = async () => (await (await fetch(srv.base + "/config")).json()).modules.look.settings;
    const ctx = await openContext({ base: srv.base, viewport: { width: 1280, height: 900 }, label: "tstudio" });
    const ctl = await ctx.newPage();
    watchErrors(ctl, [], { prefix: "ctl", ignoreConsole: t => /reported: config: TypeError: Failed to fetch/.test(t) });
    const uploads = [];
    ctl.on("request", r => { if (/wallpaper/.test(r.url()) && r.method() !== "GET") uploads.push(r.url()); });
    await ctl.goto(srv.base + "/control", { waitUntil: "load" });
    await until(() => ctl.evaluate(() => typeof mods === "object" && !!mods.look && typeof THEMESTUDIO === "object"), "Controls loaded");
    const chk = text => ctl.evaluate(t => THEMESTUDIO.check(t), text);

    // ----- a good reply, in the shapes an AI answers in
    const good = { name: "Oak morning", description: "Warm and calm.", category: "cozy", mode: "Light", accent: "#a2662f", bg: "Color", bgColor: "#efe6d6", tiles: "Solid",
      fontBody: "Nunito", fontDisplay: "Fraunces", surface: "Soft", shape: "Soft", density: "Roomy", textScale: 110, titles: true, textColor: "", themeWins: false };
    let r = await chk(JSON.stringify(good));
    assert.ok(!r.error, JSON.stringify(r));
    assert.equal(r.name, "Oak morning");
    assert.equal(r.category, "Cozy", "a category matches whatever the case");
    assert.deepEqual(r.problems, []);
    assert.equal(r.values.fontDisplay, "Fraunces");
    assert.equal(r.values.textColor, "");
    for (const wrap of ["```json\n" + JSON.stringify(good) + "\n```", "Here you go!\n" + JSON.stringify(good) + "\nEnjoy.", JSON.stringify({ countertop: "theme", format: 1, name: "Oak morning", values: good })]) {
      r = await chk(wrap); assert.ok(!r.error && r.values.shape === "Soft", "reads: " + wrap.slice(0, 20));
    }
    r = await chk(JSON.stringify({ mode: "light", fontBody: "nunito" })); assert.deepEqual(r.values, { mode: "Light", fontBody: "Nunito" }, "names match whatever the case");

    // ----- single settings: what's wrong is left out, and said
    r = await chk(JSON.stringify({ mode: "Light", accent: "#fff", bgColor: "red", textColor: "rgb(1,2,3)", shape: "Pointy", opacity: 500, textScale: "110", dim: 12.5, titles: "yes", density: ["Roomy"] }));
    assert.deepEqual(r.values, { mode: "Light" }, "only the valid setting stays (a non-whole number is refused too)");
    for (const k of ["accent", "bgColor", "textColor", "shape", "opacity", "textScale", "dim", "titles", "density"]) assert.ok(r.problems.some(p => p.startsWith(k + ":")), k + " is reported");
    r = await chk(JSON.stringify({ mode: "Dark", bg: "Wallpaper", wallpaper: "w-0123456789ab", album: "family", photoEvery: 3, fxPick: ["snow"], themeColor: "#fff" }));
    assert.deepEqual(r.values, { mode: "Dark" }, "wallpaper, album, photos and effects can't come from a reply");
    assert.ok(r.problems.some(p => /^bg:/.test(p)));
    assert.deepEqual(r.ignored.sort(), ["album", "fxPick", "photoEvery", "themeColor", "wallpaper"]);
    assert.ok((await chk(JSON.stringify({ mode: "Light", bg: "Color", bgColor: "#f4f0e8", accent: "#f0eee8" }))).notes.some(n => /close to the background/.test(n)));
    assert.ok((await chk(JSON.stringify({ mode: "Dark", bg: "Color", bgColor: "#fdfdfd" }))).notes.some(n => /hard to read/.test(n)), "light text on a pale color is flagged");

    // ----- hostile input: refused outright, everything above stays unbroken
    const hostile = [
      { name: "x", mode: "Dark", description: "url(https://evil.example/x.png)" },
      { name: "<script>alert(1)</script>", mode: "Dark" },
      { name: "ok", mode: "Dark", accent: "#fff; } body { display:none" },
      { name: "ok", mode: "Dark", bgColor: "#000000", gradient: "Dusk", description: "@import 'x.css'" },
      { name: "ok", mode: "Dark", description: "javascript:alert(1)" },
      { name: "ok", mode: "Dark", description: "data:text/html;base64,AAAA" },
      { name: "ok", mode: "Dark", description: "see //evil.example/x" },
      { name: "ok", mode: "Dark", description: "expression(alert(1))" },
      { name: "ok", mode: "Dark", description: "<img src=x onerror=alert(1)>" },
      { name: "ok", mode: "Dark", "x}body{display:none": 1 },
      { name: "ok", mode: "Dark", nested: { a: { b: { c: { d: { e: 1 } } } } } },
      { name: "ok", mode: "Dark", list: new Array(60).fill("x") },
      { name: "ok", mode: "Dark", "back`tick": 1 },
      { name: "ok", mode: "Dark", description: "a\\b" },
    ];
    for (const h of hostile) { r = await chk(JSON.stringify(h)); assert.ok(r.error && !r.values, "refused: " + JSON.stringify(h).slice(0, 60)); }
    // too big, not JSON, not an object, empty
    assert.ok((await chk(JSON.stringify({ mode: "Dark", description: "x".repeat(25000) }))).error, "oversize");
    assert.ok((await chk("{" + '"a":1,'.repeat(4000) + '"b":1}')).error, "oversize");
    for (const t of ["", "   ", "not json", "{broken", "[1,2]", "7", "null", '"mode"', "{}", '{"nothing":"useful"}']) assert.ok((await chk(t)).error, "refused: " + JSON.stringify(t));
    // a prototype can't be polluted, and a poisoned key is just an unknown one
    r = await chk('{"__proto__":{"polluted":true},"constructor":{"x":1},"mode":"Dark"}');
    assert.equal(await ctl.evaluate(() => ({}).polluted), undefined, "no prototype pollution");
    assert.ok(r.error || (Object.keys(r.values).join() === "mode"), "poisoned keys are never taken");

    // ----- fuzz: random JSON never throws, and whatever gets through is valid by Countertop's own settings schema
    const fuzz = await ctl.evaluate(() => {
      let seed = 1234567; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
      const pick = a => a[Math.floor(rnd() * a.length)];
      const junk = ["", "x", "#fff", "#12345g", "#56703B", "Dark", "Light", "Soft", "url(x)", "<b>", "}", "💥", "1e999", -1, 0, 1, 80, 140, 3.5, 1e99, NaN, true, false, null, [], {}, [1], { a: 1 }, "a".repeat(5000), "\u0000", "Roomy", "Nunito", "Bebas Neue"];
      const keys = THEMESTUDIO.KEYS.concat(["name", "description", "category", "wallpaper", "album", "x", "__proto__", "constructor", "values", "fxPick"]);
      const LSD = schema.look.settings; let valid = 0, refused = 0, threw = 0;
      for (let i = 0; i < 3000; i++) {
        const o = {}; for (let n = 1 + Math.floor(rnd() * 8); n--;) o[pick(keys)] = rnd() < .5 ? pick(junk) : pick(THEMESTUDIO.CHOICES[pick(Object.keys(THEMESTUDIO.CHOICES))]);
        let text; try { text = JSON.stringify(o); } catch (e) { continue; }
        if (rnd() < .1) text = text.slice(0, Math.floor(rnd() * text.length));
        let res; try { res = THEMESTUDIO.check(text); } catch (e) { threw++; continue; }
        if (res.error) { refused++; continue; }
        valid++;
        for (const k in res.values) {
          if (!THEMESTUDIO.KEYS.includes(k)) return { bad: "unexpected key " + k + " from " + text };
          if (!(res.values[k] === "" && THEMESTUDIO.COLORS[k]) && libClean(LSD[k], res.values[k]) !== res.values[k]) return { bad: k + " = " + JSON.stringify(res.values[k]) + " isn't valid by the schema, from " + text };
        }
        if ([res.name, res.description].concat(Object.values(res.values).filter(x => typeof x === "string")).some(x => /[<>{}`;\\]|url\s*\(/i.test(x))) return { bad: "unsafe text got through: " + text };
        if (res.name.length > 60 || res.description.length > 500) return { bad: "too long" };
      }
      return { valid, refused, threw };
    });
    assert.equal(fuzz.bad, undefined, fuzz.bad);
    assert.equal(fuzz.threw, 0, "never throws");
    assert.ok(fuzz.valid > 100 && fuzz.refused > 100, "the fuzz covers both outcomes " + JSON.stringify(fuzz));
    // the checker's lists are the schema's lists
    assert.deepEqual(await ctl.evaluate(() => {
      const LSD = schema.look.settings, bad = [];
      for (const k in THEMESTUDIO.CHOICES) { const have = THEMESTUDIO.CHOICES[k], want = LSD[k].choices.filter(c => k !== "bg" || !["Wallpaper", "Photos"].includes(c)); if (JSON.stringify(have) !== JSON.stringify(want)) bad.push(k); }
      for (const k in THEMESTUDIO.INTS) if (LSD[k].min !== THEMESTUDIO.INTS[k][0] || LSD[k].max !== THEMESTUDIO.INTS[k][1]) bad.push(k);
      for (const k of THEMESTUDIO.BOOLS) if (LSD[k].type !== "bool") bad.push(k);
      for (const k in THEMESTUDIO.COLORS) if (LSD[k].type !== "color") bad.push(k);
      const covered = new Set(THEMESTUDIO.KEYS.concat(THELIBLOCAL(), ["photoEvery", "fxPick"]));
      for (const k of Object.keys(THEMELIB.BASE)) if (!covered.has(k)) bad.push("uncovered " + k);
      return bad;
      function THELIBLOCAL() { return THEMELIB.LOCAL; }
    }), [], "the Studio's settings match the schema");

    // ----- the prompt: every setting, the theme to start from, and nothing private
    const prompt = await ctl.evaluate(() => { THS.want = "Calm and warm"; THS.from = "tWall"; return thsPrompt(); });
    for (const k of await ctl.evaluate(() => THEMESTUDIO.KEYS)) assert.ok(prompt.includes('"' + k + '"'), "the prompt lists " + k);
    assert.ok(prompt.includes("Calm and warm") && prompt.includes("#c0ffee"), "the wish and the starting theme are in it");
    for (const secret of ["w-0123456789ab", "family", "wallpaper", "album"]) assert.ok(!prompt.includes(secret), "the prompt never mentions " + secret);
    assert.ok(!/Wallpaper/.test(prompt.split("My current theme")[1] || ""), "a theme on a wallpaper is sent as a gradient");

    // ----- a palette from a picture
    const pal = await ctl.evaluate(() => {
      const mk = (w, h, f) => { const a = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { const c = f(i % w, Math.floor(i / w)); a.set([c[0], c[1], c[2], c.length > 3 ? c[3] : 255], i * 4); } return a; };
      const dark = mk(32, 32, (x, y) => (x < 24 ? [20, 40, 60] : [230, 120, 30]));
      const light = mk(32, 32, (x, y) => (x < 24 ? [240, 232, 214] : [60, 120, 70]));
      const gray = mk(32, 32, () => [128, 128, 128]);
      const clear = mk(32, 32, () => [10, 10, 10, 0]);
      const C = THEMESTUDIO.contrast;
      const a = THEMESTUDIO.palette(dark), b = THEMESTUDIO.palette(light);
      return { a, again: THEMESTUDIO.palette(dark), b, gray: THEMESTUDIO.palette(gray), clear: THEMESTUDIO.palette(clear), tiny: THEMESTUDIO.palette(new Uint8ClampedArray(8)),
        ca: C(a.values.accent, a.values.bgColor), cb: C(b.values.accent, b.values.bgColor), fits: THEMESTUDIO.check(JSON.stringify(a.values)).problems.length === 0 };
    });
    assert.equal(pal.a.values.mode, "Dark");
    assert.deepEqual(pal.a, pal.again, "the same picture gives the same palette");
    assert.match(pal.a.values.bgColor, /^#[0-9a-f]{6}$/);
    assert.ok(parseInt(pal.a.values.bgColor.slice(1, 3), 16) < 80, "a dark background: " + pal.a.values.bgColor);
    assert.ok(parseInt(pal.a.values.accent.slice(1, 3), 16) > parseInt(pal.a.values.accent.slice(5, 7), 16), "the orange stands out as the accent: " + pal.a.values.accent);
    assert.equal(pal.b.values.mode, "Light");
    assert.ok(pal.ca >= 3.5 && pal.cb >= 3.5, "the accent can be read on the background " + pal.ca + " " + pal.cb);
    assert.ok(pal.gray && /^#[0-9a-f]{6}$/.test(pal.gray.values.accent), "a gray picture still gives a theme");
    assert.equal(pal.clear, null); assert.equal(pal.tiny, null);
    assert.ok(pal.fits, "a palette passes the same checks as a reply");

    // ----- the draft flow, end to end: Studio → check → open in the editor → Save (or Cancel)
    await ctl.evaluate(() => { go("tstudio"); });
    await until(() => ctl.evaluate(() => !!document.querySelector('[data-tst="check"]')), "the Studio screen");
    const before = (await cfg()).items.length;
    await ctl.fill('[data-tst-in="paste"]', JSON.stringify(good));
    await ctl.click('[data-tst="check"]');
    await until(() => ctl.evaluate(() => !!document.querySelector('[data-tst-res="paste"] .lpic')), "the checked theme is shown");
    if (process.env.SHOTS) await ctl.screenshot({ path: process.env.SHOTS + "/studio-checked.png", fullPage: true });
    assert.equal((await cfg()).items.length, before, "checking saves nothing");
    await ctl.click('[data-tst="open"]');
    await until(() => ctl.evaluate(() => !!document.querySelector(".ltabs") && !!DRAFT), "the editor opens");
    const d = await ctl.evaluate(() => ({ id: DRAFT.id, isNew: DRAFT.isNew, name: DRAFT.name, cat: DRAFT.category, v: Object.assign({}, DRAFT.values), title: document.querySelector(".big").textContent, bar: document.querySelector(".draftbar span").textContent }));
    assert.equal(d.id, "new"); assert.equal(d.isNew, true); assert.equal(d.name, "Oak morning"); assert.equal(d.cat, "Cozy");
    assert.equal(d.v.fontBody, "Nunito"); assert.equal(d.v.accent, "#a2662f"); assert.equal(d.v.density, "Roomy");
    assert.equal(d.bar, "Not saved yet");
    await until(() => ctl.evaluate(() => !!PV.trial), "the preview follows the draft");
    assert.equal((await cfg()).items.length, before, "opening saves nothing");
    if (process.env.SHOTS) await ctl.screenshot({ path: process.env.SHOTS + "/studio-editor.png", fullPage: true });
    // it edits like any draft, and Cancel leaves nothing behind
    await ctl.click('.ltabs [data-id="type"]'); await ctl.click('.opt[data-lk="fontBody"][data-lv="Outfit"]');
    assert.equal(await ctl.evaluate(() => DRAFT.values.fontBody), "Outfit");
    await ctl.click('[data-lact="cancel"]');
    await until(() => ctl.evaluate(() => !DRAFT), "the draft is gone");
    assert.equal((await cfg()).items.length, before, "Cancel saves nothing");
    // again, and Save
    await ctl.evaluate(() => { go("tstudio"); });
    await until(() => ctl.evaluate(() => !!document.querySelector('[data-tst="check"]')), "the Studio screen again");
    assert.equal(await ctl.inputValue('[data-tst-in="paste"]'), JSON.stringify(good), "what was pasted is still there");
    await ctl.click('[data-tst="check"]');
    await ctl.click('[data-tst="open"]');
    await until(() => ctl.evaluate(() => !!document.querySelector(".draftbar")), "the editor opens again");
    await ctl.click('[data-lact="save"]');
    await until(async () => (await cfg()).items.length === before + 1, "saved");
    const saved = (await cfg()).items.find(t => t.name === "Oak morning");
    assert.equal(saved.values.fontDisplay, "Fraunces"); assert.equal(saved.values.accent, "#a2662f"); assert.equal(saved.category, "Cozy");
    assert.ok(!saved.values.wallpaper && !saved.values.album, "no wallpaper or album");
    // a reply with problems still opens, with the good settings only
    await ctl.evaluate(() => { go("tstudio"); }); await until(() => ctl.evaluate(() => !!document.querySelector('[data-tst="check"]')), "Studio");
    await ctl.fill('[data-tst-in="paste"]', JSON.stringify({ name: "Half", mode: "Dark", accent: "blue", shape: "Soft" }));
    await ctl.click('[data-tst="check"]');
    await until(() => ctl.evaluate(() => /Left out: accent/.test(document.body.textContent)), "the problem is shown");
    await ctl.click('[data-tst="open"]');
    await until(() => ctl.evaluate(() => !!DRAFT && DRAFT.values.shape === "Soft"), "opens with what was valid");
    assert.equal(await ctl.evaluate(() => DRAFT.values.accent), "#7cb7ff", "the left-out setting keeps the starting theme's value");
    await ctl.click('[data-lact="cancel"]');
    // hostile text pasted in the screen: an error, nothing opens
    await ctl.evaluate(() => { go("tstudio"); }); await until(() => ctl.evaluate(() => !!document.querySelector('[data-tst="check"]')), "Studio");
    await ctl.fill('[data-tst-in="paste"]', '{"name":"x","mode":"Dark","description":"url(http://evil.example/a.png)"}');
    await ctl.click('[data-tst="check"]');
    await until(() => ctl.evaluate(() => /isn't plain theme data/.test(document.body.textContent)), "the refusal is shown");
    assert.equal(await ctl.evaluate(() => !!document.querySelector('[data-tst="open"]')), false, "nothing to open");

    // ----- from a wallpaper: picked on this device, never uploaded
    const png = Buffer.from(await ctl.evaluate(async () => {
      const c = document.createElement("canvas"); c.width = c.height = 96; const x = c.getContext("2d");
      x.fillStyle = "#16324a"; x.fillRect(0, 0, 96, 96); x.fillStyle = "#e8792b"; x.fillRect(60, 10, 30, 30);
      const b = await new Promise(r => c.toBlob(r, "image/png")); return btoa(String.fromCharCode(...new Uint8Array(await b.arrayBuffer())));
    }), "base64");
    await ctl.setInputFiles('[data-tst-file]', { name: "kitchen photo.png", mimeType: "image/png", buffer: png });
    await until(() => ctl.evaluate(() => !!document.querySelector('[data-tst-res="wall"] .lpic')), "a palette from the picture");
    const w = await ctl.evaluate(() => THS.wall);
    assert.equal(w.values.mode, "Dark"); assert.match(w.name, /^From kitchen photo/); assert.ok(w.swatches.length >= 2);
    await ctl.click('[data-tst-res="wall"] [data-tst="open"]');
    await until(() => ctl.evaluate(() => !!DRAFT && DRAFT.values.bgColor === THS.wall.values.bgColor), "the palette opens in the editor");
    assert.equal(await ctl.evaluate(() => DRAFT.values.bg), "Color");
    await ctl.click('[data-lact="cancel"]');
    await ctl.evaluate(() => { go("tstudio"); }); await until(() => ctl.evaluate(() => !!document.querySelector('[data-tst-file]')), "Studio");
    await ctl.setInputFiles('[data-tst-file]', { name: "x.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") });
    await until(() => ctl.evaluate(() => /PNG, JPEG or WebP/.test(document.body.textContent)), "an SVG is refused");
    assert.deepEqual(uploads, [], "no picture was uploaded anywhere");
    if (process.env.SHOTS) await ctl.screenshot({ path: process.env.SHOTS + "/studio-screen.png", fullPage: true });

    // ----- exports and the gallery: portable output has no wallpaper or album data, and the category travels
    const out = await ctl.evaluate(() => {
      SHARE.key = ""; const pkg = (shareScreen("theme:tWall"), sharePack("theme:tWall")), code = libCode(pkg), back = JSON.parse(b64dec(code.slice(4)));
      return { pkg, text: JSON.stringify(back) + thsPrompt(), read: themeRead({ name: "n", category: "Retro", values: { mode: "Dark" } }).category, bad: themeRead({ name: "n", category: "Spicy", values: { mode: "Dark" } }).category, html: shareScreen("theme:tWall") };
    });
    assert.equal(out.pkg.category, "Cozy", "a saved theme's category is the share default");
    for (const secret of ["w-0123456789ab", "family", "wallpaper", "album"]) assert.ok(!out.text.includes(secret), "portable output never includes " + secret);
    assert.equal(out.pkg.values.bg, "Gradient");
    assert.equal(out.read, "Retro"); assert.equal(out.bad, "", "an unknown category is dropped on the way in");
    assert.ok(/data-sh="category"/.test(out.html) && ["Minimalist", "Cozy", "Retro", "Seasonal", "Nature", "Futuristic", "High Contrast"].every(c => out.html.includes(c)));
    console.log("✓ Theme Studio checks what it's given, keeps the draft flow, and keeps local things home");
  });
  process.exit(ok ? 0 : 1);
}
main();
