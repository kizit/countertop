"use strict";
/* Controls: Setup (your location, calendars, lists, teams, albums, cams, store deals), Pages, and the look.
   Tiles themselves are added, arranged and set up on the dashboard: Edit on screen (or hold a tile on the screen). */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const ECHO = /[?&]echo=1/.test(location.search);
const INPUT_KEY = "countertop.input";
// Echo / Silk browsers always stay in touch mode; otherwise matchMedia decides once at load, with /control?input= and Controls > Screen overrides
function inputIsEchoUA(){
  return /Silk\b|\bEcho\b|\bKF[A-Z]{2,5}\b|\bAFT[A-Z]{1,4}\b/i.test(navigator.userAgent || "");
}
function inputAuto(){
  if (ECHO || inputIsEchoUA()) return "touch";
  try{ if (window.matchMedia && matchMedia("(hover: hover) and (pointer: fine)").matches) return "desktop"; }catch(e){}
  return "touch";
}
function inputStored(){
  try{ const v = localStorage.getItem(INPUT_KEY); return v === "desktop" || v === "touch" ? v : ""; }catch(e){ return ""; }
}
function inputDetect(){
  const q = new URLSearchParams(location.search).get("input");
  if (q !== null){
    const v = q.trim().toLowerCase();
    try{ if (v === "desktop" || v === "touch") localStorage.setItem(INPUT_KEY, v); else localStorage.removeItem(INPUT_KEY); }catch(e){}
    const u = new URL(location.href); u.searchParams.delete("input"); history.replaceState(history.state, "", u);
  }
  if (ECHO || inputIsEchoUA()) return "touch";
  return inputStored() || inputAuto();
}
const CT = window.CT = {input: inputDetect()};
function applyInputMode(mode){
  CT.input = ECHO || inputIsEchoUA() ? "touch" : (mode === "desktop" || mode === "touch" ? mode : inputAuto());
  document.documentElement.dataset.input = CT.input;
}
applyInputMode(CT.input);
addEventListener("storage", e => {
  if (e.key !== INPUT_KEY || ECHO || inputIsEchoUA()) return;
  applyInputMode(inputStored() || inputAuto());
  inputChanged();
});
// a mode switch (this tab's setting or another tab's): restyle the preview, then redraw Screen settings if they're open
function inputChanged(){
  pvButtons(); pvDesktopSync();
  if (cur0() === "display") show();
}
const MOUNTS = {auto:"Automatic", landscape:"Landscape", left:"Portrait · left edge up", right:"Portrait · right edge up"};
const SHELL = ECHO && window.parent !== window;
let displayMode = "auto";
let screenSz = "1920x1080";        // the dashboard's screen, landscape "WxH" (Controls > Screen orientation); every preview here uses it
// Echo Show panel resolutions, then a few common screens for anything else
const SCREEN_SIZES = [["1920x1080", "Echo Show 15 or 21 · 1920×1080"], ["1920x1200", "Echo Show 11 · 1920×1200"], ["1340x800", "Echo Show 8 (4th gen) · 1340×800"],
  ["1280x800", "Echo Show 8 or 10, Echo Show (2nd gen) · 1280×800"], ["1024x600", "Echo Show (1st gen) · 1024×600"], ["960x480", "Echo Show 5 · 960×480"],
  ["1280x720", "720p · 1280×720"], ["1366x768", "Laptop · 1366×768"], ["1024x768", "Tablet · 1024×768"], ["2560x1440", "1440p · 2560×1440"], ["3840x2160", "4K · 3840×2160"]];
