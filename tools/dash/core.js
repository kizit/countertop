window.__mainLoaded = true;
const $ = id => document.getElementById(id);
const PREVIEW = /[?&]preview=1/.test(location.search);
const SOLO = (location.search.match(/[?&]solo=(\w+)/) || [])[1] || "";
if (SOLO) document.documentElement.classList.add("solo");
const STILL = /[?&]still=1/.test(location.search);        // example thumbnails in Controls: draw once, then stop
if (PREVIEW){        // Controls pauses its live preview while you scroll, so scrolling stays smooth
  const raf = window.requestAnimationFrame.bind(window); let q = [];
  window.dashPause = on => {
    window.PAUSED = !!on; document.documentElement.classList.toggle("still", !!on);
    if (!on){ const Q = q; q = []; Q.forEach(f => raf(f)); }
  };
  window.requestAnimationFrame = f => window.PAUSED ? (q.push(f), 0) : raf(f);
}
if (PREVIEW) document.documentElement.classList.add("preview");
const FRAMED = (function(){ try{ return window.top !== window && !!window.top.shellTap; }catch(e){ return false; } })();
function reportErr(kind, msg, extra){
  try{
    fetch("/report", {method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({task:"js-error", ok:false, error:kind + ": " + msg,
        result: Object.assign({page:"dash2", framed:FRAMED}, extra||{})})}).catch(()=>{});
  }catch(e){}
}
window.addEventListener("error", e => reportErr("error", e.message, {src:e.filename, line:e.lineno}));
window.addEventListener("unhandledrejection", e => reportErr("rejection", String(e.reason)));
const store = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const getJSON = async (u, opt) => { if (SOLO){ const d = demoJSON(u); if (d !== undefined) return d; } const r = await fetch(u, Object.assign({cache:"no-store"}, opt || {})); if (!r.ok) throw new Error(u + " " + r.status); return r.json(); };

/* ---------- config ---------- */
let CFG = null, SCH = {};                                     // id → {on, settings}: dashboard-wide settings, plus one entry per placed tile
const S = id => (CFG && CFG[id] ? CFG[id].settings : {});
const ON = id => !!(CFG && CFG[id] && CFG[id].on);
const FXCFG = {any:true, front:true, sky:true};
const STATE = {wx:null, aqi:null, events:[], notes:null, teams:{}, albums:{}, rain:"", tempNow:null, isDay:true, bday:[]};

/* ---------- language (docs/languages.md) ---------- */
// The Language setting in Controls picks the words (tools/lang/<code>.json: English text → translation) and the locale
// for dates, times and numbers. Anything without a translation stays in English.
const LANGS = {"English":"en", "Français":"fr"};
const I18N = {lang:"en", locale:undefined, words:{}};
// tr("Rain likely around {time}", {time:"3 PM"}): the words in the screen's language; `own` is a tile's own lang block
function tr(s, vars, own){
  let out = (own && own[s]) || I18N.words[s] || s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => vars[k] != null ? vars[k] : m);
  return out;
}
async function langSetup(){
  const pick = S("general").lang, nav = String(navigator.language || "en"), navLang = nav.split("-")[0].toLowerCase();
  I18N.lang = LANGS[pick] || (Object.values(LANGS).includes(navLang) ? navLang : "en");
  // Automatic leaves dates to the device. A chosen language keeps the device's region when it speaks that language
  // (fr-CA stays fr-CA), and otherwise uses the language's usual one.
  I18N.locale = !LANGS[pick] ? undefined : navLang === I18N.lang ? nav : {en:"en-US", fr:"fr-FR"}[I18N.lang];
  document.documentElement.lang = I18N.lang;
  if (I18N.lang !== "en"){
    try{ I18N.words = await getJSON("/lang/" + I18N.lang + ".json"); }
    catch(e){ I18N.words = {}; reportErr("language", String(e.message || e)); }
  }
  if (!I18N.locale) return;
  // dates, times and numbers that ask for the default locale ([] or nothing) get the chosen one
  const loc = l => l == null || (Array.isArray(l) && !l.length) ? I18N.locale : l;
  for (const [P, k] of [[Date.prototype, "toLocaleDateString"], [Date.prototype, "toLocaleTimeString"], [Date.prototype, "toLocaleString"], [Number.prototype, "toLocaleString"]]){
    const f = P[k]; P[k] = function(l, o){ return f.call(this, loc(l), o); };
  }
  const DTF = Intl.DateTimeFormat;
  Intl.DateTimeFormat = Object.assign(function(l, o){ return new DTF(loc(l), o); }, {supportedLocalesOf:DTF.supportedLocalesOf});
  Intl.DateTimeFormat.prototype = DTF.prototype;
}

