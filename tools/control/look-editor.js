/* ---------- the theme editor's tabs: Colors, Typography, Surfaces, Spacing, Background, Effects ----------
   One theme, shown in six small sections. The picture at the top stays put while you change things (and the preview pane beside
   it follows the draft), every choice is something you can see, and each tab can go back to how the theme was with Reset. */
const LTABS = [["colors", "Colors"], ["type", "Type"], ["surface", "Surfaces"], ["space", "Spacing"], ["bg", "Background"], ["fx", "Effects"]];
const LTAB_KEYS = {colors:["mode", "accent", "holiday", "textColor", "bigColor", "themeWins"], type:["fontBody", "fontDisplay", "textScale"],
  surface:["tiles", "opacity", "surface", "shape", "titles"], space:["density"], bg:["bg", "bgColor", "gradient", "texture", "wallpaper", "album", "photoEvery", "tint", "tintAmt", "dim"], fx:["fx", "fxPick"]};
let LTAB = "colors";
const PALETTES = [["Sage", {mode:"Light", accent:"#56703b", bgColor:"#dce4cf"}], ["Sand", {mode:"Light", accent:"#a2662f", bgColor:"#efe6d6"}], ["Slate", {mode:"Dark", accent:"#7fa6c9", bgColor:"#1b222b"}],
  ["Plum", {mode:"Dark", accent:"#c58bff", bgColor:"#1d1426"}], ["Ocean", {mode:"Dark", accent:"#5fd3c4", bgColor:"#0e2530"}], ["Ember", {mode:"Dark", accent:"#ff9f5a", bgColor:"#241512"}]];
const SHAPE_R = {Square:"3px", Rounded:"8px", Soft:"16px"};
const wallUrl = v => /^w-[0-9a-f]{12}$/.test(v.wallpaper || "") ? "/wallpaper/" + v.wallpaper : "";
const albumList = () => (SRC.albums || []).map(a => ({id:a.id, name:a.name || a.id}));

// reset one tab: back to the theme as it was saved (a new theme: as the theme it started from)
function lookResetTab(tab){
  if (!DRAFT) return;
  const base = DRAFT.isNew ? lookVals(DRAFT.from) : null;
  for (const k of LTAB_KEYS[tab] || []){ if (base) DRAFT.values[k] = base[k]; else delete DRAFT.values[k]; }
  draftPreview(true); show();
}
function lookPalette(i){
  const p = PALETTES[i]; if (!p || !DRAFT) return;
  Object.assign(DRAFT.values, p[1], {bg:"Color", textColor:"", bigColor:""});
  draftPreview(true); show();
}
function lookFxPick(eid){
  if (!DRAFT) return;
  const cur = (lookVals(DRAFT.id).fxPick || []).slice(), i = cur.indexOf(eid);
  if (i < 0) cur.push(eid); else cur.splice(i, 1);
  DRAFT.values.fxPick = cur; draftPreview(); show();
}
// a wallpaper: checked here (type), shrunk to a screen's size, then checked again by the server (type from its bytes, size); it stays on this server
async function wallUpload(file, id){
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)){ toast("Wallpapers must be PNG, JPEG or WebP pictures", "bad"); return; }
  try{
    const bmp = await createImageBitmap(file), k = Math.min(1, 2560 / Math.max(bmp.width, bmp.height)), c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const data = c.toDataURL("image/jpeg", .88);
    const r = await fetch("/wallpaper", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({data})}), j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || r.status);
    lookSet(id, "wallpaper", j.id); lookSet(id, "bg", "Wallpaper"); toast("Wallpaper added. It stays on this Countertop.", "ok"); show();
  }catch(e){ toast("Couldn't use that picture: " + e.message, "bad"); }
}
function wallRemove(id){
  const was = lookVals(id).wallpaper; lookSet(id, "wallpaper", ""); if (lookVals(id).bg === "Wallpaper") lookSet(id, "bg", "Sky");
  const used = [LS()].concat(looks().map(t => t.values || {})).some(x => x.wallpaper === was);      // deleted from the server when no theme uses it any more
  if (was && !used) fetch("/wallpaper/delete", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({id:was})}).catch(() => {});
  show();
}

