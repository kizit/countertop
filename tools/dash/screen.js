/* ---------- layout: every page is a grid of boxes ---------- */
const MOUNTED = {};                                  // tile id → element
const PORTQ = matchMedia("(orientation:portrait)");
// the screen turned (or the editor switched arrangement): put every box where it goes now
function placeAll(){
  document.body.classList.toggle("portrait", ori() === "p");
  document.querySelectorAll(".cgrid").forEach(g => { if (g._boxes) for (const [s, d] of g._boxes) placeSlot(d, s, g._pg); });
}
PORTQ.addEventListener && PORTQ.addEventListener("change", () => { if (!EDIT.on){ placeAll(); render(); } });
function layout(){
  document.body.classList.toggle("portrait", ori() === "p");
  for (const id in MOUNTED){ const m = MODULES[id]; if (m && m.hide && MOUNTED[id]._shownT) try{ m.hide(MOUNTED[id]); }catch(e){} delete MOUNTED[id]; }
  const SLOT = cpagesBuild();
  for (const id of Object.keys(SLOT)){
    const m = MODULES[id]; if (!m) continue;
    const el = document.createElement(m.card ? "section" : "div");
    el.className = (m.card ? "card " : "") + (m.cls || "");
    el.dataset.mod = id; el.dataset.type = m.type;
    if (SLOT[id].classList.contains("stack")) el.classList.add("stk-off");      // stackTick picks whose turn it is
    SLOT[id].appendChild(el); MOUNTED[id] = el;
  }
  buildPages();
}
// has(): something to show (a stack skips it otherwise); urgent(): wants the box now (if its takeover is on)
function tileHas(id){ const m = MODULES[id]; try{ return !m.has || !!m.has(); }catch(e){ return true; } }
function tileUrgent(id){ const m = MODULES[id]; try{ return !!(m.urgent && m.s.takeover && m.urgent()); }catch(e){ return false; } }
function render(...ids){
  for (const id of (ids.length ? ids : Object.keys(MOUNTED))){
    const el = MOUNTED[id], m = MODULES[id]; if (!el || !m) continue;
    const alone = !el.parentNode || !el.parentNode.classList.contains("stack");
    if (alone){ const v = tileHas(id) || (EDIT && EDIT.on); if (el.hidden !== !v){ el.hidden = !v; portraitFlow(el.closest(".cgrid")); } if (!v) continue; }
    if (el.classList.contains("stk-off") && !m.drawHidden) continue;      // not its turn: draw when it comes up
    try{
      m.render(el); tileHooks(el, m);
      if (!el._shownT){ el._shownT = Date.now(); if (m.show) m.show(el); }
      if (el.parentNode && el.parentNode.classList.contains("slot")){ slotFit(el, m); if (m.card && !m.noFit) cardFit(el); }
    }catch(e){ reportErr("tile " + id, e.message || String(e)); }
  }
}

/* ---------- shared by the weather and map tiles ---------- */
const WET = c => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;
const SNOWY = c => (c >= 71 && c <= 77) || c === 85 || c === 86;
function hourlyFrom(j, hours){
  // the forecast's hourly rows from this hour on
  if (!j || !j.hourly || !j.hourly.time) return [];
  const H = j.hourly, now = Date.now() - 3600e3, out = [];
  for (let i = 0; i < H.time.length && out.length < hours; i++){
    const t = new Date(H.time[i]).getTime();
    if (t < now) continue;
    out.push({t, temp:H.temperature_2m[i], pp:H.precipitation_probability ? H.precipitation_probability[i] : 0,
      code:H.weather_code ? H.weather_code[i] : 0, day:H.is_day ? H.is_day[i] !== 0 : true});
  }
  return out;
}
// when rain (or snow) is near: {inMin, kind, pp} or null
function rainSoon(s){
  s = s || {}; const j = STATE.wx;
  if (!j || !j.current) return null;
  const c = j.current.weather_code;
  if (WET(c) || SNOWY(c)) return {inMin:0, kind: SNOWY(c) ? "Snow" : c >= 95 ? "Storms" : "Rain", pp:100};
  const rows = hourlyFrom(j, (s.hours || 2) + 1), lim = s.chance || 40;
  for (const r of rows){
    if (r.t > Date.now() + (s.hours || 2) * 3600e3) break;
    if (r.pp >= lim || WET(r.code) || SNOWY(r.code))
      return {inMin: Math.max(0, Math.round((r.t - Date.now()) / 60e3)), kind: SNOWY(r.code) ? "Snow" : r.code >= 95 ? "Storms" : "Rain", pp:r.pp};
  }
  return null;
}

