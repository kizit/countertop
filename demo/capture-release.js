// Screenshots and GIFs for a release story: the Library, themes, effects, Community and sharing,
// all with the fictional demo household and a fictional gallery (demo/fixtures/gallery-demo.js).
// Needs Node, Playwright with Chromium, Python 3 and ffmpeg. Run: node demo/capture-release.js [stills|tiles|gifs]
const http = require("node:http");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const output = process.env.OUT || path.join(root, "docs", "screenshots");
const fixtures = fs.readFileSync(path.join(__dirname, "fixtures", "demo-data.js"), "utf8");
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, "work", "dashboard.json"), "utf8"));
const gallery = require("./fixtures/gallery-demo.js");
const size = { width: 1600, height: 1000 };
const demoOrigin = "http://192.0.2.20:8090";
const morning = "2026-11-19T09:24:00-07:00";
const sleep = ms => new Promise(r => setTimeout(r, ms));

function init({ demoOrigin }) {
  window.__DEMO_SAVE_CONFIG = true;
  window.addEventListener("DOMContentLoaded", () => {
    const s = document.createElement("style");
    s.textContent = "#hint{display:none!important}";
    document.head.append(s);
  });
}

async function open(browser, base, scratch, { video = false, viewport = size, path: p = "/control" } = {}) {
  fs.writeFileSync(path.join(scratch, "work", "dashboard.json"), JSON.stringify(baseline));
  const context = await browser.newContext({
    viewport, timezoneId: "America/Denver", locale: "en-US",
    ...(video ? { recordVideo: { dir: scratch, size: viewport } } : {}),
  });
  await context.addInitScript({ content: "window.__DEMO_TIME = " + JSON.stringify(morning) + ";\n(" + init + ")(" + JSON.stringify({ demoOrigin }) + ");\n" + fixtures });
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== demoOrigin) return route.abort();
    const food = url.pathname.match(/^\/demo-food\/([a-z-]+\.jpg)$/);
    if (food) return route.fulfill({ contentType: "image/jpeg", body: fs.readFileSync(path.join(__dirname, "fixtures", "food", food[1])) });
    return route.fulfill({ response: await route.fetch({ url: base + url.pathname + url.search, headers: { ...route.request().headers(), host: url.host } }) });
  });
  const page = await context.newPage();
  const start = performance.now();
  await page.clock.setFixedTime(new Date(morning));
  await page.goto(demoOrigin + p);
  await page.waitForTimeout(2500);
  return { page, context, start };
}


const GIF_PALETTE = "split[a][b];[a]palettegen=max_colors=" + (process.env.GIF_COLORS || 128) + ":stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle";

// Headless video has no cursor, so draw one that follows the pointer.
async function withPointer(page) {
  await page.evaluate(() => {
    if (document.getElementById("demo-pointer")) return;
    const p = document.createElement("div");
    p.id = "demo-pointer";
    p.style.cssText = "position:fixed;z-index:99999;pointer-events:none;display:none;width:30px;height:34px";
    p.innerHTML = '<svg viewBox="0 0 34 38"><path fill="#fff" stroke="#14283c" stroke-width="2.4" stroke-linejoin="round" d="M2 2l25 18-11 2 5 12-5 2-6-12-8 8z"/></svg>';
    document.body.append(p);
    document.addEventListener("pointermove", e => { p.style.display = "block"; p.style.left = e.clientX + "px"; p.style.top = e.clientY + "px"; }, true);
  });
}
async function point(page, loc) {
  const b = await loc.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 60), { steps: 14 });
  await page.waitForTimeout(250);
}
async function tap(page, loc) { await point(page, loc); await loc.click(); }

async function toLibrary(page, view) {
  await page.getByText("Theme", { exact: true }).first().click();
  await page.locator('.lrail button[data-id="' + (view || "themes") + '"]').click();
  await page.waitForTimeout(1200);
}
const rail = (page, id) => page.locator('.lrail button[data-id="' + id + '"]');

