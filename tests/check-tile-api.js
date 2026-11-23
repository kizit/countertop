// Tiles that run purely through the tile API (docs/tile-api.md): each one is run in an empty JavaScript world where the
// only thing it can reach is `Tile` and what `this` gives it, the way a tile in a sandbox will. A tile that still
// leans on one of the dashboard's own functions throws a ReferenceError here. Needs only Node.
// Run with: node tests/check-tile-api.js
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const TILES = ["stocks", "agenda", "countdown", "note"];
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function load(type) {
  let def = null;
  const world = vm.createContext({ Tile: (t, d) => { def = d; } });      // no window, document, esc, tr, STATE, SOURCES...
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "tools", "tiles", type + ".js"), "utf8"), world, { filename: type + ".js" });
  assert.ok(def, type + " didn't define a tile");
  assert.equal(def.api, 1, type + " must declare api:1");
  // the settings' defaults plus the tile's own overrides: what a new tile starts with
  const s = {};
  for (const k in def.settings) s[k] = def.settings[k].default;
  return { def, s };
}

// the parts of the API these tiles use, just enough to draw them (the real ones are in tools/dash/tile-api.js)
function tileThis({ def, s }, over) {
  const fetched = [];
  const api = Object.assign({}, def, {
    s: Object.assign(s, over.settings), name: def.title, esc,
    t: (text, vars) => String(text).replace(/\{(\w+)\}/g, (m, k) => vars && k in vars ? vars[k] : m),
    fetch: (url, maxAge) => { fetched.push([url, maxAge]); return typeof over.fetched === "function" ? over.fetched(url) : over.fetched === undefined ? null : over.fetched; },
    fetchError: url => (over.errors || {})[url] || "",
    feed: name => (over.feeds || {})[name] || [],
    sources: kind => (over.sources || {})[kind] || [],
    events: o => (over.events || []).map(e => Object.assign({}, e, { date: new Date(e.start) })),
  });
  api.fetched = fetched;
  return api;
}
const draw = (type, over = {}) => {
  const t = load(type), me = tileThis(t, over), el = { innerHTML: "" };
  me.render(el);
  return { html: el.innerHTML, me };
};

for (const type of TILES) load(type);

// Stocks: asks Yahoo for each symbol through this.fetch (a site it declares), shows Loading, then the numbers;
// Stooq's last price when Yahoo can't be reached
const Y = s => "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(s) + "?range=1d&interval=5m";
const chart = (name, price, prev, close) => ({ chart: { result: [{ meta: { shortName: name, regularMarketPrice: price, chartPreviousClose: prev }, indicators: { quote: [{ close }] } }] } });
assert.equal(JSON.stringify(load("stocks").def.hosts), '["query1.finance.yahoo.com","stooq.com"]');
let r = draw("stocks");
assert.deepEqual(r.me.fetched, [[Y("^GSPC"), 300], [Y("^DJI"), 300], [Y("^IXIC"), 300]]);
assert.match(r.html, /Loading/);
const answers = { [Y("ACME")]: chart("Acme <Corp>", 182.44, 179.9, [1, null, 2, 3]), [Y("^GSPC")]: chart("S&P 500", 5932.1, 5901.4, []), [Y("BAD")]: { chart: { result: null } } };
r = draw("stocks", { settings: { syms: ["acme", "^GSPC", "BAD", "OLD"] }, fetched: u => answers[u] || null,
  errors: { [Y("OLD")]: "query1.finance.yahoo.com answered 429", "https://stooq.com/q/l/?s=old.us&f=sd2t2ohlcv&h&e=csv": "stooq.com answered 500" } });
assert.match(r.html, /<small>Acme &lt;Corp&gt;<\/small>/);
assert.match(r.html, /S&amp;P 500/);
assert.match(r.html, /▲ 1\.41%/);
assert.match(r.html, /<polyline/);
assert.equal((r.html.match(/Couldn't load/g) || []).length, 1);         // BAD has no price; OLD failed everywhere
assert.ok(r.me.fetched.some(([u]) => u === "https://stooq.com/q/l/?s=bad.us&f=sd2t2ohlcv&h&e=csv"));
r = draw("stocks", { settings: { syms: ["ZZZ"] }, fetched: u => u.startsWith("https://stooq.com/") ? "Symbol,Date,Time,Open,High,Low,Close,Volume\nZZZ.US,2026-11-20,22:00:00,10,11,9,10.5,100\n" : null,
  errors: { [Y("ZZZ")]: "query1.finance.yahoo.com answered 404" } });
assert.match(r.html, /10\.50<small class="up">▲ 5\.00%/);
assert.match(draw("stocks", { settings: { syms: [] } }).html, /Add symbols/);

// Agenda: events and sources come from the API
const soon = d => new Date(Date.now() + d * 3600e3).toISOString();
r = draw("agenda", { sources: { calendars: [{ id: "c", name: "Family" }] }, events: [{ start: soon(2), summary: "Dentist <b>", rep: "every Tue", color: "#f00" }, { start: soon(50), summary: "Soccer" }] });
assert.match(r.html, /Dentist &lt;b&gt;/);
assert.match(r.html, /every Tue/);
assert.match(r.html, /--ec:#f00/);
assert.match(draw("agenda", { sources: { calendars: [{ id: "c" }] } }).html, /Nothing coming up/);
assert.match(draw("agenda").html, /Connect a calendar/);

// Countdown: reads only its own settings
const iso = d => d.toISOString().slice(0, 10);
const day = n => iso(new Date(Date.now() + n * 86400e3));
const cd = load("countdown"), cdThis = tileThis(cd, { settings: { dates: ["Trip, " + day(10), "Party, " + day(3), "Gone, 2001-01-01"] } });
assert.equal(cdThis.has(), true);
assert.equal(JSON.stringify(cdThis.list().map(x => [x.name, x.days])), '[["Party",3],["Trip",10]]');
r = draw("countdown", { settings: { dates: ["Trip, " + day(10), "Party, " + day(3)] } });
assert.match(r.html, /<b>3<\/b><span>days to go/);
assert.match(r.html, /10 days/);
assert.equal(draw("countdown", { settings: { dates: [] } }).me.has(), false);

// Note: lines of text, safely
r = draw("note", { settings: { text: ["Wi-Fi: <home>", "pass"], big: 60, align: "Left", title: true } });
assert.match(r.html, /Wi-Fi: &lt;home&gt;<br>pass/);
assert.match(r.html, /font-size:60px;text-align:left/);
assert.match(r.html, /<h3>Note<\/h3>/);

console.log("tile API check passed for " + TILES.join(", "));
