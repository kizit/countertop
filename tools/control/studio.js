/* ---------- Tile Studio: make your own tiles (Library → Tiles → New tile) ----------
   A tile made here is the same file a community tile is: a few facts (name, size, settings, the data it reads, the
   sites it reads from, its buttons) and its code, saved on the server in mytiles/ (tools/server/mytiles.py). It runs
   in the same sandboxed frame. While you write, every change is sent as a draft (POST /studio/draft) and the preview
   beside the code is the real dashboard showing that draft (/dash/content?solo=<draft>), with made-up data or yours.
   Tiles that came from someone else (a shared layout or file) wait until you let them run.
   Your own tile is retired: the ones that will work here were converted by the server, keeping the original for
   Restore; the rest are listed in Library → Tiles with why, and Convert. */
const STU = {id:"", t:null, base:"", draft:"", err:"", real:false, ask:"", log:[], timer:null, poll:null, size:"usual"};
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
  Object.assign(STU, {id:id || "", t:null, draft:"", err:"", log:[], ask:"", size:"usual"});
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
  h += '<div class="lpanel"><h3>Write it for me</h3><label class="lfield">What should it show?<textarea data-s="ask" rows="2" placeholder="e.g. days until summer vacation, with a sun that grows">' + esc(STU.ask) + '</textarea></label>' +
    '<div class="lact"><button class="lbtn" data-l="s-ai">Copy instructions for ChatGPT</button></div><p class="lnote">Paste them into ChatGPT (or another assistant), then paste its answer into Code.</p></div>';
  h += '</div>';
  // the preview, and what to do with it
  h += '<div class="lstu-r"><div class="lstu-pv"><div class="lchips">' + [["usual", "Usual size"], ["small", "Smallest"], ["big", "Large"]].map(([k, l]) =>
      '<button class="lchip' + (STU.size === k ? " on" : "") + '" data-l="s-size" data-id="' + k + '">' + l + '</button>').join("") +
    '<button class="lchip' + (STU.real ? " on" : "") + '" data-l="s-real">' + (STU.real ? "Your data" : "Made-up data") + '</button></div>' +
    '<div class="tp big lstu-shot">' + (STU.draft ? '<iframe title="Preview" data-w="' + stuPvSize()[0] + '" data-h="' + stuPvSize()[1] + '" src="' + esc(stuPvSrc()) + '"></iframe>' : "") + '</div>' +
    '<div class="lstu-log">' + stuLogHTML() + '</div></div>' +
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
  clearInterval(STU.poll);
  // what went wrong inside: the preview is this server's own dashboard page, so its list can be read directly
  STU.poll = setInterval(() => {
    if (LIB.view !== "studio"){ clearInterval(STU.poll); return; }
    const f = libEl().querySelector(".lstu-shot iframe");
    try{
      const L = f.contentWindow.dashSbxLog("demo");
      if (JSON.stringify(L) !== JSON.stringify(STU.log)){ STU.log = L.slice(); const lg = libEl().querySelector(".lstu-log"); if (lg) lg.innerHTML = stuLogHTML(); }
    }catch(e){}
  }, 1000);
}
// a form field changed
function stuSet(field, value, el){
  const t = STU.t, p = field.split(".");
  let redraw = false;
  if (field === "ask"){ STU.ask = value; return; }
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
function stuAI(){
  const t = STU.t, S = Object.entries(t.settings || {}).map(([k, d]) => "this.s." + k + " (" + d.type + (d.label ? ", " + d.label : "") + ")").join(", ");
  const feeds = (t.feeds || []).map(f => (STU_FEEDS.find(x => x[0] === f) || [])[2]).filter(Boolean).join(", ");
  return "Please write a tile for my Countertop home dashboard (a wall-mounted touch screen, about 1920x1080, seen from across the room).\n\n" +
    "What the tile should show:\n" + (STU.ask.trim() || t.description || "(describe it here)") + "\n\n" +
    "Write plain JavaScript in this shape, and reply with just the code:\n\n" +
    'Tile("' + (STU.id || "my-tile") + '", {\n  render(el) { /* draw the tile into el, e.g. el.innerHTML = ... */ },\n  css: "/* styles for the tile, optional */"\n});\n\n' +
    "Rules:\n" +
    "- render(el) is called to draw the tile, again after data arrives and again when settings change. Build the HTML in el each time (escape text with this.esc(text)). It must never loop forever or block.\n" +
    "- The box can be from about " + ((t.size || [])[2] || 6) * 40 + "x" + ((t.size || [])[3] || 4) * 34 + " up to 1200x800 pixels: use flexbox or grid and percentages, keep everything inside with no scrolling.\n" +
    "- Keep the background transparent. CSS variables: var(--fg) main text, var(--dim) secondary text, var(--accent) highlight. No text under 18px; the main number or words 40px or bigger.\n" +
    (S ? "- Its settings (read them, don't change them): " + S + ".\n" : "") +
    (feeds ? "- Data it can read (each returns what it has now, possibly null at first, and the tile is drawn again when it arrives): " + feeds + ".\n" : "") +
    ((t.hosts || []).length ? "- Web data only from " + t.hosts.join(", ") + ": this.fetch(\"https://...\") returns the parsed JSON (or text) it has now, null until it arrives, and draws the tile again when it does; this.fetchError(url) says what went wrong. Plain fetch() and <img src=\"https://...\"> also work for those sites. No other sites, no API keys in the code.\n" :
      "- It can't reach the internet: no fetch, no pictures from the web.\n") +
    "- To remember things between visits: this.store.get() (an object), this.store.set(key, value), this.store.push(key, item).\n" +
    (t.taps ? "- Taps call tap(e, el) on the tile (e.target is what was tapped).\n" : "- It doesn't respond to taps.\n") +
    "- No cookies, localStorage, pop-ups, frames or other pages. Nobody uses a mouse or keyboard on it.\n" +
    "- If data can't be loaded, show a short friendly message instead of an error.";
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
  if (a === "s-ai"){ stuCopyText(stuAI(), "Copied. Paste it into ChatGPT."); return; }
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
