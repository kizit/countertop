/* ---------- Tile Studio: make your own tiles (Library → Tiles → New tile) ----------
   A tile made here is the same file a community tile is: a few facts (name, size, settings, the data it reads, the
   sites it reads from, its buttons) and its code, saved on the server in mytiles/ (tools/server/mytiles.py). It runs
   in the same sandboxed frame. While you write, every change is sent as a draft (POST /studio/draft) and the preview
   beside the code is the real dashboard showing that draft (/dash/content?solo=<draft>), with made-up data or yours.
   Tiles that came from someone else (a shared layout or file) wait until you let them run.
   Your own tile is retired: the ones that will work here were converted by the server, keeping the original for
   Restore; the rest are listed in Library → Tiles with why, and Convert. */
const STU = {id:"", t:null, base:"", draft:"", err:"", real:false, ask:"", reply:"", fill:null, undo:[], log:[], timer:null, poll:null, size:"usual", notes:[], gen:"", picking:false, pend:null, pendNote:""};
let MINEC = {};          // type → its whole file (for sharing a layout that uses it), from GET /studio/tile/<id>
let LEGACYC = {};        // Your own tiles still on the dashboard: id → {ok, reasons, kept}
const STU_FEEDS = [["wx", "Weather", "this.feed(\"weather\")"], ["aqi", "Air quality", "this.feed(\"air\")"], ["team", "Your teams' games", "this.feed(\"teams\")"],
  ["events", "Your calendars", "this.events()"], ["notes", "Your lists and notes", "this.feed(\"notes\")"], ["photos", "Your photo albums", "this.feed(\"albums\")"],
  ["sales", "Store sales", "this.feed(\"sales\")"]];
const STU_PERSONAL = ["events", "notes", "photos", "sales"];
const STU_TYPES = ["text", "bool", "int", "number", "choice", "list", "color", "source", "secret"];
const STU_KINDS = {calendars:"events", teams:"team", lists:"notes", albums:"photos"};
const STU_START = 'Tile("my-tile", {\n  render(el) {\n    el.innerHTML = \'<div class="big">\' + this.esc(this.s.text) + \'</div>\';\n  },\n' +
  '  css: ".big { display:grid; place-items:center; height:100%; font-size:48px; }"\n});\n';
const STU_GALLERY = "https://github.com/kizit/countertop-gallery/issues/new?template=submit.yml";

const stuMine = () => Object.entries(DEFS).filter(([, d]) => d.mine);
const stuLegacy = () => tileList().filter(t => t.type === "custom" && LEGACYC[t.id]);
function stuBlank(){
  return {name:"My tile", description:"", size:[12, 8, 6, 4], every:0, taps:false, feeds:[], hosts:[], uses:[],
    settings:{text:{type:"text", label:"Text", default:"Hello"}}, devices:null, controls:null, code:STU_START};
}
// the server's list of your tiles again, and each one's whole file (layouts you share carry it)
async function stuSync(){
  try{ const j = await fetch("/config", {cache:"no-store"}).then(r => r.json()); SBXC = j.sandbox || {tiles:{}}; LEGACYC = j.legacy || {}; commDefs(); }catch(e){}
  await stuFiles();
}
async function stuFiles(){
  const want = stuMine().map(([t]) => t);
  for (const k of Object.keys(MINEC)) if (!want.includes(k)) delete MINEC[k];
  await Promise.all(want.filter(t => !MINEC[t] || MINEC[t].version !== DEFS[t].version).map(t =>
    fetch("/studio/tile/" + encodeURIComponent(t), {cache:"no-store"}).then(r => r.ok ? r.json() : null).then(j => { if (j) MINEC[t] = j; }).catch(() => {})));
}

/* ----- the Library's tile list: your tiles first, and Your own tiles waiting to convert ----- */
function stuTilesTop(){
  let h = '<div class="lpanel lstudio"><div class="lrow"><div class="t">Tile Studio<small>Write a tile of your own, or have ChatGPT write it, and see it working as you type. ' +
    'It runs sealed off like a community tile.</small></div><button class="lbtn pri" data-l="s-new">New tile</button>' +
    (ECHO ? "" : '<label class="lbtn">Import a tile<input type="file" accept=".countertop,.json,application/json" data-l="s-file" hidden></label>') + '</div></div>';
  const L = stuLegacy();
  if (L.length) h += '<div class="lpanel"><h3>Your own tiles that stayed as they were</h3>' + L.map(t => {
    const why = (LEGACYC[t.id] || {}).reasons || [];
    return '<div class="lrow"><div class="t">' + esc(t.name || "Your own tile") + '<small>' + (why.length ? esc(why.join("; ")) + ". Converting stops those parts working." :
      (LEGACYC[t.id] || {}).kept ? "You put it back with Restore." : "") + '</small></div><button class="lbtn" data-l="s-convert" data-id="' + esc(t.id) + '">Convert</button></div>';
  }).join("") + '<p class="lnote">Your own tile is now Tile Studio. These keep working as they are. Convert makes each one a tile you can change in Tile Studio, and keeps the original so Restore can put it back.</p></div>';
  return h;
}
// a tile of yours in the Library: open it in the Studio, or put a converted one back
function stuRow(t, d){
  const m = d.mine || {};
  let h = '<div class="lpanel">';
  if (m.review) h += '<div class="lrow"><div class="t">Came from someone else<small>Its code doesn\'t run until you say so. Read it in Tile Studio first.</small></div><button class="lbtn pri" data-l="s-trust" data-id="' + esc(t) + '">Let it run</button></div>';
  h += '<div class="lrow"><div class="t">' + (m.from === "custom" ? "Made from your Your own tile" : m.from === "import" ? "Imported" : "Made in Tile Studio") +
    '<small>Version ' + (d.version || 1) + (m.saved ? " · saved " + new Date(m.saved * 1000).toLocaleDateString(undefined, {month:"short", day:"numeric"}) : "") + '</small></div>' +
    '<button class="lbtn" data-l="s-open" data-id="' + esc(t) + '">Open in Tile Studio</button></div>';
  if (m.backup) h += '<div class="lrow"><div class="t">The original Your own tile is kept<small>' + (m.lan ? "Restore puts it back as it was, with its home-network access." : "Restore puts it back as it was.") +
    '</small></div><button class="lbtn" data-l="s-restore" data-id="' + esc(t) + '">Restore</button></div>';
  return h + '</div>';
}

