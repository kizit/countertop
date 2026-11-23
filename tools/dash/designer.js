/* ---------- tile designer: a tile with parts() (Clock, Weather now, Night clock) can be laid out freely ----------
   design = {on, parts:{id:{x, y, s, a, c, f, ff, w, tt, ls, it, hide, noemoji, set}}}: x/y in % of the tile (x is the
   left, middle or right edge, per a = l|c|r), s = text size in % of the tile's height. */
// Saved designs live in one library per tile type (tiles.settings.designs = {clock:[{id, name, parts}]}), so a design
// can be picked like a style by any tile of that type. A tile using one has design = {on, ref, name, parts}; the
// parts there are a copy, kept in step when the design is saved, so the tile still draws if the library is lost.
const clone = o => JSON.parse(JSON.stringify(o));
function designLib(type){
  const t = CFG.tiles = CFG.tiles || {on:true, settings:{}}; t.settings = t.settings || {};
  const L = t.settings.designs = t.settings.designs && typeof t.settings.designs === "object" && !Array.isArray(t.settings.designs) ? t.settings.designs : {};
  return (L[type] = Array.isArray(L[type]) ? L[type] : []);
}
function designOf(m){
  const d = m && m.s && m.s.design; if (!d || !d.on || !m.parts) return null;
  const L = designLib(m.type); if (!d.ref) d.ref = "d_" + m.id;
  let x = L.find(v => v.id === d.ref);
  if (!x && d.parts){ x = {id:d.ref, name:d.name || "My " + TYPES[m.type].title.toLowerCase(), parts:clone(d.parts)}; L.push(x); }
  return x || null;
}
function designed(m){ return !!designOf(m); }
// after a design is saved, renamed or deleted: bring every tile that uses it up to date
function designSync(type, ref){
  const x = designLib(type).find(v => v.id === ref);
  for (const it of tileItems()){ const d = it.type === type && it.settings && it.settings.design; if (!d || d.ref !== ref) continue;
    if (x){ d.name = x.name; d.parts = clone(x.parts); } else delete it.settings.design; }
}
const designUsers = (type, ref) => tileItems().filter(it => it.type === type && it.settings && it.settings.design && it.settings.design.on && it.settings.design.ref === ref).length;
function designName(type, base){ const L = designLib(type); let n = base, i = 2; while (L.some(v => v.name === n)) n = base + " " + i++; return n; }
const stripEmoji = h => String(h).replace(EMO, "").replace(/ {2,}/g, " ").trim();
function wxSymbol(code, night){
  // by weather code, so it doesn't depend on the words wx() shows (those follow the Language setting)
  if (code >= 95) return "ϟ"; if (isSnow(code)) return "❄︎"; if (isWet(code)) return "☂︎";
  if (code === 45 || code === 48) return "≋"; if (code === 2 || code === 3) return "☁︎"; return night ? "☾" : "☀︎";
}
// A design is drawn on a canvas the height of the box it was made in (D.rows grid rows): sizes and the distance from
// the top are a share of that height. In a shorter box the text keeps its size and the empty space at the bottom
// goes first; only when the parts no longer fit does everything shrink together. A taller box scales it up.
function designSlot(m){ const h = MOUNTED[m.id], b = h && h.parentNode; return b && b.dataset && b.dataset.slot ? slotById(b.dataset.slot) : null; }
function designBasis(el, m, D){
  const H = el.clientHeight || 100, sl = el.closest("#edfocus") ? null : designSlot(m);
  if (sl && !D.rows) D.rows = sl.h;               // older designs: the box they are in now is the one they were made for
  return sl && D.rows > sl.h ? H * D.rows / sl.h : H;
}
function designRender(el, m){
  const D = designOf(m), H = el.clientHeight || 100;
  const Hb = designBasis(el, m, D);
  designDraw(el, m, D, Hb);
  let hb = Hb;
  for (let i = 0; i < 3 && hb > H; i++){          // shorter than its canvas: shrink only while the parts run past the bottom
    let B = 0; el.querySelectorAll(":scope > .dz > .dzp:not([hidden])").forEach(n => { B = Math.max(B, n.offsetTop + n.offsetHeight); });
    if (B <= H + 1) break;
    hb = Math.max(H, hb * H / B * .99); designDraw(el, m, D, hb);
  }
  el._hb = hb;
}
function designDraw(el, m, D, H){
  const ts = (THEMEV.textScale || 100) / 100;
  el._k = null; el._key = null;
  let box = el.querySelector(":scope > .dz");
  if (!box){ el.innerHTML = '<div class="dz"></div>'; box = el.firstChild; el.classList.add("dzhost"); }
  const P = m.parts(), seen = new Set(), fitOff = !!el.closest("#edfocus"), W = el.clientWidth;
  for (const p of P){
    const o = D.parts[p.id] || {}; seen.add(p.id);
    let n = box.querySelector(':scope > [data-part="' + p.id + '"]');
    if (!n){ n = document.createElement("div"); n.className = "dzp"; n.dataset.part = p.id; box.appendChild(n); }
    const html = o.noemoji ? stripEmoji(p.html) : LOOK.plain || LOOK.swaps.length ? lookText(p.html) : p.html, hide = !!o.hide || !html || o.x == null;
    n.hidden = hide; if (hide) continue;
    if (n._h !== html){ n._h = html; n.innerHTML = html; }
    const css = "left:" + o.x + "%;top:" + (o.y * H / 100).toFixed(1) + "px;font-size:" + ((o.s || 8) * H / 100 * ts).toFixed(1) + "px;font-weight:" + (o.w || 400) +
      ";transform:translateX(" + (o.a === "r" ? "-100%" : o.a === "c" ? "-50%" : "0") + ")" + (o.c ? ";color:" + o.c : "") +
      ";font-family:" + (FONTS[o.f] || o.ff || "inherit") + (o.tt ? ";text-transform:" + o.tt : "") + (o.ls ? ";letter-spacing:" + o.ls + "em" : "") + (o.it ? ";font-style:italic" : "");
    if (n._css !== css || n._fit !== html || n._fitWidth !== W){
      n._css = css; n._fit = html; n._fitWidth = W; n.style.cssText = css;
      // on the screen (not while designing), text that came out longer than planned shrinks to stay inside the tile
      if (!fitOff){ const xp = o.x / 100 * W, w = n.offsetWidth, room = o.a === "r" ? xp : o.a === "c" ? 2 * Math.min(xp, W - xp) : W - xp;
        if (W && w > room && room > 20) n.style.fontSize = (parseFloat(n.style.fontSize) * room / w * .97).toFixed(1) + "px"; }
    }
  }
  [...box.children].forEach(n => { if (!seen.has(n.dataset.part)) n.hidden = true; });
}
const hexOf = c => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(c || ""); if (!m) return c || "";
  const h = "#" + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, "0")).join(""); return m[4] != null && +m[4] < 1 ? c : h; };
