/* ---------- pages: every page is boxes on a 48x32 grid; a box holds one tile, or several that take turns ----------
   A page has one set of boxes with two arrangements. Landscape is the box's x, y, w, h on 48x32. Portrait is s.p on a
   32x48 grid (the same cells turned on their side) once someone arranges the page for portrait; until then portrait is
   worked out from landscape. A box with no room in one of them is left off that screen (s.loff, s.p.off). */
const U = 2, LC = 24 * U, LR = 16 * U;     // sizes below are written in 24x16 units and scaled by U
// the gap between boxes follows the theme's Spacing (Compact, Normal, Roomy); the editor places boxes with it so it matches the screen
/* The gaps and page margins are written in pixels at 1920x1080. On a smaller screen (an Echo Show 5 is 960x480) they shrink with it,
   so the 32 rows (48 in portrait) still have room: --gs is 1 up to a 1920x1080 screen and smaller below it. */
function screenScale(){
  const w = innerWidth, h = innerHeight, s = Math.min(1, Math.max(w, h) / 1920, Math.min(w, h) / 1080);
  document.documentElement.style.setProperty("--gs", s < 1 ? s.toFixed(4) : "1");
}
screenScale(); addEventListener("resize", screenScale);
// the gap between boxes as drawn (the grid's own computed gap, so the editor agrees with the screen whatever the theme and screen size)
function gapPx(){
  const g = document.querySelector(".cgrid"), v = g && parseFloat(getComputedStyle(g).rowGap);
  return v >= 0 ? v : THEMELIB.spacing(typeof THEMEV === "undefined" ? null : THEMEV).gap * (parseFloat(document.documentElement.style.getPropertyValue("--gs")) || 1);
}
const PC = LR, PR = LC;
let GC = LC, GR = LR;                                // the grid being edited (32x48 while the editor shows portrait)
const dims = o => o === "p" ? [PC, PR] : [LC, LR];
// which arrangement is showing: the screen's shape, which Screen orientation in Settings sets on a turned Echo
function ori(){ return EDIT.on ? EDIT.ori : PORTQ.matches ? "p" : "l"; }
const portOwn = pg => (pg.slots || []).some(s => s.p);
function slotPage(s){ return pgItems().find(p => (p.slots || []).includes(s)); }
// where box s sits in arrangement o ("l" or "p"), or null when it isn't on that screen
function geo(s, o, pg){
  if (o !== "p") return s.loff ? null : s;
  if (s.p) return s.p.off ? null : s.p;
  pg = pg || slotPage(s);
  return pg && portSeed(pg)[s.id] || null;
}
// portrait places for boxes that have none yet: the whole page from landscape (in rows, like a portrait screen
// arranges it), or, on a page arranged for portrait, a free spot for a box added since
function portSeed(pg){
  const S = pg.slots || [];
  const sig = JSON.stringify(S.map(s => [s.id, s.x, s.y, s.w, s.h, s.loff ? 1 : 0, s.p || 0, smods(s)]));
  if (pg._seed && pg._seed.sig === sig) return pg._seed.m;
  const m = {};
  if (!portOwn(pg)){
    const rows = portraitRows(S.filter(s => !s.loff), () => true, true), tot = rows.reduce((a, r) => a + r.height, 0);
    let acc = 0, y = 0;
    for (const r of rows){
      acc += r.height; const y1 = Math.round(acc / tot * PR), n = r.boxes.length;
      if (y1 > y) r.boxes.forEach((b, i) => { m[b.id] = {x:i * PC / n, y, w:PC / n, h:y1 - y}; });
      y = y1;
    }
  } else {
    const taken = S.filter(s => s.p && !s.p.off).map(s => s.p);
    for (const t of S) if (!t.p){ const R = spotFree(taken, [t.w, t.h].concat(bmin(t)), "p"); if (R){ m[t.id] = R; taken.push(R); } }
  }
  Object.defineProperty(pg, "_seed", {value:{sig, m}, writable:true, configurable:true});
  return m;
}
// the first free place, top-left first, for a box of this size [w, h, minW, minH], shrinking down to its smallest
function spotFree(taken, size, o){
  const [C, R] = dims(o), [dw, dh, mw, mh] = size, sizes = [];
  for (let w = Math.min(dw, C); w >= Math.min(mw, C); w -= U) for (let h = Math.min(dh, R); h >= Math.min(mh, R); h -= U) sizes.push([w, h]);
  sizes.push([Math.min(mw, C), Math.min(mh, R)]);
  sizes.sort((a, b) => b[0] * b[1] - a[0] * a[1]);
  for (const [w, h] of sizes) for (let y = 0; y + h <= R; y++) for (let x = 0; x + w <= C; x++){ const r = {x, y, w, h}; if (!taken.some(t => hits(t, r))) return r; }
  return null;
}
const xU = o => { for (const k in o) o[k] = o[k].map(v => Array.isArray(v) ? v.map(n => n * U) : v * U); return o; };
const PAGE_TEMPLATES = xU({
  "Top row + two columns": [[0, 0, 24, 4], [0, 4, 14, 12], [14, 4, 10, 12]],
  "Big + side stack": [[0, 0, 16, 16], [16, 0, 8, 8], [16, 8, 8, 8]],
  "Four squares": [[0, 0, 12, 8], [12, 0, 12, 8], [0, 8, 12, 8], [12, 8, 12, 8]],
  "Blank": []
});

