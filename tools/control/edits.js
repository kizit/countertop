/* ---------- edits ---------- */
// drag ⋮⋮ to change the order of pages
let dragged = 0;
function startGripDrag(g, y0){
  const r0 = g.closest(".row"), rows = [...r0.parentElement.querySelectorAll("[data-pid]")], from = rows.indexOf(r0), hgt = r0.offsetHeight;
  let to = from;
  r0.classList.add("drag");
  return {
    move(y){
      const dy = Math.max(-from * hgt, Math.min((rows.length - 1 - from) * hgt, y - y0));
      to = from + Math.round(dy / hgt);
      r0.style.transform = "translateY(" + dy + "px)";
      rows.forEach((r, i) => { if (r !== r0) r.style.transform = i > from && i <= to ? "translateY(-" + hgt + "px)" : i < from && i >= to ? "translateY(" + hgt + "px)" : ""; });
    },
    end(){
      dragged = performance.now();
      if (to !== from){
        const L = gpAll(), ids = rows.map(r => r.dataset.pid), [m] = ids.splice(from, 1); ids.splice(to, 0, m);
        const inList = new Set(cpList()), order = ids.map(id => L.find(p => p.id === id)); let k = 0;
        mods.pages.settings.items = L.map(p => inList.has(p) ? order[k++] : p);
        save();
      }
      show();
    },
  };
}
function movePage(id, dir){
  const L = gpAll(), cp = cpList(), from = cp.findIndex(p => p.id === id), to = from + dir;
  if (from < 0 || to < 0 || to >= cp.length) return;
  const order = cp.slice(); [order[from], order[to]] = [order[to], order[from]];
  const inList = new Set(cp); let k = 0;
  mods.pages.settings.items = L.map(p => inList.has(p) ? order[k++] : p);
  save(); show();
}
// touch mode: pointer capture on the grip (same behavior as Echo / touchscreens)
document.addEventListener("pointerdown", e => {
  if (CT.input !== "touch") return;
  const g = e.target.closest("[data-grip]"); if (!g) return;
  e.preventDefault();
  const d = startGripDrag(g, e.clientY);
  g.setPointerCapture(e.pointerId);
  const move = ev => d.move(ev.clientY);
  const up = () => {
    g.removeEventListener("pointermove", move); g.removeEventListener("pointerup", up); g.removeEventListener("pointercancel", up);
    d.end();
  };
  g.addEventListener("pointermove", move); g.addEventListener("pointerup", up); g.addEventListener("pointercancel", up);
});
// desktop mode: primary-button mouse drag on the grip
document.addEventListener("mousedown", e => {
  if (CT.input !== "desktop" || e.button !== 0) return;
  const g = e.target.closest("[data-grip]"); if (!g) return;
  e.preventDefault();
  const d = startGripDrag(g, e.clientY);
  document.body.classList.add("grabbing");
  const move = ev => d.move(ev.clientY);
  const up = () => {
    removeEventListener("mousemove", move); removeEventListener("mouseup", up); removeEventListener("blur", up);
    document.body.classList.remove("grabbing");
    d.end();
  };
  addEventListener("mousemove", move); addEventListener("mouseup", up); addEventListener("blur", up);
});

