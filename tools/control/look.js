/* ---------- Look: looks (picture cards + a short Adjust screen), the schedule, effects, the night page ---------- */
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const LS = () => mods.look.settings;
const looks = () => (LS().items = LS().items || []);
const rules = () => (LS().rules = LS().rules || []);
const lookById = id => looks().find(t => t.id === id) || THEMELIB.get(id);      // yours, or a built-in one (tools/shared/themes.js)
const isBuiltin = id => !looks().some(t => t.id === id) && THEMELIB.has(id);
const themeKnown = id => id === "default" || !!lookById(id);
const ruleById = id => rules().find(r => r.id === id);
const LOOK_KEYS = ["mode", "accent", "holiday", "tiles", "opacity", "textScale", "titles", "bg", "bgColor", "dim", "fx"];
function lookVals(id){
  const v = {}; LOOK_KEYS.forEach(k => { v[k] = LS()[k]; });
  const t = id === "default" ? null : lookById(id);
  return Object.assign(v, t ? t.values || {} : {}, DRAFT && DRAFT.id === id ? DRAFT.values : {});
}
// Customize works on a draft: nothing changes on the screen until Save. The preview shows the draft (a trial, as in the Library).
let DRAFT = null;
function draftStart(id){ DRAFT = {id, values:{}, name:lookName(id)}; }
const draftDirty = () => !!DRAFT && (Object.keys(DRAFT.values).length > 0 || DRAFT.name !== lookName(DRAFT.id));
function lookSet(id, k, v){
  if (DRAFT && DRAFT.id === id){ DRAFT.values[k] = v; draftPreview(); return; }
  if (id === "default") LS()[k] = v;
  else if (isBuiltin(id)) return;               // built-in themes never change; Customize starts a copy
  else { const t = lookById(id); t.values = t.values || {}; t.values[k] = v; }
  save();
}
function draftSave(){
  const d = DRAFT; if (!d) return;
  if (d.id === "default") Object.assign(LS(), d.values);
  else if (!isBuiltin(d.id)){ const t = lookById(d.id); if (t){ t.values = Object.assign(t.values || {}, d.values); t.name = d.name.trim() || t.name; } }
  DRAFT = null; save(); toast("Saved " + lookName(d.id), "ok"); navStack().pop(); show();
}
function draftCancel(){ DRAFT = null; navStack().pop(); show(); }
let draftT = null;
function draftPreview(now){
  if (ECHO || !DRAFT) return;
  clearTimeout(draftT);
  draftT = setTimeout(async () => {
    const d = DRAFT; if (!d) return;
    const look = Object.assign({}, lookVals(d.id));
    try{
      const r = await fetch("/trial", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({pages:gpAll(), tiles:tileList(), look, name:d.name})});
      const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.status);
      if (DRAFT !== d) return;
      if (libSub()){ LIB.trial = j.id; libPv(); return; }
      PV.trial = j.id; PV.theme = "default"; PV.night = false; pvLoad();
    }catch(e){}
  }, now ? 0 : 400);
}
const lookName = id => id === "default" ? "Everyday" : (lookById(id) || {}).name || "Theme";
const SWATCHES = ["#7cb7ff", "#5fd3c4", "#7fd18a", "#ffd36e", "#ff9f5a", "#ff7a8a", "#c58bff", "#e9ecf1"];
const SIZES = [["Smaller", 90], ["Normal", 100], ["Bigger", 115], ["Biggest", 130]];

/* ----- a small drawing of the dashboard in a look ----- */
function lookColors(v){
  const light = v.mode === "Light";
  const bg = v.bg === "Color" ? esc(v.bgColor || "#0a0c0f") : v.bg === "Photos" ? "linear-gradient(165deg,#88a6c2 0%,#d7b08a 52%,#4d5e43 53%,#2a3624 100%)"
    : "linear-gradient(180deg,#2f6aa3 0%,#1c4370 45%,#0d1a2b 100%)";
  const op = v.tiles === "Clear" ? 0 : v.tiles === "See-through" ? (v.opacity || 60) / 100 : light ? .92 : .86;
  return {light, bg, card:(light ? "rgba(250,251,253," : "rgba(18,22,28,") + op + ")", fg:light ? "#1a1f26" : "#e9ecf1", dim:light ? "#5a6470" : "#8a939e",
    bd:v.tiles === "Clear" ? "transparent" : light ? "rgba(0,0,0,.06)" : "rgba(255,255,255,.07)", acc:esc(v.accent || "#7cb7ff")};
}
function lookPic(v, cls){
  const ts = (v.textScale || 100) / 100, {bg, card, fg, dim, bd, acc} = lookColors(v);
  const box = (x, y, w, h, inner) => '<i style="left:' + x + '%;top:' + y + '%;width:' + w + '%;height:' + h + '%;background:' + card + ';border-color:' + bd + '">' +
    (v.titles !== false ? '<s style="background:' + dim + '"></s>' : "") + inner + '</i>';
  const lines = (n, w) => [...Array(n)].map((_, i) => '<u style="background:' + (i ? dim : fg) + ';width:' + (w - i * 9) + '%;height:' + (.55 * ts) + 'em"></u>').join("");
  return '<div class="lpic ' + (cls || "") + '" style="background:' + bg + '">' +
    box(3, 5, 41, 31, '<em style="color:' + fg + ';font-size:' + (2.6 * ts) + 'em">9:41</em>') +
    box(46, 5, 51, 31, '<em style="color:' + acc + ';font-size:' + (2 * ts) + 'em">72°</em>') +
    box(3, 40, 60, 55, '<b style="background:' + acc + '"></b>' + lines(3, 80)) +
    box(65, 40, 32, 55, lines(4, 85)) +
    (v.dim ? '<i class="dm" style="background:rgba(0,0,0,' + (v.dim / 100) + ')"></i>' : "") + '</div>';
}

/* ----- schedule rules ----- */
function ruleMatches(r, d){
  const w = r.when || {}; if (r.on === false) return false;
  const m = x => { const [h, mi] = String(x).split(":").map(Number); return h * 60 + (mi || 0); }, hm = d.getHours() * 60 + d.getMinutes();
  if (w.from && w.to && w.from !== w.to){ const a = m(w.from), b = m(w.to); if (a < b ? !(hm >= a && hm < b) : !(hm >= a || hm < b)) return false; }
  if (w.days && w.days.length && !w.days.includes(d.getDay())) return false;
  if (w.dFrom && w.dTo){ const n = x => { const [mo, da] = String(x).split("-").map(Number); return mo * 100 + da; }, k = (d.getMonth() + 1) * 100 + d.getDate(), a = n(w.dFrom), b = n(w.dTo);
    if (a <= b ? !(k >= a && k <= b) : !(k >= a || k <= b)) return false; }
  return true;
}
// the theme on the screen: the last schedule rule that matches, else the theme picked with Use this theme, else Everyday
const usedLook = () => lookById(LS().use) ? LS().use : "default";
function curLook(){ const R = rules(); for (let i = R.length - 1; i >= 0; i--) if (themeKnown(R[i].look) && ruleMatches(R[i], new Date())) return R[i].look; return usedLook(); }
function curTheme(){ const id = curLook(); return id === "default" ? null : lookById(id); }        // the root screen's summary
function hm12(x){ const [h, m] = x.split(":").map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString([], {hour:"numeric", minute: m ? "2-digit" : undefined}); }
const hr12 = h => new Date(2000, 0, 1, +h || 0).toLocaleTimeString([], {hour:"numeric"});
function md(x){ const [mo, da] = x.split("-").map(Number); return MONTHS[mo - 1] + " " + da; }
function whenText(r){
  const w = r.when || {}, p = [];
  if (w.from && w.to && w.from !== w.to) p.push(hm12(w.from) + "–" + hm12(w.to));
  if (w.days && w.days.length && w.days.length < 7) p.push(w.days.length === 2 && w.days.includes(0) && w.days.includes(6) ? "Weekends" : w.days.length === 5 && !w.days.includes(0) && !w.days.includes(6) ? "Weekdays" : w.days.map(i => DAYS[i]).join(", "));
  if (w.dFrom && w.dTo) p.push(md(w.dFrom) + "–" + md(w.dTo));
  return p.length ? p.join(" · ") : "All the time";
}
const nightText = () => mods.night && mods.night.on ? hr12(mods.night.settings.start) + "–" + hr12(mods.night.settings.end) : "Off";