/* ---------- weather codes ---------- */
function wx(code, night){
  if (code === 0) return {g: night ? "🌙" : "☀️", t:tr("Clear")};
  if (code === 1) return {g: night ? "🌙" : "🌤️", t:tr("Mostly clear")};
  if (code === 2) return {g: night ? "☁️" : "⛅", t:tr("Partly cloudy")};
  if (code === 3) return {g:"☁️", t:tr("Overcast")};
  if (code === 45 || code === 48) return {g:"🌫️", t:tr("Fog")};
  if (code >= 51 && code <= 57) return {g:"🌦️", t:tr("Drizzle")};
  if (code >= 61 && code <= 67) return {g:"🌧️", t:tr("Rain")};
  if (code >= 71 && code <= 77) return {g:"🌨️", t:tr("Snow")};
  if (code >= 80 && code <= 82) return {g:"🌧️", t:tr("Showers")};
  if (code >= 85 && code <= 86) return {g:"🌨️", t:tr("Snow showers")};
  if (code >= 95) return {g:"⛈️", t:tr("Storms")};
  return {g:"·", t:"—"};
}

/* ---------- "rain coming" note from the next 12 hourly slots ---------- */
function isWet(code){ return code != null && ((code >= 51 && code <= 67) || (code >= 71 && code <= 86) || code >= 95); }
function isSnow(code){ return code != null && ((code >= 71 && code <= 77) || code === 85 || code === 86); }
function rainNote(j, curCode){
  const H = j.hourly, now = new Date();
  const i0 = H.time.findIndex(t => new Date(t) > now); if (i0 < 0) return "";
  const pp = H.precipitation_probability || [], wc = H.weather_code || [];
  const hr = i => new Date(H.time[i]).toLocaleTimeString([], {hour:"numeric"});
  const end = Math.min(i0 + 12, H.time.length);
  const wetAt = i => (pp[i] != null && pp[i] >= 50) || isWet(wc[i]);
  const pill = (snow, txt) => '<span class="pill' + (snow ? " snow" : "") + '">' + txt + '</span>';
  if (isWet(curCode)){
    const snow = isSnow(curCode);
    for (let i = i0; i < end; i++) if (!wetAt(i)) return pill(snow, tr(snow ? "Snow now · easing by {time}" : "Rain now · easing by {time}", {time:hr(i)}));
    return pill(snow, tr(snow ? "Snow for the next several hours" : "Rain for the next several hours"));
  }
  for (let i = i0; i < end; i++){
    if (wetAt(i)){
      const snow = isSnow(wc[i]);
      const pct = pp[i] != null ? " (" + pp[i] + "%)" : "";
      return pill(snow, tr(snow ? "Snow likely around {time}" : "Rain likely around {time}", {time:hr(i)}) + pct);
    }
  }
  let mx = 0; for (let i = i0; i < end; i++) mx = Math.max(mx, pp[i] || 0);
  return mx < 20 ? '<span class="pill dry">' + tr("Dry for the next 12 hours") + '</span>' : "";
}