/* ----- the Studio ----- */
async function stuOpen(id){
  clearTimeout(STU.timer);
  Object.assign(STU, {id:id || "", t:null, draft:"", err:"", log:[], ask:"", reply:"", fill:null, undo:[], size:"usual", notes:[], gen:"", picking:false, pend:null, pendNote:""});
  if (id){
    try{
      const r = await fetch("/studio/tile/" + encodeURIComponent(id), {cache:"no-store"});
      if (!r.ok) throw new Error("not found");
      const j = await r.json();
      STU.t = Object.assign(stuBlank(), {settings:{}, devices:null, controls:null}, j); MINEC[id] = j;
    }catch(e){ toast("Couldn't open that tile", "bad"); return; }
  } else STU.t = stuBlank();
  STU.base = JSON.stringify(stuTile());
  if (libEl().hidden) libOpen("tiles");
  LIB.view = "studio"; LIB.item = STU.id || "new"; libShow(); libEl().querySelector(".lmain").scrollTop = 0;
  stuDraft();
}
const stuDirty = () => !!STU.t && JSON.stringify(stuTile()) !== STU.base;
// what's sent to the server: the form, cleaned up
function stuTile(){
  const t = STU.t, o = {};
  for (const k of ["name", "description", "size", "every", "taps", "feeds", "hosts", "settings", "code", "demo", "demoData", "lang", "author"]) if (t[k] !== undefined && t[k] !== null) o[k] = t[k];
  if (t.devices && Object.keys(t.devices).length){ o.devices = t.devices; o.controls = t.controls || []; }
  const code = String(t.code || "");
  o.uses = ["store", "fetch", "events", "sources", "feed"].filter(u => new RegExp("this\\." + u + "\\b").test(code) || (u === "fetch" && (t.hosts || []).length));
  return o;
}
function stuInput(label, field, v, attrs){ return '<label class="lfield">' + label + '<input data-s="' + field + '" value="' + esc(v == null ? "" : v) + '" ' + (attrs || 'type="text"') + '></label>'; }
function stuCheck(label, field, on, small){
  return '<div class="lrow"><div class="t">' + label + (small ? '<small>' + small + '</small>' : "") + '</div>' + sw(!!on, 'data-s="' + field + '"') + '</div>';
}
function stuView(){
  const t = STU.t; if (!t) return '<div class="lempty">Opening…</div>';
  const m = (STU.id && DEFS[STU.id] && DEFS[STU.id].mine) || {}, sz = t.size || [12, 8, 6, 4];
  const personal = (t.feeds || []).some(f => STU_PERSONAL.includes(f)) || (t.devices && Object.keys(t.devices).length);
  let h = '<button class="lback" data-l="s-back">‹ Tiles</button><div class="lstu">';
  h += '<div class="lstu-l"><h2 class="ltitle">' + (STU.id ? esc(t.name || STU.id) : "New tile") + '</h2>' +
    (m.review ? '<div class="lpick warn"><div><b>Came from someone else</b><small>Read its code before you let it run. The preview here runs it sealed off, with made-up data.</small></div><button class="lbtn" data-l="s-trust" data-id="' + esc(STU.id) + '">Let it run</button></div>' : "") +
    (m.from === "custom" ? '<div class="lpick"><div><b>Made from your Your own tile</b><small>Its old page runs inside the tile. Restore puts the original back.</small></div>' + (m.backup ? '<button class="lbtn" data-l="s-restore" data-id="' + esc(STU.id) + '">Restore</button>' : "") + '</div>' : "");
  // let AI fill the whole form: what to ask, then what it answered
  h += '<div class="lpanel lstu-ai"><h3>Let AI fill it in</h3>' +
    '<label class="lfield">1. What should the tile do?<textarea data-s="ask" rows="3" placeholder="e.g. a traffic light for today\'s air quality, and how long the dogs should stay out, thinking about the weather too">' + esc(STU.ask) + '</textarea></label>' +
    '<div class="lact"><button class="lbtn pri" data-l="s-ai">Copy for chat</button></div>' +
    '<p class="lnote">Paste it into ChatGPT (or another assistant). It sends your words, everything this page can set, and the shape its answer must have.</p>' +
    '<label class="lfield">2. Paste its answer here<textarea data-s="reply" rows="4" spellcheck="false" placeholder="Paste the whole answer">' + esc(STU.reply) + '</textarea></label>' +
    '<div class="lact"><button class="lbtn pri" data-l="s-fill">Fill in the form</button>' + (STU.undo.length ? '<button class="lbtn" data-l="s-unfill">Back</button>' : "") + '</div>' + stuFillHTML() +
    '<p class="lnote">This only fills in the form below. Nothing is saved, and the tile runs sealed off in the preview, until you press Save. Its answer can\'t turn anything on for you: the tile still asks for each thing in its settings, and API keys are never filled in.</p></div>';
  // what it is
  h += '<div class="lpanel"><h3>What it is</h3>' + stuInput("Name", "name", t.name, 'type="text" maxlength="60"') +
    '<label class="lfield">What it shows<textarea data-s="description" maxlength="400" rows="2">' + esc(t.description || "") + '</textarea></label>' +
    '<div class="lsz">' + stuInput("Width", "size.0", sz[0], 'type="number" min="2" max="48"') + stuInput("Height", "size.1", sz[1], 'type="number" min="2" max="32"') +
    stuInput("Smallest width", "size.2", sz[2], 'type="number" min="2" max="48"') + stuInput("Smallest height", "size.3", sz[3], 'type="number" min="2" max="32"') + '</div>' +
    '<p class="lnote">On the 48 × 32 grid: 12 × 8 is a quarter of the screen\'s width and a quarter of its height.</p>' +
    stuInput("Draw again every (seconds, 0 = only when something changes)", "every", t.every || 0, 'type="number" min="0" max="86400"') +
    stuCheck("Responds to taps", "taps", t.taps, "Taps go to the tile's tap(e, el) and submit(e, el, form)") + '</div>';
  // what it reads
  h += '<div class="lpanel"><h3>What it reads</h3>' + STU_FEEDS.map(([k, l, how]) => stuCheck(l, "feed." + k, (t.feeds || []).includes(k), "In the code: " + esc(how) + (STU_PERSONAL.includes(k) ? " · personal" : ""))).join("") +
    '<label class="lfield">Sites it reads (one per line, like api.example.com)<textarea data-s="hosts" rows="2" spellcheck="false"' + (personal ? " disabled" : "") + '>' + esc((t.hosts || []).join("\n")) + '</textarea></label>' +
    '<p class="lnote">' + (personal ? "A tile that sees your calendars, lists, photos, sales or devices can't read any sites: that's how your data stays home." :
      esc("fetch(\"https://…\") and pictures (<img src=\"https://…\">) work for these sites.") + " Countertop reads them for the tile, never anything on your home network.") + '</p></div>';
  // its settings
  h += '<div class="lpanel"><h3>Its settings</h3><p class="lnote">What someone can change in the tile\'s settings on the screen. In the code: this.s.<i>name</i>.</p>' +
    Object.entries(t.settings || {}).map(([k, d]) => stuSettingRow(k, d)).join("") +
    '<div class="lact"><button class="lbtn" data-l="s-addset">Add a setting</button></div></div>';
  // its buttons (a control tile)
  h += '<div class="lpanel"><h3>Buttons for things in your home</h3><p class="lnote">For Home Assistant lights, switches, locks and more. The dashboard draws these buttons below the tile, ' +
    'and they only work the devices someone picks in its settings. The code shows state with this.devices(), but never presses them.</p>' +
    Object.entries(t.devices || {}).map(([k, d]) => '<div class="lrow col lset"><div class="lsz">' + stuInput("Slot", "dev." + k + ".slot", k, 'type="text" maxlength="20"') +
      stuInput("Label", "dev." + k + ".label", d.label || "", 'type="text" maxlength="40"') + stuInput("Kinds (light, switch, lock…)", "dev." + k + ".domains", (d.domains || []).join(", "), 'type="text"') +
      '</div><button class="lbtn red" data-l="s-deldev" data-id="' + esc(k) + '">Remove</button></div>').join("") +
    (t.controls || []).map((c, i) => '<div class="lrow col lset"><div class="lsz">' + stuInput("Button id", "ctl." + i + ".id", c.id, 'type="text" maxlength="20"') +
      stuInput("For slot", "ctl." + i + ".device", c.device, 'type="text"') + stuInput("Does (turn_on, toggle, unlock…)", "ctl." + i + ".action", c.action, 'type="text"') +
      stuInput("With (JSON, optional)", "ctl." + i + ".data", c.data && Object.keys(c.data).length ? JSON.stringify(c.data) : "", 'type="text"') +
      '</div><button class="lbtn red" data-l="s-delctl" data-id="' + i + '">Remove</button></div>').join("") +
    '<div class="lact"><button class="lbtn" data-l="s-adddev">Add a device</button>' + (t.devices && Object.keys(t.devices).length ? '<button class="lbtn" data-l="s-addctl">Add a button</button>' : "") + '</div></div>';
  // the code
  h += '<div class="lpanel"><h3>Code</h3><textarea class="code" data-s="code" rows="18" spellcheck="false" autocapitalize="off">' + esc(t.code || "") + '</textarea>' +
    '<p class="lnote">Tile("…", { render(el){ … } }) with the same helpers as the built-in tiles: this.s, this.esc, this.store, this.fetch, this.feed, this.events. The full guide is docs/tile-api.md in the Countertop repository.</p></div>';
  h += '</div>';
  // the preview, and what to do with it
  h += '<div class="lstu-r"><div class="lstu-pv"><div class="lchips">' + [["usual", "Usual size"], ["small", "Smallest"], ["big", "Large"]].map(([k, l]) =>
      '<button class="lchip' + (STU.size === k ? " on" : "") + '" data-l="s-size" data-id="' + k + '">' + l + '</button>').join("") +
    '<button class="lchip' + (STU.real ? " on" : "") + '" data-l="s-real">' + (STU.real ? "Your data" : "Made-up data") + '</button></div>' +
    '<p class="lnote lstu-sz">' + esc(stuSizeNote()) + '</p>' +
    '<div class="tp big lstu-shot' + (STU.picking ? " pick" : "") + '">' + (STU.draft ? '<iframe title="Preview" data-w="' + stuPvSize()[0] + '" data-h="' + stuPvSize()[1] + '" src="' + esc(stuPvSrc()) + '"></iframe>' : "") + '</div>' +
    '<div class="lstu-log">' + stuLogHTML() + '</div><div class="lstu-pk">' + stuPickHTML() + '</div></div>' +
    '<div class="lact"><button class="lbtn pri" data-l="s-save">' + (STU.id ? "Save" : "Save to my tiles") + '</button>' +
    (STU.id && !stuDirty() ? '<button class="lbtn" data-l="addtile" data-id="' + esc(STU.id) + '">Add to ' + esc(libAddName()) + '</button>' : "") + '</div>' +
    (STU.id ? '<div class="lact"><button class="lbtn" data-l="s-share">Download file</button><button class="lbtn" data-l="s-copy">Copy as text</button>' +
      '<button class="lbtn" data-l="s-submit">Submit to the gallery</button></div><div class="lact"><button class="lbtn red" data-l="s-del">Delete</button></div>' :
      '<p class="lnote">Save it to add it to a page, share it or submit it to the community gallery.</p>') +
    '<p class="lnote">Taps and saved data don\'t work in the preview: it never changes anything. They work once it\'s on a page.</p></div></div>';
  return h;
}
function stuSettingRow(k, d){
  const f = x => "set." + k + "." + x, type = d.type || "text";
  let h = '<div class="lrow col lset"><div class="lsz">' + stuInput("Name", f("key"), k, 'type="text" maxlength="30"') +
    '<label class="lfield">Kind<select data-s="' + f("type") + '">' + STU_TYPES.map(x => '<option' + (x === type ? " selected" : "") + '>' + x + '</option>').join("") + '</select></label>' +
    stuInput("Label", f("label"), d.label || "", 'type="text" maxlength="80"') + '</div><div class="lsz">';
  if (type === "secret") h += stuInput("Sent only to (one of its sites)", f("host"), d.host || "") + stuInput("In the header", f("header"), d.header || "") +
    stuInput("After (like Bearer )", f("prefix"), d.prefix || "") + stuInput("Or in the address as", f("query"), d.query || "");
  else if (type === "source") h += '<label class="lfield">Picks one of your<select data-s="' + f("kind") + '">' + Object.keys(STU_KINDS).map(x => '<option' + (x === d.kind ? " selected" : "") + '>' + x + '</option>').join("") + '</select></label>';
  else if (type === "bool") h += '<label class="lfield">Starts<select data-s="' + f("default") + '"><option value="false">Off</option><option value="true"' + (d.default === true ? " selected" : "") + '>On</option></select></label>';
  else h += stuInput("Starts as", f("default"), Array.isArray(d.default) ? d.default.join(", ") : d.default == null ? "" : d.default);
  if (type === "choice") h += stuInput("Choices (commas between)", f("choices"), (d.choices || []).join(", "));
  if (type === "int" || type === "number") h += stuInput("Lowest", f("min"), d.min == null ? "" : d.min, 'type="number"') + stuInput("Highest", f("max"), d.max == null ? "" : d.max, 'type="number"');
  return h + '</div><button class="lbtn red" data-l="s-delset" data-id="' + esc(k) + '">Remove</button></div>';
}
function stuPvSize(){
  const sz = STU.t.size || [12, 8, 6, 4];
  return STU.size === "small" ? [sz[2] || sz[0], sz[3] || sz[1]] : STU.size === "big" ? [Math.min(48, sz[0] * 2), Math.min(32, sz[1] * 2)] : [sz[0], sz[1]];
}
const stuPvSrc = () => "/dash/content?preview=1&solo=" + STU.draft + "&draft=" + STU.draft + "&w=" + stuPvSize()[0] + "&h=" + stuPvSize()[1] + (STU.real ? "&real=1" : "");
function stuLogHTML(){
  const L = (STU.err ? [{kind:"error", text:STU.err, n:1}] : []).concat(STU.log);
  if (!L.length) return '<p class="lnote ok">' + (STU.draft ? "No problems so far." : "Starting the preview…") + '</p>';
  return L.slice(-8).map(x => '<div class="lstu-err ' + x.kind + '">' + esc(x.text) + (x.n > 1 ? " ×" + x.n : "") + '</div>').join("");
}
// a change: show it in the preview a moment later (one draft at a time)
function stuChanged(redraw){
  clearTimeout(STU.timer);
  STU.timer = setTimeout(stuDraft, 700);
  if (redraw){ const sc = libEl().querySelector(".lmain").scrollTop; libShow(); libEl().querySelector(".lmain").scrollTop = sc; }
}
function stuWhy(e){
  const s = String(e && e.message || e || "").trim();
  return /^(isn't|has |needs )/.test(s) ? "it " + s : s;
}
async function stuDraft(){
  if (LIB.view !== "studio" || !STU.t) return;
  try{
    const r = await fetch("/studio/draft", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({tile:stuTile(), of:STU.id})});
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || r.status);
    STU.draft = j.id; STU.err = ""; STU.log = [];
  }catch(e){ STU.err = "Can't run it yet: " + stuWhy(e); }
  stuPreview();
}
function stuPreview(){
  const box = libEl().querySelector(".lstu-shot"), log = libEl().querySelector(".lstu-log");
  if (log) log.innerHTML = stuLogHTML();
  if (!box || !STU.draft) return;
  const [w, h] = stuPvSize();
  box.innerHTML = '<iframe title="Preview" data-w="' + w + '" data-h="' + h + '" src="' + esc(stuPvSrc()) + '"></iframe>';
  libFitShots();
  box.classList.toggle("pick", STU.picking);
  const sn = libEl().querySelector(".lstu-sz"); if (sn) sn.textContent = stuSizeNote();
  // the same tile at its smallest size, drawn out of sight, so a squeeze shows up while looking at another size
  const old = libEl().querySelector(".lstu-chk"); if (old) old.remove();
  const sz = STU.t.size || [12, 8, 6, 4], sm = [sz[2] || sz[0], sz[3] || sz[1]];
  if (STU.size !== "small" && (sm[0] !== w || sm[1] !== h)){
    const c = document.createElement("div"); c.className = "lstu-chk"; c.setAttribute("aria-hidden", "true");
    c.innerHTML = '<iframe tabindex="-1" title="Size check" src="/dash/content?preview=1&solo=' + STU.draft + '&draft=' + STU.draft + '&w=' + sm[0] + '&h=' + sm[1] + '"></iframe>';
    libEl().querySelector(".lstu-pv").appendChild(c);
  }
  clearInterval(STU.poll);
  // what went wrong inside: the preview is this server's own dashboard page, so its list can be read directly
  STU.poll = setInterval(() => {
    if (LIB.view !== "studio"){ clearInterval(STU.poll); return; }
    const f = libEl().querySelector(".lstu-shot iframe");
    try{
      stuPickSync(f);
      let L = f.contentWindow.dashSbxLog("demo");
      const at = STU_SIZES[STU.size], hid = libEl().querySelector(".lstu-chk iframe");
      L = L.map(x => x.kind === "fit" ? Object.assign({}, x, {text:"At " + at + ": " + x.text}) : x);
      if (hid) try{ L = L.concat(hid.contentWindow.dashSbxLog("demo").filter(x => x.kind === "fit").map(x => Object.assign({}, x, {text:"At " + STU_SIZES.small + ": " + x.text}))); }catch(e){}
      if (JSON.stringify(L) !== JSON.stringify(STU.log)){ STU.log = L.slice(); const lg = libEl().querySelector(".lstu-log"); if (lg) lg.innerHTML = stuLogHTML(); }
    }catch(e){}
  }, 1000);
}
// a form field changed
function stuSet(field, value, el){
  const t = STU.t, p = field.split(".");
  let redraw = false;
  if (field === "ask"){ STU.ask = value; return; }
  if (field === "reply"){ STU.reply = value; return; }
  if (field === "gen"){ STU.gen = value.slice(0, 600); return; }
  if (field === "pend"){ STU.pendNote = value.slice(0, 400); return; }
  if (p[0] === "note"){ if (STU.notes[+p[1]]) STU.notes[+p[1]].note = value.slice(0, 400); return; }
  if (p[0] === "size"){ t.size = (t.size || [12, 8, 6, 4]).slice(); t.size[+p[1]] = Math.max(2, Math.min(+p[1] % 2 ? 32 : 48, Math.round(+value) || 2)); }
  else if (p[0] === "feed"){
    const F = new Set(t.feeds || []); if (el.classList.contains("on")) F.add(p[1]); else F.delete(p[1]);
    t.feeds = STU_FEEDS.map(x => x[0]).filter(x => F.has(x));
    if (t.feeds.some(f => STU_PERSONAL.includes(f))) t.hosts = [];
    redraw = true;
  }
  else if (field === "taps") t.taps = el.classList.contains("on");
  else if (field === "every") t.every = Math.max(0, Math.round(+value) || 0);
  else if (field === "hosts") t.hosts = value.split(/[\s,]+/).map(x => x.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean);
  else if (p[0] === "set"){
    const k = p[1], d = Object.assign({}, t.settings[k]), what = p[2];
    if (what === "key"){
      const nk = value.trim().replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1").slice(0, 30);
      if (!nk || nk === k || t.settings[nk]){ if (el) el.value = k; return; }
      const S = {}; for (const [a, b] of Object.entries(t.settings)) S[a === k ? nk : a] = b; t.settings = S; redraw = true;
    } else {
      if (what === "type"){ d.type = value; delete d.default; for (const x of ["host", "header", "prefix", "query", "kind", "choices", "min", "max"]) delete d[x];
        if (value === "secret"){ d.host = (t.hosts || [])[0] || ""; d.header = "X-Api-Key"; } if (value === "source") d.kind = "calendars"; if (value === "choice") d.choices = ["One", "Two"]; redraw = true; }
      else if (what === "default") d.default = d.type === "bool" ? value === "true" : d.type === "int" || d.type === "number" ? (value === "" ? 0 : +value) : d.type === "list" ? value.split(",").map(x => x.trim()).filter(Boolean) : value;
      else if (what === "choices") d.choices = value.split(",").map(x => x.trim()).filter(Boolean);
      else if (what === "min" || what === "max"){ if (value === "") delete d[what]; else d[what] = +value; }
      else if (["header", "prefix", "query"].includes(what)){
        const row = el && el.closest(".lset");
        if (value === "") delete d[what]; else d[what] = value;
        if (what === "query" && value){ delete d.header; delete d.prefix; if (row){ for (const x of ["header", "prefix"]){ const inp = row.querySelector('[data-s="set.' + k + '.' + x + '"]'); if (inp) inp.value = ""; } } }
        if (what === "header" && value){ delete d.query; if (row){ const inp = row.querySelector('[data-s="set.' + k + '.query"]'); if (inp) inp.value = ""; } }
      }
      else d[what] = value;
      t.settings[k] = d;
    }
  }
  else if (p[0] === "dev"){
    const k = p[1], d = Object.assign({}, t.devices[k]);
    if (p[2] === "slot"){
      const nk = value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 20);
      if (!nk || nk === k || t.devices[nk]){ if (el) el.value = k; return; }
      const D = {}; for (const [a, b] of Object.entries(t.devices)) D[a === k ? nk : a] = b; t.devices = D; (t.controls || []).forEach(c => { if (c.device === k) c.device = nk; }); redraw = true;
    }
    else { d[p[2]] = p[2] === "domains" ? value.split(/[\s,]+/).filter(Boolean) : value; t.devices[k] = d; }
  }
  else if (p[0] === "ctl"){
    const c = t.controls[+p[1]]; if (!c) return;
    if (p[2] === "data"){
      try{ c.data = value.trim() ? JSON.parse(value) : {}; STU.err = ""; }
      catch(e){ STU.err = "That button's “With” isn't JSON, like {\"brightness_pct\": 30}"; const lg = libEl().querySelector(".lstu-log"); if (lg) lg.innerHTML = stuLogHTML(); return; }
    }
    else c[p[2]] = value.trim();
  }
  else t[field] = value;
  stuChanged(redraw);
}
async function stuSave(){
  if (!String(STU.t.code || "").includes("Tile(")){ toast("The code needs Tile(\"…\", { render(el){ … } })", "bad"); return; }
  try{
    const r = await fetch("/studio/save", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({id:STU.id, tile:stuTile()})});
    const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.status);
    STU.id = j.id; STU.base = JSON.stringify(stuTile()); LIB.item = j.id;
    await stuSync();
    toast("Saved " + (STU.t.name || "your tile") + (j.version > 1 ? " (version " + j.version + ")" : ""), "ok");
    libShow(); stuDraft();
  }catch(e){ toast("Didn't save: " + stuWhy(e), "bad"); }
}
// the file someone else can import, or the gallery can take: without anything that's only about this Countertop
function stuPublic(){
  const t = Object.assign({}, MINEC[STU.id] || {}, stuTile());
  const id = (STU.id || "my-tile").replace(/^my-/, "");
  const o = {countertop:"tile", id, version:(MINEC[STU.id] || {}).version || 1};
  for (const k of ["name", "description", "author", "size", "uses", "feeds", "hosts", "taps", "every", "settings", "devices", "controls", "demo", "demoData", "lang"]) if (t[k] !== undefined && t[k] !== null) o[k] = t[k];
  o.code = String(t.code || "").replace(/\bTile\(\s*(["'])[^"'\n]{0,80}\1/, 'Tile("' + id + '"');
  return o;
}
function stuDownload(){
  const o = stuPublic(), a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(o, null, 1)], {type:"application/json"}));
  a.download = o.id + ".countertop";
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function stuCopyText(txt, msg){
  try{ await navigator.clipboard.writeText(txt); }
  catch(e){ const ta = document.createElement("textarea"); ta.value = txt; document.body.appendChild(ta); ta.select(); try{ document.execCommand("copy"); }catch(e2){} ta.remove(); }
  toast(msg, "ok");
}
// Submit: the gallery's form, filled in when the tile fits in an address; otherwise its text is copied to paste there
function stuSubmit(){
  if (stuDirty()){ toast("Save it first, then submit it", "bad"); return; }
  const o = stuPublic(), txt = JSON.stringify(o, null, 1);
  let url = STU_GALLERY + "&title=" + encodeURIComponent("Submit: " + (o.name || o.id));
  if (txt.length < 6000) url += "&code=" + encodeURIComponent(txt);
  else stuCopyText(txt, "Copied the tile. Paste it into the form's Share code box.");
  window.open(url, "_blank", "noopener");
}
// what Home Assistant things a tile's buttons can work (the same list the server checks against)
const STU_HA = {light:["toggle", "turn_on", "turn_off"], switch:["toggle", "turn_on", "turn_off"], fan:["toggle", "turn_on", "turn_off", "set_percentage"],
  input_boolean:["toggle", "turn_on", "turn_off"], scene:["turn_on"], script:["turn_on"], climate:["toggle", "turn_on", "turn_off", "set_temperature", "set_hvac_mode"],
  water_heater:["toggle", "turn_on", "turn_off", "set_temperature", "set_away_mode", "set_operation_mode"], cover:["toggle", "open_cover", "close_cover", "stop_cover", "set_cover_position"],
  lock:["lock", "unlock", "open"], media_player:["toggle", "media_play_pause", "media_play", "media_pause", "media_stop", "media_next_track", "media_previous_track", "volume_set", "volume_up", "volume_down"],
  vacuum:["start", "pause", "stop", "return_to_base", "toggle"], alarm_control_panel:["disarm", "arm_home", "arm_away", "arm_night", "arm_vacation"], number:["set_value"], input_number:["set_value"]};
const STU_HA_DATA = ["temperature", "hvac_mode", "operation_mode", "away_mode", "brightness_pct", "brightness", "percentage", "position", "volume_level", "value", "option"];
const STU_FEED_NAMES = {wx:"wx", weather:"wx", forecast:"wx", aqi:"aqi", air:"aqi", airquality:"aqi", events:"events", calendar:"events", calendars:"events", notes:"notes", lists:"notes",
  team:"team", teams:"team", photos:"photos", albums:"photos", sales:"sales"};
const STU_TYPE_NAMES = {string:"text", boolean:"bool", toggle:"bool", integer:"int", float:"number", select:"choice", enum:"choice", dropdown:"choice", array:"list"};
const STU_FIELDS = ["name", "description", "size", "every", "taps", "feeds", "hosts", "settings", "devices", "controls", "code"];

/* ----- change it: point at parts of the preview and say what to change ----- */
const STU_MAX_NOTES = 8;
const STU_PHRASES = ["Bigger", "Smaller", "Move up", "Move down", "Move left", "Move right", "Different color", "Remove it",
  "Bigger text", "Fewer things", "More detail", "Side by side", "Stacked", "Calmer colors", "Bolder colors"];
const STU_PHRASES_PART = [0, 1, 2, 3, 4, 5, 6, 7], STU_PHRASES_ALL = [8, 9, 10, 11, 12, 13, 14];
// a part of the tile in words the chat can follow
function stuPartName(p){
  if (p.root) return "the whole tile";
  if (p.text) return 'the text "' + p.text + '"';
  if (p.tag === "img") return "the picture";
  if (p.tag === "svg" || p.tag === "canvas") return "the drawing";
  return "the " + p.tag + (p.cls[0] ? " with class " + p.cls[0] : "");
}
function stuPartWhere(p){
  const b = p.box, x = Math.round(b[0]), y = Math.round(b[1]);
  return (p.path.length ? p.path.join(" > ") + ", " : "") + (p.fs ? Math.round(p.fs) + "px text, " : "") + "about " + Math.round(b[2]) + "% wide and " + Math.round(b[3]) + "% high, " +
    x + "% from the left and " + y + "% from the top of the tile";
}
function stuChangesText(){
  const sz = STU.t.size || [12, 8], px = sz[0] * 40 + "x" + sz[1] * 34;
  let out = "Make these changes and keep everything else the same. The tile is shown about " + px + " pixels. Parts are named the way the tile's own code draws them, so find them in its code; if you can't find one, say so in one short line above the code block.\n";
  STU.notes.forEach((n, i) => { out += (i + 1) + ". " + stuPartName(n) + " (" + stuPartWhere(n) + "): " + n.note + "\n"; });
  if (STU.gen.trim()) out += (STU.notes.length ? "Overall: " : "") + STU.gen.trim() + "\n";
  out += "Send the whole tile again (the settings, then the code), not just what changed. Keep the setting names, the data it reads and the sites it reads unless I asked for something different. A screenshot of the tile may be attached.";
  return out;
}
function stuPhraseChips(list, k){ return '<div class="lchips">' + list.map(i => '<button class="lchip" data-l="s-phrase" data-id="' + i + '"' + (k ? ' data-k="' + k + '"' : "") + '>' + STU_PHRASES[i] + '</button>').join("") + '</div>'; }
function stuPickHTML(){
  const t = STU.t;
  if (!t || !t.code) return '<div class="lpanel"><h3>Change it</h3><p class="lnote">Once the tile has code, you can point at parts of it here and say what to change.</p></div>';
  let h = '<div class="lpanel"><h3>Change it</h3><p class="lnote">Point at a part of the preview and say what to change, then copy a request for your chat. ' +
    (STU.real ? "With your own data showing, the request says where each part is but never what it says." : "") + '</p>';
  h += '<div class="lact"><button class="lbtn' + (STU.picking ? " pri" : "") + '" data-l="s-pick"' + (STU.notes.length >= STU_MAX_NOTES && !STU.picking ? " disabled" : "") + '>' + (STU.picking ? "Tap a part of the tile (cancel)" : "Point at something") + '</button></div>';
  if (STU.pend){
    h += '<div class="lpick"><div><b>What should change at ' + esc(stuPartName(STU.pend)) + '?</b></div></div>' +
      '<label class="lfield"><textarea data-s="pend" rows="2" maxlength="400" placeholder="e.g. make it bigger">' + esc(STU.pendNote) + '</textarea></label>' + stuPhraseChips(STU_PHRASES_PART) +
      '<div class="lact"><button class="lbtn pri" data-l="s-pickadd">Add note</button><button class="lbtn" data-l="s-pickno">Cancel</button></div>';
  }
  STU.notes.forEach((n, i) => { h += '<div class="lstu-n"><b>' + (i + 1) + '</b><span class="lnote">' + esc(stuPartName(n)) + '</span><input data-s="note.' + i + '" type="text" maxlength="400" value="' + esc(n.note) + '">' +
    '<button class="lbtn red" data-l="s-pickdel" data-id="' + i + '">Remove</button></div>'; });
  h += '<label class="lfield">Anything about the whole tile?<textarea data-s="gen" rows="2" maxlength="600" placeholder="e.g. put the light on the left, calmer colors">' + esc(STU.gen) + '</textarea></label>' + stuPhraseChips(STU_PHRASES_ALL, "gen");
  h += '<div class="lact"><button class="lbtn pri" data-l="s-ai2">Copy change request</button></div>' +
    '<p class="lnote">Paste its answer in box 2 at the top and press Fill in the form. Back undoes the last 5 fills.</p></div>';
  return h;
}
function stuPickCfg(){
  const pins = STU.notes.map((n, i) => ({n:i + 1, sel:n.sel}));
  return {on:STU.picking, text:!STU.real, pins, key:JSON.stringify([STU.picking, !STU.real, pins]), cb:stuPicked};
}
// tell the preview page what to do (only changes are sent)
function stuPickSync(f){
  f = f || libEl().querySelector(".lstu-shot iframe"); if (!f) return;
  const c = stuPickCfg();
  try{ if (f.contentWindow.dashSbxPickKey !== c.key && typeof f.contentWindow.dashSbxPick === "function") f.contentWindow.dashSbxPick(c); }catch(e){}
}
function stuPickRefresh(){
  const box = libEl().querySelector(".lstu-pk"); if (box) box.innerHTML = stuPickHTML();
  const shot = libEl().querySelector(".lstu-shot"); if (shot) shot.classList.toggle("pick", STU.picking);
  stuPickSync();
}
// the part that was tapped (already cut down to plain facts by the preview page)
function stuPicked(p){
  if (!STU.picking) return;
  STU.pend = {sel:p.sel, tag:p.tag, cls:p.cls, path:p.path, box:p.box, root:p.root, fs:p.fs, text:p.text}; STU.pendNote = ""; STU.picking = false;
  stuPickRefresh();
}

// the message to paste into a chat: what the person wants, every lever on this page, and the shape the answer must have
// what the preview's size check found, as the plain lines it shows (made-up data only: with real data the words are left out)
const stuFits = () => STU.log.filter(x => x.kind === "fit").map(x => x.text);
const stuSmall = () => { const sz = (STU.t && STU.t.size) || [12, 8, 6, 4], r = libTileRect(sz[2] || sz[0], sz[3] || sz[1]); return Math.round(r.w) + "x" + Math.round(r.h); };
const STU_SIZES = {usual:"Usual size", small:"Smallest", big:"Large"};
function stuSizeNote(){ const [w, h] = stuPvSize(), r = libTileRect(w, h); return STU_SIZES[STU.size] + ": " + w + " × " + h + " squares, about " + Math.round(r.w) + " × " + Math.round(r.h) + " pixels on a 1920 × 1080 screen"; }
function stuAI(change){
  const t = STU.t, cur = stuTile(), has = change || !!STU.id || stuDirty();
  const want = change ? t.description || t.name || "(a tile)" : STU.ask.trim() || t.description || "(describe it here)";
  return (change ? "Please change a tile on my Countertop home dashboard (a wall-mounted touch screen, about 1920x1080, seen from across the room). " : "Please design a tile for my Countertop home dashboard (a wall-mounted touch screen, about 1920x1080, seen from across the room). ") +
    "Everything you need is below: don't search the web or look anything up, and don't copy from any repository.\n\n" +
    (change ? "What the tile does:\n" + want + "\n\n" + stuChangesText() + "\n\n" : "What the tile should do:\n" + want + "\n\n") +
    (has && stuFits().length ? "The preview found these problems with the tile as it is now. Fix them too:\n" + stuFits().map(x => "- " + x).join("\n") + "\n\n" : "") +
    (has ? (change ? "Here is the tile as it is now (its settings, then its code):\n```json\n" : "It starts from this tile, change it to fit what I asked:\n```json\n") + JSON.stringify(Object.assign({}, cur, {uses:undefined}), null, 1) + "\n```\n\n" : "") +
    "Reply with ONE code block and nothing else, so I can copy it with one tap: the settings as a JSON object, then a line with -----CODE----- on it, then the tile's code. Like this:\n\n" +
    "```\n" +
    '{\n "name": "Short name",\n "description": "One sentence on what it shows",\n "size": [12, 8, 6, 4],\n "every": 0,\n "taps": false,\n "feeds": [],\n "hosts": [],\n' +
    ' "settings": {"unit": {"type": "choice", "label": "Unit", "choices": ["F", "C"], "default": "F"}}\n}\n-----CODE-----\n' +
    "Tile(\"my-tile\", {\n  render(el) { /* draw the tile into el */ },\n  css: \"/* optional styles */\"\n});\n```\n\n" +
    "The JSON can set only these (leave out any that don't apply):\n" +
    "- name: up to 60 characters. description: what it shows, up to 400 characters.\n" +
    "- size: [width, height, smallest width, smallest height] on a 48 x 32 grid. 12 x 8 is a quarter of the screen's width and height. Widths 2 to 48, heights 2 to 32.\n" +
    "- every: draw again every this many seconds (0 = only when something changes).\n" +
    "- taps: true if the tile responds to taps, which call tap(e, el) in the code.\n" +
    "- feeds: the data the tile reads. Use exactly these names in the json (the first word in quotes) and exactly these calls in the code: " + STU_FEEDS.map(([k, l, how]) => '"' + k + '" (' + l + ", read in the code with " + how + (STU_PERSONAL.includes(k) ? ", personal" : "") + ")").join("; ") + ". " +
    "Only turn on what the tile needs, and a tile can only read a feed it lists here. Each returns what it has now, null at first, and the tile is drawn again when it arrives.\n" +
    "- What the data looks like: this.feed(\"weather\") is {current:{temperature_2m, weather_code, is_day}, hourly:{time:[local ISO times], temperature_2m:[], precipitation_probability:[], weather_code:[], is_day:[]}, daily:{time:[], temperature_2m_max:[], temperature_2m_min:[], weather_code:[], sunrise:[], sunset:[], precipitation_probability_max:[]}, current_units:{temperature_2m}} with 11 days of daily data, in the dashboard's unit (°F unless Celsius is chosen in Setup, see current_units), weather_code is the WMO code. this.feed(\"air\") is just a number, the US air quality index (0 to 500), or null.\n" +
    "- hosts: public web sites it reads, like \"api.example.com\" (names only, no addresses). In the code this.fetch(\"https://...\") returns the parsed JSON (or text) it has now, null until it arrives, and the tile is drawn again when it does; this.fetchError(url) says what went wrong. Plain fetch() and <img src=\"https://...\"> also work for those sites. A tile that reads personal data (the personal feeds above, or devices) can't read any sites, so leave hosts empty then. No API keys in the code.\n" +
    "- settings: what someone can change in the tile's settings, each {type, label, default}, read in the code as this.s.<name>. Types: " + STU_TYPES.filter(x => x !== "secret").join(", ") + ". A choice has choices, an int or number can have min and max, a list's default is an array of text, a source has kind (" + Object.keys(STU_KINDS).join(", ") + ") and needs the matching feed. Don't use secret.\n" +
    "- devices and controls (only for buttons that work Home Assistant things; skip otherwise): devices is {slot: {label, domains}} with slot a short lower-case name, and controls is a list of {id, device, action, data} with data optional. Kinds and what each can do: " +
    Object.entries(STU_HA).map(([k, v]) => k + " (" + v.join(", ") + ")").join("; ") + ". Data keys allowed: " + STU_HA_DATA.join(", ") + ". The dashboard draws the buttons and the person picks the real devices; the code only shows state with this.devices() and never presses anything.\n\n" +
    "Rules for the code:\n" +
    "- render(el) is called to draw the tile, again after data arrives and again when settings change. Build the HTML in el each time (escape text with this.esc(text)). It must never loop forever or block.\n" +
    "- The box can be from about " + ((t.size || [])[2] || 6) * 40 + "x" + ((t.size || [])[3] || 4) * 34 + " up to 1200x800 pixels: use flexbox or grid and percentages, keep everything inside with no scrolling.\n" +
    "- The smallest size matters most: at the smallest size (about " + stuSmall() + " pixels) show only the main thing and hide the secondary lines, deciding by el.clientWidth and el.clientHeight in render(). At every size nothing may overlap or run past the edge of the box: size fonts and pictures to the box (percentages, or clamp()), not fixed pixel sizes.\n" +
    "- Keep the background transparent. CSS variables: var(--fg) main text, var(--dim) secondary text, var(--accent) highlight. No text under 18px; the main number or words 40px or bigger.\n" +
    "- To remember things between visits: this.store.get() (an object), this.store.set(key, value), this.store.push(key, item).\n" +
    "- No cookies, localStorage, pop-ups, frames or other pages. Nobody uses a mouse or keyboard on it.\n" +
    "- If data can't be loaded, show a short friendly message instead of an error.";
}

// pull the answer apart: the settings object and the code. Fences with or without a language, labels pasted in their
// place, or none at all: the JSON is found by reading it, and the code by its Tile( call.
function stuObjectAt(text, i){
  let depth = 0, inStr = false;
  for (let k = i; k < text.length; k++){
    const c = text[k];
    if (inStr){ if (c === "\\") k++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return k + 1;
  }
  return -1;
}
function stuReadReply(text){
  text = String(text || "");
  let obj = null, span = [0, 0], tries = 0;
  for (let i = text.indexOf("{"); i >= 0 && !obj && tries < 60; i = text.indexOf("{", i + 1)){
    if (!/^\{\s*"/.test(text.slice(i, i + 40))) continue;
    tries++;
    const e = stuObjectAt(text, i); if (e < 0) continue;
    try{
      const j = JSON.parse(text.slice(i, e));
      if (j && typeof j === "object" && !Array.isArray(j) && STU_FIELDS.some(k => k in j)){ obj = j; span = [i, e]; }
    }catch(e2){}
  }
  let code = obj && typeof obj.code === "string" && obj.code.includes("Tile(") ? obj.code.replace(/^\s*```\w*\s*|\s*```\s*$/g, "").trim() : "";
  if (!code){
    for (let i = text.indexOf("Tile("); i >= 0; i = text.indexOf("Tile(", i + 1)){
      if (i >= span[0] && i < span[1]) continue;
      let c = text.slice(i); const f = c.indexOf("```"); if (f >= 0) c = c.slice(0, f);
      const end = c.lastIndexOf("});"); if (end >= 0) c = c.slice(0, end + 3);
      code = c.trim(); break;
    }
  }
  return {obj, code};
}
// the reply checked and cut down to what the form takes, the way typing each value would: {t, did, skip} or {error}
function stuParse(text, base){
  const {obj, code} = stuReadReply(text), J = Object.assign({}, obj || {});
  // the same thing said another way: a size as "12x8", names for data, settings as a list, other words for a kind
  if (typeof J.size === "string") J.size = (J.size.match(/\d+/g) || []).map(Number);
  if (J.size && !Array.isArray(J.size) && typeof J.size === "object") J.size = [J.size.width || J.size.w, J.size.height || J.size.h, J.size.minWidth || J.size.minW, J.size.minHeight || J.size.minH];
  if (typeof J.feeds === "string") J.feeds = J.feeds.split(/[\s,]+/).filter(Boolean);
  if (Array.isArray(J.feeds)) J.feeds = J.feeds.map(f => STU_FEED_NAMES[String(f).toLowerCase().replace(/[^a-z]/g, "")] || f);
  if (Array.isArray(J.settings)) J.settings = Object.fromEntries(J.settings.filter(d => d && typeof d === "object").map((d, i) => [d.key || d.name || d.id || "setting" + (i + 1), d]));
  if (J.settings && typeof J.settings === "object") J.settings = Object.fromEntries(Object.entries(J.settings).map(([k, d]) => {
    if (!d || typeof d !== "object") return [k, d];
    d = Object.assign({}, d); d.type = STU_TYPE_NAMES[String(d.type || "").toLowerCase()] || d.type;
    if (!d.choices && Array.isArray(d.options)) d.choices = d.options;
    if (d.default === undefined && d.value !== undefined) d.default = d.value;
    return [k, d];
  }));
  const t = JSON.parse(JSON.stringify(base)), did = [], skip = [];
  const str = (v, n) => typeof v === "string" ? v.trim().slice(0, n) : "";
  const num = (v, lo, hi) => Number.isFinite(+v) && v !== null && v !== "" ? Math.max(lo, Math.min(hi, Math.round(+v))) : null;
  for (const k of Object.keys(J)) if (!STU_FIELDS.includes(k) && !["countertop", "id", "version", "author", "uses"].includes(k)) skip.push(k + " (nothing on this page)");
  if (str(J.name, 60)){ t.name = str(J.name, 60); did.push("name"); }
  if (typeof J.description === "string"){ t.description = str(J.description, 400); did.push("what it shows"); }
  if (Array.isArray(J.size) && J.size.length >= 2){
    const w = num(J.size[0], 2, 48), h = num(J.size[1], 2, 32);
    if (w && h){
      const mw = num(J.size[2], 2, 48) || Math.min(w, 6), mh = num(J.size[3], 2, 32) || Math.min(h, 4);
      t.size = [w, h, Math.min(mw, w), Math.min(mh, h)]; did.push("size " + w + " × " + h);
    } else skip.push("size");
  } else if (J.size !== undefined) skip.push("size");
  if (J.every !== undefined){ const n = num(J.every, 0, 86400); if (n === null) skip.push("draw again"); else { t.every = n; did.push("draw again" + (n ? " every " + n + " s" : " only on change")); } }
  if (typeof J.taps === "boolean"){ t.taps = J.taps; if (J.taps) did.push("taps on"); }
  if (Array.isArray(J.feeds)){
    const ok = STU_FEEDS.map(x => x[0]), want = J.feeds.filter(f => ok.includes(f));
    for (const f of J.feeds) if (!ok.includes(f)) skip.push("data " + JSON.stringify(String(f).slice(0, 20)));
    t.feeds = ok.filter(f => want.includes(f));
    if (t.feeds.length) did.push("reads " + t.feeds.map(f => STU_FEEDS.find(x => x[0] === f)[1].toLowerCase()).join(" and "));
  }
  // buttons for things in the house
  if (J.devices && typeof J.devices === "object" && !Array.isArray(J.devices)){
    const D = {}, C = [];
    for (const [k0, d] of Object.entries(J.devices).slice(0, 8)){
      const k = k0.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^[^a-z]/, "d$&").slice(0, 20), doms = Array.isArray(d && d.domains) ? [...new Set(d.domains.filter(x => STU_HA[x]))] : [];
      if (!doms.length || D[k]){ skip.push("device " + k0.slice(0, 20)); continue; }
      D[k] = {label:str(d.label, 40) || k, domains:doms};
    }
    const used = new Set();
    for (const c of (Array.isArray(J.controls) ? J.controls : []).slice(0, 12)){
      const id = String(c && c.id || "").toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^[^a-z]/, "b$&").slice(0, 20), dev = D[String(c && c.device || "").toLowerCase()];
      let data = {}, bad = !dev || used.has(id) || !dev.domains.every(x => STU_HA[x].includes(c.action));
      if (!bad && c.data && typeof c.data === "object" && !Array.isArray(c.data))
        for (const [dk, dv] of Object.entries(c.data)){ if (STU_HA_DATA.includes(dk) && ["number", "string", "boolean"].includes(typeof dv) && String(dv).length <= 60) data[dk] = dv; else bad = true; }
      if (bad){ skip.push("button " + id); continue; }
      used.add(id); C.push({id, device:c.device.toLowerCase(), action:c.action, data});
    }
    if (Object.keys(D).length && C.length){ t.devices = D; t.controls = C; did.push(C.length + (C.length === 1 ? " button" : " buttons") + " for " + Object.keys(D).length + (Object.keys(D).length === 1 ? " device" : " devices")); }
    else skip.push("buttons (needs devices and at least one working button)");
  }
  const personal = (t.feeds || []).some(f => STU_PERSONAL.includes(f)) || (t.devices && Object.keys(t.devices).length);
  if (Array.isArray(J.hosts) || typeof J.hosts === "string"){
    const L = (Array.isArray(J.hosts) ? J.hosts : J.hosts.split(/[\s,]+/)).map(x => String(x).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean);
    const ok = L.filter(h => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) && !/^[\d.]+$/.test(h)).slice(0, 8);
    for (const h of L) if (!ok.includes(h)) skip.push("site " + h.slice(0, 40));
    if (personal && ok.length){ t.hosts = []; skip.push("its sites (a tile that reads personal data gets no sites)"); }
    else { t.hosts = ok; if (ok.length) did.push("reads " + ok.join(", ")); }
  } else if (personal) t.hosts = [];
  if (J.settings && typeof J.settings === "object" && !Array.isArray(J.settings)){
    const S = {};
    for (const [k0, d] of Object.entries(J.settings).slice(0, 20)){
      const k = k0.trim().replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1").slice(0, 30);
      if (!k || S[k] || !d || typeof d !== "object" || !STU_TYPES.includes(d.type)){ skip.push("setting " + k0.slice(0, 30)); continue; }
      if (d.type === "secret"){ skip.push("setting " + k + " (keys are never filled in)"); continue; }
      const o = {type:d.type, label:str(d.label, 80) || k};
      if (d.type === "source"){
        if (!STU_KINDS[d.kind] || !(t.feeds || []).includes(STU_KINDS[d.kind])){ skip.push("setting " + k + " (needs " + (STU_KINDS[d.kind] || "a source") + " in what it reads)"); continue; }
        o.kind = d.kind;
      }
      else if (d.type === "bool") o.default = d.default === true;
      else if (d.type === "int" || d.type === "number"){
        o.default = Number.isFinite(+d.default) && d.default !== "" && d.default !== null ? (d.type === "int" ? Math.round(+d.default) : +d.default) : 0;
        for (const x of ["min", "max"]) if (d[x] !== undefined && d[x] !== null && d[x] !== "" && Number.isFinite(+d[x])) o[x] = +d[x];
      }
      else if (d.type === "list") o.default = (Array.isArray(d.default) ? d.default : String(d.default || "").split(",")).map(x => String(x).trim().slice(0, 100)).filter(Boolean).slice(0, 30);
      else if (d.type === "choice"){
        o.choices = (Array.isArray(d.choices) ? d.choices : []).map(x => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 20);
        if (!o.choices.length) o.choices = ["One", "Two"];
        o.default = o.choices.includes(d.default) ? d.default : o.choices[0];
      }
      else o.default = String(d.default == null ? "" : d.default).slice(0, 200);
      S[k] = o;
    }
    t.settings = S; did.push(Object.keys(S).length + (Object.keys(S).length === 1 ? " setting" : " settings"));
  }
  if (code){
    if (new Blob([code]).size > 60000) skip.push("code (too large)");
    else { t.code = code; did.push("code"); }
  } else if (J.code !== undefined || !obj) skip.push("code (no Tile(\"…\", { … }) found)");
  if (!did.length) return {error:"Nothing in that fits the form. Paste the whole answer, the settings and the code."};
  return {t, did, skip};
}
function stuFillHTML(){
  const f = STU.fill; if (!f) return "";
  if (f.err) return '<div class="lstu-err error">' + esc(f.err) + '</div>';
  if (f.undone) return '<p class="lnote ok">Put the form back as it was.</p>';
  return '<p class="lnote ok">Filled in: ' + esc(f.did.join(", ")) + '.</p>' + (f.skip.length ? '<p class="lnote">Left out: ' + esc(f.skip.join("; ")) + '.</p>' : "");
}
function stuRedraw(){ const sc = libEl().querySelector(".lmain").scrollTop; libShow(); libEl().querySelector(".lmain").scrollTop = sc; }
function stuFill(){
  if (!STU.reply.trim()){ toast("Paste the answer first", "bad"); return; }
  const r = stuParse(STU.reply, STU.t);
  if (r.error){ STU.fill = {err:r.error}; stuRedraw(); return; }
  STU.undo.push({t:JSON.stringify(STU.t), notes:STU.notes, gen:STU.gen}); if (STU.undo.length > 5) STU.undo.shift();
  STU.t = r.t; STU.reply = ""; STU.fill = {did:r.did, skip:r.skip};
  STU.notes = []; STU.gen = ""; STU.pend = null; STU.picking = false;      // what was asked for has been answered
  stuChanged(true);
}
function stuUnfill(){
  const b = STU.undo.pop(); if (!b) return;
  STU.t = JSON.parse(b.t); STU.notes = b.notes; STU.gen = b.gen; STU.pend = null; STU.picking = false; STU.fill = {undone:true};
  stuChanged(true);
}
async function stuTap(t){
  const d = t.dataset, a = d.l;
  if (a === "s-new"){ stuOpen(""); return; }
  if (a === "s-open"){ stuOpen(d.id); return; }
  if (a === "s-back"){ if (stuDirty() && !confirm("Leave without saving your changes?")) return; clearInterval(STU.poll); STU.t = null; libGo("tiles", STU.id ? "tile:" + STU.id : ""); return; }
  if (a === "s-size"){ STU.size = d.id; libShow(); stuPreview(); return; }
  if (a === "s-real"){ STU.real = !STU.real; libShow(); stuPreview(); return; }
  if (a === "s-save"){ stuSave(); return; }
  if (a === "s-share"){ stuDownload(); return; }
  if (a === "s-copy"){ stuCopyText(JSON.stringify(stuPublic(), null, 1), "Copied the tile as text"); return; }
  if (a === "s-submit"){ stuSubmit(); return; }
  if (a === "s-ai"){ stuCopyText(stuAI(), "Copied. Paste it into ChatGPT, then paste its answer here."); return; }
  if (a === "s-ai2"){
    if (!STU.notes.length && !STU.gen.trim()){ toast("Point at a part, or say what to change, first", "bad"); return; }
    stuCopyText(stuAI(true), "Copied. Paste it into ChatGPT, then paste its answer in box 2 at the top."); return; }
  if (a === "s-pick"){ STU.picking = !STU.picking; STU.pend = null; stuPickRefresh(); return; }
  if (a === "s-pickadd"){
    const n = STU.pend; if (!n) return;
    if (STU.notes.length >= STU_MAX_NOTES){ toast("That's the most notes for one request", "bad"); return; }
    if (!STU.pendNote.trim()){ toast("Say what should change first", "bad"); return; }
    STU.notes.push(Object.assign({}, n, {note:STU.pendNote.trim()})); STU.pend = null; STU.pendNote = ""; stuPickRefresh(); return; }
  if (a === "s-pickno"){ STU.pend = null; STU.picking = false; STU.pendNote = ""; stuPickRefresh(); return; }
  if (a === "s-pickdel"){ STU.notes.splice(+d.id, 1); stuPickRefresh(); return; }
  if (a === "s-phrase"){
    const w = d.id, ph = STU_PHRASES[+w]; if (!ph) return;
    if (d.k === "gen"){ STU.gen = (STU.gen.trim() ? STU.gen.trim() + ", " : "") + ph.toLowerCase(); const x = libEl().querySelector('[data-s="gen"]'); if (x) x.value = STU.gen; }
    else { STU.pendNote = (STU.pendNote.trim() ? STU.pendNote.trim() + ", " : "") + ph.toLowerCase(); const x = libEl().querySelector('[data-s="pend"]'); if (x) x.value = STU.pendNote; }
    return; }
  if (a === "s-fill"){ stuFill(); return; }
  if (a === "s-unfill"){ stuUnfill(); return; }
  if (a === "s-addset"){ const S = STU.t.settings = STU.t.settings || {}; let n = 1; while (S["setting" + n]) n++; S["setting" + n] = {type:"text", label:"Setting " + n, default:""}; stuChanged(true); return; }
  if (a === "s-delset"){ delete STU.t.settings[d.id]; stuChanged(true); return; }
  if (a === "s-adddev"){ const D = STU.t.devices = STU.t.devices || {}; let n = 1; while (D["light" + (n > 1 ? n : "")]) n++; D["light" + (n > 1 ? n : "")] = {label:"Light", domains:["light", "switch"]};
    STU.t.feeds = (STU.t.feeds || []); STU.t.hosts = []; stuChanged(true); return; }
  if (a === "s-deldev"){ delete STU.t.devices[d.id]; STU.t.controls = (STU.t.controls || []).filter(c => c.device !== d.id); if (!Object.keys(STU.t.devices).length){ STU.t.devices = null; STU.t.controls = null; } stuChanged(true); return; }
  if (a === "s-addctl"){ const c = STU.t.controls = STU.t.controls || []; let n = c.length + 1; while (c.some(x => x.id === "b" + n)) n++; c.push({id:"b" + n, device:Object.keys(STU.t.devices)[0], action:"toggle", data:{}}); stuChanged(true); return; }
  if (a === "s-delctl"){ STU.t.controls.splice(+d.id, 1); stuChanged(true); return; }
  if (a === "s-del"){
    const used = tileList().filter(x => x.type === STU.id);
    if (!confirmDel({one:used.length ? "tile and its " + used.length + (used.length === 1 ? " box" : " boxes") : "tile"}, STU.id)) return;
    try{ const r = await fetch("/studio/delete", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({id:STU.id})}); const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.status); }
    catch(e){ toast("Couldn't delete it: " + e.message, "bad"); return; }
    if (used.length){ commDropTiles(STU.id); save(true); }
    const name = STU.t.name; delete DEFS[STU.id]; STU.t = null; await stuSync();
    toast("Deleted " + name, "ok"); libGo("tiles"); return;
  }
  if (a === "s-trust"){
    try{ await fetch("/studio/trust", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({id:d.id})}); }catch(e){}
    await stuSync(); toast("It runs now", "ok"); libShow(); return;
  }
  if (a === "s-restore"){
    if (!confirm("Put the original Your own tile back, in every box that has this one? Changes you made in Tile Studio are lost.")) return;
    try{
      const r = await fetch("/studio/restore", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({id:d.id})});
      const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.status);
    }catch(e){ toast("Couldn't restore it: " + e.message, "bad"); return; }
    await stuReload(); STU.t = null; toast("The original is back", "ok"); libGo("tiles"); return;
  }
  if (a === "s-convert"){
    try{
      const r = await fetch("/studio/convert", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({id:d.id})});
      const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.status);
      await stuReload(); toast("Converted. Restore puts the original back.", "ok"); stuOpen(j.type);
    }catch(e){ toast("Couldn't convert it: " + e.message, "bad"); }
    return;
  }
}
// the server changed the settings itself (Convert, Restore): read them again
async function stuReload(){
  clearTimeout(saveTimer); saveGen++;
  try{ const j = await fetch("/config", {cache:"no-store"}).then(r => r.json()); mods = j.modules; SBXC = j.sandbox || {tiles:{}}; LEGACYC = j.legacy || {}; commDefs(); }catch(e){}
  await stuFiles(); pvRefresh();
}
// a .countertop tile file: added to your tiles, waiting for you to let it run
async function stuImportFile(text){
  let j;
  try{ j = JSON.parse(text); }catch(e){ toast("That isn't a Countertop tile file", "bad"); return; }
  if (!j || j.countertop !== "tile"){ toast("That isn't a Countertop tile file", "bad"); return; }
  try{
    const r = await fetch("/studio/import", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({tile:j})});
    const o = await r.json(); if (!r.ok || o.error) throw new Error(o.error || r.status);
    await stuSync(); toast("Added. Read its code, then let it run.", "ok"); stuOpen(o.id);
  }catch(e){ toast("Couldn't add it: " + stuWhy(e), "bad"); }
}
// a shared layout carries the code of the tiles it uses that someone made in Tile Studio: before it's used, each one is
// added to your tiles (with a new name, waiting for you to let it run), and its boxes point at that
async function stuImportLayout(imp){
  const want = (imp.mine || []).filter(x => !x.id);
  for (const x of want){
    const r = await fetch("/studio/import", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({tile:x.tile})});
    const o = await r.json(); if (!r.ok || o.error) throw new Error((x.tile.name || x.type) + ": " + (o.error || r.status));
    x.id = o.id;
  }
  const map = Object.fromEntries((imp.mine || []).map(x => [x.type, x.id]));
  for (const b of imp.boxes) for (const t of b.tiles) if (t.tile && map[t.type]){ t.type = map[t.type]; delete t.tile; }
  if (want.length) await stuSync();
}