/* ----- screens ----- */
function themeWhen(id){       // a short line on when a theme shows
  const R = rules().filter(r => r.look === id && r.on !== false);
  if (id === curLook()) return "Showing now";
  if (id === usedLook()) return "Shows when nothing is scheduled";
  return R.length ? R.map(whenText).join("; ") : "Not in use";
}
function looksScreen(){
  const now = curLook();
  const card = id => '<button class="lcard' + (id === now ? " now" : "") + '" data-go="theme:' + id + '">' + lookPic(lookVals(id)) + '<b>' + esc(lookName(id)) + '</b><small>' + esc(themeWhen(id)) + '</small></button>';
  let h = '<div class="big">Themes</div><p class="intro">Colors, background, tiles and text size for every page. Tap a theme to see it on the preview, then use it or customize it.</p>';
  h += sec("Yours", '<div class="lcards">' + ["default"].concat(looks().map(t => t.id)).map(card).join("") +
    '<button class="lcard new" data-go="newlook"><div class="lpic plus">＋</div><b>New theme</b><small>Start from a built-in one</small></button></div>');
  h += sec("Built in", '<div class="lcards">' + THEMELIB.L.map(t => t.id).map(card).join("") + '</div>', "Built-in themes come with Countertop and stay as they are. Customize one to make your own.");
  h += sec("", row({t:"Schedule", sub: rules().length ? rules().length + (rules().length === 1 ? " rule" : " rules") + " · now: " + lookName(now) : "Switch themes at certain times", chev:true, attrs:'data-go="sched"'}),
    "Date format, 24-hour time and emoji are the same in every theme: Settings → Language and formats, and Icons and emoji.");
  h += '<div class="sec"><div class="foot">To share a theme, open it and press Share.</div></div>';
  return h;
}
// one theme: see it on the preview, use it, customize it, and when it shows by itself
function themeScreen(id){
  const t = id === "default" ? null : lookById(id), bi = isBuiltin(id);
  if (id !== "default" && !t) return '<div class="big">Theme not found</div>';
  const now = curLook(), used = usedLook() === id;
  let h = '<div class="big">' + esc(lookName(id)) + '</div>' + lookPic(lookVals(id), "big");
  h += '<p class="intro">' + esc(themeWhen(id)) + (now !== id ? " · " + esc(lookName(now)) + " is showing now" : "") + "." + (ECHO || now === id ? "" : " The preview shows " + esc(lookName(id)) + ".") + '</p>';
  h += '<div class="saverow">' + (used ? '<button disabled>In use</button>' : '<button class="pri" data-lact="use" data-id="' + id + '">Use this theme</button>') +
    (bi ? '<button data-lact="dup" data-id="' + id + '">Customize</button>' : '<button' + (used ? ' class="pri"' : "") + ' data-go="look:' + id + '">Customize</button><button data-go="share:theme:' + id + '">Share</button>') + '</div>';
  if (bi) h += '<div class="sec"><div class="foot">' + esc(t.sub) + '. Built in: it stays as it is, and Customize makes a copy of your own.</div></div>';
  if (t && t.gallery) h += '<div class="sec"><div class="foot">Downloaded from the community gallery' + (t.gallery.by ? ', made by ' + esc(t.gallery.by) : "") + '. <button class="lnk" data-l="c-open" data-id="' + esc(t.gallery.id) + '">Update or remove it</button></div></div>';
  if (used && now !== id) h += '<div class="sec"><div class="foot">The schedule is showing ' + esc(lookName(now)) + ' right now. ' + esc(lookName(id)) + ' comes back when its time is over.</div></div>';
  {
    const R = rules().filter(r => r.look === id);
    h += sec("Shows by itself", (R.length ? R.map(r => row({t:whenText(r), cls: r.on === false ? "off" : "", chev:true, attrs:'data-go="rule:' + r.id + '"'})).join("") : "") +
      row({t:R.length ? "Add another time" : "Add a time", cls:"add", chev:true, attrs:'data-lact="sched" data-id="' + id + '"'}),
      "At these times it takes over from the theme in use. See every time in Themes → Schedule.");
  }
  if (!bi) h += sec("", '<button class="btnrow" data-lact="dup" data-id="' + id + '">Duplicate</button>' + (t ? '<button class="btnrow red" data-lact="del" data-id="' + id + '">Delete theme</button>' : ""),
    t ? "" : "Everyday can't be deleted. Duplicate it to start a theme of your own.");
  return h;
}
function newLookScreen(){
  return '<div class="big">New theme</div><p class="intro">Pick a theme to start from. You get a copy of your own to change.</p>' +
    '<div class="lcards">' + ["default"].concat(THEMELIB.L.map(t => t.id)).map(id => '<button class="lcard" data-lact="make" data-id="' + id + '">' + lookPic(lookVals(id)) + '<b>' + esc(lookName(id)) + '</b><small>' + esc(id === "default" ? "Your everyday theme" : lookById(id).sub) + '</small></button>').join("") + '</div>';
}
const opt = (id, k, val, label, sub, cur, pic) => '<button class="opt' + (cur === val ? " on" : "") + '" data-lid="' + id + '" data-lk="' + k + '" data-lv="' + esc(val) + '">' + (pic || "") + '<b>' + esc(label) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : "") + '</button>';
function lookScreen(id){
  const t = id === "default" ? null : lookById(id);
  if (id !== "default" && !t) return '<div class="big">Theme not found</div>';
  if (!DRAFT || DRAFT.id !== id) draftStart(id);
  const v = lookVals(id), A = 'data-lid="' + id + '"';
  let h = '<div class="big">Customize ' + esc(DRAFT.name) + '</div>' + lookPic(v, "big");
  h += '<p class="intro">' + (ECHO ? "Nothing changes on the screen until you save." : "The preview follows your changes. The screen keeps its theme until you save.") + '</p>';
  if (t) h += sec("Name", '<div class="row col"><input type="text" ' + A + ' data-lk="__name" value="' + esc(DRAFT.name) + '"></div>');
  const bgPic = b => '<span class="sample" style="background:' + (b === "Sky" ? "linear-gradient(180deg,#2f6aa3,#0d1a2b)" : b === "Color" ? esc(v.bgColor) : "linear-gradient(165deg,#88a6c2,#d7b08a 52%,#4d5e43 53%)") + '"></span>';
  h += sec("Background", '<div class="opts">' + opt(id, "bg", "Sky", "Sky", "Follows the sun", v.bg, bgPic("Sky")) + opt(id, "bg", "Color", "Solid color", "", v.bg, bgPic("Color")) + opt(id, "bg", "Photos", "Photos", "From your album", v.bg, bgPic("Photos")) + '</div>' +
    (v.bg === "Color" ? row({t:"Background color", post:'<input type="color" ' + A + ' data-lk="bgColor" value="' + esc(v.bgColor) + '">'}) : ""),
    v.bg === "Sky" ? "The sky changes through the day: dawn, day, golden hour, dusk and night, from your real sunrise and sunset." : v.bg === "Photos" ? "Uses the first album in Setup → Photo albums, a new photo every 5 minutes." : "");
  h += sec("Colors", row({t:"Light or dark", post:'<span class="seg">' + ["Dark", "Light"].map(m => '<button ' + A + ' data-lk="mode" data-lv="' + m + '"' + (v.mode === m ? ' class="on"' : "") + '>' + m + '</button>').join("") + '</span>'}) +
    '<div class="row col"><div class="t"><b>Accent color</b><small>Highlights, today\'s date, buttons</small></div><div class="sws">' +
      SWATCHES.map(c => '<button class="swc' + (String(v.accent).toLowerCase() === c ? " on" : "") + '" style="background:' + c + '" ' + A + ' data-lk="accent" data-lv="' + c + '"></button>').join("") +
      '<input type="color" ' + A + ' data-lk="accent" value="' + esc(v.accent) + '" title="Any color"></div></div>' +
    row({t:"Holiday colors", sub:"The accent changes by itself in season: orange in fall, red and green at Christmas, pink for Valentine's", post: sw(v.holiday, A + ' data-lk="holiday" data-lb="1"')}));
  const tilePic = k => '<span class="sample tl ' + k + '"><i></i><i></i></span>';
  h += sec("Tiles", '<div class="opts">' + opt(id, "tiles", "Solid", "Solid", "", v.tiles, tilePic("solid")) + opt(id, "tiles", "See-through", "See-through", "", v.tiles, tilePic("see")) + opt(id, "tiles", "Clear", "Clear", "No boxes", v.tiles, tilePic("clear")) + '</div>' +
    (v.tiles === "See-through" ? row({t:"How solid", sub:"10% is almost clear", post:'<input type="range" min="10" max="100" step="5" ' + A + ' data-lk="opacity" value="' + (v.opacity || 60) + '"><span class="v">' + (v.opacity || 60) + '%</span>'}) : ""));
  const sz = SIZES.find(s => s[1] === +v.textScale);
  h += sec("Text size", '<div class="row"><span class="seg wide">' + SIZES.map(([l, n]) => '<button ' + A + ' data-lk="textScale" data-lv="' + n + '"' + (+v.textScale === n ? ' class="on"' : "") + '>' + l + '</button>').join("") + '</span></div>',
    sz ? "" : "Now " + v.textScale + "%.");
  h += '<details class="sec more"' + (store.more ? " open" : "") + '><summary>More</summary><div class="grp">' +
    row({t:"Dim the screen", sub:"Darker without changing the colors", post:'<input type="range" min="0" max="80" step="5" ' + A + ' data-lk="dim" value="' + (v.dim || 0) + '"><span class="v">' + (v.dim || 0) + '%</span>'}) +
    row({t:"Tile titles", sub:"The small heading on each tile", post: sw(v.titles !== false, A + ' data-lk="titles" data-lb="1"')}) +
    row({t:"Effects", sub:"Off pauses every effect while this theme shows", post: sw(v.fx !== "Off", A + ' data-lk="fx" data-lb="OnOff"')}) +
    '</div></details>';
  h += '<div class="draftbar"><span>' + (draftDirty() ? "Unsaved changes" : "No changes yet") + '</span><button data-lact="cancel">Cancel</button><button class="pri" data-lact="save"' + (draftDirty() ? "" : " disabled") + '>Save</button></div>';
  return h;
}
function schedScreen(){
  const R = rules(), now = curLook();
  let h = '<div class="big">Schedule</div><p class="intro">Switch to another theme at certain times or dates. The rest of the time ' + esc(lookName(usedLook())) + ' shows.</p>';
  h += sec("Themes", (R.length ? R.map((r, i) => row({t:lookName(r.look), sub:whenText(r), cls: r.on === false ? "off" : "", attrs:'data-go="rule:' + r.id + '"', chev:true,
      v: ruleMatches(r, new Date()) && now === r.look ? "Now" : "",
      pre:'<span style="display:flex;flex-direction:column;gap:2px;margin-right:2px"><button class="link" style="padding:0 4px;font-size:13px" data-ract="up" data-id="' + r.id + '"' + (i ? "" : " disabled") + '>▲</button><button class="link" style="padding:0 4px;font-size:13px" data-ract="down" data-id="' + r.id + '"' + (i < R.length - 1 ? "" : " disabled") + '>▼</button></span>',
      post: sw(r.on !== false, 'data-ract="toggle" data-id="' + r.id + '"')})).join("") : '<div class="row"><div class="t"><small>Nothing scheduled: ' + esc(lookName(usedLook())) + ' always shows</small></div></div>') +
    row({t:"Add a time", cls:"add", chev:true, attrs:'data-ract="new"'}),
    "Showing now: " + lookName(now) + ". When several match, the lowest one in the list wins. The night page has its own hours: Pages → Night page.");
  return h;
}
function ruleScreen(id){
  const r = ruleById(id); if (!r) return '<div class="big">Not found</div>';
  const w = r.when || {}, a = 'data-rid="' + id + '"';
  let h = '<div class="big">' + esc(lookName(r.look)) + '</div>';
  const o = id => '<option value="' + esc(id) + '"' + (id === r.look ? " selected" : "") + '>' + esc(lookName(id)) + '</option>';
  h += sec("Theme", '<div class="row col"><select ' + a + ' data-rk="look"><optgroup label="Yours">' + ["default"].concat(looks().map(t => t.id)).map(o).join("") +
    '</optgroup><optgroup label="Built in">' + THEMELIB.L.map(t => o(t.id)).join("") + '</optgroup>' + (themeKnown(r.look) ? "" : '<option value="" selected>Pick a theme</option>') + '</select></div>');
  const mon = (x, k) => '<select ' + a + ' data-rk="' + k + '" data-t="md-m"><option value="">—</option>' + MONTHS.map((m, i) => '<option value="' + (i + 1) + '"' + (x && +x.split("-")[0] === i + 1 ? " selected" : "") + '>' + m + '</option>').join("") + '</select>' +
    ' <input type="number" min="1" max="31" style="width:64px" ' + a + ' data-rk="' + k + '" data-t="md-d" value="' + (x ? +x.split("-")[1] : "") + '">';
  h += sec("When", row({t:"From", sub:"Time of day (leave both empty for all day)", post:'<input type="time" ' + a + ' data-rk="from" value="' + esc(w.from || "") + '">'}) +
    row({t:"Until", post:'<input type="time" ' + a + ' data-rk="to" value="' + esc(w.to || "") + '">'}) +
    '<div class="row col"><div class="t"><b>Days</b><small>None picked = every day</small></div><div class="seg" style="align-self:flex-start">' +
      DAYS.map((d, i) => '<button data-ract="day" data-id="' + id + '" data-k="' + i + '"' + ((w.days || []).includes(i) ? ' class="on"' : "") + '>' + d + '</button>').join("") + '</div></div>' +
    row({t:"Dates from", sub:"Leave empty for all year", post: mon(w.dFrom, "dFrom")}) + row({t:"Dates until", post: mon(w.dTo, "dTo")}),
    "Right now: " + (ruleMatches(Object.assign({}, r, {on:true}), new Date()) ? "this is its time." : "not its time."));
  h += sec("", '<button class="btnrow red" data-ract="del" data-id="' + id + '">Remove from schedule</button>');
  return h;
}
function nightScreen(){
  const c = mods.night, s = c.settings, a = h => '<select data-nk="' + h + '">' + [...Array(24).keys()].map(i => '<option value="' + i + '"' + (+s[h] === i ? " selected" : "") + '>' + hr12(i) + '</option>').join("") + '</select>';
  const pg = gpAll().find(p => p.id === "night");
  let h = '<div class="big">Night page</div><p class="intro">' + esc(schema.night.desc) + '</p>';
  h += sec("", row({t:"Use the night page", post: sw(c.on, 'data-on="night"')}));
  h += sec("When", row({t:"From", post:a("start")}) + row({t:"Until", post:a("end")}));
  h += sec("Screen", '<div class="row col"><div class="t"><b>How dark</b></div><span class="seg wide">' + [["Bright", 0], ["Dim", 25], ["Dimmer", 45], ["Darkest", 70]].map(([l, n]) =>
      '<button data-nk="dim" data-nv="' + n + '"' + (+s.dim === n ? ' class="on"' : "") + '>' + l + '</button>').join("") + '</span></div>' +
    row({t:"Move slightly every minute", sub:"Shifts the page a few pixels so nothing sits in one spot all night", post: sw(s.drift !== false, 'data-m="night" data-k="drift" data-t="bool"')}),
    "No effects play on the night page.");
  h += sec("On this page", '<div class="row"><div class="t"><b>' + esc(pageSummary(pg)) + '</b></div></div>' +
    (ECHO ? "" : '<button class="btnrow blue" data-act="edit" data-id="night">Edit the night page on screen</button>'),
    ECHO ? "To change it: press Done, hold any tile, then pick the Night tab at the top." : "Add a forecast, tomorrow's events or anything else, like any page. The preview shows the night page while you're here.");
  return h;
}

