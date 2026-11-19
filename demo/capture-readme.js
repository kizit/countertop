// Capture the personalization gallery and feature GIFs without replacing the overview.
// Needs Node, Playwright with Chromium, Python 3, and ffmpeg on PATH (or FFMPEG).
// Run from any directory: node demo/capture-readme.js [stills|designer|radar]
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { chromium } = require("playwright");
const { basemap, radarFrame } = require("./fixtures/radar-tiles");

const root = path.join(__dirname, "..");
const output = process.env.OUT || path.join(root, "docs", "screenshots");
const fixtures = fs.readFileSync(path.join(__dirname, "fixtures", "demo-data.js"), "utf8");
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, "work", "dashboard.json"), "utf8"));
const size = { width: 1920, height: 1080 };
// Use a documentation address in the UI; Playwright forwards it to the loopback server.
const demoOrigin = "http://192.0.2.20:8090";
const morning = "2026-11-19T09:24:00-07:00";
const afternoon = "2026-11-19T16:32:00-07:00";

function tile(mod, x, y, w, h) {
  return { id: "demo-" + mod, mod, x, y, w, h };
}

function configFor(scene) {
  const config = structuredClone(baseline);
  const { general, look, effects, tiles, pages } = config.modules;
  const main = pages.settings.items.find(page => page.id === "main");
  const set = (id, values) => Object.assign(tiles.settings.items.find(item => item.id === id).settings, values);

  if (scene === "atmospheric") {
    Object.assign(look.settings, { tiles: "See-through", opacity: 38, accent: "#ffcc91" });
    effects.settings.items = [
      { id: "sun", on: true },
      { id: "leaves", on: true, amount: "Some" },
    ];
    set("clock", { style: "Serif", align: "Center", color: "#ffead9", greeting: false, countdowns: false });
    set("weather", { style: "Compact", align: "Left", sun: false, air: false });
    set("dinner", { season: true });
    tiles.settings.items.push(
      { id: "evening-agenda", type: "agenda", name: "From now", settings: { count: 7 } },
      { id: "sunmoon", type: "sunmoon", settings: {} },
    );
    main.slots = [
      tile("clock", 0, 0, 48, 9),
      tile("evening-agenda", 1, 10, 14, 19),
      tile("dinner", 15, 10, 18, 19),
      tile("weather", 33, 10, 14, 7),
      tile("sunmoon", 33, 17, 14, 12),
    ];
  }

  if (scene === "minimal") {
    Object.assign(look.settings, {
      mode: "Light", bg: "Color", bgColor: "#f4f0e8", tiles: "See-through",
      opacity: 60, accent: "#376a63", fx: "Off",
    });
    general.settings.emoji = "Simple symbols";
    set("clock", {
      style: "Serif", align: "Center", ampm: false, color: "#223f3c", greeting: false, countdowns: false,
      design: { on: true, name: "Minimal clock", parts: {
        time: { x: 50, y: 8, s: 48, a: "c", f: "DM Serif Display", c: "#223f3c", w: 400 },
        date: { x: 50, y: 70, s: 8, a: "c", c: "#42625c", w: 500 },
      } },
    });
    set("weather", { style: "Minimal", align: "Center", air: false, sun: false });
    tiles.settings.items.push({ id: "essential-agenda", type: "agenda", name: "Coming up", settings: { count: 6 } });
    main.slots = [
      tile("clock", 1, 7, 23, 14),
      tile("weather", 2, 22, 21, 5),
      tile("essential-agenda", 25, 6, 21, 21),
    ];
  }

  if (scene === "designer" || scene === "radar") look.settings.fx = "Off";
  return config;
}