const sizeLabel = v => (SCREEN_SIZES.find(x => x[0] === v) || [v, v.replace("x", "×")])[1];
// the screen as the dashboard sees it now: turned on its side when the orientation setting is a portrait one
function scr(){
  const [w, h] = screenSz.split("x").map(Number);
  return displayMode === "left" || displayMode === "right" ? [h, w] : [w, h];
}
// attributes for a Library preview box: shaped like the screen as it is now (portrait only when the screen is turned on its side)
function lbigAttrs(){
  const [w, h] = scr();
  return 'class="lbig' + (h > w ? " port" : "") + '" style="aspect-ratio:' + w + "/" + h + '"';
}
// fit a preview iframe (laid out at the screen's real size) into its box
function scrFit(f, boxWidth){
  const [w, h] = scr(); f.style.width = w + "px"; f.style.height = h + "px"; f.style.transform = "scale(" + boxWidth / w + ")";
}
// keep the preview sized to Controls > Screen (size + orientation); when Orientation is Automatic, offer a Portrait flip
function pvButtons(){
  const touchBar = CT.input === "touch";
  if ($("pvsize")) $("pvsize").hidden = !touchBar;
  if (touchBar){           // touch: the size buttons as before (Full screen / Portrait), turned the other way up by the screen
    PV.flip = false;
    const [w, h] = scr(), b = $("pvsize").children;
    const set = (x, W, H, label) => { x.dataset.w = W; x.dataset.h = H; if (label) x.textContent = label; };
    set(b[0], w, h); set(b[1], h, w, w >= h ? "Portrait" : "Landscape");
    if ($("pvori")) $("pvori").hidden = true;
    if ($("pvscr")) $("pvscr").hidden = true;
    pvSize(b[0]);
    return;
  }
  if (displayMode !== "auto") PV.flip = false;
  let [w, h] = scr();
  if (displayMode === "auto" && PV.flip) [w, h] = [h, w];
  PV.w = w; PV.h = h;
  const res = w + "×" + h, port = h > w;
  if ($("pvres")) $("pvres").textContent = res;
  if ($("pvscr")) $("pvscr").textContent = (port ? "Portrait · " : "") + res;
  const ori = $("pvori");
  if (ori){
    ori.hidden = displayMode !== "auto";
    ori.classList.toggle("on", !!PV.flip);
    ori.setAttribute("aria-pressed", String(!!PV.flip));
    ori.title = PV.flip ? "Switch preview back to landscape" : "Preview and edit the portrait layout";
  }
  pvFit();
}
let everyday, schema = {}, mods = {}, SRC = {}, KINDS = {}, saveTimer = null, stack = ["root"];
let SBXC = {tiles:{}};          // community tiles installed on the server (/config → sandbox), for the Library
const KIND_ORDER = ["calendars", "lists", "teams", "albums", "cams", "homeassistant", "recipes"];

window.shellBusy = () => true;       // on the Echo, the shell must not reload the dashboard over Controls when a save changes the settings
if (ECHO){
  document.documentElement.classList.add("echo");
  $("done").textContent = "Done"; $("done").removeAttribute("target");
  if (CT.input === "touch") document.addEventListener("pointerdown", () => { try{ window.top.shellTap && window.top.shellTap(); }catch(e){} });
  setInterval(() => { try{ window.top.contentTick && window.top.contentTick(); }catch(e){} }, 20e3);
}
$("done").href = displayHref();
// the dashboard this page replaced said goodbye to the server as it closed; say it again from here, in case that was
// lost on the way out, so the server doesn't take its quiet for a frozen screen (tools/dash/sandbox.js sbxLeave)
try{
  const left = JSON.parse(sessionStorage.getItem("sbxLeft") || "null");
  if (left && left.session && !left.told){
    left.told = 1; sessionStorage.setItem("sbxLeft", JSON.stringify(left));
    fetch("/sandbox/beat", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({session:left.session, showing:[], gap:0, bye:true})}).catch(() => {});
  }
}catch(e){}

