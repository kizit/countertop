/* ---------- the editor ---------- */
// Hold any tile (or "Edit on screen" in Controls). The page shrinks into a frame; the panel on the right
// shows what is selected: the page, a box (its tiles and their settings), or the tile list to add from.
// Keys: arrows move, Shift+arrows resize, Delete removes, Esc deselects, Ctrl/Cmd+Z undo, Shift+Ctrl/Cmd+Z redo, Ctrl/Cmd+S save.
const EDIT = {on:false, ori:"l", page:"main", sel:null, tile:null, drag:null, hist:[], fut:[], k:0, ox:0, oy:0, panel:null, addTo:null};
const PANEL_W = 384;
const inFrame = () => { try{ return window.parent !== window && !!window.parent.dashSetup; }catch(e){ return false; } };
// when hosted inside Controls in desktop mode, Controls provides the unified top toolbar and full-height right inspector
const hostDesk = () => { try{ return PREVIEW && window.parent !== window && window.parent.CT && window.parent.CT.input === "desktop" && typeof window.parent.dashDeskSync === "function"; }catch(e){ return false; } };
const hostPanel = () => hostDesk() ? window.parent.document.getElementById("insp-body") : null;
const edPan = () => hostPanel() || $("edpanel");
function edHostSync(hintOverride, hintCls){
  if (!hostDesk()) return;
  try{
    const names = pageList().filter(n => gridOf(n));
    const dirty = EDIT.on && JSON.stringify(CFG) !== EDIT.orig;
    const dzx = EDIT.focus && designOf(MODULES[EDIT.focus.id]);
    const hint = hintOverride != null ? hintOverride : dzx ? "Designing “" + dzx.name + "” · click Done when finished" : dirty ? "Unsaved changes" : "";
    window.parent.dashDeskSync({
      editing: EDIT.on,
      page: EDIT.page,
      pages: names.map(n => ({id:n, name:pageName(gridOf(n))})),
      dirty,
      canUndo: EDIT.hist.length > 0,
      canRedo: EDIT.fut.length > 0,
      hint,
      hintCls: hintCls || "",
      focus: !!EDIT.focus,
      grid: document.body.classList.contains("ed-grid"),
      sel: EDIT.sel,
    });
  }catch(e){}
}
function curPg(){ return gridOf(EDIT.page); }
function pgSec(){ return EDIT.page === "main" ? $("p1") : document.querySelector('.cpage[data-page="' + (EDIT.page === "night" ? "night" : EDIT.page.slice(2)) + '"]'); }
function pgGrid(){
  const sec = pgSec(), g = sec && sec.querySelector(":scope > .cgrid"); if (!g) return null;
  const r = g.getBoundingClientRect(), gap = gapPx() * EDIT.k;
  return {r, cw:(r.width + gap) / GC, ch:(r.height + gap) / GR};
}
function cellAt(x, y){ const G = pgGrid(); return [Math.floor((x - G.r.left) / G.cw), Math.floor((y - G.r.top) / G.ch)]; }
function cellRect(s){ const G = pgGrid(), gap = gapPx() * EDIT.k;
  return {left:G.r.left + s.x * G.cw, top:G.r.top + s.y * G.ch, width:s.w * G.cw - gap, height:s.h * G.ch - gap}; }
const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
// box s in the arrangement being edited (null: not on this screen)
const RG = (s, pg) => geo(s, EDIT.ori, pg || curPg());
const at = (r, c, y) => r && c >= r.x && c < r.x + r.w && y >= r.y && y < r.y + r.h;
function blocked(pg, r, skip, o = EDIT.ori){ return (pg.slots || []).some(v => { if (v === skip || v.id === (skip && skip.id)) return false; const g = geo(v, o, pg); return g && hits(g, r); }); }
function inGrid(r, o = EDIT.ori){ const [C, R] = dims(o); return r.x >= 0 && r.y >= 0 && r.w >= 1 && r.h >= 1 && r.x + r.w <= C && r.y + r.h <= R; }
// before the first move in portrait, the page's worked-out portrait places become its own
function touch(pg){
  if (EDIT.ori !== "p" || !pg) return;
  const m = portSeed(pg);
  for (const s of pg.slots || []) if (!s.p) s.p = m[s.id] ? Object.assign({}, m[s.id]) : {off:true};
}
// a new box at R in arrangement o, with a place in the other one too (size: what it would like)
function newBox(pg, R, size, o = EDIT.ori){
  const b = {id:"s" + Date.now().toString(36), mod:null};
  if (o === "p"){
    touch(pg);
    const L = freeSpot(pg, size, "l");
    Object.assign(b, L || {x:0, y:0, w:1, h:1, loff:true}, {p:Object.assign({}, R)});
  } else Object.assign(b, R);                   // portrait finds it a place (portSeed)
  pg.slots.push(b);
  return b;
}

function remember(){ EDIT.hist.push(JSON.stringify(CFG)); if (EDIT.hist.length > 80) EDIT.hist.shift(); EDIT.fut = []; }
function relayout(){ layout(); render(); stackTick(); lookApply && LOOK.ready && lookApply(document.body); edFrame(); edPaint(true); }
// a feed a new or changed tile needs (only loaded while some tile uses it)
const FEEDFN = {wx:() => loadWeather(), aqi:() => loadAqi(), events:() => { loadEvents(); loadTeams(); }, notes:() => loadNotes(), team:() => loadTeams(),
  photos:() => loadPhotos(), sales:() => { loadSales(); loadNotes(); }};
function refeed(id){ const m = MODULES[id]; (m && m.feeds || []).forEach(f => { try{ FEEDFN[f] && FEEDFN[f](); }catch(e){} }); }

