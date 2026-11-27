// Shared Playwright harness for Countertop's browser, touch and UI/UX checks.
// Starts the real server on a free port with an isolated data folder, provides CDP touch gestures
// (matching a real touchscreen / Silk on Echo Show), and saves screenshots + Playwright traces into
// test-results/<suite>/ only when a check fails.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const fixtures = fs.readFileSync(path.join(root, "demo", "fixtures", "demo-data.js"), "utf8");
const py = process.env.PYTHON || "python3";
const resultsRoot = process.env.COUNTERTOP_TEST_RESULTS || path.join(root, "test-results");

const freePort = () => new Promise(res => {
  const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, what, ms = 20000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => false);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what);
    await sleep(100);
  }
};

function makeDataDir(prefix, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "countertop-" + prefix + "-"));
  if (!opts.empty) {
    for (const f of fs.readdirSync(path.join(root, "demo", "work"))) {
      fs.copyFileSync(path.join(root, "demo", "work", f), path.join(dir, f));
    }
    const cfgFile = path.join(dir, "dashboard.json");
    const cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
    if (!opts.keepNight && cfg.modules && cfg.modules.night) cfg.modules.night.on = false;
    if (opts.setup) opts.setup(dir, cfg);
    fs.writeFileSync(cfgFile, JSON.stringify(cfg));
  } else if (opts.setup) {
    opts.setup(dir, null);
  }
  return dir;
}

