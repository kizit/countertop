/* ---------- community tiles: each one runs in its own sandboxed frame (tools/server/sandbox.py, tools/sandbox/) ----------
   The frame has no network and no way into this page. Everything it gets comes from here, by message, and only
   what its tile declared: its own settings and stored data, the shared data in its `feeds`, and web addresses on its
   `hosts`, read by the server. A message is matched to its frame by where it came from, never by anything it says.
   Frames run only for tiles on the page that's showing, at most SBX.max at once. A frame that loads a second time
   has navigated away and is removed. While a frame runs, this page checks in with the server every few seconds: an
   endless loop in a frame freezes the whole page on the Echo, and the server turns on safe mode when it goes quiet.
   A control tile's buttons are drawn here, below its frame, never by its code (sbxControls). */
const SBX = {safe:false, max:6, beat:5, tiles:{}, frames:new Map(), has:{}, paused:{}, notes:[],
  session:Date.now().toString(36) + Math.random().toString(36).slice(2, 8), gap:0, lastTick:0, lastBeat:0, wasShowing:false};
// this.feed(name) names → the dashboard's feed keys, and where each one's data lives in STATE
const SBX_FEED = {weather:"wx", air:"aqi", events:"events", notes:"notes", teams:"team", albums:"photos", sales:"sales"};
const SBX_STATE = {wx:"wx", aqi:"aqi", events:"events", notes:"notes", team:"teams", photos:"albums", sales:"sales"};
const SBX_SOURCES = {calendars:"events", teams:"team", lists:"notes", albums:"photos"};
const sbxReports = () => !PREVIEW && !SOLO && !STILL && !TRIAL_ID;      // only a real screen checks in

function sbxSetup(cfg){
  cfg = cfg || {};
  SBX.safe = !!cfg.safe; SBX.max = +cfg.max || 6; SBX.beat = +cfg.beat || 5; SBX.tiles = cfg.tiles || {};
  for (const t of Object.values(SBX.tiles)){
    if (TYPES[t.type] && !TYPES[t.type].community) continue;          // never replaces a built-in tile
    Tile(t.type, {title:t.title, desc:t.desc, cat:"Community", size:t.size, feeds:t.feeds || [], uses:t.uses || [],
      every:t.every || 0, demo:t.demo || {}, demoData:t.demoData || {}, lang:t.lang || {}, hosts:t.hosts || [], taps:!!t.taps, version:t.version,
      devices:t.devices || {}, controls:t.controls || [],
      author:t.author, personal:t.personal || [], community:true, api:1, card:true, noFit:true, cls:"m-sbx",
      settings:Object.assign(sbxGrantDefs(t), t.settings || {}),
      render(el){ sbxRender(this, el); },
      has(){ return sbxHas(this); },
      urgent(){ return !!(SBX.has[this.id] || {}).urgent; },
      hide(){ /* the frame stays a minute in case the tile comes back (sbxTick) */ },
      editNote(){ return sbxEditNote(this); }});
  }
}
// a control tile's own settings, added by the dashboard: which Home Assistant, which real device fills each of the
// tile's device slots, and the switch for locks, garage doors and alarms. They start with "@", which a tile's own
// settings can't, are never sent into the frame, and the server reads them when a button is tapped (server/controls.py)
function sbxGrantDefs(t){
  const D = {}, devs = t.devices || {};
  if (!Object.keys(devs).length) return D;
  D["@src"] = {type:"source", kind:"homeassistant", label:"Home Assistant", default:""};
  for (const k in devs) D["@" + k] = {type:"entity", src:"@src", domains:devs[k].domains, label:devs[k].label,
    help:tr("Which one this tile works. It can only use what you pick here."), default:"", grant:true};
  if (Object.values(devs).some(d => d.secure)) D["@secure"] = {type:"bool", label:"Allow locks, garage doors and alarms",
    help:"Off: their buttons do nothing. On: each tap asks you to confirm on the screen first", default:false, grant:true};
  return D;
}
// at the top of a community tile's settings in the editor: who made it, what it can see and do
function sbxEditNote(m){
  const L = [];
  if (m.author) L.push(tr("Community tile by {who}.", {who:m.author}));
  if ((m.controls || []).length) L.push(tr("Its buttons are drawn by Countertop below the tile, and work only the devices you pick here. The tile's own code can show them but never press them."));
  if ((m.personal || []).length) L.push(tr("Reviewed and contained, not sealed. Silk lets a tile's code send one request by navigating its own frame, and may allow other ways out. Only turn on tiles from authors you trust."));
  return L.length ? '<p class="pd">' + L.map(esc).join(" ") + '</p>' : "";
}
// the settings the tile's own code sees: not the ones the dashboard added, and for an API key only whether one is saved
function sbxS(m){
  const o = {}, D = m.settings || {}, secret = k => !!D[k] && D[k].type === "secret";
  for (const k in m.s) if (k[0] !== "@" && !secret(k)) o[k] = m.s[k];
  for (const k in D) if (secret(k)) o[k] = sbxKeyState(m, k) === "set";
  return o;
}
/* ----- API keys: typed here, saved on the server (POST /tile-key), never sent back to any page or to the frame.
   The server adds a key only to requests to the one site its setting names (server/tilekeys.py). ----- */