function editUI(){
  if ($("edl")) return;
  const d = document.createElement("div"); d.id = "edl"; d.tabIndex = -1;
  d.innerHTML = '<div id="edcanvas"></div><div id="edgrid"></div><div id="edboxes"></div><div id="edph" hidden><span></span></div>' +
    '<div id="edbar"><span id="edtabs"></span><span id="edhint"></span>' +
    '<button id="edundo" title="Undo (Ctrl+Z)">↶</button><button id="edredo" title="Redo (Shift+Ctrl+Z)">↷</button>' +
    '<button id="edcancel">Cancel</button><button id="edsave" class="pri">Save</button>' +
    (PREVIEW ? "" : '<button id="edmore" title="Location, calendars, looks, effects, pages">⚙ Settings</button>') + '</div>' +
    '<aside id="edpanel"></aside><div id="edghost" hidden></div><textarea id="edclip" aria-hidden="true"></textarea>';
  document.body.appendChild(d);
  let cells = ""; for (let i = 0; i < GC * GR; i++) cells += "<i></i>"; $("edgrid").innerHTML = cells;
  $("edcancel").onclick = () => editExit(false);
  // on the Echo: everything else (setup, looks, effects, pages) is in Controls
  if ($("edmore")) $("edmore").onclick = () => { if (JSON.stringify(CFG) !== EDIT.orig) return flash("Save or Cancel your changes first, then open Settings"); location.href = "/control?echo=1"; };
  $("edsave").onclick = () => editExit(true);
  $("edundo").onclick = () => undo(1);
  $("edredo").onclick = () => undo(-1);
  d.addEventListener("pointerdown", edDown);
  $("edpanel").addEventListener("input", edPanelInput);
  $("edpanel").addEventListener("change", edPanelInput);
}
function undo(dir){
  const from = dir > 0 ? EDIT.hist : EDIT.fut, to = dir > 0 ? EDIT.fut : EDIT.hist;
  const h = from.pop(); if (!h) return;
  to.push(JSON.stringify(CFG)); CFG = JSON.parse(h);
  tilesSetup();                 // the tiles point at their settings objects, which were just replaced
  if (!gridOf(EDIT.page)) EDIT.page = "main";
  if (EDIT.sel && !(curPg().slots || []).some(s => s.id === EDIT.sel)) EDIT.sel = null;
  if (EDIT.tile && !MODULES[EDIT.tile]) EDIT.tile = null;
  relayout(); goEditPage(EDIT.page);
}
// the page is drawn at a screen's size and shrunk into the frame: this screen's own size when it is the shape being
// edited, otherwise 1920x1080 (or 1080x1920). The panel goes on the right, or below when that leaves the page bigger.
function edFrame(){
  const W = innerWidth, H = innerHeight, pad = 24, P = EDIT.ori === "p", host = hostDesk();
  document.body.classList.toggle("ed-host", host);
  const fixed = P ? [1080, 1920] : [1920, 1080], side = P === PORTQ.matches ? [W, H] : fixed;
  if (host){
    document.body.classList.remove("ed-stacked");
    const [PW, PH] = side, top = 48;
    document.body.style.setProperty("--page-w", PW + "px"); document.body.style.setProperty("--page-h", PH + "px");
    EDIT.k = Math.max(.01, Math.min((W - pad * 2) / PW, (H - top - pad) / PH));
    EDIT.ox = (W - PW * EDIT.k) / 2;
    EDIT.oy = top + Math.max(0, (H - top - pad - PH * EDIT.k) / 2);
    pagesXform();
    return;
  }
  const kSide = Math.min((W - PANEL_W - pad * 3) / side[0], (H - 68 - pad) / side[1]);
  const kStack = Math.min((W - pad * 2) / fixed[0], (H * .58 - 120 - pad) / fixed[1]);
  const stacked = W < 840 || kStack > kSide;
  document.body.classList.toggle("ed-stacked", stacked);
  const [PW, PH] = stacked ? fixed : side;
  document.body.style.setProperty("--page-w", PW + "px"); document.body.style.setProperty("--page-h", PH + "px");
  const top = stacked ? $("edbar").getBoundingClientRect().bottom + 12 : 68;
  if (stacked){
    EDIT.k = Math.max(.01, Math.min((W - pad * 2) / PW, (H * .58 - top - pad) / PH));
    EDIT.ox = (W - PW * EDIT.k) / 2;
    document.body.style.setProperty("--ed-split", (top + PH * EDIT.k + pad) + "px");
  } else {
    EDIT.k = Math.min((W - PANEL_W - pad * 3) / PW, (H - top - pad) / PH);
    EDIT.ox = pad + Math.max(0, (W - PANEL_W - pad * 3 - PW * EDIT.k) / 2);
  }
  EDIT.oy = top;
  pagesXform();
}
function goEditPage(name){
  if (!gridOf(name)) name = "main";
  EDIT.page = name; const i = pageList().indexOf(name); if (i >= 0 && i !== PAGE) showPage(i); else pagesXform();
  edPaint(true);
}
function selectTile(id){
  const b = id && boxOf(id); if (!b) return;
  EDIT.sel = b.s.id; EDIT.tile = id; EDIT.panel = null;
  const name = pgKey(b.p);
  if (name !== EDIT.page) goEditPage(name); else { stackTick(); edPaint(true); }
}
function editEnter(sel){
  if (EDIT.on || SOLO || TRIAL_ID) return;
  if (TRIAL){        // not while a layout is being tried: Save would keep it. Point at the banner instead.
    const b = document.getElementById("trialbar");
    if (b && b.animate) b.animate([{transform:"translateX(-50%) scale(1.12)"}, {transform:"translateX(-50%) scale(1)"}], 450);
    return;
  }
  const cur = pageList()[PAGE] || "main";
  EDIT.on = true; EDIT.focus = null; EDIT.orig = JSON.stringify(CFG); EDIT.hist = []; EDIT.fut = []; EDIT.panel = null; EDIT.sel = null; EDIT.tile = null; EDIT.addq = "";
  EDIT.page = gridOf(cur) ? cur : "main";
  EDIT.ori = PORTQ.matches ? "p" : "l"; [GC, GR] = dims(EDIT.ori);
  editUI(); document.body.classList.add("editing");
  edFrame();
  clearTimeout(pageTimer);
  layout(); render(); stackTick(); if (LOOK.ready) lookApply(document.body);
  goEditPage(EDIT.page);
  if (sel) selectTile(sel);
}
// tiles that are in no box are gone for good when you save; boxes forget tiles that no longer exist
function tilesTidy(){
  const placed = new Set();
  for (const p of pgItems()) for (const s of p.slots || []){ const L = smods(s).filter(id => tileItem(id)); setSmods(s, L); L.forEach(id => placed.add(id)); }
  tileItems().filter(t => !placed.has(t.id)).map(t => t.id).forEach(dropTileItem);
}
async function editExit(save){
  if (save){
    try{
      tilesTidy();
      const out = {}; for (const k in CFG) if (!tileItem(k)) out[k] = CFG[k];      // each tile's settings travel inside tiles.items
      const r = await fetch("/config", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({modules: out})});
      if (!r.ok) throw new Error("HTTP " + r.status);
      try{ window.parent.dashSaved && window.parent.dashSaved(); }catch(e){}
    }catch(e){ $("edhint").textContent = "Didn't save: " + e.message; edHostSync("Didn't save: " + e.message, "warn"); return; }
  }
  EDIT.on = false; edHostSync();
  // a clean start, on the page that was being edited; also what the screen does when the saved layout changes
  const u = new URL(location.href);
  u.searchParams.delete("edit"); u.searchParams.set("page", EDIT.page || "main");
  location.replace(u.href);
}
window.dashEdit = (on, tile) => on ? editEnter(tile) : editExit(false);
window.dashEditing = () => EDIT.on;
window.dashHostInput = e => { if (EDIT.on) edPanelInput(e); };
window.dashHostDown = e => { if (EDIT.on) panelDown(e); };
window.dashHostTab = tab => { if (!EDIT.on) return; if (tab === "+"){ EDIT.sel = null; EDIT.panel = "new"; edPaint(true); return; } EDIT.sel = null; EDIT.panel = null; goEditPage(tab); };
window.dashHostUndo = dir => { if (EDIT.on) undo(dir); };
window.dashHostSave = () => { if (EDIT.on) editExit(true); };
window.dashHostGrid = on => { document.body.classList.toggle("ed-grid", on == null ? !document.body.classList.contains("ed-grid") : !!on); edHostSync(); };
window.dashAddTile = type => { if (EDIT.on && TYPES[type]) addTileAnywhere(type); };
window.dashHostRefresh = () => { if (!EDIT.on) return; edFrame(); edPaint(true); };
window.dashDragTileMove = (type, x, y) => {
  if (!EDIT.on || !TYPES[type]) return;
  const pg = curPg(), G = pgGrid(); if (!pg || !G) return;
  EDIT.drag = {k:"tile", type, started:true, to:null};
  document.body.classList.add("ed-drag");
  const inside = x >= G.r.left && x <= G.r.right && y >= G.r.top && y <= G.r.bottom;
  if (inside){
    const [c, r] = cellAt(x, y), under = (pg.slots || []).find(v => at(RG(v, pg), c, r));
    if (under) EDIT.drag.to = {k:"into", s:under, R:RG(under, pg)};
    else { const R = fitAt(pg, TYPES[type].size, c, r); if (R) EDIT.drag.to = {k:"new", R}; }
    showPh(EDIT.drag.to ? EDIT.drag.to.R : {x:c, y:r, w:1, h:1}, EDIT.drag.to ? (EDIT.drag.to.k === "into" ? "swap" : "move") : "bad",
      EDIT.drag.to ? (EDIT.drag.to.k === "into" ? (live(under).length ? "Take turns with " + boxName(under) : "Put here") : "") : "No room");
  } else $("edph").hidden = true;
};
window.dashDragTileDrop = () => { if (EDIT.on) edUp(); };
window.dashDragTileCancel = () => { EDIT.drag = null; document.body.classList.remove("ed-drag"); if ($("edph")) $("edph").hidden = true; };
// Controls changed a dashboard-wide setting while the editor is open: use it here too, so Save keeps it
window.dashApply = mods => {
  for (const id in mods) if (CFG[id] && mods[id].settings && id !== "pages" && id !== "tiles" && !tileItem(id)) CFG[id].settings = JSON.parse(JSON.stringify(mods[id].settings));
  // tiles a page added in Controls brings with it (a premade layout, the Library): without them its boxes would be empty here, and Save would lose them
  const wantT = mods.tiles && mods.tiles.settings && mods.tiles.settings.items;
  if (wantT) for (const t of wantT) if (!tileItem(t.id)){ const it = JSON.parse(JSON.stringify(t)); tileItems().push(it); tileMount(it); refeed(it.id); }
  const want = mods.pages && mods.pages.settings && mods.pages.settings.items;
  if (want){        // pages added, renamed, turned on or off, or deleted in Controls; their boxes stay as edited here
    const have = pgItems();
    for (const p of want){ const h = have.find(x => x.id === p.id); if (!h) have.push(JSON.parse(JSON.stringify(p))); else Object.assign(h, {name:p.name, on:p.on, back:p.back}); }
    CFG.pages.settings.items = have.filter(h => h.id === "main" || h.id === "night" || want.some(p => p.id === h.id));
  }
  relayout();
  if (EDIT.on && !gridOf(EDIT.page)) goEditPage("main");
};
let resizeFrame;
addEventListener("resize", () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    if (EDIT.on){ const o = PORTQ.matches ? "p" : "l"; if (o !== EDIT.ori){ EDIT.drag = null; EDIT.ori = o; [GC, GR] = dims(o); placeAll(); } edFrame(); }
    render();
    if (EDIT.on) edPaint(true);
  });
});
document.addEventListener("transitionend", e => { if (e.target.id === "pages" && EDIT.on) edPaint(true); });