/* ----- effects ----- */
const fxItemsC = () => (mods.effects.settings.items = mods.effects.settings.items || []);
const fxC = id => FXLIB.conf(fxItemsC(), id);
function fxSet(id, k, v){ let o = fxItemsC().find(x => x.id === id); if (!o){ o = {id}; fxItemsC().push(o); } o[k] = v; save(); }
function fxSummary(){
  if (!mods.effects || !mods.effects.on) return "Off";
  const on = FXLIB.L.filter(d => fxC(d.id).on), now = on.filter(d => !d.wx && FXLIB.timeOk(fxC(d.id), new Date()));
  return on.length + " on" + (now.length ? " · this time of year: " + now.slice(0, 3).map(d => d.name).join(", ") + (now.length > 3 ? "…" : "") : "");
}
function effectsScreen(){
  const c = mods.effects;
  let h = '<div class="big">Effects</div><p class="intro">' + esc(schema.effects.desc) + '</p>';
  h += sec("", row({t:"Effects", post: sw(c.on, 'data-on="effects"')}) +
    row({t:"Rain, snow and falling things in front of the tiles", sub:"Off puts them behind the tiles, where they show only between and through see-through tiles.", post: sw(c.settings.front !== false, 'data-m="effects" data-k="front" data-t="bool"')}));
  const noEmo = (mods.general.settings.emoji || "Emoji") !== "Emoji";
  if (noEmo) h += '<div class="sec"><div class="foot">Emoji are off (Settings → Icons and emoji), so only the weather effects run. The others keep their settings for when emoji come back.</div></div>';
  if (lookVals(curLook()).fx === "Off") h += '<div class="sec"><div class="foot">The theme showing now, ' + esc(lookName(curLook())) + ', pauses every effect. Turn that off in Themes → ' + esc(lookName(curLook())) + ' → Customize → More.</div></div>';
  const card = d => { const f = fxC(d.id), now = !d.wx && !d.party && FXLIB.timeOk(f, new Date());
    return '<div class="fxc' + (f.on ? "" : " off") + '" data-go="fx:' + d.id + '"><canvas data-fx="' + d.id + '"></canvas><div class="fxt"><div><b>' + esc(d.name) + '</b><small>' + esc(FXLIB.whenText(f)) + (now && f.on ? ' · <span class="nowtag">now</span>' : "") + '</small></div>' +
      sw(f.on, 'data-fxon="' + d.id + '"') + '</div></div>'; };
  for (const [g, foot] of FXLIB.GROUPS){
    const L = FXLIB.L.filter(d => d.grp === g);
    h += '<div class="sec"><h2>' + esc(g) + '</h2><div class="fxgrid">' + L.map(card).join("") + '</div>' + (foot ? '<div class="foot">' + esc(foot) + '</div>' : "") + '</div>';
  }
  h += '<div class="sec"><h2>Yours</h2><div class="fxgrid">' + FXLIB.L.filter(d => d.mine).map(card).join("") +
    '<div class="fxc new" data-fxa="new"><div class="fxplus">＋</div><div class="fxt"><div><b>New effect</b><small>Your own emoji, falling or floating</small></div></div></div></div>' +
    '<div class="foot">Effects you make or open from a file. Open one and press Share to send it; open a file in Library → Import a file.</div></div>';
  return h;
}
function fxScreen(id){
  const d = FXLIB.BY[id]; if (!d) return '<div class="big">Not found</div>';
  const f = fxC(id), a = 'data-fxid="' + id + '"';
  const seg = (k, opts) => '<span class="seg wide">' + opts.map(([l, v]) => '<button ' + a + ' data-fxk="' + k + '" data-fxv="' + v + '"' + (String(f[k]) === String(v) ? ' class="on"' : "") + '>' + esc(l) + '</button>').join("") + '</span>';
  let h = '<div class="big">' + esc(d.name) + '</div><div class="fxc big"><canvas data-fx="' + id + '"></canvas></div><p class="intro">' + esc(d.desc) + '</p>';
  h += sec("", row({t:"On", post: sw(f.on, 'data-fxon="' + id + '"')}));
  if (d.mine) h += '<div class="saverow"><button data-go="fxedit:' + id + '">Edit</button><button data-go="share:effect:' + id + '">Share</button></div>';
  let rows = '<div class="row col"><div class="t"><b>How much</b></div>' + seg("amount", [["Few", "Few"], ["Some", "Some"], ["Lots", "Lots"]]) + '</div>';
  if (!d.party){
    const W = d.wx ? [[(d.wx[0] === "sun" || d.wx[0] === "stars") ? "Matching weather" : "Matching weather", "weather"], ["Always", "always"]]
      : d.season ? [["In season", "season"], ["All year", "always"], ["My dates", "dates"]] : [["All year", "always"], ["My dates", "dates"]];
    rows += '<div class="row col"><div class="t"><b>When</b>' + (d.wx || d.season ? '<small>' + esc(d.wx ? "Matching weather: " + FXLIB.whenText(Object.assign({}, f, {when:"weather"})).toLowerCase() : "In season: " + FXLIB.seasonText(d)) + '</small>' : "") + '</div>' + seg("when", W) + '</div>';
    if (f.when === "dates"){
      const mon = (x, k) => '<select ' + a + ' data-fxk="' + k + '" data-t="md-m"><option value="">—</option>' + MONTHS.map((m, i) => '<option value="' + (i + 1) + '"' + (x && +x.split("-")[0] === i + 1 ? " selected" : "") + '>' + m + '</option>').join("") + '</select>' +
        ' <input type="number" min="1" max="31" style="width:64px" ' + a + ' data-fxk="' + k + '" data-t="md-d" value="' + (x ? +x.split("-")[1] : "") + '">';
      rows += row({t:"From", post:mon(f.from, "from")}) + row({t:"Until", post:mon(f.to, "to")});
    }
  }
  if (d.layer === "show") rows += '<div class="row col"><div class="t"><b>How often</b><small>About; it varies a little so it doesn\'t feel like clockwork</small></div>' +
    seg("every", [["5 min", 5], ["15 min", 15], ["30 min", 30], ["Hourly", 60], ["3 hours", 180]]) + '</div>';
  h += sec("Settings", rows, d.layer === "sky" ? "Drawn behind the tiles, on the background." : d.layer === "show" ? "Shows play in front of the tiles and last a few seconds." :
    (mods.effects.settings.front !== false ? "Drawn in front of the tiles (see Effects)." : "Drawn behind the tiles (see Effects)."));
  if (!ECHO) h += sec("", '<button class="btnrow blue" data-fxplay="' + id + '">Play it on the preview</button>', "Plays it once on the dashboard preview to the right, whatever the date or weather.");
  if (d.mine && mineById(id) && mineById(id).gallery){ const g = mineById(id).gallery; h += '<div class="sec"><div class="foot">Downloaded from the community gallery' + (g.by ? ', made by ' + esc(g.by) : "") + '. <button class="lnk" data-l="c-open" data-id="' + esc(g.id) + '">Update or remove it</button></div></div>'; }
  if (d.mine) h += sec("", '<button class="btnrow" data-go="fxedit:' + id + '">Edit</button><button class="btnrow" data-go="share:effect:' + id + '">Share</button><button class="btnrow red" data-fxa="del" data-id="' + id + '">Delete effect</button>',
    "Your own effect. Edit changes its emoji and how they move; Share makes a file to send.");
  return h;
}
// little live previews on the effect cards; only the ones on screen animate
let FXPV = [], fxObs = null;
function pvBg(id){
  const day = ["sun", "clouds", "fog", "rain", "snow", "spring", "summer", "butterflies", "july4", "gust", "leaves", "thanks", "turkey"].includes(id);
  return (cx, W, H) => { const g = cx.createLinearGradient(0, 0, 0, H);
    if (day){ g.addColorStop(0, "#2f6aa3"); g.addColorStop(.5, "#1c4370"); g.addColorStop(1, "#0d1a2b"); } else { g.addColorStop(0, "#1b2348"); g.addColorStop(.6, "#0b1022"); g.addColorStop(1, "#06080f"); }
    cx.fillStyle = g; cx.fillRect(0, 0, W, H); };
}
function pvTiles(cx, W, H){
  const rr = (x, y, w, h) => { cx.beginPath(); if (cx.roundRect) cx.roundRect(x, y, w, h, 28); else cx.rect(x, y, w, h); cx.fill(); };
  const u = W / 1920;
  cx.fillStyle = "rgba(18,22,28,.86)"; rr(80 * u, H * .18, 760 * u, H * .64); rr(900 * u, H * .18, 940 * u, H * .64);
  cx.fillStyle = "rgba(233,236,241,.75)"; cx.font = "600 " + Math.round(H * .2) + "px system-ui,sans-serif"; cx.fillText("9:41", 150 * u, H * .55);
  cx.fillStyle = "rgba(138,147,158,.6)"; [0, 1, 2].forEach(i => cx.fillRect(980 * u, H * (.32 + i * .14), (700 - i * 160) * u, H * .06));
}
function fxPreviews(){
  FXPV.forEach(p => p.r && p.r.pause(true)); FXPV = [];
  if (fxObs) fxObs.disconnect();
  const cvs = [...document.querySelectorAll("canvas[data-fx]")]; if (!cvs.length || typeof FXLIB === "undefined") return;
  const front = mods.effects.settings.front !== false;
  const start = cv => {
    const id = cv.dataset.fx, d = FXLIB.BY[id], f = fxC(id), p = FXPV.find(x => x.cv === cv); if (!p || p.r) { if (p && p.r) p.r.pause(false); return; }
    p.r = FXLIB.Runner(cv, {preview:true, always:true, fps:20, base:1000, under:pvBg(id), over:pvTiles});
    const behind = d.layer === "sky" || (d.layer === "fall" && !front);
    if (d.layer === "show"){ const loop = () => { if (p.r && !p.gone) p.r.play(id, {amount:f.amount, ms:3500}, () => setTimeout(loop, 1500)); }; loop(); }
    else p.r.set([{id, amount:f.amount, kind: id === "rain" ? "storm" : "", front:!behind, behind}]);
  };
  cvs.forEach(cv => FXPV.push({cv}));
  if ("IntersectionObserver" in window){
    fxObs = new IntersectionObserver(E => E.forEach(e => { const p = FXPV.find(x => x.cv === e.target); if (!p) return;
      if (e.isIntersecting) start(e.target); else if (p.r) p.r.pause(true); }));
    cvs.forEach(cv => fxObs.observe(cv));
  } else cvs.forEach(start);
}