/* ---------- desktop context menu (right-click, ⋯ button, or long-press) ---------- */
let ctxActions = [], ctxHeld = 0;
function ctxClose(){
  const m = $("ctxmenu");
  if (!m || m.hidden) return;
  m.hidden = true; m.innerHTML = ""; ctxActions = [];
}
function ctxOpen(items, x, y){
  const m = $("ctxmenu"); if (!m) return;
  const list = (items || []).filter(Boolean);
  if (!list.length){ ctxClose(); return; }
  ctxActions = [];
  m.innerHTML = list.map(it => {
    if (it === "-") return '<hr class="ctxsep">';
    const i = ctxActions.length; ctxActions.push(it.fn);
    return '<button type="button" role="menuitem" data-ci="' + i + '"' + (it.cls ? ' class="' + it.cls + '"' : "") + '>' + esc(it.label) + '</button>';
  }).join("");
  m.hidden = false;
  m.style.left = "0px"; m.style.top = "0px";
  const r = m.getBoundingClientRect(), pad = 8;
  const lx = Math.max(pad, Math.min(innerWidth - r.width - pad, x));
  const ly = Math.max(pad, Math.min(innerHeight - r.height - pad, y));
  m.style.left = lx + "px"; m.style.top = ly + "px";
  const first = m.querySelector("button"); if (first) first.focus({preventScroll:true});
}
function ctxFor(spec){
  if (!spec) return [];
  if (spec === "page:main") return [
    !ECHO && {label:"Edit Main on screen", fn:() => act("edit", "main")},
    {label:"Open settings", fn:() => go("page:main")},
    {label:"Change layout", fn:() => act("libpick", "main")},
    {label:"Save a copy", fn:() => act("savemain")},
  ];
  if (spec === "night") return [
    !ECHO && {label:"Edit night page on screen", fn:() => act("edit", "night")},
    {label:"Open settings", fn:() => go("night")},
    {label:mods.night && mods.night.on ? "Turn off night page" : "Turn on night page", fn:() => { mods.night.on = !mods.night.on; save(); show(); }},
  ];
  if (spec.startsWith("page:")){
    const id = spec.slice(5), p = cpById(id), cp = cpList(), idx = cp.indexOf(p);
    if (!p) return [];
    return [
      !ECHO && p.on !== false && {label:"Edit on screen", fn:() => act("edit", id)},
      {label:"Open settings", fn:() => go("page:" + id)},
      idx > 0 && {label:"Move up", fn:() => movePage(id, -1)},
      idx >= 0 && idx < cp.length - 1 && {label:"Move down", fn:() => movePage(id, 1)},
      {label:p.on === false ? "Show page" : "Hide page", fn:() => act("toggle", id)},
      "-",
      {label:"Delete page", cls:"red", fn:() => { if (!confirmDel({one:"page"}, id)) return; const gone = new Set([].concat(...(p.slots || []).map(smods))); if (mods.tiles) mods.tiles.settings.items = tileList().filter(t => !gone.has(t.id)); mods.pages.settings.items = gpAll().filter(x => x !== p); save(); show(); }},
    ];
  }
  if (spec.startsWith("src:")){
    const [, k, id] = spec.split(":"), K = KINDS[k]; if (!K) return [];
    return [
      {label:"Open", fn:() => go("srci:" + k + ":" + id)},
      "-",
      {label:"Delete", cls:"red", fn:async () => {
        if (!confirmDel(K, id)) return;
        try{
          const r = await fetch("/sources", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({kind:k, op:"delete", item:{id}})});
          const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.status);
          SRC = j.sources; toast("Deleted", "ok"); show(); pvRefresh();
        }catch(e){ toast("Didn't save: " + e.message, "bad"); }
      }},
    ];
  }
  if (spec.startsWith("theme:")){
    const id = spec.slice(6), bi = isBuiltin(id), used = usedLook() === id;
    if (id !== "default" && !lookById(id)) return [];
    return [
      {label:"Open", fn:() => go("theme:" + id)},
      !used && {label:"Use this theme", fn:() => lookAction("use", id)},
      bi ? {label:"Customize a copy", fn:() => lookAction("new", id)} : {label:"Customize", fn:() => go("look:" + id)},
      !bi && {label:"Duplicate", fn:() => { const nid = "t" + Date.now().toString(36), base = lookName(id) + " copy"; looks().push({id:nid, name: looks().some(t => t.name === base) ? base + " " + (looks().length + 1) : base, values:lookVals(id)}); save(); go("theme:" + nid); toast("Made a copy. Customize it, then use it", "ok"); }},
      !bi && {label:"Share", fn:() => go("share:theme:" + id)},
      !bi && id !== "default" && "-",
      !bi && id !== "default" && {label:"Delete theme", cls:"red", fn:() => { if (!confirmDel({one:"theme"}, id)) return; if (LS().use === id) LS().use = ""; LS().items = looks().filter(t => t.id !== id); LS().rules = rules().filter(r => r.look !== id); save(); show(); }},
    ];
  }
  if (spec.startsWith("fx:")){
    const id = spec.slice(3), d = FXLIB.BY[id]; if (!d) return [];
    const on = fxC(id).on;
    return [
      {label:"Open", fn:() => go("fx:" + id)},
      {label:on ? "Turn off" : "Turn on", fn:() => { fxSet(id, "on", !on); show(); }},
      !ECHO && {label:"Play on preview", fn:() => { try{ (libSub() ? $("libpv").contentWindow : pvWin()).FUN.show(id); toast("Playing on the preview", "ok"); }catch(e){ toast("The preview isn't ready yet", "bad"); } }},
      d.mine && {label:"Edit", fn:() => go("fxedit:" + id)},
      d.mine && {label:"Share", fn:() => go("share:effect:" + id)},
      d.mine && "-",
      d.mine && {label:"Delete effect", cls:"red", fn:() => { if (!confirmDel({one:"effect"}, id)) return; mods.effects.settings.mine = mineList().filter(x => x.id !== id); mods.effects.settings.items = fxItemsC().filter(x => x.id !== id); fxRegister(); save(); show(); }},
    ];
  }
  if (spec.startsWith("saved:")){
    const id = spec.slice(6), sp = savedById(id); if (!sp) return [];
    return [
      {label:"Open", fn:() => libGo(LIB.view, "saved:" + id)},
      {label:"Use on Main", fn:() => libUse("saved:" + id, true)},
      {label:"Add as a new page", fn:() => libUse("saved:" + id, false)},
      {label:"Duplicate", fn:() => libDup(id)},
      {label:"Share", fn:() => { LIB.shareOf = "saved:" + id; libGo("share"); }},
      "-",
      {label:"Delete", cls:"red", fn:() => { if (!confirmDel({one:"saved layout"}, id)) return; libDropSaved(sp); save(); toast("Deleted", "ok"); libShow(); }},
    ];
  }
  if (spec.startsWith("edbox:")){
    const sid = spec.slice(6), w = pvWin();
    if (!w || !w.dashEditing || !w.dashEditing()) return [];
    const pan = () => (!($("insp") && $("insp").hidden) && $("insp-body")) || w.document.getElementById("edpanel");
    const clickAct = a => {
      const p = pan();
      const b = (p && p.querySelector('[data-act="' + a + '"]')) || w.document.querySelector('.eslot.sel [data-act="' + a + '"]');
      if (!b) return;
      if (p === $("insp-body") && typeof w.dashHostDown === "function"){
        w.dashHostDown({target:b, preventDefault(){}});
        return;
      }
      const o = {bubbles:true, cancelable:true, button:0, pointerType:"mouse"};
      b.dispatchEvent(new w.PointerEvent("pointerdown", o));
      w.dispatchEvent(new w.PointerEvent("pointerup", o));
    };
    return [
      {label:"Tile settings", fn:() => { const p = pan(); if (p && p.dataset.view === "add") clickAct("back"); const b = w.document.querySelector('.eslot[data-slot="' + sid + '"]'); if (b && typeof pvSelectBox === "function") pvSelectBox(w, b); }},
      {label:"Add tile to this box", fn:() => clickAct("add")},
      {label:"Usual size", fn:() => clickAct("fit")},
      {label:"Fill free space", fn:() => clickAct("grow")},
      {label:"Duplicate box", fn:() => clickAct("dup")},
      "-",
      {label:"Remove box", cls:"red", fn:() => clickAct("del")},
    ];
  }
  if (spec.startsWith("edtile:")){
    const tid = spec.slice(7), w = pvWin();
    if (!w || !w.dashEdit) return [];
    return [
      {label:"Edit this tile", fn:() => w.dashEdit(true, tid)},
      {label:"Edit page on screen", fn:() => w.dashEdit(true)},
    ];
  }
  return [];
}
function ctxOpenFromBtn(btn){
  const r = btn.getBoundingClientRect();
  ctxOpen(ctxFor(btn.dataset.ctxbtn), r.right - 160, r.bottom + 4);
}
document.addEventListener("contextmenu", e => {
  if (CT.input !== "desktop") return;
  const t = e.target.closest("[data-ctx]"); if (!t) return;
  const items = ctxFor(t.dataset.ctx); if (!items.length) return;
  e.preventDefault();
  ctxOpen(items, e.clientX, e.clientY);
});
// long-press remains available alongside right-click and the ⋯ button in desktop mode
let ctxLP = null, ctxLPAt = null;
document.addEventListener("pointerdown", e => {
  if (CT.input !== "desktop" || e.button !== 0) return;
  if (e.target.closest("[data-grip],[data-ctxbtn],#ctxmenu,input,select,textarea,button.sw")) return;
  const t = e.target.closest("[data-ctx]"); if (!t) return;
  ctxLPAt = [e.clientX, e.clientY];
  clearTimeout(ctxLP);
  ctxLP = setTimeout(() => {
    ctxLP = null;
    const items = ctxFor(t.dataset.ctx); if (!items.length) return;
    ctxHeld = performance.now();
    ctxOpen(items, ctxLPAt[0], ctxLPAt[1]);
  }, 550);
}, true);
document.addEventListener("pointermove", e => {
  if (ctxLP && ctxLPAt && Math.hypot(e.clientX - ctxLPAt[0], e.clientY - ctxLPAt[1]) > 10){ clearTimeout(ctxLP); ctxLP = null; }
}, true);
const ctxLPCancel = () => { if (ctxLP){ clearTimeout(ctxLP); ctxLP = null; } };
document.addEventListener("pointerup", ctxLPCancel, true);
document.addEventListener("pointercancel", ctxLPCancel, true);
addEventListener("scroll", () => { if (!$("ctxmenu").hidden) ctxClose(); }, true);
addEventListener("resize", () => { if (!$("ctxmenu").hidden) ctxClose(); });