// start a design from one of the tile's ready-made styles: draw that style off-screen and note where each part landed
function designFromPreset(m, style){
  const el = MOUNTED[m.id], W = (el && el.offsetWidth) || 600, H = (el && el.offsetHeight) || 300;
  const tmp = document.createElement(m.card ? "section" : "div"); tmp.className = (m.card ? "card " : "") + (m.cls || "");
  tmp.style.cssText = "position:fixed;left:-7000px;top:0;width:" + W + "px;height:" + H + "px"; document.body.appendChild(tmp);
  const st = Object.assign({}, m.s, {design:null, size:100}, style ? {style} : {}), clone = Object.create(m);
  Object.defineProperty(clone, "s", {value:st});
  for (const k in st) if (typeof st[k] === "boolean" && k !== "seconds" && k !== "ampm" && k !== "takeover") st[k] = true;   // show every part so it gets a place
  st.air = true; st.sun = true; st.rain = true; st.greeting = true; st.date = true; st.countdowns = true;
  try{ clone.render(tmp); }catch(e){}
  const R = tmp.getBoundingClientRect(), z = (+m.s.size || 100) / 100, al = String(m.s.align || (TYPES[m.type].settings.align || {}).default || "Left");
  const a = al === "Right" ? "r" : al === "Center" ? "c" : "l", out = {}, cur = (designOf(m) || {}).parts || {};
  let y0 = 8;
  for (const p of m.parts()){
    const n = tmp.querySelector('[data-part="' + p.id + '"]');
    if (!n || !n.getClientRects().length || !n.textContent.trim()){ out[p.id] = {hide:true, x:a === "r" ? 92 : a === "c" ? 50 : 6, y:Math.min(85, y0 += 10), s:8, a}; continue; }
    const r = n.getBoundingClientRect(), cs = getComputedStyle(n), fs = parseFloat(cs.fontSize) || 16;
    const x = a === "l" ? r.left - R.left : a === "r" ? r.right - R.left : (r.left + r.right) / 2 - R.left;
    const sz = +(fs * z / H * 100).toFixed(2), o = {x:+(x / W * 100).toFixed(1), y:+Math.min((r.top - R.top) / H * 100, 100 - sz).toFixed(1), s:sz, a, c:hexOf(cs.color), w:+cs.fontWeight || 400, ff:cs.fontFamily};
    if (cs.textTransform && cs.textTransform !== "none") o.tt = cs.textTransform;
    if (parseFloat(cs.letterSpacing)) o.ls = +(parseFloat(cs.letterSpacing) / fs).toFixed(3);
    if (cs.fontStyle === "italic") o.it = true;
    // a part the tile's settings had switched off starts hidden
    const key = Object.keys(m.settings || {}).find(k => m.settings[k].part === p.id) || {moon:"sun"}[p.id];
    if (key && m.s[key] === false && !(key === "countdowns" && (m.s.extra || []).length)) o.hide = true;
    if (cur[p.id] && cur[p.id].set) o.set = cur[p.id].set;
    out[p.id] = o;
  }
  tmp.remove();
  return {on:true, parts:out};
}

