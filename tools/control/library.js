/* ---------- Library: every layout (saved and built in) and every tile type, full screen over Controls ----------
   A layout can be tried on the screen for two minutes, or shared as a small .countertop file or share code.
   Shared layouts are plain data: which calendars, lists and other sources a tile uses, and settings marked
   share:false in a tile file (your own text, picture links), are left out; whoever opens the file picks their own. */
const LIB = {view:"layouts", item:"", sub:[], trial:"", pvq:"", pick:"", q:"", addTo:"main", chip:"all", look:true, slots:{}, imp:null, impErr:"", pvKey:"", pvId:"", trialEnd:0, share:{name:"", desc:""}};
const LIB_CATS = ["Time", "Weather", "Calendar", "Lists & food", "Home", "Sports", "Photos & video", "Around you", "Money", "Fun", "Your own"];
let DEFS = {};            // tile type -> its definition (title, cat, desc, size, settings), read from the tile files
const defsLoad = fetch("/tiles.js").then(r => r.text()).then(txt => {
  const keep = (t, d) => { DEFS[t] = Object.assign({cat:"Fun", size:[12, 8, 8, 6], settings:{}}, d); };
  for (const part of txt.split(/\/\* ---- tiles\/[\w.-]+ ---- \*\//)){        // one file at a time, so one odd file can't hide the rest
    if (part.trim()) try{ new Function("Tile", "viewTile", part)(keep, keep); }catch(e){}
  }
}).catch(() => {});
const libEl = () => $("lib");
const LIB_SUB = {themes:"looks", effects:"effects"};       // Library views that show Controls' own screens, and the first screen of each
const libSub = () => !!LIB_SUB[LIB.view] && !libEl().hidden;
function libOpen(view){
  LIB.view = view || "layouts"; LIB.item = ""; LIB.q = ""; LIB.chip = "all"; LIB.sub = LIB_SUB[LIB.view] ? [LIB_SUB[LIB.view]] : []; LIB.pvq = null;      // null: the preview frame loads again even though closing left it on about:blank
  libEl().hidden = false; document.body.classList.add("libopen");
  defsLoad.then(libShow); libShow();
}
function libClose(){
  LIB.pick = ""; LIB.impRaw = null; DRAFT = null; if (FXDRAFT || LIB.fimp){ FXDRAFT = null; LIB.fimp = null; fxRegister(); } LIB.timp = null; LIB.trial = ""; LIB.pvq = ""; LIB.sub = [];
  libEl().hidden = true; document.body.classList.remove("libopen");
  LIB.item = ""; LIB.pvKey = ""; const f = libEl().querySelector(".lbig iframe"); if (f){ f.src = "about:blank"; f.classList.remove("on"); }
}
function libGo(view, item){ if (view !== LIB.view || !LIB.sub.length) LIB.sub = LIB_SUB[view] ? [LIB_SUB[view]] : []; LIB.view = view; LIB.item = item || ""; libShow(); libEl().querySelector(".lmain").scrollTop = 0; }

// the layouts on offer: [key, choice]; keys are starter ids, "saved:<page id>" or "import"
const libBuiltIn = () => Object.entries(STARTERS).filter(([, s]) => (!s.grid || LIB.pick) && (!s.needs || schema[s.needs]));      // empty grids only when picking for a page
const libSaved = () => savedList().map(p => ["saved:" + p.id, choiceOf("saved:" + p.id)]);
function libMatch(c){
  const q = LIB.q.trim().toLowerCase();
  return !q || (c.name + " " + (c.sub || "")).toLowerCase().includes(q);
}
function libPic(key){
  const c = choiceOf(key);
  if (c && c.page) return pagePic(c.page, c.look ? Object.assign(lookVals(curLook()), c.look) : null, "page");
  return starterPicture(key);
}
function libCard(key, c, badge){
  return '<button class="lc" data-l="open" data-id="' + esc(key) + '">' + libPic(key) + (badge ? '<span class="lbadge">' + esc(badge) + '</span>' : "") +
    '<span class="tx"><b>' + esc(c.name) + '</b><small>' + esc(c.sub || "") + '</small></span></button>';
}
function libRail(){
  const item = (v, label, n) => '<button data-l="view" data-id="' + v + '"' + (LIB.view === v ? ' class="on"' : "") + '>' + label + (n != null ? '<small>' + n + '</small>' : "") + '</button>';
  return '<button class="lback" data-l="close">‹ Controls</button><h1>Library</h1>' +
    item("layouts", "Layouts", libBuiltIn().length + savedList().length) + item("tiles", "Tiles", Object.keys(DEFS).length || "") +
    item("themes", "Themes", looks().length + 1 + THEMELIB.listed(themesInUse(), SHOW_CLASSIC).length) + item("effects", "Effects", FXLIB.L.filter(d => !(FXDRAFT && FXDRAFT.isNew && d.id === FXDRAFT.id) && fxC(d.id).on).length + " on") +
    '<div class="lsep">Yours</div>' + item("mine", "My layouts", savedList().length) +
    '<div class="lsep">Make</div>' + '<button data-l="s-new"' + (LIB.view === "studio" ? ' class="on"' : "") + '>Tile Studio</button>' + '<button data-l="s-theme"' + (libSub() && LIB.sub[LIB.sub.length - 1] === "tstudio" ? ' class="on"' : "") + '>Theme Studio</button>' + item("share", "Share a layout") + item("import", "Import a file") +
    '<div class="lsep">Community</div>' + item("community", "Browse community", COMM.data && commUpdates() ? commUpdates() + " new" : null);
}
// Add page and Change layout open the Library to pick: a bar says what the pick is for
function libPickBar(){
  if (!LIB.pick) return "";
  return '<div class="lpick"><div><b>' + (LIB.pick === "main" ? "Pick a new layout for Main" : "Pick a layout for a new page") + '</b><small>' +
    (LIB.pick === "main" ? "Main's current layout is kept in My layouts, so you can switch back." : "A dashboard, a full-screen page or an empty grid.") + '</small></div><button class="lbtn" data-l="close">Cancel</button></div>';
}
function libLayouts(){
  const mineOnly = LIB.view === "mine";
  let h = libPickBar() + '<div class="ltop"><input type="search" data-l="q" placeholder="Search layouts" value="' + esc(LIB.q) + '">' +
    '<button class="lbtn" data-l="view" data-id="import">Import a file</button>' + (LIB.pick ? "" : '<button class="lbtn pri" data-l="savemain">Save current Main</button>') + '</div>';
  if (!mineOnly) h += '<div class="lchips">' + [["all", "All"], ["mine", "Saved"], ["dash", "Dashboards"], ["full", "Full screen"]].concat(LIB.pick ? [["grid", "Empty grids"]] : []).map(([k, l]) =>
    '<button class="lchip' + (LIB.chip === k ? " on" : "") + '" data-l="chip" data-id="' + k + '">' + l + '</button>').join("") + '</div>';
  const S = libSaved().filter(([, c]) => libMatch(c));
  if (mineOnly || LIB.chip === "all" || LIB.chip === "mine"){
    h += '<div class="lh">My layouts</div>';
    h += S.length ? '<div class="lgrid">' + S.map(([k, c]) => libCard(k, c, c.page.at ? new Date(c.page.at).toLocaleDateString(undefined, {month:"short", day:"numeric"}) : "")).join("") + '</div>'
      : '<div class="lempty">' + (LIB.q ? "No saved layouts match." : "Nothing saved yet. Save current Main keeps a copy here, and so does changing Main's layout.") + '</div>';
  }
  if (!mineOnly) for (const [g, label] of [["dash", "Built in"], ["full", "Full screen"], ["grid", "Empty grids"]]){
    if (LIB.chip !== "all" && LIB.chip !== g) continue;
    const L = libBuiltIn().filter(([, s]) => starterGroup(s) === g && libMatch(s));
    if (L.length) h += '<div class="lh">' + label + '</div><div class="lgrid">' + L.map(([k, c]) => libCard(k, c, g === "full" ? "Full screen" : "")).join("") + '</div>';
  }
  return h;
}
function libTiles(){
  let h = '<div class="ltop"><input type="search" data-l="q" placeholder="Search tiles" value="' + esc(LIB.q) + '"></div>' + (LIB.q ? "" : stuTilesTop());
  const cats = LIB_CATS.concat([...new Set(Object.values(DEFS).map(d => d.cat))].filter(c => !LIB_CATS.includes(c)));
  h += '<div class="lchips">' + ["All"].concat(cats.filter(c => Object.values(DEFS).some(d => d.cat === c && !d.hidden))).map(c =>
    '<button class="lchip' + ((LIB.chip === "all" ? "All" : LIB.chip) === c ? " on" : "") + '" data-l="chip" data-id="' + esc(c === "All" ? "all" : c) + '">' + esc(c) + '</button>').join("") + '</div>';
  if (!Object.keys(DEFS).length) return h + '<div class="lempty">Loading the tiles…</div>';
  const q = LIB.q.trim().toLowerCase();
  for (const c of cats){
    if (LIB.chip !== "all" && LIB.chip !== c) continue;
    const L = Object.entries(DEFS).filter(([t, d]) => d.cat === c && t !== "nightclock" && !d.hidden && (!q || (d.title + " " + (d.desc || "")).toLowerCase().includes(q)));
    if (!L.length) continue;
    h += '<div class="lh">' + esc(c) + '</div><div class="lgrid tiles">' + L.map(([t, d]) => {
      const used = tileList().filter(x => x.type === t).length;
      return '<button class="lc ltile" data-l="open" data-id="tile:' + t + '">' + libTileShot(t, d) +
        '<span class="ladd" data-l="addtile" data-id="' + t + '" role="button" title="Add to ' + esc(libAddName()) + '">+ Add</span>' +
        '<span class="tx"><b>' + esc(d.title || t) + '</b><small class="clamp">' + esc(d.desc || "") + '</small>' + (used ? '<span class="ltag">In use</span>' : "") + '</span></button>';
    }).join("") + '</div>';
  }
  return h;
}
// a community tile in the Library: where it came from, and where to update or remove it
function libCommunityRow(t, d){
  const g = d.gallery;
  if (d.revoked) return '<div class="lpick warn"><div><b>Taken down from the community gallery</b><small>It\'s off on your screens. Remove it to clear its boxes.</small></div><button class="lbtn" data-l="c-open" data-id="' + esc(g.id) + '">Remove</button></div>';
  if (g) return '<div class="lpanel"><div class="lrow"><div class="t">Downloaded from the community gallery<small>See what it can do, update it or remove it in Community.</small></div><button class="lbtn" data-l="c-open" data-id="' + esc(g.id) + '">Open in Community</button></div></div>';
  return '<div class="lpanel"><div class="lrow"><div class="t">Added to the data folder by hand<small>Not from the gallery, so it isn\'t checked for updates or take-downs.</small></div></div></div>';
}
// a live example of a tile with made-up data (the dashboard's ?solo=<type>), its own box scaled to fit the card
function libTileShot(t, d, big){
  const [w, h] = d.size || [12, 8];
  if (ECHO && !big) return '<span class="tp"><span class="tpname">' + esc(d.title || t) + '</span></span>';
  return '<span class="tp' + (big ? " big" : "") + '"><iframe tabindex="-1" aria-hidden="true" data-w="' + w + '" data-h="' + h + '" data-src="/dash/content?preview=1&solo=' + t + (big ? "" : "&still=1") + '"></iframe></span>';
}
// where a w x h tile really sits in the (landscape) preview page: inside its 36/22px margins, on a 48 x 32 grid with 16px gaps
function libTileRect(w, h){
  const [sw, sh] = screenSz.split("x").map(Number), cw = (sw - 72 - 47 * 16) / 48, ch = (sh - 22 - 26 - 31 * 16) / 32;
  w = Math.max(1, Math.min(48, w)); h = Math.max(1, Math.min(32, h));
  return {x:36, y:22, w:w * cw + (w - 1) * 16, h:h * ch + (h - 1) * 16};
}
function libFitShots(){
  const root = libEl().querySelector(".lmain");
  if (libFitShots.io) libFitShots.io.disconnect();
  const io = libFitShots.io = "IntersectionObserver" in window ? new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting && !e.target.src){ e.target.src = e.target.dataset.src; io.unobserve(e.target); } }), {root, rootMargin:"300px"}) : null;
  libEl().querySelectorAll(".tp iframe").forEach(f => {
    const box = f.parentNode, r = libTileRect(+f.dataset.w || 12, +f.dataset.h || 8);
    const k = Math.min(box.clientWidth / r.w, box.clientHeight / r.h) * .94;    // a little air around the tile
    f.style.transform = "translate(" + (box.clientWidth - r.w * k) / 2 + "px," + (box.clientHeight - r.h * k) / 2 + "px) scale(" + k + ") translate(" + -r.x + "px," + -r.y + "px)";
    if (!f.src){ if (io) io.observe(f); else f.src = f.dataset.src; }
  });
}
function libTileItem(t){
  const d = DEFS[t]; if (!d) return '<div class="lempty">That tile isn\'t available.</div>';
  const S = d.settings || {}, kinds = [...new Set(Object.values(S).filter(s => s.type === "source").map(s => s.kind))];
  const labels = Object.values(S).filter(s => s.label && s.type !== "source").map(s => s.label);
  const used = tileList().filter(x => x.type === t).length, sz = d.size || [12, 8, 8, 6];
  return '<button class="lback" data-l="view" data-id="tiles">‹ Tiles</button><div class="ldet"><div>' + libTileShot(t, d, true) + '</div><div>' +
    '<h2 class="ltitle">' + esc(d.title || t) + '</h2><div class="lsub">' + esc(d.cat) + (d.mine ? " · yours" : d.community ? (d.author ? " · by " + esc(d.author) : "") + " · version " + (d.version || 1) : ' · built in') + '</div>' +
    '<p class="ldesc">' + esc(d.desc || "") + '</p>' + (d.mine ? stuRow(t, d) : d.community ? libCommunityRow(t, d) : "") +
    '<div class="lpanel">' + (kinds.length ? '<div class="lrow"><div class="t">Uses your ' + esc(kinds.map(k => (KINDS[k] ? KINDS[k].title : k).toLowerCase()).join(" and ")) + '<small>Set up once in Controls, then pick them in the tile\'s settings</small></div></div>' : "") +
      '<div class="lrow"><div class="t">Sizes<small>Starts at ' + sz[0] + ' × ' + sz[1] + ' on the 48 × 32 grid, and can be as small as ' + (sz[2] || sz[0]) + ' × ' + (sz[3] || sz[1]) + '</small></div></div>' +
      (labels.length ? '<div class="lrow"><div class="t">Settings<small>' + esc(labels.slice(0, 8).join(" · ")) + (labels.length > 8 ? " …" : "") + '</small></div></div>' : "") +
      '<div class="lrow"><div class="t">' + (used ? "On your dashboard" : "Not on your dashboard yet") + '<small>' + (used ? used + (used === 1 ? " tile" : " tiles") + " of this kind" : "Add it to any box in the editor") + '</small></div></div></div>' +
    '<label class="lfield">Add it to<select data-l="addto">' + [["main", "Main"]].concat(cpList().map(p => [p.id, p.name])).map(([v, l]) =>
      '<option value="' + esc(v) + '"' + (v === LIB.addTo ? " selected" : "") + '>' + esc(l) + '</option>').join("") + '</select></label>' +
    '<div class="lact"><button class="lbtn pri" data-l="addtile" data-id="' + esc(t) + '">Add ' + esc(d.title || t) + '</button></div>' +
    '<p class="lnote">It goes in an empty spot on that page' + (ECHO ? ", then the editor opens so you can move it and change its settings." : ", and the editor opens on it so you can move it, resize it and change its settings.") + '</p></div></div>';
}

