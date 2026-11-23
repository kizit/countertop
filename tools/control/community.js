/* ---------- Library → Community: layouts, themes, effects and tiles other people made ----------
   The gallery (github.com/kizit/countertop-gallery) is read only when this view opens, through the server (GET /community).
   Nothing in it is part of your Library until you press Download; a download is an ordinary saved layout, theme or effect
   that remembers where it came from (gallery: {id, v, by}), so it can be updated when its author ships a new version,
   removed, or flagged when the gallery takes it down. Every item is checked again here, as a shared file is.
   Tiles are different: they run code, so the server downloads them itself (POST /community/tile, server/commtiles.py)
   after the person has seen everything the tile can do, and the dashboard runs them in a sandbox. */
const COMM = {data:null, loading:false, error:"", entry:null};
const GALLERY_SUBMIT = "https://github.com/kizit/countertop-gallery/issues/new?template=submit.yml";
const COMM_KINDS = {layout:["Layouts", "layouts"], theme:["Themes", "themes"], effect:["Effects", "effects"], tile:["Tiles", "tiles"]};

async function commLoad(refresh){
  if (COMM.loading) return;
  COMM.loading = true; if (!COMM.data) libShow();
  try{
    const r = await fetch("/community" + (refresh ? "?refresh=1" : ""), {cache:"no-store"});
    const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status);
    COMM.error = j.error || ""; if (j.items && (j.items.length || !COMM.data || !j.error)) COMM.data = j;
    if (!COMM.data) COMM.data = {items:[], revoked:[], updated:"", fetched:0};
  }catch(e){ COMM.error = "Couldn't reach Countertop's server (" + e.message + ")."; if (!COMM.data) COMM.data = {items:[], revoked:[], updated:"", fetched:0}; }
  COMM.loading = false;
  fxRegister(); if (!libEl().hidden && LIB.view === "community") libShow();
}
const commRevoked = id => !!COMM.data && COMM.data.revoked.includes(id);

/* ----- what you've downloaded: each remembers its gallery id and version ----- */
function commHave(){
  const out = [];
  for (const p of gpAll()) if (p.saved && p.gallery) out.push({id:p.gallery.id, kind:"layout", name:p.name, v:p.gallery.v, by:p.gallery.by, obj:p});
  for (const t of looks()) if (t.gallery) out.push({id:t.gallery.id, kind:"theme", name:t.name, v:t.gallery.v, by:t.gallery.by, obj:t});
  for (const m of mineList()) if (m.gallery) out.push({id:m.gallery.id, kind:"effect", name:m.name, v:m.gallery.v, by:m.gallery.by, obj:m});
  for (const [type, t] of Object.entries(SBXC.tiles || {})) if (t.gallery) out.push({id:t.gallery.id, kind:"tile", name:t.title, v:t.gallery.v, by:t.gallery.by, obj:type, perms:t.gallery.perms || []});
  return out;
}
const commHas = id => commHave().find(x => x.id === id);
// new | have | update | gone (taken down by the gallery)
function commState(e){
  const h = commHas(e.id);
  return commRevoked(e.id) || (h && h.kind === "tile" && (SBXC.tiles[h.obj] || {}).revoked) ? (h ? "gone" : "hidden") : !h ? "new" : h.v < e.version ? "update" : "have";
}
const commEntries = () => ((COMM.data && COMM.data.items) || []).filter(e => commState(e) !== "hidden");
const commUpdates = () => commEntries().filter(e => commState(e) === "update").length;
const commTaken = () => commHave().filter(h => commRevoked(h.id) || h.kind === "tile" && (SBXC.tiles[h.obj] || {}).revoked);

// the previews of effects need to be known to FXLIB; community effects get ids of their own
const commFxId = e => "cm-" + e.id.split("/")[1];
function commFx(){
  if (!COMM.data || LIB.view !== "community") return [];
  const out = [];
  for (const e of COMM.data.items) if (e.kind === "effect"){
    try{ out.push(Object.assign(fxRead(e.item), {id:commFxId(e)})); }catch(err){}
  }
  return out;
}

