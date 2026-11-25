// The Team tile uses the team's own colors, and its text must stay readable whatever they are (white on yellow, black on
// black, one color only...). Loads tools/tiles/team.js alone. Needs only Node. Run with: node tests/team-colors-check.js
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

let def = null;
const world = vm.createContext({ Tile: (t, d) => { def = d; } });
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "tools", "tiles", "team.js"), "utf8"), world, { filename: "team.js" });
assert.ok(def, "team.js didn't define a tile");

const ratio = (a, b) => { const x = def.lum(a), y = def.lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const CASES = {
  "red and blue": ["#e8344e", "#0b1f3f"], "yellow and black": ["#fedd00", "#000000"], "white and navy": ["#ffffff", "#0a1f44"],
  "black only": ["#000000", "#000000"], "one color": ["#2e8b57", "#2e8b57"], "light blue and white": ["#6cabdd", "#ffffff"],
  "pure yellow both": ["#ffff00", "#ffff00"], "dark navy both": ["#001133", "#001133"], "orange and green": ["#ff7f00", "#006400"],
};
for (const [name, cols] of Object.entries(CASES)) {
  const P = def.palette(cols);
  assert.ok(P, name + ": no palette");
  for (const k of ["--teamb", "--teamm", "--teame"]) {          // the card's gradient: the heading, the opponent and the date are light text
    assert.ok(ratio(P[k], "#d9e2f0") >= 7, name + ": " + k + " " + P[k] + " is too light for the card's text");
    assert.ok(ratio(P[k], P["--teamh"]) >= 7, name + ": the heading " + P["--teamh"] + " doesn't read on " + k + " " + P[k]);
  }
  assert.ok(ratio(P["--team"], P["--teamt"]) >= 4.5, name + ": the crest letters don't read on " + P["--team"]);
  assert.ok(ratio(P["--teamy"], P["--teambt"]) >= 4.5, name + ": the badge letters don't read on " + P["--teamy"]);
}
// no colors, or bad ones: the usual look stays (the stylesheet's own colors)
for (const bad of [null, undefined, [], ["red"], ["#12345"], "#e8344e", [{}]]) assert.equal(def.palette(bad), null, "bad colors " + JSON.stringify(bad));
// one color is enough
assert.ok(def.palette(["#2e8b57"]));
// painting sets and clears the variables on the card
const set = {}, el = { style: { setProperty: (k, v) => { set[k] = v; }, removeProperty: k => { delete set[k]; } } };
def.paint(el, { colors: ["#e8344e", "#0b1f3f"] });
assert.ok(set["--team"], "the crest color is set");
def.paint(el, { colors: null });
assert.deepEqual(set, {}, "the team's colors stay on the card after the feed has none");
console.log("✓ the Team tile uses a team's own colors and stays readable (" + Object.keys(CASES).length + " color pairs)");