/* web-mercator tiles placed as <img>s (no canvas, so cross-origin tiles are fine) */
const TILE = {
  x(lon, z){ return (lon + 180) / 360 * 256 * Math.pow(2, z); },
  y(lat, z){ const s = Math.sin(lat * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * Math.pow(2, z); },
  // fill `layer` with tiles of zoom zt drawn in zoom-z pixel space, centered at (cx, cy)
  fill(layer, urlFn, zt, z, cx, cy, W, H, cls){
    const P = 256 * Math.pow(2, z - zt), n = Math.pow(2, zt), x0 = cx - W / 2, y0 = cy - H / 2;
    let h = "";
    for (let ty = Math.floor(y0 / P); ty <= Math.floor((y0 + H) / P); ty++){
      if (ty < 0 || ty >= n) continue;
      for (let tx = Math.floor(x0 / P); tx <= Math.floor((x0 + W) / P); tx++){
        const wx = ((tx % n) + n) % n;
        h += '<img class="' + (cls || "") + '" alt="" src="' + urlFn(zt, wx, ty) + '" style="left:' + Math.round(tx * P - x0) + 'px;top:' +
          Math.round(ty * P - y0) + 'px;width:' + Math.ceil(P) + 'px;height:' + Math.ceil(P) + 'px">';
      }
    }
    layer.innerHTML = h;
  }
};
// base map: OpenStreetMap's own tiles (free, no key; CARTO's dark maps now need one), darkened with a CSS filter
const OSM = (z, x, y) => "https://tile.openstreetmap.org/" + z + "/" + x + "/" + y + ".png";
const OSM_CREDIT = '<div class="ovl osmc">© OpenStreetMap</div>';


// a tile drawn by a "view" object (maps, charts, video): built once, then shown, ticked and hidden as its box needs
function viewTile(type, meta, view){
  Tile(type, Object.assign({cls:"m-stage", every:1, noFit:true,
    render(el){
      let v = el._v;
      if (!v){ v = el._v = Object.create(view); v.s = this.s; v.tile = this; el.innerHTML = '<div class="view on v-' + type + '"></div>'; v.build(el.firstChild); }
      if (!v.active){ v.active = true; try{ v.show(); }catch(e){ reportErr("tile " + type, e.message || String(e)); } }
      else if (v.tick) v.tick();
    },
    hide(el){ const v = el._v; if (v && v.active){ v.active = false; v.hide && v.hide(); } }
  }, meta));
}

/* ---------- data feeds (shared by tiles; only loaded when some tile uses them) ---------- */
window.FEEDAT = {};          // when each feed last loaded here; the shell sends it with its heartbeat (Controls > Status)
async function loadWeather(){
  try{
    const g = S("general");
    if (!g.lat && !g.lon){ STATE.wx = null; STATE.noLoc = true; renderFeed("wx"); return; }
    STATE.noLoc = false;
    const u = "https://api.open-meteo.com/v1/forecast?latitude=" + g.lat + "&longitude=" + g.lon
      + "&current=temperature_2m,weather_code,is_day"
      + "&hourly=temperature_2m,precipitation_probability,weather_code,is_day"
      + "&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,precipitation_probability_max"
      + "&timezone=auto&forecast_days=11" + (g.units === "C" ? "" : "&temperature_unit=fahrenheit&wind_speed_unit=mph");
    const j = await getJSON(u);
    STATE.wx = j; FEEDAT.wx = Date.now(); FEEDAT.wxErr = ""; STATE.isDay = j.current.is_day !== 0; STATE.tempNow = Math.round(j.current.temperature_2m);
    try{ STATE.rain = rainNote(j, j.current.weather_code); }catch(e){ STATE.rain = ""; }
    if (j.daily.sunrise){ sunT = {rise:new Date(j.daily.sunrise[0]).getTime(), set:new Date(j.daily.sunset[0]).getTime()}; if (FXCFG.sky) applySky(); }
    fxWeather(j.current.weather_code, STATE.isDay);
    renderFeed("wx");
  }catch(e){ STATE.wxErr = true; FEEDAT.wxErr = String(e && e.message || e).slice(0, 120); renderFeed("wx"); }
}
async function loadAqi(){
  if (!usesFeed("aqi")) return;
  try{ const g = S("general"); const j = await getJSON("https://air-quality-api.open-meteo.com/v1/air-quality?latitude=" + g.lat + "&longitude=" + g.lon + "&current=us_aqi");
    STATE.aqi = j.current ? j.current.us_aqi : null; }catch(e){ STATE.aqi = null; }
  renderFeed("aqi");
}
async function loadEvents(){
  try{
    const j = await getJSON("/events?month=1");
    STATE.events = (j.events || []).filter(e => !isNaN(evDate(e))).sort((a, b) => evDate(a) - evDate(b));
    STATE.evErr = j.error || (j.errors || [])[0] || "";
    const today = new Date().toDateString(), was = STATE.bday.length;
    STATE.bday = STATE.events.filter(e => /birthday|b-?day/i.test(e.summary || "") && evDate(e).toDateString() === today);
    if (STATE.bday.length && !was) fxConfetti(5000);
    renderFeed("events");
  }catch(e){}
}
async function loadNotes(){
  if (!usesFeed("notes")) return;
  try{
    const d = await getJSON("/notes"); STATE.notes = d;
    if (d.error && d.error !== loadNotes.lastErr){ loadNotes.lastErr = d.error;
      fetch("/report", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({task:"reminders-error", ok:false, error:String(d.error)})}).catch(()=>{}); }
  }catch(e){}
  renderFeed("notes");
}
// teams: every team set up in Sources (the week and month tiles show all of them; a team tile picks one)
async function loadTeams(){
  if (!usesFeed("team") && !usesFeed("events")) return;
  const ids = (SOURCES.teams || []).map(t => t.id);
  await Promise.all(ids.map(async id => { try{ STATE.teams[id] = await getJSON("/team?id=" + encodeURIComponent(id)); }catch(e){ STATE.teams[id] = null; } }));
  renderFeed("team", "events");
}
async function loadSales(){
  if (!usesFeed("sales")) return;
  try{ STATE.sales = await getJSON("/sales"); }catch(e){ STATE.sales = {deals:[], error:String(e)}; }
  renderFeed("sales", "notes");
  if (STATE.sales && (STATE.sales.loading || STATE.sales.busy)) setTimeout(loadSales, 60e3);
}
async function loadPhotos(){
  const bg = typeof THEMEV !== "undefined" && THEMEV.bg === "Photos";
  if (!usesFeed("photos") && !bg) return;
  const ids = [...new Set(Object.values(MODULES).filter(m => (m.feeds || []).includes("photos")).map(m => m.s.album || "").concat(bg ? [""] : []))];
  await Promise.all(ids.map(async id => { try{ STATE.albums[id] = await getJSON("/photos?id=" + encodeURIComponent(id)); }catch(e){ STATE.albums[id] = {photos:[], error:String(e)}; } }));
  for (const id in MOUNTED) if (MODULES[id] && MODULES[id].type === "photos"){ MOUNTED[id]._layers = null; MOUNTED[id]._shown = null; }
  renderFeed("photos"); themePhotos();
}
const FEEDS = [[loadWeather, 600], [loadAqi, 1800], [loadEvents, 300], [loadNotes, 30], [loadTeams, 600], [loadPhotos, 1800], [loadSales, 1800], [loadTileData, 15]];