function sbxKeyState(m, k){ return ((SBX.tiles[m.type] || {}).keys || {})[k] || ""; }
function sbxKeyField(m, k, d, lab){
  const st = sbxKeyState(m, k);
  const say = st === "set" ? tr("A key is saved.") : st === "moved" ? tr("This tile now sends its key to a different site or in a different way, so the saved key isn't used. Type it again to allow that.") : tr("No key saved yet.");
  return '<div class="kv col sbxkey" data-key="' + esc(k) + '">' + lab() +
    '<em class="' + (st === "set" ? "ok" : "none") + '">' + esc(say) + '</em>' +
    '<input type="password" data-tk="' + esc(k) + '" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="' + esc(st === "set" ? tr("Type a new key to replace it") : tr("Paste or type the key")) + '">' +
    '<div class="btns"><button class="pri" data-act="tksave" data-k="' + esc(k) + '">' + esc(tr("Save key")) + '</button>' +
    (st ? '<button data-act="tkrm" data-k="' + esc(k) + '">' + esc(tr("Remove key")) + '</button>' : "") + '</div>' +
    '<small>' + esc(tr("Sent only to {host}. It stays on the Countertop server, is never shown again, and is left out of shared layouts. Every {name} tile uses this key.", {host:d.host, name:(TYPES[m.type] || {}).title || m.type})) + '</small></div>';
}
async function sbxKeyAct(a, el){
  const m = MODULES[EDIT.tile]; if (!m || !m.community) return;
  const k = el.dataset.k, inp = $("edpanel").querySelector('input[data-tk="' + k + '"]');
  const value = inp ? inp.value.trim() : "";
  if (a === "tksave" && !value){ flash(tr("Type the key first")); return; }
  let j;
  try{
    const r = await fetch("/tile-key", {method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify(a === "tkrm" ? {type:m.type, name:k, remove:true} : {type:m.type, name:k, value})});
    j = await r.json();
  }catch(e){ j = {error:tr("Couldn't reach the Countertop server")}; }
  if (inp) inp.value = "";
  if (!j || j.error){ flash((j && j.error) || tr("Couldn't save the key")); return; }
  (SBX.tiles[m.type] = SBX.tiles[m.type] || {}).keys = j.keys || {};
  // every tile of this kind starts again with the new key: no answers kept from before
  for (const x of Object.values(MODULES)) if (x.type === m.type){ x._sf = {}; sbxDrop(x.id); }
  flash(a === "tkrm" ? tr("Key removed") : tr("Key saved"), true);
  relayout();
}
// what a box says instead of running its tile. (Notes for Controls → Status stay in English, like the rest of Status.)
function sbxSay(el, text){
  if (el._sbxSaid === text && el.querySelector(".sbxmsg")) return;
  el._sbxSaid = text;
  el.innerHTML = '<div class="sbxmsg">' + esc(text) + '</div>';
}
// the last has() the tile's frame answered, kept when the frame goes. A tile that had nothing to show gets a new
// frame to ask again after five minutes
function sbxHas(m){
  const h = SBX.has[m.id];
  if (!h || h.has !== false) return true;
  return !SBX.frames.has(m.id) && Date.now() - h.at > 300e3;
}
function sbxPageEl(){
  const n = pageList()[PAGE] || "main";
  return n === "main" ? $("p1") : document.querySelector('.cpage[data-page="' + (n === "night" ? "night" : n.slice(2)) + '"]');
}
// a frame runs for a tile on the page that's showing, whose turn it is in its box
function sbxWanted(el){
  if (!el || !document.contains(el) || el.classList.contains("stk-off")) return false;
  const pg = el.closest(".page");
  return !!pg && (SOLO || pg === sbxPageEl());
}
function sbxRender(m, el){
  if (SBX.safe){ sbxDrop(m.id); return sbxSay(el, tr("Community tiles are off (safe mode). Turn them back on in Controls → Status.")); }
  if ((SBX.tiles[m.type] || {}).revoked){ sbxDrop(m.id); return sbxSay(el, tr("Taken down from the community gallery, so it's off. Remove it in Controls → Library → Community.")); }
  if (SBX.paused[m.id]) return sbxSay(el, SBX.paused[m.id]);
  let rec = SBX.frames.get(m.id);
  if (rec && rec.el !== el){ sbxDrop(m.id); rec = null; }
  if (!rec){
    if (!sbxWanted(el)) return sbxSay(el, "");
    rec = sbxStart(m, el);
    if (!rec) return;
  }
  rec.gone = 0;
  sbxUpdate(rec, true);
}
function sbxStart(m, el){
  if (SBX.frames.size >= SBX.max){       // make room: frames kept for tiles that have stopped showing go first
    for (const r of SBX.frames.values()) if (!r.gone && !sbxWanted(r.el)) r.gone = Date.now();
    const idle = [...SBX.frames.values()].filter(r => r.gone).sort((a, b) => a.gone - b.gone);
    while (SBX.frames.size >= SBX.max && idle.length) sbxDrop(idle.shift().id);
  }
  if (SBX.frames.size >= SBX.max){
    sbxNote("A screen runs up to " + SBX.max + " community tiles at once, so “" + m.name + "” isn't running. Move it to another page.");
    sbxSay(el, tr("A screen runs up to {n} community tiles at once, so this one is waiting. Move it to another page.", {n:SBX.max}));
    return null;
  }
  el._sbxSaid = null; el.innerHTML = "";
  const f = document.createElement("iframe");
  f.setAttribute("sandbox", "allow-scripts");
  f.setAttribute("referrerpolicy", "no-referrer");
  f.className = "sbxf"; f.title = m.name;
  const cs = getComputedStyle(el), lay = sbxStripLayout(m, el, cs), strip = lay.h;
  const bottom = strip ? "calc(" + cs.paddingBottom + " + " + strip + "px)" : cs.paddingBottom;
  f.style.cssText = "top:" + cs.paddingTop + ";right:" + cs.paddingRight + ";bottom:" + bottom + ";left:" + cs.paddingLeft +
    ";width:calc(100% - " + cs.paddingLeft + " - " + cs.paddingRight + ");height:calc(100% - " + cs.paddingTop + " - " + cs.paddingBottom + (strip ? " - " + strip + "px" : "") + ")";
  const rec = {id:m.id, m, el, f, loads:0, ready:false, gone:0, asks:new Map(), sent:{}, msgs:0, msgT:Date.now()};
  if (strip) sbxControls(rec, cs, lay);
  // the first load is the tile's page; any later one means the frame went somewhere else
  f.addEventListener("load", () => { rec.loads++; if (rec.loads > 1) sbxEscaped(rec); });
  f.src = "/tile-frame/" + encodeURIComponent(m.type) + "?v=" + (m.version || 1);
  el.appendChild(f);
  SBX.frames.set(m.id, rec);
  sbxBeat();
  return rec;
}
function sbxDrop(id){
  const rec = SBX.frames.get(id); if (!rec) return;
  SBX.frames.delete(id);
  try{ rec.f.src = "about:blank"; }catch(e){}
  rec.f.remove();
  if (rec.c) rec.c.remove();           // its buttons and any confirm go with it
  if (rec.conf) rec.conf.remove();
}
function sbxEscaped(rec){
  const m = rec.m;
  sbxDrop(rec.id);
  SBX.paused[rec.id] = tr("This tile tried to leave its box, so it was stopped. It stays off until the screen restarts.");
  sbxNote("“" + m.name + "” tried to leave its box and was stopped.");
  reportErr("community tile " + m.type, "navigated its frame");
  if (rec.el && document.contains(rec.el)) sbxSay(rec.el, SBX.paused[rec.id]);
  sbxBeat(true);
}
function sbxNote(text){ if (!SBX.notes.includes(text)) SBX.notes.push(text); }
function sbxPost(rec, msg){ try{ rec.f.contentWindow.postMessage(msg, "*"); }catch(e){} }
const sbxPlain = v => v === undefined ? null : JSON.parse(JSON.stringify(v));
function sbxTheme(el){
  const cs = getComputedStyle(el), v = k => cs.getPropertyValue(k).trim();
  return {fg:v("--fg"), dim:v("--dim"), accent:v("--accent"), line:v("--line"), font:cs.fontFamily};
}
// what the tile may know, worked out here from what it declared
function sbxAnswer(m, what, arg){
  const feeds = m.feeds || [];
  if (what === "events"){
    if (!feeds.includes("events")) return [];
    const o = arg && typeof arg === "object" ? arg : {};
    return m.events({cals:Array.isArray(o.cals) ? o.cals.map(String) : [], once:!!o.once})
      .map(e => Object.assign(sbxPlain(Object.assign({}, e, {date:null})), {date:e.date.getTime()}));
  }
  if (what === "sources") return feeds.includes(SBX_SOURCES[arg]) ? m.sources(arg) : [];
  if (what === "feed"){ const k = SBX_FEED[arg]; return k && feeds.includes(k) ? sbxPlain(STATE[SBX_STATE[k]]) : null; }
  if (what === "devices") return sbxDevices(m);
  return null;
}
// send the frame whatever changed since last time, and ask it to draw
function sbxUpdate(rec, draw){
  if (!rec.ready) return;
  const m = rec.m, msg = {ct:"update", draw:!!draw}, put = (k, v) => { const j = JSON.stringify(v); if (rec.sent[k] !== j){ rec.sent[k] = j; msg[k] = v; } };
  put("s", sbxS(m)); put("name", m.name); put("quiet", tileQuiet()); put("taps", !!m.taps && !tileQuiet());
  if (tileUsesStore(m)) put("store", {data:m.store.get(), ready:m.store.ready});
  const answers = {};
  for (const [key, a] of rec.asks){ const v = sbxAnswer(m, a.what, a.arg), j = JSON.stringify(v); if (a.j !== j){ a.j = j; answers[key] = v; } }
  if (Object.keys(answers).length) msg.answers = answers;
  rec.f.style.pointerEvents = m.taps && !tileQuiet() ? "auto" : "none";
  if (rec.c) sbxControlsDraw(rec);
  sbxPost(rec, msg);
}
function sbxInit(rec){
  const m = rec.m, fetched = {};
  for (const [u, c] of Object.entries(m._sf || {})) if (c.at) fetched[u] = {data:c.data, error:c.error, at:c.at};
  rec.ready = true;
  rec.sent = {s:JSON.stringify(sbxS(m)), name:JSON.stringify(m.name), quiet:JSON.stringify(tileQuiet()), taps:JSON.stringify(!!m.taps && !tileQuiet())};
  const store = tileUsesStore(m) ? {data:m.store.get(), ready:m.store.ready} : {data:{}, ready:true};
  rec.sent.store = JSON.stringify(store);
  rec.f.style.pointerEvents = m.taps && !tileQuiet() ? "auto" : "none";
  sbxPost(rec, {ct:"init", id:m.id, s:sbxS(m), name:m.name, quiet:tileQuiet(), taps:!!m.taps && !tileQuiet(), store, fetched,
    lang:I18N.lang, words:I18N.lang === "en" ? {} : I18N.words, locale:I18N.locale || null, theme:sbxTheme(rec.el)});
}
// a web address, read by the server (GET /tile-fetch) for a site the tile declared; kept per tile, so a new frame starts with it
async function sbxFetch(rec, url, maxAge){
  const m = rec.m, c = (m._sf = m._sf || {})[url] = m._sf[url] || {data:null, error:"", at:0, busy:false};
  const reply = () => { const r = SBX.frames.get(m.id); if (r && r.ready) sbxPost(r, {ct:"fetched", url, data:c.data, error:c.error}); };
  if (!(m.hosts || []).length){ c.error = tr("This tile can't reach the internet."); c.at = Date.now(); return reply(); }
  if (c.busy) return;
  if (c.at && Date.now() - c.at < Math.max(30, +maxAge || 0) * 1000) return reply();
  c.busy = true;
  try{ c.data = await tileGet(m, url, maxAge); c.error = ""; }
  catch(e){ c.error = String(e.message || e).slice(0, 200); }
  c.busy = false; c.at = Date.now();
  reply();
}
const SBX_OPS = ["set", "push", "update", "remove", "updateAll", "removeWhere"];
function sbxOk(ops){
  return Array.isArray(ops) && ops.length > 0 && ops.length <= 50 && ops.every(o => o && typeof o === "object" && SBX_OPS.includes(o.op) &&
    typeof o.key === "string" && o.key.length <= 60 && !["__proto__", "constructor", "prototype"].includes(o.key));
}
window.addEventListener("message", e => {
  let rec = null;
  for (const r of SBX.frames.values()) if (r.f.contentWindow === e.source){ rec = r; break; }
  if (!rec) return;                                  // not one of our tile frames (or one that was removed)
  const d = e.data;
  if (!d || typeof d !== "object" || typeof d.ct !== "string") return;
  const now = Date.now();
  if (now - rec.msgT > 10e3){ rec.msgT = now; rec.msgs = 0; }
  if (++rec.msgs > 400){       // a tile that floods the page is stopped like one that leaves its box
    const m = rec.m; sbxDrop(rec.id);
    SBX.paused[rec.id] = tr("This tile sent too many messages, so it was stopped. It stays off until the screen restarts.");
    sbxNote("“" + m.name + "” sent too many messages and was stopped.");
    if (document.contains(rec.el)) sbxSay(rec.el, SBX.paused[rec.id]);
    return;
  }
  const m = rec.m;
  if (d.ct === "ready" && !rec.ready) sbxInit(rec);
  else if (!rec.ready) return;
  else if (d.ct === "state"){
    const was = SBX.has[m.id] || {}, has = d.has !== false, urgent = d.urgent === true;
    SBX.has[m.id] = {has, urgent, at:now};
    if (was.has !== has || !!was.urgent !== urgent){ stackTick(); const el = MOUNTED[m.id]; if (el && !el.parentNode.classList.contains("stack")){ el.hidden = !has && !EDIT.on; portraitFlow(el.closest(".cgrid")); } }
  }
  else if (d.ct === "ask" && ["events", "sources", "feed", "devices"].includes(d.what) && rec.asks.size < 50){
    const arg = sbxPlain(d.arg), key = d.what + ":" + JSON.stringify(arg);
    if (!rec.asks.has(key)) rec.asks.set(key, {what:d.what, arg, j:null});
    sbxUpdate(rec, true);
  }
  else if (d.ct === "fetch" && typeof d.url === "string" && d.url.length <= 2000) sbxFetch(rec, d.url, Math.min(3600, Math.max(30, +d.maxAge || 300)));
  else if (d.ct === "store" && tileUsesStore(m) && sbxOk(d.ops)) tileWrite(m.id, sbxPlain(d.ops), d.unless && typeof d.unless === "object" ? sbxPlain(d.unless) : undefined);
  else if (d.ct === "swipe" && (d.dir === 1 || d.dir === -1)){      // a swipe across a tile that takes taps turns the page
    if (!EDIT.on && !SOLO && !PREVIEW && m.taps && NIGHT.mode !== "night" && now - (SBX.swipedAt || 0) > 1500){
      SBX.swipedAt = now; showPage(Math.max(0, Math.min(dayCount() - 1, PAGE + d.dir)));
    }
  }
  else if (d.ct === "hold"){      // a finger held on a tile that takes taps: start editing with it, like any tile
    if (!EDIT.on && !SOLO && !PREVIEW && m.taps && now - (SBX.heldAt || 0) > 10e3){ SBX.heldAt = now; editEnter(m.id); }
  }
    else if (d.ct === "error") reportErr("community tile " + m.type, String(d.msg || "").slice(0, 200));
});
// every second (from tick): frames for tiles that came into view, frames for tiles gone for a minute dropped
function sbxTick(){
  const now = Date.now();
  if (SBX.lastTick) SBX.gap = Math.max(SBX.gap, now - SBX.lastTick);
  SBX.lastTick = now;
  for (const rec of SBX.frames.values()){ const want = sbxWanted(rec.el); if (!want && !rec.gone) rec.gone = now; else if (want) rec.gone = 0; }
  if (!SBX.safe) for (const id of Object.keys(MOUNTED)){
    const m = MODULES[id], el = MOUNTED[id];
    if (!m || !m.community || SBX.paused[id]) continue;
    const rec = SBX.frames.get(id), want = sbxWanted(el);
    if (want && (!rec || rec.el !== el)) sbxRender(m, el);
  }
  for (const rec of SBX.frames.values()) if (rec.ready && !rec.gone && Object.keys(rec.m.devices || {}).length) sbxDevicesLoad(rec);
  for (const rec of [...SBX.frames.values()]){
    if (!document.contains(rec.el) || (rec.gone && now - rec.gone > 60e3)){ sbxDrop(rec.id); if (document.contains(rec.el)) sbxSay(rec.el, ""); }
  }
  if (now - SBX.lastBeat >= SBX.beat * 1000) sbxBeat();
}
// tell the server which community tiles are running here; with none running (and nothing new to say) stay quiet
function sbxBeat(force, extra){
  if (!sbxReports()) return;
  const showing = [...SBX.frames.values()].map(r => r.m.name);
  if (!showing.length && !SBX.wasShowing && !SBX.notes.length && !force && !extra) return;
  SBX.wasShowing = showing.length > 0; SBX.lastBeat = Date.now();
  const body = Object.assign({session:SBX.session, showing, gap:SBX.gap, notes:SBX.notes.splice(0)}, extra || {});
  SBX.gap = 0;
  fetch("/sandbox/beat", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body), keepalive:true})
    .then(r => r.json()).then(j => {
      if (j && j.safe && !SBX.safe){ SBX.safe = true; for (const id of [...SBX.frames.keys()]) sbxDrop(id); render(); }
    }).catch(() => {});
}
// at start: a screen that keeps restarting with community tiles on it turns them off (sandbox.py, 3 times in 10 minutes).
// A start after this page closed normally (going to Controls and back, a reload after a settings change) isn't one:
// the page that left said so in sessionStorage, which a tile's frame can't reach
function sbxBoot(){
  const onPage = Object.keys(MOUNTED).filter(id => MODULES[id] && MODULES[id].community).map(id => MODULES[id].name);
  let left = null;
  try{ left = JSON.parse(sessionStorage.getItem("sbxLeft") || "null"); sessionStorage.removeItem("sbxLeft"); }catch(e){}
  const clean = !!left && Date.now() - (+left.at || 0) < 3600e3;
  if (clean && left.session) sbxBye(left.session);       // in case the page's own goodbye was lost on the way out
  if (onPage.length && !SBX.safe) sbxBeat(true, {boot:true, onPage, clean});
}
function sbxBye(session){
  if (!sbxReports()) return;
  try{ fetch("/sandbox/beat", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({session, showing:[], gap:0, bye:true}), keepalive:true}).catch(() => {}); }catch(e){}
}
// leaving the page (Controls, a reload, the shell swapping in a new dashboard): say goodbye, so the server doesn't
// take the quiet that follows for a frozen screen. A frozen page can't get here
function sbxLeave(){
  try{ sessionStorage.setItem("sbxLeft", JSON.stringify({at:Date.now(), session:SBX.wasShowing ? SBX.session : ""})); }catch(e){}
  if (!sbxReports() || !SBX.wasShowing) return;
  SBX.wasShowing = false;
  const body = JSON.stringify({session:SBX.session, showing:[], gap:0, bye:true});
  try{ if (navigator.sendBeacon && navigator.sendBeacon("/sandbox/beat", new Blob([body], {type:"application/json"}))) return; }catch(e){}
  try{ fetch("/sandbox/beat", {method:"POST", headers:{"Content-Type":"application/json"}, body, keepalive:true}); }catch(e){}
}
window.addEventListener("pagehide", sbxLeave);
document.addEventListener("visibilitychange", () => { if (document.hidden && SBX.wasShowing){ SBX.frames.forEach(r => { r.gone = r.gone || Date.now(); }); sbxBeat(true, {showing:[]}); SBX.wasShowing = false; } });

