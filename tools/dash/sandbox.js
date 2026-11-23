/* ---------- community tiles: each one runs in its own sandboxed frame (tools/server/sandbox.py, tools/sandbox/) ----------
   The frame has no network and no way into this page. Everything it gets comes from here, by message, and only
   what its tile declared: its own settings and stored data, the shared data in its `feeds`, and web addresses on its
   `hosts`, read by the server. A message is matched to its frame by where it came from, never by anything it says.
   Frames run only for tiles on the page that's showing, at most SBX.max at once. A frame that loads a second time
   has navigated away and is removed. While a frame runs, this page checks in with the server every few seconds: an
   endless loop in a frame freezes the whole page on the Echo, and the server turns on safe mode when it goes quiet. */
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
    Tile(t.type, {title:t.title, desc:t.desc, cat:"Community", size:t.size, settings:t.settings || {}, feeds:t.feeds || [], uses:t.uses || [],
      every:t.every || 0, demo:t.demo || {}, demoData:t.demoData || {}, lang:t.lang || {}, hosts:t.hosts || [], taps:!!t.taps, version:t.version,
      author:t.author, personal:t.personal || [], community:true, api:1, card:true, noFit:true, cls:"m-sbx",
      render(el){ sbxRender(this, el); },
      has(){ return sbxHas(this); },
      urgent(){ return !!(SBX.has[this.id] || {}).urgent; },
      hide(){ /* the frame stays a minute in case the tile comes back (sbxTick) */ }});
  }
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
  const cs = getComputedStyle(el);
  f.style.cssText = "top:" + cs.paddingTop + ";right:" + cs.paddingRight + ";bottom:" + cs.paddingBottom + ";left:" + cs.paddingLeft +
    ";width:calc(100% - " + cs.paddingLeft + " - " + cs.paddingRight + ");height:calc(100% - " + cs.paddingTop + " - " + cs.paddingBottom + ")";
  const rec = {id:m.id, m, el, f, loads:0, ready:false, gone:0, asks:new Map(), sent:{}, msgs:0, msgT:Date.now()};
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
  return null;
}
// send the frame whatever changed since last time, and ask it to draw
function sbxUpdate(rec, draw){
  if (!rec.ready) return;
  const m = rec.m, msg = {ct:"update", draw:!!draw}, put = (k, v) => { const j = JSON.stringify(v); if (rec.sent[k] !== j){ rec.sent[k] = j; msg[k] = v; } };
  put("s", m.s); put("name", m.name); put("quiet", tileQuiet()); put("taps", !!m.taps && !tileQuiet());
  if (tileUsesStore(m)) put("store", {data:m.store.get(), ready:m.store.ready});
  const answers = {};
  for (const [key, a] of rec.asks){ const v = sbxAnswer(m, a.what, a.arg), j = JSON.stringify(v); if (a.j !== j){ a.j = j; answers[key] = v; } }
  if (Object.keys(answers).length) msg.answers = answers;
  rec.f.style.pointerEvents = m.taps && !tileQuiet() ? "auto" : "none";
  sbxPost(rec, msg);
}
function sbxInit(rec){
  const m = rec.m, fetched = {};
  for (const [u, c] of Object.entries(m._sf || {})) if (c.at) fetched[u] = {data:c.data, error:c.error, at:c.at};
  rec.ready = true;
  rec.sent = {s:JSON.stringify(m.s), name:JSON.stringify(m.name), quiet:JSON.stringify(tileQuiet()), taps:JSON.stringify(!!m.taps && !tileQuiet())};
  const store = tileUsesStore(m) ? {data:m.store.get(), ready:m.store.ready} : {data:{}, ready:true};
  rec.sent.store = JSON.stringify(store);
  rec.f.style.pointerEvents = m.taps && !tileQuiet() ? "auto" : "none";
  sbxPost(rec, {ct:"init", id:m.id, s:m.s, name:m.name, quiet:tileQuiet(), taps:!!m.taps && !tileQuiet(), store, fetched,
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
  else if (d.ct === "ask" && ["events", "sources", "feed"].includes(d.what) && rec.asks.size < 50){
    const arg = sbxPlain(d.arg), key = d.what + ":" + JSON.stringify(arg);
    if (!rec.asks.has(key)) rec.asks.set(key, {what:d.what, arg, j:null});
    sbxUpdate(rec, true);
  }
  else if (d.ct === "fetch" && typeof d.url === "string" && d.url.length <= 2000) sbxFetch(rec, d.url, Math.min(3600, Math.max(30, +d.maxAge || 300)));
  else if (d.ct === "store" && tileUsesStore(m) && sbxOk(d.ops)) tileWrite(m.id, sbxPlain(d.ops), d.unless && typeof d.unless === "object" ? sbxPlain(d.unless) : undefined);
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
// at start: a screen that keeps restarting with community tiles on it turns them off (sandbox.py, 3 times in 10 minutes)
function sbxBoot(){
  const onPage = Object.keys(MOUNTED).filter(id => MODULES[id] && MODULES[id].community).map(id => MODULES[id].name);
  if (onPage.length && !SBX.safe) sbxBeat(true, {boot:true, onPage});
}
document.addEventListener("visibilitychange", () => { if (document.hidden && SBX.wasShowing){ SBX.frames.forEach(r => { r.gone = r.gone || Date.now(); }); sbxBeat(true, {showing:[]}); SBX.wasShowing = false; } });