/* ----- pictures ----- */
function commPic(e){
  if (e.kind === "tile") return commTilePic(e);
  if (e.kind === "theme"){ try{ return lookPic(Object.assign(lookVals("default"), themeRead(e.item).values)); }catch(err){ return '<div class="lpic"></div>'; } }
  if (e.kind === "effect") return '<canvas data-fx="' + esc(commFxId(e)) + '"></canvas>';
  const look = Object.assign(lookVals(curLook()), e.item.look || {});
  const page = {slots:((e.item.pages[0] || {}).boxes || []).map(b => ({x:b.x, y:b.y, w:b.w, h:b.h, mod:(b.tiles || []).length ? "t" : null}))};
  return pagePic(page, look, "page");
}
function commBadge(e){
  const s = commState(e);
  return s === "update" ? "Update available" : s === "have" ? "Downloaded" : s === "gone" ? "Taken down" : "";
}

/* ----- the list ----- */
function commView(){
  if (!COMM.data){ commLoad(); return '<h2 class="ltitle">Community</h2><div class="lempty">Loading the gallery…</div>'; }
  const up = commUpdates(), taken = commTaken();
  let h = '<h2 class="ltitle">Community</h2><p class="ldesc">Layouts, tiles, themes and effects other people made. Nothing here is part of your Library until you press <b>Download</b>, and you can remove it any time.</p>';
  if (COMM.error) h += '<div class="lpick"><div><b>' + esc(COMM.error) + '</b></div><button class="lbtn" data-l="c-refresh">Try again</button></div>';
  for (const t of taken) h += '<div class="lpick warn"><div><b>' + esc(t.name) + ' was taken down from the gallery</b><small>' + (t.kind === "tile" ? "It's off on your screens. Remove it to clear its boxes." : "It stays in your Library and keeps working. Remove it if you\'d rather not use it.") + '</small></div>' +
    '<button class="lbtn" data-l="c-open" data-id="' + esc(t.id) + '">Open</button></div>';
  h += '<div class="ltop"><input type="search" data-l="q" placeholder="Search the gallery" value="' + esc(LIB.q) + '">' +
    '<button class="lbtn" data-l="c-refresh">Refresh</button><a class="lbtn pri" href="' + GALLERY_SUBMIT + '" target="_blank" rel="noopener">Submit yours</a></div>';
  const chips = [["all", "All"], ["layout", "Layouts"], ["tile", "Tiles"], ["theme", "Themes"], ["effect", "Effects"], ["down", "Downloaded"]].concat(up ? [["upd", "Updates (" + up + ")"]] : []);
  h += '<div class="lchips">' + chips.map(([k, l]) => '<button class="lchip' + (LIB.chip === k ? " on" : "") + '" data-l="c-chip" data-id="' + k + '">' + l + '</button>').join("") + '</div>';
  const q = LIB.q.trim().toLowerCase(), c = LIB.chip;
  const list = commEntries().filter(e => (!q || (e.name + " " + e.description + " " + e.author).toLowerCase().includes(q)) &&
    (c === "all" || c === e.kind || (c === "down" && ["have", "update"].includes(commState(e))) || (c === "upd" && commState(e) === "update")));
  if (!list.length) h += '<div class="lempty">' + (COMM.data.items.length ? "Nothing matches." : COMM.error ? "" : "The gallery has nothing in it yet. Be the first: press Submit yours.") + '</div>';
  for (const kind of ["layout", "tile", "theme", "effect"]){
    const L = list.filter(e => e.kind === kind); if (!L.length) continue;
    h += '<div class="lh">' + COMM_KINDS[kind][0] + '</div><div class="lgrid">' + L.map(e => {
      const b = commBadge(e);
      return '<button class="lc' + (kind === "effect" ? " fxc" : kind === "tile" ? " ctile" : "") + '" data-l="c-open" data-id="' + esc(e.id) + '">' + commPic(e) + (b ? '<span class="lbadge' + (b === "Update available" ? " up" : "") + '">' + b + '</span>' : "") +
        '<span class="tx"><b>' + esc(e.name) + '</b><small>by ' + esc(e.author || "someone") + '</small></span></button>';
    }).join("") + '</div>';
  }
  return h + '<p class="lnote">Open a card to see it first. Submitting takes a share code from Share in Countertop; it\'s checked right away and reviewed before it appears here.</p>';
}