document.addEventListener("click", e => {
  const ci = e.target.closest("#ctxmenu [data-ci]");
  if (ci){ const fn = ctxActions[+ci.dataset.ci]; ctxClose(); if (fn) fn(); return; }
  const cb = e.target.closest("[data-ctxbtn]");
  if (cb){ e.preventDefault(); e.stopPropagation(); ctxOpenFromBtn(cb); return; }
  if (!$("ctxmenu").hidden && !e.target.closest("#ctxmenu")){ ctxClose(); }
  if (ctxHeld && performance.now() - ctxHeld < 400) return;
  if (e.target.closest("[data-grip]") || (dragged && performance.now() - dragged < 300)) return;
  const t = e.target.closest("[data-act],[data-sact],[data-loc],[data-lact],[data-fxa],[data-tia],[data-sha],[data-fxd][data-fxdv],[data-fxd='spin'],[data-ract],[data-fxon],[data-fxk][data-fxv],[data-fxplay],[data-lk][data-lv],[data-lk][data-lb],[data-nk][data-nv],[data-on],[data-t='bool'],[data-swt],[data-ladd],[data-litog],[data-lidel],[data-llop],[data-go]"); if (!t) return;
  if (lookClick(t)) return;
  if (t.dataset.swt){ const v = !t.classList.contains("on"); t.classList.toggle("on", v); t.setAttribute("aria-checked", v); return; }
  if (t.dataset.ladd){ llAdd(t.dataset.sid); return; }
  if (t.dataset.litog){ llCall(t.dataset.sid, {op:"toggle", id:t.dataset.litog}); return; }
  if (t.dataset.lidel){ llCall(t.dataset.sid, {op:"remove", id:t.dataset.lidel}); return; }
  if (t.dataset.llop){ llCall(t.dataset.sid, {op:"reset"}); return; }
  if (t.dataset.act){ act(t.dataset.act, t.dataset.id); return; }
  if (t.dataset.sact){ srcAction(t.dataset.sact, t.dataset.k, t.dataset.id); return; }
  if (t.dataset.loc){ Object.assign(mods.general.settings, JSON.parse(t.dataset.loc)); save(); show(); return; }
  if (t.dataset.on){ const m = t.dataset.on; mods[m].on = !mods[m].on; show(); save(); return; }
  if (t.dataset.t === "bool"){ const d = t.dataset, v = !mods[d.m].settings[d.k]; mods[d.m].settings[d.k] = v; t.classList.toggle("on", v); t.setAttribute("aria-checked", v); save(); return; }
  if (t.dataset.go){ go(t.dataset.go); return; }
});