/* ---------- control tiles: buttons the dashboard draws for a tile, outside its frame ----------
   The tile file lists its device slots and one button per thing it can do. The buttons are made here, from that list
   alone, and labelled from the action and the device the person picked, never from anything the tile's code says.
   A tap only counts when it's a real one (isTrusted), one at a time, and never while editing or previewing. The
   server checks it again against the saved grant (server/controls.py). Locks, garage doors and alarms always come
   back with a confirm, drawn here over the tile, that needs a second real tap. */
const SBX_ROW = 56, SBX_MIN_W = 120;      // a row of buttons below the frame, each at least this wide
// as many buttons in a row as fit, in one or two rows (more than that scroll sideways)
function sbxStripLayout(m, el, cs){
  const n = (m.controls || []).length;
  if (!n) return {h:0};
  const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const per = Math.max(1, Math.floor((w + 8) / SBX_MIN_W)), rows = n > per ? 2 : 1;
  return {h:rows * SBX_ROW + (rows - 1) * 8 + 8, rows, cols:rows === 1 ? n : Math.max(per, Math.ceil(n / 2))};
}
const SBX_VERB = {turn_on:"Turn on", turn_off:"Turn off", toggle:"Switch", lock:"Lock", unlock:"Unlock", open:"Open",
  open_cover:"Open", close_cover:"Close", stop_cover:"Stop", press:"Press", media_play_pause:"Play or pause", media_play:"Play",
  media_pause:"Pause", media_stop:"Stop", media_next_track:"Next", media_previous_track:"Previous", volume_up:"Louder",
  volume_down:"Quieter", start:"Start", pause:"Pause", stop:"Stop", return_to_base:"Send home", disarm:"Disarm",
  arm_home:"Arm (home)", arm_away:"Arm (away)", arm_night:"Arm (night)", arm_vacation:"Arm (vacation)",
  select_next:"Next", select_previous:"Previous"};
