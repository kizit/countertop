/* ---------- a list kept on this dashboard: its items, edited right here in Controls → Lists ----------
   The same storage as the List tile (/notes?list=<id>): add, tick, delete — and when the list is set to
   clear its ticks every day at 00:00, that reset applies here too. */
let llBusy = false;
function llRender(d, sid){
  const el = document.getElementById("llitems"); if (!el) return;
  const items = d.items || [];
  el.innerHTML = items.length ? items.map(i =>
    '<div class="row"><div class="t"><b' + (i.done ? ' style="text-decoration:line-through;opacity:.5"' : "") + '>' + esc(i.text) + '</b></div>' +
    sw(!!i.done, 'data-litog="' + esc(i.id) + '" data-sid="' + esc(sid) + '"') +
    '<button class="ll-x" data-lidel="' + esc(i.id) + '" data-sid="' + esc(sid) + '" aria-label="Delete">×</button></div>').join("")
    : '<div class="row"><div class="t"><small>Nothing on the list yet</small></div></div>';
  const bar = document.getElementById("llbar");
  if (bar){
    const done = items.filter(i => i.done).length;
    bar.hidden = !items.length;
    const c = document.getElementById("llcount");
    if (c) c.textContent = done + " / " + items.length + " done" + (d.daily ? " · ticks reset at 00:00" : "");
  }
}
async function llCall(sid, body){
  llBusy = true;                    // a tap always goes through; only the poll steps aside
  try{
    const r = await fetch("/notes", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(Object.assign({list:sid}, body))});
    llRender(await r.json(), sid);
  }catch(e){}
  llBusy = false;
}
function llAdd(sid){
  const inp = document.getElementById("lladd");
  if (!inp || !sid) return;
  const text = inp.value.trim();
  if (!text) return;
  inp.value = "";
  llCall(sid, {op:"add", text});
}
async function llRefresh(){
  const el = document.getElementById("llitems"); if (!el || llBusy) return;
  const sid = el.dataset.sid; if (!sid) return;
  llBusy = true;
  try{
    const d = await (await fetch("/notes?list=" + encodeURIComponent(sid), {cache:"no-store"})).json();
    if (document.getElementById("llitems") && document.getElementById("llitems").dataset.sid === sid) llRender(d, sid);
  }catch(e){}
  llBusy = false;
}
let delArm = "";
function confirmDel(K, id){      // tap Delete twice (no pop-up dialogs: the Echo can't show them reliably)
  if (delArm === id) return true;
  delArm = id; toast("Tap again to remove this " + K.one, "bad"); setTimeout(() => { if (delArm === id) delArm = ""; }, 4000);
  return false;
}
function mainScreen(){
  const main = gpAll().find(p => p.id === "main");
  let h = '<div class="big">Main</div><p class="intro">The page the screen starts on, and comes back to from other pages.</p>';
    const nt = [].concat(...main.slots.map(smods)).length, nb = main.slots.length;
  h += sec("Layout", '<div class="row">' + pagePic(main, null, "pthumb") + '<div class="t"><b>' + nt + (nt === 1 ? " tile" : " tiles") + " in " + nb + (nb === 1 ? " box" : " boxes") + '</b><small>' + esc(pageSummary(main)) + '</small></div></div>' +
    (ECHO ? "" : '<button class="btnrow blue" data-act="edit" data-id="main">Edit Main on screen</button>') +
    row({t:"Change layout", sub:"Pick a premade dashboard, an empty grid or a saved layout in the Library", chev:true, attrs:'data-act="libpick" data-id="main"'}) +
    row({t:"Save a copy", sub:"Keep this layout in My layouts, and carry on editing Main", chev:true, attrs:'data-act="savemain"'}) +
    row({t:"Browse the Library", sub:"Your saved layouts, every premade layout, sharing and importing", chev:true, attrs:'data-act="lib" data-id="layouts"'}),
    ECHO ? "To change tiles, press Done and hold any tile on the screen." : "");
  return h;
}
function savedScreen(){
  const L = savedList();
  let h = '<div class="big">Saved layouts</div><p class="intro">Earlier versions of Main. Put one back on Main, add it as its own page, or delete it.</p>';
  if (!L.length) return h + sec("", '<div class="row"><div class="t"><small>Nothing saved yet. Changing Main\'s layout, or Save a copy on Main, keeps the old layout here.</small></div></div>');
  return h + L.map(p => sec("", '<div class="row col">' + pagePic(p, p.look ? Object.assign(lookVals(curLook()), p.look) : null, "page") + '</div>' +
    row({t:p.name, sub:pageShort(p)}) +
    '<div class="saverow" style="padding:0 12px 12px"><button data-act="savedpage" data-id="' + p.id + '">Add as page</button><button class="pri" data-act="savedmain" data-id="' + p.id + '">Use on Main</button></div>' +
    '<button class="btnrow red" data-act="saveddel" data-id="' + p.id + '">Delete</button>')).join("");
}
function pageScreen(id){
  if (id === "main") return mainScreen();
  const p = cpById(id); if (!p) return '<div class="big">Page not found</div>';
  let h = '<div class="big">' + esc(p.name) + '</div>';
  h += sec("", row({t:"Show this page", post: sw(p.on !== false, 'data-act="toggle" data-id="' + id + '"')}));
  h += sec("Name", '<div class="row col"><input type="text" data-pg="' + id + '" data-k="name" value="' + esc(p.name) + '"></div>');
  h += sec("", row({t:"Go back to the main page after", sub:"Seconds; 0 stays on this page", post:'<input type="number" min="0" max="3600" step="1" data-pg="' + id + '" data-k="back" value="' + (+p.back || 0) + '">'}));
  h += sec("On this page", '<div class="row"><div class="t"><b>' + esc(pageSummary(p)) + '</b></div></div>' +
    (ECHO ? "" : '<button class="btnrow blue" data-act="edit" data-id="' + id + '">Edit this page on screen</button>'),
    ECHO ? "To change it, swipe to this page on the screen and hold any tile." : "");
  h += sec("", '<button class="btnrow red" data-act="del" data-id="' + id + '">Delete page</button>', "Its tiles are deleted with it.");
  return h;
}
function pvGoPage(id){
  const tryGo = () => { try{ const w = pvWin(); if (!w.dashGoPage || w.dashEditing()) return; if (w.dashGoPage(id === "main" ? "main" : "c:" + id) >= 0) pvTabs(); }catch(e){} };
  tryGo(); setTimeout(tryGo, 1500);
}
function act(a, id){
  const p = cpById(id);
  if (a === "screenmatch"){ screenSave(thisScreen()); return; }
  if (a === "echoedit"){ location.href = displayHref(true); return; }
  if (a === "lib"){ libOpen(id); return; }
  if (a === "libpick"){ libOpen("layouts"); LIB.pick = id; LIB.chip = "all"; libShow(); return; }      // Add page, Change layout: pick in the Library
  if (a === "pickstarter"){
    WIZ.starter = id;
    show();
    document.querySelector('[data-act="pickstarter"][aria-pressed="true"]').focus({preventScroll:true});
    const preview = document.querySelector(".compactpreview");
    if (preview && preview.offsetWidth) preview.scrollIntoView({block:"nearest"});
    return;
  }
  if (a === "galtab"){ galTab = id; show(); return; }
  if (a === "savemain"){
    const main = gpAll().find(x => x.id === "main"), uid = newUid();
    gpAll().push({id:uid, name:uniqueName(mainDated()), cols:GC, slots:cloneSlots(main.slots, uid), on:false, saved:true, look:lookSnap(), theme:usedLook(), at:Date.now()});
    save(); toast("Saved a copy in Saved layouts", "ok"); show(); return;
  }
  if (a === "savedmain" || a === "savedpage"){
    const pid = installStarter("saved:" + id, a === "savedmain", a === "savedmain");
    save();
    if (pid) go("page:" + pid); else { toast("Main's old layout is in Saved layouts", "ok"); show(); }
    return;
  }
  if (a === "saveddel"){
    const sp = savedById(id); if (!sp || !confirmDel({one:"saved layout"}, id)) return;
    const gone = new Set([].concat(...(sp.slots || []).map(smods)));
    if (mods.tiles) mods.tiles.settings.items = tileList().filter(t => !gone.has(t.id));
    mods.pages.settings.items = gpAll().filter(x => x !== sp); save(); show(); return;
  }
  if (/^(wiz|st)/.test(a)) return wizAct(a, id);
  if (a === "toggle"){ p.on = p.on === false; save(); show(); return; }
  if (a === "edit"){ try{
      const w = pvWin(), name = id === "main" || id === "night" ? id : "c:" + id;
      if (w.dashGoPage(name) < 0 && w.dashApply) w.dashApply(mods);         // a page added or changed here that the preview hasn't seen yet
      if (w.dashGoPage(name) >= 0){ w.dashEdit(true); w.dashGoPage(name); pvTabs(); } else toast(p && p.on === false ? "Turn the page on first" : "The preview is still loading; try again", "bad");
    }catch(e){} return; }
  if (a === "del"){
    if (!confirmDel({one:"page"}, id)) return;
    const gone = new Set([].concat(...(p.slots || []).map(smods)));
    if (mods.tiles) mods.tiles.settings.items = tileList().filter(t => !gone.has(t.id));
    mods.pages.settings.items = gpAll().filter(x => x !== p); stack.pop(); save(); show(); return;
  }
  if (a === "locate") return locate();
}
// place search: Open-Meteo's free geocoder (no key); only the typed place name is sent
async function locate(){
  const box = document.querySelector('[data-act="locate"]').closest(".grp");
  box.innerHTML = '<div class="row col"><input type="text" id="locq" placeholder="City or town, e.g. Denver" autocapitalize="words"><div id="locres"></div></div>';
  const inp = $("locq"); inp.focus();
  let t = null;
  inp.addEventListener("input", () => { clearTimeout(t); t = setTimeout(async () => {
    const v = inp.value.trim(); if (v.length < 2){ $("locres").innerHTML = ""; return; }
    try{
      const j = await (await fetch("https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&name=" + encodeURIComponent(v))).json();
      $("locres").innerHTML = (j.results || []).map(r => row({t:r.name, sub:[r.admin1, r.country].filter(Boolean).join(", "), chev:true,
        attrs:'data-loc="' + esc(JSON.stringify({place:r.name, lat:+r.latitude.toFixed(4), lon:+r.longitude.toFixed(4)})) + '"'})).join("") || '<div class="help">No match</div>';
    }catch(e){ $("locres").innerHTML = '<div class="help">Search isn\'t reachable; type the latitude and longitude below instead.</div>'; }
  }, 350); });
}
// one screen's content and title; Controls shows it, and so does the Library's Themes and Effects views
function screenFor(cur){
  let h, title;
  if (cur === "root"){ h = rootScreen(); title = ""; }
  else if (cur === "display"){ h = displayScreen(); title = "Screen"; }
  else if (cur === "status"){ h = statusScreen(); title = "Status"; }
  else if (cur === "wiz"){ h = wizScreen(); title = "Set up"; }
  else if (cur === "saved"){ h = savedScreen(); title = "Saved layouts"; }
  else if (cur.startsWith("page:")){ const p = cpById(cur.slice(5)); h = pageScreen(cur.slice(5)); title = cur === "page:main" ? "Main" : p ? p.name : "Page"; }
  else if (cur.startsWith("src:")){ const k = cur.slice(4); h = srcScreen(k); title = KINDS[k] ? KINDS[k].title : ""; }
  else if (cur.startsWith("srci:")){ const [, k, id] = cur.split(":"); h = srcItemScreen(k, id); title = KINDS[k] ? KINDS[k].title : ""; }
  else if (cur === "looks"){ h = looksScreen(); title = "Themes"; }
  else if (cur.startsWith("theme:")){ h = themeScreen(cur.slice(6)); title = lookName(cur.slice(6)); }
  else if (cur.startsWith("look:")){ h = lookScreen(cur.slice(5)); title = cur === "look:new" ? "New theme" : "Customize"; }
  else if (cur.startsWith("gen:")){ h = genScreen(cur.slice(4)); title = GEN[cur.slice(4)] ? GEN[cur.slice(4)][0] : ""; }
  else if (cur === "sched"){ h = schedScreen(); title = "Schedule"; }
  else if (cur.startsWith("rule:")){ h = ruleScreen(cur.slice(5)); title = "Schedule"; }
  else if (cur === "night"){ h = nightScreen(); title = "Night page"; }
  else if (cur === "effects"){ h = effectsScreen(); title = "Effects"; }
  else if (cur.startsWith("emo:")){ h = emoScreen(cur); title = "Swap emoji"; }
  else if (cur.startsWith("fxedit:")){ h = fxEditScreen(cur.slice(7)); title = FXDRAFT && FXDRAFT.isNew ? "New effect" : "Edit effect"; }
  else if (cur.startsWith("share:")){ h = shareScreen(cur.slice(6)); title = "Share"; }
  else if (cur === "tstudio"){ h = thsScreen(); title = "Theme Studio"; }
  else if (cur === "timp"){ h = themeImpScreen(); title = "Open a theme"; }
  else if (cur === "fximp"){ h = fxImpScreen(); title = "Open an effect"; }
  else if (cur.startsWith("fx:")){ h = fxScreen(cur.slice(3)); title = (FXLIB.BY[cur.slice(3)] || {}).name || "Effect"; }
  else { const m = cur.slice(4); h = schema[m] ? modScreen(m) : ""; title = schema[m] ? schema[m].title : ""; }
  return {h, title};
}
function backLabel(prev){
  const LBL = {"mod:general":"Location & units", root:"Dashboard", looks:"Themes", tstudio:"Theme Studio", sched:"Schedule", effects:"Effects", night:"Night page"};
  return !prev ? "" : LBL[prev] ? LBL[prev] : prev === "look:new" ? "New theme" : prev.startsWith("look:") ? "Customize" : prev.startsWith("theme:") ? lookName(prev.slice(6)) : prev.startsWith("src:") ? KINDS[prev.slice(4)].title :
    prev === "page:main" ? "Main" : prev.startsWith("page:") ? ((cpById(prev.slice(5)) || {}).name || "Page") : prev === "saved" ? "Saved layouts" : prev.startsWith("fx:") ? (FXLIB.BY[prev.slice(3)] || {}).name || "Effect" : "Back";
}
function show(){
  if (libSub()){ libShow(); return; }          // Themes and Effects are open in the Library
  const cur = stack[stack.length - 1];
  const {h, title} = screenFor(cur);
  $("screen").innerHTML = h;
  if (document.getElementById("llitems")) llRefresh();      // a list's items, ready to edit
  const choice = cur === "wiz" && WIZ.step === 4 ? WIZ.starter || (sameEverydayLayout() ? "everyday" : "") : "";
  $("starterpv").innerHTML = choice && choiceOf(choice) ? starterPreview(choice) : "";
  document.body.classList.toggle("showstarter", !!(choice && choiceOf(choice)));
  if (!choice && !ECHO) pvFit();
  $("title").textContent = title;
  $("back").hidden = stack.length < 2;
  $("backlbl").textContent = backLabel(stack[stack.length - 2]);
  const want = cur.startsWith("theme:") ? cur.slice(6) : cur.startsWith("rule:") ? ((ruleById(cur.slice(5)) || {}).look || "") : "", night = cur === "night";
  if (!cur.startsWith("look:") && DRAFT) DRAFT = null;          // left the Customize screen (Save, Cancel or back): the draft is gone
  if (!ECHO && cur.startsWith("look:")){ if (!PV.trial) draftPreview(true); }
  else if (!ECHO && (want !== PV.theme || night !== !!PV.night || PV.trial)){ PV.theme = want; PV.night = night; PV.trial = ""; pvLoad(); }
  fxPreviews();
  if (!ECHO && cur.startsWith("page:")) pvGoPage(cur.slice(5));
}
function go(to){
  if (libSub()){ LIB.sub.push(to); libShow(); libEl().querySelector(".lmain").scrollTop = 0; return; }
  stack.push(to); show(); scrollTo(0, 0); if (to === "status") statusLoad();
}
// the screen stack that's showing: the Library's while its Themes or Effects view is open, otherwise Controls'
const navStack = () => libSub() ? LIB.sub : stack;
