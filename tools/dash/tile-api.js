/* ---------- shared helpers ---------- */
function evDate(e){ return /^\d{4}-\d{2}-\d{2}$/.test(e.start || "") ? new Date(e.start + "T00:00:00") : new Date(e.start); }
function fmtTime(d){ return isNaN(d) ? "" : d.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"}); }
function shortTime(d){ return LOOK.h24 ? fmtTime(d) : fmtTime(d).replace(":00", "").replace(/\s?([AP])M/i, (m, x) => x.toLowerCase()); }
function dayKey(d){ return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
function startOfDay(d){ const x = new Date(d); x.setHours(0,0,0,0); return x; }
function cToF(n){ return Math.round(n); }
function teamShort(n){
  n = n || "Team";
  const caps = n.split(/\s+/).find(w => w.length >= 3 && w === w.toUpperCase() && /[A-Z]/.test(w));
  return caps || n.split(/\s+/).map(w => w[0]).join("").slice(0, 4).toUpperCase();
}
function holidayOn(d){ const k = dayKey(d); const h = holidaysIn(d.getFullYear()).find(x => dayKey(x.d) === k); return h ? h.t : ""; }
// collapse repeats (weekly shows) into their next showing, tagged
function collapseRepeats(list){
  const groups = new Map();
  for (const e of list){ const k = (e.summary || "").toLowerCase(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  return [...groups.values()].map(g => {
    const e = Object.assign({}, g[0]);
    if (g.length > 1){
      const gaps = g.slice(1).map((x, i) => Math.round((evDate(x) - evDate(g[i])) / 86400e3));
      if (gaps.every(x => x === 7)) e.rep = "every " + evDate(g[0]).toLocaleDateString([], {weekday:"short"});
      else if (gaps.every(x => x === 1)) e.rep = "daily";
      else e.rep = "+" + (g.length - 1) + " more";
    }
    return e;
  }).sort((a, b) => evDate(a) - evDate(b));
}
// calendars: cals = list of calendar source ids a tile picked (empty = all of them)
const calEvents = cals => (cals && cals.length ? STATE.events.filter(e => cals.includes(e.cal)) : STATE.events);
function upcoming(cals){
  const cutoff = Date.now() - 3600e3, today0 = startOfDay(new Date()).getTime();
  return calEvents(cals).filter(e => { const t = evDate(e).getTime(); return isNaN(t) ? false : (e.allDay ? t >= today0 : t >= cutoff); });
}
function eventsOn(day, cals){
  const k = dayKey(day);
  return calEvents(cals).filter(e => { const d = evDate(e); return !isNaN(d) && dayKey(d) === k; });
}
// sports: teams = team source ids (empty = all set up); returns [{g, team}] for matches that day
function teamMatchesOn(day, teams){
  const k = dayKey(day), out = [];
  for (const id of (teams && teams.length ? teams : Object.keys(STATE.teams))){
    const t = STATE.teams[id]; if (!t) continue;
    for (const g of [t.next, t.last].concat(t.upcoming || [])) if (g && g.date && dayKey(new Date(g.date)) === k){ out.push({g, team:t.team}); break; }
  }
  return out;
}


/* clock and weather styles: a preset picks the layout and a font; font, size, alignment and parts can be changed on top */
const FONTS = {System:'-apple-system,system-ui,"Segoe UI",Roboto,sans-serif', Outfit:'"Outfit",system-ui,sans-serif', "Bebas Neue":'"Bebas Neue",Impact,sans-serif',
  "DM Serif Display":'"DM Serif Display",Georgia,serif', Fraunces:'"Fraunces",Georgia,serif', "JetBrains Mono":'"JetBrains Mono",ui-monospace,monospace',
  Nunito:'"Nunito",system-ui,sans-serif', "Space Grotesk":'"Space Grotesk",system-ui,sans-serif'};
const STYLE_FONT = {classic:"System", bold:"Bebas Neue", serif:"DM Serif Display", digital:"JetBrains Mono", rounded:"Nunito", stacked:"Outfit", minimal:"Outfit",
  "big-temperature":"Outfit", compact:"System", "big-icon":"Nunito"};
const slug = x => String(x || "Classic").toLowerCase().replace(/\s+/g, "-");
function styleBox(m, s, st, defAlign){
  const f = !s.font || s.font === "Style default" ? STYLE_FONT[st] : s.font;
  m.style.fontFamily = FONTS[f] || "";
  m.style.setProperty("--cz", Math.max(.6, Math.min(1.6, (+s.size || 100) / 100)));
  const a = (s.align || defAlign).toLowerCase(), jc = a === "left" ? "flex-start" : a === "center" ? "center" : "flex-end";
  m.style.textAlign = a; m.style.setProperty("--jc", jc);
}
const IN_SEASON = [
  ["🍊 Citrus", "🥬 Kale", "🍠 Sweet potatoes", "🎃 Winter squash", "🥬 Cabbage"],
  ["🍊 Citrus", "🥬 Kale", "🧅 Leeks", "🍠 Sweet potatoes", "🥬 Cabbage"],
  ["🥬 Spinach", "🧅 Leeks", "🌱 Asparagus", "🔴 Radishes", "🍊 Citrus"],
  ["🌱 Asparagus", "🥬 Spinach", "🌿 Rhubarb", "🔴 Radishes", "🫛 Peas"],
  ["🍓 Strawberries", "🌱 Asparagus", "🫛 Peas", "🥬 Lettuce", "🌿 Rhubarb"],
  ["🍓 Strawberries", "🫐 Blueberries", "🥒 Zucchini", "🍒 Cherries", "🫘 Green beans"],
  ["🍑 Peaches", "🌽 Sweet corn", "🍅 Tomatoes", "🫐 Blackberries", "🥒 Cucumbers"],
  ["🌽 Sweet corn", "🍅 Tomatoes", "🍑 Peaches", "🍈 Melons", "🫑 Peppers"],
  ["🍎 Apples", "🍇 Grapes", "🫑 Peppers", "🍐 Pears", "🍠 Sweet potatoes"],
  ["🍎 Apples", "🎃 Pumpkins", "🎃 Winter squash", "🍐 Pears", "🍠 Sweet potatoes"],
  ["🍎 Apples", "🎃 Pumpkins", "🍠 Sweet potatoes", "🔴 Cranberries", "🥬 Brussels sprouts"],
  ["🍊 Citrus", "🍠 Sweet potatoes", "🎃 Winter squash", "🥬 Brussels sprouts", "🥬 Kale"]
];
/* ---------- sales: usual items in this week's ads (server matches, /sales) ---------- */
function dealName(d){
  const n = String(d.name || d.want || "").replace(/\b\d[\d.\-–\/]*\s*-?\s*(fl\.?\s*oz|oz|ct|pk|pack|lb|lbs|count|ounce|gal|ml|l)\b\.?/gi, "")
    .replace(/\s+(or|,)\s*$/i, "").replace(/\s{2,}/g, " ").trim();
  return n.charAt(0).toUpperCase() + n.slice(1);
}
function dealRow(d){
  const usual = d.usual && d.now && d.usual > d.now + 0.05 ? '<em>usually $' + d.usual.toFixed(2) + '</em>' : (d.story && !/^\s*(on )?sale\s*$/i.test(d.story) ? '<em>' + esc(d.story.slice(0, 40)) + '</em>' : "");
  return '<div class="dr"><b>' + esc(dealName(d)) + '</b><span>' + esc(!d.price || /^\s*sale\s*$/i.test(d.price) ? "On sale" : d.price) + '</span><i>' + esc(d.store) + '</i>' + usual + '</div>';
}
function deals(){ const d = STATE.sales; return d && d.deals ? d.deals : []; }
function dealFor(text){   // a list item that is on sale this week
  const k = String(text).toLowerCase();
  return deals().find(d => d.why === "onlist" && String(d.want).toLowerCase() === k);
}

/* text tiles (on this day, dad joke, kitchen tip): fade to a new item; a punchline shows a few seconds later */
function funShow(el, item, punchAfter){
  if (!el.querySelector(".tx")) el.innerHTML = '<h3 class="hd"></h3><div class="tx"></div>';
  const tx = el.querySelector(".tx"), first = !tx.textContent;
  tx.classList.toggle("fade", !first);
  setTimeout(() => {
    el.querySelector(".hd").textContent = item.h;
    tx.innerHTML = esc(item.t) + (item.a ? '<span class="a" style="opacity:0">🥁 ' + esc(item.a) + '</span>' : "");
    tx.classList.remove("fade");
    if (el.parentNode && el.parentNode.classList.contains("slot")) cardFit(el);
    if (item.a) setTimeout(() => { const a = tx.querySelector(".a"); if (a) a.style.opacity = "1"; }, (punchAfter == null ? 7 : punchAfter) * 1000);
  }, first ? 0 : 800);
}
// a text tile picks a new item every s.every seconds (and right away when first drawn)
function funDue(el, s){ if (el._funAt && Date.now() - el._funAt < Math.max(15, s.every || 90) * 1000) return false; el._funAt = Date.now(); return true; }

/* ---------- tile types and tiles ---------- */
// A tile TYPE is defined in its own file in tools/tiles/ (served together as /tiles.js):
//   Tile("agenda", {title, cat, desc, size:[w, h, minW, minH], card, cls, feeds:["events"], every:60,
//                   settings:{key:{type, label, default, ...}}, has(), urgent(), takeover:"label", render(el), show(el), hide(el)})
// A TILE is one placed copy of a type with its own settings: CFG.tiles.settings.items = [{id, type, name, settings}].
// Boxes on pages hold tile ids; a box with several tiles shows them in turn.
const TYPES = {}, MODULES = {};
const CATS = ["Time", "Weather", "Calendar", "Lists & food", "Home", "Sports", "Photos & video", "Around you", "Money", "Fun", "Your own"];
function Tile(type, def){
  TYPES[type] = Object.assign(Object.create(TILE_API), {type, cat:"Fun", size:[12, 8, 8, 6], card:true, feeds:[], settings:{}}, def);
  if (def.css){ const st = document.createElement("style"); st.dataset.tile = type; st.textContent = def.css; document.head.appendChild(st); }     // a tile's own look
}
// data a tile fetches for itself (stocks, planes...): returns what it has now, refreshes in the background
// when older than maxAge seconds, and redraws the tile when new data arrives
function tileData(m, url, maxAge){
  const c = m._fd = m._fd || {};
  if (c.url !== url){ c.url = url; c.data = null; c.at = 0; }
  if (!c.busy && Date.now() - c.at > maxAge * 1000){
    c.busy = true;
    getJSON(url).then(d => { c.data = d; c.err = null; }, e => { c.err = String(e.message || e); })
      .finally(() => { c.busy = false; c.at = Date.now(); if (MODULES[m.id] === m) render(m.id); });
  }
  return c.data;
}
/* ---------- the tile API (docs/tile-api.md): what every tile can use through `this` ---------- */
// this.store   the tile's own data, kept by the server per tile (adding a second tile of a kind starts it empty)
// this.fetch   data from a web address, cached (same as tileData)
// this.feed    shared data the dashboard already loads: weather, events, notes, teams, albums, sales
// this.act     ask the server to do something the tile is set up to do (ha.call)
// tap(e, el) / submit(e, el, form) in a tile's definition get taps and form submits, except while editing or previewing
const TDATA = {rev:0, ready:false, tiles:{}};
const tileQuiet = () => EDIT.on || PREVIEW || !!SOLO || STILL || !!TRIAL_ID || !!TRIAL;   // looking, not using: nothing is written
const TILE_API = {
  api:0,
  get store(){ return tileStore(this); },
  fetch(url, maxAge){ return tileData(this, url, maxAge == null ? 300 : maxAge); },
  feed(name){ return STATE[{weather:"wx", air:"aqi"}[name] || name]; },
  // words in the screen's language: the tile's own lang block first, then tools/lang/<code>.json, then the English as written
  t(s, vars){ return tr(s, vars, this.lang && this.lang[I18N.lang]); },
  get locale(){ return I18N.locale; },          // for Intl calls that need it; [] already means the chosen language
  // ask the server to do something for this tile (tools/countertop.py TILE_ACTIONS); resolves with its answer,
  // rejects with its error. Nothing happens while editing or previewing.
  async act(action, args){
    if (tileQuiet()) throw new Error("Not while editing or previewing");
    const r = await fetch("/tile-act/" + encodeURIComponent(this.id), {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({action, args:args || {}})});
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || ("error " + r.status));
    return j;
  }
};
function tileUsesStore(m){ return (m.uses || []).includes("store"); }
function tileStore(m){
  const id = m.id, write = (ops, unless) => tileWrite(id, ops, unless);
  return {
    get ready(){ return TDATA.ready || !!SOLO; },
    get(){ return SOLO ? JSON.parse(JSON.stringify(m.demoData || {})) : (TDATA.tiles[id] || {}); },
    set:(key, value) => write([{op:"set", key, value}]),
    push:(key, item) => write([{op:"push", key, item:Object.assign({id:tileItemId()}, item)}]),
    update:(key, itemId, fields) => write([{op:"update", key, id:itemId, fields}]),
    remove:(key, itemId) => write([{op:"remove", key, id:itemId}]),
    updateAll:(key, fields) => write([{op:"updateAll", key, fields}]),
    removeWhere:(key, fields) => write([{op:"removeWhere", key, fields}]),
    change:(ops, unless) => write(ops, unless)          // several operations at once, all or nothing; skipped when the data already has `unless`
  };
}
function tileItemId(){ return Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7); }
// the same operations the server applies (tools/server/tiledata.py), so a tap shows at once
function tileApply(data, op){
  const list = k => Array.isArray(data[op.key]) ? data[op.key] : (data[op.key] = []);
  const match = (x, f) => x && Object.keys(f).every(k => x[k] === f[k]);
  if (op.op === "set"){ if (op.value == null) delete data[op.key]; else data[op.key] = op.value; }
  else if (op.op === "push") list().push(op.item);
  else if (op.op === "update") list().forEach(x => { if (x && x.id === op.id) Object.assign(x, op.fields); });
  else if (op.op === "updateAll") list().forEach(x => { if (x) Object.assign(x, op.fields); });
  else if (op.op === "remove") data[op.key] = list().filter(x => !(x && x.id === op.id));
  else if (op.op === "removeWhere") data[op.key] = list().filter(x => !match(x, op.fields));
}
async function tileWrite(id, ops, unless){
  if (tileQuiet()) return null;
  const was = TDATA.tiles[id] || {};
  if (unless && Object.keys(unless).every(k => JSON.stringify(was[k]) === JSON.stringify(unless[k]))) return was;
  const mine = JSON.parse(JSON.stringify(was));
  try{ ops.forEach(op => tileApply(mine, op)); TDATA.tiles[id] = mine; render(id); }catch(e){}
  try{
    const r = await fetch("/tile-data/" + encodeURIComponent(id), {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(unless ? {ops, unless} : {ops})});
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
    TDATA.tiles[id] = j.data;
  }catch(e){
    TDATA.tiles[id] = was; reportErr("tile data " + id, String(e.message || e));
  }
  render(id);
  return TDATA.tiles[id];
}
async function loadTileData(){
  if (SOLO || !Object.values(MODULES).some(tileUsesStore)) return;
  try{
    const j = await getJSON("/tile-data?since=" + (TDATA.ready ? TDATA.rev : 0));
    const ids = Object.keys(j.tiles || {});
    Object.assign(TDATA.tiles, j.tiles || {}); TDATA.rev = j.rev || 0;
    const first = !TDATA.ready; TDATA.ready = true;
    render(...(first ? Object.keys(MODULES).filter(id => tileUsesStore(MODULES[id])) : ids).filter(id => MOUNTED[id]));
  }catch(e){}
}
function tileHooks(el, m){
  if (el._hooked || !(m.tap || m.submit)) return;
  el._hooked = true;
  if (m.tap) el.addEventListener("click", e => { if (!EDIT.on && !PREVIEW && MODULES[m.id] === m) m.tap(e, el); });
  if (m.submit) el.addEventListener("submit", e => { e.preventDefault(); if (!EDIT.on && !PREVIEW && MODULES[m.id] === m) m.submit(e, el, e.target); });
}
function tileItems(){ const t = CFG && CFG.tiles; if (!t) return []; t.settings = t.settings || {}; return (t.settings.items = t.settings.items || []); }
function tileItem(id){ return tileItems().find(t => t.id === id); }
function typeDefaults(type){ const o = {}, S0 = (TYPES[type] || {}).settings || {}; for (const k in S0) o[k] = JSON.parse(JSON.stringify(S0[k].default === undefined ? null : S0[k].default)); return o; }
// shared settings every tile has (on top of its type's own)
const COMMON = {takeover:{type:"bool", label:"Take over the box when it matters", default:false}};
function tileMount(it){
  const T = TYPES[it.type]; if (!T) return null;
  it.settings = Object.assign(typeDefaults(it.type), it.settings || {});
  if (T.takeover && it.settings.takeover == null) it.settings.takeover = false;
  CFG[it.id] = {on:true, settings:it.settings};
  SCH[it.id] = {title:it.name || T.title, type:it.type};
  const m = Object.create(T);
  m.id = it.id; m.it = it;
  Object.defineProperty(m, "s", {get(){ return it.settings; }});
  Object.defineProperty(m, "name", {get(){ return it.name || m.t(T.title); }});
  return (MODULES[it.id] = m);
}
function tilesSetup(){
  for (const k in MODULES) delete MODULES[k];
  for (const it of tileItems()) tileMount(it);
}
let tileSeq = 0;
function newTile(type, settings, name){
  const T = TYPES[type]; if (!T) return null;
  let id; do id = type.slice(0, 6) + "_" + Date.now().toString(36).slice(-4) + (tileSeq++); while (tileItem(id));
  const it = {id, type, settings:Object.assign(typeDefaults(type), settings || {})};
  if (name) it.name = name;
  tileItems().push(it); tileMount(it);
  return id;
}
function dropTileItem(id){ const L = tileItems(), i = L.findIndex(t => t.id === id); if (i >= 0) L.splice(i, 1); delete MODULES[id]; delete CFG[id]; delete SCH[id]; }
const tsize = id => { const m = MODULES[id] || TYPES[id]; return (m && m.size) || [12, 8, 8, 6]; };
function titleOf(id){ const m = MODULES[id]; return m ? m.name : (TYPES[id] || {}).title || id; }
// feeds: shared data that tiles declare they use; a tile redraws when its feed loads
const usesFeed = f => Object.values(MODULES).some(m => (m.feeds || []).includes(f));
function renderFeed(...F){ render(...Object.keys(MOUNTED).filter(id => MODULES[id] && (MODULES[id].feeds || []).some(f => F.includes(f)))); }