function sbxVerb(c){
  const vals = Object.values(c.data || {}).map(String).join(" ");
  if (SBX_VERB[c.action]) return tr(SBX_VERB[c.action]) + (vals ? " " + vals : "");
  return tr("Set") + (vals ? " " + vals : "");
}
// {slot: Home Assistant entity id} for the slots the person filled, each of a kind the slot allows
function sbxGrants(m){
  const out = {};
  for (const [k, d] of Object.entries(m.devices || {})){
    const e = m.s["@" + k];
    if (typeof e === "string" && d.domains.includes(e.split(".")[0])) out[k] = e;
  }
  return out;
}
// what this.devices() answers inside the frame: the state of each picked device, by slot (demo states in previews)
function sbxDevices(m){
  if (SOLO || PREVIEW || STILL || TRIAL_ID) return sbxPlain((m.demoData || {}).devices || {});
  const c = m._dv || {}, S = c.states || {}, out = {};
  for (const [k, e] of Object.entries(sbxGrants(m))) out[k] = S[e] ? sbxPlain(S[e]) : null;
  return out;
}
function sbxDevicesLoad(rec){
  const m = rec.m, g = sbxGrants(m), ids = Object.values(g), c = m._dv = m._dv || {at:0, busy:false, states:{}};
  if (SOLO || PREVIEW || STILL || TRIAL_ID || !ids.length || c.busy || Date.now() - c.at < 5000) return;
  c.busy = true;
  getJSON("/ha/states?src=" + encodeURIComponent(m.s["@src"] || "") + "&ids=" + encodeURIComponent(ids.join(",")))
    .then(j => { const S = {}; for (const o of j.states || []) S[o.id] = o; c.states = S; c.error = j.error || ""; }, e => { c.error = String(e.message || e); })
    .finally(() => { c.busy = false; c.at = Date.now(); const r = SBX.frames.get(m.id); if (r) sbxUpdate(r, true); });
}
function sbxControls(rec, cs, lay){
  const c = document.createElement("div");
  c.className = "sbxc";
  c.style.cssText = "left:" + cs.paddingLeft + ";right:" + cs.paddingRight + ";bottom:" + cs.paddingBottom + ";height:" + (lay.h - 8) + "px" +
    ";grid-template-columns:repeat(" + lay.cols + ",minmax(" + (lay.cols * SBX_MIN_W > rec.el.clientWidth ? SBX_MIN_W + "px" : "0") + ",1fr))";
  c.addEventListener("click", e => sbxControlTap(rec, e));
  rec.c = c; rec.busy = false;
  rec.el.appendChild(c);
  sbxControlsDraw(rec);
}
function sbxControlsDraw(rec){
  const m = rec.m, g = sbxGrants(m), S = (m._dv || {}).states || {}, many = Object.keys(m.devices || {}).length > 1;
  const name = slot => { const e = g[slot]; return (e && S[e] && S[e].name) || (e ? e : m.devices[slot].label); };
  const h = (m.controls || []).map(c => '<button data-sbxc="' + esc(c.id) + '"' + (g[c.device] ? "" : ' class="off"') + '>' + esc(sbxVerb(c)) +
    (many ? '<small>' + esc(name(c.device)) + '</small>' : "") + '</button>').join("") +
    (rec.say ? '<span class="sbxcmsg">' + esc(rec.say) + '</span>' : "");
  if (rec.c._h !== h){ rec.c._h = h; rec.c.innerHTML = h; }
  rec.c.style.pointerEvents = tileQuiet() ? "none" : "auto";
}
function sbxControlSay(rec, text, ms){
  rec.say = text; sbxControlsDraw(rec);
  clearTimeout(rec.sayT);
  if (text) rec.sayT = setTimeout(() => { rec.say = ""; if (rec.c) sbxControlsDraw(rec); }, ms || 5000);
}
async function sbxControlSend(rec, id, confirm){
  if (rec.busy) return;
  rec.busy = true;
  try{
    const r = await fetch("/tile-act/" + encodeURIComponent(rec.m.id), {method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({action:"tile.control", args:confirm ? {control:id, confirm} : {control:id}})});
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || ("error " + r.status));
    if (j.confirm) return sbxConfirm(rec, id, j);
    sbxControlSay(rec, "");
    if (rec.m._dv) rec.m._dv.at = 0;           // show the new state soon
  }catch(e){ sbxControlSay(rec, tr("Didn't work: {why}", {why:String(e.message || e).slice(0, 120)}), 6000); }
  finally{ rec.busy = false; }
}
function sbxControlTap(rec, e){
  const b = e.target.closest("[data-sbxc]");
  if (!b || !e.isTrusted || tileQuiet() || SBX.frames.get(rec.id) !== rec) return;
  e.stopPropagation();
  sbxControlSend(rec, b.dataset.sbxc);
}
// the second tap for a lock, a garage door or an alarm, drawn by the dashboard over the whole tile
function sbxConfirm(rec, id, j){
  const c = (rec.m.controls || []).find(x => x.id === id); if (!c) return;
  const box = document.createElement("div"), secs = Math.max(2, Math.min(15, +j.seconds || 6));
  box.className = "sbxconf";
  box.innerHTML = '<p>' + esc(tr("{verb} {name}?", {verb:sbxVerb(c), name:String(j.name || "")})) + '</p><div><button class="yes">' + esc(sbxVerb(c)) +
    '</button><button class="no">' + esc(tr("Cancel")) + '</button></div>';
  const done = () => { clearTimeout(t); box.remove(); };
  const t = setTimeout(done, secs * 1000);
  box.addEventListener("click", e => {
    e.stopPropagation();
    if (!e.isTrusted) return;
    if (e.target.closest(".yes")){ done(); if (SBX.frames.get(rec.id) === rec && !tileQuiet()) sbxControlSend(rec, id, j.confirm); }
    else if (e.target.closest(".no")) done();
  });
  if (rec.conf) rec.conf.remove();
  rec.conf = box;
  rec.el.appendChild(box);
}