/* ----- drawing ----- */
function edPaint(force){
  if (!EDIT.on) return;
  const pg = curPg(), G = pgGrid(); if (!pg || !G) return;
  $("edundo").disabled = !EDIT.hist.length; $("edredo").disabled = !EDIT.fut.length;
  const names = pageList().filter(n => gridOf(n));
  $("edtabs").innerHTML = names.map(n => '<button data-tab="' + n + '"' + (n === EDIT.page ? ' class="on"' : "") + '>' + esc(pageName(gridOf(n))) + '</button>').join("") +
    '<button data-tab="+" title="Add a page">＋ Page</button>';
  const dirty = JSON.stringify(CFG) !== EDIT.orig;
  const dzx = EDIT.focus && designOf(MODULES[EDIT.focus.id]);
  $("edhint").textContent = dzx ? "Designing “" + dzx.name + "” · tap Done when finished" : dirty ? "Unsaved changes" : "";
  const fr = {left:G.r.left - 2, top:G.r.top - 2, width:G.r.width + 4, height:G.r.height + 4};
  Object.assign($("edcanvas").style, px(fr)); Object.assign($("edgrid").style, px(G.r));
  $("edgrid").style.gridTemplateColumns = "repeat(" + GC + ",1fr)"; $("edgrid").style.gridTemplateRows = "repeat(" + GR + ",1fr)"; $("edgrid").style.gap = (gapPx() * EDIT.k) + "px";
  const B = $("edboxes"); B.innerHTML = "";
  for (const s of pg.slots || []){
    const r = RG(s, pg); if (!r) continue;
    const o = document.createElement("div"), sel = EDIT.sel === s.id, has = live(s).length > 0;
    o.className = "eslot" + (sel ? " sel" : "") + (has ? "" : " empty") + (EDIT.addTo === s.id && EDIT.panel === "add" ? " target" : ""); o.dataset.slot = s.id;
    Object.assign(o.style, px(cellRect(r)));
    o.innerHTML = '<span class="lbl">' + esc(boxName(s)) + '</span>' + (has ? "" : '<em>Empty box<br>Drag a tile here</em>') +
      (sel ? ["n", "s", "e", "w", "ne", "nw", "se", "sw"].map(h => '<i class="hd ' + h + '" data-h="' + h + '"></i>').join("") +
        '<span class="tb"><b>' + r.w + ' × ' + r.h + '</b><button data-act="del">Remove box</button></span>' : "");
    B.appendChild(o);
  }
  edPanel(force); stackTick();
  if (EDIT.focus) designPaint();
  edHostSync();
}
const px = r => ({left:r.left + "px", top:r.top + "px", width:r.width + "px", height:r.height + "px"});
const firstLine = t => { const m = String(t || "").match(/^.*?[.!?](\s|$)/); return m ? m[0].trim() : String(t || ""); };
// what each kind of source is called (they are set up once in Controls → Setup and any tile can use them)
const srcLc = t => t === "Home Assistant" ? t : t.toLowerCase();      // a product name keeps its capitals
const SRCK = {calendars:["calendar", "Calendars"], lists:["list", "Lists"], teams:["team", "Sports teams"], albums:["album", "Photo albums"], cams:["camera", "Live cams"], homeassistant:["Home Assistant", "Home Assistant"], recipes:["recipe source", "Recipes"]};