/* ---------- pages ---------- */
let pageTimer = null, PAGE = 0;
window.dashPage = () => PAGE;
// every page in screen order; the night page is always last and isn't swiped to (it takes over at night)
function pageList(){ return ["main"].concat(SOLO ? [] : cpages().filter(p => p.on !== false).map(p => "c:" + p.id), !SOLO && nightGrid() ? ["night"] : []); }
const dayCount = () => pageList().filter(n => n !== "night").length;
function buildPages(){
  const L = pageList(), n = dayCount();
  $("pages").style.width = "calc(var(--page-w) * " + L.length + ")";
  $("dots").innerHTML = L.slice(0, n).map((_, i) => '<i' + (i === PAGE ? ' class="on"' : "") + '></i>').join("");
  $("dots").hidden = n < 2;
}
function pagesXform(){       // in edit mode the page shrinks into the editor canvas
  const P = $("pages"), n = pageList().length;
  const offset = "translateX(calc(var(--page-w) * " + -PAGE + "))";
  if (EDIT.on && EDIT.k){
    P.style.transformOrigin = "0 0";
    P.style.transform = "translate(" + EDIT.ox + "px," + EDIT.oy + "px) scale(" + EDIT.k + ") " + offset;
    P.style.clipPath = "inset(0 calc(var(--page-w) * " + (n - PAGE - 1) + ") 0 calc(var(--page-w) * " + PAGE + ") round 10px)";
  } else { P.style.transform = offset; P.style.clipPath = ""; P.style.transformOrigin = ""; }
}
// the page showing, for the shell: a new dashboard it swaps in starts on the same page
window.dashPage = () => pageList()[PAGE] || "main";
function showPage(n){
  const L = pageList();
  PAGE = Math.max(0, Math.min(L.length - 1, n));
  const name = L[PAGE];
  pagesXform();
  document.querySelectorAll("#dots i").forEach((x, i) => x.classList.toggle("on", i === PAGE));
  clearTimeout(pageTimer);
  const back = name.startsWith("c:") ? +((cpage(name.slice(2)) || {}).back || 0) : 0;
  if (PAGE && back && !EDIT.on) pageTimer = setTimeout(() => showPage(0), back * 1000);
  render();
}
// Silk hands touch drags to its own scrolling and cancels pointer events, so listen to
// touch events too (and the page sets touch-action:none). Whichever ends first wins.
let swipe = null, lastSwipe = 0;
function swStart(x, y){ swipe = {x, y, lx:x, ly:y}; }
function swMove(x, y){ if (swipe){ swipe.lx = x; swipe.ly = y; } }
function swEnd(x, y){
  if (!swipe) return;
  if (x == null){ x = swipe.lx; y = swipe.ly; }
  const dx = x - swipe.x, dy = y - swipe.y; swipe = null;
  if (Math.abs(dx) > 90 && Math.abs(dx) > Math.abs(dy) * 1.3 && Date.now() - lastSwipe > 400){
    if (EDIT.on || NIGHT.mode === "night") return;
    lastSwipe = Date.now(); showPage(Math.max(0, Math.min(dayCount() - 1, PAGE + (dx < 0 ? 1 : -1))));
  }
}
document.addEventListener("touchstart", e => { const t = e.touches[0]; if (t) swStart(t.clientX, t.clientY); }, {passive:true});
document.addEventListener("touchmove", e => {
  const t = e.touches[0]; if (!t || !swipe) return;
  swMove(t.clientX, t.clientY);
  if (Math.abs(t.clientX - swipe.x) > 10 && e.cancelable) e.preventDefault();
}, {passive:false});
document.addEventListener("touchend", e => { const t = e.changedTouches[0]; swEnd(t ? t.clientX : null, t ? t.clientY : null); });
document.addEventListener("touchcancel", () => swEnd(null, null));
document.addEventListener("pointerdown", e => { if (e.pointerType !== "touch") swStart(e.clientX, e.clientY); });
document.addEventListener("pointermove", e => { if (e.pointerType !== "touch") swMove(e.clientX, e.clientY); });
document.addEventListener("pointerup", e => { if (e.pointerType !== "touch") swEnd(e.clientX, e.clientY); });
$("dots").addEventListener("click", () => { showPage((PAGE + 1) % dayCount()); });