function lookTabs(id, v, A){
  const choice = (k, val, label, sub, pic) => opt(id, k, val, label, sub, v[k], pic);
  const seg = (k, list) => '<span class="seg wide">' + list.map(([l, n]) => '<button ' + A + ' data-lk="' + k + '" data-lv="' + esc(n) + '"' + (String(v[k]) === String(n) ? ' class="on"' : "") + '>' + esc(l) + '</button>').join("") + '</span>';
  const range = (k, min, max, step) => '<input type="range" min="' + min + '" max="' + max + '" step="' + step + '" ' + A + ' data-lk="' + k + '" value="' + (v[k] || 0) + '"><span class="v">' + (v[k] || 0) + '%</span>';
  let h = '<div class="ltabs" role="tablist">' + LTABS.map(([k, l]) => '<button role="tab" aria-selected="' + (LTAB === k) + '" class="' + (LTAB === k ? "on" : "") + '" data-lact="tab" data-id="' + k + '">' + l + '</button>').join("") + '</div>';
  const reset = '<div class="sec"><button class="btnrow" data-lact="reset" data-id="' + LTAB + '">Reset this section</button></div>';
  const r = THEMELIB.resolve(v);
  if (LTAB === "colors"){
    h += sec("Palette", '<div class="opts pal">' + PALETTES.map(([n, p], i) => '<button class="opt" data-lact="pal" data-id="' + i + '"><span class="sample" style="background:' + p.bgColor + '"><i style="background:' + p.accent + '"></i></span><b>' + n + '</b></button>').join("") + '</div>',
      "A palette sets Light or dark, the accent and a solid background together. Change anything after it.");
    h += sec("Colors", row({t:"Light or dark", post:'<span class="seg">' + ["Dark", "Light"].map(m => '<button ' + A + ' data-lk="mode" data-lv="' + m + '"' + (v.mode === m ? ' class="on"' : "") + '>' + m + '</button>').join("") + '</span>'}) +
      '<div class="row col"><div class="t"><b>Accent color</b><small>Highlights, today\'s date, buttons</small></div><div class="sws">' +
        SWATCHES.map(c => '<button class="swc' + (String(v.accent).toLowerCase() === c ? " on" : "") + '" style="background:' + c + '" ' + A + ' data-lk="accent" data-lv="' + c + '" title="Accent color ' + c + '" aria-label="Accent color ' + c + '"></button>').join("") +
        '<input type="color" ' + A + ' data-lk="accent" value="' + esc(v.accent) + '" title="Any color"></div></div>' +
      row({t:"Holiday colors", sub:"The accent changes by itself in season: orange in fall, red and green at Christmas, pink for Valentine's", post: sw(v.holiday, A + ' data-lk="holiday" data-lb="1"')}) +
      textColorRows(v, A));
  }
  if (LTAB === "type"){
    const face = (k, name, val) => '<button class="opt' + (v[k] === val ? " on" : "") + '" ' + A + ' data-lk="' + k + '" data-lv="' + esc(val) + '"><span class="face" style="font-family:' + esc(THEMELIB.FONTS[name] || "inherit") + '">' + (k === "fontDisplay" ? "9:41" : "Aa") + '</span><b>' + esc(val === "Default" ? "Each tile's own" : val) + '</b></button>';
    h += sec("Text font", '<div class="opts">' + THEMELIB.BODY_FONTS.map(f => face("fontBody", f, f)).join("") + '</div>', "Lists, calendars and small text. These five stay readable at small sizes.");
    h += sec("Big numbers font", '<div class="opts">' + THEMELIB.DISPLAY_FONTS.map(f => face("fontDisplay", f, f)).join("") + '</div>', "The clock's time and the temperature. A font you picked in a Clock or Weather design keeps winning.");
    const sz = SIZES.find(s => s[1] === +v.textScale);
    h += sec("Text size", '<div class="row"><span class="seg wide">' + SIZES.map(([l, n]) => '<button ' + A + ' data-lk="textScale" data-lv="' + n + '"' + (+v.textScale === n ? ' class="on"' : "") + '>' + l + '</button>').join("") + '</span></div>', sz ? "" : "Now " + v.textScale + "%.");
  }
  if (LTAB === "surface"){
    const tilePic = k => '<span class="sample tl ' + k + '"><i></i><i></i></span>';
    h += sec("Tiles", '<div class="opts">' + choice("tiles", "Solid", "Solid", "", tilePic("solid")) + choice("tiles", "See-through", "See-through", "", tilePic("see")) + choice("tiles", "Clear", "Clear", "No boxes", tilePic("clear")) + '</div>' +
      (v.tiles === "See-through" ? row({t:"How solid", sub:"10% is almost clear", post:range("opacity", 10, 100, 5)}) : ""));
    h += sec("Edges", '<div class="opts">' + Object.keys(THEMELIB.SURFACES).map(n => choice("surface", n, n, THEMELIB.SURFACES[n].note, '<span class="sample sf sf-' + n.toLowerCase() + (r.light ? " light" : "") + '"><i></i></span>')).join("") + '</div>');
    h += sec("Corners", '<div class="opts">' + Object.keys(THEMELIB.SHAPES).map(n => choice("shape", n, n, "", '<span class="sample sh"><i style="border-radius:' + SHAPE_R[n] + '"></i></span>')).join("") + '</div>');
    h += sec("Titles", row({t:"Tile titles", sub:"The small heading on each tile", post: sw(v.titles !== false, A + ' data-lk="titles" data-lb="1"')}));
  }
  if (LTAB === "space"){
    const sp = n => '<span class="sample sp sp-' + n.toLowerCase() + '"><i></i><i></i><i></i><i></i></span>';
    h += sec("Spacing", '<div class="opts">' + [["Compact", "Tiles close together"], ["Normal", "As Countertop comes"], ["Roomy", "More air around tiles"]].map(([n, s]) => choice("density", n, n, s, sp(n))).join("") + '</div>',
      "The gap between tiles, the padding inside them and the margin around the page. Boxes you arranged keep their places; the editor spaces them the same way.");
  }
  if (LTAB === "bg"){
    const bgp = (b, css) => '<span class="sample" style="background:' + css + '"></span>';
    const tex = THEMELIB.TEXTURES, bgc = HEX6.test(v.bgColor || "") ? v.bgColor : "#0a0c0f";
    h += sec("Background", '<div class="opts">' + [["Sky", "Follows the sun", "linear-gradient(180deg,#2f6aa3,#0d1a2b)"], ["Color", "Solid color", esc(bgc)], ["Gradient", "", THEMELIB.GRADIENTS[v.gradient] || THEMELIB.GRADIENTS.Dusk],
      ["Texture", "", tex[v.texture] + "," + esc(bgc)], ["Wallpaper", "Your picture", wallUrl(v) ? "center/cover url('" + wallUrl(v) + "')" : "#222a33"], ["Photos", "From your album", "linear-gradient(165deg,#88a6c2,#d7b08a 52%,#4d5e43 53%)"]]
      .map(([b, s, css]) => choice("bg", b, b === "Color" ? "Solid color" : b, s, bgp(b, css))).join("") + '</div>');
    if (v.bg === "Color") h += sec("", row({t:"Background color", post:'<input type="color" ' + A + ' data-lk="bgColor" value="' + esc(bgc) + '">'}));
    if (v.bg === "Gradient") h += sec("Gradient", '<div class="opts">' + Object.keys(THEMELIB.GRADIENTS).map(n => choice("gradient", n, n, "", bgp(n, THEMELIB.GRADIENTS[n]))).join("") + '</div>');
    if (v.bg === "Texture") h += sec("Texture", '<div class="opts">' + Object.keys(tex).map(n => choice("texture", n, n, "", bgp(n, tex[n] + "," + esc(bgc)))).join("") + '</div>') +
      sec("", row({t:"Background color", post:'<input type="color" ' + A + ' data-lk="bgColor" value="' + esc(bgc) + '">'}));
    if (v.bg === "Wallpaper") h += sec("Your wallpaper", (wallUrl(v) ? '<div class="row"><span class="wallpv" style="background:center/cover url(\'' + wallUrl(v) + '\')"></span></div>' : "") +
      '<div class="row"><label class="btn wallbtn">' + (wallUrl(v) ? "Choose another picture" : "Choose a picture") + '<input type="file" hidden accept="image/png,image/jpeg,image/webp" ' + A + ' data-lwall="1"></label>' +
      (wallUrl(v) ? '<button data-lact="wallrm" data-id="' + id + '">Remove</button>' : "") + '</div>',
      "PNG, JPEG or WebP. It stays on this Countertop: a shared theme, layout or gallery submission never carries it, and shows a gradient instead.");
    if (v.bg === "Photos"){
      const al = albumList();
      h += sec("Photos", (al.length ? '<div class="row col"><div class="t"><b>Album</b></div><select ' + A + ' data-lk="album"><option value="">The first album</option>' + al.map(a => '<option value="' + esc(a.id) + '"' + (v.album === a.id ? " selected" : "") + '>' + esc(a.name) + '</option>').join("") + '</select></div>' :
        '<div class="row"><div class="t"><small>Add a photo album in Setup → Photo albums first.</small></div></div>') +
        '<div class="row col"><div class="t"><b>A new photo every</b></div>' + seg("photoEvery", [["1 min", 1], ["5 min", 5], ["15 min", 15], ["30 min", 30], ["1 hour", 60]]) + '</div>',
        "Albums are named only here: sharing this theme leaves the choice out.");
    }
    h += sec("Over the background", row({t:"Tint", sub:"A color washed over the background", post:(HEX6.test(v.tint || "") ? '' : '') + '<input type="color" ' + A + ' data-lk="tint" value="' + esc(HEX6.test(v.tint || "") ? v.tint : "#ff9f5a") + '">'}) +
      row({t:"Tint strength", post:range("tintAmt", 0, 60, 5)}) +
      row({t:"Dim the screen", sub:"Darker without changing the colors", post:range("dim", 0, 80, 5)}));
  }
  if (LTAB === "fx"){
    const pick = Array.isArray(v.fxPick) ? v.fxPick : [], own = pick.length > 0;
    h += sec("Effects", row({t:"Effects", sub:"Off pauses every effect while this theme shows", post: sw(v.fx !== "Off", A + ' data-lk="fx" data-lb="OnOff"')}) +
      '<div class="row col"><div class="t"><b>Which ones</b></div><span class="seg wide"><button data-lact="fxmode" data-id="mine"' + (own ? "" : ' class="on"') + '>The ones I turned on</button><button data-lact="fxmode" data-id="pick"' + (own ? ' class="on"' : "") + '>Pick for this theme</button></span></div>');
    if (own) h += sec("This theme plays", '<div class="fxlist">' + FXLIB.L.filter(d => !d.mine && !d.party).map(d => '<button class="chip' + (pick.includes(d.id) ? " on" : "") + '" data-lact="fxpick" data-id="' + esc(d.id) + '">' + esc(d.name) + '</button>').join("") + '</div>',
      "They still follow their own dates and the weather. Effects you made yourself stay in Effects.");
  }
  return h + reset;
}