function edPanel(force){
  const P = edPan(), pg = curPg(), s = EDIT.sel && (pg.slots || []).find(v => v.id === EDIT.sel);
  const ae = P.ownerDocument.activeElement;
  if (!force && ae && P.contains(ae) && (ae.tagName === "TEXTAREA" || ae.tagName === "INPUT" && /text|number|search/.test(ae.type))) return;   // typing
  const view = EDIT.focus ? "dz:" + EDIT.focus.id : EDIT.panel || (s ? "box:" + s.id + ":" + EDIT.tile : "page:" + EDIT.page);
  const top = P.scrollTop, same = P.dataset.view === view;
  let h = "";
  if (EDIT.focus) h = panelDesign();
  else if (EDIT.panel === "new") h = panelNew();
  else if (EDIT.panel === "add") h = panelAdd();
  else if (s) h = panelBox(s);
  else h = panelPage(pg);
  P.innerHTML = h;
  P.dataset.view = view;
  P.scrollTop = same ? top : 0;
}
function panelNew(){
  return '<div class="ph"><button data-act="back">‹ Back</button><b>New page</b></div><p class="pd">Pick a starting layout. Swipe left and right on the screen to move between pages. You can move, resize and add boxes afterwards.</p>' +
    Object.keys(PAGE_TEMPLATES).map(t => '<button class="tpl" data-tpl="' + esc(t) + '">' + tplPic(PAGE_TEMPLATES[t]) + '<span>' + esc(t) + '</span></button>').join("");
}
function panelPage(pg){
  const isMain = pg.id === "main" || pg.id === "night";
  let h = '<div class="ph"><b>' + esc(pageName(pg)) + ' page</b></div>';
  if (EDIT.ori === "p") h += portOwn(pg) ? '<p class="pd">Your screen is in portrait, so you are arranging this page for portrait. If you turn the screen back to landscape, it keeps its landscape arrangement of the same tiles.</p><button class="wide" data-act="portauto">Start over from the landscape layout</button>'
    : '<p class="pd">Your screen is in portrait. This page was arranged automatically from its landscape layout. Move or resize any box to make it your own.</p>';
  if (pg.id === "night") h += '<p class="pd">' + (ON("night") ? "Takes over the screen from " + hr12(S("night").start) + " to " + hr12(S("night").end) + ", dimmed. A touch shows the main page for a minute."
    : "The night page is off. Turn it on and set its hours in Controls → Night page.") + '</p>';
  h += '<button class="wide pri" data-act="add">＋ Add a tile</button>';
  if (!isMain) h += '<div class="grp"><label class="kv"><span>Page name</span><input type="text" data-pf="name" value="' + esc(pg.name) + '"></label>' +
    '<label class="kv"><span>Go back to Main after<small>Seconds; 0 stays on this page</small></span><span><input type="number" data-pf="back" min="0" max="3600" value="' + (+pg.back || 0) + '"> s</span></label></div>';
  const S0 = pg.slots || [];
  h += '<div class="sh">On this page</div>';
  h += S0.length ? '<div class="grp">' + S0.map(s => '<div class="kv rowbtn" data-act="selbox" data-id="' + s.id + '"><span>' + esc(boxName(s)) +
      (live(s).length > 1 ? '<small>' + live(s).length + ' tiles taking turns</small>' : "") +
      (RG(s, pg) ? "" : '<small>Not on ' + (EDIT.ori === "p" ? "portrait" : "landscape") + ' screens: there was no room</small>') + '</span><b>›</b></div>').join("") + '</div>'
    : '<p class="pd">Nothing here yet. Add a tile, or an empty box to fill later.</p>';
  h += '<div class="btns"><button data-act="box">Add an empty box</button></div>';
  if (!isMain) h += '<button class="wide red" data-act="delpage">Delete this page</button>';
  h += '<p class="pd">Tap a box to change what it shows. Drag a box to move it (drop it on another box to swap), and drag its edges to resize. Nothing changes on the screen until you Save.</p>';
  return h;
}
function panelAddList(q){
  const words = String(q || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  let h = "";
  for (const cat of CATS){
    const L = Object.values(TYPES).filter(T => T.cat === cat && !T.hidden && (!words.length || words.every(w => (T.title + " " + (T.desc || "") + " " + cat + " " + T.type).toLowerCase().includes(w))));
    if (!L.length) continue;
    h += '<div class="sh">' + esc(cat) + '</div>' + L.map(T => '<div class="tc" data-type="' + T.type + '"><b>' + esc(T.title) + '</b><small>' + esc(firstLine(T.desc)) +
      ((T.needs && !(SOURCES[T.needs] || []).length) ? ' <u>Needs ' + esc(srcLc(SRCK[T.needs][1])) + ' in Setup</u>' : "") + '</small></div>').join("");
  }
  return h || '<p class="pd">No tiles match.</p>';
}
function panelAdd(){
  const tgt = EDIT.addTo && slotById(EDIT.addTo);
  let h = '<div class="ph"><button data-act="back">‹ Back</button><b>' + (tgt ? "Add to this box" : "Add a tile") + '</b></div>';
  h += '<p class="pd">' + (tgt ? "Tap a tile to add it to the selected box. Tiles in the same box take turns." :
    "Drag a tile onto an empty spot to give it its own box, or onto a box to have them take turns. Or tap it to put it in the first free space. Add as many as you like, then tap a tile on the page to change its settings.") + '</p>';
  if (hostDesk()) h += '<input type="search" data-addq="1" placeholder="Search tiles…" value="' + esc(EDIT.addq || "") + '" autocomplete="off" spellcheck="false">';
  h += '<div data-addlist="1">' + panelAddList(hostDesk() ? EDIT.addq : "") + '</div>';
  return h;
}
function panelBox(s){
  const L = live(s); if (!L.includes(EDIT.tile)) EDIT.tile = L[0] || null;
  const id = EDIT.tile, m = MODULES[id], [mw, mh] = bmin(s);
  let h = '<div class="ph"><button data-act="desel">‹ ' + esc(pageName(curPg())) + '</button><b>' + (L.length > 1 ? "Box with " + L.length + " tiles" : m ? esc(m.name) : "Empty box") + '</b></div>';
  if (!L.length) h += '<p class="pd">This box is empty. Add a tile to it, or remove the box.</p>';
  if (L.length > 1){
    h += '<div class="sh">Taking turns</div><div class="grp">' + L.map((t, i) => '<div class="kv stk' + (t === id ? " on" : "") + '"><span data-pick="' + t + '">' + esc(titleOf(t)) +
      (!tileHas(t) ? '<small>Nothing to show right now, skipping</small>' : tileUrgent(t) ? '<small>Taking over the box now</small>' : "") + '</span><span class="ord">' +
      '<button data-act="up" data-id="' + t + '"' + (i ? "" : " disabled") + ' title="Earlier">↑</button><button data-act="dn" data-id="' + t + '"' + (i < L.length - 1 ? "" : " disabled") + ' title="Later">↓</button></span></div>').join("") +
      '<label class="kv"><span>Each turn lasts</span><span><input type="number" data-pf="every" min="5" max="600" value="' + (+s.every || 20) + '"> s</span></label></div>';
    h += '<p class="pd">These tiles take turns in this box. One with nothing to show right now (say, no match this week) skips its turn. One set to take over keeps the box while it matters, like the rain radar when rain is close. Tap a tile above to change its settings.</p>';
  }
  h += '<button class="wide" data-act="add">＋ ' + (L.length ? "Add another tile to this box" : "Add a tile to this box") + '</button>';
  if (L.length === 1) h += '<p class="pd">Tiles in the same box take turns, so one box can show several things.</p>';
  if (m) h += tileForm(m, L.length > 1);
  h += '<div class="sh">Box</div>';
  if (L.length) h += '<div class="kv0">Text size</div><div class="seg2">' + TSZ.map(([n, v]) => '<button data-act="ts" data-v="' + v + '"' + (((+s.ts || 1) === v) ? ' class="on"' : "") + '>' + n + '</button>').join("") + '</div>' +
    '<p class="pd">Text also shrinks a little on its own when the box is too small for it.</p>';
  h += '<div class="grp"><div class="kv"><span>Size' + (EDIT.ori === "p" ? " in portrait" : "") + '</span><b>' + (RG(s) ? RG(s).w + ' × ' + RG(s).h + ' squares' : "Not on this screen") + '</b></div>' + (L.length ? '<div class="kv"><span>Smallest it can be</span><b>' + mw + ' × ' + mh + '</b></div>' : "") + '</div>';
  h += '<div class="btns">' + (L.length ? '<button data-act="fit">Usual size</button>' : "") + '<button data-act="grow">Fill free space</button>' + (L.length ? '<button data-act="dup">Duplicate</button>' : "") + '</div>';
  h += '<button class="wide red" data-act="del">Remove this box</button>';
  h += '<p class="pd">Drag the box to move it; drop it on another box to swap them. Drag an edge or corner to resize. Keys: arrows move, Shift+arrows resize, Delete removes, Esc goes back.</p>';
  return h;
}
// a tile's settings: its name, its type's own settings, and "take over" if its type can
function tileDefs(m){
  const D = Object.assign({}, m.settings || {});
  if (m.takeover) D.takeover = {type:"bool", label:m.takeover, help:"Only matters when it shares a box with other tiles"};
  return D;
}
function tileForm(m, inStack){
  const D = tileDefs(m), T = TYPES[m.type];
  let h = '<div class="sh">' + (inStack ? esc(m.name) + " settings" : "Tile settings") + '</div>';
  h += '<p class="pd tdesc"><b>' + esc(T.title) + '.</b> ' + esc(T.desc || "") + '</p>';
  if (m.editNote) h += m.editNote();
  const dz = designOf(m);
  if (m.parts) h += styleChooser(m, dz);
  h += '<div class="grp"><label class="kv"><span>Name</span><input type="text" data-tn="1" placeholder="' + esc(T.title) + '" value="' + esc(m.it.name || "") + '"></label>';
  // with a design in use, its own look and which parts show are set in the designer, so those settings would do nothing here
  // a setting can wait for another one (when:{meals:"Follow the time of day"}) or for the store deals to be set up (needs:"deals")
  const shown = d => !(d.when && Object.keys(d.when).some(w => String(m.s[w] == null ? (D[w] || {}).default : m.s[w]).toLowerCase() !== String(d.when[w]).toLowerCase())) &&
    !(d.needs === "deals" && !(CFG.deals && CFG.deals.settings && CFG.deals.settings.zip));
  for (const k in D) if (!(m.parts && k === "style") && !(dz && (D[k].look || D[k].part)) && shown(D[k])) h += field(m, k, D[k]);
  h += '</div><button class="wide red" data-act="rmtile">Remove ' + esc(m.name) + (inStack ? " from this box" : "") + '</button>';
  return h;
}
// a tile with parts: its ready-made styles and the saved designs for its type, picked the same way
function styleChooser(m, dz){
  const L = designLib(m.type), P = presetsOf(m), cur = dz ? "d:" + dz.id : "p:" + (m.s.style || P[0]);
  const b = (v, l) => '<button data-act="dzpick" data-v="' + esc(v) + '"' + (v === cur ? ' class="on"' : "") + '>' + l + '</button>';
  let h = '<div class="sh">Style</div><div class="seg2 wrap stl">' + P.map(v => b("p:" + v, esc(v))).join("") + '</div>';
  if (L.length) h += '<div class="sh">Your designs</div><div class="seg2 wrap stl">' + L.map(x => b("d:" + x.id, "★ " + esc(x.name))).join("") + '</div>';
  h += '<div class="btns">' + (dz ? '<button class="pri" data-act="dzedit">✎ Edit “' + esc(dz.name) + '”</button><button data-act="dznew">Copy it</button>' :
    '<button class="pri" data-act="dznew">✎ New design from ' + esc(P.length > 1 ? "“" + (m.s.style || P[0]) + "”" : "this") + '</button>') + '</div>' +
    '<p class="pd">' + (dz ? "Its layout, fonts, colors and which parts show are set in the design. The settings below still apply." :
      "A design lets you move, resize, recolor or hide each part of this tile. Name it and it shows up here to pick.") + '</p>';
  return h;
}
function field(m, k, d){
  const v = m.s[k], a = 'data-ts="' + k + '"', lab = t => '<span>' + esc(d.label || k) + (t || d.help ? '<small>' + esc(t || d.help) + '</small>' : "") + '</span>';
  switch (d.type){
    case "bool": return '<label class="kv">' + lab() + '<input type="checkbox" class="sw" ' + a + (v ? " checked" : "") + '></label>';
    case "int": case "number": return '<label class="kv">' + lab() + '<input type="number" ' + a + (d.min != null ? ' min="' + d.min + '"' : "") + (d.max != null ? ' max="' + d.max + '"' : "") +
      (d.type === "number" ? ' step="any"' : "") + ' value="' + esc(v == null ? "" : v) + '"></label>';
    case "color":
      if (d.theme){      // a color that can follow the theme: "Theme" puts back the default, which the tile treats as "use the theme's"
        const on = !v || String(v).toLowerCase() === String(d.default || "#ffffff").toLowerCase();
        return '<div class="kv">' + lab() + '<span class="clrs"><button type="button" class="themeclr' + (on ? " on" : "") + '" data-act="themeclr" data-k="' + k + '">Theme</button><input type="color" ' + a + ' value="' + esc(v || "#ffffff") + '"></span></div>';
      }
      return '<label class="kv">' + lab() + '<input type="color" ' + a + ' value="' + esc(v || "#ffffff") + '"></label>';
    case "choice": return '<label class="kv">' + lab() + '<select ' + a + '>' + (d.choices || []).map(c => '<option' + (String(c).toLowerCase() === String(v).toLowerCase() ? " selected" : "") + '>' + esc(c) + '</option>').join("") + '</select></label>';
    case "text": return '<label class="kv col">' + lab() + '<input type="text" ' + a + ' placeholder="' + esc(d.placeholder || "") + '" value="' + esc(v || "") + '"></label>';
    case "list": return '<label class="kv col">' + lab() + '<textarea rows="4" ' + a + ' placeholder="' + esc(d.placeholder || "One per line") + '">' + esc((v || []).join("\n")) + '</textarea></label>';
    case "code": return '<label class="kv col">' + lab() + '<textarea class="code" rows="9" spellcheck="false" ' + a + '>' + esc(v || "") + '</textarea></label>' +
      '<div class="kv col"><button class="wide" data-act="ai">Copy instructions for ChatGPT</button><small>Paste them into ChatGPT (or any AI chat) with a sentence about what you want, then paste the code it gives you above.</small></div>';
    case "source": return srcField(m, k, d, v, lab);
    case "entity": return entField(m, k, d, v, lab);
    case "secret": return sbxKeyField(m, k, d, lab);
  }
  return "";
}
function srcField(m, k, d, v, lab){
  const L = SOURCES[d.kind] || [], N = SRCK[d.kind] || [d.kind, d.kind], setup = '<button class="lnk" data-act="setup" data-kind="' + d.kind + '">' + (L.length ? "Manage " : "Set up ") + esc(srcLc(N[1])) + ' ›</button>';
  if (!L.length) return '<div class="kv col">' + lab() + '<em class="none">' + esc(d.none || "No " + srcLc(N[1]) + " set up yet.") + '</em>' + setup + '</div>';
  const dot = x => x.color ? '<i class="cdot" style="background:' + esc(x.color) + '"></i>' : "";
  if (d.multi){
    const sel = Array.isArray(v) ? v : [];
    return '<div class="kv col">' + lab(sel.length ? "" : "None ticked shows all of them") + '<div class="chks">' + L.map(x => '<label class="chk"><input type="checkbox" ' + a2(k) + ' data-src="' + esc(x.id) + '"' +
      (sel.includes(x.id) ? " checked" : "") + '>' + dot(x) + esc(x.name) + '</label>').join("") + '</div>' + setup + '</div>';
  }
  const cur = L.some(x => x.id === v) ? v : L[0].id;
  return '<label class="kv col">' + lab() + '<select ' + a2(k) + '>' + L.map(x => '<option value="' + esc(x.id) + '"' + (x.id === cur ? " selected" : "") + '>' + esc(x.name) + '</option>').join("") + '</select>' + setup + '</label>';
}
const a2 = k => 'data-ts="' + k + '"';
// Home Assistant entities: the chosen ones (in order), then a search over everything the server can see
const ENTS = {};             // source id -> {at, list, error, busy}
function entList(src){
  const c = ENTS[src] = ENTS[src] || {};
  if (!c.busy && Date.now() - (c.at || 0) > 60e3){
    c.busy = true;
    getJSON("/ha/entities?src=" + encodeURIComponent(src)).then(j => { c.list = j.entities || []; c.error = j.error || ""; }, e => { c.error = String(e.message || e); })
      .finally(() => { c.busy = false; c.at = Date.now(); if (EDIT.on) edPanel(true); });
  }
  return c;
}
function entField(m, k, d, v, lab){
  if (!(SOURCES.homeassistant || []).length) return '<div class="kv col">' + lab() + '<em class="none">Set up Home Assistant first.</em><button class="lnk" data-act="setup" data-kind="homeassistant">Set up Home Assistant ›</button></div>';
  const src = m.s[d.src || "src"] || "", c = entList(src), sel = d.multi ? (Array.isArray(v) ? v : []) : (v ? [v] : []);
  const byId = {}; (c.list || []).forEach(x => byId[x.id] = x);
  const q = ((EDIT.entq || {})[m.id + k] || "").toLowerCase();
  let h = '<div class="kv col">' + lab() + '<div class="ents">' + sel.map((id, i) => '<div class="ent on"><span><b>' + esc((byId[id] || {}).name || id) + '</b><small>' + esc(id) + '</small></span>' +
    (d.multi ? '<button data-act="entmv" data-k="' + k + '" data-i="' + i + '" data-d="-1"' + (i ? "" : " disabled") + ' title="Earlier">↑</button>' : "") +
    '<button data-act="entrm" data-k="' + k + '" data-e="' + esc(id) + '" title="Remove">✕</button></div>').join("") +
    (sel.length ? "" : '<em class="none">' + (d.multi ? "Nothing picked yet. Search below and tap to add." : "Search below and tap one.") + '</em>') + '</div>';
  h += '<input type="search" data-entq="' + k + '" placeholder="Search: kitchen, door, temperature…" value="' + esc((EDIT.entq || {})[m.id + k] || "") + '" autocomplete="off" spellcheck="false">';
  h += '<div class="entres" data-entres="' + k + '">' + entResults(m, k, d, sel, c, q) + '</div></div>';
  return h;
}
function entResults(m, k, d, sel, c, q){
  if (c.error && !(c.list || []).length) return '<em class="none">' + esc(c.error) + '</em>';
  if (!c.list) return '<em class="none">Loading from Home Assistant…</em>';
  const words = q.split(/\s+/).filter(Boolean);
  const L = c.list.filter(x => !sel.includes(x.id) && (!d.domains || d.domains.includes(x.domain)) && words.every(w => (x.name + " " + x.id).toLowerCase().includes(w)));
  if (!L.length) return '<em class="none">Nothing matches.</em>';
  return L.slice(0, 40).map(x => '<div class="ent" data-act="entadd" data-k="' + k + '" data-e="' + esc(x.id) + '"><span><b>' + esc(x.name) + '</b><small>' + esc(x.id) + '</small></span><i>' +
    esc(String(x.state) + (x.unit ? " " + x.unit : "")) + '</i></div>').join("") + (L.length > 40 ? '<em class="none">' + (L.length - 40) + ' more: type to narrow it down</em>' : "");
}
function entAct(a, el){
  const m = MODULES[EDIT.tile]; if (!m) return;
  const k = el.dataset.k, d = tileDefs(m)[k] || {}; remember();
  if (d.multi){
    const L = Array.isArray(m.s[k]) ? m.s[k].slice() : [];
    if (a === "entadd" && !L.includes(el.dataset.e)) L.push(el.dataset.e);
    if (a === "entrm") L.splice(L.indexOf(el.dataset.e), 1);
    if (a === "entmv"){ const i = +el.dataset.i, j = i + +el.dataset.d; if (j >= 0 && j < L.length) [L[i], L[j]] = [L[j], L[i]]; }
    m.s[k] = L;
  } else m.s[k] = a === "entadd" ? el.dataset.e : "";
  if (m._fd) m._fd.at = 0;              // fetch the new set right away
  relayout();
}
function tplPic(boxes){
  return '<svg viewBox="0 0 240 160"><rect width="240" height="160" rx="10" fill="#1c2430"/>' +
    boxes.map(b => '<rect x="' + (b[0] * 10 / U + 3) + '" y="' + (b[1] * 10 / U + 3) + '" width="' + (b[2] * 10 / U - 6) + '" height="' + (b[3] * 10 / U - 6) + '" rx="6" fill="none" stroke="#5aa9ff" stroke-width="3" stroke-dasharray="8 5"/>').join("") + '</svg>';
}
function edPanelInput(e){
  const t = e.target, pg = curPg(); if (!pg) return;
  if (t.dataset.addq){
    EDIT.addq = t.value;
    const box = edPan().querySelector('[data-addlist="1"]');
    if (box) box.innerHTML = panelAddList(t.value);
    return;
  }
  if (t.dataset.entq){                       // entity search: narrow the results as you type
    const m = MODULES[EDIT.tile]; if (!m) return;
    const k = t.dataset.entq, d = tileDefs(m)[k] || {}, v = m.s[k], sel = d.multi ? (Array.isArray(v) ? v : []) : (v ? [v] : []);
    (EDIT.entq = EDIT.entq || {})[m.id + k] = t.value;
    const box = edPan().querySelector('[data-entres="' + k + '"]');
    if (box) box.innerHTML = entResults(m, k, d, sel, entList(m.s[d.src || "src"] || ""), t.value.toLowerCase());
    return;
  }
  if (e.type === "input") return;            // act once the value is final (change)
  if (t.dataset.dz) return designInput(t);
  if (t.dataset.ts || t.dataset.tn) return tileInput(t);
  if (!t.dataset.pf) return;
  remember();
  if (t.dataset.pf === "every"){ const s2 = selSlot(); if (s2) s2.every = Math.max(5, Math.min(600, parseInt(t.value, 10) || 20)); }
  else if (t.dataset.pf === "name") pg.name = t.value.trim() || pg.name;
  else pg.back = Math.max(0, Math.min(3600, parseInt(t.value, 10) || 0));
  t.blur(); edPaint(true);
}
function tileInput(t){
  const m = MODULES[EDIT.tile]; if (!m) return;
  remember();
  if (t.dataset.tn){ const n = t.value.trim(); if (n) m.it.name = n; else delete m.it.name; SCH[m.id].title = m.name; }
  else {
    const k = t.dataset.ts, d = tileDefs(m)[k] || {};
    let v = t.value;
    if (d.type === "bool") v = t.checked;
    else if (d.type === "int" || d.type === "number"){
      v = d.type === "int" ? parseInt(v, 10) : parseFloat(v);
      if (isNaN(v)) v = d.default; if (d.min != null) v = Math.max(d.min, v); if (d.max != null) v = Math.min(d.max, v);
    }
    else if (d.type === "list") v = v.split("\n").map(x => x.trim()).filter(Boolean);
    else if (d.type === "source" && d.multi) v = [...edPan().querySelectorAll('input[data-ts="' + k + '"]:checked')].map(x => x.dataset.src);
    m.s[k] = v;
    if (d.type === "source") refeed(m.id);
  }
  if (t.type !== "checkbox") t.blur();
  relayout();                 // draw it again from scratch with the new settings
}
function aiPrompt(desc){
  return "Please write a tile for my home dashboard (a wall-mounted touch screen, about 1920x1080, seen from across the room).\n\n" +
    "What the tile should show:\n" + (desc && desc.trim() ? desc.trim() : "(describe it here)") + "\n\n" +
    "Rules for the code:\n" +
    "- Reply with ONE self-contained HTML snippet: HTML with inline <style> and <script>. No separate files, no build step, no libraries that need installing. It is placed inside <body> of a page that is already set up, so leave out <html>, <head> and <body>.\n" +
    "- It fills a box whose size can change (from about 400x300 up to 1200x800 pixels). Make the layout flexible (flexbox or grid, percentages) and keep everything inside the box with no scrolling.\n" +
    "- Keep the background transparent; the dashboard draws a card behind it. These CSS variables are available: var(--fg) for main text, var(--dim) for secondary text, var(--accent) for a highlight color.\n" +
    "- It must be readable from a distance: no text under 18px, and the main number or words 40px or bigger.\n" +
    "- For live data, use fetch() with a free public web API that works from a browser (allows CORS) and needs no API key. Only https:// addresses work: plain http:// and devices on my home network are blocked. Never put passwords or private keys in the code. Refresh with setInterval, no more often than every 5 minutes.\n" +
    "- It can't use cookies, localStorage or pop-ups, and can't reach the page around it. Nobody uses a mouse or keyboard on it.\n" +
    "- If the data can't be loaded, show a short friendly message instead of an error.\n" +
    "- Plain JavaScript and modern CSS; make it clean and good-looking. Emoji are fine.\n" +
    "- Reply with just the code.";
}
function copyText(txt){
  const ta = $("edclip"); ta.value = txt; ta.focus(); ta.select();
  let ok = false; try{ ok = document.execCommand("copy"); }catch(e){}
  if (!ok && navigator.clipboard) navigator.clipboard.writeText(txt).then(() => flash("Copied. Paste it into ChatGPT.", true), () => flash("Couldn't copy here: try from Controls on a computer"));
  else flash(ok ? "Copied. Paste it into ChatGPT." : "Couldn't copy here: try from Controls on a computer", ok);
}
function openSetup(kind){
  try{ if (inFrame()){ window.parent.dashSetup(kind); return; } }catch(e){}
  flash("Set these up in Controls → Setup → " + ((SRCK[kind] || [])[1] || kind) + " on your phone or computer");
}

/* ----- actions ----- */
function selSlot(){ const pg = curPg(); return pg && (pg.slots || []).find(s => s.id === EDIT.sel); }
function removeBox(s){
  const pg = curPg(); remember();
  smods(s).forEach(dropTileItem);
  pg.slots = pg.slots.filter(v => v !== s); if (EDIT.sel === s.id){ EDIT.sel = null; EDIT.tile = null; }
  relayout();
}
// the biggest rectangle (up to a tile's usual size) that fits in free space around a cell
function fitAt(pg, size, c, r, skip){
  const [dw, dh, mw, mh] = size;
  const sizes = [];
  for (let w = dw; w >= mw; w--) for (let h = dh; h >= mh; h--) sizes.push([w, h]);
  sizes.sort((a, b) => b[0] * b[1] - a[0] * a[1]);
  for (const [w, h] of sizes){
    const cx = c - Math.floor(w / 2), cy = r - Math.floor(h / 2), C = [];
    for (let y = r - h + 1; y <= r; y++) for (let x = c - w + 1; x <= c; x++) C.push({x, y, w, h, d:Math.abs(x - cx) + Math.abs(y - cy)});
    C.sort((a, b) => a.d - b.d);
    for (const R of C){ delete R.d; if (inGrid(R) && !blocked(pg, R, skip)) return R; }
  }
  return null;
}
// the first free place, top-left first, for a tile of this size (shrinking down to its smallest)
function freeSpot(pg, size, o = EDIT.ori){
  const [C, H] = dims(o), [dw, dh, mw, mh] = size, sizes = [];
  for (let w = Math.min(dw, C); w >= mw; w -= U) for (let h = Math.min(dh, H); h >= mh; h -= U) sizes.push([w, h]);
  sizes.sort((a, b) => b[0] * b[1] - a[0] * a[1]);
  for (const [w, h] of sizes) for (let y = 0; y + h <= H; y++) for (let x = 0; x + w <= C; x++){ const R = {x, y, w, h}; if (!blocked(pg, R, null, o)) return R; }
  return null;
}
function growFree(s){         // stretch right, then down, then left and up, until something is in the way
  const pg = curPg(); if (!RG(s, pg)) return;
  remember(); touch(pg);
  const g = RG(s, pg);
  const tryStep = (k, d) => { const t = {x:g.x, y:g.y, w:g.w, h:g.h}; if (k === "x"){ t.x -= d; t.w += d; } else if (k === "y"){ t.y -= d; t.h += d; } else t[k] += d;
    if (inGrid(t) && !blocked(pg, t, s)){ Object.assign(g, t); return true; } return false; };
  let more = true;
  while (more){ more = false; for (const k of ["w", "h", "x", "y"]) if (tryStep(k, 1)) more = true; }
  relayout();
}
// a new box's place. While portrait is still worked out from landscape it fills the screen, so a new box gets a
// landscape place and portrait makes room for it
function newSpot(pg, size){
  return EDIT.ori === "p" && !portOwn(pg) ? {o:"l", R:freeSpot(pg, size, "l")} : {o:EDIT.ori, R:freeSpot(pg, size)};
}
function addEmptyBox(){
  const pg = curPg(), size = [12 * U, 8 * U, 1, 1], {o, R} = newSpot(pg, size);
  if (!R){ flash("No room left: make a box smaller first"); return; }
  remember(); const s = newBox(pg, R, size, o);
  EDIT.sel = s.id; EDIT.tile = null; relayout();
}
function duplicateBox(s){
  const pg = curPg(), g = RG(s, pg); if (!g) return;
  const [mw, mh] = bmin(s), {o, R} = newSpot(pg, [g.w, g.h, mw, mh]);
  if (!R){ flash("No room left on this page: make a box smaller first"); return; }
  remember();
  const ids = live(s).map(oldId => {
    const src = tileItem(oldId); if (!src) return null;
    const tid = src.type + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const copy = JSON.parse(JSON.stringify(src)); copy.id = tid;
    tileItems().push(copy); tileMount(copy); refeed(tid);
    return tid;
  }).filter(Boolean);
  const b = newBox(pg, R, [g.w, g.h, mw, mh], o);
  setSmods(b, ids);
  if (s.every) b.every = s.every;
  if (s.ts) b.ts = s.ts;
  EDIT.sel = b.id; EDIT.tile = ids[0] || null; EDIT.panel = null;
  relayout();
  flash("Duplicated " + boxName(b), true);
}
function flash(t, ok){
  const h = $("edhint"); h.textContent = t; h.classList.toggle("warn", !ok); h.classList.toggle("ok", !!ok);
  edHostSync(t, ok ? "ok" : "warn");
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { h.classList.remove("warn", "ok"); edPaint(); }, 3000);
}
// make a new tile of this type and put it in box s (an existing box, or a new one given as a rectangle)
function addTile(type, s){
  const pg = curPg(); remember();
  if (s.rect) s = newBox(pg, s.rect, TYPES[type].size, s.o);         // a new box, given as where it goes
  const id = newTile(type);
  const L = live(s); L.push(id); setSmods(s, L);
  if (!pg.slots.includes(s)) pg.slots.push(s);
  // from Add a tile, stay in the list so a whole page can be filled in one go; the new box is highlighted, and tapping
  // any box opens its settings. Adding to a chosen box (Add to this box) goes straight to that box's settings.
  const more = EDIT.panel === "add" && !EDIT.addTo;
  EDIT.sel = s.id; EDIT.tile = id; EDIT.panel = more ? "add" : null; EDIT.addTo = null;
  relayout(); refeed(id);
  if (more) flash("Added " + TYPES[type].title + ". Add more, or tap it on the page for its settings", true);
}
function addTileAnywhere(type){
  const tgt = EDIT.addTo && slotById(EDIT.addTo);
  if (tgt) return addTile(type, tgt);
  const {o, R} = newSpot(curPg(), TYPES[type].size);
  if (!R){ flash("No free space: drag it onto a box to share that box, or make room first"); return; }
  addTile(type, {rect:R, o});
}
function stackAct(a, id){
  const s = selSlot(); if (!s) return;
  const L = smods(s), i = L.indexOf(id);
  remember();
  if (a === "up" && i > 0) [L[i - 1], L[i]] = [L[i], L[i - 1]];
  else if (a === "dn" && i < L.length - 1) [L[i + 1], L[i]] = [L[i], L[i + 1]];
  setSmods(s, L); relayout();
}
function removeTile(id){
  const s = selSlot(); if (!s) return;
  remember();
  setSmods(s, smods(s).filter(x => x !== id)); dropTileItem(id);
  EDIT.tile = null; relayout();
}