/* ----- one layout: a live preview with your own weather, calendars and lists, then put it on Main or add it as a page ----- */
const libHasLook = key => { const c = choiceOf(key); return !!(c && c.look && Object.keys(c.look).length); };
function libTrialBody(key){
  const real = mods; mods = JSON.parse(JSON.stringify(real));
  try{
    installStarter(key, true, LIB.look && libHasLook(key));
    const look = Object.assign(lookVals(usedLook()), {use:""});        // the theme it would show, as the trial's own colors
    return {pages:gpAll(), tiles:tileList(), look, name:(choiceOf(key) || {}).name || "Layout"};
  }finally{ mods = real; }
}
async function libPreview(key){
  const box = libEl().querySelector(".lbig"); if (!box || ECHO) return;
  const want = key + "|" + LIB.look + "|" + JSON.stringify(LIB.slots);
  const f = box.querySelector("iframe"), fit = () => scrFit(f, box.clientWidth);
  fit();
  if (want === LIB.pvKey && LIB.pvId){ f.src = "/dash/content?preview=1&trial=" + LIB.pvId; return; }
  LIB.pvKey = want;
  try{
    const r = await fetch("/trial", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(libTrialBody(key))});
    const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.status);
    if (LIB.pvKey !== want) return;
    LIB.pvId = j.id; f.onload = () => setTimeout(() => f.classList.add("on"), 900);
    f.src = "/dash/content?preview=1&trial=" + j.id;
  }catch(e){ LIB.pvKey = ""; }
}
// community tiles a layout uses that aren't downloaded yet: each can be opened in Community; otherwise its box is left out
function libNeedRows(imp){
  if (!imp || !(imp.need || []).length) return "";
  const name = n => { const e = COMM.data && COMM.data.items.find(x => x.id === n.id); return e ? e.name : n.type; };
  return '<div class="lpanel"><div class="lrow"><div class="t">Uses community tiles you haven\'t downloaded<small>Download them first to keep their boxes; otherwise those boxes are left out.</small></div></div>' +
    imp.need.map(n => '<div class="lrow"><div class="t">' + esc(name(n)) + '</div><button class="lbtn" data-l="c-open" data-id="' + esc(n.id) + '">Open in Community</button></div>').join("") + '</div>';
}
function libSlotRows(){
  const imp = LIB.imp; if (!imp || !imp.kinds.length) return "";
  return '<div class="lpanel"><h3>Fill in from your setup</h3>' + imp.kinds.map(k => {
    const K = KINDS[k] || {title:k, one:k}, L = SRC[k] || [], multi = imp.multi.includes(k);
    if (!L.length) return '<div class="lrow"><div class="t">' + esc(K.title) + '<small>You haven\'t set up any ' + esc(K.title.toLowerCase()) + ' yet. Those tiles stay empty until you do.</small></div><button class="lnk" data-l="setup" data-id="' + k + '">Set up</button></div>';
    const cur = LIB.slots[k] != null ? LIB.slots[k] : multi ? "all" : L[0].id;
    return '<div class="lrow"><div class="t">' + esc(K.title) + '<small>For ' + esc(imp.uses[k].join(", ")) + '</small></div><select data-l="slot" data-id="' + k + '">' +
      (multi ? '<option value="all">All ' + esc(K.title.toLowerCase()) + '</option>' : "") +
      L.map(x => '<option value="' + esc(x.id) + '"' + (x.id === cur ? " selected" : "") + '>' + esc(x.name) + '</option>').join("") +
      (multi ? "" : '<option value=""' + (cur === "" ? " selected" : "") + '>None</option>') + '</select></div>';
  }).join("") + '</div>';
}
function libLayoutItem(key){
  const c = choiceOf(key); if (!c) return '<div class="lempty">That layout isn\'t here any more.</div>';
  const saved = key.startsWith("saved:"), imp = key === "import";
  const p = saved ? c.page : null, nT = saved ? [].concat(...p.slots.map(smods)).length : 0;
  let h = libPickBar() + '<button class="lback" data-l="view" data-id="' + (imp ? "import" : LIB.view) + '">‹ ' + (imp ? "Import" : LIB.view === "mine" ? "My layouts" : "Layouts") + '</button>';
  h += '<div class="ldet"><div><div class="lbig' + (displayMode === "auto" ? "" : " port") + '">' + libPic(key) + (ECHO ? "" : '<iframe tabindex="-1" aria-hidden="true" title="Live preview"></iframe>') + '</div>' +
    (ECHO ? "" : '<p class="lnote">Live preview with your own weather, calendars and lists.</p>') + '</div><div>';
  if (saved) h += '<input class="lname" type="text" data-l="rename" data-id="' + p.id + '" value="' + esc(p.name) + '" aria-label="Name">' +
    '<div class="lsub">Saved ' + (p.at ? new Date(p.at).toLocaleDateString(undefined, {month:"long", day:"numeric"}) : "earlier") + ' · ' + nT + (nT === 1 ? " tile" : " tiles") + '</div>';
  else h += '<h2 class="ltitle">' + esc(c.name) + '</h2><div class="lsub">' + (imp ? "From a shared file" + (LIB.imp.made ? " · made " + esc(LIB.imp.made) : "") : c.full ? "Full screen · built in" : c.grid ? "Empty grid" : "Built in") + '</div>';
  h += '<p class="ldesc">' + esc(imp ? LIB.imp.desc : saved ? pageSummary(p) : c.sub) + '</p>';
  if (imp){
    h += libSlotRows();
    const warn = [];
    if (LIB.imp.skipped.length) warn.push(["Left out", "Tiles this Countertop doesn't have: " + LIB.imp.skipped.join(", ")]);
    h += libNeedRows(LIB.imp);
    if ((LIB.imp.mine || []).length) warn.push(["Comes with " + LIB.imp.mine.length + (LIB.imp.mine.length === 1 ? " tile" : " tiles") + " someone made: " + LIB.imp.mine.map(x => x.tile.name || x.type).join(", "),
      "They're added to your tiles in Library → Tiles when you use this layout, and their code doesn't run until you let it. Each runs sealed off, like a community tile."]);
    if (LIB.imp.code) warn.push(["Has a tile with its own code", "Its code won't run until you tap Run on the tile. It can't see the rest of the dashboard, and it can only reach secure https:// addresses, not plain http:// ones like most devices on your home network."]);
    if (warn.length) h += '<div class="lpanel">' + warn.map(([t, s]) => '<div class="lrow"><div class="t">' + esc(t) + '<small>' + esc(s) + '</small></div></div>').join("") + '</div>';
  }
  if (libHasLook(key)){ const tn = layoutThemeName(key, c);
    h += '<div class="lpanel"><div class="lrow"><div class="t">Comes with the ' + esc(tn) + ' theme<small>' + (LIB.look ? (lookById(layoutTheme(key, c).id) || layoutTheme(key, c).id === "default" ? "On: switches to " + esc(tn) + ", which you already have." : "On: adds " + esc(tn) + " to your themes and shows it. " + esc(lookName(curLook())) + " stays as it is.") : "Off: keeps " + esc(lookName(curLook()))) + '</small></div>' + sw(LIB.look, 'data-l="look"') + '</div></div>'; }
  h += '<div class="lact">' + (LIB.pick === "page" ? "" : '<button class="lbtn pri" data-l="use" data-id="main">Use on Main</button>') +
    (LIB.pick === "main" ? "" : '<button class="lbtn' + (LIB.pick === "page" ? " pri" : "") + '" data-l="use" data-id="page">Add as a new page</button>') + '</div>';
  h += '<div class="lact"><button class="lbtn ghost" data-l="try">' + (LIB.trialEnd > Date.now() ? "Stop trying it on the screen" : "Try it on the screen for 2 minutes") + '</button></div>';
  if (imp) h += '<div class="lact"><button class="lbtn" data-l="keep">Save to My layouts</button></div>';
  if (saved) h += '<div class="lact"><button class="lbtn" data-l="dup" data-id="' + p.id + '">Duplicate</button><button class="lbtn" data-l="view" data-id="share" data-item="saved:' + p.id + '">Share</button><button class="lbtn red" data-l="del" data-id="' + p.id + '">Delete</button></div>';
  h += '<p class="lnote">' + (saved || imp ? "Use on Main keeps your current Main in My layouts first, so you can switch back." : LIB.pick === "page" ? "Main stays as it is." : "Your current Main is kept in My layouts first, so you can switch back any time.") + '</p>';
  return h + '</div></div>';
}