/* ---------- night page: takes over between the night hours, dimmed; a touch peeks at the main page for a minute ---------- */
const FORCE_NIGHT = /[?&]night=1/.test(location.search);
const hr12 = h => new Date(2000, 0, 1, +h || 0).toLocaleTimeString([], {hour:"numeric"});
const NIGHT = {mode:"day", peekUntil:0};
function isNight(h){
  if (SOLO || TRIAL_ID || TRIAL || !nightGrid()) return false;      // a layout being previewed or tried shows its own page, day or night
  if (FORCE_NIGHT) return true;
  const s = S("night"), a = +s.start, b = +s.end;
  if (!ON("night") || a === b) return false;
  return a > b ? (h >= a || h < b) : (h >= a && h < b);
}
function nightDim(){ const v = S("night").dim; return Math.max(THEMEV.dim || 0, v == null ? 45 : +v) / 100; }
function nightDrift(){
  const sec = document.querySelector('.npage'); if (!sec) return;
  const on = NIGHT.mode === "night" && S("night").drift !== false;
  sec.style.transform = on ? "translate(" + Math.round((Math.random() - .5) * 60) + "px," + Math.round((Math.random() - .5) * 40) + "px)" : "";
}
setInterval(nightDrift, 60e3);
document.addEventListener("pointerdown", () => { if (NIGHT.mode !== "day" && !EDIT.on) NIGHT.peekUntil = Date.now() + 60e3; });
function nightTick(d){
  const night = !EDIT.on && isNight(d.getHours()), mode = !night ? "day" : Date.now() < NIGHT.peekUntil ? "peek" : "night";
  if (mode === NIGHT.mode) return;
  const prev = NIGHT.mode; NIGHT.mode = mode;
  document.body.classList.toggle("night", mode === "night");
  document.body.classList.toggle("peek", mode === "peek");
  fxPause(mode === "night");
  const dm = $("dimmer"); if (dm) dm.style.opacity = mode === "night" ? nightDim() : (THEMEV.dim || 0) / 100;
  if (mode === "night"){ showPage(pageList().indexOf("night")); nightDrift(); }
  else if (prev === "night") showPage(0);
}