/* ---------- little thing: on this day / dad joke / kitchen fact ---------- */
const FALLBACK = [
  {h:"Dad joke", t:"I'm reading a book about anti-gravity. It's impossible to put down."},
  {h:"Dad joke", t:"Why did the scarecrow win an award? He was outstanding in his field."},
  {h:"Dad joke", t:"I used to hate facial hair, but then it grew on me."},
  {h:"Dad joke", t:"What do you call a fake noodle? An impasta."},
  {h:"Dad joke", t:"Why don't eggs tell jokes? They'd crack each other up."},
  {h:"Dad joke", t:"I told my wife she was drawing her eyebrows too high. She looked surprised."},
  {h:"Dad joke", t:"What did the grape do when it got stepped on? It let out a little wine."},
  {h:"Dad joke", t:"Why did the cookie go to the doctor? It felt crummy."},
  {h:"Kitchen fact", t:"Honey never spoils. Edible honey has been found in Egyptian tombs over 3,000 years old."},
  {h:"Kitchen fact", t:"A medium lemon gives about 3 tablespoons of juice. Roll it on the counter first to get more."},
  {h:"Kitchen fact", t:"Salted water boils only a fraction of a degree hotter. The salt is for flavor, not speed."},
  {h:"Kitchen fact", t:"Turkey needs about a day in the fridge per 4–5 lb to thaw. A 20 lb bird wants 4–5 days."},
  {h:"Kitchen fact", t:"Bananas are berries, but strawberries are not."},
  {h:"Kitchen fact", t:"Store tomatoes on the counter, not in the fridge. The cold dulls their flavor."},
  {h:"Kitchen fact", t:"Peanuts aren't nuts. They're legumes, like peas and lentils."},
  {h:"Kitchen fact", t:"Rest meat for 5–10 minutes after cooking so the juices stay in instead of on the board."}
];
let onThisDay = [], otdTried = 0;
async function loadOnThisDay(){
  const d = new Date(), key = "otd:" + d.toDateString();
  const cached = store.get(key, null);
  if (cached){ onThisDay = cached.map(x => ({h:x.h, t:x.t.replace(/\s*\((?:pictured|shown|depicted)[^)]*\)/gi, "")})); return; }
  if (Date.now() - otdTried < 30*60e3) return;          // don't hammer Wikipedia if it's unreachable
  otdTried = Date.now();
  try{
    const mm = String(d.getMonth()+1).padStart(2,"0"), dd = String(d.getDate()).padStart(2,"0");
    const j = await (await fetch("https://en.wikipedia.org/api/rest_v1/feed/onthisday/selected/" + mm + "/" + dd)).json();
    onThisDay = (j.selected || []).filter(x => x.text && x.text.length < 170)
      .map(x => ({h:"On this day · " + x.year,
                  t:x.text.replace(/\s*\((?:pictured|shown|depicted|left|right|center|centre)[^)]*\)/gi, "")}));
    store.set(key, onThisDay);
  }catch(e){ onThisDay = []; }
}
async function dadJoke(){
  try{
    const r = await fetch("https://icanhazdadjoke.com/", {headers:{"Accept":"application/json"}});
    const j = await r.json();
    if (j.joke && j.joke.length < 170){
      const p = j.joke.split(/(?<=[?.!])\s+(?=\S)/);
      return {h:"Dad joke", t:p[0], a:p.length > 1 ? p.slice(1).join(" ") : ""};
    }
  }catch(e){}
  return null;
}
/* ---------- seasons & holidays ---------- */
function nthWeekday(y, m, wd, n){ const d = new Date(y, m, 1); d.setDate(1 + (wd - d.getDay() + 7) % 7 + 7*(n-1)); return d; }
function season(now){
  const y = now.getFullYear(), m = now.getMonth(), day = now.getDate();
  const t0 = new Date(y, m, day).getTime(), R = holidayRegion();
  const tg = R.thanks ? R.thanks(y) : null;
  const daysTo = tg ? Math.round((tg.getTime() - t0) / 86400e3) : null;       // to Thanksgiving, where there is one
  const xmas = Math.round((new Date(y, 11, 25).getTime() - t0) / 86400e3);
  if (m === 0 && day === 1) return {accent:"#ffd36e", greet:"🎉 " + tr("Happy New Year"), fun:"newyear"};
  const nat = (R.national || []).find(n => n.m === m && n.d === day);
  if (nat) return {accent:nat.accent, greet:nat.greet(), fun:"summer"};
  if (m === 1 && day >= 7 && day <= 14) return {accent:"#ff8fb1", greet: day === 14 ? "💕 " + tr("Happy Valentine's Day") : "💕", fun:"valentine"};
  if (m === 2 && day === 17 && R.stPatrick) return {accent:"#5fd38a", greet:"☘️ Happy St. Patrick's Day", fun:"spring"};
  if (R.july4 && m === 6 && day >= 1 && day <= 4) return {accent:"#ff6b6b", greet: day === 4 ? "🎆 Happy Fourth of July" : "🇺🇸", fun:"july4"};
  if (m === 9 && day >= 20) return {accent:"#ff9a3c", greet: day === 31 ? "🎃 " + tr("Happy Halloween") : "🎃", fun:"halloween"};
  if (daysTo === 0) return {accent:"#f0a050", greet:"🦃 " + tr("Happy Thanksgiving"), fun:"thanks"};
  if (daysTo > 0 && daysTo <= 7) return {accent:"#f0a050", greet:"🦃", fun:"thanks"};
  if (m === 11 && day === 25) return {accent:"#ff6f6f", greet:"🎄 " + tr("Merry Christmas"), fun:"xmas"};
  if (m === 11 && day === 24) return {accent:"#ff6f6f", greet:"🎅 " + tr("Christmas Eve"), fun:"xmas"};
  // the Christmas countdown starts after Thanksgiving in the US, and on December 1 elsewhere
  if ((m === 10 && daysTo < 0 && R.countdownAfterThanks) || (m === 11 && day < 24)) return {accent:"#7fd1a0", greet:"🎄 " + tr("{n} days to Christmas", {n:xmas}), fun:"xmas"};
  if (m === 11 && day === 31) return {accent:"#ffd36e", greet:"🥂 " + tr("New Year's Eve"), fun:"newyear"};
  if (m === 11) return {accent:"#9fc6ff", greet:"❄️", fun:"winter"};
  if (m === 8 && day >= 22 || m === 9 || m === 10) return {accent:"#ffb27c", greet:"🍂", fun:"fall"};
  if (m === 0 || m === 1) return {accent:"#9fc6ff", greet:"", fun:"winter"};
  if (m >= 2 && m <= 4) return {accent:"#9be08a", greet:"🌷", fun:"spring"};
  return {accent:"#7cb7ff", greet:"☀️", fun:"summer"};
}
/* ---------- sky colors follow the real sunrise/sunset ---------- */
const SKY = {
  night:  "radial-gradient(ellipse at 70% -10%, #1b2348 0%, #0b1022 45%, #06080f 100%)",
  dawn:   "linear-gradient(180deg, #3a2a52 0%, #8a4a5a 38%, #c9774f 62%, #1a1420 100%)",
  morning:"linear-gradient(180deg, #2a5a8c 0%, #1d3a5c 45%, #0d1726 100%)",
  day:    "linear-gradient(180deg, #2f6aa3 0%, #1c4370 40%, #0d1a2b 100%)",
  golden: "linear-gradient(180deg, #4a4a7a 0%, #b0664a 45%, #e0a050 62%, #1a1416 100%)",
  dusk:   "linear-gradient(180deg, #1d1f4a 0%, #5a2f5e 40%, #a3485a 60%, #120c16 100%)"
};
let sunT = null, skyNow = "", skyFlip = false, skyNowSet = false;
function skyPhase(){
  if (!sunT) return "day";
  const n = Date.now(), r = sunT.rise, s = sunT.set, m = 60e3;
  if (n < r - 40*m || n > s + 50*m) return "night";
  if (n < r + 30*m) return "dawn";
  if (n < r + 150*m) return "morning";
  if (n < s - 70*m) return "day";
  if (n < s + 5*m) return "golden";
  return "dusk";
}
function applySky(){
  if (!sunT) return;                       // wait for real sunrise/sunset before painting a sky
  const ph = skyPhase();
  if (ph === skyNow) return;
  skyNow = ph;
  // cross-fade between two layers so the sky changes slowly
  const a = $("skyA"), b = $("skyB");
  const show = skyFlip ? a : b, hide = skyFlip ? b : a;
  const first = !skyNowSet; skyNowSet = true;
  a.style.transition = b.style.transition = first ? "none" : "";
  skyFlip = !skyFlip;
  show.style.background = SKY[ph];
  show.style.opacity = "1"; hide.style.opacity = "0";
  window.FXINFO = Object.assign(window.FXINFO || {}, {sky: ph});
}