/* ----- your own effects: designed as a draft (Save, Cancel), like themes ----- */
const mineList = () => (mods.effects.settings.mine = mods.effects.settings.mine || []);
const mineById = id => mineList().find(m => m.id === id);
const FX_KEYS = ["name", "glyphs", "motion", "size", "speed", "spin", "from", "to"];
const fxPlain = m => { const o = {}; FX_KEYS.forEach(k => { if (m[k] !== undefined) o[k] = m[k]; }); return o; };
let FXDRAFT = null;
function fxDraftStart(id){
  const m = id === "new" ? {name:"My effect", glyphs:["⭐"], motion:"fall", size:"Medium", speed:"Normal", spin:true, from:"", to:""} : mineById(id);
  if (!m) return;
  FXDRAFT = Object.assign(fxPlain(m), {id: id === "new" ? "my" + Date.now().toString(36) : id, isNew: id === "new"});
  FXDRAFT.orig = JSON.stringify(fxPlain(FXDRAFT));
}
const fxDirty = () => !!FXDRAFT && (FXDRAFT.isNew || JSON.stringify(fxPlain(FXDRAFT)) !== FXDRAFT.orig);
// what FXLIB knows about: your saved effects, plus the one being designed or opened from a file
function fxRegister(){
  const extra = FXDRAFT ? [FXDRAFT] : LIB.fimp && navStack()[navStack().length - 1] === "fximp" ? [Object.assign({}, LIB.fimp, {id:"__imp"})] : [];
  FXLIB.setMine(mineList().filter(m => !extra.some(e => e.id === m.id)).concat(extra, typeof commFx === "function" ? commFx() : []));
}
function fxEditScreen(id){
  if (!FXDRAFT || (FXDRAFT.id !== id && !(id === "new" && FXDRAFT.isNew))){ fxDraftStart(id); fxRegister(); }
  const D = FXDRAFT; if (!D) return '<div class="big">Not found</div>';
  const seg = (k, opts) => '<span class="seg wide">' + opts.map(([v, l]) => '<button data-fxd="' + k + '" data-fxdv="' + esc(String(v)) + '"' + (String(D[k]) === String(v) ? ' class="on"' : "") + '>' + esc(l) + '</button>').join("") + '</span>';
  const mon = (x, k) => '<select data-fxd="' + k + '" data-t="md-m"><option value="">—</option>' + MONTHS.map((m, i) => '<option value="' + (i + 1) + '"' + (x && +x.split("-")[0] === i + 1 ? " selected" : "") + '>' + m + '</option>').join("") + '</select>' +
    ' <input type="number" min="1" max="31" style="width:64px" data-fxd="' + k + '" data-t="md-d" value="' + (x ? +x.split("-")[1] : "") + '">';
  let h = '<div class="big">' + esc(D.isNew ? "New effect" : D.name) + '</div><div class="fxc big"><canvas data-fx="' + esc(D.id) + '"></canvas></div>' +
    '<p class="intro">Emoji that drift across the screen. The picture above follows your changes; the screen changes when you save.</p>';
  h += sec("Name", '<div class="row"><input type="text" data-fxd="name" maxlength="60" value="' + esc(D.name) + '" style="flex:1"></div>');
  h += sec("Emoji", '<div class="row col"><div class="t"><b style="font-size:28px;letter-spacing:4px">' + esc(D.glyphs.join(" ")) + '</b><small>Type or paste up to 8. They\'re mixed at random.</small></div>' +
    '<input type="text" data-fxd="glyphs" value="' + esc(D.glyphs.join(" ")) + '" style="width:100%"></div>');
  h += sec("How they move", '<div class="row col">' + seg("motion", FXLIB.MOTIONS) + '</div>' +
    '<div class="row col"><div class="t"><b>Size</b></div>' + seg("size", Object.keys(FXLIB.SIZE).map(k => [k, k])) + '</div>' +
    '<div class="row col"><div class="t"><b>Speed</b></div>' + seg("speed", Object.keys(FXLIB.SPEED).map(k => [k, k])) + '</div>' +
    (D.motion === "fall" ? row({t:"Spin as they fall", post: sw(D.spin !== false, 'data-fxd="spin"')}) : ""));
  h += sec("Its season", row({t:"From", post:mon(D.from, "from")}) + row({t:"Until", post:mon(D.to, "to")}),
    "Optional. With a season it plays only then (you can still pick All year on its page). Leave both empty for all year.");
  h += '<div class="draftbar"><span>' + (fxDirty() ? (D.isNew ? "Not saved yet" : "Unsaved changes") : "No changes yet") + '</span><button data-fxa="cancel">Cancel</button><button class="pri" data-fxa="save"' + (fxDirty() ? "" : " disabled") + '>Save</button></div>';
  return h;
}
function fxAction(a, id){
  if (a === "new"){ FXDRAFT = null; go("fxedit:new"); return; }
  if (a === "cancel"){ FXDRAFT = null; fxRegister(); navStack().pop(); show(); return; }
  if (a === "save"){
    const D = FXDRAFT; if (!D) return;
    const m = Object.assign(fxPlain(D), {id:D.id, name:(D.name || "").trim() || "My effect"});
    const L = mineList(), i = L.findIndex(x => x.id === m.id);
    if (i < 0) L.push(m); else L[i] = Object.assign({}, L[i], m);        // keeps where a downloaded effect came from
    FXDRAFT = null; fxRegister(); save(); toast("Saved " + m.name, "ok");
    navStack().pop(); if (D.isNew) go("fx:" + m.id); else show(); return;
  }
  if (a === "del"){
    const m = mineById(id); if (!m || !confirmDel({one:"effect"}, id)) return;
    mods.effects.settings.mine = mineList().filter(x => x.id !== id); mods.effects.settings.items = fxItemsC().filter(x => x.id !== id);
    fxRegister(); save(); navStack().pop(); show(); return;
  }
  if (a === "add"){        // an effect opened from a file
    const f = LIB.fimp; if (!f) return;
    const m = Object.assign(fxPlain(f), {id:"my" + Date.now().toString(36)});
    mineList().push(m); LIB.fimp = null; fxRegister(); save(); toast("Added " + m.name + " to your effects", "ok");
    navStack().pop(); go("fx:" + m.id); return;
  }
}
function fxDraftSet(k, v){
  const D = FXDRAFT; if (!D) return;
  if (k === "glyphs"){ const g = (String(v).match(EMO_RE) || []).slice(0, 8); if (!g.length){ toast("Type or paste one or more emoji", "bad"); show(); return; } v = g; }
  if (k === "name") v = String(v).slice(0, 60);
  D[k] = v; fxRegister();
  if (k === "name" || k === "glyphs"){ fxDraftBits(D); return; }        // typed text: don't redraw the screen, or the next tap (Save, a button) is lost
  show();
}
// brings what depends on the typed name or emoji up to date without redrawing the screen
function fxDraftBits(D){
  const root = libSub() ? libEl() : document, big = root.querySelector(".big");
  if (big && D.isNew !== true) big.textContent = D.name;
  const g = root.querySelector('input[data-fxd="glyphs"]'); if (g && g.previousElementSibling){ const b = g.previousElementSibling.querySelector("b"); if (b) b.textContent = D.glyphs.join(" "); }
  const bar = root.querySelector(".draftbar");
  if (bar){ const sp = bar.querySelector("span"), sv = bar.querySelector('[data-fxa="save"]'); if (sp) sp.textContent = D.isNew ? "Not saved yet" : "Unsaved changes"; if (sv) sv.disabled = !fxDirty(); }
  if (D.glyphs) fxPreviews();        // the picture at the top draws the new emoji
}

