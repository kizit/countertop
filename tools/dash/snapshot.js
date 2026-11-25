/* ---------- Screen snapshot: what this browser really laid out, for bug reports ----------
   Controls asks; this screen answers with measurements only (sizes, positions, font sizes, text lengths), never the words
   on it. A redrawn picture would only be a guess at what the browser drew, so there isn't one. Sent to this server, which
   keeps it in memory until someone downloads diagnostics or files a bug report. */
(function(){
  if (PREVIEW || SOLO) return;
  let lastId = 0;
  const R = n => Math.round(n);
  const rectOf = r => [R(r.left), R(r.top), R(r.width), R(r.height)];
  const tag = e => e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).slice(0, 2).join(".") : "");
  // the real extent of an element's own text: one box per run of text, from the browser's layout
  function textBox(el){
    let L = 1e9, T = 1e9, Rr = -1e9, B = -1e9, len = 0;
    for (const n of el.childNodes){
      if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      for (const r of rg.getClientRects()){
        if (r.width < 1 || r.height < 1) continue;
        L = Math.min(L, r.left); T = Math.min(T, r.top); Rr = Math.max(Rr, r.right); B = Math.max(B, r.bottom);
      }
      len += n.nodeValue.trim().length;
    }
    return len && Rr > L ? {L, T, R:Rr, B, len} : null;
  }
  function overlap(a, b){
    const w = Math.min(a.R, b.R) - Math.max(a.L, b.L), h = Math.min(a.B, b.B) - Math.max(a.T, b.T);
    if (w < 3 || h < 3) return 0;
    const small = Math.min((a.R - a.L) * (a.B - a.T), (b.R - b.L) * (b.B - b.T));
    return small > 0 && w * h / small > 0.15 ? R(w) + "x" + R(h) : 0;
  }
  function measure(){
    const iw = window.innerWidth, ih = window.innerHeight, tiles = [], overlaps = [], clipped = [];
    let total = 0;
    for (const id of Object.keys(MOUNTED)){
      const el = MOUNTED[id];
      if (!el || !el.offsetParent || el.classList.contains("stk-off")) continue;
      const tr = el.getBoundingClientRect(); if (tr.width < 1) continue;
      if (tr.right <= 0 || tr.left >= iw || tr.bottom <= 0 || tr.top >= ih) continue;      // on another page, or scrolled away
      const items = [];
      for (const e of el.querySelectorAll("*")){
        if (total >= 800 || items.length >= 80) break;
        if (/^(script|style|svg|canvas|iframe)$/i.test(e.tagName)) continue;
        const b = textBox(e); if (!b) continue;
        const cs = getComputedStyle(e);
        if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) continue;
        total++;
        const it = {el:tag(e), box:[R(b.L), R(b.T), R(b.R - b.L), R(b.B - b.T)], fs:cs.fontSize, ff:(cs.fontFamily || "").split(",")[0].replace(/["']/g, "").slice(0, 30), len:b.len, b, node:e};
        const tol = Math.max(4, (b.B - b.T) * 0.15);        // a line box is taller than its letters, so a little past the edge is normal
        const cut = e.scrollWidth > e.clientWidth + 1 && cs.overflowX !== "visible" || b.R > tr.right + tol || b.B > tr.bottom + tol || b.L < tr.left - tol || b.T < tr.top - tol;
        const off = b.R > iw + 1 || b.B > ih + 1 || b.L < -1 || b.T < -1;
        if ((cut || off) && clipped.length < 30) clipped.push({tile:MODULES[id] && MODULES[id].type || id, el:it.el, box:it.box, why: off ? "off screen" : "outside its tile or cut off"});
        items.push(it);
      }
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++){
        const a = items[i], b = items[j];
        if (a.node.contains(b.node) || b.node.contains(a.node)) continue;
        const o = overlap(a.b, b.b);
        if (o && overlaps.length < 30) overlaps.push({tile:MODULES[id] && MODULES[id].type || id, a:a.el, b:b.el, by:o, boxes:[a.box, b.box]});
      }
      tiles.push({id, type:(MODULES[id] && MODULES[id].type) || id, box:rectOf(tr),
        text:items.slice(0, 40).map(i => ({el:i.el, box:i.box, fs:i.fs, ff:i.ff, len:i.len}))});
    }
    return {tiles, overlaps, clipped};
  }
  function snapshot(){
    const g = id => (typeof S === "function" ? S(id) : {}) || {};
    const look = g("look"), nav = navigator, m = {};
    ["mode", "tiles", "bg", "fx", "textScale", "opacity", "accent"].forEach(k => { if (look[k] != null) m[k] = look[k]; });
    const d = {
      env:{ua:nav.userAgent, win:innerWidth + "x" + innerHeight, screen:(screen.width || 0) + "x" + (screen.height || 0), dpr:window.devicePixelRatio || 1,
        orientation:innerWidth >= innerHeight ? "landscape" : "portrait", fullscreen:!!(document.fullscreenElement || document.webkitFullscreenElement),
        lang:nav.language, touch:nav.maxTouchPoints || 0, shell:FRAMED, visible:document.visibilityState},
      page:typeof dashPage === "function" ? dashPage() : "?", look:m,
      effects:(typeof FXINFO !== "undefined" && FXINFO) ? FXINFO : null,
      feeds:Object.assign({}, window.FEEDAT || {}),
      community:{safe:typeof SBX !== "undefined" ? !!SBX.safe : null, showing:typeof SBX !== "undefined" ? [...SBX.frames.values()].map(r => r.m.name).slice(0, 10) : []}
    };
    if (d.feeds) for (const k of Object.keys(d.feeds)) if (typeof d.feeds[k] === "number") d.feeds[k] = Math.max(0, Math.round((Date.now() - d.feeds[k]) / 1000)) + " s ago";
    return Object.assign(d, measure());
  }
  window.dashSnapshot = snapshot;
  function answer(id){
    let data; try{ data = snapshot(); }catch(e){ data = {error:String(e && e.message || e).slice(0, 200)}; }
    fetch("/snapshot", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({id, data})}).catch(() => {});
  }
  async function poll(){
    if (document.hidden) return;
    try{
      const j = await (await fetch("/snapshot/want", {cache:"no-store"})).json();
      if (j && j.id && j.id !== lastId){ lastId = j.id; answer(j.id); }
    }catch(e){}
  }
  setInterval(poll, 5e3);
})();