/* ---------- moon phase (for the night clock and the sunrise line) ---------- */
function moon(d){
  const syn = 29.530588853, ref = Date.UTC(2000, 0, 6, 18, 14);
  const age = (((d.getTime() - ref) / 86400e3) % syn + syn) % syn;
  const names = [["🌑", tr("New moon")], ["🌒", tr("Waxing crescent")], ["🌓", tr("First quarter")], ["🌔", tr("Waxing gibbous")],
                 ["🌕", tr("Full moon")], ["🌖", tr("Waning gibbous")], ["🌗", tr("Last quarter")], ["🌘", tr("Waning crescent")]];
  return names[Math.floor((age / syn) * 8 + .5) % 8];
}

/* ---------- a little greeting that changes through the day ---------- */
function hello(d){
  const h = d.getHours(), wd = d.getDay();
  if (h < 5) return tr("Up late") + " 🦉";
  if (h < 9) return tr(wd === 0 || wd === 6 ? "Slow morning" : "Good morning") + " ☕";
  if (h < 12) return tr("Good morning");
  if (h < 14) return tr("Lunch time?") + " 🥪";
  if (h < 17) return wd === 5 ? tr("Almost the weekend") + " 🎉" : tr("Good afternoon");
  if (h < 20) return tr("What's for dinner?") + " 🍝";
  return tr("Good evening") + " 🌙";
}
