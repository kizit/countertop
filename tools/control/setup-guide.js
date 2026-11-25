/* ---------- First-run setup guide: location, a calendar and the grocery list, then where to open the screen ---------- */
const WIZ = {step:0, kind:"", starter:"", calName:"Family"};
const WIZ_STEPS = ["Welcome", "Location", "Calendar", "Grocery list", "Dashboard", "All set"];
const needsSetup = () => mods.general && !mods.general.settings.setupDone && !mods.general.settings.lat && !mods.general.settings.lon;
const firstList = () => (SRC.lists || [])[0] || null;
function wizScreen(){
  const st = WIZ.step, g = mods.general.settings, host = location.host;
  let h = '<div class="wizdots">' + WIZ_STEPS.map((s, i) => '<i class="' + (i < st ? "done" : i === st ? "on" : "") + '"></i>').join("") + '</div>';
  const nav = (next, skip) => '<div class="saverow">' + (st > 0 ? '<button data-act="wizback">Back</button>' : "") +
    (skip ? '<button data-act="wiznext">' + skip + '</button>' : "") + '<button class="pri" data-act="' + (next[1] || "wiznext") + '">' + next[0] + '</button></div>';
  if (st === 0){
    h += '<div class="big">Welcome to Countertop</div><p class="intro">Choose your location, calendar, grocery list and a layout for your screen. You can change all of it later in Controls.</p>';
    h += '<div class="saverow"><button data-act="wizskip">Skip for now</button><button class="pri" data-act="wiznext">Start</button></div>';
  } else if (st === 1){
    h += '<div class="big">Where are you?</div><p class="intro">For the weather, the radar, sunrise and sunset. Only the name you type is sent, to Open-Meteo\'s free place search.</p>';
    h += sec("", (g.lat || g.lon ? row({t:g.place || g.lat + ", " + g.lon, sub:"Your location", pre:'<span class="dot" style="background:var(--ok)"></span>'}) : "") +
      '<button class="btnrow blue" data-act="locate">' + (g.lat || g.lon ? "Pick a different place…" : "Find your town…") + '</button>');
    h += sec("", field("general", "units", schema.general.settings.units, g.units) + field("general", "h24", schema.general.settings.h24, g.h24) +
      field("general", "lang", schema.general.settings.lang, g.lang));
    h += nav(["Next"], g.lat || g.lon ? "" : "Skip");
  } else if (st === 2){
    const F = KINDS.calendars.fields.url, cals = SRC.calendars || [];
    h += '<div class="big">Add your calendar</div><p class="intro">Countertop reads a calendar from its private iCal link. ' + esc(F.help) + '</p>';
    if (cals.length) h += sec("Added", cals.map(c => row({t:c.name, pre:'<span class="dot" style="background:' + esc(c.color || "var(--ok)") + '"></span>'})).join(""));
    h += sec(cals.length ? "Add another" : "", '<div class="row col"><div class="t"><b>Name</b></div><input type="text" id="wcname" value="' + esc(cals.length ? "" : WIZ.calName) + '" placeholder="e.g. Family or Work"></div>' +
      '<div class="row col"><div class="t"><b>Private iCal link</b></div><input type="text" id="wcurl" placeholder="webcal://… or https://….ics" autocapitalize="off" spellcheck="false"></div>' +
      '<button class="btnrow blue" data-act="wizcal">Add calendar</button>');
    h += nav(["Next"], cals.length ? "" : "Skip");
  } else if (st === 3){
    const L = firstList() || {}, kind = WIZ.kind || L.kind || "This dashboard", mac = STATUS && STATUS.server.where === "Mac";
    const OPTS = [["This dashboard", "Right here", "Add and tick items from any phone's browser at " + host + "/list. Nothing to install."],
      ["Sent from another app", "Apple Reminders or another app", "Reminders Sync in the Countertop Mac app, an iPhone Shortcut or a script sends the list. Works with Docker and Unraid."],
      ["A web address", "A list that's online", "Countertop reads a published list (text, Markdown checklist, JSON or iCal to-dos) every few minutes."]];
    if (mac) OPTS.splice(1, 0, ["Apple Reminders", "Apple Reminders on this Mac", "The server reads a Reminders list itself, because it runs on a Mac."]);
    h += '<div class="big">Your grocery list</div><p class="intro">Where should the list on the screen come from?</p>';
    h += sec("", OPTS.map(([v, t, sub]) => '<label class="emopt"><input type="radio" name="wizkind" data-act="wizkind" data-id="' + esc(v) + '"' + (v === kind ? " checked" : "") + '><span class="t"><b>' + esc(t) + '</b><span class="ex">' + esc(sub) + '</span></span></label>').join(""));
    let extra = "";
    if (kind === "Apple Reminders") extra = '<div class="row col"><div class="t"><b>Reminders list name</b></div><input type="text" id="wlrem" value="' + esc(L.remName || "Grocery") + '"></div>';
    if (kind === "A web address") extra = '<div class="row col"><div class="t"><b>Address of the list</b></div><input type="text" id="wlurl" placeholder="' + (L.kind === "A web address" && L.urlSet ? "Saved and hidden. Paste a new link to replace it." : "https://…") + '" autocapitalize="off" spellcheck="false"><div class="help">' + esc(KINDS.lists.fields.url ? KINDS.lists.fields.url.help : "") + '</div></div>';
    if (kind === "Sent from another app") extra = L.kind === kind && L.pushKey
      ? row({t:"Sync key: " + L.pushKey, sub:"In the Countertop Mac app, Reminders Sync fills it in for you. For a Shortcut, the steps are in docs/list-sync.md on GitHub."})
      : row({t:"A sync key is made when you press Next", sub:"Come back to Controls > Lists to copy it. The steps for the iPhone Shortcut and the Mac helper are in docs/list-sync.md on GitHub."});
    if (extra) h += sec("", extra);
    h += nav(["Next", "wizlist"]);
  } else if (st === 4){
    h += '<div class="big">Choose your dashboard</div><p class="intro">Pick a layout and theme for your main screen. You can edit every tile later. Your previous layout is kept in Saved layouts.</p>' + starterGallery(WIZ.starter || (sameEverydayLayout() ? "everyday" : ""), "wiz");
    h += '<div class="saverow"><button data-act="wizback">Back</button>' +
      (sameEverydayLayout() ? '' : '<button data-act="wizkeep">Keep current layout</button>') +
      (WIZ.starter || sameEverydayLayout() ? '<button class="pri" data-act="wiznext">Next</button>' : '') + '</div>';
  } else {
    h += '<div class="big">You\'re all set</div><p class="intro">Open these addresses on your devices. Bookmark them, since they don\'t change.</p>';
    h += sec("", row({t:"On the Echo Show or the kitchen screen", sub:"Open Silk and go to this address, then tap the screen once so it stays full screen.", v:host + "/dash"}) +
      row({t:"On your phone", sub:"Add to the grocery list from anywhere in the house.", v:host + "/list"}) +
      row({t:"Controls (this page)", sub:"Change tiles, themes, effects and pages.", v:host + "/control"}));
    h += sec("", '<div class="row"><div class="t"><small>Keep Countertop on your home network. Anyone who can reach it can change its settings, so don\'t forward its port to the internet.</small></div></div>');
    h += '<div class="saverow"><button data-act="wizback">Back</button><button class="pri" data-act="wizdone">Finish</button></div>';
  }
  return h;
}
async function wizSource(kind, op, item){
  const r = await fetch("/sources", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({kind, op, item})});
  const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.status);
  SRC = j.sources; return j;
}
async function wizAct(a, id){
  if (a === "wizstart"){ WIZ.step = 0; WIZ.kind = ""; WIZ.starter = ""; stack = ["root", "wiz"]; show(); scrollTo(0, 0); return; }
  if (a === "wizback"){ WIZ.step = Math.max(0, WIZ.step - 1); show(); scrollTo(0, 0); return; }
  if (a === "wizkeep"){ WIZ.starter = ""; a = "wiznext"; }
  if (a === "wiznext"){ WIZ.step++; show(); scrollTo(0, 0); return; }
  if (a === "wizkind"){ WIZ.kind = id; show(); return; }
  if (a === "wizskip" || a === "wizdone"){
    if (a === "wizdone" && WIZ.starter) installStarter(WIZ.starter, true);
    mods.general.settings.setupDone = true; save(); stack = ["root"]; show(); scrollTo(0, 0);
    if (a === "wizdone") toast("Setup saved", "ok");
    setTimeout(statusLoad, 1200);
    return;
  }
  if (a === "wizcal"){
    const name = $("wcname").value.trim() || "Calendar", url = $("wcurl").value.trim();
    if (!/^(webcal|https?):\/\//i.test(url)){ toast("Paste the calendar's link: it starts with webcal:// or https://", "bad"); return; }
    try{ await wizSource("calendars", "add", {name, url, color:""}); WIZ.calName = ""; toast("Calendar added", "ok"); show(); pvRefresh(); }
    catch(e){ toast("Didn't save: " + e.message, "bad"); }
    return;
  }
  if (a === "wizlist"){
    const L = firstList(), kind = WIZ.kind || (L && L.kind) || "This dashboard", item = {kind};
    if (kind === "Apple Reminders"){ item.remName = $("wlrem").value.trim(); if (!item.remName){ toast("Type the Reminders list name", "bad"); return; } }
    if (kind === "A web address"){ const u = $("wlurl").value.trim();
      if (u) item.url = u; else if (!(L && L.kind === kind && L.urlSet)){ toast("Paste the list's address first", "bad"); return; } }
    try{
      if (L) await wizSource("lists", "update", Object.assign({id:L.id}, item));
      else await wizSource("lists", "add", Object.assign({name:"Grocery"}, item));
      const N = firstList();
      if (kind === "Sent from another app" && N && N.pushKey && WIZ.shownKey !== N.pushKey){ WIZ.shownKey = N.pushKey; WIZ.kind = kind; show(); toast("Here's your sync key", "ok"); return; }
      WIZ.step++; show(); scrollTo(0, 0); pvRefresh();
    }catch(e){ toast("Didn't save: " + e.message, "bad"); }
    return;
  }
  if (a === "stsafe"){
    const on = !(STATUS && STATUS.sandbox && STATUS.sandbox.safe);
    try{ await fetch("/sandbox/safe", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({on})}); }catch(e){}
    toast(on ? "Community tiles are off" : "Community tiles are back on", "ok");
    await statusLoad();
    return;
  }
  if (a === "streport"){ statusReport(); return; }
  if (a === "stcheck"){ toast("Checking…"); await statusLoad(true); toast(STATUS && STATUS.latest.error ? "Couldn't reach GitHub" : STATUS && STATUS.update ? "A new version is out" : "You're up to date", STATUS && STATUS.latest.error ? "bad" : "ok"); }
}

$("back").addEventListener("click", () => {
  if ((DRAFT && draftDirty()) || fxDirty()){ toast("Save or Cancel your changes first", "bad"); const b = document.querySelector(".draftbar"); if (b) b.scrollIntoView({block:"nearest"}); return; }
  stack.pop(); show();
});

