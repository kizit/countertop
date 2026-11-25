/* ---------- built-in themes: ready-made looks every Countertop has ----------
   Shared by the dashboard and Controls. Each one is complete, so it looks the same whatever theme you use, and is
   never saved in your settings: look.use and schedule rules just name its id. Ids start with "builtin-", which your own
   themes never do (they start with "t"), and stay the same from release to release. An older Countertop that doesn't
   know an id shows Everyday instead. Never remove or rename an id: people use and schedule them.
   A new theme setting goes in three places: the look schema in tools/server/config.py, LOOK_KEYS in tools/control/look.js
   and BASE here, with the same default (tests/themes-check.js checks). */
const THEMELIB = (function(){
  const BASE = {mode:"Dark", accent:"#7cb7ff", holiday:false, textColor:"", bigColor:"", themeWins:false, tiles:"Solid", opacity:60, textScale:100, titles:true, bg:"Sky", bgColor:"#0a0c0f", dim:0, fx:"On",
    fontBody:"System", fontDisplay:"Default", surface:"Classic", shape:"Rounded", density:"Normal",
    gradient:"Dusk", texture:"Paper", wallpaper:"", album:"", photoEvery:5, tint:"", tintAmt:0, fxPick:[]};
  /* Theme settings that never travel: they point at something on this Countertop's own server (an uploaded wallpaper, a photo
     album). Sharing a theme, a layout, a gallery submission or a Theme Studio prompt goes through portable(), which drops them. */
  const LOCAL = ["wallpaper", "album"];
  // fonts: the bundled ones (tools/fonts). Body text may use the five that read well in small sizes; big numbers can use all eight.
  const FONTS = {System:'-apple-system,system-ui,"Segoe UI",Roboto,sans-serif', Outfit:'"Outfit",system-ui,sans-serif', "Bebas Neue":'"Bebas Neue",Impact,sans-serif',
    "DM Serif Display":'"DM Serif Display",Georgia,serif', Fraunces:'"Fraunces",Georgia,serif', "JetBrains Mono":'"JetBrains Mono",ui-monospace,monospace',
    Nunito:'"Nunito",system-ui,sans-serif', "Space Grotesk":'"Space Grotesk",system-ui,sans-serif'};
  const BODY_FONTS = ["System", "Nunito", "Outfit", "Space Grotesk", "Fraunces"], DISPLAY_FONTS = ["Default"].concat(Object.keys(FONTS));
  // how roomy the dashboard is: the gap between tiles, the padding inside them and the margin around the page (px at 1920 wide)
  const DENSITY = {Compact:{gap:10, py:10, px:14, t:14, x:24, b:16}, Normal:{gap:16, py:16, px:20, t:22, x:36, b:26}, Roomy:{gap:22, py:20, px:26, t:30, x:48, b:34}};
  const SHAPES = {Square:6, Rounded:18, Soft:30};
  // surfaces: the edge of a tile. border = width in px; line = how strong the border is (null: the theme's usual one); shadow per light or dark
  const SURFACES = {
    Classic:{border:1, line:null, shadow:["none", "none"], note:"The usual thin edge"},
    Flat:{border:0, line:null, shadow:["none", "none"], note:"No edge at all"},
    Soft:{border:0, line:null, shadow:["0 8px 28px rgba(0,0,0,.34)", "0 8px 24px rgba(40,50,70,.16)"], note:"No edge, a soft shadow"},
    Outline:{border:2, line:.34, shadow:["none", "none"], note:"A clear outline"},
    Glass:{border:1, line:.22, shadow:["inset 0 1px 0 rgba(255,255,255,.2),0 6px 20px rgba(0,0,0,.22)", "inset 0 1px 0 rgba(255,255,255,.7),0 6px 20px rgba(40,50,70,.12)"], note:"A bright edge and a light shine"}};
  const GRADIENTS = {Dusk:"linear-gradient(160deg,#2b2f4a,#0d0f1a)", Ember:"linear-gradient(160deg,#4a2a2a,#14090c)", Forest:"linear-gradient(160deg,#1d3a2f,#08130f)",
    Ocean:"linear-gradient(160deg,#123b5c,#06121f)", Slate:"linear-gradient(160deg,#39414d,#14181d)", Sand:"linear-gradient(160deg,#efe3cf,#cdbb9d)",
    Mist:"linear-gradient(160deg,#e6ecf3,#b9c6d6)", Blush:"linear-gradient(160deg,#f5e3e3,#c9a7b0)"};
  // textures are drawn over the background color, with plain CSS (no pictures to load)
  const TEXTURES = {Paper:"repeating-linear-gradient(0deg,rgba(128,128,128,.045) 0 1px,transparent 1px 3px),repeating-linear-gradient(90deg,rgba(128,128,128,.035) 0 1px,transparent 1px 4px)",
    Linen:"repeating-linear-gradient(45deg,rgba(128,128,128,.07) 0 1px,transparent 1px 5px),repeating-linear-gradient(-45deg,rgba(128,128,128,.07) 0 1px,transparent 1px 5px)",
    Grid:"linear-gradient(rgba(128,128,128,.12) 1px,transparent 1px) 0 0/48px 48px,linear-gradient(90deg,rgba(128,128,128,.12) 1px,transparent 1px) 0 0/48px 48px",
    Dots:"radial-gradient(rgba(128,128,128,.2) 1.5px,transparent 1.6px) 0 0/28px 28px",
    Stripes:"repeating-linear-gradient(90deg,rgba(128,128,128,.09) 0 18px,transparent 18px 36px)"};
  // what a shared theme can be filed under in the community gallery (one, optional)
  const CATEGORIES = ["Minimalist", "Cozy", "Retro", "Seasonal", "Nature", "Futuristic", "High Contrast"];
  const BG_CHOICES = ["Sky", "Color", "Gradient", "Texture", "Wallpaper", "Photos"];
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
    T("family-planner", "Family planner", "Light tiles on soft lavender", {mode:"Light", bg:"Color", bgColor:"#e4dfed", accent:"#76508a", fx:"Off"}, "planner"),
    // the six below use the theme options (fonts, tile edges and corners, spacing, gradients and textures, their own effects);
    // tests/theme-contrast-check.js checks their text against the tile colors they really draw
    T("retro-digital", "Retro digital", "Amber numbers on dark tiles with sharp outlines", {bg:"Texture", texture:"Grid", bgColor:"#17120b", accent:"#ffb23e", textColor:"#f2e2c4", bigColor:"#ffb23e",
      fontBody:"Space Grotesk", fontDisplay:"JetBrains Mono", surface:"Outline", shape:"Square", fxPick:["stars"]}),
    T("newspaper", "Newspaper", "Editorial serif type on warm paper, with fine rules", {mode:"Light", bg:"Texture", texture:"Paper", bgColor:"#ece5d6", accent:"#a8231b", textColor:"#221e18",
      fontBody:"Fraunces", fontDisplay:"DM Serif Display", surface:"Outline", shape:"Square", fx:"Off"}),
    T("mid-century", "Mid-century", "Walnut and amber, soft corners, vintage type", {mode:"Light", bg:"Color", bgColor:"#c79d72", tiles:"See-through", opacity:78, accent:"#a63f22", textColor:"#2b2019",
      fontBody:"Nunito", fontDisplay:"Fraunces", surface:"Soft", shape:"Soft", fx:"Off"}),
    T("japandi", "Japandi", "Natural linen, no boxes, plenty of quiet space", {mode:"Light", bg:"Texture", texture:"Linen", bgColor:"#e9e2d4", tiles:"Clear", accent:"#52613f", textColor:"#2a2822",
      fontBody:"Outfit", fontDisplay:"Outfit", surface:"Flat", shape:"Soft", density:"Roomy", fx:"Off"}),
    T("nordic", "Nordic", "Soft blue mist, bright rounded cards, clean type", {mode:"Light", bg:"Gradient", gradient:"Mist", tiles:"See-through", opacity:82, accent:"#2f6a8c", textColor:"#17232e",
      fontBody:"Nunito", fontDisplay:"Space Grotesk", surface:"Glass", shape:"Soft", fxPick:["snow", "clouds"]}),
    T("after-hours", "After hours", "Dim, muted violet for the evening", {bg:"Color", bgColor:"#100d18", tiles:"See-through", opacity:72, accent:"#c09cf5", textColor:"#ece6f6", bigColor:"#d6c0ff", dim:15,
      fontBody:"Outfit", fontDisplay:"Bebas Neue", surface:"Soft", shape:"Rounded", fxPick:["stars"]})];
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
  /* The shape of the dashboard for a theme: CSS variables for fonts, corners, tile edges and spacing. A null means "the usual value",
     so the variable is removed and the stylesheet's own default shows (old themes look exactly as they did). Used by the dashboard
     (themeApply) and the Controls previews, so they agree. */
  function tokens(v){
    const r = resolve(v), t = {}, light = r.light;
    t["--font"] = BODY_FONTS.includes(v.fontBody) && v.fontBody !== "System" ? FONTS[v.fontBody] : null;
    t["--font-display"] = v.fontDisplay !== "Default" && FONTS[v.fontDisplay] ? FONTS[v.fontDisplay] : null;
    const rad = SHAPES[v.shape]; t["--radius"] = rad && rad !== SHAPES.Rounded ? rad + "px" : null;
    const d = DENSITY[v.density] || DENSITY.Normal, n = DENSITY.Normal, on = v.density in DENSITY && v.density !== "Normal";
    t["--gap"] = on ? d.gap + "px" : null; t["--pad-y"] = on ? d.py + "px" : null; t["--pad-x"] = on ? d.px + "px" : null;
    t["--pg-t"] = on ? d.t + "px" : null; t["--pg-x"] = on ? d.x + "px" : null; t["--pg-b"] = on ? d.b + "px" : null;
    const sf = SURFACES[v.surface] || SURFACES.Classic, isDefault = sf === SURFACES.Classic;
    t["--border-w"] = isDefault ? null : sf.border + "px";
    t["--surface-line"] = sf.line == null ? null : (light ? "rgba(0,0,0," + (sf.line * .7).toFixed(3) + ")" : "rgba(255,255,255," + sf.line + ")");
    t["--shadow"] = isDefault ? null : v.tiles === "Clear" ? "none" : sf.shadow[light ? 1 : 0];      // Light has a soft shadow of its own, so a plain one has to say "none"
    return t;
  }
  // the pixel sizes of a theme's density (the grid editor needs the gap to place tiles)
  const spacing = v => DENSITY[v && v.density] || DENSITY.Normal;
  // the CSS background of a theme's background, for the screen and for the small drawings in Controls; null: the sky or the photos draw themselves
  function background(v, wallpaperUrl){
    const bgc = HEX6.test(v.bgColor || "") ? v.bgColor : "#0a0c0f";
    if (v.bg === "Color") return bgc;
    if (v.bg === "Gradient") return GRADIENTS[v.gradient] || GRADIENTS.Dusk;
    if (v.bg === "Texture") return (TEXTURES[v.texture] || TEXTURES.Paper) + "," + bgc;
    if (v.bg === "Wallpaper") return wallpaperUrl ? 'center/cover no-repeat url("' + wallpaperUrl + '"),' + bgc : bgc;
    return null;
  }
  /* What may leave this Countertop in a shared theme, a shared layout, a gallery submission or a Theme Studio prompt. One place,
     so a new setting can't leak by being forgotten in one of them: anything that points at this server (an uploaded wallpaper, a
     photo album) is dropped, and a theme on a wallpaper falls back to a gradient. ctx.fxOk(id) says which effects others have too. */
  function portable(v, ctx){
    const out = {};
    for (const k in BASE) if (v && v[k] !== undefined && !LOCAL.includes(k)) out[k] = v[k];
    if (out.bg === "Wallpaper"){ out.bg = "Gradient"; if (!out.gradient) out.gradient = out.mode === "Light" ? "Mist" : "Dusk"; }
    if (Array.isArray(out.fxPick)) out.fxPick = out.fxPick.filter(id => typeof id === "string" && /^[a-z0-9-]+$/.test(id) && (!ctx || !ctx.fxOk || ctx.fxOk(id)));
    return out;
  }
  const get = id => L.find(t => t.id === id) || null;
  /* Classic themes: the original built-ins that look a lot like Dark or Light with other colors. They stay in L, so every saved look,
     schedule rule, shared layout and gallery item that names one keeps working, but the Themes list hides them unless one is in use
     or the person asks for them. Never remove an id from L; add it here to retire a theme. */
  const CLASSIC = ["glass", "photo-frame", "calm-evening", "atmospheric", "minimal", "kitchen-table", "weather-station", "family-planner"].map(x => "builtin-" + x);
  for (const t of L) t.classic = CLASSIC.includes(t.id);
  // the themes to list: all but the classic ones, plus any in useIds (on the screen or on the schedule), plus all of them when showAll
  const listed = (useIds, showAll) => L.filter(t => showAll || !t.classic || (useIds || []).includes(t.id));
  return {L, listed, BASE, LOCAL, FONTS, BODY_FONTS, DISPLAY_FONTS, DENSITY, SHAPES, SURFACES, GRADIENTS, TEXTURES, BG_CHOICES, CATEGORIES, resolve, tokens, spacing, background, portable, rgba, get, has: id => !!get(id), forStarter: key => L.find(t => t.starter === key) || null};
})();
