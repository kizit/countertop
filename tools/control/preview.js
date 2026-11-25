/* ---------- preview (on a computer; on the Echo the screen itself is the preview) ---------- */
const PV = {w:1920, h:1080, page:0, theme:""};
function pvWin(){ try{ return $("pvf").contentWindow; }catch(e){ return null; } }
function pvFit(){
  const box = $("pvbox"), f = $("pvf"), bar = $("pvsize").closest(".pvbar");
  const k = Math.max(0, Math.min((bar.clientWidth - 2) / PV.w,
    PV.h > PV.w ? Math.max(240, innerHeight - bar.offsetHeight - 26) / PV.h : Infinity));
  f.style.width = PV.w + "px"; f.style.height = PV.h + "px"; f.style.transform = "scale(" + k + ")";
  box.style.width = Math.round(PV.w * k) + 2 + "px";
  box.style.height = Math.round(PV.h * k) + 2 + "px";
}
function pvSize(b){
  PV.w = +b.dataset.w; PV.h = +b.dataset.h; $("pvres").textContent = PV.w + "×" + PV.h;
  for (const x of $("pvsize").children){
    x.classList.toggle("on", x === b);
    x.setAttribute("aria-pressed", String(x === b));
  }
  pvFit();
}
function pvCur(){ try{ const w = pvWin(); return Math.max(0, w.pageList().indexOf(w.dashPage())); }catch(e){ return 0; } }      // the page showing, as its place in the tabs
function pvName(){ try{ return pvWin().dashPage(); }catch(e){ return ""; } }
// the night page only shows while the preview is forced to night, so it isn't a page to come back to
function pvLoad(){ PV.page = pvName() === "night" ? 0 : pvCur(); $("pvf").src = "/dash/content?preview=1" + (PV.trial ? "&trial=" + PV.trial : "") + (PV.theme ? "&theme=" + PV.theme : "") + (PV.night ? "&night=1" : "") + "&t=" + Date.now(); }
function pvTabs(){
  let L = ["main"];
  try{ L = pvWin().pageList(); }catch(e){}
  const cur = pvCur();
  $("pvpage").innerHTML = L.length < 2 ? "" : L.map((n, i) => '<button data-pg="' + i + '"' + (i === cur ? ' class="on"' : "") + '>' + esc(n === "main" ? "Main" : n === "night" ? "Night" : (cpById(n.slice(2)) || {}).name || n) + '</button>').join("");
}
// called by the dashboard inside the preview
// the editor in the preview: a tile needs a calendar, team... that isn't set up yet
window.dashSetup = kind => { stack = ["root", "src:" + kind]; show(); scrollTo(0, 0); };
window.dashSaved = () => { toast("Layout saved", "ok"); load(); };
// desktop mode inside Controls' preview iframe: native scrolling, hover highlights, pointer cursor, and right-click context menus (without modifying /dash)
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
    } else if (st) st.remove();
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
if (!ECHO){
  let pvRes = null;
  const pvHold = () => {
    try{ const w = pvWin(); if (w.dashPause && !w.PAUSED) w.dashPause(true); }catch(e){}
    clearTimeout(pvRes); pvRes = setTimeout(() => { try{ pvWin().dashPause(false); }catch(e){} }, 400);
  };
  addEventListener("scroll", pvHold, {passive:true}); addEventListener("wheel", pvHold, {passive:true});
  $("pvedit").addEventListener("click", () => { try{ pvWin().dashEditing() ? pvWin().dashEdit(false) : pvWin().dashEdit(true); }catch(e){} });
  setInterval(() => { let on = false; try{ on = pvWin().dashEditing(); }catch(e){} $("pvedit").classList.toggle("on", on); $("pvedit").textContent = on ? "Cancel editing" : "Edit on screen"; }, 500);
  document.body.classList.add("desk");
  $("pv").hidden = false;
  $("pvf").addEventListener("load", () => {
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
    try{ pvWin().showPage(+b.dataset.pg); }catch(err){}
    pvTabs();
  });
  setInterval(() => { const b = $("pvpage").querySelector("button.on"); if (b && +b.dataset.pg !== pvCur()) pvTabs(); }, 700);   // follow swipes
  $("pvsize").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    pvSize(b);
  });
  addEventListener("resize", pvFit);
  if (typeof ResizeObserver === "function") new ResizeObserver(pvFit).observe($("pvsize").closest(".pvbar"));
  pvFit(); pvLoad();
}
load();
