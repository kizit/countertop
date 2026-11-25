// Text on the tiles of every built-in theme must be readable from across a room. This works out the color a tile really
// draws (its translucent surface blended over the theme's background, with the worst end of a gradient) and checks the
// contrast of the main text, the dimmer lines, the big numbers and the accent against it.
// No browser needed. Run with: node tests/theme-contrast-check.js
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const assert = require("node:assert/strict");

const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "tools", "shared", "themes.js"), "utf8") + "\nthis.THEMELIB = THEMELIB;", ctx);
const T = ctx.THEMELIB;

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const parse = c => { c = String(c).trim(); if (c[0] === "#") return hex(c).concat(1); const m = c.match(/[\d.]+/g).map(Number); return [m[0], m[1], m[2], m.length > 3 ? m[3] : 1]; };
const over = (top, under) => top.slice(0, 3).map((v, i) => Math.round(v * top[3] + under[i] * (1 - top[3])));
const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
const lum = c => .2126 * lin(c[0]) + .7152 * lin(c[1]) + .0722 * lin(c[2]);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };

// the colors a theme's background can be: a flat color, or both ends of a gradient (texture lines are only a few percent)
function backdrops(v) {
  if (v.bg === "Gradient") return (T.GRADIENTS[v.gradient].match(/#[0-9a-f]{6}/gi) || []).map(hex);
  if (v.bg === "Color" || v.bg === "Texture") return [hex(v.bgColor)];
  return null;                                   // sky, photos and wallpapers change; they are checked by eye
}
const NEED = { fg: 7, dim: 4.5, big: 7, accent: 4.5 };
const rows = [], bad = [];
for (const t of T.L) {
  const v = t.values, r = T.resolve(v), back = backdrops(v);
  if (!back) continue;
  for (const b of back) {
    // the dimmer darkens the page, not the tiles: on a light background it is 0
    const page = b.map(x => Math.round(x * (1 - (v.dim || 0) / 100)));
    const card = r.clear ? page : over(parse(r.card), page);
    const on = c => ratio(over(parse(c), card), card);          // faded text is see-through: blend it over the tile first
    const got = { fg: on(r.text.fg), dim: on(r.text.dim), big: on(r.big), accent: on(r.accent) };
    const worst = Object.assign({}, got);
    rows.push([t.id, ...Object.keys(NEED).map(k => worst[k].toFixed(1))]);
    for (const k in NEED) if (got[k] < NEED[k] && /^builtin-(retro-digital|newspaper|mid-century|japandi|nordic|after-hours)$/.test(t.id)) bad.push(t.id + " " + k + " " + got[k].toFixed(2) + " (needs " + NEED[k] + ")");
  }
}
if (process.env.CONTRAST_TABLE) console.log("theme, text, dim, big, accent\n" + rows.map(r => r.join("  ")).join("\n"));
assert.deepEqual(bad, [], "text is too faint on a tile:\n  " + bad.join("\n  "));
// the six new themes are different looks, not one look in six colors
const six = T.L.filter(t => /retro-digital|newspaper|mid-century|japandi|nordic|after-hours/.test(t.id));
assert.equal(six.length, 6);
const sig = t => [t.values.fontBody, t.values.fontDisplay, t.values.surface, t.values.shape, t.values.density, t.values.bg].join("|");
assert.equal(new Set(six.map(sig)).size, 6, "two new themes share fonts, edges, corners, spacing and background style");
console.log("✓ the six new themes read clearly on the tiles they draw (" + rows.length + " built-in/background combinations measured)");