function displayHref(edit){
  const url = new URL(SHELL ? "/dash/content" : "/dash", location.origin);
  if (edit) url.searchParams.set("edit", "1");
  const page = new URLSearchParams(location.search).get("page");      // the page the screen was on (the ⚙ button sends it)
  if (page) url.searchParams.set("page", page);
  return url.href;
}
function applyDisplayMode(mode){
  const changed = displayMode !== mode;
  displayMode = mode;
  if (changed && !ECHO) pvButtons();
}
function applyScreen(v){
  if (!/^\d+x\d+$/.test(v || "")) v = "1920x1080";
  const changed = screenSz !== v;
  screenSz = v;
  if (changed && !ECHO) pvButtons();
}
async function displaySet(select){
  const mode = select.value;
  select.disabled = true;
  try{
    const r = await fetch("/config", {method:"POST", keepalive:true, headers:{"Content-Type":"application/json"}, body:JSON.stringify({orientation:mode})});
    if (!r.ok) throw new Error("HTTP " + r.status);
    applyDisplayMode((await r.json()).orientation);
    if (SHELL && window.parent.shellSetOrientation) window.parent.shellSetOrientation(displayMode);
    toast("Screen orientation saved", "ok");
  }catch(e){ select.value = displayMode; toast("Couldn't save orientation: " + e.message, "bad"); }
  finally{ select.disabled = false; }
}

// the dashboard's screen size, saved on the server: previews and the editor in every browser follow it
async function screenSave(size, select){
  if (select) select.disabled = true;
  try{
    const r = await fetch("/config", {method:"POST", keepalive:true, headers:{"Content-Type":"application/json"}, body:JSON.stringify({screen:size})});
    if (!r.ok) throw new Error("HTTP " + r.status);
    applyScreen((await r.json()).screen);
    toast("Screen size saved", "ok");
    if (cur0() === "display") show();
  }catch(e){ toast("Couldn't save the screen size: " + e.message, "bad"); if (select) select.value = screenSz; }
  finally{ if (select) select.disabled = false; }
}
// the screen this page is on, as landscape "WxH" (a turned dashboard swaps what the page sees)
const thisScreen = () => (displayMode === "left" || displayMode === "right" ? innerHeight + "x" + innerWidth : innerWidth + "x" + innerHeight);
const cur0 = () => stack[stack.length - 1];
function toast(msg, cls){
  const t = $("toast"); t.textContent = msg; t.className = cls || ""; t.style.opacity = 1;      // (also clears an Undo button)
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.style.opacity = 0; }, cls === "bad" ? 8000 : 2200);
}
// a toast with an Undo button, for changes that take effect right away (like Use this theme)
function undoToast(msg, undo){
  const t = $("toast"); t.innerHTML = '<span>' + esc(msg) + '</span><button type="button">Undo</button>'; t.className = "undo"; t.style.opacity = 1;
  t.querySelector("button").onclick = () => { t.style.opacity = 0; t.className = ""; undo(); };
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.style.opacity = 0; t.className = ""; }, 6000);
}
async function load(){
  try{
    const [j, s] = await Promise.all([fetch("/config?starters=1", {cache:"no-store"}).then(r => r.json()), fetch("/sources", {cache:"no-store"}).then(r => r.json())]);
    applyDisplayMode(j.orientation || "auto"); applyScreen(j.screen);
    everyday = j.everyday; schema = j.schema; mods = j.modules; SRC = s.sources || {}; KINDS = s.kinds || {};
    SBXC = j.sandbox || {tiles:{}}; LEGACYC = j.legacy || {}; commDefs(); stuFiles();
    FXLIB.setMine(mods.effects && mods.effects.settings.mine);
    if (needsSetup() && stack.length === 1) stack = ["root", "wiz"];       // a new install: walk through the basics first
    await titlesLoad; show(); statusLoad();
  }catch(e){ toast("Can't reach the dashboard server", "bad"); }
}
function pvRefresh(){
  if (ECHO) return;
  if (libSub()){ LIB.pvq = ""; libPv(); }
  let ed = false; try{ ed = pvWin().dashEditing(); }catch(e){}
  if (ed){ try{ pvWin().dashApply(mods); }catch(e){} } else pvLoad();
}
let saveGen = 0, saveBusy = Promise.resolve();
function save(quiet){          // quiet: an Undo toast is showing, so don't cover it with "Saved"
  const gen = ++saveGen;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveBusy = saveBusy.then(async () => {
      if (gen !== saveGen) return;
      try{
        const r = await fetch("/config", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({modules: mods})});
        const j = await r.json();
        if (!r.ok || j.error) throw new Error(j.error || r.status);
        if (gen !== saveGen) return;     // another edit arrived while this save was in flight: don't clobber it
        const had = tileList().some(t => t.type === "custom");
        mods = j.modules;
        if (had && !tileList().some(t => t.type === "custom" && LEGACYC[t.id])) stuSync().then(() => { if (!libEl().hidden) libShow(); });     // the server converted a Your own tile
        else if (had) stuSync();
        if (!quiet) toast("Saved", "ok"); pvRefresh();
      }catch(e){ if (gen === saveGen) toast("Didn't save: " + e.message, "bad"); }
    });
  }, 450);
}