/* ----- sharing a theme or one of your own effects as a small file ----- */
const SHARE = {key:"", name:"", desc:""};
function sharePack(key){
  const [kind, id] = [key.split(":")[0], key.split(":").slice(1).join(":")];
  const base = {countertop:kind, format:LIB_FMT, name:SHARE.name.trim() || (kind === "theme" ? "Shared theme" : "Shared effect"), description:SHARE.desc.trim(), made:new Date().toISOString().slice(0, 10)};
  if (kind === "theme"){ const v = lookVals(id), values = {}; LOOK_KEYS.forEach(k => { if (v[k] !== undefined) values[k] = v[k]; }); return Object.assign(base, {values}); }
  const m = mineById(id); if (!m) return null;
  const e = fxPlain(m); delete e.name;
  return Object.assign(base, {effect:e});
}
function shareScreen(key){
  const kind = key.split(":")[0], id = key.split(":").slice(1).join(":");
  const known = kind === "theme" ? id === "default" || lookById(id) : mineById(id);
  if (!known) return '<div class="big">Not found</div>';
  if (SHARE.key !== key) Object.assign(SHARE, {key, name: kind === "theme" ? lookName(id) : mineById(id).name, desc:""});
  const pkg = sharePack(key), what = kind === "theme" ? "theme" : "effect";
  let h = '<div class="big">Share ' + esc(kind === "theme" ? lookName(id) : mineById(id).name) + '</div>' + (kind === "theme" ? lookPic(lookVals(id), "big") : '<div class="fxc big"><canvas data-fx="' + esc(id) + '"></canvas></div>');
  h += '<p class="intro">A small file of this ' + what + ' to send to a friend or keep as a backup. They open it in Library → Import a file, and it joins their ' + what + 's only when they add it.' +
    (kind === "theme" ? " It holds colors, background, tiles and text size; " + (lookVals(id).bg === "Photos" ? "your photos stay here (theirs show instead)." : "nothing else.") : " It holds the emoji and how they move; no code.") + '</p>';
  h += sec("Name", '<div class="row"><input type="text" data-sh="name" maxlength="80" value="' + esc(SHARE.name) + '" style="flex:1"></div>');
  h += sec("What it\'s for", '<div class="row"><textarea data-sh="desc" maxlength="500" rows="2" style="flex:1" placeholder="' + (kind === "theme" ? "Warm and dim for evenings." : "Pumpkins and bats for October.") + '">' + esc(SHARE.desc) + '</textarea></div>');
  h += sec("", (ECHO ? "" : '<button class="btnrow blue" data-sha="download">Download file</button>') + '<button class="btnrow' + (ECHO ? " blue" : "") + '" data-sha="copy">Copy share code</button><button class="btnrow" data-sha="submit">Submit to the gallery</button>');
  h += sec("Share code", '<div class="row"><textarea class="code" readonly data-sh="code" rows="3" style="flex:1;font-size:12px;word-break:break-all">' + esc(libCode(pkg)) + '</textarea></div>', "The same " + what + " as text, for pasting into a message.");
  return h;
}
function fileSave(pkg, fallback){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(pkg, null, 1)], {type:"application/json"}));
  a.download = (String(pkg.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || fallback) + ".countertop";
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function textCopy(box, msg){
  if (!box) return;
  try{ await navigator.clipboard.writeText(box.value); }
  catch(e){ box.select(); try{ document.execCommand("copy"); }catch(e2){} }      // plain http on the home network has no clipboard API
  toast(msg, "ok");
}
document.addEventListener("input", e => {
  const t = e.target; if (!t.dataset || !t.dataset.sh || t.dataset.sh === "code") return;
  SHARE[t.dataset.sh] = t.value;
  const box = document.querySelector('[data-sh="code"]'), pkg = sharePack(SHARE.key); if (box && pkg) box.value = libCode(pkg);
});

/* ----- a theme or an effect opened from a file: see it first, then add it ----- */
function themeImpScreen(){
  const T = LIB.timp; if (!T) return '<div class="big">Nothing to open</div>';
  const v = Object.assign(lookVals("default"), T.values);
  const same = ["default"].concat(looks().map(t => t.id), THEMELIB.L.map(t => t.id)).find(id => LOOK_KEYS.every(k => String(lookVals(id)[k]) === String(v[k])));
  let h = '<div class="big">' + esc(T.name) + '</div>' + lookPic(v, "big");
  h += '<p class="intro">' + esc(T.desc || "A theme from a shared file.") + (T.made ? " Made " + esc(T.made) + "." : "") + (ECHO ? "" : " The preview shows it with your own pages.") + '</p>';
  if (same) h += '<div class="sec"><div class="foot">You already have this theme: ' + esc(lookName(same)) + '.</div></div>';
  h += '<div class="saverow"><button class="pri" data-tia="use">Add and use it</button><button data-tia="add">Add to my themes</button></div>';
  h += '<div class="sec"><div class="foot">Adding it changes nothing on the screen until you use it. ' + esc(lookName(curLook())) + ' stays as it is.</div></div>';
  return h;
}
function themeImpAction(a){
  const T = LIB.timp; if (!T) return;
  const nid = "t" + Date.now().toString(36), base = T.name, name = looks().some(t => t.name === base) ? base + " " + (looks().length + 1) : base;
  looks().push({id:nid, name, values:Object.assign(lookVals("default"), T.values), from:"file"});
  if (a === "use") LS().use = nid;
  LIB.timp = null; save(); toast(a === "use" ? "Using " + name : "Added " + name + " to your themes", "ok");
  navStack().pop(); go("theme:" + nid);
}
function fxImpScreen(){
  const f = LIB.fimp; if (!f) return '<div class="big">Nothing to open</div>';
  let h = '<div class="big">' + esc(f.name) + '</div><div class="fxc big"><canvas data-fx="__imp"></canvas></div>';
  h += '<p class="intro">' + esc(f.desc || "An effect from a shared file.") + (f.made ? " Made " + esc(f.made) + "." : "") + '</p>';
  h += sec("", row({t:"Emoji", v:f.glyphs.join(" ")}) + row({t:"How they move", v:(FXLIB.MOTIONS.find(x => x[0] === f.motion) || [, ""])[1] + " · " + f.size + " · " + f.speed}) +
    row({t:"When", v: f.from && f.to ? FXLIB.mdTxt(f.from) + "–" + FXLIB.mdTxt(f.to) : "All year"}));
  h += '<div class="saverow"><button class="pri" data-fxa="add">Add to my effects</button></div>';
  h += '<div class="sec"><div class="foot">It\'s plain data: emoji and how they move, with no code. It starts on; turn it off or change when it plays on its page.</div></div>';
  return h;
}
// files: what's in a theme or an effect is checked against what this Countertop knows
function themeRead(j){
  const str = (v, n) => typeof v === "string" ? v.trim().slice(0, n) : "", LSD = (schema.look && schema.look.settings) || {}, values = {};
  for (const k of LOOK_KEYS) if (j.values && j.values[k] !== undefined){ const c = libClean(LSD[k], j.values[k]); if (c !== undefined) values[k] = c; }
  if (!Object.keys(values).length) throw new Error("This theme has no colors or settings in it.");
  return {name:str(j.name, 80) || "Shared theme", desc:str(j.description, 500), made:str(j.made, 10), values};
}
function fxRead(j){
  const str = (v, n) => typeof v === "string" ? v.trim().slice(0, n) : "", e = j.effect && typeof j.effect === "object" ? j.effect : {};
  const glyphs = (Array.isArray(e.glyphs) ? e.glyphs : []).filter(g => typeof g === "string" && g && (g.match(EMO_RE) || []).join("") === g).slice(0, 8);
  if (!glyphs.length) throw new Error("This effect has no emoji in it.");
  const one = (v, L, d) => L.includes(v) ? v : d, md = v => typeof v === "string" && FXLIB.MD.test(v) ? v : "";
  const from = md(e.from), to = md(e.to);
  return {name:str(j.name, 60) || "Shared effect", desc:str(j.description, 500), made:str(j.made, 10), glyphs,
    motion:one(e.motion, FXLIB.MOTIONS.map(x => x[0]), "fall"), size:one(e.size, Object.keys(FXLIB.SIZE), "Medium"), speed:one(e.speed, Object.keys(FXLIB.SPEED), "Normal"),
    spin:e.spin !== false, from: from && to ? from : "", to: from && to ? to : ""};
}

/* ----- actions ----- */
function lookAction(act, id){
  if (act === "make"){
    if (!themeKnown(id)) return;
    const nid = "t" + Date.now().toString(36), base = id === "default" ? "My theme" : lookName(id);
    looks().push({id:nid, name: looks().some(t => t.name === base) ? base + " " + (looks().length + 1) : base, values:lookVals(id)});
    save(); navStack().pop(); go("theme:" + nid); return;
  }
  if (act === "dup"){
    const nid = "t" + Date.now().toString(36), base = lookName(id) + " copy";
    looks().push({id:nid, name: looks().some(t => t.name === base) ? base + " " + (looks().length + 1) : base, values:lookVals(id)});
    save(); navStack().pop(); go("theme:" + nid); toast("Made a copy. Customize it, then use it", "ok"); return;
  }
  if (act === "use"){
    const was = LS().use || "";
    LS().use = id === "default" ? "" : id; save(true); show();
    undoToast("Using " + lookName(id), () => { LS().use = was; save(true); show(); }); return;
  }
  if (act === "save") return draftSave();
  if (act === "cancel") return draftCancel();
  if (act === "sched"){ const r = {id:"r" + Date.now().toString(36), on:true, look:id, when:{from:"20:00", to:"23:00"}}; rules().push(r); save(); go("rule:" + r.id); return; }
  if (act === "del"){
    if (isBuiltin(id) || !lookById(id)) return;
    if (!confirmDel({one:"theme"}, id)) return;
    if (LS().use === id) LS().use = "";
    LS().items = looks().filter(t => t.id !== id); LS().rules = rules().filter(r => r.look !== id); save(); navStack().pop(); show(); return;
  }
}
function ruleAction(act, id, el){
  const R = rules(), i = R.findIndex(r => r.id === id);
  if (act === "new"){
    const r = {id:"r" + Date.now().toString(36), on:true, look:(looks()[0] || {}).id || "builtin-calm-evening", when:{from:"20:00", to:"23:00"}};
    R.push(r); save(); go("rule:" + r.id); return;
  }
  if (act === "toggle"){ R[i].on = R[i].on === false; save(); show(); return; }
  if (act === "up" && i > 0){ [R[i - 1], R[i]] = [R[i], R[i - 1]]; save(); show(); return; }
  if (act === "down" && i < R.length - 1){ [R[i + 1], R[i]] = [R[i], R[i + 1]]; save(); show(); return; }
  if (act === "del"){ R.splice(i, 1); save(); navStack().pop(); show(); return; }
  if (act === "day"){ const w = R[i].when = R[i].when || {}, d = +el.dataset.k; w.days = w.days || [];
    w.days = w.days.includes(d) ? w.days.filter(x => x !== d) : w.days.concat(d).sort(); save(); show(); return; }
}
function mdVal(el){ const row = el.closest(".row"), m = row.querySelector('[data-t="md-m"]').value, d = parseInt(row.querySelector('[data-t="md-d"]').value, 10); return m && d ? m + "-" + Math.max(1, Math.min(31, d)) : ""; }
// clicks on the Look screens; returns true when handled
function lookClick(t){
  const d = t.dataset;
  if (d.lact){ lookAction(d.lact, d.id); return true; }
  if (d.fxa){ fxAction(d.fxa, d.id); return true; }
  if (d.tia){ themeImpAction(d.tia); return true; }
  if (d.sha){ const pkg = sharePack(SHARE.key); if (!pkg) return true; if (d.sha === "download") fileSave(pkg, pkg.countertop); else if (d.sha === "submit") gallerySubmit(SHARE.name.trim() || pkg.name, libCode(pkg)); else textCopy(document.querySelector('[data-sh="code"]'), "Share code copied"); return true; }
  if (d.fxd && d.fxdv !== undefined){ fxDraftSet(d.fxd, d.fxdv); return true; }
  if (d.fxd === "spin"){ fxDraftSet("spin", !(FXDRAFT && FXDRAFT.spin !== false)); return true; }
  if (d.ract){ ruleAction(d.ract, d.id, t); return true; }
  if (d.fxon){ const v = !fxC(d.fxon).on; fxSet(d.fxon, "on", v); show(); return true; }
  if (d.fxk && d.fxv !== undefined){ const v = d.fxk === "every" ? +d.fxv : d.fxv; fxSet(d.fxid, d.fxk, v); show(); return true; }
  if (d.fxplay){ try{ (libSub() ? $("libpv").contentWindow : pvWin()).FUN.show(d.fxplay); toast("Playing on the preview", "ok"); }catch(e){ toast("The preview isn't ready yet", "bad"); } return true; }
  if (d.lk && d.lv !== undefined){ const v = d.lk === "textScale" ? +d.lv : d.lv; lookSet(d.lid, d.lk, v); show(); return true; }
  if (d.lk && d.lb){ const cur = lookVals(d.lid)[d.lk], on = d.lb === "OnOff" ? cur !== "Off" : d.lk === "holiday" ? !!cur : cur !== false;
    lookSet(d.lid, d.lk, d.lb === "OnOff" ? (on ? "Off" : "On") : !on); show(); return true; }
  if (d.nk && d.nv !== undefined){ mods.night.settings[d.nk] = +d.nv; save(); show(); return true; }
  return false;
}
function lookChange(t){
  const d = t.dataset;
  if (d.fxd){ if (d.fxd !== "from" && d.fxd !== "to"){ fxDraftSet(d.fxd, t.value); return true; }
    const r = t.closest(".row"), m = r.querySelector('[data-t="md-m"]').value, dd = parseInt(r.querySelector('[data-t="md-d"]').value, 10);
    fxDraftSet(d.fxd, m ? m + "-" + (dd ? Math.max(1, Math.min(31, dd)) : 1) : ""); return true; }      // a month on its own starts on the 1st
  if (d.lk === "__name"){ if (DRAFT && DRAFT.id === d.lid){ DRAFT.name = t.value; const bar = (libSub() ? libEl() : document).querySelector(".draftbar");     // no redraw: it would swallow the next tap
      if (bar){ const sp = bar.querySelector("span"), sv = bar.querySelector('[data-lact="save"]'); if (sp) sp.textContent = "Unsaved changes"; if (sv) sv.disabled = !draftDirty(); } } return true; }
  if (d.lk){ let v = t.value; if (t.type === "range") v = +v; lookSet(d.lid, d.lk, v); if (t.type === "range"){ const s = t.nextElementSibling; if (s) s.textContent = v + "%"; } show(); return true; }
  if (d.rk){ const r = ruleById(d.rid); r.when = r.when || {};
    if (d.rk === "look") r.look = t.value; else if (d.rk === "dFrom" || d.rk === "dTo") r.when[d.rk] = mdVal(t); else r.when[d.rk] = t.value || "";
    save(); return true; }
  if (d.fxk){ fxSet(d.fxid, d.fxk, mdVal(t)); return true; }
  if (d.nk){ mods.night.settings[d.nk] = +t.value; save(); return true; }
  return false;
}
// sliders: update the number beside them while dragging, save when let go
document.addEventListener("input", e => { const t = e.target; if (t.type === "range" && t.dataset.lk){ const s = t.nextElementSibling; if (s) s.textContent = t.value + "%"; } });
document.addEventListener("toggle", e => { if (e.target.classList && e.target.classList.contains("more")) store.more = e.target.open; }, true);
const store = {more:false};