/* ----- one item ----- */
function commItem(id){
  if (!COMM.data){ commLoad(); return '<button class="lback" data-l="c-back">‹ Community</button><div class="lempty">Loading the gallery…</div>'; }
  const e = commEntries().find(x => x.id === id), have = commHas(id);
  if ((e || have) && (e ? e.kind : have.kind) === "tile") return commTileItem(id, e, have);
  if (!e && !have) return '<button class="lback" data-l="c-back">‹ Community</button><div class="lempty">That item isn\'t in the gallery any more.</div>';
  const kind = e ? e.kind : have.kind, name = e ? e.name : have.name, st = e ? commState(e) : "gone";
  let h = '<button class="lback" data-l="c-back">‹ Community</button><div class="ldet"><div>', warn = "";
  if (e){
    try{
      if (kind === "layout"){ LIB.imp = libRead(e.item); LIB.slots = {}; LIB.look = true; h += '<div class="lbig' + (displayMode === "auto" ? "" : " port") + '">' + libPic("import") + (ECHO ? "" : '<iframe tabindex="-1" aria-hidden="true" title="Live preview"></iframe>') + '</div>' +
        (ECHO ? "" : '<p class="lnote">Live preview with your own weather, calendars and lists.</p>'); }
      else if (kind === "theme") h += '<div class="lbig">' + commPic(e) + (ECHO ? "" : '<iframe tabindex="-1" aria-hidden="true" title="Live preview"></iframe>') + '</div>' + (ECHO ? "" : '<p class="lnote">Your own dashboard in this theme.</p>');
      else h += '<div class="fxc big"><canvas data-fx="' + esc(commFxId(e)) + '"></canvas></div>';
    }catch(err){ warn = err.message; h += '<div class="lempty">This one can\'t be opened here: ' + esc(err.message) + '</div>'; }
  } else h += '<div class="lempty">The gallery no longer lists this item.</div>';
  h += '</div><div><h2 class="ltitle">' + esc(name) + '</h2><div class="lsub">' + esc(COMM_KINDS[kind][0].slice(0, -1)) + (e ? " · by " + esc(e.author || "someone") + " · version " + e.version + (e.updated ? " · " + esc(e.updated) : "") : "") + '</div>';
  if (e && e.description) h += '<p class="ldesc">' + esc(e.description) + '</p>';
  const rows = [];
  if (st === "gone") rows.push(["Taken down from the gallery", "The gallery removed this. It stays in your Library and keeps working; remove it if you'd rather not use it."]);
  if (st === "update") rows.push(["A new version is out", "You have version " + have.v + ", the gallery has " + e.version + ". Updating replaces your copy; changes you made to it are lost."]);
  if (st === "have") rows.push(["In your Library", (kind === "layout" ? "My layouts" : kind === "theme" ? "Library → Themes" : "Library → Effects") + (have.v === e.version ? ", up to date." : ".")]);
  if (kind === "layout" && LIB.imp && e){
    if (LIB.imp.skipped.length) rows.push(["Left out", "Tiles this Countertop doesn't have: " + LIB.imp.skipped.join(", ")]);
    if (LIB.imp.kinds.length && st !== "have") rows.push(["Uses your setup", "Tiles that use your " + LIB.imp.kinds.map(k => (KINDS[k] ? KINDS[k].title : k).toLowerCase()).join(" and ") + " start with the first you have set up; change them in each tile's settings."]);
  }
  if (rows.length) h += '<div class="lpanel">' + rows.map(([t, s]) => '<div class="lrow"><div class="t">' + esc(t) + '<small>' + esc(s) + '</small></div></div>').join("") + '</div>';
  if (kind === "layout" && LIB.imp && e) h += libNeedRows(LIB.imp);
  const act = [];
  if (e && !warn && (st === "new")) act.push('<button class="lbtn pri" data-l="c-dl" data-id="' + esc(id) + '">Download</button>');
  if (e && !warn && st === "update") act.push('<button class="lbtn pri" data-l="c-up" data-id="' + esc(id) + '">Update to version ' + e.version + '</button>');
  if (have) act.push('<button class="lbtn red" data-l="c-rm" data-id="' + esc(id) + '">Remove from my Library</button>');
  if (act.length) h += '<div class="lact">' + act.join("") + '</div>';
  if (st === "new" && e) h += '<p class="lnote">Download adds a copy to your ' + (kind === "layout" ? "My layouts" : kind === "theme" ? "themes" : "effects") + '. It changes nothing on your screen' + (kind === "layout" ? ": use it from My layouts when you want it" : kind === "theme" ? ": use it from Library → Themes" : ": it starts on, and you can turn it off in Library → Effects") + '.</p>';
  return h + '</div></div>';
}
// after the item page is drawn: live previews and effect canvases
function commAfter(){
  if (LIB.view !== "community") return;
  fxPreviews();
  const it = LIB.item.startsWith("c:") ? LIB.item.slice(2) : "", e = commEntries().find(x => x.id === it);
  if (!e || ECHO) return;
  if (e.kind === "layout" && LIB.imp) libPreview("import");
  if (e.kind === "theme") commThemeTrial(e);
}
async function commThemeTrial(e){
  const box = libEl().querySelector(".lbig"), f = box && box.querySelector("iframe"); if (!f) return;
  const W = displayMode === "auto" ? 1920 : 1080;
  f.style.width = W + "px"; f.style.height = (displayMode === "auto" ? 1080 : 1920) + "px"; f.style.transform = "scale(" + box.clientWidth / W + ")";
  try{
    const r = await fetch("/trial", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({pages:gpAll(), tiles:tileList(), look:Object.assign(lookVals("default"), themeRead(e.item).values), name:e.name})});
    const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.status);
    if (LIB.item !== "c:" + e.id) return;
    f.onload = () => setTimeout(() => f.classList.add("on"), 900);
    f.src = "/dash/content?preview=1&trial=" + j.id + "&theme=default";
  }catch(err){}
}