/* ---------- helpers ---------- */
const U = 2, GC = 24 * U;
function gpAll(){
  if (!(mods.pages && mods.pages.settings)) return [];
  const L = mods.pages.settings.items = mods.pages.settings.items || [];
  for (const p of L) if (p.cols !== GC){ const f = GC / (p.cols || 12); (p.slots || []).forEach(s => { s.x *= f; s.y *= f; s.w *= f; s.h *= f; }); p.cols = GC; }
  return L;
}
// Saved layouts are switched-off pages marked saved: earlier versions of Main, kept to bring back later.
// ("Previous main" is what replacing Main used to leave behind.)
const isSaved = p => !!p.saved || (p.on === false && p.name === "Previous main");
const cpList = () => gpAll().filter(p => p.id !== "main" && p.id !== "night" && !isSaved(p));
const savedList = () => gpAll().filter(p => p.id !== "main" && p.id !== "night" && isSaved(p));
const savedById = id => savedList().find(p => p.id === id);
const cpById = id => cpList().find(p => p.id === id);
const smods = s => [s.mod].concat(s.more || []).filter(Boolean);
const tileList = () => (mods.tiles && mods.tiles.settings && mods.tiles.settings.items) || [];
const sw = (on, attrs) => '<button class="sw' + (on ? " on" : "") + '" role="switch" aria-checked="' + !!on + '" ' + attrs + '></button>';
function row(o){   // {t, sub, v, chev, cls, attrs, pre, post}
  return '<div class="row' + (o.chev ? " tap" : "") + (o.cls ? " " + o.cls : "") + '" ' + (o.attrs || "") + '>' + (o.pre || "") +
    '<div class="t"><b>' + esc(o.t) + '</b>' + (o.sub ? '<small>' + esc(o.sub) + '</small>' : "") + '</div>' +
    (o.v ? '<span class="v">' + esc(o.v) + '</span>' : "") + (o.post || "") + (o.chev ? '<span class="chev">›</span>' : "") + '</div>';
}
const sec = (title, body, foot) => '<div class="sec">' + (title ? '<h2>' + esc(title) + '</h2>' : "") + '<div class="grp">' + body + '</div>' + (foot ? '<div class="foot">' + esc(foot) + '</div>' : "") + '</div>';
const n = (k, c) => c + " " + (c === 1 ? KINDS[k].one : KINDS[k].title.toLowerCase());
function tileName(id){ const t = tileList().find(x => x.id === id); return t ? t.name || TITLES[t.type] || t.type : id; }
// which tiles use a source (a tile set to "all calendars" counts for every calendar)
function usedBy(kind, id){
  return tileList().filter(t => Object.values(t.settings || {}).some(v => v === id || Array.isArray(v) && v.includes(id))).map(t => t.name || TITLES[t.type] || t.type);
}
let TITLES = {};          // tile type -> its name, read from the tile files
const titlesLoad = fetch("/tiles.js").then(r => r.text()).then(t => { for (const m of t.matchAll(/(?:Tile|viewTile)\("(\w+)",\s*\{[^}]*?title:"([^"]+)"/g)) TITLES[m[1]] = m[2]; }).catch(() => {});

