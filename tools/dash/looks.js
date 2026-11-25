/* ---------- look & feel: emoji or plain text, swapped emoji, 24-hour time ---------- */
const LOOK = {plain:false, mode:"emoji", swaps:[], h24:false, ready:false};
const EMO = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:️|⃣|[\u{1F3FB}-\u{1F3FF}]|‍(?:\p{Extended_Pictographic}|\p{Emoji_Component}))*️?/gu;
// "Simple symbols": the emoji that carry information (weather, sun, moon) become one-color text symbols; the rest go
const SYM = {"☀":"☀︎", "🌤":"☀︎", "⛅":"☁︎", "🌥":"☁︎", "☁":"☁︎", "🌦":"☂︎", "🌧":"☂︎", "☔":"☂︎", "☂":"☂︎", "⛈":"ϟ", "🌩":"ϟ", "⚡":"ϟ",
  "🌨":"❄︎", "❄":"❄︎", "☃":"❄︎", "🌫":"≋", "🌙":"☾", "🌛":"☾", "🌜":"☾", "🌑":"●", "🌒":"☾", "🌓":"☾", "🌔":"☾", "🌕":"○", "🌖":"☾", "🌗":"☾", "🌘":"☾",
  "🌅":"↑", "🌄":"↑", "🌇":"↓", "🌆":"↓"};
