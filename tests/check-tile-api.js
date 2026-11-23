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
    fetch: (url, maxAge) => { fetched.push([url, maxAge]); return over.fetched === undefined ? null : over.fetched; },
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

// Stocks: asks for its prices through this.fetch, shows Loading, then the numbers
let r = draw("stocks");
assert.equal(JSON.stringify(r.me.fetched), '[["/stocks?s=%5EGSPC%2C%5EDJI%2C%5EIXIC",300]]');
assert.match(r.html, /Loading/);
r = draw("stocks", { fetched: { stocks: [{ sym: "ACME", name: "Acme <Corp>", price: 182.44, prev: 179.9, spark: [1, 2, 3] }, { sym: "^GSPC", price: 5932.1, prev: 5901.4 }, { sym: "BAD" }] } });
assert.match(r.html, /<small>Acme &lt;Corp&gt;<\/small>/);
assert.match(r.html, /S&amp;P 500/);
assert.match(r.html, /▲ 1\.41%/);
assert.match(r.html, /Couldn't load/);
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