/* ----- Download, Update, Remove ----- */
function commTag(e){ return {id:e.id, v:e.version, by:e.author || ""}; }
function commAdd(e){
  if (e.kind === "theme"){
    const T = themeRead(e.item), nid = "t" + Date.now().toString(36), base = T.name;
    looks().push({id:nid, name: looks().some(t => t.name === base) ? base + " " + (looks().length + 1) : base, values:Object.assign(lookVals("default"), T.values), gallery:commTag(e)});
    return nid;
  }
  if (e.kind === "effect"){
    const f = fxRead(e.item), m = Object.assign(fxPlain(f), {id:"my" + Date.now().toString(36), gallery:commTag(e)});
    mineList().push(m); fxRegister(); return m.id;
  }
  LIB.imp = libRead(e.item); LIB.slots = {};
  return libKeep(commTag(e));
}
function commDrop(h){
  if (h.kind === "theme"){
    if (LS().use === h.obj.id) LS().use = "";
    LS().items = looks().filter(t => t !== h.obj); LS().rules = rules().filter(r => r.look !== h.obj.id);
  } else if (h.kind === "effect"){
    mods.effects.settings.mine = mineList().filter(m => m !== h.obj); mods.effects.settings.items = fxItemsC().filter(x => x.id !== h.obj.id); fxRegister();
  } else libDropSaved(h.obj);
}
function commTap(t){
  const d = t.dataset, a = d.l, e = commEntries().find(x => x.id === d.id);
  if (a === "c-back"){ libGo("community"); return; }
  if (a === "c-chip"){ LIB.chip = d.id; libShow(); return; }
  if (a === "c-refresh"){ commLoad(true); return; }
  if (a === "c-open"){ libGo("community", "c:" + d.id); return; }
  if (a === "c-backimp"){ LIB.imp = libRead(LIB.impRaw); LIB.slots = {}; libGo("import", "import"); return; }
  if ((a === "c-dl" || a === "c-up") && e && e.kind === "tile"){ commTileGet(e, a === "c-up"); return; }
  if (a === "c-rm" && commHas(d.id) && commHas(d.id).kind === "tile"){ commTileRemove(commHas(d.id)); return; }
  if (a === "c-dl" && e){
    try{ commAdd(e); }catch(err){ toast("Couldn't download it: " + err.message, "bad"); return; }
    save(); toast("Downloaded " + e.name, "ok"); libShow(); return;
  }
  if (a === "c-up" && e){
    const h = commHas(e.id); if (!h) return;
    const was = h.obj, wasUse = h.kind === "theme" && LS().use === was.id;
    try{ const nid = commAdd(e);
      if (h.kind === "theme" && wasUse) LS().use = nid;
      if (h.kind === "theme") LS().rules.forEach(r => { if (r.look === was.id) r.look = nid; });
      if (h.kind === "effect"){ const c = fxItemsC().find(x => x.id === was.id); if (c) c.id = nid; }       // keeps its on/off, amount and times
      commDropOld(h, was);
      commRename(h.kind, nid, e);
    }catch(err){ toast("Couldn't update it: " + err.message, "bad"); return; }
    save(); toast("Updated " + e.name, "ok"); libShow(); return;
  }
  if (a === "c-rm"){
    const h = commHas(d.id); if (!h || !confirmDel({one:h.kind === "layout" ? "saved layout" : h.kind}, d.id)) return;
    commDrop(h); save(); toast("Removed " + h.name + " from your Library", "ok"); libShow();
  }
}
// the new copy takes the name of the gallery item again now that the old copy is out of the way
function commRename(kind, id, e){
  if (kind === "theme"){ const t = lookById(id); if (t && !looks().some(x => x !== t && x.name === e.name)) t.name = e.name; }
  else if (kind === "layout"){ const p = gpAll().find(x => x.id === id); if (p) p.name = uniqueName(e.name); }
}
// an updated item replaces the old copy (already replaced in the schedule and in use); drop what's left of it
function commDropOld(h, was){
  if (h.kind === "theme") LS().items = looks().filter(t => t !== was);
  else if (h.kind === "effect") mods.effects.settings.mine = mineList().filter(m => m !== was);
  else libDropSaved(was);
}