/* ----- designer mode in the editor: the tile fills the frame; drag parts, drag the corner to resize, side panel changes the rest ----- */
const dzM = () => EDIT.focus && MODULES[EDIT.focus.id];
const dzX = () => designOf(dzM());
const dzP = id => { const x = dzX(); return x && (x.parts[id] = x.parts[id] || {}); };
// fresh: start a new design (from the tile's current style, or a copy of the design it uses); otherwise edit the one it uses
function designStart(id, fresh){
  const m = MODULES[id]; if (!m || !m.parts) return;
  const before = JSON.stringify(CFG), hist = EDIT.hist.length;
  // the designer's canvas is this box: redraw the design for its height first, so it looks just as it does on the screen
  const el = MOUNTED[id], sl = designSlot(m), cur0 = designOf(m);
  const rebase = parts => { const k = el && el._hb && el.clientHeight ? el._hb / el.clientHeight : 1;
    if (Math.abs(k - 1) > .005) for (const o of Object.values(parts)) if (o){ if (o.y != null) o.y = +(o.y * k).toFixed(1); if (o.s != null) o.s = +(o.s * k).toFixed(2); }
    return parts; };
  if (fresh || !designed(m)){
    const cur = cur0, ref = "d" + Date.now().toString(36);
    const name = designName(m.type, cur ? cur.name + " copy" : "My " + TYPES[m.type].title.toLowerCase());
    remember();
    const parts = cur ? rebase(clone(cur.parts)) : designFromPreset(m).parts;
    designLib(m.type).push(Object.assign({id:ref, name, parts}, sl ? {rows:sl.h} : {}));
    m.s.design = {on:true, ref, name, parts:clone(parts)};
    fresh = true;
  } else if (cur0 && sl && cur0.rows !== sl.h){ remember(); rebase(cur0.parts); cur0.rows = sl.h; }
  EDIT.focus = {id, sel:null, before, hist, fresh:!!fresh}; EDIT.panel = null;
  document.body.classList.add("dzmode");
  render(id); edPaint(true); designPaint();
  clearInterval(designStart.t); designStart.t = setInterval(() => { if (!EDIT.focus) return clearInterval(designStart.t); if (!EDIT.focus.drag) designPaint(); }, 1000);
}
// keep: true saves (the design is already in the library; copy it to every tile using it), false puts everything back
function designEnd(keep){
  const f = EDIT.focus, m = dzM();
  if (f && keep === false){
    CFG = JSON.parse(f.before); EDIT.hist.length = Math.min(EDIT.hist.length, f.hist); tilesSetup();
  } else if (f && m){ const x = designOf(m); if (x) designSync(m.type, x.id); }
  EDIT.focus = null; document.body.classList.remove("dzmode");
  const F = $("edfocus"); if (F) F.remove();
  relayout(); if (keep === false) goEditPage(EDIT.page);
}
function designPaint(){
  const m = dzM(); if (!m || !dzX()){ designEnd(); return; }
  let F = $("edfocus");
  if (!F){
    F = document.createElement("div"); F.id = "edfocus";
    F.innerHTML = '<div class="fbg"></div><div class="fst"></div><div class="fhs"></div><div class="ftip">Drag a part to move it · drag the dot to resize · tap to change it</div>';
    $("edl").appendChild(F);
    F.addEventListener("pointerdown", designDown);
  }
  F.classList.toggle("night", EDIT.page === "night");
  const el = MOUNTED[m.id], W0 = (el && el.offsetWidth) || 600, H0 = (el && el.offsetHeight) || 300;
  const {width, height} = F.getBoundingClientRect();
  const top = $("edbar").getBoundingClientRect().bottom + 34;
  const aw = Math.max(1, width - 80), ah = Math.max(1, height - top - 60), k = Math.min(aw / W0, ah / H0, 3);
  const st = F.querySelector(".fst");
  if (!st.firstChild || st._for !== m.id + W0 + "x" + H0){
    st._for = m.id + W0 + "x" + H0;
    st.innerHTML = ""; const t = document.createElement(m.card ? "section" : "div"); t.className = (m.card ? "card " : "") + (m.cls || "") + " ftile"; st.appendChild(t);
  }
  Object.assign(st.style, {width:W0 + "px", height:H0 + "px", left:(40 + (aw - W0 * k) / 2) + "px", top:(top + (ah - H0 * k) / 2) + "px", transform:"scale(" + k + ")"});
  designRender(st.firstChild, m);
  EDIT.focus.k = k; EDIT.focus.W0 = W0; EDIT.focus.H0 = H0;
  // a handle over every visible part
  const hs = F.querySelector(".fhs"), sel = EDIT.focus.sel;
  hs.innerHTML = [...st.firstChild.querySelectorAll(".dzp:not([hidden])")].map(n => {
    const r = n.getBoundingClientRect(), id = n.dataset.part;
    return '<div class="fh' + (id === sel ? " sel" : "") + '" data-dzp="' + id + '" style="left:' + (r.left - 4) + 'px;top:' + (r.top - 4) + 'px;width:' + (r.width + 8) + 'px;height:' + (r.height + 8) + 'px">' +
      (id === sel ? '<i class="fr" data-dzr="' + id + '"></i>' : "") + '</div>';
  }).join("");
}
function designDown(e){
  const m = dzM(); if (!m) return;
  const r = e.target.closest("[data-dzr]"), h = e.target.closest("[data-dzp]");
  if (!h && !r){ if (EDIT.focus.sel){ EDIT.focus.sel = null; edPaint(true); designPaint(); } return; }
  e.preventDefault(); e.stopPropagation();
  const id = (r || h).dataset.dzr || (r || h).dataset.dzp, o = dzP(id);
  const newSel = EDIT.focus.sel !== id;
  try{ $("edfocus").setPointerCapture(e.pointerId); }catch(err){}      // designPaint replaces .fh handles; keep touch capture on #edfocus
  if (newSel){ EDIT.focus.sel = id; edPaint(true); }
  const box = h.getBoundingClientRect();
  remember();
  EDIT.focus.drag = {id, resize:!!r, x0:e.clientX, y0:e.clientY, ox:o.x, oy:o.y, os:o.s, bh:box.height, moved:false};
  const move = ev => {
    const d = EDIT.focus && EDIT.focus.drag; if (!d) return;
    const dx = ev.clientX - d.x0, dy = ev.clientY - d.y0, f = EDIT.focus;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.resize){ o.s = Math.max(1, Math.min(90, +(d.os * Math.max(.15, (d.bh + dy) / d.bh)).toFixed(2))); }
    else {
      let x = d.ox + dx / (f.W0 * f.k) * 100, y = d.oy + dy / (f.H0 * f.k) * 100;
      if (!ev.shiftKey){ x = Math.round(x * 2) / 2; y = Math.round(y * 2) / 2; if (Math.abs(x - 50) < 1.2 && o.a === "c") x = 50; }
      o.x = Math.max(-20, Math.min(120, +x.toFixed(1))); o.y = Math.max(-20, Math.min(110, +y.toFixed(1)));
    }
    designPaint();
  };
  const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up); const d = EDIT.focus && EDIT.focus.drag; if (EDIT.focus) EDIT.focus.drag = null;
    if (d && !d.moved) EDIT.hist.pop(); render(m.id); edPaint(true); designPaint();
    const sec = newSel && $("dzsec"); if (sec) sec.scrollIntoView({block:"start"}); };
  addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up);
}
const DZ_SW = ["#ffffff", "#d5dbe3", "#8a939e", "accent", "#ffd36e", "#ff9f5a", "#7fd18a", "#ff7a8a"];
function panelDesign(){
  const m = dzM(), X = dzX(); if (!m || !X) return "";
  const f = EDIT.focus, P = m.parts(), sel = f.sel, o = sel && X.parts[sel], styles = presetsOf(m), n = designUsers(m.type, X.id);
  let h = '<div class="ph"><button data-act="dzdone">‹ Done</button><b>' + (f.fresh ? "New design" : "Edit design") + '</b></div>';
  h += '<div class="grp"><label class="kv col"><span>Name<small>It shows up next to the styles, for any ' + esc(TYPES[m.type].title) + ' tile</small></span>' +
    '<input type="text" data-dz="name" maxlength="40" value="' + esc(X.name) + '"></label></div>';
  if (n > 1) h += '<p class="pd">Used by ' + n + ' tiles. Changes show on all of them.</p>';
  h += '<p class="pd">Drag a part on the tile to move it, and drag its corner dot to make it bigger or smaller. Tap a part (on the tile or in the list) to change its color, font and more.</p>';
  if (styles.length > 1) h += '<div class="sh">Start over from a style</div><div class="seg2 wrap">' + styles.map(v => '<button data-act="dzstyle" data-v="' + esc(v) + '">' + esc(v) + '</button>').join("") + '</div>';
  else h += '<div class="btns"><button data-act="dzstyle" data-v="' + esc(styles[0]) + '">Start over from the standard look</button></div>';
  h += '<div class="sh">Parts</div><div class="grp">' + P.map(p => { const q = X.parts[p.id] || {};
    return '<div class="kv dzrow' + (p.id === sel ? " on" : "") + '"><button class="dzpick" data-act="dzsel" data-id="' + p.id + '">' + esc(p.label) + (!p.html ? '<small>Nothing to show right now</small>' : "") + '</button>' +
      '<input type="checkbox" class="sw" data-dz="show" data-id="' + p.id + '"' + (q.hide ? "" : " checked") + ' aria-label="Show ' + esc(p.label) + '"></div>'; }).join("") + '</div>';
  if (o && !o.hide){
    const p = P.find(x => x.id === sel) || {}, v = (k, d) => o[k] == null ? d : o[k];
    h += '<div class="sh" id="dzsec">' + esc(p.label || sel) + '</div><div class="grp">';
    h += '<label class="kv"><span>Size</span><span><input type="range" min="2" max="70" step="0.5" data-dz="s" value="' + v("s", 8) + '"></span></label>';
    h += '<div class="kv col"><span>Color</span><div class="dzsw">' + DZ_SW.map(c => '<button data-act="dzc" data-v="' + c + '" style="background:' + (c === "accent" ? "var(--accent)" : c) + '"' +
      ((o.c || "") === (c === "accent" ? "var(--accent)" : c) ? ' class="on"' : "") + ' title="' + (c === "accent" ? "Accent color (follows the look)" : c) + '"></button>').join("") +
      '<input type="color" data-dz="c" value="' + esc(/^#[0-9a-f]{6}$/i.test(o.c || "") ? o.c : "#ffffff") + '"></div></div>';
    h += '<label class="kv"><span>Font</span><select data-dz="f"><option value="">As the style had it</option>' + Object.keys(FONTS).map(f => '<option' + (o.f === f ? " selected" : "") + '>' + esc(f) + '</option>').join("") + '</select></label>';
    h += '<div class="kv col"><span>Weight</span><div class="seg2">' + [["Light", 200], ["Regular", 400], ["Bold", 700]].map(([l, w]) => '<button data-act="dzw" data-v="' + w + '"' + (Math.abs((o.w || 400) - w) < 100 ? ' class="on"' : "") + '>' + l + '</button>').join("") + '</div></div>';
    h += '<div class="kv col"><span>Line up by its<small>Which edge stays put when the text gets longer</small></span><div class="seg2">' + [["Left edge", "l"], ["Middle", "c"], ["Right edge", "r"]].map(([l, a]) => '<button data-act="dza" data-v="' + a + '"' + ((o.a || "l") === a ? ' class="on"' : "") + '>' + l + '</button>').join("") + '</div></div>';
    h += '<label class="kv"><span>Capital letters</span><input type="checkbox" class="sw" data-dz="tt"' + (o.tt === "uppercase" ? " checked" : "") + '></label>';
    if ((p.icon || p.emoji) && LOOK.plain) h += '<div class="kv"><span>Emoji<small>Off everywhere, from Controls → Settings → Icons and emoji</small></span></div>';
    else if (p.icon) h += '<div class="kv col"><span>Icon style</span><div class="seg2">' + ["Emoji", "Symbols"].map(x => '<button data-act="dzset" data-v="' + x + '"' + ((o.set || "Emoji") === x ? ' class="on"' : "") + '>' + (x === "Emoji" ? "Color emoji ⛅" : "Simple ☁︎") + '</button>').join("") + '</div></div>';
    if (p.emoji && !LOOK.plain) h += '<label class="kv"><span>Emoji in it<small>Off shows just the words</small></span><input type="checkbox" class="sw" data-dz="emoji"' + (o.noemoji ? "" : " checked") + '></label>';
    h += '</div><div class="btns"><button data-act="dzcenter">Center it across</button></div>';
  }
  h += '<div class="btns dzend"><button class="pri" data-act="dzdone">Done</button><button data-act="dzcancel">' + (f.fresh ? "Discard" : "Cancel changes") + '</button></div>';
  if (!f.fresh) h += '<button class="wide red" data-act="dzdel">' + (f.delArm ? "Tap again to delete “" + esc(X.name) + "”" : "Delete this design") + '</button>' +
    (f.delArm ? '<p class="pd">Tiles using it go back to their ' + (styles.length > 1 ? "style" : "standard look") + '.</p>' : "");
  return h;
}
// the tile's ready-made styles (one "Standard" for a type without a style setting)
const presetsOf = m => (((m.settings || {}).style || {}).choices || ["Standard"]);
function designAct(a, el){
  const v = el && el.dataset.v;
  if (a === "dznew") return designStart(EDIT.tile, true);
  if (a === "dzedit") return designStart(EDIT.tile, false);
  if (a === "dzpick"){              // the Style chooser on the tile's settings: a ready-made style or a saved design
    const t = MODULES[EDIT.tile]; if (!t) return;
    remember();
    if (v.startsWith("p:")){ if (t.settings.style) t.s.style = v.slice(2); if (t.s.design) t.s.design.on = false; }
    else { const x = designLib(t.type).find(d => d.id === v.slice(2)); if (x) t.s.design = {on:true, ref:x.id, name:x.name, parts:clone(x.parts)}; }
    render(t.id); edPaint(true); return;
  }
  const m = dzM(), X = dzX(); if (!m || !X) return;
  const f = EDIT.focus;
  if (a !== "dzdel") f.delArm = false;
  if (a === "dzdone"){ designEnd(true); return; }
  if (a === "dzcancel"){ designEnd(false); return; }
  if (a === "dzdel"){
    if (!f.delArm){ f.delArm = true; edPaint(true); return; }
    remember(); const L = designLib(m.type); L.splice(L.indexOf(X), 1); designSync(m.type, X.id); designEnd(true); return;
  }
  if (a === "dzsel"){ f.sel = f.sel === el.dataset.id ? null : el.dataset.id; const o = f.sel && X.parts[f.sel]; if (o && o.hide) f.sel = null; edPaint(true); designPaint(); return; }
  if (a === "dzstyle"){
    remember(); if (m.settings.style) m.s.style = v;
    const set = X.parts.icon && X.parts.icon.set; X.parts = designFromPreset(m, v).parts; if (set && X.parts.icon) X.parts.icon.set = set;
    f.sel = null; designPaint(); edPaint(true); return;
  }
  const o = f.sel && dzP(f.sel); if (!o) return;
  remember();
  if (a === "dzc") o.c = v === "accent" ? "var(--accent)" : v;
  if (a === "dzw") o.w = +v;
  if (a === "dza"){       // keep it where it is on screen while changing which edge is anchored
    const n = document.querySelector('#edfocus .ftile [data-part="' + f.sel + '"]');
    if (n){ const r = n.getBoundingClientRect(), R = n.parentNode.getBoundingClientRect(), w = r.width / (f.W0 * f.k) * 100, left = (r.left - R.left) / (f.W0 * f.k) * 100;
      o.x = +(v === "l" ? left : v === "c" ? left + w / 2 : left + w).toFixed(1); }
    o.a = v;
  }
  if (a === "dzset") o.set = v;
  if (a === "dzcenter"){ o.a = "c"; o.x = 50; }
  designPaint(); edPaint(true);
}
function designInput(t){
  const m = dzM(), X = dzX(); if (!m || !X) return;
  const k = t.dataset.dz, f = EDIT.focus;
  if (k === "name"){ const n = t.value.trim().slice(0, 40); if (n && n !== X.name){ remember(); X.name = n; } else t.value = X.name; return; }
  if (k === "show"){
    remember(); const o = dzP(t.dataset.id); o.hide = !t.checked;
    if (!o.hide && o.x == null){ o.x = 10; o.y = 10; o.s = 8; }
    f.sel = o.hide ? (f.sel === t.dataset.id ? null : f.sel) : t.dataset.id;
  } else {
    const o = f.sel && X.parts[f.sel]; if (!o) return;
    remember();
    if (k === "s") o.s = +t.value;
    if (k === "c") o.c = t.value;
    if (k === "f"){ if (t.value) o.f = t.value; else delete o.f; }
    if (k === "tt"){ if (t.checked) o.tt = "uppercase"; else delete o.tt; }
    if (k === "emoji"){ if (t.checked) delete o.noemoji; else o.noemoji = true; }
  }
  render(m.id); designPaint(); edPaint(true);
}
// live while dragging the size slider
document.addEventListener("input", e => { const t = e.target; if (t.dataset && t.dataset.dz === "s" && dzM()){ const o = dzX() && dzX().parts[EDIT.focus.sel]; if (o){ o.s = +t.value; designPaint(); } } });
// arrow keys nudge the selected part; Esc leaves the designer
addEventListener("keydown", e => {
  const m = dzM(); if (!m) return;
  if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key === "z" || e.key === "Z")){ e.preventDefault(); e.stopImmediatePropagation(); undo(e.shiftKey ? -1 : 1); if (dzM()) designPaint(); else designEnd(); return; }
  if (e.key === "Escape"){ e.stopImmediatePropagation(); if (EDIT.focus.sel){ EDIT.focus.sel = null; edPaint(true); designPaint(); } else designEnd(true); return; }
  const o = EDIT.focus.sel && dzX() && dzX().parts[EDIT.focus.sel];
  const dv = {ArrowLeft:[-1, 0], ArrowRight:[1, 0], ArrowUp:[0, -1], ArrowDown:[0, 1]}[e.key];
  e.stopImmediatePropagation();
  if (!o || !dv) return;
  e.preventDefault(); remember();
  const st = e.shiftKey ? 2 : .5; o.x = +(o.x + dv[0] * st).toFixed(1); o.y = +(o.y + dv[1] * st).toFixed(1);
  designPaint();
}, true);