async function stills(browser, base, scratch) {
  let { page, context } = await open(browser, base, scratch);
  await toLibrary(page, "layouts");
  await page.screenshot({ path: path.join(output, "library-overview.png") });
  await rail(page, "community").click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(output, "community-gallery.png") });
  // Import: a theme a friend sent as a share code.
  const code = "CT1." + Buffer.from(JSON.stringify({ countertop: "theme", format: 1, name: "Sunday morning", description: "Soft light colors with see-through tiles.",
    made: "2026-11-21", values: { mode: "Light", bg: "Color", bgColor: "#f2ebe0", accent: "#3f7f6f", tiles: "See-through", opacity: 55, fx: "Off" } })).toString("base64url");
  await rail(page, "import").click();
  await page.locator('[data-l="paste"]').fill(code);
  await page.locator('[data-l="openpaste"]').click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(output, "share-import.png") });
  await context.close();
}

async function record(browser, base, scratch, name, script, opts = {}) {
  const { page, context, start } = await open(browser, base, scratch, { video: true, ...opts });
  await withPointer(page);
  const t0 = performance.now();
  await script(page);
  const seconds = (performance.now() - t0) / 1000;
  const video = page.video();
  await context.close();
  return { file: await video.path(), from: (t0 - start) / 1000, seconds };
}
function gif(clips, name, fps = 8, width = 800, speed = 1) {
  const args = ["-v", "error", "-y"];
  clips.forEach(c => args.push("-ss", c.from.toFixed(3), "-t", c.seconds.toFixed(3), "-i", c.file));
  const parts = clips.map((c, i) => "[" + i + ":v]setpts=PTS/" + speed + ",fps=" + fps + ",scale=" + width + ":-2:flags=lanczos,setpts=PTS-STARTPTS,format=yuv420p[v" + i + "]");
  parts.push(clips.map((c, i) => "[v" + i + "]").join("") + "concat=n=" + clips.length + ":v=1:a=0[o]");
  parts.push("[o]" + GIF_PALETTE);
  args.push("-filter_complex", parts.join(";"), "-loop", "0", path.join(output, name + ".gif"));
  execFileSync(process.env.FFMPEG || "ffmpeg", args, { stdio: "inherit" });
}

