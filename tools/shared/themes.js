/* ---------- built-in themes: ready-made looks every Countertop has ----------
   Shared by the dashboard and Controls. Each one is complete, so it looks the same whatever theme you use, and is
   never saved in your settings: look.use and schedule rules just name its id. Ids start with "builtin-", which your own
   themes never do (they start with "t"), and stay the same from release to release. An older Countertop that doesn't
   know an id shows Everyday instead. Never remove or rename an id: people use and schedule them.
   A new theme setting goes in three places: the look schema in tools/server/config.py, LOOK_KEYS in tools/control/look.js
   and BASE here, with the same default (tests/themes-check.js checks). */
const THEMELIB = (function(){
  const BASE = {mode:"Dark", accent:"#7cb7ff", holiday:false, textColor:"", bigColor:"", themeWins:false, tiles:"Solid", opacity:60, textScale:100, titles:true, bg:"Sky", bgColor:"#0a0c0f", dim:0, fx:"On"};
  const T = (id, name, sub, values, starter) => ({id:"builtin-" + id, name, sub, values:Object.freeze(Object.assign({}, BASE, values)), builtin:true, starter});
  const L = [
    T("dark", "Dark", "Dark tiles over a sky that follows the sun", {}),
    T("light", "Light", "Light tiles on a soft gray background", {mode:"Light", bg:"Color", bgColor:"#d9e0e8", accent:"#2b7de9"}),
    T("glass", "Glass", "See-through tiles so the sky shows through", {tiles:"See-through", opacity:45}),
    T("photo-frame", "Photo frame", "Your photos behind see-through tiles", {bg:"Photos", tiles:"See-through", opacity:55}),
    T("calm-evening", "Calm evening", "Warmer, a little dimmer, no effects", {accent:"#ff9f5a", dim:30, fx:"Off", tiles:"See-through", opacity:55}),
    T("atmospheric", "Atmospheric", "Warm light over the changing sky", {tiles:"See-through", opacity:38, accent:"#ffcc91"}, "atmospheric"),
    T("minimal", "Minimal", "No boxes, deep green on warm paper", {mode:"Light", bg:"Color", bgColor:"#f4f0e8", tiles:"Clear", accent:"#376a63", fx:"Off"}, "minimal"),
    T("kitchen-table", "Kitchen table", "Light tiles on sage green", {mode:"Light", bg:"Color", bgColor:"#dce4cf", accent:"#56703b", fx:"Off"}, "kitchen"),
    T("weather-station", "Weather station", "Teal on deep blue-green, see-through tiles", {bg:"Color", bgColor:"#132d38", accent:"#69daca", tiles:"See-through", opacity:55}, "weather"),
    T("family-planner", "Family planner", "Light tiles on soft lavender", {mode:"Light", bg:"Color", bgColor:"#e4dfed", accent:"#76508a", fx:"Off"}, "planner")];
  /* One place that turns a theme's values into colors, for both the dashboard (themeApply) and the Controls previews
     (lookColors), so they can't drift apart. Appearance precedence, lowest to highest (see docs/theming.md):
     built-in defaults < the active theme's values < a tile's preset/own design < Theme colors win (themeWins) over tile colors;
     a holiday accent replaces the accent only on its day. The resolver only does the theme layer. */
  const HEX6 = /^#[0-9a-f]{6}$/i;
  const AUTO = {
    Dark:{fg:"#e9ecf1", fg2:"#d5dbe3", fg3:"#c3cad3", dim:"#a9b1bb", faint:"#6b737e", line:"rgba(255,255,255,.08)", card:"18,22,28", op:.84},
    Light:{fg:"#1a1f26", fg2:"#2b333d", fg3:"#4a5461", dim:"#4a5461", faint:"#7b8591", line:"rgba(0,0,0,.09)", card:"250,251,253", op:.9}};
  const FADE = {fg:1, fg2:.88, fg3:.8, dim:.72, faint:.5};
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")"; };
  function resolve(v){
    const light = v.mode === "Light", A = AUTO[light ? "Light" : "Dark"];
    const tc = HEX6.test(v.textColor || "") ? v.textColor : "", bc = HEX6.test(v.bigColor || "") ? v.bigColor : "";
    const op = v.tiles === "Clear" ? 0 : v.tiles === "See-through" ? (v.opacity || 60) / 100 : A.op;
    const text = {};                       // text colors as they show: a custom color, faded for the dimmer lines, else the automatic ones
    for (const k in FADE) text[k] = tc ? rgba(tc, FADE[k]) : A[k];
    return {light, op, tc, bc, text, fg:tc || A.fg, big:bc || tc || A.fg, line:A.line, card:"rgba(" + A.card + "," + op + ")",
      accent:v.accent || "#7cb7ff", clear:v.tiles === "Clear"};
  }
  const get = id => L.find(t => t.id === id) || null;
  return {L, BASE, resolve, rgba, get, has: id => !!get(id), forStarter: key => L.find(t => t.starter === key) || null};
})();