/* ----- pointer ----- */
function edDown(e){
  const t = e.target;
  if (t.closest("#edbar")){
    const b = t.closest("button[data-tab]"); if (!b) return;
    if (b.dataset.tab === "+"){ EDIT.sel = null; EDIT.panel = "new"; edPaint(true); return; }
    EDIT.sel = null; EDIT.panel = null; goEditPage(b.dataset.tab); return;
  }
  if (t.closest("#edpanel")) return panelDown(e);
  e.preventDefault();
  $("edl").focus({preventScroll:true});
  const act = t.closest("[data-act]");
  if (act){ boxAct(act.dataset.act, act); return; }
  const box = t.closest(".eslot"), pg = curPg(), s = box && pg.slots.find(v => v.id === box.dataset.slot);
  if (!s){ if (EDIT.sel || EDIT.panel){ EDIT.sel = null; EDIT.panel = null; edPaint(true); } return; }
  if (EDIT.panel === "add" && EDIT.addTo && EDIT.addTo !== s.id){ EDIT.addTo = s.id; EDIT.sel = s.id; edPaint(true); return; }    // Add to this box: pick another box to add to
  if (EDIT.panel === "add" && !EDIT.addTo){ EDIT.sel = null; EDIT.panel = null; }       // Add a tile: a tap on a box opens its settings
  if (EDIT.sel !== s.id){ EDIT.sel = s.id; EDIT.tile = live(s)[0] || null; EDIT.panel = null; }
  const [c, r] = cellAt(e.clientX, e.clientY), g = RG(s, pg);
  if (t.dataset.h) EDIT.drag = {k:"rs", s, dir:t.dataset.h, orig:{x:g.x, y:g.y, w:g.w, h:g.h}, snap:JSON.stringify(CFG)};
  else EDIT.drag = {k:"pend", s, x0:e.clientX, y0:e.clientY, dc:c - g.x, dr:r - g.y};
  try{ $("edl").setPointerCapture(e.pointerId); }catch(err){}      // edPaint replaces .eslot; keep touch capture on the stable editor layer
  edPaint(true);
}
function boxAct(a, el){
  if (a.startsWith("dz")) return designAct(a, el);
  const s = selSlot(), id = el && el.dataset.id;
  if (a === "up" || a === "dn") return stackAct(a, id);
  if (a === "ts" && s){ remember(); const v = +el.dataset.v; if (v === 1) delete s.ts; else s.ts = v; live(s).forEach(x => render(x)); edPaint(true); return; }
  if (a === "del" && s) removeBox(s);
  else if (a === "rmtile" && EDIT.tile) removeTile(EDIT.tile);
  else if (a === "desel"){ EDIT.sel = null; EDIT.tile = null; edPaint(true); }
  else if (a === "selbox"){ EDIT.sel = id; EDIT.tile = null; edPaint(true); }
  else if (a === "back"){ EDIT.panel = null; EDIT.addTo = null; edPaint(true); }
  else if (a === "add"){ EDIT.panel = "add"; EDIT.addTo = s ? s.id : null; edPaint(true); }
  else if (a === "setup") openSetup(el.dataset.kind);
  else if (a.startsWith("ent")) entAct(a, el);
  else if (a === "themeclr"){ const m = MODULES[EDIT.tile]; if (m){ remember(); m.s[el.dataset.k] = (tileDefs(m)[el.dataset.k] || {}).default || ""; relayout(); } }
  else if (a === "tksave" || a === "tkrm") sbxKeyAct(a, el);
  else if (a === "minetrust"){ const m = MODULES[EDIT.tile]; if (m && m.mine && m.mine.review){ sbxTrust(m).then(() => edPaint(true)); } }
  else if (a === "minerun"){ const m = MODULES[EDIT.tile]; if (m && m.it.review){ remember(); delete m.it.review; render(m.id); edPaint(true); } }
  else if (a === "ai"){ const m = MODULES[EDIT.tile]; copyText(aiPrompt(m && m.s.ask)); }
  else if (a === "fit" && s && RG(s)){ const pg = curPg(), g = RG(s, pg), [dw, dh] = tsize(EDIT.tile || s.mod).map((v, i) => Math.min(v, i ? GR : GC)), R = {x:Math.min(g.x, GC - dw), y:Math.min(g.y, GR - dh), w:dw, h:dh};
    if (blocked(pg, R, s)){ flash("Not enough room here for its usual size"); return; } remember(); touch(pg); Object.assign(RG(s, pg), R); relayout(); }
  else if (a === "portauto"){ const pg = curPg(); remember(); (pg.slots || []).forEach(v => { delete v.p; }); relayout(); }
  else if (a === "grow" && s) growFree(s);
  else if (a === "dup" && s) duplicateBox(s);
  else if (a === "box") addEmptyBox();
  else if (a === "delpage"){
    const pg = curPg(); if (!pg || pg.id === "main" || pg.id === "night") return;
    remember(); (pg.slots || []).forEach(v => smods(v).forEach(dropTileItem));
    CFG.pages.settings.items = pgItems().filter(p => p !== pg); EDIT.sel = null;
    relayout(); goEditPage("main");
  }
}
function panelDown(e){
  const t = e.target, act = t.closest("[data-act]");
  if (t.closest("input,select,textarea") && !t.matches("button")) return;     // a switch or field inside a tappable row works on its own
  if (act){ e.preventDefault(); boxAct(act.dataset.act, act); return; }
  const pk = t.closest("[data-pick]");
  if (pk){ e.preventDefault(); EDIT.tile = pk.dataset.pick; stackTick(); edPaint(true); return; }
  const tp = t.closest("[data-tpl]");
  if (tp){ e.preventDefault(); remember(); const pg = newPage(tp.dataset.tpl); EDIT.panel = null; EDIT.sel = null; relayout(); goEditPage("c:" + pg.id); return; }
  const tc = t.closest("[data-type]");
  if (tc){ e.preventDefault(); EDIT.drag = {k:"tile", type:tc.dataset.type, x0:e.clientX, y0:e.clientY, started:false}; }
}
function edMove(e){
  const D = EDIT.drag; if (!D) return;
  const x = e.clientX, y = e.clientY, pg = curPg(), ph = $("edph");
  if (D.k === "pend" && Math.hypot(x - D.x0, y - D.y0) > 6){ D.k = "mv"; D.snap = JSON.stringify(CFG); document.body.classList.add("ed-drag"); }
  if (D.k === "mv"){
    const [c, r] = cellAt(x, y), s = D.s, sg = RG(s, pg);
    const R = {x:Math.max(0, Math.min(GC - sg.w, c - D.dc)), y:Math.max(0, Math.min(GR - sg.h, r - D.dr)), w:sg.w, h:sg.h};
    const o = document.querySelector('.eslot[data-slot="' + s.id + '"]');
    if (o) o.classList.add("moving");
    const g = $("edghost"); g.textContent = boxName(s); g.hidden = false;
    g.style.left = (x + 14) + "px"; g.style.top = (y + 10) + "px";
    const under = (pg.slots || []).find(v => v !== s && at(RG(v, pg), c, r));
    if (!blocked(pg, R, s)) D.to = {k:"move", R};
    else if (under) D.to = {k:"swap", R:RG(under, pg), with:under};
    else D.to = null;
    showPh(D.to ? D.to.R : R, D.to ? D.to.k : "bad", D.to && D.to.k === "swap" ? "Swap" : D.to ? "" : "No room");
  } else if (D.k === "rs"){
    const [c, r] = cellAt(x, y), s = D.s, o = D.orig, d = D.dir, [minW, minH] = bmin(s);
    let x0 = o.x, x1 = o.x + o.w, y0 = o.y, y1 = o.y + o.h;
    if (d.includes("e")) x1 = Math.max(x0 + minW, Math.min(GC, c + 1));
    if (d.includes("w")) x0 = Math.min(x1 - minW, Math.max(0, c));
    if (d.includes("s")) y1 = Math.max(y0 + minH, Math.min(GR, r + 1));
    if (d.includes("n")) y0 = Math.min(y1 - minH, Math.max(0, r));
    // stop at neighbors: walk each moving edge back toward where it started until it fits
    const T = () => ({x:x0, y:y0, w:x1 - x0, h:y1 - y0});
    const step = (get, set, target) => { while (blocked(pg, T(), s) && get() !== target) set(get() + (target > get() ? 1 : -1)); };
    step(() => x1, v => { x1 = v; }, o.x + o.w); step(() => x0, v => { x0 = v; }, o.x);
    step(() => y1, v => { y1 = v; }, o.y + o.h); step(() => y0, v => { y0 = v; }, o.y);
    if (!blocked(pg, T(), s)){
      const R = T(), g = RG(s, pg);
      if (R.x !== g.x || R.y !== g.y || R.w !== g.w || R.h !== g.h){ touch(pg); Object.assign(RG(s, pg), R); const el = pgSec().querySelector('[data-slot="' + s.id + '"]'); if (el) placeSlot(el, s, pg); edPaint(true); }
    }
    document.body.classList.add("ed-drag");
  } else if (D.k === "tile"){
    if (!D.started && Math.hypot(x - D.x0, y - D.y0) > 6){ D.started = true; const g = $("edghost"); g.textContent = TYPES[D.type].title; g.hidden = false; document.body.classList.add("ed-drag"); }
    if (!D.started) return;
    const g = $("edghost"); g.style.left = (x + 14) + "px"; g.style.top = (y + 10) + "px";
    const G = pgGrid(), inside = x >= G.r.left && x <= G.r.right && y >= G.r.top && y <= G.r.bottom;
    D.to = null;
    if (inside){
      const [c, r] = cellAt(x, y), under = (pg.slots || []).find(v => at(RG(v, pg), c, r));
      if (under) D.to = {k:"into", s:under, R:RG(under, pg)};
      else { const R = fitAt(pg, TYPES[D.type].size, c, r); if (R) D.to = {k:"new", R}; }
      showPh(D.to ? D.to.R : {x:c, y:r, w:1, h:1}, D.to ? (D.to.k === "into" ? "swap" : "move") : "bad",
        D.to ? (D.to.k === "into" ? (live(under).length ? "Take turns with " + boxName(under) : "Put here") : "") : "No room");
    } else $("edph").hidden = true;
  }
}
function showPh(R, kind, txt){
  const ph = $("edph"); Object.assign(ph.style, px(cellRect(R))); ph.className = kind; ph.hidden = false;
  ph.firstChild.textContent = txt || "";
}
function edUp(){
  const D = EDIT.drag; EDIT.drag = null;
  document.body.classList.remove("ed-drag"); $("edph").hidden = true; $("edghost").hidden = true;
  if (!D) return;
  if (D.k === "mv"){
    const s = D.s, pg = curPg(), g = RG(s, pg);
    if (D.to && D.to.k === "move" && (D.to.R.x !== g.x || D.to.R.y !== g.y)){ remember(); touch(pg); Object.assign(RG(s, pg), D.to.R); relayout(); return; }
    if (D.to && D.to.k === "swap"){       // the two boxes trade places (and sizes)
      remember(); touch(pg); const A = RG(s, pg), B = RG(D.to.with, pg), a = {x:A.x, y:A.y, w:A.w, h:A.h};
      Object.assign(A, {x:B.x, y:B.y, w:B.w, h:B.h}); Object.assign(B, a); relayout(); return;
    }
    edPaint(true); return;
  }
  if (D.k === "rs"){
    const g = RG(D.s) || {};
    if (JSON.stringify(D.orig) !== JSON.stringify({x:g.x, y:g.y, w:g.w, h:g.h})){
      EDIT.hist.push(D.snap); EDIT.fut = []; relayout();
    } else edPaint(true);
    return;
  }
  if (D.k === "tile"){
    if (!D.started) return addTileAnywhere(D.type);          // a tap on a tile in the list
    if (!D.to) return;
    if (D.to.k === "into") addTile(D.type, D.to.s);
    else addTile(D.type, {rect:D.to.R});
  }
}
addEventListener("pointermove", e => { if (EDIT.on) edMove(e); });
addEventListener("pointerup", e => { if (EDIT.on) edUp(e); });
addEventListener("pointercancel", e => { if (EDIT.on) edUp(e); });
// on a touch screen the browser may take a drag for a scroll and cancel it; while something is being dragged, keep the gesture ours
document.addEventListener("touchmove", e => { if ((EDIT.drag || (EDIT.focus && EDIT.focus.drag)) && e.cancelable) e.preventDefault(); }, {passive:false, capture:true});
// a long press would open the browser's menu (and cancel the touch) instead of picking up a tile
document.addEventListener("contextmenu", e => e.preventDefault());
// the screen's shell reloads the dashboard when its files change; not while you're in the middle of editing
window.shellBusy = () => !!EDIT.on;
// an older shell page can't wait like that: reload it once to get the new one
if (FRAMED){ try{ if (!(window.top.SHELL_V >= 4) && !sessionStorage.getItem("shellV4")){ sessionStorage.setItem("shellV4", "1"); window.top.location.reload(); } }catch(e){} }
addEventListener("keydown", e => {
  if (!EDIT.on) return;
  if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key;
  if (mod && (k === "z" || k === "Z")){ e.preventDefault(); undo(e.shiftKey ? -1 : 1); return; }
  if (mod && k === "y"){ e.preventDefault(); undo(-1); return; }
  if (mod && k === "s"){ e.preventDefault(); editExit(true); return; }
  if (k === "Escape"){ if (EDIT.panel){ EDIT.panel = null; EDIT.addTo = null; edPaint(true); } else if (EDIT.sel){ EDIT.sel = null; EDIT.tile = null; edPaint(true); } return; }
  const s = selSlot(); if (!s) return;
  if (k === "Delete" || k === "Backspace"){ e.preventDefault(); removeBox(s); return; }
  const dv = {ArrowLeft:[-1, 0], ArrowRight:[1, 0], ArrowUp:[0, -1], ArrowDown:[0, 1]}[k]; if (!dv) return;
  e.preventDefault();
  const g = RG(s); if (!g) return;
  const [mw, mh] = bmin(s), R = {x:g.x, y:g.y, w:g.w, h:g.h};
  if (e.shiftKey){ R.w += dv[0]; R.h += dv[1]; if (R.w < mw || R.h < mh) return; }
  else { R.x += dv[0]; R.y += dv[1]; }
  if (!inGrid(R) || blocked(curPg(), R, s)) return;
  remember(); touch(curPg()); Object.assign(RG(s), R); relayout();
});


// hold a tile for ~0.7 s to start editing with it selected (like an iPhone home screen); in the Controls preview a plain tap does it
let holdT = null, holdAt = null;
document.addEventListener("pointerdown", e => {
  if (EDIT.on || SOLO) return;
  if (e.target.closest("input,textarea,select,button,a,[contenteditable],[data-ha]")) return;   // fields and controls never start edit mode
  const c = e.target.closest("[data-mod],.slot"); if (!c) return;
  holdAt = [e.clientX, e.clientY];
  clearTimeout(holdT); holdT = setTimeout(() => { holdT = null; editEnter(c.dataset.mod || null); }, 700);
}, true);
document.addEventListener("pointermove", e => { if (holdT && holdAt && Math.hypot(e.clientX - holdAt[0], e.clientY - holdAt[1]) > 12){ clearTimeout(holdT); holdT = null; } }, true);
document.addEventListener("pointerup", e => {
  if (!holdT) return;
  clearTimeout(holdT); holdT = null;
  if (PREVIEW && !EDIT.on){ const c = e.target.closest("[data-mod]"); if (c) editEnter(c.dataset.mod); }
}, true);