/* ----- sharing: a layout as a small file ----- */
const LIB_FMT = 1;
function libPack(p, look, name, desc){
  const flags = new Set();
  const boxes = (p.slots || []).map(sl => {
    const tiles = smods(sl).map(id => tileList().find(t => t.id === id)).filter(Boolean).map(t => {
      const S = (DEFS[t.type] || {}).settings || {}, s = {};
      for (const k in t.settings || {}){
        const d = S[k];
        if (k === "design"){ s.design = t.settings.design; continue; }
        if (!d || k[0] === "@") continue;          // a control tile's devices are this home's own
        if (d.type === "secret") continue;       // an API key is kept by the server; never in a layout
        if (d.type === "source"){ flags.add("src"); continue; }
        if (d.type === "entity"){ flags.add("ha"); continue; }
        if (d.share === false){ if (d.type === "text" || d.type === "list") flags.add("own"); continue; }
        if (d.type === "code" && t.settings[k]) flags.add("code");
        s[k] = t.settings[k];
      }
      const o = {type:t.type, settings:s}; if (t.name) o.name = t.name;
      // a community tile: where to get it, never its code
      const g = (DEFS[t.type] || {}).community && DEFS[t.type].gallery; if (g) o.from = {id:g.id, v:g.v};
      // a tile made in Tile Studio: its code goes with it, and waits for Run wherever it's opened
      if ((DEFS[t.type] || {}).mine && MINEC[t.type]){ const T = MINEC[t.type]; o.tile = {countertop:"tile"};
        for (const k of ["id", "version", "name", "description", "author", "size", "uses", "feeds", "hosts", "taps", "every", "settings", "devices", "controls", "demo", "demoData", "lang", "code"]) if (T[k] !== undefined) o.tile[k] = T[k];
        flags.add("code"); }
      return o;
    });
    const b = {x:sl.x, y:sl.y, w:sl.w, h:sl.h, tiles};
    if (tiles.length > 1) b.every = sl.every || 45;
    return b;
  });
  const lk = themePortable(look || {});
  return {pkg:{countertop:"layout", format:LIB_FMT, name, description:desc || "", made:new Date().toISOString().slice(0, 10), look:lk, pages:[{name, boxes}]}, flags};
}
const b64enc = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64dec = s => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));
const libCode = pkg => "CT1." + b64enc(JSON.stringify(pkg));
function libShareTarget(){
  const id = LIB.shareOf || "main";
  if (id === "main") return {p:gpAll().find(x => x.id === "main"), look:lookSnap(), name:"Main"};
  const sp = savedById(id.replace(/^saved:/, ""));
  return sp ? {p:sp, look:sp.look || lookSnap(), name:sp.name} : null;
}
function libShare(){
  const T = libShareTarget(); if (!T) return '<div class="lempty">That layout isn\'t here any more.</div>';
  if (LIB.share.of !== LIB.shareOf){ LIB.share = {of:LIB.shareOf, name:T.name === "Main" ? "My dashboard" : T.name, desc:""}; }
  const {pkg, flags} = libPack(T.p, T.look, LIB.share.name.trim() || "Shared layout", LIB.share.desc.trim());
  const opts = [["main", "Main right now"]].concat(savedList().map(p => ["saved:" + p.id, p.name]));
  let h = '<h2 class="ltitle">Share a layout</h2><p class="ldesc">Make a small file of a layout to send to a friend or keep as a backup. They open it in Library › Import a file.</p>';
  h += '<div class="ldet"><div><div class="lbig">' + pagePic(T.p, Object.assign(lookVals(curLook()), T.look), "page") + '</div>' +
    '<div class="lpanel"><h3>Left out automatically</h3>' +
    [["Which calendars, lists and teams it uses", "Whoever opens it picks their own", flags.has("src")], ["Your own text", "Notes, countdown dates, picture links and Home Assistant names", flags.has("own")],
      ["Home Assistant devices", "They're different in every home", flags.has("ha")], ["Calendar links, list items, photos", "Never part of a layout", true]]
      .filter(x => x[2]).map(([t, s]) => '<div class="lrow"><span class="lok">✓</span><div class="t">' + t + '<small>' + s + '</small></div></div>').join("") +
    (flags.has("code") ? '<div class="lrow"><span class="lok warn">!</span><div class="t">Includes a tile\'s own code<small>Read it over if it holds anything private</small></div></div>' : "") + '</div></div><div>' +
    '<label class="lfield">Layout<select data-l="shareof">' + opts.map(([v, l]) => '<option value="' + esc(v) + '"' + (v === (LIB.shareOf || "main") ? " selected" : "") + '>' + esc(l) + '</option>').join("") + '</select></label>' +
    '<label class="lfield">Name<input type="text" data-l="sharename" maxlength="80" value="' + esc(LIB.share.name) + '"></label>' +
    '<label class="lfield">What it\'s for<textarea data-l="sharedesc" maxlength="500" placeholder="A month view beside the family agenda, for busy weeks.">' + esc(LIB.share.desc) + '</textarea></label>' +
    '<div class="lact">' + (ECHO ? "" : '<button class="lbtn pri" data-l="download">Download file</button>') + '<button class="lbtn' + (ECHO ? " pri" : "") + '" data-l="copy">Copy share code</button><button class="lbtn" data-l="gsubmit">Submit to the gallery</button></div>' +
    '<label class="lfield">Share code<textarea class="code" readonly data-l="codebox" rows="4">' + esc(libCode(pkg)) + '</textarea></label>' +
    '<p class="lnote">A share code is the same layout as text, for pasting into a message. Submit to the gallery opens the community gallery\'s form with this code filled in; it\'s checked right away and reviewed before it appears.</p></div></div>';
  return h;
}
function libDownload(){
  const T = libShareTarget(); if (!T) return;
  const name = LIB.share.name.trim() || "Shared layout", {pkg} = libPack(T.p, T.look, name, LIB.share.desc.trim());
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(pkg, null, 1)], {type:"application/json"}));
  a.download = (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "layout") + ".countertop";
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function libCopy(){
  const box = libEl().querySelector('[data-l="codebox"]'); if (!box) return;
  try{ await navigator.clipboard.writeText(box.value); }
  catch(e){ box.select(); try{ document.execCommand("copy"); }catch(e2){} }      // plain http on the home network has no clipboard API
  toast("Share code copied", "ok");
}