const WORDS = {"🌅":"Sunrise", "🌄":"Sunrise", "🌇":"Sunset", "🌆":"Sunset"};     // "Words only" keeps what these meant
const EMOX = new RegExp("(?:" + EMO.source + ")\uFE0E?", "gu");      // also takes a symbol's own text marker, so a second pass changes nothing
function lookText(s){
  if (!s || !LOOK.ready) return s;
  let t = s;
  for (const [a, b] of LOOK.swaps) if (a && t.includes(a)) t = t.split(a).join(b);
  if (LOOK.plain){
    const sym = LOOK.mode === "symbols", u = t.replace(EMOX, m => { const k = m.replace(/[\uFE0E\uFE0F]/g, ""); return (sym ? SYM[k] : WORDS[k] && tr(WORDS[k])) || ""; });
    if (u !== t) t = u.replace(/ {2,}/g, " ").replace(/^ (?=\S)/, "");
  }
  return t;
}
function lookApply(root){
  if (!LOOK.ready || (!LOOK.plain && !LOOK.swaps.length)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()){
    if (n.parentNode && n.parentNode.closest && n.parentNode.closest("#edl,script,style")) continue;
    const v = lookText(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v;
  }
}
/* ---------- looks: the everyday look, other looks, and schedule rules that switch to them; the last matching rule wins ---------- */
const FORCE_THEME = (location.search.match(/[?&]theme=([\w-]+)/) || [])[1] || "";
function themeMatches(t, d){
  const w = t.when || {};
  if (t.on === false) return false;
  if (w.from && w.to && w.from !== w.to){
    const hm = d.getHours() * 60 + d.getMinutes(), m = x => { const [h, mi] = String(x).split(":").map(Number); return h * 60 + (mi || 0); };
    const a = m(w.from), b = m(w.to);
    if (a < b ? !(hm >= a && hm < b) : !(hm >= a || hm < b)) return false;
  }
  if (w.days && w.days.length && !w.days.includes(d.getDay())) return false;
  if (w.dFrom && w.dTo){
    const k = (d.getMonth() + 1) * 100 + d.getDate(), n = x => { const [mo, da] = String(x).split("-").map(Number); return mo * 100 + da; };
    const a = n(w.dFrom), b = n(w.dTo);
    if (a <= b ? !(k >= a && k <= b) : !(k >= a || k <= b)) return false;
  }
  return true;
}
// a theme by id: one of yours, or a built-in one (tools/shared/themes.js); "default" or an unknown id = Everyday (null)
const themeById = (items, id) => (id && id !== "default" && (items.find(x => x.id === id) || THEMELIB.get(id))) || null;
function activeTheme(d){
  const L = S("look"), items = L.items || [], rules = L.rules || [];
  if (FORCE_THEME) return themeById(items, FORCE_THEME);
  if (SOLO) return null;
  for (let i = rules.length - 1; i >= 0; i--){       // a rule for Everyday counts too: it shows Everyday over the theme in use
    const r = rules[i]; if (!(r.look === "default" || themeById(items, r.look)) || !themeMatches(r, d || new Date())) continue;
    return themeById(items, r.look);
  }
  return themeById(items, L.use);          // the theme picked with Use this theme; none = Everyday
}
let THEME = null, THEMEV = {};
const PREFS = ["dateFmt", "weekStart", "h24", "emoji", "swap"];      // set once in Setup, the same in every look
function themeValues(){
  const base = Object.assign({}, S("look")); delete base.items; delete base.rules; delete base.use;
  THEME = activeTheme();
  const v = Object.assign(base, THEME ? THEME.values || {} : {}), g = S("general");
  PREFS.forEach(k => { if (g[k] !== undefined) v[k] = g[k]; });
  return v;
}
function themeApply(){
  const v = THEMEV = themeValues(), R = document.documentElement, st = R.style;
  const r = THEMELIB.resolve(v);
  R.classList.toggle("light", r.light);
  R.classList.toggle("notitles", v.titles === false);
  if (v.accent) st.setProperty("--accent", v.accent);
  // Text color: every tile's text, with the dimmer lines a faded version of it. Empty = automatic (from Light or dark).
  R.classList.toggle("tcol", !!r.tc);
  const VAR = {fg:"--fg", fg2:"--fg2", fg3:"--fg3", dim:"--dim", faint:"--faint"};
  for (const k in VAR){ if (r.tc) st.setProperty(VAR[k], r.text[k]); else st.removeProperty(VAR[k]); }
  // Big numbers color: the clock's time and the temperature. Empty = the same as the text.
  if (r.bc) st.setProperty("--big", r.bc); else st.removeProperty("--big");
  st.setProperty("--card", r.card);
  R.classList.toggle("clear", v.tiles === "Clear");
  const ts = (v.textScale || 100) / 100;
  st.setProperty("--ts", ts); R.classList.toggle("tscale", ts !== 1);
  // shape: fonts, corners, tile edges and spacing (THEMELIB.tokens); an unset token falls back to the stylesheet's own value
  const TK = THEMELIB.tokens(v);
  for (const k in TK){ if (TK[k] === null) st.removeProperty(k); else st.setProperty(k, TK[k]); }
  R.classList.toggle("dfont", !!TK["--font-display"]);
  if (v.bg === "Color" && v.bgColor) st.setProperty("--bg", v.bgColor);
  if (v.bg !== "Sky"){ FXCFG.sky = false; $("skyB").style.opacity = 0; }
  const BG = THEMELIB.background(v, THEME_WALLPAPER(v));
  if (v.bg !== "Sky") $("skyA").style.background = BG || "var(--bg)";
  if (v.fx === "Off") FXCFG.any = false;
  FXCFG.pick = Array.isArray(v.fxPick) && v.fxPick.length ? v.fxPick : null;       // effects this theme plays, in place of the ones turned on in Effects
  let dm = $("dimmer"); if (!dm){ dm = document.createElement("div"); dm.id = "dimmer"; document.body.appendChild(dm); }
  dm.style.opacity = (v.dim || 0) / 100;
  let ti = $("tinter"); if (!ti){ ti = document.createElement("div"); ti.id = "tinter"; document.body.appendChild(ti); }
  const tint = /^#[0-9a-f]{6}$/i.test(v.tint || "") && v.tintAmt > 0;
  ti.style.background = tint ? v.tint : ""; ti.style.opacity = tint ? Math.min(60, v.tintAmt) / 100 : 0;
  if (typeof sbxThemeChanged === "function") sbxThemeChanged();
}
// an uploaded wallpaper lives on this Countertop's own server; the theme only names it
const THEME_WALLPAPER = v => v.bg === "Wallpaper" && /^w-[0-9a-f]{12}$/.test(v.wallpaper || "") ? "/wallpaper/" + v.wallpaper : "";
// background photos (Background: Photos) come from the theme's photo album (the first one in Setup if none is picked), a new one every few minutes
function themePhotos(){
  if (THEMEV.bg !== "Photos") return;
  const A = STATE.albums[THEMEV.album || ""] || STATE.albums[""] || Object.values(STATE.albums)[0], P = (A && A.photos) || [];
  if (!P.length) return;
  const ph = P[Math.floor(Date.now() / (Math.max(1, +THEMEV.photoEvery || 5) * 60e3)) % P.length];
  $("skyA").style.background = 'center/cover no-repeat url("' + ph.url + '")';
}
function themeTick(){       // a different theme's time has come: start fresh with it
  if (FORCE_THEME || SOLO || EDIT.on) return;
  const t = activeTheme();
  if ((t && t.id) !== (THEME && THEME.id)) location.reload();
}
function fmtLongDate(d){
  const f = THEMEV.dateFmt;
  if (f === "Wed, Nov 18") return d.toLocaleDateString([], {weekday:"short", month:"short", day:"numeric"});
  if (f === "18 November") return d.getDate() + " " + d.toLocaleDateString([], {month:"long"});
  if (f === "11/18") return (d.getMonth() + 1) + "/" + d.getDate();
  return d.toLocaleDateString([], {weekday:"long", month:"long", day:"numeric"});
}
function lookSetup(){
  themeApply();
  const s = THEMEV;
  LOOK.mode = s.emoji === "No emoji" ? "none" : s.emoji === "Simple symbols" ? "symbols" : "emoji";
  LOOK.plain = LOOK.mode !== "emoji";
  LOOK.swaps = (s.swap || []).map(x => String(x).split("=")).filter(p => p.length === 2).map(p => [p[0].trim(), p[1].trim()]).filter(p => p[0]);
  LOOK.h24 = !!s.h24;
  LOOK.ready = true;
  if (LOOK.h24){
    const t = Date.prototype.toLocaleTimeString;
    Date.prototype.toLocaleTimeString = function(l, o){
      o = Object.assign({}, o || {}, {hourCycle:"h23", hour12:false});
      if (o.hour && !o.minute) o.minute = "2-digit";          // "19" alone reads oddly; show "19:00"
      return t.call(this, l, o);
    };
  }
  if (LOOK.plain || LOOK.swaps.length){
    // text on canvases too (charts), but not the falling-leaves effects layers
    const f = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(txt, x, y, mw){
      const id = this.canvas && this.canvas.id;
      return f.call(this, id === "fx" || id === "fun2" ? txt : lookText(String(txt)), x, y, mw);
    };
    let busy = false;
    new MutationObserver(ms => {
      if (busy) return; busy = true;
      try{ for (const m of ms){ if (m.type === "characterData") lookApply(m.target.parentNode || m.target); else m.addedNodes.forEach(n => n.nodeType === 3 ? (n.parentNode && lookApply(n.parentNode)) : n.nodeType === 1 && lookApply(n)); } }
      finally{ busy = false; }
    }).observe(document.body, {subtree:true, childList:true, characterData:true});
    lookApply(document.body);
  }
}