/* ---------- seasons: the clock's holiday greeting; the accent follows the season only if the look asks for it ---------- */
let lastSeasonKey = "";
function applySeason(){
  const s = season(new Date());
  if (!THEMEV.holiday || s.accent === lastSeasonKey) return;
  lastSeasonKey = s.accent;
  document.documentElement.style.setProperty("--accent", s.accent);
}

/* ---------- effects: the ones that are on and whose time it is (see FXLIB) ---------- */
const FXD = {back:null, front:null, wx:null, next:{}, paused:false};
const fxItems = () => S("effects").items || [];
const fxOn = () => FXCFG.any && !FXD.paused;
const fxEmojiOk = def => !def.emoji || !LOOK.plain;          // with emoji turned off, the emoji effects rest too
function fxInit(){ if (!FXD.back){ FXD.back = FXLIB.Runner($("fx"), {full:true, fps:22}); FXD.front = FXLIB.Runner($("fun2"), {full:true, fps:30}); } }
function fxUpdate(){
  fxInit(); FXLIB.setMine(S("effects").mine); FXLIB.setRegion(holidayRegionName(), holidayRegion().thanks);
  const B = [], F = [], d = new Date();
  if (fxOn()) for (const def of FXLIB.L){
    if (def.layer === "show" || !fxEmojiOk(def)) continue;
    const c = FXLIB.conf(fxItems(), def.id); if (!c.on) continue;
    const wxNow = !!FXD.wx && !!def.wx && def.wx.includes(FXD.wx);
    if (!(def.wx ? c.when === "always" || wxNow : FXLIB.timeOk(c, d))) continue;
    const p = {id:def.id, amount:c.amount, kind: def.id === "rain" ? (wxNow ? FXD.wx : "rain") : "", front: def.layer === "fall" && FXCFG.front};
    (p.front ? F : B).push(p);
  }
  const gone = [].concat(...B.concat(F).map(p => FXLIB.BY[p.id].replaces || []));     // e.g. Thanksgiving's leaves stand in for the plain ones
  FXD.back.set(B.filter(p => !gone.includes(p.id))); FXD.front.set(F.filter(p => !gone.includes(p.id)));
  window.FXINFO = Object.assign(window.FXINFO || {}, {wx:FXD.wx, running:B.concat(F).map(p => p.id)});
}
function fxShows(){          // a show whose turn has come plays; one at a time
  fxInit();
  if (!fxOn() || document.hidden || FXD.front.busy()) return;
  const now = Date.now(), d = new Date();
  for (const def of FXLIB.L){
    if (def.layer !== "show" || def.party || !fxEmojiOk(def)) continue;
    const c = FXLIB.conf(fxItems(), def.id);
    if (!c.on || !FXLIB.timeOk(c, d)){ delete FXD.next[def.id]; continue; }
    const ev = Math.max(2, +c.every || 15) * 60e3;
    if (!FXD.next[def.id]){ FXD.next[def.id] = now + ev * (.25 + Math.random() * .5); continue; }
    if (now >= FXD.next[def.id]){
      FXD.next[def.id] = now + ev * (.85 + Math.random() * .3);
      FXD.front.play(def.id, {amount:c.amount});
      window.FXINFO = Object.assign(window.FXINFO || {}, {lastShow:def.id});
      return;
    }
  }
}
function fxConfetti(ms){ fxInit(); const c = FXLIB.conf(fxItems(), "confetti"); if (fxOn() && c.on && !LOOK.plain) FXD.front.play("confetti", {amount:c.amount, ms}); }
function fxWeather(code, day){ const m = FXLIB.wxMode(code, day); if (m !== FXD.wx){ FXD.wx = m; fxUpdate(); } }
function fxPause(p){ fxInit(); FXD.paused = p; FXD.back.pause(p); FXD.front.pause(p); fxUpdate(); }
// Controls' "Play it now" and the tests: FUN.show("santa"), FUN.confetti(ms)
window.FUN = {show(id){ fxInit(); FXD.front.play(id, {amount:(FXLIB.conf(fxItems(), id) || {}).amount || "Some"}); }, confetti(ms){ fxInit(); FXD.front.play("confetti", {amount:"Some", ms}); }};