/* ---------- keyboard shortcuts ---------- */
function isTyping(el){
  return !!(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable));
}
function syncActiveInput(){
  const ae = document.activeElement;
  if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT")) ae.dispatchEvent(new Event("change", {bubbles:true}));
}
function pvEdWin(){
  if (ECHO || typeof pvWin !== "function") return null;
  const w = pvWin();
  return w && typeof w.dashEditing === "function" && w.dashEditing() ? w : null;
}
document.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target && e.target.id === "lladd"){
    e.preventDefault();
    const el = document.getElementById("llitems");
    llAdd(el ? el.dataset.sid : "");
    return;
  }
  if (CT.input !== "desktop") return;
  const menu = $("ctxmenu");
  if (menu && !menu.hidden){
    if (e.key === "Escape"){ e.preventDefault(); ctxClose(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End"){
      const btns = [...menu.querySelectorAll("button")];
      if (!btns.length) return;
      e.preventDefault();
      const i = btns.indexOf(document.activeElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? btns.length - 1 : e.key === "ArrowDown" ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
      btns[next].focus(); return;
    }
  }
  const cb = e.target && e.target.closest && e.target.closest("[data-ctxbtn]");
  if (cb && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); e.stopPropagation(); ctxOpenFromBtn(cb); return; }

  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  // Esc closes dialogs and drafts
  if (e.key === "Escape"){
    if ($("locq")){ e.preventDefault(); show(); return; }
    if (typeof DRAFT !== "undefined" && DRAFT){ e.preventDefault(); draftCancel(); return; }
    if (typeof FXDRAFT !== "undefined" && FXDRAFT){ e.preventDefault(); fxAction("cancel"); return; }
    if (typeof libEl === "function" && !libEl().hidden && typeof LIB !== "undefined" && LIB.view === "studio" && typeof STU !== "undefined" && (STU.picking || STU.pend)){
      e.preventDefault(); STU.picking = false; STU.pend = null; stuPickRefresh(); return;
    }
    if (typeof libEl === "function" && !libEl().hidden) return;       // library.js handles closing item / subview / Library
    const w = pvEdWin();
    if (w){
      e.preventDefault();
      const pv = (!($("insp") && $("insp").hidden) && $("insp-body")) || w.document.getElementById("edpanel"), view = pv && pv.dataset.view || "";
      if ((view && !view.startsWith("page:")) || w.document.querySelector(".eslot.sel")) w.dispatchEvent(new w.KeyboardEvent("keydown", {key:"Escape", bubbles:true, cancelable:true}));
      else w.dashEdit(false);
      return;
    }
  }
  // Ctrl/Cmd+S saves the active draft, form, or layout editor
  if (mod && k === "s"){
    if (typeof DRAFT !== "undefined" && DRAFT){
      e.preventDefault(); syncActiveInput();
      if (draftDirty()) draftSave(); else toast("No changes to save");
      return;
    }
    if (typeof FXDRAFT !== "undefined" && FXDRAFT){
      e.preventDefault(); syncActiveInput();
      if (fxDirty()) fxAction("save"); else toast("No changes to save");
      return;
    }
    if (typeof libEl === "function" && !libEl().hidden && typeof LIB !== "undefined" && LIB.view === "studio" && typeof STU !== "undefined" && STU.t){
      e.preventDefault(); syncActiveInput(); stuSave(); return;
    }
    if ((typeof libEl !== "function" || libEl().hidden) && cur0().startsWith("srci:")){
      e.preventDefault(); syncActiveInput();
      const [, kind, id] = cur0().split(":"); srcAction("save", kind, id); return;
    }
    const w = (typeof libEl !== "function" || libEl().hidden) ? pvEdWin() : null;
    if (w){ e.preventDefault(); const b = w.document.getElementById("edsave"); if (b) b.click(); return; }
  }
  if (isTyping(e.target)) return;
  // Ctrl/Cmd+Z (and Shift+Ctrl/Cmd+Z / Ctrl/Cmd+Y) undoes/redoes in the layout editor (or an active Undo toast)
  if (mod && (k === "z" || k === "y")){
    const w = (typeof libEl !== "function" || libEl().hidden) ? pvEdWin() : null;
    if (w){
      e.preventDefault();
      const b = w.document.getElementById(e.shiftKey || k === "y" ? "edredo" : "edundo");
      if (b && !b.disabled) b.click();
      return;
    }
    const t = $("toast");
    if (!e.shiftKey && k === "z" && t && t.classList.contains("undo") && t.style.opacity === "1"){
      const b = t.querySelector("button"); if (b){ e.preventDefault(); b.click(); }
    }
    return;
  }
  // Arrow keys (and Shift+Arrows / Delete) nudge, resize or remove the selected tile in the layout editor
  if (/^Arrow(Left|Right|Up|Down)$/.test(e.key) || e.key === "Delete" || e.key === "Backspace"){
    const w = (typeof libEl !== "function" || libEl().hidden) ? pvEdWin() : null;
    if (w && w.document.querySelector(".eslot.sel")){
      e.preventDefault();
      w.dispatchEvent(new w.KeyboardEvent("keydown", {key:e.key, shiftKey:e.shiftKey, ctrlKey:e.ctrlKey, metaKey:e.metaKey, bubbles:true, cancelable:true}));
    }
  }
});

