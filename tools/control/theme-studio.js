/* ---------- Theme Studio: make a theme with an AI of your choice, or from a wallpaper ----------
   Like Tile Studio, Countertop has no AI built in. It writes a prompt that explains the theme settings; you give it to the AI you
   already use (with a photo of your kitchen if it can look at pictures) and paste back what it answers. Whatever comes back is
   checked here, setting by setting, and opens as an ordinary new-theme draft in the theme editor: the same preview, Save and
   Cancel as a theme you make by hand. Nothing is saved until you press Save.
   "From a wallpaper" picks a palette from a picture on this device. The picture isn't uploaded or stored.
   The checking and the palette are plain functions of their input (THEMESTUDIO), so the tests can feed them anything. */
const THEMESTUDIO = (function(){
  const TL = THEMELIB, HEX6 = /^#[0-9a-f]{6}$/i;
  const MAX_TEXT = 20000;
  // what a theme from the Studio may set. Anything that points at this Countertop (wallpaper, album, photo timing) or at effects is left to the editor.
  const CHOICES = {mode:["Dark", "Light"], tiles:["Solid", "See-through", "Clear"], bg:["Sky", "Color", "Gradient", "Texture"], fx:["On", "Off"],
    fontBody:TL.BODY_FONTS, fontDisplay:TL.DISPLAY_FONTS, surface:Object.keys(TL.SURFACES), shape:Object.keys(TL.SHAPES), density:Object.keys(TL.DENSITY),
    gradient:Object.keys(TL.GRADIENTS), texture:Object.keys(TL.TEXTURES)};
  const COLORS = {accent:false, bgColor:false, textColor:true, bigColor:true, tint:true};        // true: may be empty (automatic / none)
  const INTS = {opacity:[10, 100], textScale:[80, 140], dim:[0, 80], tintAmt:[0, 60]};
  const BOOLS = ["holiday", "themeWins", "titles"];
  const KEYS = Object.keys(CHOICES).concat(Object.keys(COLORS), Object.keys(INTS), BOOLS);
  const META = ["name", "description", "category"];
  // anything that could load a page, run code or change the page's own CSS, in any string of the reply (keys included)
  const HOSTILE = /url\s*\(|javascript\s*:|data\s*:|https?\s*:|\/\/|[<>{}`;\\]|@import|expression\s*\(|\bon[a-z]+\s*=|\bsrc\s*=|\bhref\s*=/i;

  function fenced(t){
    t = String(t).trim();
    const m = t.match(/^```[a-z]*\s*\n([\s\S]*?)\n?```\s*$/i); if (m) return m[1].trim();
    if (t[0] !== "{"){ const a = t.indexOf("{"), b = t.lastIndexOf("}"); if (a >= 0 && b > a) return t.slice(a, b + 1); }      // an AI's "Here you go:" around the JSON
    return t;
  }
  function scan(x, depth){          // true when any key or text in x is something other than plain theme data
    if (typeof x === "string") return HOSTILE.test(x);
    if (Array.isArray(x)) return depth > 3 || x.length > 50 || x.some(y => scan(y, depth + 1));
    if (x && typeof x === "object"){
      const ks = Object.keys(x); if (depth > 3 || ks.length > 80) return true;
      return ks.some(k => !/^[A-Za-z][A-Za-z0-9]{0,29}$/.test(k) || scan(x[k], depth + 1));
    }
    return false;
  }
  const lum = hex => { const n = parseInt(hex.slice(1), 16), f = c => { c /= 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); }; return .2126 * f(n >> 16) + .7152 * f((n >> 8) & 255) + .0722 * f(n & 255); };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const hexOf = c => /^rgba\((\d+),(\d+),(\d+)/.exec(c) ? "#" + [1, 2, 3].map(i => (+/^rgba\((\d+),(\d+),(\d+)/.exec(c)[i]).toString(16).padStart(2, "0")).join("") : "";

  /* Check what an AI wrote. Returns {error} when it can't be used at all (not JSON, too big, anything that isn't plain theme data), or
     {values, name, description, category, problems, ignored, notes}: values holds only settings that passed; problems say what was
     left out and why; notes are heads-ups about the result (hard to read, ...). */
  function check(text){
    text = String(text == null ? "" : text);
    if (!text.trim()) return {error:"Paste what your AI wrote first."};
    if (text.length > MAX_TEXT) return {error:"That's too long to be a theme (the limit is " + MAX_TEXT / 1000 + " thousand characters)."};
    let j;
    try{ j = JSON.parse(fenced(text)); }catch(e){ return {error:"That isn't JSON. Ask the AI to reply with only the theme JSON, nothing before or after it."}; }
    if (!j || typeof j !== "object" || Array.isArray(j)) return {error:"The theme should be one JSON object, like {\"name\": \"…\", \"mode\": \"Dark\", …}."};
    if (scan(j, 0)) return {error:"That has something in it that isn't plain theme data (links, CSS or code), so Countertop won't open it."};
    let src = j;       // a share file ({countertop: "theme", values: {…}}) or {values: {…}}: the settings are inside
    if (j.values && typeof j.values === "object" && !Array.isArray(j.values)) src = Object.assign({}, j.values, {name:j.name, description:j.description, category:j.category});
    const problems = [], ignored = [], values = {}, str = (v, n) => typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "";
    for (const k of Object.keys(src)){
      if (META.includes(k) || src[k] === undefined) continue;
      const v = src[k];
      if (!KEYS.includes(k)){ ignored.push(k); continue; }
      if (CHOICES[k]){
        const hit = typeof v === "string" ? CHOICES[k].find(c => c.toLowerCase() === v.trim().toLowerCase()) : undefined;
        if (hit) values[k] = hit; else problems.push(k + ": " + (typeof v === "string" ? "“" + v.slice(0, 30) + "”" : "that") + " isn't one of " + CHOICES[k].join(", "));
      }else if (k in COLORS){
        if (typeof v === "string" && HEX6.test(v.trim())) values[k] = v.trim().toLowerCase();
        else if (v === "" && COLORS[k]) values[k] = "";
        else problems.push(k + ": use a color like #56703b" + (COLORS[k] ? ", or empty" : ""));
      }else if (k in INTS){
        const [lo, hi] = INTS[k];
        if (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi) values[k] = v;
        else problems.push(k + ": use a whole number from " + lo + " to " + hi);
      }else if (BOOLS.includes(k)){
        if (typeof v === "boolean") values[k] = v; else problems.push(k + ": use true or false");
      }
    }
    if (src.bg === "Wallpaper" || src.bg === "Photos") problems.push("bg: wallpapers and photos stay on this Countertop, so a theme can't ask for them. Add one in the editor.");
    if (!Object.keys(values).length) return {error:"None of the settings in that could be used." + (problems.length ? " " + problems[0] : "")};
    // a gradient or texture only shows when the background says so
    const notes = [], name = str(src.name, 60), description = str(src.description, 500), cat = TL.CATEGORIES.find(c => c.toLowerCase() === str(src.category, 30).toLowerCase()) || "";
    const full = Object.assign({}, TL.BASE, values);
    const r = TL.resolve(full), bgHex = values.bgColor && full.bg === "Color" ? full.bgColor : "";
    if (bgHex && contrast(hexOf(r.text.fg) || (r.light ? "#1a1f26" : "#e9ecf1"), bgHex) < 4.5) notes.push("The text may be hard to read on that background color. Check it in the editor.");
    if (full.bg === "Color" && values.accent && bgHex && contrast(full.accent, bgHex) < 3) notes.push("The accent color is close to the background color.");
    if (full.mode === "Light" && full.bg === "Gradient" && TL.GRADIENTS[full.gradient] && /#(2b2f4a|4a2a2a|1d3a2f|123b5c|39414d)/.test(TL.GRADIENTS[full.gradient])) notes.push("A dark gradient with Light mode: the text may be hard to read.");
    return {values, name, description, category:cat, problems, ignored, notes};
  }

  // the prompt to give an AI: what a theme is, every setting with its allowed values, and the theme to start from (only what may be shared)
  function prompt(want, current){
    const L = [
      "I'm designing a theme for Countertop, a home dashboard that runs on a screen in my kitchen. A theme sets colors, fonts, the shape and edges of the tiles, spacing and the background. Please design one.",
      "", "What I'd like: " + (str1(want) || "(nothing in particular: surprise me with something tasteful)"),
      "If I've attached a photo of my kitchen, match its colors, materials and mood.", "",
      "Reply with ONLY one JSON object: no text before or after it, no CSS, no links, no images. Use only these fields and values:", "",
      '"name": a short name (up to 60 characters)', '"description": one sentence about the look (up to 500 characters)',
      '"category": one of ' + TL.CATEGORIES.map(c => '"' + c + '"').join(", ")];
    for (const k of Object.keys(CHOICES)) L.push('"' + k + '": one of ' + CHOICES[k].map(c => '"' + c + '"').join(", "));
    for (const k of Object.keys(COLORS)) L.push('"' + k + '": a color like "#56703b" (six digits)' + (COLORS[k] ? ', or "" for ' + (k === "tint" ? "none" : "automatic") : ""));
    for (const k of Object.keys(INTS)) L.push('"' + k + '": a whole number from ' + INTS[k][0] + " to " + INTS[k][1]);
    for (const k of BOOLS) L.push('"' + k + '": true or false');
    L.push("", "Notes:",
      '- "mode" is the whole dashboard: "Light" means dark text on light tiles. Pick a background that suits it so the text stays easy to read from across the room.',
      '- "bgColor" is used when "bg" is "Color" (and under a "Texture"); "gradient" when "bg" is "Gradient"; "texture" when "bg" is "Texture"; "Sky" is a sky that follows the sun.',
      '- "tiles": "See-through" and "Clear" let the background show; "opacity" is how solid See-through tiles are.',
      '- "textColor" and "bigColor" are usually "" (automatic). "themeWins": true makes the theme\'s colors win over colors a tile sets itself.',
      "- Leave out any field you don't need to change; it keeps the value below.");
    if (current && typeof current === "object") L.push("", "My current theme, to start from:", JSON.stringify(current));
    return L.join("\n");
  }
  const str1 = v => typeof v === "string" ? v.trim().slice(0, 600) : "";

  /* A palette from a picture: px is RGBA bytes (a small copy of the picture). The most common color becomes the background, pulled
     toward light or dark so the text stays readable; the accent is the most vivid color that stands out from it. Same picture, same palette. */
  function hsl(r, g, b){
    r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1)); let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, s, l];
  }
  function toHex(h, s, l){
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2, [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return "#" + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round((v + m) * 255))).toString(16).padStart(2, "0")).join("");
  }
  function palette(px){
    const B = new Map(); let n = 0, ls = 0;
    for (let i = 0; i + 3 < px.length; i += 4){
      if (px[i + 3] < 200) continue;
      const r = px[i], g = px[i + 1], b = px[i + 2], key = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4);
      let e = B.get(key); if (!e){ e = {key, n:0, r:0, g:0, b:0}; B.set(key, e); }
      e.n++; e.r += r; e.g += g; e.b += b; n++; ls += lum("#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join(""));
    }
    if (n < 16) return null;
    const all = [...B.values()].sort((a, b) => b.n - a.n || a.key - b.key).map(e => { const r = e.r / e.n, g = e.g / e.n, b = e.b / e.n; return {n:e.n, hsl:hsl(r, g, b)}; });
    const mode = ls / n > .35 ? "Light" : "Dark", dom = all[0].hsl;
    const bgL = mode === "Light" ? Math.max(.86, Math.min(.93, dom[2])) : Math.max(.08, Math.min(.15, dom[2]));
    const bgColor = toHex(dom[0], Math.min(dom[1], .4), bgL);
    const dist = (a, b) => { const d = Math.abs(a[0] - b[0]); return Math.min(d, 360 - d) / 180 + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]); };
    let best = null, score = 0;
    for (const c of all.slice(0, 64)){
      const [, s, l] = c.hsl; if (s < .25 || l < .15 || l > .88 || dist(c.hsl, dom) < .5) continue;
      const sc = c.n * (s + .25) * (s + .25); if (sc > score){ score = sc; best = c.hsl; }
    }
    let [h, s, l] = best || [215, .8, mode === "Light" ? .4 : .72];
    s = Math.min(s, .85); l = Math.max(.3, Math.min(.75, l));
    let accent = toHex(h, s, l), guard = 0;
    while (contrast(accent, bgColor) < 3.5 && guard++ < 24){ l += mode === "Light" ? -.025 : .025; l = Math.max(.12, Math.min(.92, l)); accent = toHex(h, s, l); }
    const swatches = []; for (const c of all){ const hx = toHex(c.hsl[0], c.hsl[1], c.hsl[2]); if (!swatches.some(x => contrast(x, hx) < 1.25)) swatches.push(hx); if (swatches.length === 5) break; }
    return {values:{mode, bg:"Color", bgColor, accent, textColor:"", bigColor:""}, swatches};
  }
  return {check, prompt, palette, KEYS, CHOICES, COLORS, INTS, BOOLS, MAX_TEXT, contrast};
})();

/* ----- the Theme Studio screen ----- */
const THS = {want:"", from:"default", paste:"", res:null, wall:null, wallName:""};
function thsPrompt(){
  const v = lookVals(themeKnown(THS.from) ? THS.from : "default"), cur = themePortable(v);
  delete cur.fxPick;
  return THEMESTUDIO.prompt(THS.want, cur);
}
function thsResult(res, which){
  if (!res) return "";
  if (res.error) return sec("", '<div class="row col"><b>' + esc(res.error) + '</b></div>');
  const v = Object.assign(lookVals("builtin-dark"), res.values);
  let h = '<div data-tst-res="' + which + '">' + lookPic(v, "big") + '<p class="intro"><b>' + esc(res.name || "Studio theme") + '</b>' + (res.description ? " · " + esc(res.description) : "") + (res.category ? " · " + esc(res.category) : "") + '</p>';
  if (res.swatches) h += '<div class="sec"><div class="foot">' + res.swatches.map(c => '<i style="display:inline-block;width:26px;height:26px;border-radius:6px;margin-right:6px;vertical-align:middle;background:' + esc(c) + '"></i>').join("") + '</div></div>';
  const L = res.problems.map(p => "Left out: " + p).concat(res.ignored.length ? ["Ignored settings Countertop doesn't have: " + res.ignored.slice(0, 8).join(", ")] : [], res.notes || []);
  if (L.length) h += '<div class="sec"><div class="foot">' + L.map(esc).join("<br>") + '</div></div>';
  h += '<div class="saverow"><button class="pri" data-tst="open">Open in the editor</button></div>' +
    '<div class="sec"><div class="foot">It opens as a new theme you can change before you save it. Nothing changes on the screen until you press Save.</div></div></div>';
  return h;
}
function thsScreen(){
  const o = id => '<option value="' + esc(id) + '"' + (id === THS.from ? " selected" : "") + '>' + esc(lookName(id)) + '</option>';
  let h = '<div class="big">Theme Studio</div><p class="intro">Describe the look you want to an AI you already use, then paste back what it writes. Countertop has no AI of its own and sends nothing anywhere: you copy and paste.</p>';
  h += sec("1 · Describe it", '<div class="row col"><textarea data-tst-in="want" maxlength="600" rows="3" placeholder="Warm and calm, like my oak kitchen. Soft corners, a serif for the clock.">' + esc(THS.want) + '</textarea></div>' +
    '<div class="row col"><label class="foot">Start from <select data-tst-in="from"><optgroup label="Yours">' + ["default"].concat(looks().map(x => x.id)).map(o).join("") + '</optgroup><optgroup label="Built in">' + THEMELIB.L.map(x => o(x.id)).join("") + '</optgroup></select></label></div>',
    "If your AI can look at pictures, attach a photo of your kitchen to it.");
  h += sec("2 · Give the AI this prompt", '<div class="row"><textarea class="code" readonly data-tst-in="prompt" rows="5" style="flex:1;font-size:12px">' + esc(thsPrompt()) + '</textarea></div>' +
    '<button class="btnrow blue" data-tst="copy">Copy the prompt</button>', "It lists every setting a theme has. It includes the theme above, but never your wallpaper, photos or anything private.");
  h += sec("3 · Paste what it wrote", '<div class="row col"><textarea data-tst-in="paste" maxlength="' + THEMESTUDIO.MAX_TEXT + '" rows="5" class="code" placeholder="{ &quot;name&quot;: &quot;…&quot;, &quot;mode&quot;: &quot;Light&quot;, … }">' + esc(THS.paste) + '</textarea></div>' +
    '<button class="btnrow" data-tst="check">Check it</button>', "Everything is checked: only known settings with allowed values get through, and anything with links or code is refused.");
  h += thsResult(THS.res, "paste");
  h += sec("Or start from a wallpaper", '<label class="btnrow" style="cursor:pointer">' + esc(THS.wallName ? "Another picture: " + THS.wallName : "Choose a picture") + '<input type="file" accept="image/png,image/jpeg,image/webp" data-tst-file="1" style="display:none"></label>',
    "Countertop picks a matching palette on this device. The picture isn't uploaded or saved.");
  if (THS.wall) h += thsResult(THS.wall, "wall");
  h += '<div class="sec"><div class="foot">To share a theme you made, open it and press Share. To open a theme someone sent you, use Library → Import a file.</div></div>';
  return h;
}
// open a checked result as a new-theme draft: the same editor, preview, Save and Cancel as any new theme
function thsOpen(res, fallbackName){
  draftNew("");
  Object.assign(DRAFT.values, res.values);
  let name = res.name || fallbackName; const base = name; for (let i = 2; looks().some(t => t.name === name) || name === "Everyday"; i++) name = base + " " + i;
  DRAFT.name = name; DRAFT.named = true;
  if (res.category) DRAFT.category = res.category;
  LTAB = "colors"; go("look:new");
}
async function thsWallpaper(file){
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)){ THS.wall = {error:"Use a PNG, JPEG or WebP picture."}; THS.wallName = ""; show(); return; }
  if (file.size > 25e6){ THS.wall = {error:"That picture is too big (the limit is 25 MB)."}; show(); return; }
  try{
    const bmp = await createImageBitmap(file), k = Math.min(1, 64 / Math.max(bmp.width, bmp.height)), c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    const x = c.getContext("2d"); x.drawImage(bmp, 0, 0, c.width, c.height);
    const p = THEMESTUDIO.palette(x.getImageData(0, 0, c.width, c.height).data);
    THS.wall = p ? Object.assign({values:p.values, name:"From " + (file.name || "a wallpaper").replace(/\.[a-z0-9]+$/i, "").replace(/[^\w ]+/g, " ").trim().slice(0, 40), description:"", category:"", problems:[], ignored:[], notes:[]}, {swatches:p.swatches})
      : {error:"That picture is too small or too clear to pick colors from."};
    THS.wallName = (file.name || "").slice(0, 40);
  }catch(e){ THS.wall = {error:"Couldn't read that picture."}; }
  show();
}
document.addEventListener("click", e => {
  const t = e.target.closest("[data-tst]"); if (!t) return;
  const a = t.dataset.tst;
  if (a === "copy") textCopy(document.querySelector('[data-tst-in="prompt"]'), "Prompt copied. Paste it into your AI.");
  else if (a === "check"){ THS.res = THEMESTUDIO.check(THS.paste); show(); }
  else if (a === "open"){      // the Open button belongs to the result it sits in: from the pasted reply, or from a wallpaper
    const box = t.closest("[data-tst-res]"), which = box ? box.dataset.tstRes : "paste", res = which === "wall" ? THS.wall : THS.res;
    if (res && !res.error) thsOpen(res, which === "wall" ? "From a wallpaper" : "Studio theme");
  }
});
document.addEventListener("input", e => {
  const t = e.target, k = t.dataset && t.dataset.tstIn; if (!k) return;
  if (k === "want" || k === "paste"){ THS[k] = t.value; if (k === "want"){ const p = document.querySelector('[data-tst-in="prompt"]'); if (p) p.value = thsPrompt(); } }
});
document.addEventListener("change", e => {
  const t = e.target; if (!t.dataset) return;
  if (t.dataset.tstIn === "from"){ THS.from = t.value; show(); }
  if (t.dataset.tstFile){ thsWallpaper(t.files && t.files[0]); t.value = ""; }
});
