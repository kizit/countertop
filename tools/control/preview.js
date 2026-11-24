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
  $("pvf").addEventListener("load", () => setTimeout(() => {
    try{
      if (PV.editTile){ const tile = PV.editTile; PV.editTile = PV.editPage = ""; pvWin().dashEdit(true, tile); }      // a tile just added from the Library
      else if (PV.editPage){ const id = PV.editPage; PV.editPage = ""; act("edit", id); } else if (PV.page) pvWin().showPage(PV.page);
    }catch(e){}
    pvTabs();
  }, 1200));
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