/* ----- importing: check everything in the file against the tile files and the look's settings ----- */
const COLOR = /^#[0-9a-f]{3,8}$/i;
function libClean(d, v){
  if (!d) return undefined;
  if (d.type === "bool") return typeof v === "boolean" ? v : undefined;
  if (d.type === "int" || d.type === "number"){
    let n = +v; if (typeof v !== "number" && typeof v !== "string" || !isFinite(n)) return undefined;
    if (d.type === "int") n = Math.round(n);
    if (d.min != null) n = Math.max(d.min, n); if (d.max != null) n = Math.min(d.max, n);
    return n;
  }
  if (d.type === "choice") return (d.choices || []).some(c => String(Array.isArray(c) ? c[0] : c).toLowerCase() === String(v).toLowerCase()) ? v : undefined;
  if (d.type === "color") return typeof v === "string" && COLOR.test(v) ? v : undefined;
  if (d.type === "list") return Array.isArray(v) ? v.filter(x => typeof x === "string").slice(0, 60).map(x => x.slice(0, 200)) : undefined;
  if (d.type === "text") return typeof v === "string" ? v.slice(0, 2000) : undefined;
  if (d.type === "code") return typeof v === "string" ? v.slice(0, 200000) : undefined;
  return undefined;          // sources, Home Assistant entities and anything new: never taken from a file
}
// saved tile designs are positions, sizes, fonts and colors: numbers and short plain words only (nothing that could load a page)
function libDesign(v, depth = 0){
  if (!v || typeof v !== "object" || Array.isArray(v) || depth > 4) return undefined;
  const o = {};
  for (const k in v){
    if (!/^\w{1,30}$/.test(k)) continue;
    const x = v[k];
    if (typeof x === "number" && isFinite(x) || typeof x === "boolean") o[k] = x;
    else if (typeof x === "string" && /^[\w #.,%()\-]{0,60}$/.test(x)) o[k] = x;
    else if (x && typeof x === "object"){ const c = libDesign(x, depth + 1); if (c) o[k] = c; }
  }
  return o;
}
// a .countertop file or share code: {countertop: "layout" | "theme" | "effect", format, name, ...}
function libParse(text){
  text = String(text || "").trim();
  let j;
  try{ j = JSON.parse(/^CT1\./.test(text) ? b64dec(text.slice(4).replace(/\s+/g, "")) : text); }
  catch(e){ throw new Error("That isn't a Countertop file or share code."); }
  if (!j || !["layout", "theme", "effect"].includes(j.countertop)) throw new Error("That isn't a Countertop layout, theme or effect.");
  if (+j.format > LIB_FMT) throw new Error("This " + j.countertop + " was made by a newer Countertop. Update Countertop to open it.");
  return j;
}
function libRead(j){
  const pg = Array.isArray(j.pages) && j.pages[0];
  if (!pg || !Array.isArray(pg.boxes)) throw new Error("This layout has no page in it.");
  const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+v) || 0));
  const str = (v, n) => typeof v === "string" ? v.trim().slice(0, n) : "";
  const skipped = new Set(), uses = {}, multi = new Set(), need = new Map(), mine = new Map(); let code = false;
  const boxes = pg.boxes.slice(0, 60).map(b => {
    b = b || {};
    const x = num(b.x, 0, 47), y = num(b.y, 0, 31), w = num(b.w, 1, 48 - x), h = num(b.h, 1, 32 - y);
    const tiles = (Array.isArray(b.tiles) ? b.tiles : []).slice(0, 12).map(t => {
      const carried = t && t.tile && typeof t.tile === "object" && t.tile.countertop === "tile" && typeof t.tile.code === "string" && /^my-[a-z0-9-]{1,37}$/.test(String(t.type)) ? t.tile : null;
      // a tile someone made in Tile Studio comes with its code: always added as a new tile of yours, waiting for Run
      const def = carried ? {title:String(carried.name || t.type), settings:carried.settings && typeof carried.settings === "object" ? carried.settings : {}} :
        t && typeof t.type === "string" && Object.prototype.hasOwnProperty.call(DEFS, t.type) ? DEFS[t.type] : null;
      if (carried && !mine.has(t.type)) mine.set(t.type, {type:t.type, tile:carried, id:""});
      if (!def){
        // a community tile this Countertop hasn't downloaded: offered from Community, otherwise its box is left out
        const f = t && t.from, gid = f && typeof f.id === "string" && /^tiles\/[a-z][a-z0-9-]{1,39}$/.test(f.id) ? f.id : "";
        if (gid && gid === "tiles/" + t.type) need.set(gid, {id:gid, type:t.type});
        else if (t && t.type) skipped.add(str(String(t.type), 40));
        return null;
      }
      const S = def.settings || {}, s = {}, name = str(t.name, 60);
      for (const k in (t.settings && typeof t.settings === "object" ? t.settings : {})){
        const d = S[k], v = t.settings[k];
        if (k === "design"){ const c = libDesign(v); if (c) s.design = c; continue; }
        if (!d || d.share === false) continue;
        const c = libClean(d, v); if (c === undefined) continue;
        s[k] = c; if (d.type === "code" && c) code = true;
      }
      for (const k in S) if (S[k].type === "source"){
        (uses[S[k].kind] = uses[S[k].kind] || []).push(name || def.title || t.type);
        if (S[k].multi) multi.add(S[k].kind);
      }
      const o = {type:t.type, settings:s}; if (name) o.name = name;
      if (carried) o.tile = true;
      return o;
    }).filter(Boolean);
    const o = {x, y, w, h, tiles}; if (tiles.length > 1) o.every = num(b.every || 45, 5, 3600);
    return o;
  });
  const look = {}, LSD = (schema.look && schema.look.settings) || {};
  for (const k of LOOK_KEYS) if (!THEMELIB.LOCAL.includes(k) && j.look && j.look[k] !== undefined){ const c = libClean(LSD[k], j.look[k]); if (c !== undefined) look[k] = c; }
  for (const k in uses) uses[k] = [...new Set(uses[k])];
  return {name:str(j.name, 80) || "Shared layout", desc:str(j.description, 500), made:str(j.made, 10), look, boxes,
    skipped:[...skipped], need:[...need.values()], mine:[...mine.values()], kinds:KIND_ORDER.filter(k => uses[k]).concat(Object.keys(uses).filter(k => !KIND_ORDER.includes(k))), uses, multi:[...multi], code};
}
// a source setting in an imported tile: what was picked in "Fill in from your setup"
function libFill(type, values){
  const S = (DEFS[type] || {}).settings || {};
  for (const k in S){
    const d = S[k]; if (d.type !== "source") continue;
    const L = SRC[d.kind] || [], pick = LIB.slots[d.kind] != null ? LIB.slots[d.kind] : d.multi ? "all" : (L[0] || {}).id || "";
    values[k] = d.multi ? (pick && pick !== "all" ? [pick] : []) : pick;
  }
}
function libImport(){
  return '<h2 class="ltitle">Import a file</h2><p class="ldesc">Open a .countertop file someone shared, or paste a share code: a layout, a theme or an effect. You\'ll see it with your own weather and calendars before anything changes.</p>' +
    '<div class="lpanel lwide">' + (ECHO ? "" : '<div class="lrow"><div class="t">A file<small>Ends in .countertop</small></div><label class="lbtn">Choose a file<input type="file" accept=".countertop,.json,application/json" data-l="file" hidden></label></div>') +
    '<div class="lrow col"><div class="t">Or a share code<small>Starts with CT1.</small></div><textarea class="code" data-l="paste" rows="4" placeholder="CT1.…"></textarea>' +
    '<div class="lact"><button class="lbtn pri" data-l="openpaste">Open</button></div></div>' +
    (LIB.impErr ? '<div class="lrow"><div class="t" style="color:var(--bad)">' + esc(LIB.impErr) + '</div></div>' : "") + '</div>';
}
function libLoadImport(text){
  try{
    const j = libParse(text);
    if (j.countertop === "theme"){ LIB.timp = themeRead(j); LIB.ttrial = ""; LIB.impErr = ""; libGo("themes"); LIB.sub = ["looks", "timp"]; libShow(); return; }
    if (j.countertop === "effect"){ LIB.fimp = fxRead(j); LIB.impErr = ""; libGo("effects"); LIB.sub = ["effects", "fximp"]; libShow(); return; }
    LIB.imp = libRead(j); LIB.impRaw = j; LIB.impErr = ""; LIB.slots = {}; LIB.look = true; LIB.pvKey = "";
    libGo("import", "import");
  }catch(e){ LIB.impErr = e.message; LIB.imp = null; libGo("import"); }
}

