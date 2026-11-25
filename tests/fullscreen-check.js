// "Full screen on tap" is per browser: a tap on /dash goes full screen by default, /dash?fullscreen=0 stops that in this
// browser (and is remembered), Controls > Screen shows and changes the choice, and /dash?fullscreen=1 turns it back on.
// Needs Node, Python 3 and Playwright with Chromium. Run with: node tests/fullscreen-check.js
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { sleep, makeDataDir, startServer, runSuite } = require("./pw-helper");

runSuite("fullscreen-check", async ({ openContext, watchErrors, onCleanup }) => {
  const data = makeDataDir("fs");
  onCleanup(() => fs.rmSync(data, { recursive: true, force: true }));
  const srv = await startServer(data);
  onCleanup(() => srv.stop());
  const base = srv.base;
  const ctx = await openContext({ base, stubFullscreen: false });
  const errors = [];
  const page = await ctx.newPage();
  watchErrors(page, errors);
  // count full screen requests, in the shell and in the dashboard frame
  await ctx.addInitScript(() => { window.__fs = 0; Element.prototype.requestFullscreen = function () { window.top.__fs++; return Promise.resolve(); }; });
  const stored = () => page.evaluate(() => localStorage.getItem("countertop.fullscreen"));
  const tapAndCount = async () => {
    await page.evaluate(() => { window.__fs = 0; });
    await page.mouse.click(300, 300); await sleep(400);
    return page.evaluate(() => window.__fs);
  };

  await page.goto(base + "/dash"); await sleep(1500);
  assert.equal(await stored(), null);
  assert.ok(await tapAndCount() >= 1, "a tap goes full screen by default");
  console.log("✓ by default a tap asks for full screen");

  await page.goto(base + "/dash?fullscreen=0"); await sleep(1500);
  assert.equal(await stored(), "0");
  assert.ok(!/fullscreen/.test(page.url()), "the parameter is tidied out of the address");
  assert.equal(await tapAndCount(), 0, "no full screen once turned off");
  console.log("✓ ?fullscreen=0 stops the tap going full screen, and is remembered");

  await page.goto(base + "/dash"); await sleep(1500);
  assert.equal(await tapAndCount(), 0, "still off on a plain /dash");
  await page.goto(base + "/control"); await sleep(1500);
  await page.click('[data-go="display"]');
  await page.waitForSelector("#display-fs");
  assert.equal(await page.inputValue("#display-fs"), "0");
  await page.selectOption("#display-fs", "1"); await sleep(200);
  assert.equal(await stored(), null);
  await page.selectOption("#display-fs", "0"); await sleep(200);
  assert.equal(await stored(), "0");
  console.log("✓ Controls > Screen shows and changes the choice");

  await page.goto(base + "/dash?fullscreen=1"); await sleep(1500);
  assert.equal(await stored(), null);
  assert.ok(await tapAndCount() >= 1, "back on");
  console.log("✓ ?fullscreen=1 turns it back on");

  assert.deepEqual(errors, []);
}).catch(e => { console.error(e); process.exit(1); });