async function tour(browser, base, scratch) {
  const a = await record(browser, base, scratch, "tour", async page => {
    await page.waitForTimeout(800);
    await tap(page, page.getByText("Theme", { exact: true }).first());
    await page.waitForTimeout(500);
    await tap(page, rail(page, "layouts"));
    await page.waitForTimeout(1600);
    await tap(page, page.locator('.lmain [data-l="open"]').filter({ hasText: "Kitchen table" }));
    await page.waitForTimeout(2600);
    await tap(page, page.locator('[data-l="try"]'));
    await page.waitForTimeout(1800);
  });
  const b = await record(browser, base, scratch, "tour-dash", async page => {
    await page.waitForTimeout(3500);
  }, { path: "/dash/content" });
  gif([a, b], "library-tour");
  await fetch(base + "/trial/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
}

async function themesEffects(browser, base, scratch) {
  const a = await record(browser, base, scratch, "te", async page => {
    await page.waitForTimeout(300);
    await tap(page, page.getByText("Theme", { exact: true }).first());
    await page.waitForTimeout(900);
    await tap(page, page.locator(".lmain").getByText("Glass", { exact: true }));
    await page.waitForTimeout(1800);
    await tap(page, rail(page, "effects"));
    await page.waitForTimeout(500);
    await tap(page, page.locator('[data-fxa="new"]'));
    await page.waitForTimeout(900);
    const name = page.locator('input[data-fxd="name"]'); await point(page, name); await name.fill(""); await name.type("Pumpkin season", { delay: 45 });
    const g = page.locator('input[data-fxd="glyphs"]'); await point(page, g); await g.fill(""); await g.type("🎃 🍂 🦇", { delay: 90 }); await page.keyboard.press("Tab");
    await page.waitForTimeout(3200);
  });
  gif([a], "themes-effects", 8, 760, 1.3);
}

async function community(browser, base, scratch) {
  const a = await record(browser, base, scratch, "co", async page => {
    await page.waitForTimeout(600);
    await tap(page, page.getByText("Theme", { exact: true }).first());
    await page.waitForTimeout(600);
    await tap(page, rail(page, "community"));
    await page.waitForTimeout(2000);
    await tap(page, page.locator(".lmain button, .lmain [data-cm]").filter({ hasText: "Soft linen" }).first());
    await page.waitForTimeout(3000);
    await tap(page, page.getByRole("button", { name: /Download|Add to my themes/ }).first());
    await page.waitForTimeout(2500);
  });
  gif([a], "community-browse");
}

// Community tiles: what a tile asks before you download it, and Tile Studio.
async function tiles(browser, base, scratch) {
  const { page, context } = await open(browser, base, scratch);
  await toLibrary(page, "community");
  await page.waitForTimeout(2000);
  await page.locator(".lmain button, .lmain [data-cm]").filter({ hasText: "Porch lights" }).first().click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(output, "community-tile-permissions.png") });
  await rail(page, "tiles").click();
  await page.waitForTimeout(1000);
  await page.locator('[data-l="s-new"]').first().click();
  await page.waitForTimeout(2500);
  await page.locator('input[data-s="name"]').fill("Days to summer");
  await page.locator('textarea[data-s="description"]').fill("Counts down the days until the first day of summer.");
  await page.locator('textarea[data-s="code"]').fill('Tile("days-to-summer", {\n  css: ".ds{text-align:center} .ds b{display:block;font-size:64px;color:var(--accent)}",\n  render(el){\n    const now = new Date(), y = now.getMonth() > 5 ? now.getFullYear() + 1 : now.getFullYear();\n    const days = Math.ceil((new Date(y, 5, 21) - now) / 864e5);\n    el.innerHTML = "<div class=ds><b>" + days + "</b>days until summer</div>";\n  }\n});\n');
  await page.locator('textarea[data-s="description"]').click();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: path.join(output, "tile-studio.png") });
  await context.close();
}

async function main() {
  const which = process.argv[2] || "stills";
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "countertop-release-"));
  fs.mkdirSync(output, { recursive: true });
  fs.cpSync(path.join(root, "tools"), path.join(scratch, "tools"), { recursive: true });
  fs.cpSync(path.join(__dirname, "work"), path.join(scratch, "work"), { recursive: true });
  const gal = http.createServer((q, r) => { r.setHeader("content-type", "application/json"); r.end(JSON.stringify(gallery)); }).listen(0, "127.0.0.1");
  await new Promise(r => gal.once("listening", r));
  const server = spawn("python3", ["-u", "-c", [
    "from tools.countertop import Handler, ThreadingHTTPServer",
    'server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)', "print(server.server_port)", "server.serve_forever()"].join("\n")],
    { cwd: scratch, env: { ...process.env, COUNTERTOP_DATA: path.join(scratch, "work"), COUNTERTOP_NO_UPDATE_CHECK: "1",
        COUNTERTOP_GALLERY_URL: "http://127.0.0.1:" + gal.address().port + "/index.json" }, stdio: ["ignore", "pipe", "inherit"] });
  let browser;
  try {
    const port = await new Promise((res, rej) => { server.stdout.once("data", d => res(d.toString().trim())); server.once("exit", c => rej(new Error("server exited " + c))); });
    const base = "http://127.0.0.1:" + port;
    browser = await chromium.launch();
    if (which === "stills" || which === "all") await stills(browser, base, scratch);
    if (which === "tiles" || which === "all") await tiles(browser, base, scratch);
    if (which === "tour" || which === "gifs" || which === "all") await tour(browser, base, scratch);
    if (which === "themes" || which === "gifs" || which === "all") await themesEffects(browser, base, scratch);
    if (which === "community" || which === "gifs" || which === "all") await community(browser, base, scratch);
    if (process.env.KEEP) fs.cpSync(scratch, process.env.KEEP, { recursive: true });
  } finally {
    if (browser) await browser.close();
    server.kill(); gal.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