function pgItems(){
  const P = CFG && CFG.pages; if (!P) return [];
  P.settings = P.settings || {};
  const items = P.settings.items = P.settings.items || [];
  for (const p of items) if (p.cols !== LC){        // pages made on an older, coarser grid (12x8, then 24x16)
    const f = LC / (p.cols || 12);
    (p.slots || []).forEach(s => { s.x *= f; s.y *= f; s.w *= f; s.h *= f; });
    p.cols = LC;
  }
  return items;
}
function mainGrid(){
  const L = pgItems(); let m = L.find(p => p.id === "main");
  if (!m && CFG && CFG.pages){ m = {id:"main", name:"Main", on:true, cols:LC, slots:[]}; L.unshift(m); }
  return m || null;
}
// the night page is built in like Main: it takes over the screen between the night hours
function nightGrid(){
  const L = pgItems(); let n = L.find(p => p.id === "night");
  if (!n && CFG && CFG.pages && !SOLO){ n = {id:"night", name:"Night", on:true, cols:LC, slots:[]}; L.push(n); }
  return n || null;
}
function cpages(){ return pgItems().filter(p => p.id !== "main" && p.id !== "night"); }
function cpage(id){ return pgItems().find(p => p.id === id); }
function gridOf(name){ return name === "main" ? mainGrid() : name === "night" ? nightGrid() : name && name.startsWith("c:") ? cpage(name.slice(2)) : null; }
function pgKey(p){ return p.id === "main" || p.id === "night" ? p.id : "c:" + p.id; }
function pageName(p){ return p.id === "main" ? "Main" : p.id === "night" ? "Night" : p.name; }
function boxOf(id){ for (const p of pgItems()) for (const s of p.slots || []) if (smods(s).includes(id)) return {p, s}; return null; }
// a box holds a list of tiles: s.mod is the first, s.more the rest
function smods(s){ return [s.mod].concat(s.more || []).filter(Boolean); }
function setSmods(s, L){ s.mod = L[0] || null; if (L.length > 1) s.more = L.slice(1); else delete s.more; }
const live = s => smods(s).filter(id => MODULES[id]);
function bmin(s){ const L = live(s); return L.length ? [Math.max(...L.map(id => tsize(id)[2])), Math.max(...L.map(id => tsize(id)[3]))] : [1, 1]; }
function boxName(s){ const L = live(s); return !L.length ? "Empty box" : L.length === 1 ? titleOf(L[0]) : L.map(titleOf).join(" / "); }
function newPage(tpl){
  const items = pgItems(), id = "p" + Date.now().toString(36);
  const pg = {id, name:"Page " + (cpages().length + 2), on:true, back:0, cols:LC,
    slots:(PAGE_TEMPLATES[tpl] || PAGE_TEMPLATES["Top row + two columns"]).map((r, i) => ({id:"s" + i + id, x:r[0], y:r[1], w:r[2], h:r[3], mod:null}))};
  items.push(pg);
  return pg;
}
// tiles without a card (clock, weather now) keep their big type, and shrink as a whole only when they don't fit
// their box: a box can lose its empty space without the text changing. The zoom is the largest that fits; it is
// searched for, not worked out from one measurement, because text that wraps at full size unwraps when zoomed out.
// The answer is kept until the box, the text or the fonts change (the clock redraws every second).
let FITGEN = 0;
const FITMIN = 0.55;       // the smallest a tile without a card shrinks to (it was 0.3, too small to read from across a room)
// A tile marks its main content data-keep (a number, a value, the times): the fitter shrinks and drops everything else
// first. A tile marks a decoration data-deco (a blurred backdrop that bleeds past the card): it never counts when fitting.
// A tile's own CSS can use .mini (a box too small for its normal layout) and data-room (see cardFit).
const KEEP = "[data-keep]";
const isKeep = c => c.matches(KEEP) || !!c.querySelector(KEEP);
function decoOff(el){
  const D = [...el.querySelectorAll("[data-deco]")];
  D.forEach(d => { d._dd = d.style.display; d.style.display = "none"; });
  return () => D.forEach(d => { d.style.display = d._dd || ""; });
}
// a box inside the tile that hides its own overflow (a sensor's body, a note's text) can hold text that is cut while the
// tile as a whole looks fitted: the first such box with something cut, or null
function clippedInside(el){
  for (const c of el.querySelectorAll("*")){
    if (c.scrollHeight <= c.clientHeight + 1 || !c.clientHeight || c.dataset.clamp || c.closest("[data-deco]") || c instanceof SVGElement) continue;
    const o = getComputedStyle(c).overflowY;
    if (o === "hidden" || o === "clip") return c;
  }
  return null;
}
// a theme's font arrives after the first draw and changes how tall lines are: fit every tile again with it
if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", () => {
  FITGEN++;
  requestAnimationFrame(() => document.querySelectorAll(".slot > .card").forEach(el => { if (!el.hidden && !(MODULES[el.dataset.mod] || {}).noFit) cardFit(el); }));
});
function slotFit(el, m){
  if (m.card) return;
  if (el.querySelector(":scope > .dz")){ el.style.zoom = ""; el._fit = null; return; }      // a design fits itself (designRender)
  const box = el.parentNode, bw = box.clientWidth, bh = box.clientHeight;
  const sig = bw + "x" + bh + "|" + FITGEN + "|" + el.textContent + "|" + el.firstElementChild?.className + "|" + el.firstElementChild?.style.cssText;
  if (el._fit && el._fit.sig === sig){ el.style.zoom = el._fit.z; return; }
  const back = decoOff(el);
  el.classList.remove("mini");
  const fits = z => { el.style.zoom = z === 1 ? "" : z.toFixed(3); return el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1; };      // same units, zoomed or not
  let z = 1;
  if (!fits(1)){
    // shrinking is for a few percent, not a stand-in for a small layout: a box that needs less than FITMIN of the size
    // gets the tile's own .mini look (its CSS decides what that means) before it shrinks any further
    let lo = FITMIN, hi = 1;
    if (!fits(lo)){ el.classList.add("mini"); if (fits(1)) lo = hi = 1; }
    if (lo < hi && fits(lo)) for (let i = 0; i < 7; i++){ const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
    z = lo;
  }
  back();
  el.style.zoom = z === 1 ? "" : z.toFixed(3);
  el._fit = {sig, z:el.style.zoom};
}
// card tiles never show a half-cut line or row: whatever doesn't fit is dropped whole, and a paragraph is cut at its
// last full line with "…" (no scrolling on a wall display). Runs after each render and whenever the box changes size.
// Text size: the box's own setting (s.ts, 1 = normal) is the start; if the tile doesn't fit, its text shrinks in
// steps to 70% of that before anything is dropped. Narrow tiles (.tight) stack two-column rows.
const TSZ = [["Small", 0.85], ["Normal", 1], ["Large", 1.2], ["Huge", 1.45]];
function cardFit(el){
  el.querySelectorAll(".cut").forEach(e => e.classList.remove("cut"));
  el.querySelectorAll("[data-clamp]").forEach(e => { e.style.webkitLineClamp = ""; e.style.display = ""; e.removeAttribute("data-clamp"); });
  el.querySelectorAll(KEEP).forEach(e => { e.style.zoom = ""; });
  const restore = decoOff(el);
  try{ cardFit1(el); }finally{ restore(); }
  roomFor(el);
}
// what extra space a tile has, for its own CSS: data-room holds "wide" (twice as wide as tall), "tall" and/or "big"
// (twice its usual area); --room is the area as a multiple of its usual area. A tile with grow:"value" also gets its
// main value (data-keep) enlarged while everything still fits. Blank space is fine where there is nothing more to show.
function roomFor(el){
  const m = MODULES[el.dataset.mod] || {}, d = m.size || [12, 8], W = el.clientWidth, H = el.clientHeight; if (!W || !H) return;
  const r = (W * H) / (innerWidth * innerHeight) / (d[0] * d[1] / (LC * LR)), room = [];
  if (W / H >= 2) room.push("wide");
  if (H / W >= 1.2) room.push("tall");
  if (r >= 2) room.push("big");
  el.dataset.room = room.join(" ");
  el.style.setProperty("--room", r.toFixed(2));
  if (m.grow !== "value" || r < 1.3 || el.querySelector(".cut")) return;
  const K = el.querySelector(KEEP); if (!K) return;
  const ok = () => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1 && !clippedInside(el);
  const back = decoOff(el);
  let lo = 1, hi = Math.min(2.4, Math.sqrt(r));
  K.style.zoom = hi.toFixed(3);
  if (ok()) lo = hi; else for (let i = 0; i < 6; i++){ const mid = (lo + hi) / 2; K.style.zoom = mid.toFixed(3); if (ok()) lo = mid; else hi = mid; }
  K.style.zoom = lo === 1 ? "" : lo.toFixed(3);
  back();
}
function cardFit1(el){
  const m = MODULES[el.dataset.mod] || {};
  const sl = el.parentNode && el.parentNode.dataset && slotById(el.parentNode.dataset.slot), base = (sl && +sl.ts) || 1;
  el.classList.toggle("tight", el.clientWidth / base < (m.tight || 460));
  const K0 = [...el.children], zoom = z => K0.forEach(c => { c.style.zoom = z === 1 ? "" : z.toFixed(3); });
  const trunc = () => [...el.querySelectorAll(".li .s, .g .o")].some(c => c.scrollWidth > c.clientWidth + 1 && getComputedStyle(c).textOverflow === "ellipsis");
  const over = () => el.scrollHeight > el.clientHeight + 1 || !!clippedInside(el);
  let z = base; zoom(z);
  while (z > base * 0.72 && (over() || z > base * 0.86 && el.classList.contains("tight") && trunc())){ z -= base * 0.07; zoom(z); }
  const hasKeep = !!el.querySelector(KEEP);
  // what may not be dropped: the main content (data-keep) and what holds it; without a marker, the first thing in the tile
  const prot = (c, i, first) => hasKeep ? isKeep(c) : first && i === 0;
  const R = el.getBoundingClientRect(), k = R.height / el.offsetHeight || 1;
  const limit = R.bottom - parseFloat(getComputedStyle(el).paddingBottom) * k + 1;
  const kids = n => [...n.children].filter(c => { const st = getComputedStyle(c); return st.position !== "absolute" && st.position !== "fixed" && st.display !== "none" && c.getBoundingClientRect().height > 0; });
  const rows = (n, K) => K.length > 1 && K.some(c => c.getBoundingClientRect().top >= K[0].getBoundingClientRect().bottom - 1);
  const clamp = (c, lines) => { c.dataset.clamp = 1; c.style.display = "-webkit-box"; c.style.webkitBoxOrient = "vertical"; c.style.overflow = "hidden"; c.style.webkitLineClamp = lines; };
  const walk = (n, first) => {
    const K = kids(n);
    K.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      if (r.bottom <= limit) return;
      if (r.top >= limit - 4 && !prot(c, i, first)){ c.classList.add("cut"); return; }
      const CK = kids(c);
      if (rows(c, CK)){         // a list or section: drop what doesn't fit; a heading left with nothing under it goes too
        walk(c, false);
        const left = CK.filter(x => !x.classList.contains("cut"));
        if (!prot(c, i, first) && (!left.length || left.length === 1 && !left[0].children.length && left[0].textContent.length < 40)) c.classList.add("cut");
        return;
      }
      const st = getComputedStyle(c), lh = parseFloat(st.lineHeight) * k || parseFloat(st.fontSize) * 1.3 * k;
      const lines = Math.floor((limit - r.top) / lh);
      if (!CK.length || c.textContent.length > 60 && lines >= 1){
        if (lines >= 1){ clamp(c, lines); return; }
      }
      if (!prot(c, i, first)) c.classList.add("cut");
    });
    const vis = K.filter(x => !x.classList.contains("cut")), last = vis[vis.length - 1];      // a label whose content was all dropped
    if (last && vis.length < K.length && K.indexOf(last) < K.length - 1 && !prot(last, K.indexOf(last), first) && !last.children.length && last.textContent.length < 40) last.classList.add("cut");
  };
  if (el.scrollHeight > el.clientHeight + 1) walk(el, true);
  // the main content pushed past the bottom by things above it: they go too, from the top (the title first), whole
  for (let n = 0; hasKeep && n < 12; n++){
    const K = [...el.querySelectorAll(KEEP)].filter(x => getComputedStyle(x).display !== "none"), low = K.find(x => x.getBoundingClientRect().bottom > limit + 1);
    const before = low && kids(el).find(c => !isKeep(c) && !c.classList.contains("cut") && c.compareDocumentPosition(low) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (!before) break;
    before.classList.add("cut");
  }
  // text cut inside a box that hides its own overflow: show whole lines with "…" instead; a box of other things that
  // doesn't hold the main content goes whole. The main content itself is never taken out.
  for (let n = 0, c; n < 8 && (c = clippedInside(el)); n++){
    if (!c.children.length){
      const st = getComputedStyle(c), lh = parseFloat(st.lineHeight) * k || parseFloat(st.fontSize) * 1.3 * k, lines = Math.floor(c.clientHeight * k / lh);
      if (lines >= 1) clamp(c, lines); else if (!c.matches(KEEP)) c.classList.add("cut"); else break;
    } else if (!isKeep(c)) c.classList.add("cut");
    else break;
  }
}
const FITOBS = typeof ResizeObserver === "function" ? new ResizeObserver(E => E.forEach(e => { for (const el of e.target.children) if (el.classList.contains("card") && !el.hidden && !(MODULES[el.dataset.mod] || {}).noFit) cardFit(el); })) : null;
const NARROW = 7 * U * 40;    // a box this narrow (in pixels on a 1920x1080 screen, or 1080x1920) or narrower gets the compact look
// a tile type can say where its own compact look starts (narrow:px in the same units); a box holding several tiles
// gets the compact look when any of them wants it
const narrowAt = s => Math.max(...live(s).map(id => (MODULES[id] || {}).narrow || NARROW), live(s).length ? 0 : NARROW);
function placeSlot(d, s, pg){
  const o = ori(), r = geo(s, o, pg);
  d.classList.toggle("off", !r);
  if (!r) return;
  d.style.setProperty("--slot-col", (r.x + 1) + " / span " + r.w); d.style.setProperty("--slot-row", (r.y + 1) + " / span " + r.h);
  const n = r.w * (o === "p" ? Math.min(innerWidth, innerHeight) / PC : Math.max(innerWidth, innerHeight) / LC) <= narrowAt(s);
  if (d.classList.contains("narrow") !== n){ d.classList.toggle("narrow", n); if (d.isConnected) live(s).forEach(id => render(id)); } }