/* ---------- clock tick: tiles redraw on their own schedule (every: seconds) ---------- */
function tick(){
  const d = new Date(), sec = Math.floor(d.getTime() / 1000);
  const due = Object.keys(MOUNTED).filter(id => { const m = MODULES[id]; return m && m.every && sec % m.every === 0; });
  if (due.length) render(...due);
  stackTick();
  sbxTick();
  nightTick(d);
  if (d.getSeconds() === 0){
    themeTick(); themePhotos();
    applySeason(); if (FXCFG.sky) applySky();
    fxUpdate();
    if (NIGHT.mode === "day" && d.getMinutes() === 0 && STATE.bday.length) fxConfetti(4000);
  }
  if (d.getSeconds() % 20 === 0) fxShows();
  if (FRAMED){ try{ window.top.contentTick(); document.body.classList.toggle("fs", !!window.top.shellState().fs); }catch(e){} }
}

/* ---------- touch or "Alexa, select": fullscreen + keep-alive live in the shell page ---------- */
function armScreen(){
  if (PREVIEW) return;
  if (EDIT.on) return;          // asking for fullscreen mid-gesture cancels the touch, which breaks drags and scrolling in the editor
  if (FRAMED){ try{ window.top.shellTap(); }catch(e){} }
  else { const el = document.documentElement; if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {}); }
  $("hint").classList.add("gone");
}
document.addEventListener("pointerdown", armScreen);
// On an Echo Show, "Alexa, select" reaches the page as a real Enter key press, which counts as a tap
document.addEventListener("keydown", e => {
  if (e.key !== "Enter" || e.repeat || !e.isTrusted) return;
  if (e.target && e.target.closest && e.target.closest("input,textarea,select,button,a[href],[contenteditable]")) return;
  armScreen();
});
// Controls remembers the page you were on, so Done and "Edit the screen" come back to it
$("gear").addEventListener("click", () => { location.href = "/control?echo=1&page=" + encodeURIComponent(pageList()[PAGE] || "main"); });
if (!FRAMED && !PREVIEW){
  const ks = document.createElement("script"); ks.src = "/keep.js"; document.body.appendChild(ks);
  document.addEventListener("fullscreenchange", () => document.body.classList.toggle("fs", !!document.fullscreenElement));
}
document.addEventListener("visibilitychange", () => { if (!document.hidden){ loadWeather(); loadEvents(); loadNotes(); } });

