"use strict";
/* Controls: Setup (your location, calendars, lists, teams, albums, cams, store deals), Pages, and the look.
   Tiles themselves are added, arranged and set up on the dashboard: Edit on screen (or hold a tile on the screen). */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const ECHO = /[?&]echo=1/.test(location.search);
const MOUNTS = {auto:"Automatic", landscape:"Landscape", left:"Portrait · left edge up", right:"Portrait · right edge up"};
const SHELL = ECHO && window.parent !== window;
let displayMode = "auto";
let everyday, schema = {}, mods = {}, SRC = {}, KINDS = {}, saveTimer = null, stack = ["root"];
let SBXC = {tiles:{}};          // community tiles installed on the server (/config → sandbox), for the Library
const KIND_ORDER = ["calendars", "lists", "teams", "albums", "cams", "homeassistant", "recipes"];

window.shellBusy = () => true;       // on the Echo, the shell must not reload the dashboard over Controls when a save changes the settings
if (ECHO){
  document.documentElement.classList.add("echo");
  $("done").textContent = "Done"; $("done").removeAttribute("target");
  document.addEventListener("pointerdown", () => { try{ window.top.shellTap && window.top.shellTap(); }catch(e){} });
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
  if (changed && !ECHO){
    const height = mode === "left" || mode === "right" ? 1920 : 1080;
    pvSize($("pvsize").querySelector('[data-h="' + height + '"]'));
  }
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
    applyDisplayMode(j.orientation || "auto");
    everyday = j.everyday; schema = j.schema; mods = j.modules; SRC = s.sources || {}; KINDS = s.kinds || {};
    SBXC = j.sandbox || {tiles:{}}; commDefs();
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
function save(quiet){          // quiet: an Undo toast is showing, so don't cover it with "Saved"
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try{
      const r = await fetch("/config", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({modules: mods})});
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || r.status);
      mods = j.modules;
      if (!quiet) toast("Saved", "ok"); pvRefresh();
    }catch(e){ toast("Didn't save: " + e.message, "bad"); }
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