function portraitRows(slots, showing, all){
  const boxes = slots.filter(s => (all || live(s).length) && showing(s)).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const box of boxes){
    const types = live(box).map(id => MODULES[id].type);
    const week = types.includes("week");
    const wide = box.w > LC / 2 || week || types.includes("month");
    const height = week ? 12 : Math.max(5, Math.min(box.h, 12));
    const last = rows[rows.length - 1], first = last && last.boxes[0];
    // Pair neighboring boxes from the same band. A wide box starts its own row.
    if (!wide && last && !last.wide && last.boxes.length === 1 && box.y < first.y + first.h){
      last.boxes.push(box);
      last.boxes.sort((a, b) => a.x - b.x);       // a box that starts a little higher can still sit on the right
      last.height = Math.max(last.height, height);
    } else rows.push({boxes:[box], wide, height});
  }
  return rows;
}
function gridEl(sec, pg){
  const g = document.createElement("div"); g.className = "cgrid"; sec.appendChild(g);
  const SLOT = {}, boxes = new Map(), slots = pg.slots || [];
  for (const sl of slots){
    const d = document.createElement("div"); d.className = "slot"; d.dataset.slot = sl.id;
    if (FITOBS) FITOBS.observe(d);
    placeSlot(d, sl, pg); g.appendChild(d);
    boxes.set(sl, d);
    const L = live(sl);
    L.forEach(id => { SLOT[id] = d; });
    if (!L.length) d.classList.add("empty");
    if (L.length > 1){ d.classList.add("stack"); const dots = document.createElement("div"); dots.className = "stkdots"; dots.innerHTML = L.map(() => "<i></i>").join(""); d.appendChild(dots);
      dots.addEventListener("click", e => { if (EDIT.on) return; e.stopPropagation(); stackNext(d); }); }
  }
  g._slots = slots; g._boxes = boxes; g._pg = pg;
  g.classList.toggle("pflow", !portOwn(pg));          // not arranged for portrait: a portrait screen puts its boxes in rows
  portraitFlow(g);
  return SLOT;
}
// Portrait: a box with nothing to show right now (say, radar waiting for rain) gives its row to the others
function slotShowing(d){
  return EDIT.on || !d.querySelector(":scope > [data-mod]") ||
    [...d.children].some(c => c.dataset.mod && !c.hidden && !c.classList.contains("stk-off"));
}
function portraitFlow(g){
  if (!g || !g._boxes) return;
  const key = g._slots.map(s => slotShowing(g._boxes.get(s)) ? 1 : 0).join("");
  if (g._flow === key) return;
  g._flow = key;
  const rows = portraitRows(g._slots, s => slotShowing(g._boxes.get(s)));
  for (const [s, d] of g._boxes) d.classList.toggle("idle", !slotShowing(d));
  g.style.setProperty("--portrait-rows", rows.map(r => "minmax(0," + r.height + "fr)").join(" "));
  rows.forEach(({boxes: row}, y) => row.forEach((box, x) => {
    const style = g._boxes.get(box).style;
    style.setProperty("--portrait-col", row.length === 1 ? "1 / -1" : String(x + 1));
    style.setProperty("--portrait-row", y + 1);
  }));
}
function slotById(id){ for (const p of pgItems()) for (const s of p.slots || []) if (s.id === id) return s; return null; }
// Tiles in one box take turns. A tile with nothing to show (has() false) skips its turn; a tile whose
// "take over" setting is on and that matters right now (urgent()) keeps the box until it doesn't.
const STKPICK = {};          // box id -> {id, until}: a tile picked by tapping the dots stays up for one turn
function stackPick(s, ids){
  if (EDIT.on && EDIT.sel === s.id && ids.includes(EDIT.tile)) return EDIT.tile;
  const mp = STKPICK[s.id]; if (mp && Date.now() < mp.until && ids.includes(mp.id)) return mp.id;
  const urg = ids.find(tileUrgent); if (urg) return urg;
  const show = ids.filter(tileHas);
  if (!show.length) return EDIT.on ? ids[0] : null;
  return show[Math.floor(Date.now() / (Math.max(5, +s.every || 20) * 1000)) % show.length];
}
function stackTick(){
  document.querySelectorAll(".slot.stack").forEach(d => {
    const s = slotById(d.dataset.slot); if (!s) return;
    const ids = live(s).filter(id => MOUNTED[id] && MOUNTED[id].parentNode === d), cur = stackPick(s, ids);
    if (d._cur !== cur || d._cur === undefined){
      const old = d._cur; d._cur = cur;
      ids.forEach(id => MOUNTED[id].classList.toggle("stk-off", id !== cur));
      const oe = old && MOUNTED[old];
      if (oe && oe._shownT && old !== cur){ oe._shownT = 0; const m = MODULES[old]; if (m && m.hide) try{ m.hide(oe); }catch(e){} }
      if (cur) render(cur);           // drawn fresh when its turn comes
      portraitFlow(d.closest(".cgrid"));
    }
    const dots = d.querySelector(".stkdots");
    if (dots) [...dots.children].forEach((x, i) => x.classList.toggle("on", ids[i] === cur));
  });
}
// tap the dots: show the next tile in the box now
function stackNext(d){
  const s = slotById(d.dataset.slot); if (!s) return;
  const ids = live(s).filter(id => MOUNTED[id] && MOUNTED[id].parentNode === d); if (ids.length < 2) return;
  const show = ids.filter(tileHas), L = show.length > 1 ? show : ids, i = L.indexOf(d._cur);
  STKPICK[s.id] = {id:L[(i + 1) % L.length], until:Date.now() + Math.max(5, +s.every || 20) * 1000};
  stackTick();
}
// called from layout(): build the pages; returns tile id -> the box it lives in
function cpagesBuild(){
  let SLOT = {};
  if (FITOBS) FITOBS.disconnect();
  document.querySelectorAll(".cpage").forEach(s => s.remove());
  document.querySelectorAll("#p1 > .cgrid").forEach(s => s.remove());
  const mg = mainGrid();
  if (mg) SLOT = gridEl($("p1"), mg);
  if (SOLO) return SLOT;
  for (const pg of cpages()){
    if (pg.on === false) continue;
    const sec = document.createElement("section"); sec.className = "page cpage gpage"; sec.dataset.page = pg.id;
    Object.assign(SLOT, gridEl(sec, pg));
    $("pages").appendChild(sec);
  }
  const ng = nightGrid();
  if (ng){
    const sec = document.createElement("section"); sec.className = "page cpage gpage npage"; sec.dataset.page = "night";
    Object.assign(SLOT, gridEl(sec, ng));
    $("pages").appendChild(sec);
  }
  return SLOT;
}
window.dashGoPage = name => { const i = pageList().indexOf(name); if (i >= 0){ if (EDIT.on && gridOf(name)){ EDIT.sel = null; goEditPage(name); } else showPage(i); } return i; };