/* ----- drawing and taps ----- */
function libShow(){
  if (libEl().hidden) return;
  if (LIB_SUB[LIB.view]){ libSubShow(); return; }
  const it = LIB.item;
  let h;
  if (LIB.view === "studio") h = stuView();
  else if (LIB.view === "community") h = it.startsWith("c:") ? commItem(it.slice(2)) : commView();
  else if (it === "import" && LIB.imp) h = libLayoutItem("import");
  else if (it.startsWith("tile:")) h = libTileItem(it.slice(5));
  else if (it) h = libLayoutItem(it);
  else if (LIB.view === "tiles") h = libTiles();
  else if (LIB.view === "share") h = libShare();
  else if (LIB.view === "import") h = libImport();
  else h = libLayouts();
  const top = libEl().querySelector(".lmain"), keep = top ? top.scrollTop : 0;
  libEl().innerHTML = '<nav class="lrail">' + libRail() + '</nav><div class="lmain">' + h + '</div>';
  libFitShots();
  if (LIB.view === "community"){ if (top && !it) libEl().querySelector(".lmain").scrollTop = keep; commAfter(); return; }
  if (it && LIB.view !== "studio" && !it.startsWith("tile:") && choiceOf(it)) libPreview(it);
}
// Themes and Effects: Controls' own screens, stacked inside the Library, beside a live preview that stays put
function libSubShow(){
  const S = LIB.sub.length ? LIB.sub : (LIB.sub = [LIB_SUB[LIB.view]]), cur = S[S.length - 1];
  if (!cur.startsWith("look:") && DRAFT) DRAFT = null;            // left Customize (Save, Cancel or back): the draft is gone
  if (!cur.startsWith("fxedit:") && FXDRAFT) FXDRAFT = null;      // the same for an effect being designed
  if (cur !== "timp") LIB.ttrial = "";
  if (!DRAFT) LIB.trial = "";
  fxRegister();
  const {h, title} = screenFor(cur);
  const side = (S.length > 1 ? '<button class="lback" data-l="sback">‹ ' + esc(backLabel(S[S.length - 2])) + '</button>' : "") +
    (h.startsWith('<div class="big">') ? "" : '<div class="big">' + esc(title) + '</div>') + h;
  const restore = scrollKeep("lib:" + cur), el = libEl(), box = el.querySelector(".lside");
  if (box){ el.querySelector(".lrail").innerHTML = libRail(); box.innerHTML = side; }      // redraw in place: the preview keeps running, and the scroll position stays (on the Echo too)
  else el.innerHTML = '<nav class="lrail">' + libRail() + '</nav><div class="lmain">' + (ECHO ? '<div class="lside">' + side + '</div>' :
    '<div class="lsplit"><div class="lside">' + side + '</div><div class="lpvcol"><div class="lbig' + (displayMode === "auto" ? "" : " port") + '"><iframe id="libpv" tabindex="-1" aria-hidden="true" title="Live preview"></iframe></div>' +
    '<p class="lnote">Your dashboard, live. Changes show here before you use them.</p></div></div>') + '</div>';
  restore();
  fxPreviews();
  libPv();
}
// the preview beside Themes and Effects: the theme being looked at, the draft while customizing, otherwise what's on the screen
function libPv(){
  const f = document.getElementById("libpv"); if (ECHO || !f || !libSub()) return;
  const cur = LIB.sub[LIB.sub.length - 1] || "";
  let q;
  if (cur.startsWith("look:")){ if (!LIB.trial){ draftPreview(true); return; } q = "&trial=" + LIB.trial + "&theme=default"; }
  else if (cur === "timp" && LIB.timp){ if (!LIB.ttrial){ themeImpTrial(); return; } q = "&trial=" + LIB.ttrial + "&theme=default"; }
  else { const want = cur.startsWith("theme:") ? cur.slice(6) : cur.startsWith("rule:") ? ((ruleById(cur.slice(5)) || {}).look || "") : ""; q = want ? "&theme=" + want : ""; }
  libPvFit();
  if (q === LIB.pvq && f.getAttribute("src")) return;       // already showing this; a fresh frame (no address yet) still loads, even for the plain "what's on the screen" preview
  LIB.pvq = q; f.onload = () => setTimeout(() => f.classList.add("on"), 700);
  f.src = "/dash/content?preview=1" + q + "&t=" + Date.now();
}
async function themeImpTrial(){
  const T = LIB.timp; if (!T) return;
  try{
    const r = await fetch("/trial", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({pages:gpAll(), tiles:tileList(), look:Object.assign(lookVals("default"), T.values), name:T.name})});
    const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.status);
    if (LIB.timp !== T) return;
    LIB.ttrial = j.id; libPv();
  }catch(e){}
}
function libPvFit(){
  const f = document.getElementById("libpv"); if (!f) return;
  scrFit(f, f.parentNode.clientWidth);
}
function libDirty(){
  if (!(DRAFT && draftDirty()) && !fxDirty()) return false;
  toast("Save or Cancel your changes first", "bad"); const b = libEl().querySelector(".draftbar"); if (b) b.scrollIntoView({block:"nearest"});
  return true;
}
async function libUse(key, onMain){
  const c = choiceOf(key); if (!c) return;
  if (c.imported && LIB.imp && (LIB.imp.mine || []).some(x => !x.id)){
    try{ await stuImportLayout(LIB.imp); }catch(e){ toast("Couldn't add its tiles: " + e.message, "bad"); return; }
  }
  const pid = installStarter(key, onMain, LIB.look && libHasLook(key));
  save(); libClose(); stack = ["root"];
  if (pid){ go("page:" + pid); if (!ECHO && c.grid) PV.editPage = pid; }        // an empty grid: straight into the editor to fill it
  else { toast("Your old Main is in My layouts", "ok"); show(); }
}
async function libTry(key){
  if (LIB.trialEnd > Date.now()){
    await fetch("/trial/stop", {method:"POST", headers:{"Content-Type":"application/json"}, body:"{}"}).catch(() => {});
    LIB.trialEnd = 0; toast("Your own layout is back on the screen", "ok"); libShow(); return;
  }
  try{
    const r = await fetch("/trial", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(Object.assign(libTrialBody(key), {screen:true, seconds:120}))});
    const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.status);
    LIB.trialEnd = Date.now() + 120e3;
    if (ECHO){ location.href = displayHref(); return; }
    toast("On the screen for 2 minutes, then your layout comes back", "ok"); libShow();
    setTimeout(() => { if (LIB.trialEnd && LIB.trialEnd <= Date.now() + 500){ LIB.trialEnd = 0; libShow(); } }, 120.5e3);
  }catch(e){ toast("Couldn't show it: " + e.message, "bad"); }
}
// a tile straight from the Library: a new box in the first empty spot big enough (its usual size, then its smallest),
// or, on a full page, a turn in the biggest box
const libAddName = () => LIB.addTo === "main" || !cpById(LIB.addTo) ? "Main" : cpById(LIB.addTo).name;
function libFreeSpot(slots, w, h){
  const used = (x, y) => slots.some(s => x < s.x + s.w && x + w > s.x && y < s.y + s.h && y + h > s.y);
  for (let y = 0; y + h <= 32; y++) for (let x = 0; x + w <= GC; x++) if (!used(x, y)) return {x, y};
  return null;
}
function libAddTile(type, pid){
  const d = DEFS[type]; if (!d) return;
  const page = gpAll().find(p => p.id === pid) || gpAll().find(p => p.id === "main");
  const settings = {};
  for (const [k, s] of Object.entries(d.settings || {})) if (s.type === "source"){ const L = SRC[s.kind] || []; settings[k] = s.multi ? [] : (L[0] || {}).id || ""; }
  const tid = type.slice(0, 6) + "_" + newUid().slice(-8), tile = {id:tid, type, settings};
  const [w, h, mw, mh] = d.size || [12, 8, 8, 6];
  let spot = null, sw = w, sh = h;
  for (const [a, b] of [[w, h], [Math.min(w, 24), Math.min(h, 16)], [mw || w, mh || h]]){ spot = libFreeSpot(page.slots || [], a, b); if (spot){ sw = a; sh = b; break; } }
  if (!spot && (page.slots || []).length){ toast((page.id === "main" ? "Main" : page.name) + " is full. Make room first (shrink or remove a box), then add it again.", "bad"); return; }
  tileList().push(tile);
  if (spot) (page.slots = page.slots || []).push({id:newUid() + "s", x:spot.x, y:spot.y, w:sw, h:sh, mod:tid});
  else page.slots = [{id:newUid() + "s", x:0, y:0, w, h, mod:tid}];       // an empty page
  LIB.addTo = page.id;
  try{ if (!ECHO && pvWin().dashEditing()) pvWin().dashEdit(false); }catch(e){}       // the preview reloads with the new box, then opens the editor on it
  save(); libClose(); stack = ["root"];
  toast((d.title || type) + " added to " + (page.id === "main" ? "Main" : page.name), "ok");
  if (ECHO){ setTimeout(() => { location.href = displayHref(true); }, 900); return; }
  PV.editPage = page.id; PV.editTile = tid;
  go("page:" + page.id);
}
function libDup(id){
  const sp = savedById(id); if (!sp) return;
  const uid = newUid();
  gpAll().push({id:uid, name:uniqueName(sp.name + " copy"), cols:GC, slots:cloneSlots(sp.slots, uid), on:false, saved:true, look:sp.look, at:Date.now()});
  save(); libGo("mine", "saved:" + uid);
}
// gal: a layout downloaded from Community remembers where it came from; it returns the new page's id instead of opening it
async function libKeep(gal){
  if (LIB.imp && (LIB.imp.mine || []).some(x => !x.id)){
    if (gal){ for (const b of LIB.imp.boxes) b.tiles = b.tiles.filter(t => !t.tile); }       // a gallery layout never brings code
    else try{ await stuImportLayout(LIB.imp); }catch(e){ toast("Couldn't add its tiles: " + e.message, "bad"); return ""; }
  }
  const name = uniqueName(LIB.imp.name), pid = installStarter("import", false, false), p = gpAll().find(x => x.id === pid);      // the name first: the new page would count as a clash with itself
  if (!p) return "";
  Object.assign(p, {on:false, saved:true, look:Object.keys(LIB.imp.look).length ? LIB.imp.look : lookSnap(), at:Date.now(), name}, gal ? {gallery:gal} : {});
  if (gal) return pid;
  save(); toast("Saved to My layouts", "ok"); libGo("mine", "saved:" + pid);
}
function libDropSaved(sp){
  const gone = new Set([].concat(...(sp.slots || []).map(smods)));
  if (mods.tiles) mods.tiles.settings.items = tileList().filter(x => !gone.has(x.id));
  mods.pages.settings.items = gpAll().filter(x => x !== sp);
}
function libTap(t){
  const d = t.dataset, a = d.l;
  if ((a === "close" || a === "view" || a === "sback" || a === "s-theme") && libDirty()) return;
  if ((a === "close" || a === "view" || a === "s-new" || a === "s-theme") && LIB.view === "studio" && stuDirty() && !confirm("Leave Tile Studio without saving your changes?")) return;
  if ((a === "close" || a === "view" || a === "s-theme") && LIB.view === "studio"){ clearInterval(STU.poll); STU.t = null; }
  if (a === "s-theme"){ libOpen("themes"); LIB.sub.push("tstudio"); libShow(); return; }
  if (a === "sback"){ LIB.sub.pop(); libShow(); return; }
  if (a === "close"){ libClose(); show(); return; }
  if (a === "view"){ if (d.item) LIB.shareOf = d.item; else if (d.id === "share") LIB.shareOf = LIB.shareOf || "main"; LIB.q = ""; LIB.chip = "all"; libGo(d.id); return; }
  if (a === "chip"){ LIB.chip = d.id; libShow(); return; }
  if (a === "open"){ LIB.look = true; LIB.pvKey = ""; libGo(LIB.view, d.id); return; }
  if (a === "savemain"){
    const main = gpAll().find(x => x.id === "main"), uid = newUid();
    gpAll().push({id:uid, name:uniqueName(mainDated()), cols:GC, slots:cloneSlots(main.slots, uid), on:false, saved:true, look:lookSnap(), theme:usedLook(), at:Date.now()});
    save(); toast("Saved a copy of Main in My layouts", "ok"); libShow(); return;
  }
  if (a === "look"){ LIB.look = !LIB.look; libShow(); return; }
  if (a === "use"){ libUse(LIB.item, d.id === "main"); return; }
  if (a === "try"){ libTry(LIB.item); return; }
  if (a === "keep"){ libKeep(); return; }
  if (a.startsWith("c-")){ commTap(t); return; }
  if (a.startsWith("s-")){ stuTap(t); return; }
  if (a === "dup"){ libDup(d.id); return; }
  if (a === "del"){
    const sp = savedById(d.id); if (!sp || !confirmDel({one:"saved layout"}, d.id)) return;
    libDropSaved(sp); save(); toast("Deleted", "ok"); libGo("mine"); return;
  }
  if (a === "addtile"){ libAddTile(d.id, LIB.addTo || "main"); return; }
  if (a === "setup"){ libClose(); stack = ["root", "src:" + d.id]; show(); return; }
  if (a === "download"){ libDownload(); return; }
  if (a === "copy"){ libCopy(); return; }
  if (a === "gsubmit"){ const T = libShareTarget(); if (T){ const nm = LIB.share.name.trim() || "Shared layout"; gallerySubmit(nm, libCode(libPack(T.p, T.look, nm, LIB.share.desc.trim()).pkg)); } return; }
  if (a === "openpaste"){ const box = libEl().querySelector('[data-l="paste"]'); libLoadImport(box ? box.value : ""); return; }
}
function libInit(){
  const el = libEl();
  el.addEventListener("click", e => {
    const s = e.target.closest("button.sw[data-s]");
    if (s && LIB.view === "studio"){ s.classList.toggle("on"); s.setAttribute("aria-checked", s.classList.contains("on")); stuSet(s.dataset.s, "", s); return; }
  });
  el.addEventListener("click", e => { const t = e.target.closest("[data-l]"); if (t && t.tagName !== "INPUT" && t.tagName !== "SELECT" && t.tagName !== "TEXTAREA") libTap(t); });
  el.addEventListener("input", e => {
    const t = e.target, a = t.dataset.l;
    if (t.dataset.s && LIB.view === "studio" && (t.tagName === "TEXTAREA" || t.type === "text") && !/\.(key|slot)$/.test(t.dataset.s)){ stuSet(t.dataset.s, t.value, t); return; }
    if (a === "q"){ LIB.q = t.value; clearTimeout(libInit.qt); libInit.qt = setTimeout(() => { const pos = t.selectionStart; libShow(); const q = el.querySelector('[data-l="q"]'); if (q){ q.focus(); try{ q.setSelectionRange(pos, pos); }catch(err){} } }, 200); }
    if (a === "sharename" || a === "sharedesc"){
      LIB.share[a === "sharename" ? "name" : "desc"] = t.value;
      const T = libShareTarget(), box = el.querySelector('[data-l="codebox"]');
      if (T && box) box.value = libCode(libPack(T.p, T.look, LIB.share.name.trim() || "Shared layout", LIB.share.desc.trim()).pkg);
    }
  });
  el.addEventListener("change", e => {
    const t = e.target, d = t.dataset;
    if (d.l === "slot"){ LIB.slots[d.id] = t.value; libShow(); return; }
    if (d.l === "addto"){ LIB.addTo = t.value; return; }
    if (d.l === "shareof"){ LIB.shareOf = t.value; libShow(); return; }
    if (d.l === "rename"){ const sp = savedById(d.id); if (sp){ sp.name = t.value.trim().slice(0, 80) || sp.name; t.value = sp.name; save(); } return; }
    if (d.l === "s-file" && t.files && t.files[0]){ t.files[0].text().then(stuImportFile, () => toast("Couldn't read that file", "bad")); return; }
    if (d.s && LIB.view === "studio" && (t.tagName !== "TEXTAREA" && t.type !== "text" || /\.(key|slot)$/.test(d.s))){ stuSet(d.s, t.value, t); return; }
    if (d.l === "file" && t.files && t.files[0]){ t.files[0].text().then(libLoadImport, () => { LIB.impErr = "Couldn't read that file."; libShow(); }); }
  });
  addEventListener("keydown", e => {
    if (e.key === "Escape" && !el.hidden){
      if (LIB.view === "studio"){
        if (stuDirty() && !confirm("Leave Tile Studio without saving your changes?")) return;
        clearInterval(STU.poll); STU.t = null; libGo("tiles", STU.id ? "tile:" + STU.id : ""); return;
      }
      if (libSub() && libDirty()) return;
      if (libSub() && LIB.sub.length > 1){ LIB.sub.pop(); libShow(); }
      else if (LIB.item) libGo(LIB.item === "import" ? "import" : LIB.view);
      else { libClose(); show(); }
    }
  });
  addEventListener("resize", () => { if (!el.hidden){ libFitShots(); libPvFit(); } });
}
libInit();