/* ---------- a layout from the Library, shown for a few minutes ("Try it on the screen") or in its live preview (?trial=<id>) ---------- */
const TRIAL_ID = (location.search.match(/[?&]trial=(\w+)/) || [])[1] || "";
let TRIAL = null;
function trialBanner(t){
  TRIAL = {name:t.name, end:Date.now() + t.left * 1000};
  const b = document.createElement("div"); b.id = "trialbar";
  b.innerHTML = '<span></span><button type="button">Stop</button>';
  b.querySelector("button").addEventListener("click", () => {
    fetch("/trial/stop", {method:"POST", headers:{"Content-Type":"application/json"}, body:"{}"}).finally(() => location.reload());
  });
  document.body.appendChild(b);
  const draw = () => {
    const s = Math.max(0, Math.round((TRIAL.end - Date.now()) / 1000));
    b.firstChild.textContent = "Trying " + TRIAL.name + " · your layout comes back in " + Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    if (s <= 0){ clearInterval(tm); setTimeout(() => location.reload(), FRAMED ? 6000 : 500); }    // the shell usually reloads first
  };
  const tm = setInterval(draw, 1000); draw();
}
/* ---------- boot (runs after /tiles.js has defined the tile types) ---------- */
let SOURCES = {};
async function boot(){
  try{ const j = await getJSON("/config" + (TRIAL_ID ? "?trial=" + encodeURIComponent(TRIAL_ID) : DRAFT_ID ? "?draft=" + DRAFT_ID : "")); CFG = j.modules; SCH = {}; SOURCES = j.sources || {}; for (const k in CFG) SCH[k] = (j.schema || {})[k] || {};
    sbxSetup(j.sandbox); LEGACY = j.legacy || {};
    if (j.trial) trialBanner(j.trial); }
  catch(e){ reportErr("config", String(e)); setTimeout(boot, 15e3); return; }
  if (SOLO) demoConfig();             // ?solo=<type>: one tile of that type with made-up data (examples in the tile list)
  await langSetup();
  tilesSetup();
  Object.assign(FXCFG, {any: ON("effects") && !SOLO, front: S("effects").front !== false, sky:true});
  lookSetup();
  $("gear").hidden = !S("general").gear;
  layout();
  render();
  sbxBoot();
  applySeason(); fxUpdate();
  FEEDS.forEach(([f]) => f());
  tick(); setInterval(tick, 1000);
  if (STILL) setTimeout(() => {          // freeze: no more timers, animation frames or CSS animations
    let id = setTimeout(() => {}, 0); while (id > 0){ clearTimeout(id); clearInterval(id); id--; }
    window.requestAnimationFrame = () => 0;
    document.documentElement.classList.add("still");
  }, 3500);
  FEEDS.forEach(([f, every]) => setInterval(f, every * 1000));
  // ?page=<name>: back from Controls on the page you left. ?edit=1 (Controls' "Edit the screen" on the Echo): open the
  // editor on that page once the tiles have drawn
  const back = new URLSearchParams(location.search).get("page"), bi = back ? pageList().indexOf(back) : -1;
  if (bi > 0 && !PREVIEW) showPage(bi);
  if (/[?&]edit=1/.test(location.search) && !PREVIEW) setTimeout(() => editEnter(null), 900);
  if (back || /[?&]edit=1/.test(location.search)) history.replaceState(null, "", location.pathname);
}