document.addEventListener("change", e => {
  const t = e.target, d = t.dataset;
  if (t.id === "display-orientation"){ displaySet(t); return; }
  if (t.id === "display-screen"){ screenSave(t.value, t); return; }
  if (t.id === "display-fs"){         // this browser only; the shell and the dashboard read it on each tap
    try{ if (t.value === "0") localStorage.setItem("countertop.fullscreen", "0"); else localStorage.removeItem("countertop.fullscreen"); }catch(e){}
    toast(t.value === "0" ? "/dash in this browser no longer goes full screen on a tap" : "/dash in this browser goes full screen on a tap", "ok"); return;
  }
  if (t.id === "display-input"){      // this browser only: touch vs desktop Controls mode
    try{ if (t.value) localStorage.setItem(INPUT_KEY, t.value); else localStorage.removeItem(INPUT_KEY); }catch(e){}
    applyInputMode(t.value || inputAuto());
    if (typeof pvDesktopSync === "function") pvDesktopSync();
    toast(t.value === "desktop" ? "Controls in this browser now use desktop mode" : t.value === "touch" ? "Controls in this browser now use touch mode" : "Controls in this browser follow your device (" + CT.input + ")", "ok");
    show(); return;
  }
  if (t.id === "display-size"){       // this browser only: the dashboard in another tab follows through the storage event
    try{ if (t.value) localStorage.setItem("countertop.screenSize", t.value); else localStorage.removeItem("countertop.screenSize"); }catch(e){}
    toast(t.value ? "/dash in this browser now keeps that size" : "Dashboard in this browser fills the window", "ok"); return;
  }
  if ((d.lk && d.lv === undefined) || d.lwall || d.lfrom || d.fxd || d.rk || (d.fxk && d.fxv === undefined) || (d.nk && d.nv === undefined)){ lookChange(t); return; }
  if (d.sf){       // show only the fields that apply, and refresh per-kind labels and help text
    const cur = stack[stack.length - 1].split(":"), K = KINDS[cur[1]]; if (!K) return;
    const getVal = w => { const el = document.querySelector('[data-sf="' + w + '"]'); return el ? el.value : ""; };
    const curKind = getVal("kind");
    for (const f in K.fields){ const F = K.fields[f];
      const wrap = document.querySelector('[data-fw="' + f + '"]'); if (!wrap) continue;
      if (F.when) wrap.hidden = !srcWhenOk(F, getVal);
      if (F.labelBy && F.labelBy[curKind]){ const b = wrap.querySelector(".t b"); if (b) b.textContent = F.labelBy[curKind]; }
      if (F.helpBy && F.helpBy[curKind]){ const hp = wrap.querySelector(".help"); if (hp) hp.textContent = F.helpBy[curKind]; }
    }
    return;
  }
  if (d.pg){ const p = cpById(d.pg); if (!p) return;
    if (d.k === "name"){ p.name = t.value.trim() || p.name; t.value = p.name; $("title").textContent = p.name; }
    else { const v = parseInt(t.value, 10); p.back = isFinite(v) ? Math.max(0, Math.min(3600, v)) : 0; t.value = p.back; }
    save(); return; }
  if (!d.m) return;
  const s = schema[d.m].settings[d.k];
  let v = t.value;
  if (d.t === "int" || d.t === "number"){
    v = d.t === "int" ? parseInt(v, 10) : parseFloat(v);
    if (!isFinite(v)){ t.value = mods[d.m].settings[d.k]; return; }
    if (s.min != null) v = Math.max(s.min, v);
    if (s.max != null) v = Math.min(s.max, v);
    t.value = v;
  } else if (d.t === "list") v = v.split("\n").map(x => x.trim()).filter(Boolean);
  else if (d.t === "text") v = v.trim();
  mods[d.m].settings[d.k] = v;
  save();
  if (d.m === "general" && d.k === "emoji") show();
});