async function startServer(dataDir, envExtra = {}) {
  const port = await freePort();
  const base = "http://127.0.0.1:" + port;
  const proc = spawn(py, [path.join(root, "tools", "countertop.py"), "--port", String(port)], {
    env: { ...process.env, COUNTERTOP_DATA: dataDir, COUNTERTOP_NO_UPDATE_CHECK: "1", ...envExtra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  proc.stdout.on("data", d => { log += d; });
  proc.stderr.on("data", d => { log += d; });
  for (let i = 0; ; i++) {
    try { if ((await fetch(base + "/version")).ok) break; } catch (e) { /* starting */ }
    if (i > 50) { proc.kill(); throw new Error("server didn't start:\n" + log); }
    await sleep(200);
  }
  return { port, base, proc, log: () => log, stop: () => { try { proc.kill(); } catch (e) {} } };
}

async function startFakeHA() {
  const port = await freePort();
  const proc = spawn(py, [path.join(root, "tests", "fake_ha.py"), "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  proc.stdout.on("data", d => { log += d; });
  proc.stderr.on("data", d => { log += d; });
  for (let i = 0; ; i++) {
    try { if ((await fetch("http://127.0.0.1:" + port + "/api/config", { headers: { Authorization: "Bearer countertop-test" } })).ok) break; }
    catch (e) { /* starting */ }
    if (i > 40) { proc.kill(); throw new Error("fake_ha didn't start:\n" + log); }
    await sleep(100);
  }
  return {
    port,
    url: "http://127.0.0.1:" + port,
    proc,
    log: () => log,
    calls: () => log.split("\n").filter(l => l.startsWith("called ")),
    stop: () => { try { proc.kill(); } catch (e) {} },
  };
}

// Wrap a suite so failures automatically capture Playwright traces + page screenshots into test-results/<suite>/.
async function runSuite(suiteName, fn) {
  const browser = await chromium.launch();
  const tracked = []; // { ctx, label, tracing }
  const cleanups = [];
  const onCleanup = cb => cleanups.push(cb);

  async function openContext(opts = {}) {
    const {
      base,
      viewport = { width: 1920, height: 1080 },
      hasTouch = false,
      isMobile = false,
      userAgent = "",
      useFixtures = false,
      demoTime = null,
      realSaves = false,
      stubFullscreen = hasTouch,
      interceptReports = false,
      label = "ctx-" + (tracked.length + 1),
      trace = true,
    } = opts;
    const ctxOpts = { viewport, hasTouch, isMobile };
    if (userAgent) ctxOpts.userAgent = userAgent;
    const ctx = await browser.newContext(ctxOpts);
    let tracing = false;
    if (trace) {
      await ctx.tracing.start({ screenshots: true, snapshots: true }).then(() => { tracing = true; }).catch(() => {});
    }
    const initParts = [];
    if (useFixtures) {
      let flags = realSaves ? "window.__DEMO_SAVE_CONFIG = true; window.__DEMO_REAL_NOTES = true;\n" : "";
      if (demoTime) flags += "window.__DEMO_TIME = " + JSON.stringify(new Date(demoTime).toISOString()) + ";\n";      // demo events are placed relative to this, not to the machine's date
      initParts.push("if (!location.pathname.startsWith('/tile-frame')) {\n" + flags + fixtures + "\n}");
    }
    if (stubFullscreen) initParts.push("Element.prototype.requestFullscreen = function () { return Promise.resolve(); };");
    if (interceptReports) {
      initParts.push(`;(() => { const f = window.fetch;
        window.fetch = function (u, o) {
          if (String(u).endsWith("/report") && o && o.body) {
            try { const b = JSON.parse(o.body); if (b.task === "js-error") console.error("reported: " + b.error); } catch (e) {}
          }
          return f.apply(this, arguments);
        }; })();`);
    }
    if (initParts.length) await ctx.addInitScript({ content: initParts.join("\n") });
    if (base) {
      await ctx.route("**/*", r => {
        const u = r.request().url();
        return u.startsWith(base) || u.startsWith("data:") || u.startsWith("blob:") ? r.continue() : r.abort();
      });
    }
    const rec = { ctx, label, tracing, closed: false };
    const origClose = ctx.close.bind(ctx);
    ctx.close = async () => {
      if (rec.closed) return;
      rec.closed = true;
      if (rec.tracing) { rec.tracing = false; await ctx.tracing.stop().catch(() => {}); }
      return origClose();
    };
    tracked.push(rec);
    return ctx;
  }

  function watchErrors(page, errors, opts = {}) {
    page.on("pageerror", e => errors.push((opts.prefix ? opts.prefix + ": " : "") + (e.stack || e.message)));
    page.on("console", m => {
      if (m.type() !== "error") return;
      const t = m.text();
      if (/Failed to load resource|net::ERR_/.test(t)) return;
      if (opts.ignoreConsole && opts.ignoreConsole(t)) return;
      errors.push((opts.prefix ? opts.prefix + ": " : "") + "console.error " + t);
    });
  }

  let failed = false;
  try {
    await fn({ browser, openContext, watchErrors, onCleanup });
  } catch (err) {
    failed = true;
    const outDir = path.join(resultsRoot, suiteName.replace(/[^a-z0-9_-]+/gi, "-"));
    fs.mkdirSync(outDir, { recursive: true });
    let saved = 0;
    for (const rec of tracked) {
      if (rec.closed) continue;
      const safe = rec.label.replace(/[^a-z0-9_-]+/gi, "-");
      const pages = rec.ctx.pages();
      for (let i = 0; i < pages.length; i++) {
        const shot = path.join(outDir, safe + "-p" + (i + 1) + ".png");
        await pages[i].screenshot({ path: shot, fullPage: false }).then(() => { saved++; }).catch(() => {});
      }
      if (rec.tracing) {
        rec.tracing = false;
        const tr = path.join(outDir, safe + "-trace.zip");
        await rec.ctx.tracing.stop({ path: tr }).then(() => { saved++; }).catch(() => {});
      }
    }
    if (saved) console.error("Saved failure artifacts in " + path.relative(root, outDir));
    throw err;
  } finally {
    for (const rec of tracked) {
      if (!rec.closed && rec.tracing) { rec.tracing = false; await rec.ctx.tracing.stop().catch(() => {}); }
    }
    await browser.close().catch(() => {});
    for (const cb of cleanups.reverse()) { try { await cb(); } catch (e) {} }
  }
  return !failed;
}

// Real touchscreen events through CDP (same event stream a touchscreen / Echo Show sends).
async function touchSession(ctx, page, opts = {}) {
  const cdp = await ctx.newCDPSession(page);
  if (opts.cpuRate && opts.cpuRate > 1) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: opts.cpuRate });
  }
  const send = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
  const touch = (type, x, y) => send(type, type === "touchEnd" || type === "touchCancel" ? [] : [{ x: Math.round(x), y: Math.round(y), id: 1 }]);
  const tap = async (x, y) => { await touch("touchStart", x, y); await sleep(60); await touch("touchEnd"); };
  const hold = async (x, y, ms = 1000, jitter = 0) => {
    await touch("touchStart", x, y);
    if (jitter) {
      await sleep(Math.floor(ms / 3));
      await touch("touchMove", x + jitter, y + jitter);
      await sleep(ms - Math.floor(ms / 3));
    } else {
      await sleep(ms);
    }
    await touch("touchEnd");
  };
  const drag = async (x1, y1, x2, y2, steps = 12, stepMs = 18) => {
    await touch("touchStart", x1, y1);
    await sleep(30);
    for (let i = 1; i <= steps; i++) {
      await touch("touchMove", x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps);
      await sleep(stepMs);
    }
    await sleep(30);
    await touch("touchEnd");
  };
  const swipe = async (x, y, dx, dy = 0, steps = 8) => drag(x, y, x + dx, y + dy, steps, 16);
  const cancelDrag = async (x1, y1, x2, y2, steps = 6) => {
    await touch("touchStart", x1, y1);
    await sleep(25);
    for (let i = 1; i <= steps; i++) {
      await touch("touchMove", x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps);
      await sleep(16);
    }
    await touch("touchCancel");
  };
  const centre = async loc => {
    await loc.first().waitFor({ state: "visible", timeout: 15000 });   // slow runners: the target may not be drawn yet
    const b = await loc.first().boundingBox();
    assert.ok(b && b.width > 0 && b.height > 0, "target has no visible bounding box");
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  return { cdp, touch, tap, hold, drag, swipe, cancelDrag, centre };
}

function assertNoOverlap(boxes, label = "boxes") {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      assert.ok(ox <= 2 || oy <= 2, `${label}: box ${i} (${JSON.stringify(a)}) overlaps box ${j} (${JSON.stringify(b)})`);
    }
  }
}

function assertInViewport(box, viewport, label = "element", tol = 2) {
  assert.ok(box && box.width > 0 && box.height > 0, `${label}: not visible`);
  assert.ok(box.x >= -tol && box.y >= -tol && box.x + box.width <= viewport.width + tol && box.y + box.height <= viewport.height + tol,
    `${label} out of viewport ${viewport.width}x${viewport.height}: ${JSON.stringify(box)}`);
}

module.exports = {
  root, fixtures, py, freePort, sleep, until,
  makeDataDir, startServer, startFakeHA, runSuite, touchSession,
  assertNoOverlap, assertInViewport,
};