/* ----- tiles: what each can do, shown before Download; the server downloads it ----- */
const COMM_GROUP = {see:"👁", tap:"👆", personal:"🏠", reach:"🌐", control:"🔘", secure:"🔒"};
function commTilePic(e){
  if (e.shot) return '<span class="lpic ctshot"><img alt="" loading="lazy" src="/community/shot?id=' + encodeURIComponent(e.id) + '&v=' + e.version + '"></span>';
  const sz = (e.tile && e.tile.size) || [12, 8];
  return '<span class="lpic ctshot none"><span class="ctn">' + esc(e.name) + '</span><span class="cts">' + sz[0] + ' × ' + sz[1] + '</span></span>';
}
// the permission list: each line, and "New" on lines an update adds
function commPerms(e, have){
  const P = e.tile.perms || [], old = have ? have.perms || [] : null;
  if (!P.length) return '<div class="lrow"><span class="lok">✓</span><div class="t">Nothing beyond its own box<small>It can\'t see your calendars, lists or photos, reach any site, or work any device.</small></div></div>';
  return P.map(p => '<div class="lrow perm ' + p.group + '"><span class="lok">' + (COMM_GROUP[p.group] || "•") + '</span><div class="t">' + esc(p.text) +
    (old && (p.ks || [p.k]).some(k => !old.includes(k)) ? ' <span class="lnew">New</span>' : "") + '</div></div>').join("");
}
const commKeys = e => [].concat(...(e.tile.perms || []).map(p => p.ks || [p.k]));
const commTileNew = (e, have) => !!have && commKeys(e).some(k => !(have.perms || []).includes(k));
function commTileItem(id, e, have){
  const st = e ? commState(e) : "gone", name = e ? e.name : have.name, type = e ? e.tile.type : have.obj;
  let h = '<button class="lback" data-l="c-back">‹ Community</button><div class="ldet"><div>';
  h += e ? '<div class="lbig ctbig">' + commTilePic(e) + '</div>' : '<div class="lempty">The gallery no longer lists this tile.</div>';
  if (e && e.item && typeof e.item.code === "string") h += '<details class="lcode"><summary>See its code</summary><pre>' + esc(e.item.code) + '</pre></details>';
  h += '</div><div><h2 class="ltitle">' + esc(name) + '</h2><div class="lsub">Tile' + (e ? " · by " + esc(e.author || "someone") + " · version " + e.version + (e.updated ? " · " + esc(e.updated) : "") : "") + '</div>';
  if (e && e.description) h += '<p class="ldesc">' + esc(e.description) + '</p>';
  const rows = [];
  if (st === "gone") rows.push(["Taken down from the gallery", "It's off on your screens and its boxes say so. Remove it to clear them."]);
  if (st === "update") rows.push(["A new version is out", "You have version " + have.v + ", the gallery has " + e.version + "." + (commTileNew(e, have) ? " This version can do more, marked New below." : "") + " Its settings and boxes stay as they are."]);
  if (st === "have"){ const n = tileList().filter(t => t.type === type).length;
    rows.push(["In your Library", "Library → Tiles → Community, and the editor's Add a tile. " + (n ? "On your dashboard: " + n + (n === 1 ? " tile." : " tiles.") : "Not on your dashboard yet.")]); }
  if (rows.length) h += '<div class="lpanel">' + rows.map(([t, s]) => '<div class="lrow"><div class="t">' + esc(t) + '<small>' + esc(s) + '</small></div></div>').join("") + '</div>';
  if (e && st !== "gone"){
    h += '<div class="lpanel ctperms"><h3>' + (st === "have" ? "What it can do" : "What it can do, if you download it") + '</h3>' + commPerms(e, st === "update" ? have : null) + '</div>';
    const notes = [];
    if ((e.tile.personal || []).length) notes.push(["warn", "Reviewed and contained, not sealed. Silk lets a tile's code send one request by navigating its own frame, and may allow other ways out. Only turn on tiles from authors you trust."]);
    if (e.tile.secure) notes.push(["", "Locks, garage doors and alarms stay off until you switch them on in the tile's settings, and then every tap asks you to confirm on the screen."]);
    notes.push(["", "Every version is reviewed before it appears here. It runs in a sandbox: its code can't change your settings or reach anything on your home network by itself. A faulty tile can freeze the screen until its browser restarts; Countertop then turns community tiles off by itself (Controls → Status)."]);
    h += notes.map(([c, t]) => '<p class="lnote' + (c ? " " + c : "") + '">' + esc(t) + '</p>').join("");
  }
  const act = [];
  if (e && st === "new") act.push('<button class="lbtn pri" data-l="c-dl" data-id="' + esc(id) + '">Allow and download</button>');
  if (e && st === "update") act.push('<button class="lbtn pri" data-l="c-up" data-id="' + esc(id) + '">' + (commTileNew(e, have) ? "Allow and update to version " : "Update to version ") + e.version + '</button>');
  if (have && st !== "gone" && DEFS[type]) act.push('<button class="lbtn" data-l="addtile" data-id="' + esc(type) + '">Add it to ' + esc(libAddName()) + '</button>');
  if (have) act.push('<button class="lbtn red" data-l="c-rm" data-id="' + esc(id) + '">Remove</button>');
  if (LIB.impRaw && LIB.imp && (LIB.imp.need || []).some(n => n.id === id)) act.push('<button class="lbtn" data-l="c-backimp">Back to the layout you\'re importing</button>');
  if (act.length) h += '<div class="lact">' + act.join("") + '</div>';
  if (st === "new") h += '<p class="lnote">Download adds it to Library → Tiles. It changes nothing on your screen until you add it to a page. It never updates by itself.</p>';
  return h + '</div></div>';
}
// Download or Update: the server reads the tile from the gallery itself, and refuses if it can do more than the list shown here
async function commTileGet(e, update){
  let j;
  try{
    const r = await fetch("/community/tile", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({id:e.id, consent:commKeys(e)})});
    j = await r.json();
    if (j.ask){ toast(j.error, "bad"); commLoad(true); return; }       // it changed since the list was drawn: show the new list
    if (!r.ok || j.error) throw new Error(j.error || r.status);
  }catch(err){ toast("Couldn't " + (update ? "update" : "download") + " it: " + err.message, "bad"); return; }
  await commSync();
  toast((update ? "Updated " : "Downloaded ") + e.name + (update ? "" : ". Add it from here, Library → Tiles or the editor."), "ok"); libShow();
}
// Remove: its boxes are emptied, then the server drops the tile and any API keys saved for it
async function commTileRemove(h){
  const type = h.obj, mine = tileList().filter(t => t.type === type);
  if (!confirmDel({one:mine.length ? "tile and its " + mine.length + (mine.length === 1 ? " box" : " boxes") : "tile"}, h.id)) return;
  try{
    const r = await fetch("/community/tile/remove", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({type})});
    const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.status);
  }catch(err){ toast("Couldn't remove it: " + err.message, "bad"); return; }
  if (mine.length){ commDropTiles(type); save(true); }
  await commSync(); delete DEFS[type];
  toast("Removed " + h.name, "ok"); libShow();
}
// take every tile of a kind out of the pages; a box left with nothing in it is removed
function commDropTiles(type){
  const gone = new Set(tileList().filter(t => t.type === type).map(t => t.id));
  mods.tiles.settings.items = tileList().filter(t => !gone.has(t.id));
  for (const p of gpAll()){
    p.slots = (p.slots || []).filter(sl => {
      const had = smods(sl).length, ids = smods(sl).filter(x => !gone.has(x));
      if (ids.length === had) return true;
      sl.mod = ids[0] || null; if (sl.more) sl.more = ids.slice(1);
      return ids.length > 0;
    });
  }
}
// the server's list of community tiles, again: after a download, an update or a removal
async function commSync(){
  try{ const j = await fetch("/config", {cache:"no-store"}).then(r => r.json()); SBXC = j.sandbox || {tiles:{}}; commDefs(); }catch(e){}
}
// installed community tiles join the Library's tiles (DEFS), so they can be added, shared and imported like any other
function commDefs(){
  for (const k of Object.keys(DEFS)) if (DEFS[k].community && !(SBXC.tiles || {})[k]) delete DEFS[k];
  for (const [type, t] of Object.entries(SBXC.tiles || {})){
    if (DEFS[type] && !DEFS[type].community) continue;          // never replaces a built-in tile
    DEFS[type] = {title:t.title, desc:t.desc, cat:"Community", size:t.size, settings:t.settings || {}, community:true, gallery:t.gallery || null,
      author:t.author || "", revoked:!!t.revoked, version:t.version};
    TITLES[type] = t.title;
  }
}
