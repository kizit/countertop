/* ---------- Status: is everything working, is there a new version, and a diagnostics file for bug reports ---------- */
let STATUS = null;
async function statusLoad(check){
  try{ STATUS = await (await fetch("/status" + (check ? "?check=1" : ""), {cache:"no-store"})).json(); }catch(e){ STATUS = null; }
  const cur = stack[stack.length - 1];
  if (!libSub() && (cur === "root" || cur === "status")) show();
}
setInterval(() => { if (!document.hidden) statusLoad(); }, 60e3);
setInterval(() => { if (!document.hidden && document.getElementById("llitems")) llRefresh(); }, 10e3);   // a list's items, while its screen is open
const LVL = {ok:["#4cd27a", "Everything's working"], warn:["#ffc850", "Needs a look"], bad:["#ff6b6b", "Something isn't working"]};
const ISSUES = "https://github.com/kizit/countertop/issues/new?template=bug_report.yml";
function agoText(s){
  if (s == null) return "Not yet";
  if (s < 90) return "Just now";
  if (s < 5400) return Math.round(s / 60) + " min ago";
  if (s < 172800) return Math.round(s / 3600) + " hours ago";
  return Math.round(s / 86400) + " days ago";
}
function statusRows(){       // the root screen: one line, plus a notice when there's a new version
  if (!STATUS) return "";
  const S = STATUS, [col, word] = LVL[S.level] || LVL.ok;
  let h = "";
  if (S.update) h += row({t:"Countertop " + S.latest.tag + " is out", sub:"You have v" + S.version + ". See what's new and how to update.", chev:true, cls:"upd", attrs:'data-go="status"',
    pre:'<span class="dot" style="background:var(--accent)"></span>'});
  h += row({t:"Status", sub: S.problems.length ? S.problems[0] + (S.problems.length > 1 ? " (+" + (S.problems.length - 1) + " more)" : "") : word, v:"v" + S.version, chev:true, attrs:'data-go="status"',
    pre:'<span class="dot" style="background:' + col + '"></span>'});
  return sec("", h);
}
function howToUpdate(where, git){
  if (where === "Mac app") return "In the Countertop menu bar app, choose Install Countertop " + ((STATUS && STATUS.latest.tag) || "") + ". Your settings stay where they are.";
  if (git && where === "Mac") return "In the Countertop menu bar app, choose Install Countertop " + ((STATUS && STATUS.latest.tag) || "") + ", or run git pull in the Countertop folder and restart the server. Your settings stay in the work folder.";
  if (git) return "In the Countertop folder, run git pull, then restart the server. Your settings stay in the work folder.";
  if (where === "Docker") return "Unraid: open the Docker tab, click Check for Updates, then Apply Update. Docker Compose: run docker compose pull, then docker compose up -d. Your settings stay in the data folder.";
  return "Download the new version from GitHub and replace the tools folder, then restart the server. Your settings stay in the work folder.";
}
function statusScreen(){
  const S = STATUS;
  let h = '<div class="big">Status</div>';
  if (!S) return h + '<p class="intro">Checking…</p>';
  const [col, word] = LVL[S.level] || LVL.ok;
  h += sec("", S.problems.length ? S.problems.map(p => row({t:p, pre:'<span class="dot" style="background:' + col + '"></span>'})).join("")
    : row({t:word, pre:'<span class="dot" style="background:' + col + '"></span>'}));
  if (S.update) h += sec("New version", row({t:"Countertop " + S.latest.tag + " is out", sub:"You have v" + S.version}) +
    '<a class="btnrow blue" href="' + esc(S.latest.url) + '" target="_blank" rel="noopener">See what\'s new</a>', howToUpdate(S.server.where, S.server.git));
  const sc = S.screen || {};
  h += sec("Screen", row({t:"Last check-in", v:agoText(sc.seenAgo)}) + row({t:"Weather updated", v:agoText(sc.wxAgo)}) +
    (sc.fullscreen == null ? "" : row({t:"Full screen", v: sc.fullscreen ? "Yes" : "No"})),
    "The screen checks in every minute while /dash is open.");
  if ((S.calendars || []).length) h += sec("Calendars", S.calendars.map(c => row({t:c.name, sub: c.ok === false ? c.error : "",
    v: c.ok === false ? "Not loading" : c.ago == null ? "Not loaded yet" : agoText(c.ago) + (c.count != null ? " · " + c.count + " events" : "")})).join(""));
  if ((S.homeassistant || []).length) h += sec("Home Assistant", S.homeassistant.map(c => row({t:c.name, sub: c.ok === false ? c.error : "",
    v: c.ok === false ? "Not answering" : c.ago == null ? "Not used yet" : agoText(c.ago) + (c.count != null ? " · " + c.count + " entities" : "")})).join(""),
    "Countertop reads Home Assistant only while a Home or Sensor tile is showing.");
  if ((S.recipes || []).length) h += sec("Meal ideas", S.recipes.map(c => row({t:c.name, sub: c.ok === false ? c.error : c.service,
    v: c.ok === false ? "Not loading" : agoText(c.ago)})).join(""), "Countertop asks for new ideas only while a Meal ideas tile is showing.");
  const L = S.list;
  if (L && L.name){ const SRCN = {dashboard:"This dashboard", reminders:"Apple Reminders", pushed:"Sent from another app", url:"A web address"};
    h += sec("List", row({t:L.name, sub:(SRCN[L.source] || L.source) + (L.error ? " · " + L.error : ""), v:L.count + (L.count === 1 ? " item" : " items")})); }
  const X = S.sandbox;    // only once a community tile is installed, or safe mode is on
  if (X){
    const WHY = {froze:"Turned on by itself: the screen stopped answering while " + (X.tiles.join(", ") || "a community tile") + " was showing.",
      reloads:"Turned on by itself: the screen restarted 3 times in 10 minutes with " + (X.tiles.join(", ") || "community tiles") + " on it.",
      person:"Turned on here."};
    h += sec("Community tiles", row({t:"Turn off all community tiles", sub: X.safe ? WHY[X.why] || "" : X.installed + (X.installed === 1 ? " tile installed" : " tiles installed") +
        (X.showing.length ? " · showing now: " + X.showing.join(", ") : ""), post: sw(X.safe, 'data-act="stsafe"')}) +
      (X.takenDown && X.takenDown.length ? row({t:"Taken down from the gallery", sub:X.takenDown.join(", ") + " · off on your screens. Remove them in Library → Community."}) : "") +
      (X.checked ? row({t:"Checked the gallery for take-downs", v:new Date(X.checked * 1000).toLocaleString(undefined, {month:"short", day:"numeric", hour:"numeric", minute:"2-digit"})}) : ""),
      "Safe mode. The screen starts again without community tiles, and their boxes say they're off. A faulty tile can freeze the screen until its browser is restarted; when that happens, this turns on by itself.");
  }
  const B = S.bench;      // only once the /bench test page has saved something
  if (B){ const perf = Object.keys(B.perf || {}).map(n => n + " frame" + (n === "1" ? "" : "s") + ": " + (B.perf[n].fps == null ? "?" : Math.round(B.perf[n].fps)) + " fps").join(" · ");
    const lp = B.loop;
    h += sec("Sandbox test", row({t:"Busy frames", v: perf || "Not run"}) +
      row({t:"Escape checks", v: B.escape ? B.escape.passed + " of " + B.escape.total + " as expected" : "Not run"}) +
      row({t:"Endless loop", sub: lp ? "Longest silence from the page: " + lp.longestSilence + " s" : "", v: !lp ? "Not run" : lp.heartbeatsStopped ? (lp.stillSilent ? "Page stopped" : "Page froze, then recovered") : "Page kept running"}),
      "Measurements from the test page at /bench on the screen. Nothing else is saved.");
  }
  h += sec("Server", row({t:"Version", v:"v" + S.version}) + row({t:"Running on", v:S.server.where}) + row({t:"Running for", v:agoText(S.server.startedAgo).replace(" ago", "").replace("Just now", "A minute")}) +
    row({t:"Time zone", v:S.server.tz}));
  const lt = S.latest || {};
  h += sec("Updates", row({t:"Check GitHub for new versions", post: sw(mods.general.settings.updates !== false, 'data-m="general" data-k="updates" data-t="bool"')}) +
    row({t:"Last checked", sub: lt.error ? "Couldn't reach GitHub: " + lt.error : lt.tag ? "Newest release: " + lt.tag : "", v:agoText(lt.checkedAgo)}) +
    '<button class="btnrow blue" data-act="stcheck">Check now</button>',
    "Countertop asks GitHub for the newest release twice a day. Nothing about you or your setup is sent.");
  h += sec("Report a problem", (ECHO ? row({t:"Download diagnostics", sub:"Open Controls on a computer or phone to download the file."})
      : '<a class="btnrow blue" href="/diagnostics" download>Download diagnostics</a>') +
    '<a class="btnrow blue" href="' + ISSUES + '" target="_blank" rel="noopener">Open a bug report on GitHub</a>',
    "The diagnostics file has your settings, version and recent logs. Calendar and list links, sync keys, your location and network addresses are removed, and list items aren't included. Attach it to the bug report.");
  h += sec("", row({t:"Run the setup guide again", chev:true, attrs:'data-act="wizstart"'}));
  return h;
}

