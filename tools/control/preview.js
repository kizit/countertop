/* ---------- preview (on a computer; on the Echo the screen itself is the preview) ---------- */
const PV = {w:1920, h:1080, page:0, theme:"", editing:false, navManual:null, flip:false};
function pvWin(){ try{ return $("pvf").contentWindow; }catch(e){ return null; } }
function pvFit(){
  const box = $("pvbox"), f = $("pvf"), bar = $("pvbar");
  if (!box || !f || !bar) return;
  let k;
  if (document.body.classList.contains("editing-desk")){
    const st = $("pvstage");
    const aw = Math.max(120, (st ? st.clientWidth : bar.clientWidth) - 24);
    const ah = Math.max(120, (st ? st.clientHeight : innerHeight - bar.offsetHeight) - 24);
    k = Math.max(0, Math.min(aw / PV.w, ah / PV.h));
  } else {
    k = Math.max(0, Math.min((bar.clientWidth - 2) / PV.w,
      PV.h > PV.w ? Math.max(240, innerHeight - bar.offsetHeight - 26) / PV.h : Infinity));
  }
  f.style.width = PV.w + "px"; f.style.height = PV.h + "px"; f.style.transform = "scale(" + k + ")";
  box.style.width = Math.round(PV.w * k) + 2 + "px";
  box.style.height = Math.round(PV.h * k) + 2 + "px";
}
function pvApplyNav(){
  if (!document.body.classList.contains("editing-desk")){
    document.body.classList.remove("nav-collapsed");
    return;
  }
  const collapsed = PV.navManual != null ? !PV.navManual : innerWidth < 1400;
  document.body.classList.toggle("nav-collapsed", collapsed);
  const b = $("pvnav");
  if (b){
    b.setAttribute("aria-pressed", String(!collapsed));
    b.title = collapsed ? "Show Controls sidebar" : "Hide Controls sidebar";
  }
}
function pvCur(){ try{ const w = pvWin(); return Math.max(0, w.pageList().indexOf(w.dashPage())); }catch(e){ return 0; } }      // the page showing, as its place in the tabs
function pvName(){ try{ return pvWin().dashPage(); }catch(e){ return ""; } }
// the night page only shows while the preview is forced to night, so it isn't a page to come back to
function pvLoad(){ PV.page = pvName() === "night" ? 0 : pvCur(); $("pvf").src = "/dash/content?preview=1" + (PV.trial ? "&trial=" + PV.trial : "") + (PV.theme ? "&theme=" + PV.theme : "") + (PV.night ? "&night=1" : "") + "&t=" + Date.now(); }
function pvTabs(){
  if (PV.editing) return;
  let L = ["main"];
  try{ L = pvWin().pageList(); }catch(e){}
  const cur = pvCur();
  $("pvpage").innerHTML = L.length < 2 ? "" : L.map((n, i) => '<button data-pg="' + i + '"' + (i === cur ? ' class="on"' : "") + '>' + esc(n === "main" ? "Main" : n === "night" ? "Night" : (cpById(n.slice(2)) || {}).name || n) + '</button>').join("");
}
// called by the dashboard inside the preview
// the editor in the preview: a tile needs a calendar, team... that isn't set up yet
window.dashSetup = kind => {
  if (PV.editing){ PV.navManual = true; pvApplyNav(); requestAnimationFrame(pvFit); }
  stack = ["root", "src:" + kind]; show(); scrollTo(0, 0);
};
window.dashSaved = () => { toast("Layout saved", "ok"); load(); };
// desktop 3-pane studio sync: called by tools/dash/editor.js whenever editor state updates in desktop mode
window.dashDeskSync = st => {
  if (ECHO) return;
  const active = CT.input === "desktop" && !!(st && st.editing);
  if (!active){
    const was = PV.editing;
    PV.editing = false; PV.navManual = null;
    document.body.classList.remove("editing-desk", "nav-collapsed");
    if ($("insp")) $("insp").hidden = true;
    if ($("insp-body")) $("insp-body").innerHTML = "";
    if ($("pvnav")) $("pvnav").hidden = true;
    if ($("pvgrid")) $("pvgrid").hidden = true;
    if ($("pvscr")) $("pvscr").hidden = true;
    if ($("pvori")) $("pvori").hidden = displayMode !== "auto";
    if ($("pvedact")) $("pvedact").hidden = true;
    if ($("pvedit")) $("pvedit").hidden = false;
    if ($("pvnote")) $("pvnote").hidden = false;
    if (was){ pvTabs(); requestAnimationFrame(pvFit); }
    return;
  }
  const entering = !PV.editing;
  PV.editing = true;
  document.body.classList.add("editing-desk");
  $("insp").hidden = false;
  $("pvnav").hidden = false;
  $("pvgrid").hidden = !!st.focus;
  if ($("pvori")) $("pvori").hidden = !!st.focus || displayMode !== "auto";
  if ($("pvscr")) $("pvscr").hidden = !!st.focus;
  $("pvedact").hidden = false;
  $("pvedit").hidden = true;
  $("pvnote").hidden = true;
  $("pvpage").hidden = !!st.focus;
  if (!st.focus){
    $("pvpage").innerHTML = (st.pages || []).map(p =>
      '<button data-edtab="' + esc(p.id) + '"' + (p.id === st.page ? ' class="on"' : "") + '>' + esc(p.name) + '</button>').join("") +
      '<button data-edtab="+" class="addpg" title="Add a page">＋ Page</button>';
  }
  $("pvundo").disabled = !st.canUndo;
  $("pvredo").disabled = !st.canRedo;
  $("pvcancel").hidden = !!st.focus;
  $("pvsave").hidden = !!st.focus;
  $("pvgrid").classList.toggle("on", !!st.grid);
  $("pvgrid").setAttribute("aria-pressed", String(!!st.grid));
  $("pvhint").textContent = st.hint || "";
  $("pvhint").className = "pvhint" + (st.hintCls ? " " + st.hintCls : "");
  pvApplyNav();
  if (entering) requestAnimationFrame(pvFit);
};
// desktop mode inside Controls' preview iframe: native scrolling, hover highlights, pointer cursor, and right-click context menus
const PV_DESK_CSS =
  'html[data-input="desktop"],html[data-input="desktop"] body,html[data-input="desktop"] #edpanel,html[data-input="desktop"] #edpanel .tc{touch-action:auto;overscroll-behavior:auto}' +
  'html[data-input="desktop"] .eslot{cursor:pointer;transition:border-color .12s,background-color .12s}' +
  'html[data-input="desktop"] .eslot:hover{border-color:rgba(90,169,255,.8);background:rgba(90,169,255,.08)}' +
  'html[data-input="desktop"] body.ed-drag .eslot{cursor:grabbing}' +
  'html[data-input="desktop"] body:not(.editing) [data-mod]{cursor:pointer}' +
  'html[data-input="desktop"] body:not(.editing) [data-mod]:hover{outline:2px solid rgba(90,169,255,.65);outline-offset:-2px}' +
  'html[data-input="desktop"] #edbar > button:hover:not(:disabled),html[data-input="desktop"] #edtabs button:hover:not(.on),html[data-input="desktop"] #edpanel .btns button:hover,html[data-input="desktop"] #edpanel button.wide:hover{filter:brightness(1.12)}' +
  'html[data-input="desktop"] #edpanel .ent:hover{background:#18202a}';