function setup({ demoOrigin, scene, time }) {
  window.__DEMO_SAVE_CONFIG = scene === "designer";
  if (scene === "radar") {
    const seconds = new Date(time).getTime() / 1000;
    const frames = Array.from({ length: 8 }, (_, i) => ({
      time: seconds + (i - 5) * 600,
      path: "/demo-radar/" + i,
    }));
    window.__DEMO_RADAR = { host: demoOrigin, past: frames.slice(0, 6), nowcast: frames.slice(6) };
  }
  window.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = "#hint{display:none!important}";
    if (scene === "radar") style.textContent +=
      '.v-radar .osmc{font-size:0}.v-radar .osmc::after{content:"Fictional demo map";font-size:13px}';
    document.head.append(style);
    if (scene !== "designer") return;

    // Headless video omits the browser cursor. Mirror actual pointer input in
    // the capture only, so the movements and drag handles are easy to follow.
    const pointer = document.createElement("div");
    pointer.style.cssText = "position:fixed;z-index:99999;pointer-events:none;display:none;width:34px;height:38px";
    pointer.innerHTML = '<svg viewBox="0 0 34 38" aria-hidden="true"><path fill="#fff" stroke="#14283c" stroke-width="2.4" stroke-linejoin="round" d="M2 2l25 18-11 2 5 12-5 2-6-12-8 8z"/></svg>';
    document.body.append(pointer);
    document.addEventListener("pointermove", event => {
      pointer.style.display = "block";
      pointer.style.left = event.clientX + "px";
      pointer.style.top = event.clientY + "px";
    }, true);
  });
}

async function prepare(browser, base, scratch, scene, time, video = false) {
  fs.writeFileSync(path.join(scratch, "work", "dashboard.json"), JSON.stringify(configFor(scene)));
  const context = await browser.newContext({
    viewport: size,
    timezoneId: "America/Denver",
    locale: "en-US",
    ...(video ? { recordVideo: { dir: scratch, size } } : {}),
  });
  await context.addInitScript({
    content: "window.__DEMO_TIME = " + JSON.stringify(time) + ";\n" + fixtures +
      "\n(" + setup + ")(" + JSON.stringify({ demoOrigin, scene, time }) + ");",
  });
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (scene === "radar") {
      const map = url.pathname.match(/^\/(\d+)\/(\d+)\/(\d+)\.png$/);
      const radar = url.pathname.match(/^\/demo-radar\/(\d+)\/256\/(\d+)\/(\d+)\/(\d+)\/2\/1_1\.png$/);
      if (url.host === "tile.openstreetmap.org" && map) {
        return route.fulfill({ contentType: "image/svg+xml", body: basemap(...map.slice(1).map(Number)) });
      }
      if (url.origin === demoOrigin && radar) {
        const [frame, z, x, y] = radar.slice(1).map(Number);
        return route.fulfill({ contentType: "image/svg+xml", body: radarFrame(z, x, y, frame) });
      }
    }
    if (url.origin !== demoOrigin) return route.abort();
    const response = await route.fetch({ url: base + url.pathname + url.search });
    return route.fulfill({ response });
  });
  const page = await context.newPage();
  const start = performance.now();
  await page.clock.setFixedTime(new Date(time));
  await page.goto(demoOrigin + "/dash/content");
  await page.locator('[data-mod="weather"] [data-part="temp"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1250);
  return { page, context, offset: (performance.now() - start) / 1000 };
}

async function captureStills(browser, base, scratch) {
  for (const [scene, time] of [["everyday", morning], ["atmospheric", afternoon], ["minimal", morning]]) {
    const { page, context } = await prepare(browser, base, scratch, scene, time);
    await page.screenshot({ path: path.join(output, scene + ".png") });
    await context.close();
  }
}

async function glide(page, x, y, duration = 600) {
  const steps = Math.ceil(duration / 18);
  const start = glide.position || { x, y };
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    const ease = t * t * (3 - 2 * t);
    await page.mouse.move(start.x + (x - start.x) * ease, start.y + (y - start.y) * ease);
    await page.waitForTimeout(duration / steps);
  }
  glide.position = { x, y };
}

async function moveTo(page, selector, duration) {
  const locator = page.locator(selector).first();
  await locator.scrollIntoViewIfNeeded();
  const { x, y, width, height } = await locator.boundingBox();
  await glide(page, x + width / 2, y + height / 2, duration);
}

async function click(page, selector, duration) {
  await moveTo(page, selector, duration);
  await page.mouse.down();
  await page.mouse.up();
}

