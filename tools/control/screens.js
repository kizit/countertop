/* ---------- screens ---------- */
function rootScreen(){
  let h = '<div class="big">Dashboard</div>';
  h += statusRows();
  h += sec("", ECHO ? '<button class="btnrow pri" data-act="echoedit">Edit the screen</button>'
    : '<button class="btnrow pri" data-act="edit" data-id="main">Edit dashboard on screen</button>',
    ECHO ? "Add tiles, move and resize them, and change each tile's settings. You can also hold any tile on the screen for a second." : "Add tiles, move and resize them, and change each tile's settings on the preview. You can also hold a tile on the screen itself.");
  const g = mods.general ? mods.general.settings : {};
  const setup = sec("Setup",
    KIND_ORDER.filter(k => KINDS[k]).map(k => { const c = (SRC[k] || []).length;
      return row({t:KINDS[k].title, sub: c ? (SRC[k] || []).map(x => x.name).join(", ") : "None yet", chev:true, attrs:'data-go="src:' + k + '"'}); }).join("") +
    (schema.deals ? row({t:"Store deals", sub: (mods.deals.settings.stores || []).length ? (mods.deals.settings.stores || []).join(", ") : "Not set up", chev:true, attrs:'data-go="mod:deals"'}) : ""),
    "Set these up once. Any tile can use them, and several tiles can share the same one.");
  const settings = sec("Settings",
    row({t:"Dashboard name", sub: g.name || "Countertop", chev:true, attrs:'data-go="gen:name"'}) +
    row({t:"Location", sub: g.place || (g.lat ? g.lat + ", " + g.lon : "Not set: needed for weather"), chev:true, attrs:'data-go="gen:place"'}) +
    row({t:"Language and formats", sub:langSummary(), chev:true, attrs:'data-go="gen:lang"'}) +
    row({t:"Icons and emoji", sub:({"Simple symbols":"Simple symbols", "No emoji":"Words only"})[g.emoji] || "Color emoji", chev:true, attrs:'data-go="gen:icons"'}) +
    row({t:"Screen", sub:MOUNTS[displayMode] + " · " + screenSz.replace("x", "×"), chev:true, attrs:'data-go="display"'}) +
    row({t:"Settings button on the screen", post: sw(g.gear !== false, 'data-m="general" data-k="gear" data-t="bool"')}));
  const all = gpAll(), main = all.find(p => p.id === "main"), night = all.find(p => p.id === "night"), CP = cpList(), SV = savedList();
  h += sec("Pages", row({t:"Main", sub:pageShort(main), v:"Start page", chev:true, attrs:'data-go="page:main"', pre:(CP.length > 1 && !ECHO ? '<span class="grip none" aria-hidden="true">⋮⋮</span>' : "") + pagePic(main, null, "pthumb")}) +
    CP.map(p => row({t:p.name, sub:pageShort(p), chev:true, attrs:'data-go="page:' + p.id + '" data-pid="' + p.id + '"', cls: p.on === false ? "off" : "", v: p.on === false ? "Off" : "",
      pre:(CP.length > 1 && !ECHO ? '<span class="grip" data-grip="' + p.id + '" title="Drag to change the order" aria-hidden="true">⋮⋮</span>' : "") + pagePic(p, null, "pthumb")})).join("") +
    row({t:"Night page", sub:nightText() + " · " + pageShort(night), chev:true, attrs:'data-go="night"', pre:pagePic(night, NIGHT_LOOK, "pthumb")}) +
    row({t:"Add page", sub:"A premade dashboard, a full-screen page or an empty grid", chev:true, cls:"add", attrs:'data-act="libpick" data-id="page"'}),
    "Swipe left and right on the screen to move between pages. The night page takes over the screen overnight." + (CP.length > 1 && !ECHO ? " Drag ⋮⋮ to change their order." : ""));
  h += sec("Style", row({t:"Theme", sub:"Showing now: " + lookName(curLook()) + (rules().some(r => r.on !== false && lookById(r.look)) ? " · changes on a schedule" : ""), chev:true, attrs:'data-act="lib" data-id="themes"',
      pre:'<span class="tthumb">' + lookPic(lookVals(curLook())) + '</span>'}) +
    row({t:"Effects", sub: fxSummary(), chev:true, attrs:'data-act="lib" data-id="effects"'}),
    "Colors, background, tiles and text size, and the little animations on the screen.");
  h += sec("", row({t:"Library", sub:(SV.length ? SV.length + (SV.length === 1 ? " saved layout" : " saved layouts") + " · " : "") + "Premade layouts, every tile, sharing", chev:true, attrs:'data-act="lib" data-id="layouts"'}),
    "Your saved layouts, every premade layout and every tile. Share a layout as a file.");
  return h + setup + settings;
}
/* Each box uses the editor's 48 by 32 grid. Extra tile types rotate in the same box. */
function starterBox(type, x, y, w, h, settings = {}, rotate = [], name = ""){
  return {type, x, y, w, h, settings, rotate, name};
}
const fullBox = (type, settings, name) => [starterBox(type, 0, 0, 48, 32, settings, [], name)];
const STARTERS = {
  everyday: {
    name:"Everyday", sub:"The default layout, with the week, radar, hourly forecast, groceries and meal ideas.",
    look:{bg:"Sky", accent:"#7cb7ff"}
  },
  atmospheric: {
    name:"Atmospheric", sub:"A serif clock over the changing sky, with meal ideas and moon phases.",
    boxes:[starterBox("clock",0,0,48,9,{style:"Serif",align:"Center",greeting:false,countdowns:false}),
      starterBox("agenda",1,10,14,19,{count:7}), starterBox("dinner",15,10,18,19),
      starterBox("weather",33,10,14,7,{style:"Compact",align:"Left",sun:false,air:false}), starterBox("sunmoon",33,17,14,12)]
  },
  minimal: {
    name:"Minimal", sub:"An oversized clock, a quiet forecast and the next few plans on warm paper.",
    boxes:[starterBox("clock",1,7,23,14,{style:"Serif",align:"Center",ampm:false,greeting:false,countdowns:false,
        design:{on:true,name:"Minimal clock",parts:{time:{x:50,y:8,s:48,a:"c",f:"DM Serif Display",c:"var(--accent)",w:400},date:{x:50,y:70,s:8,a:"c",c:"var(--accent)",w:500}}}}),
      starterBox("weather",2,22,21,5,{style:"Minimal",align:"Center",air:false,sun:false}), starterBox("agenda",25,6,21,21,{count:6})]
  },
  kitchen: {
    name:"Kitchen table", sub:"Meal ideas beside the shopping list, with seasonal produce and kitchen tips taking turns.",
    boxes:[starterBox("clock",0,0,24,7,{style:"Rounded",greeting:false,countdowns:false}), starterBox("nextevent",24,0,24,7),
      starterBox("dinner",0,7,28,25), starterBox("list",28,7,20,16), starterBox("inseason",28,23,20,9,{},["tip"])]
  },
  weather: {
    name:"Weather station", sub:"A wide hourly chart, a ten-day forecast and the rising and setting sun.",
    boxes:[starterBox("weather",0,0,24,9,{style:"Big temperature",align:"Left"}), starterBox("clock",24,0,24,9,{style:"Digital",align:"Right",countdowns:false}),
      starterBox("nexthours",0,9,30,16), starterBox("sunmoon",0,25,30,7), starterBox("forecast",30,9,18,23)]
  },
  planner: {
    name:"Family planner", sub:"A full month beside the family agenda, with the next event up top.",
    boxes:[starterBox("clock",0,0,19,7,{style:"Bold",countdowns:false,greeting:false}), starterBox("nextevent",19,0,29,7),
      starterBox("month",0,7,32,25), starterBox("agenda",32,7,16,25,{count:10})]
  },
  // full-screen pages: one tile across the whole screen. "pageName" is the name the new page gets, "back" its return-to-Main time.
  monthpage:{full:true, name:"Month calendar", pageName:"Month", back:60, sub:"The whole month, with your events and the weather.", boxes:fullBox("month")},
  hourspage:{full:true, name:"Next hours", pageName:"Hours", back:60, sub:"A big chart of the temperature and rain for the hours ahead.", boxes:fullBox("nexthours")},
  dealspage:{full:true, name:"Deals", pageName:"Deals", back:90, sub:"This week's sales on the things you usually buy.", needs:"deals", boxes:fullBox("sales", {layout:"Cards", count:12}, "On sale this week")},
  photospage:{full:true, name:"Photo frame", pageName:"Photos", back:0, sub:"Your shared album, one picture at a time.", boxes:fullBox("photos")},
  scratch:{name:"Start from scratch", sub:"An empty page for your own tiles.", grid:[]},
  columns:{name:"Top row + two columns", sub:"A wide strip above two columns.", grid:[[0,0,48,8],[0,8,28,24],[28,8,20,24]]},
  side:{name:"Big + side stack", sub:"One large box beside two smaller ones.", grid:[[0,0,32,32],[32,0,16,16],[32,16,16,16]]},
  squares:{name:"Four squares", sub:"Four equal boxes.", grid:[[0,0,24,16],[24,0,24,16],[0,16,24,16],[24,16,24,16]]}
};
// a starter layout comes with its built-in theme (tools/shared/themes.js), so each look is defined once
for (const [k, c] of Object.entries(STARTERS)){ const b = THEMELIB.forStarter(k); if (b){ c.look = b.values; c.theme = b.id; } }
const GROUPS = [["dash", "Dashboards"], ["full", "Full-screen"], ["grid", "Empty grids"], ["saved", "Saved"]];
const starterGroup = s => s.grid ? "grid" : s.full ? "full" : "dash";
let galTab = "dash";
// one choice in the gallery: a starter, or "saved:<page id>" for a saved layout
function choiceOf(id){
  if (id === "import"){        // a layout opened in Library › Import a file
    const I = LIB.imp; if (!I) return null;
    return {name:I.name, sub:I.desc, look:I.look, boxes:I.boxes, imported:true, page:{slots:I.boxes.map(b => ({x:b.x, y:b.y, w:b.w, h:b.h, mod:b.tiles.length ? "t" : null}))}};
  }
  if (id && id.startsWith("saved:")){ const p = savedById(id.slice(6)); return p && {name:p.name, sub:pageShort(p), page:p, saved:true, look:p.look}; }
  return STARTERS[id] || null;
}
function starterPicture(id, big){
  const c = choiceOf(id); if (!c) return "";
  if (c.page) return pagePic(c.page, c.look ? Object.assign(lookVals(curLook()), c.look) : null, "page");
  if (c.grid) return '<span class="blankpreview" aria-hidden="true">' + c.grid.map(([x,y,w,h]) =>
    '<i style="left:calc(' + x/48*100 + '% + 2px);top:calc(' + y/32*100 + '% + 2px);width:calc(' +
    w/48*100 + '% - 4px);height:calc(' + h/32*100 + '% - 4px)"></i>').join("") + '</span>';
  if (c.full) return '<img src="/starters/' + id + '.jpg" width="1600" height="900" alt="' + c.name + ' page">';
  return '<img src="/starters/' + id + '.jpg" width="1920" height="1080" alt="' + c.name + ' dashboard layout">';
}
function starterPreview(id){
  const c = choiceOf(id); if (!c) return "";
  return '<figure class="starterfigure"><figcaption>' + esc(c.name) + '</figcaption>' + starterPicture(id, true) + '</figure>';
}
// where: "page" (Add page), "main" (Change Main's layout) or "wiz" (first-run setup, for Main)
function starterGallery(selected, where = "page"){
  const tabs = GROUPS.filter(([g]) => g !== "full" || where === "page").filter(([g]) => g !== "saved" || savedList().length);
  if (!tabs.some(([g]) => g === galTab)) galTab = "dash";
  const list = galTab === "saved" ? savedList().map(p => ["saved:" + p.id, choiceOf("saved:" + p.id)])
    : Object.entries(STARTERS).filter(([, s]) => starterGroup(s) === galTab && (!s.needs || schema[s.needs]));
  return '<span class="seg wide tabs" role="tablist">' + tabs.map(([g, label]) => '<button role="tab" data-act="galtab" data-id="' + g + '" aria-selected="' + (g === galTab) + '"' + (g === galTab ? ' class="on"' : "") + '>' + label + '</button>').join("") + '</span>' +
    '<div class="lcards">' + list.map(([id, s]) =>
    '<button class="lcard' + (selected === id ? ' now' : '') + '" aria-pressed="' + (selected === id) +
    '" data-act="pickstarter" data-id="' + id + '">' + starterPicture(id) +
    '<b>' + esc(s.name) + '</b><small>' + esc(s.sub) + '</small></button>').join("") + '</div>' +
    (selected && choiceOf(selected) ? '<div class="compactpreview">' + starterPreview(selected) + '</div>' : '');
}
function sameEverydayLayout(){
  const main = gpAll().find(p => p.id === "main");
  const layout = (page, tiles) => page.slots.map(slot => {
    return [slot.x, slot.y, slot.w, slot.h, slot.every, smods(slot).map(tid => {
      const tile = tiles.find(t => t.id === tid) || {};
      return [tile.type, tile.name, tile.settings];
    })];
  });
  return JSON.stringify(layout(main, tileList())) === JSON.stringify(layout(everyday.page, everyday.tiles));
}
const newUid = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const mainDated = () => "Main, " + new Date().toLocaleDateString(undefined, {month:"short", day:"numeric"});
// the colors of the theme in use, kept with a saved layout (and shared with it); theme: which theme that was
const lookSnap = () => { const v = lookVals(usedLook()); return Object.fromEntries(LOOK_KEYS.filter(k => v[k] !== undefined).map(k => [k, v[k]])); };
function uniqueName(base){
  const names = new Set(gpAll().map(p => p.name));
  let n = base; for (let i = 2; names.has(n); i++) n = base + " (" + i + ")";
  return n;
}
// copy boxes with their own copies of the tiles, so changing one copy never changes the other
function cloneSlots(slots, uid, tiles = tileList()){
  const ids = {}; let k = 0;
  const tid = old => {
    if (!old) return old;
    if (!ids[old]){
      const t = tiles.find(x => x.id === old); if (!t) return null;
      ids[old] = uid + "_" + (k++);
      tileList().push(JSON.parse(JSON.stringify({...t, id:ids[old]})));
    }
    return ids[old];
  };
  return (slots || []).map((slot, i) => {
    const copy = {...slot, id:uid + "s" + i, mod:tid(slot.mod)};
    if (slot.more) copy.more = slot.more.map(tid).filter(Boolean);
    return copy;
  });
}
// keep Main's current boxes as a saved layout (moved, not copied: Main gets new boxes right after)
function keepMain(why){
  const main = gpAll().find(p => p.id === "main");
  if (!main.slots.length) return;
  gpAll().push({id:newUid(), name:uniqueName(why ? "Main before " + why : mainDated()), cols:GC, slots:main.slots, on:false, saved:true, look:lookSnap(), theme:usedLook(), at:Date.now()});
}
function installStarter(key, onMain, withLook = onMain){
  const c = choiceOf(key); if (!c) return;
  const pages = gpAll(), main = pages.find(p => p.id === "main"), uid = newUid();
  const page = {id:uid, name:c.grid ? "Page " + (cpList().length + 2) : c.pageName || c.name, cols:GC, slots:[], on:true, back:c.back || 0};
  const applyLook = () => { if (withLook && c.look) themeFromLayout(key, c); };
  if (c.saved) page.slots = cloneSlots(c.page.slots, uid);
  else if (key === "everyday"){
    if (onMain && sameEverydayLayout()){ applyLook(); return; }
    page.slots = cloneSlots(everyday.page.slots, uid, everyday.tiles);
  } else if (c.grid){
    page.slots = c.grid.map(([x,y,w,h], i) => ({id:uid + "s" + i,x,y,w,h,mod:null}));
  } else page.slots = c.boxes.map((box, i) => {
    const id = uid + "s" + i, {x, y, w, h} = box;
    // a starter box names one type (plus types that take turns); a shared layout's box lists its tiles in full
    const list = box.tiles || [{type:box.type, settings:box.settings, name:box.name}].concat((box.rotate || []).map(type => ({type})));
    const ids = list.map((t, j) => {
      const tid = id + "t" + j;
      const values = JSON.parse(JSON.stringify(t.settings || {}));
      if (c.imported) libFill(t.type, values);
      else {
        if (t.type === "list" && firstList()) values.list = firstList().id;
        if (t.type === "photos" && (SRC.albums || [])[0]) values.album = SRC.albums[0].id;
      }
      const tile = {id:tid, type:t.type, settings:values};
      if (t.name) tile.name = t.name;
      if (c.imported && t.type === "custom" && String(values.html || "").trim()) tile.review = true;      // shared code waits for Run on the screen
      tileList().push(tile);
      return tid;
    });
    const slot = {id, x, y, w, h, mod:ids[0] || null};
    if (ids.length > 1){ slot.more = ids.slice(1); slot.every = box.every || 45; }
    return slot;
  });
  if (!onMain){ applyLook(); pages.push(page); return page.id; }
  keepMain(c.saved ? "" : c.name);         // before applyLook, so the saved layout keeps the look it had
  main.slots = page.slots;
  applyLook();
}
// A layout's colors come in as a theme of its own and become the theme in use, so Everyday is never written over.
// Using the same layout again reuses its theme; colors that match a theme you already have use that theme.
function layoutTheme(key, c){            // the theme a layout would bring: {id} of one you have, or {name, values} for a new one
  if (key === "everyday") return {id:"default"};
  if (c.saved && c.page.theme && (c.page.theme === "default" || lookById(c.page.theme))) return {id:c.page.theme};
  const from = c.saved ? "saved:" + c.page.id : c.imported ? "" : "starter:" + key;
  const had = from && looks().find(x => x.from === from); if (had) return {id:had.id};      // a copy made before starters had built-in themes
  if (!c.saved && !c.imported && c.theme && THEMELIB.has(c.theme)) return {id:c.theme};
  const values = Object.assign(lookVals("default"), c.saved || c.imported ? {} : {mode:"Dark", tiles:"Solid", fx:"On", opacity:60}, c.look);
  const same = ["default"].concat(looks().map(x => x.id)).find(id => { const v = lookVals(id); return LOOK_KEYS.every(k => String(v[k]) === String(values[k])); });
  if (same) return {id:same};
  return {name:c.name, values, from};
}
const layoutThemeName = (key, c) => { const T = layoutTheme(key, c); return T.id ? lookName(T.id) : T.name; };
function themeFromLayout(key, c){
  const T = layoutTheme(key, c);
  if (T.id){ LS().use = T.id === "default" ? "" : T.id; return; }
  const names = new Set(looks().map(x => x.name)); let name = T.name;
  for (let i = 2; names.has(name) || name === "Everyday"; i++) name = T.name + " " + i;
  const id = "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), t = {id, name, values:T.values};
  if (T.from) t.from = T.from;
  looks().push(t); LS().use = id;
}
function displayScreen(){
  const options = Object.entries(MOUNTS).map(([mode, label]) =>
    '<option value="' + mode + '"' + (mode === displayMode ? " selected" : "") + '>' + label + '</option>').join("");
  return '<p class="intro">Automatic follows the shape of each screen. Pick Landscape or Portrait to keep every page in that orientation. If the dashboard appears sideways on a turned screen, choose which edge of the landscape screen is now at the top.</p>' +
    sec("", '<div class="row col"><label class="t" for="display-orientation">Orientation</label><select id="display-orientation">' + options + '</select></div>',
      "Applies to every display using this dashboard.") +
    '<p class="intro">Screen size is what the previews and the layout editor in Controls are drawn at, so what you arrange here matches your screen. Pick your device, or the nearest size.</p>' +
    sec("Screen size", '<div class="row col"><label class="t" for="display-screen">Size of the dashboard screen</label><select id="display-screen">' + screenOptions() + '</select></div>' +
      (ECHO ? '<button class="btnrow blue" data-act="screenmatch">Use this screen: ' + thisScreen().replace("x", "×") + '</button>' : ""),
      ECHO ? "Echo Shows list their panel size. Press the button to use what this screen really reports." : "Echo Show sizes are the panel resolution. If Controls is open on the Echo itself, a button there uses its real size.") +
    (ECHO ? "" : '<p class="intro">By default /dash on this computer fills the browser window, so it changes shape when you resize it. To test a particular screen, pick a size. The dashboard then keeps that layout, and shrinks to fit if the window is smaller.</p>' +
      sec("This browser only", '<div class="row col"><label class="t" for="display-size">How /dash looks in this browser</label><select id="display-size">' + sizeOptions() + '</select></div>' +
        '<div class="row col"><label class="t" for="display-fs">Full screen when you tap /dash</label><select id="display-fs"><option value="1"' + (fsCur() ? " selected" : "") + '>On (default)</option><option value="0"' + (fsCur() ? "" : " selected") + '>Off, stay in the window</option></select></div>',
        "Doesn't change any other display. For a size not listed, open /dash?size=1280x800 once. /dash?size=auto goes back to filling the window. /dash?fullscreen=0 turns full screen off in this browser and ?fullscreen=1 turns it back on. Off only stops the browser going full screen; a tap still arms keep-alive."));
}
function screenOptions(){
  const list = SCREEN_SIZES.some(x => x[0] === screenSz) ? SCREEN_SIZES : [[screenSz, "Custom · " + screenSz.replace("x", "×")]].concat(SCREEN_SIZES);
  return list.map(([v, l]) => '<option value="' + v + '"' + (v === screenSz ? " selected" : "") + '>' + l + '</option>').join("");
}
function fsCur(){ try{ return localStorage.getItem("countertop.fullscreen") !== "0"; }catch(e){ return true; } }
function sizeCur(){ try{ return localStorage.getItem("countertop.screenSize") || ""; }catch(e){ return ""; } }
function sizeOptions(){
  const cur = sizeCur(), known = cur === "" || cur === "dash" || SCREEN_SIZES.some(x => x[0] === cur);
  const list = [["", "Fill the window"], ["dash", "Same as the dashboard's screen · " + sizeLabel(screenSz).replace(/^.*· /, "")]].concat(known ? [] : [[cur, "Custom · " + cur.replace("x", "×")]], SCREEN_SIZES);
  return list.map(([v, l]) => '<option value="' + v + '"' + (v === cur ? " selected" : "") + '>' + l + '</option>').join("");
}
function pageSummary(p){
  if (!p) return "Empty";
  const t = [].concat(...(p.slots || []).map(smods)).map(tileName);
  return t.length ? t.join(", ") : "No tiles yet";
}
function pageShort(p){
  const t = p ? [].concat(...(p.slots || []).map(smods)).map(tileName) : [];
  if (!t.length) return p && (p.slots || []).length ? "Empty boxes" : "No tiles yet";
  return t.length + (t.length === 1 ? " tile · " : " tiles · ") + t.slice(0, 3).join(", ") + (t.length > 3 ? "…" : "");
}
// a small picture of a page: its real boxes, drawn in the current look (or the look given)
const NIGHT_LOOK = {bg:"Color", bgColor:"#030405", tiles:"Clear", accent:"#8a939e"};
function pagePic(p, v, cls){
  const c = lookColors(v || lookVals(curLook()));
  return '<div class="lpic ' + (cls || "") + '" aria-hidden="true" style="background:' + c.bg + '">' + ((p && p.slots) || []).map(sl =>
    '<i class="slot" style="left:calc(' + sl.x / GC * 100 + '% + .5em);top:calc(' + sl.y / 32 * 100 + '% + .5em);width:calc(' + sl.w / GC * 100 + '% - 1em);height:calc(' + sl.h / 32 * 100 + '% - 1em);background:' + c.card + ';border-color:' + (c.light ? "rgba(0,0,0,.14)" : "rgba(255,255,255,.2)") + '">' +
    (smods(sl).length ? '<s style="background:' + c.acc + '"></s><u style="background:' + c.dim + ';width:70%;height:.6em"></u><u style="background:' + c.dim + ';width:50%;height:.6em"></u>' : "") + '</i>').join("") + '</div>';
}
function field(mid, key, s, val){
  const a = 'data-m="' + mid + '" data-k="' + key + '" data-t="' + s.type + '"';
  if (s.type === "bool") return row({t:s.label, post: sw(val, a)});
  if (s.type === "color") return row({t:s.label, post:'<input type="color" ' + a + ' value="' + esc(val || "#000000") + '">'});
  if (s.type === "choice") return row({t:s.label, post:'<select ' + a + '>' + s.choices.map(c => '<option' + (String(c).toLowerCase() === String(val).toLowerCase() ? " selected" : "") + '>' + esc(c) + '</option>').join("") + '</select>'});
  if (s.type === "int" || s.type === "number")
    return row({t:s.label, sub:(s.min != null && s.max != null ? s.min + "–" + s.max : ""), post:'<input type="number" ' + a + (s.min != null ? ' min="' + s.min + '"' : "") +
      (s.max != null ? ' max="' + s.max + '"' : "") + ' step="' + (s.type === "int" ? 1 : "any") + '" value="' + esc(val) + '" inputmode="decimal">'});
  if (s.type === "list") return '<div class="row col"><div class="t"><b>' + esc(s.label) + '</b><small>One per line</small></div><textarea ' + a + '>' + esc((val || []).join("\n")) + '</textarea></div>';
  return '<div class="row col"><div class="t"><b>' + esc(s.label) + '</b></div><input type="text" ' + a + ' value="' + esc(val) + '" autocapitalize="off" spellcheck="false"></div>';
}
function modScreen(m){
  const s = schema[m], c = mods[m];
  let h = '<div class="big">' + esc(s.title) + '</div>';
  if (s.desc) h += '<p class="intro">' + esc(s.desc) + '</p>';
  if (m === "general"){
    h += sec("", '<button class="btnrow blue" data-act="locate">Find a place by name…</button>', "Or type the latitude and longitude below.");
    const G = [["Place", ["place", "lat", "lon"]], ["Language and formats", ["lang", "holidays", "units", "h24", "dateFmt", "weekStart"]], ["Icons", ["emoji", "swap"]], ["Screen", ["gear"]]];
    G.forEach(([g, keys]) => { const K = keys.filter(k => s.settings[k]); if (!K.length) return;
      if (g === "Icons"){ h += emojiPicker(c.settings.emoji, c.settings.swap); return; }
      h += sec(g, K.map(k => field(m, k, s.settings[k], c.settings[k])).join("")); });
    return h;
  }
  const keys = Object.keys(s.settings).filter(k => k !== "items");
  if (keys.length) h += sec("Settings", keys.map(k => field(m, k, s.settings[k], c.settings[k])).join(""));
  return h;
}
// Settings: the general module, one screen per group
const GEN = {name:["Dashboard name", ["name"]], place:["Location", ["place", "lat", "lon"]], lang:["Language and formats", ["lang", "holidays", "units", "h24", "dateFmt", "weekStart"]], icons:["Icons and emoji", ["emoji", "swap"]]};
function langSummary(){
  const g = mods.general ? mods.general.settings : {};
  return [g.lang && g.lang !== "Automatic" ? g.lang : "Language: automatic", "°" + (g.units || "F"), g.h24 ? "24-hour" : "12-hour", (g.weekStart || "Sunday") + " first", g.holidays && g.holidays !== "United States" ? "Holidays: " + g.holidays : ""].filter(Boolean).join(" · ");
}
function genScreen(k){
  const s = schema.general, c = mods.general, G = GEN[k]; if (!G) return "";
  let h = '<div class="big">' + esc(G[0]) + '</div>';
  if (k === "name") return h + '<p class="intro">What this screen is called in the browser tab and on the shopping-list page. The default is Countertop.</p>' +
    sec("", G[1].map(x => field("general", x, s.settings[x], c.settings[x])).join(""));
  if (k === "place") return h + '<p class="intro">Where you are, for the weather, radar, sunrise and things overhead.</p>' +
    sec("", '<button class="btnrow blue" data-act="locate">Find a place by name…</button>', "Or type the latitude and longitude below.") +
    sec("Place", G[1].filter(x => s.settings[x]).map(x => field("general", x, s.settings[x], c.settings[x])).join(""));
  if (k === "icons") return h + emojiPicker(c.settings.emoji, c.settings.swap);
  return h + sec("", G[1].filter(x => s.settings[x]).map(x => field("general", x, s.settings[x], c.settings[x])).join(""));
}
// Icons: color emoji, simple one-color symbols, or words only, each shown as it would look
const EMOJI_OPTS = [["Emoji", "Color emoji", "☁️ 44° · 🌅 6:45 AM · 🌔 Waxing gibbous · 🦃 Thanksgiving in 7 days"],
  ["Simple symbols", "Simple symbols", "☁︎ 44° · ↑ 6:45 AM · ☾ Waxing gibbous · Thanksgiving in 7 days"],
  ["No emoji", "Words only", "44° Overcast · Sunrise 6:45 AM · Waxing gibbous · Thanksgiving in 7 days"]];
