/* ---------- edits ---------- */
// drag ⋮⋮ to change the order of pages
let dragged = 0;
document.addEventListener("pointerdown", e => {
  const g = e.target.closest("[data-grip]"); if (!g) return;
  e.preventDefault();
  const r0 = g.closest(".row"), rows = [...r0.parentElement.querySelectorAll("[data-pid]")], from = rows.indexOf(r0), y0 = e.clientY, hgt = r0.offsetHeight;
  let to = from;
  r0.classList.add("drag"); g.setPointerCapture(e.pointerId);
  const move = ev => {
    const dy = Math.max(-from * hgt, Math.min((rows.length - 1 - from) * hgt, ev.clientY - y0));
    to = from + Math.round(dy / hgt);
    r0.style.transform = "translateY(" + dy + "px)";
    rows.forEach((r, i) => { if (r !== r0) r.style.transform = i > from && i <= to ? "translateY(-" + hgt + "px)" : i < from && i >= to ? "translateY(" + hgt + "px)" : ""; });
  };
  const up = () => {
    g.removeEventListener("pointermove", move); g.removeEventListener("pointerup", up); g.removeEventListener("pointercancel", up);
    dragged = performance.now();
    if (to !== from){
      const L = gpAll(), ids = rows.map(r => r.dataset.pid), [m] = ids.splice(from, 1); ids.splice(to, 0, m);
      const inList = new Set(cpList()), order = ids.map(id => L.find(p => p.id === id)); let k = 0;
      mods.pages.settings.items = L.map(p => inList.has(p) ? order[k++] : p);
      save();
    }
    show();
  };
  g.addEventListener("pointermove", move); g.addEventListener("pointerup", up); g.addEventListener("pointercancel", up);
});
document.addEventListener("click", e => {
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
document.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target && e.target.id === "lladd"){
    e.preventDefault();
    const el = document.getElementById("llitems");
    llAdd(el ? el.dataset.sid : "");
  }
});
document.addEventListener("change", e => {
  const t = e.target, d = t.dataset;
  if (t.id === "display-orientation"){ displaySet(t); return; }
  if (t.id === "display-screen"){ screenSave(t.value, t); return; }
  if (t.id === "display-size"){       // this browser only: the dashboard in another tab follows through the storage event
    try{ if (t.value) localStorage.setItem("countertop.screenSize", t.value); else localStorage.removeItem("countertop.screenSize"); }catch(e){}
    toast(t.value ? "/dash in this browser now keeps that size" : "Dashboard in this browser fills the window", "ok"); return;
  }
  if ((d.lk && d.lv === undefined) || d.lfrom || d.fxd || d.rk || (d.fxk && d.fxv === undefined) || (d.nk && d.nv === undefined)){ lookChange(t); return; }
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