async function designer(page) {
  await page.waitForTimeout(1900);
  await moveTo(page, '[data-mod="clock"] [data-part="time"]', 300);
  await page.mouse.down();
  await page.waitForTimeout(780);
  await page.mouse.up();

  await page.waitForTimeout(550);
  await click(page, '[data-act="dznew"]', 650);
  const time = '#edfocus [data-dzp="time"]';
  const digits = page.locator(time);
  await digits.waitFor();
  const initial = await digits.boundingBox();
  await page.waitForTimeout(700);
  await moveTo(page, time);
  const original = glide.position;
  await page.mouse.down();
  await glide(page, original.x + 305, original.y - 36, 950);
  await page.mouse.up();
  assert.ok((await digits.boundingBox()).x - initial.x > 200, "Clock digits should move right");
  await page.waitForTimeout(750);

  await moveTo(page, '#edfocus [data-dzr="time"]', 440);
  const corner = glide.position;
  await page.mouse.down();
  await glide(page, corner.x + 70, corner.y + 39, 800);
  await page.mouse.up();
  assert.ok((await digits.boundingBox()).height > initial.height * 1.1, "Clock digits should grow");
  await page.waitForTimeout(650);
  await click(page, '[data-act="dzc"][data-v="#ffd36e"]', 680);
  await page.waitForTimeout(1150);
  await click(page, '[data-act="dzdone"]', 700);
  await page.waitForTimeout(450);

  const saved = page.waitForResponse(response => response.url().endsWith("/config") &&
    response.request().method() === "POST" && response.ok());
  await click(page, "#edsave", 520);
  const response = await saved;
  const config = response.request().postDataJSON();
  const design = config.modules.tiles.settings.items.find(item => item.id === "clock").settings.design;
  assert.equal(design.parts.time.c, "#ffd36e");
  await page.locator('[data-mod="clock"] .dz [data-part="time"]').waitFor();
  await page.waitForTimeout(2650);
}

async function radar(page) {
  await page.locator('[data-mod="hours"]:not(.stk-off) canvas').waitFor();
  await page.waitForTimeout(5000);
  await page.evaluate(async () => {
    // Change only the fixture's forecast. The usual weather reload and stack
    // tick decide whether and when the radar is shown.
    window.__DEMO_RAIN = true;
    await loadWeather();
  });
  const active = page.locator('[data-mod="radar"]:not(.stk-off)');
  await active.getByText(/Rain in about/).waitFor();
  await active.locator(".frames img").first().waitFor();
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('[data-mod="radar"] .map img')];
    return imgs.length > 0 && imgs.every(img => img.complete && img.naturalWidth > 0);
  });
  await page.waitForTimeout(10400);
}

async function captureVideo(browser, base, scratch, scene, action, name) {
  const { page, context, offset } = await prepare(browser, base, scratch, scene, morning, true);
  const began = performance.now();
  const video = page.video();
  await action(page);
  const duration = (performance.now() - began) / 1000;
  assert.ok(duration <= 20, "The recording exceeded 20 seconds");
  await context.close();
  execFileSync(process.env.FFMPEG || "ffmpeg", [
    "-v", "error", "-y", "-ss", offset.toFixed(3), "-t", duration.toFixed(3), "-i", await video.path(), "-vf",
    "fps=12,scale=960:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
    "-loop", "0", path.join(output, name + ".gif"),
  ], { stdio: "inherit" });
}

async function main() {
  const which = process.argv[2];
  assert.ok(!which || ["stills", "designer", "radar"].includes(which), "Use stills, designer or radar");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "countertop-demo-"));
  fs.mkdirSync(output, { recursive: true });
  fs.cpSync(path.join(root, "tools"), path.join(scratch, "tools"), { recursive: true });
  fs.cpSync(path.join(__dirname, "work"), path.join(scratch, "work"), { recursive: true });
  const server = spawn("python3", ["-u", "-c", [
    "from tools.countertop import Handler, ThreadingHTTPServer",
    'server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)',
    "print(server.server_port)",
    "server.serve_forever()",
  ].join("\n")], { cwd: scratch, stdio: ["ignore", "pipe", "inherit"] });
  let browser;
  try {
    const port = await new Promise((resolve, reject) => {
      server.stdout.once("data", data => resolve(data.toString().trim()));
      server.once("error", reject);
      server.once("exit", code => reject(new Error("Demo server exited: " + code)));
    });
    const base = "http://127.0.0.1:" + port;
    browser = await chromium.launch({ args: ["--window-size=1920,1080"] });
    if (!which || which === "stills") await captureStills(browser, base, scratch);
    if (!which || which === "designer") await captureVideo(browser, base, scratch, "designer", designer, "clock-designer");
    if (!which || which === "radar") await captureVideo(browser, base, scratch, "radar", radar, "radar-takeover");
  } finally {
    if (browser) await browser.close();
    server.kill();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