function emojiPicker(cur, swap){
  cur = EMOJI_OPTS.some(o => o[0] === cur) ? cur : "Emoji";
  const opts = EMOJI_OPTS.map(([v, t, ex]) => '<label class="emopt"><input type="radio" name="emoji" data-m="general" data-k="emoji" data-t="choice" value="' + v + '"' + (v === cur ? " checked" : "") + '>' +
    '<span class="t"><b>' + t + '</b><span class="ex">' + ex + '</span></span></label>').join("");
  return sec("Icons", opts, "Simple symbols keeps the weather, sun and moon icons as plain one-color shapes and drops the rest. With either of the last two, the emoji effects (falling leaves, turkeys, confetti) rest too; rain, snow and the other weather effects keep going.") +
    (cur === "Emoji" ? swapRows() : "");
}
function srcScreen(k){
  const K = KINDS[k], L = SRC[k] || [];
  let h = '<div class="big">' + esc(K.title) + '</div><p class="intro">' + esc(K.desc || "") + '</p>';
  h += sec("", (L.length ? L.map(x => { const u = usedBy(k, x.id);
      return row({t:x.name || "(no name)", sub: u.length ? "Used by " + u.join(", ") : "", chev:true, attrs:'data-go="srci:' + k + ':' + x.id + '"',
        pre: x.color ? '<span class="dot" style="background:' + esc(x.color) + '"></span>' : ""}); }).join("") : '<div class="row"><div class="t"><small>None yet</small></div></div>') +
    row({t:"Add a " + K.one, chev:true, cls:"add", attrs:'data-go="srci:' + k + ':new"'}),
    "Then pick it in a tile's settings: Edit dashboard on screen, tap the tile.");
  return h;
}
function srcWhenOk(F, getVal){
  if (!F.when) return true;
  return Object.keys(F.when).every(w => {
    const want = F.when[w], cur = getVal(w);
    return Array.isArray(want) ? want.includes(cur) : cur === want;
  });
}
function srcItemScreen(k, id){
  const K = KINDS[k], x = id === "new" ? {} : (SRC[k] || []).find(v => v.id === id);
  if (!x) return '<div class="big">Not found</div>';
  let h = '<div class="big">' + (id === "new" ? "New " + esc(K.one) : esc(x.name || K.one)) + '</div>';
  let rows = "";
  const fieldVal = w => { const ch = (K.fields[w].choices || [])[0]; return x[w] || (Array.isArray(ch) ? ch[0] : ch); };
  const curKind = K.fields.kind ? fieldVal("kind") : "";
  for (const f in K.fields){
    const F = K.fields[f], a = 'data-sf="' + f + '"';
    const lbl = (F.labelBy && F.labelBy[curKind]) || F.label;
    const htxt = (F.helpBy && F.helpBy[curKind]) || F.help;
    const help = htxt ? '<div class="help">' + esc(htxt) + '</div>' : "";
    const hide = !srcWhenOk(F, fieldVal);
    let inp;
    if (F.type === "color") inp = row({t:lbl, sub:htxt, post:'<input type="color" ' + a + ' value="' + esc(x[f] || "#7cb7ff") + '">'});
    else if (F.type === "bool") inp = row({t:lbl, sub:htxt, post: sw(!!x[f], a + ' data-swt="1"')});
    else if (F.type === "choice"){
      const ch = F.choices.map(c => Array.isArray(c) ? c : [c, c]), cur = x[f] || ch[0][0];
      inp = '<div class="row col"><div class="t"><b>' + esc(lbl) + '</b></div><select ' + a + '>' + ch.map(([v, l]) => '<option value="' + esc(v) + '"' + (v === cur ? " selected" : "") + '>' + esc(l) + '</option>').join("") + '</select>' + help + '</div>';
    } else {
      const ph = F.secret && x[f + "Set"] ? (f === "url" ? "Saved and hidden. Paste a new link to replace it." : "Saved and hidden. Paste a new one to replace it.") : "";
      inp = '<div class="row col"><div class="t"><b>' + esc(lbl) + '</b></div><input type="text" ' + a + ' value="' + esc(F.secret ? "" : x[f] || "") + '" placeholder="' + esc(ph) + '" autocapitalize="off" spellcheck="false">' + help + '</div>';
    }
    rows += '<div data-fw="' + f + '"' + (hide ? " hidden" : "") + '>' + inp + '</div>';
  }
  h += sec("", rows);
  if (k === "lists" && id !== "new" && (x.kind || "This dashboard") === "This dashboard")
    h += sec("Items",
      '<div class="row col"><div class="t"><b>Add an item</b></div>' +
      '<div class="lladd"><input type="text" id="lladd" maxlength="80" placeholder="Something to do…" autocapitalize="sentences" spellcheck="false">' +
      '<button class="pri" data-ladd="1" data-sid="' + esc(id) + '">Add</button></div></div>' +
      '<div id="llitems" data-sid="' + esc(id) + '"><div class="row"><div class="t"><small>Loading…</small></div></div></div>' +
      '<div class="row" id="llbar" hidden><div class="t"><small id="llcount"></small></div><button class="llb" data-llop="reset" data-sid="' + esc(id) + '">Untick all</button></div>',
      "The same list as the List tile on the dashboard. " + (x.daily ? "The ticks are cleared every day at 00:00; the items stay." : "Switch on “Clear the ticks every day at 00:00” above to use it as a daily checklist."));
  if (k === "homeassistant") h += sec("", '<button class="btnrow blue" data-sact="test" data-k="' + k + '" data-id="' + id + '">Test connection</button><div class="row" id="hatest" hidden></div>',
    "Checks the address and token without saving. Leave the token blank to test the one already saved.");
  if (k === "recipes") h += sec("", '<button class="btnrow blue" data-sact="test" data-k="' + k + '" data-id="' + id + '">Test the key</button><div class="row" id="hatest" hidden></div>',
    "Asks the service for one small thing without saving. Leave the key blank to test the one already saved.");
  if (k === "albums") h += sec("", '<button class="btnrow blue" data-sact="test" data-k="' + k + '" data-id="' + id + '">Test album</button><div class="row" id="hatest" hidden></div>',
    "Checks the album or folder and counts how many photos it finds, without saving. Leave a saved key or password blank to test with it.");
  h += '<div class="saverow">' + (id === "new" ? "" : '<button class="red" data-sact="del" data-k="' + k + '" data-id="' + id + '" style="color:var(--bad)">Delete</button>') +
    '<button class="pri" data-sact="save" data-k="' + k + '" data-id="' + id + '">' + (id === "new" ? "Add " + esc(K.one) : "Save") + '</button></div>';
  if (id !== "new"){ const u = usedBy(k, id); if (u.length) h += '<div class="sec"><div class="foot">Used by ' + esc(u.join(", ")) + '.</div></div>'; }
  return h;
}
async function srcAction(act, k, id){
  const K = KINDS[k], item = {id: id === "new" ? undefined : id};
  if (act === "test") return srcTest(k, id);
  if (act === "save"){
    document.querySelectorAll("[data-sf]").forEach(el => {
      if (el.classList.contains("sw")){ item[el.dataset.sf] = el.classList.contains("on"); return; }
      const v = el.value.trim(); if (!(K.fields[el.dataset.sf].secret && !v)) item[el.dataset.sf] = v;
    });
    if (!item.name){ toast("Give it a name first", "bad"); return; }
    const uw = document.querySelector('[data-fw="url"]');
    if (id === "new" && K.fields.url && K.fields.url.secret && !item.url && uw && !uw.hidden){ toast("Paste the link first", "bad"); return; }
    if (k === "homeassistant" && !item.url){ toast("Type the address first", "bad"); return; }
    if (k === "homeassistant" && id === "new" && !item.token){ toast("Paste the access token first", "bad"); return; }
  } else if (!confirmDel(K, id)) return;
  try{
    const r = await fetch("/sources", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({kind:k, op: act === "del" ? "delete" : id === "new" ? "add" : "update", item})});
    const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.status);
    SRC = j.sources; toast(act === "del" ? "Deleted" : "Saved", "ok"); stack.pop(); show(); pvRefresh();
  }catch(e){ toast("Didn't save: " + e.message, "bad"); }
}
async function srcTest(k, id){
  const item = {id: id === "new" ? undefined : id}, out = document.getElementById("hatest");
  document.querySelectorAll("[data-sf]").forEach(el => {
    item[el.dataset.sf] = el.classList.contains("sw") ? el.classList.contains("on") : el.value.trim();
  });
  out.hidden = false; out.innerHTML = '<div class="t"><small>Checking…</small></div>';
  try{
    const r = await fetch("/sources/test", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({kind:k, item})});
    const j = await r.json();
    out.innerHTML = j.ok ? '<div class="t"><b style="color:var(--ok)">✓ Connected</b><small>' + esc(j.detail || (j.name ? j.name + " · " : "") + "Home Assistant " + (j.version || "") + " · " + j.count + " entities") + '</small></div>'
      : '<div class="t"><b style="color:var(--bad)">Didn\'t connect</b><small>' + esc(j.error || "Unknown problem") + '</small></div>';
  }catch(e){ out.innerHTML = '<div class="t"><b style="color:var(--bad)">Didn\'t connect</b><small>' + esc(e.message) + '</small></div>'; }
}