function pvSelectBox(w, box){
  if (!box || box.classList.contains("sel")) return;
  const r = box.getBoundingClientRect();
  const o = {bubbles:true, cancelable:true, button:0, pointerType:"mouse", clientX:r.left + r.width / 2, clientY:r.top + r.height / 2};
  box.dispatchEvent(new w.PointerEvent("pointerdown", o));
  w.dispatchEvent(new w.PointerEvent("pointerup", o));
}
function pvDesktopSync(){
  if (ECHO) return;
  try{
    const w = pvWin(), doc = w && w.document; if (!doc || !doc.documentElement) return;
    doc.documentElement.dataset.input = CT.input;
    let st = doc.getElementById("ct-desk-ed");
    if (CT.input === "desktop"){
      if (!st){ st = doc.createElement("style"); st.id = "ct-desk-ed"; st.textContent = PV_DESK_CSS; (doc.head || doc.documentElement).appendChild(st); }
    } else {
      if (st) st.remove();
      if (PV.editing) window.dashDeskSync({editing:false});
    }
    if (typeof w.dashHostRefresh === "function" && typeof w.dashEditing === "function" && w.dashEditing()) w.dashHostRefresh();
    if (w.__ctDeskBound) return;
    w.__ctDeskBound = true;
    // ignore non-primary mouse buttons so right-clicking a tile/box never starts a drag
    doc.addEventListener("pointerdown", e => {
      if (CT.input === "desktop" && e.pointerType === "mouse" && e.button !== 0) e.stopPropagation();
    }, true);
    doc.addEventListener("pointerdown", () => { if (typeof ctxClose === "function") ctxClose(); }, true);
    doc.addEventListener("contextmenu", e => {
      if (CT.input !== "desktop") return;
      const ed = typeof w.dashEditing === "function" && w.dashEditing();
      const box = ed ? e.target.closest(".eslot[data-slot]") : null;
      const tile = !ed ? e.target.closest("[data-mod]") : null;
      if (!box && !tile) return;
      e.preventDefault(); e.stopPropagation();
      const rect = $("pvf").getBoundingClientRect();
      const x = rect.left + e.clientX * (rect.width / (PV.w || 1920));
      const y = rect.top + e.clientY * (rect.height / (PV.h || 1080));
      if (box){
        const sid = box.dataset.slot;
        pvSelectBox(w, box);
        ctxOpen(ctxFor("edbox:" + sid), x, y);
      } else if (tile){
        ctxOpen(ctxFor("edtile:" + tile.dataset.mod), x, y);
      }
    }, true);
    w.addEventListener("keydown", e => {
      if (CT.input === "desktop" && e.key === "Escape" && $("ctxmenu") && !$("ctxmenu").hidden){
        e.preventDefault(); e.stopPropagation(); ctxClose();
      }
    }, true);
  }catch(e){}
}
// drag a tile card from the pulled-out right inspector across into the middle preview canvas
function startHostTileDrag(tc, e){
  const type = tc.dataset.type, label = (tc.querySelector("b") || {}).textContent || type;
  const x0 = e.clientX, y0 = e.clientY, ghost = $("edghost-host");
  let started = false;
  const toFrame = (cx, cy) => {
    const r = $("pvf").getBoundingClientRect();
    return [(cx - r.left) * (PV.w / (r.width || 1)), (cy - r.top) * (PV.h / (r.height || 1))];
  };
  const move = ev => {
    if (!started && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 6){
      started = true;
      ghost.textContent = label; ghost.hidden = false;
      document.body.classList.add("grabbing");
    }
    if (!started) return;
    ghost.style.left = (ev.clientX + 14) + "px"; ghost.style.top = (ev.clientY + 10) + "px";
    const [fx, fy] = toFrame(ev.clientX, ev.clientY);
    try{ pvWin().dashDragTileMove(type, fx, fy); }catch(err){}
  };
  const end = ev => {
    removeEventListener("pointermove", move); removeEventListener("pointerup", end); removeEventListener("pointercancel", end); removeEventListener("blur", end);
    ghost.hidden = true; document.body.classList.remove("grabbing");
    try{
      if (!started) pvWin().dashAddTile(type);
      else if (ev && ev.type === "pointerup") pvWin().dashDragTileDrop();
      else pvWin().dashDragTileCancel();
    }catch(err){}
  };
  addEventListener("pointermove", move); addEventListener("pointerup", end); addEventListener("pointercancel", end); addEventListener("blur", end);
}
if (!ECHO){
  let pvRes = null;
  const pvHold = () => {
    try{ const w = pvWin(); if (w.dashPause && !w.PAUSED) w.dashPause(true); }catch(e){}
    clearTimeout(pvRes); pvRes = setTimeout(() => { try{ pvWin().dashPause(false); }catch(e){} }, 400);
  };
  addEventListener("scroll", pvHold, {passive:true}); addEventListener("wheel", pvHold, {passive:true});
  $("pvedit").addEventListener("click", () => { try{ pvWin().dashEditing() ? pvWin().dashEdit(false) : pvWin().dashEdit(true); }catch(e){} });
  $("pvnav").addEventListener("click", () => { PV.navManual = document.body.classList.contains("nav-collapsed"); pvApplyNav(); requestAnimationFrame(pvFit); });
  $("pvgrid").addEventListener("click", () => { try{ pvWin().dashHostGrid(); }catch(e){} });
  $("pvundo").addEventListener("click", () => { try{ pvWin().dashHostUndo(1); }catch(e){} });
  $("pvredo").addEventListener("click", () => { try{ pvWin().dashHostUndo(-1); }catch(e){} });
  $("pvcancel").addEventListener("click", () => { try{ pvWin().dashEdit(false); }catch(e){} });
  $("pvsave").addEventListener("click", () => { try{ pvWin().dashHostSave(); }catch(e){} });
  // permanent delegation for the pulled-out right inspector panel
  $("insp-body").addEventListener("input", e => { try{ pvWin().dashHostInput(e); }catch(err){} });
  $("insp-body").addEventListener("change", e => { try{ pvWin().dashHostInput(e); }catch(err){} });
  $("insp-body").addEventListener("pointerdown", e => {
    const tc = e.target.closest(".tc[data-type]");
    if (tc && e.button === 0){ e.preventDefault(); startHostTileDrag(tc, e); return; }
    try{ pvWin().dashHostDown(e); }catch(err){}
  });
  setInterval(() => {
    let on = false; try{ on = pvWin().dashEditing(); }catch(e){}
    $("pvedit").classList.toggle("on", on); $("pvedit").textContent = on ? "Cancel editing" : "Edit on screen";
    if (!on && PV.editing) window.dashDeskSync({editing:false});
  }, 500);
  document.body.classList.add("desk");
  $("pv").hidden = false;
  $("pvf").addEventListener("load", () => {
    if (PV.editing) window.dashDeskSync({editing:false});
    pvDesktopSync();
    setTimeout(() => {
      pvDesktopSync();
      try{
        if (PV.editTile){ const tile = PV.editTile; PV.editTile = PV.editPage = ""; pvWin().dashEdit(true, tile); }      // a tile just added from the Library
        else if (PV.editPage){ const id = PV.editPage; PV.editPage = ""; act("edit", id); } else if (PV.page) pvWin().showPage(PV.page);
      }catch(e){}
      pvTabs();
    }, 1200);
  });
  $("pvpage").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.edtab){ try{ pvWin().dashHostTab(b.dataset.edtab); }catch(err){} return; }
    try{ pvWin().showPage(+b.dataset.pg); }catch(err){}
    pvTabs();
  });
  setInterval(() => { if (PV.editing) return; const b = $("pvpage").querySelector("button.on"); if (b && +b.dataset.pg !== pvCur()) pvTabs(); }, 700);   // follow swipes
  $("pvori").addEventListener("click", () => { if (displayMode !== "auto") return; PV.flip = !PV.flip; pvButtons(); });
  $("pvscr").addEventListener("click", () => {
    if (PV.editing){ PV.navManual = true; pvApplyNav(); requestAnimationFrame(pvFit); }
    stack = ["root", "display"]; show(); scrollTo(0, 0);
  });
  addEventListener("resize", () => { pvApplyNav(); pvFit(); });
  if (typeof ResizeObserver === "function"){
    new ResizeObserver(pvFit).observe($("pvbar"));
    new ResizeObserver(pvFit).observe($("pvstage"));
  }
  pvButtons(); pvLoad();
}
load();
