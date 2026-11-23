/* The community tile runtime. It runs first in every tile frame (tools/server/sandbox.py serves the page), then the
   tile's own code calls Tile(type, {...}) exactly as a built-in tile does, and gets the same `this`.
   Everything comes from the dashboard over postMessage: the dashboard knows which frame sent each message, checks
   what the tile declared, and never takes a tile id or a permission from the message itself. Nothing in here is a
   security boundary on its own; the frame's sandbox and Content-Security-Policy are. */
(function () {
  "use strict";
  var W = window, D = document, P = W.parent;

  /* ---- 1. WebRTC is the one way out a policy can't close (the Echo test found it), so it goes before tile code runs ---- */
  function stripRTC(w) {
    var names = [];
    try { names = Object.getOwnPropertyNames(w); } catch (e) { /* nothing to read */ }
    names.forEach(function (k) {
      if (!/^(webkit|moz)?RTC/.test(k)) return;
      try { delete w[k]; } catch (e) { /* not configurable */ }
      try { Object.defineProperty(w, k, { value: undefined, writable: false, configurable: false }); } catch (e) { /* already gone */ }
    });
  }
  stripRTC(W);

  /* ---- 2. no frames inside the frame: a blank inner frame shares this one's origin and would bring WebRTC back.
     Every way to add one is refused before the element exists in the page, so no tile code can run while it does ---- */
  var FRAMES = /^(iframe|frame|frameset|object|embed|portal|fencedframe)$/i;
  var FRAME_TAG = /<\s*\/?\s*(iframe|frame|frameset|object|embed|portal|fencedframe)[\s\/>]/i;
  var shadows = [];
  function refuse() { throw new Error("A tile can't contain frames, objects or embeds."); }
  function checkHTML(s) { if (FRAME_TAG.test(String(s))) refuse(); }
  function checkNode(n) {
    if (!n || typeof n !== "object" || !("nodeType" in n)) return;
    if (n.nodeType === 1 && FRAMES.test(n.localName || "")) refuse();
    if ((n.nodeType === 1 || n.nodeType === 11 || n.nodeType === 9) && n.querySelector) {
      if (n.querySelector("iframe,frame,frameset,object,embed,portal,fencedframe")) refuse();
      for (var i = 0; i < shadows.length; i++) if (n === shadows[i].host || (n.contains && n.contains(shadows[i].host))) checkNode(shadows[i]);
    }
  }
  function wrap(proto, name, check) {
    var d = proto && Object.getOwnPropertyDescriptor(proto, name);
    if (!d || typeof d.value !== "function") return;
    var f = d.value;
    d.value = function () { check(arguments); return f.apply(this, arguments); };
    Object.defineProperty(proto, name, d);
  }
  function wrapSetter(proto, name) {
    var d = proto && Object.getOwnPropertyDescriptor(proto, name);
    if (!d || !d.set) return;
    var set = d.set;
    d.set = function (v) { checkHTML(v); return set.call(this, v); };
    Object.defineProperty(proto, name, d);
  }
  function gone(proto, name) {
    if (proto && name in proto) try { Object.defineProperty(proto, name, { value: refuse, writable: false, configurable: false }); } catch (e) { /* leave it */ }
  }
  var allNodes = function (a) { for (var i = 0; i < a.length; i++) checkNode(a[i]); };
  var firstNode = function (a) { checkNode(a[0]); };
  var secondNode = function (a) { checkNode(a[1]); };
  var secondHTML = function (a) { checkHTML(a[1]); };
  wrap(Node.prototype, "appendChild", firstNode);
  wrap(Node.prototype, "insertBefore", firstNode);
  wrap(Node.prototype, "replaceChild", firstNode);
  [Element.prototype, CharacterData.prototype, DocumentType.prototype, Document.prototype, DocumentFragment.prototype].forEach(function (p) {
    ["append", "prepend", "before", "after", "replaceWith", "replaceChildren", "moveBefore"].forEach(function (n) { wrap(p, n, allNodes); });
  });
  wrap(Element.prototype, "insertAdjacentElement", secondNode);
  wrap(Element.prototype, "insertAdjacentHTML", secondHTML);
  wrap(Range.prototype, "insertNode", firstNode);
  wrap(Range.prototype, "surroundContents", firstNode);
  wrap(Range.prototype, "createContextualFragment", function (a) { checkHTML(a[0]); });
  wrap(Document.prototype, "createElement", function (a) { if (FRAMES.test(String(a[0]))) refuse(); });
  wrap(Document.prototype, "createElementNS", function (a) { if (FRAMES.test(String(a[1]).replace(/^.*:/, ""))) refuse(); });
  wrapSetter(Element.prototype, "innerHTML");
  wrapSetter(Element.prototype, "outerHTML");
  if (W.ShadowRoot) wrapSetter(ShadowRoot.prototype, "innerHTML");
  var attach = Element.prototype.attachShadow;
  if (attach) Element.prototype.attachShadow = function (o) { var r = attach.call(this, o); shadows.push(r); return r; };
  ["write", "writeln", "open", "execCommand"].forEach(function (n) { gone(Document.prototype, n); });
  gone(Element.prototype, "setHTMLUnsafe");
  if (W.ShadowRoot) gone(ShadowRoot.prototype, "setHTMLUnsafe");
  gone(Document, "parseHTMLUnsafe");
  if (W.customElements) gone(CustomElementRegistry.prototype, "define");

  /* ---- 3. the bridge to the dashboard ---- */
  var post = function (m) { try { P.postMessage(m, "*"); } catch (e) { /* the dashboard went away */ } };
  var ROOT = D.getElementById("tile");
  var DEF = null, ME = null, S = {}, NAME = "", ID = "", WORDS = {}, LANGWORDS = null, LOCALE, QUIET = true, TAPS = false;
  var STORE = { data: {}, ready: false }, ASK = {}, ASKED = {}, FETCHED = {}, STATE = { has: null, urgent: null };
  var due = false;

  W.Tile = function (type, def) { if (!DEF && def && typeof def === "object") DEF = def; };
  W.addEventListener("error", function (e) { post({ ct: "error", msg: String(e.message || "error").slice(0, 200) }); });
  W.addEventListener("unhandledrejection", function (e) { post({ ct: "error", msg: String(e.reason && e.reason.message || e.reason).slice(0, 200) }); });

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function tr(s, vars) {
    var out = (LANGWORDS && LANGWORDS[s]) || WORDS[s] || s;
    if (vars) out = String(out).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
    return out;
  }
  // the same operations the dashboard and the server apply (tools/dash/tile-api.js, tools/server/tiledata.py)
  function apply(data, op) {
    var list = function () { return Array.isArray(data[op.key]) ? data[op.key] : (data[op.key] = []); };
    var match = function (x, f) { return x && Object.keys(f).every(function (k) { return x[k] === f[k]; }); };
    if (op.op === "set") { if (op.value == null) delete data[op.key]; else data[op.key] = op.value; }
    else if (op.op === "push") list().push(op.item);
    else if (op.op === "update") list().forEach(function (x) { if (x && x.id === op.id) Object.assign(x, op.fields); });
    else if (op.op === "updateAll") list().forEach(function (x) { if (x) Object.assign(x, op.fields); });
    else if (op.op === "remove") data[op.key] = list().filter(function (x) { return !(x && x.id === op.id); });
    else if (op.op === "removeWhere") data[op.key] = list().filter(function (x) { return !match(x, op.fields); });
  }
  function itemId() { return Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7); }
  function write(ops, unless) {
    if (QUIET) return Promise.resolve(null);
    var was = STORE.data;
    if (unless && Object.keys(unless).every(function (k) { return JSON.stringify(was[k]) === JSON.stringify(unless[k]); })) return Promise.resolve(was);
    var mine = JSON.parse(JSON.stringify(was));
    try { ops.forEach(function (op) { apply(mine, op); }); STORE.data = mine; } catch (e) { /* the server decides */ }
    post({ ct: "store", ops: ops, unless: unless || null });
    soon();
    return Promise.resolve(mine);
  }
  function ask(what, arg, empty) {
    var key = what + ":" + JSON.stringify(arg === undefined ? null : arg);
    if (key in ASK) return ASK[key];
    if (!ASKED[key]) { ASKED[key] = 1; post({ ct: "ask", what: what, arg: arg === undefined ? null : arg }); }
    return empty;
  }
  var API = {
    api: 1,
    get s() { return S; },
    get name() { return NAME; },
    get id() { return ID; },
    get locale() { return LOCALE; },
    t: function (s, vars) { return tr(s, vars); },
    esc: esc,
    get store() {
      return {
        get ready() { return STORE.ready; },
        get: function () { return STORE.data; },
        set: function (key, value) { return write([{ op: "set", key: key, value: value }]); },
        push: function (key, item) { return write([{ op: "push", key: key, item: Object.assign({ id: itemId() }, item) }]); },
        update: function (key, id, fields) { return write([{ op: "update", key: key, id: id, fields: fields }]); },
        remove: function (key, id) { return write([{ op: "remove", key: key, id: id }]); },
        updateAll: function (key, fields) { return write([{ op: "updateAll", key: key, fields: fields }]); },
        removeWhere: function (key, fields) { return write([{ op: "removeWhere", key: key, fields: fields }]); },
        change: function (ops, unless) { return write(ops, unless); }
      };
    },
    // a web address, read by the server for the sites this tile declared. Returns what it has now (null at first) and
    // draws the tile again when the answer arrives
    fetch: function (url, maxAge) {
      url = String(url);
      var c = FETCHED[url], age = maxAge == null ? 300 : +maxAge || 0;
      if (!c || (!c.busy && Date.now() - c.at > Math.max(30, age) * 1000)) {
        c = FETCHED[url] = { data: c ? c.data : null, error: c ? c.error : "", at: c ? c.at : 0, busy: true };
        post({ ct: "fetch", url: url, maxAge: age });
      }
      return c.data;
    },
    fetchError: function (url) { var c = FETCHED[String(url)]; return c ? c.error || "" : ""; },
    feed: function (name) { return ask("feed", String(name), null); },
    sources: function (kind) { return ask("sources", String(kind), []); },
    events: function (o) {
      o = o || {};
      var list = ask("events", { cals: Array.isArray(o.cals) ? o.cals.map(String) : [], once: !!o.once }, []);
      return list.map(function (e) { return Object.assign({}, e, { date: new Date(e.date) }); });
    },
    // a control tile: the state of each device the person picked for it, by the slot names in its file ({} until known,
    // null for a slot not picked yet). The tile shows state; its buttons are drawn by the dashboard, outside this frame
    devices: function () { return ask("devices", null, {}); },
    act: function () { return Promise.reject(new Error("A community tile can't send actions. Its buttons are drawn by the dashboard.")); }
  };

  function report() {
    if (!ME) return;
    var has = true, urgent = false;
    try { has = !DEF.has || !!DEF.has.call(ME); } catch (e) { has = true; }
    try { urgent = !!(DEF.urgent && DEF.urgent.call(ME)); } catch (e) { urgent = false; }
    if (has !== STATE.has || urgent !== STATE.urgent) { STATE.has = has; STATE.urgent = urgent; post({ ct: "state", has: has, urgent: urgent }); }
  }
  function draw() {
    due = false;
    if (!ME) return;
    try { if (typeof DEF.render === "function") DEF.render.call(ME, ROOT); }
    catch (e) { post({ ct: "error", msg: String(e && e.message || e).slice(0, 200) }); }
    report();
  }
  function soon() { if (!due) { due = true; setTimeout(draw, 0); } }

  function localeSetup() {
    if (!LOCALE) return;
    var loc = function (l) { return l == null || (Array.isArray(l) && !l.length) ? LOCALE : l; };
    [[Date.prototype, "toLocaleDateString"], [Date.prototype, "toLocaleTimeString"], [Date.prototype, "toLocaleString"], [Number.prototype, "toLocaleString"]].forEach(function (x) {
      var f = x[0][x[1]]; x[0][x[1]] = function (l, o) { return f.call(this, loc(l), o); };
    });
    var DTF = Intl.DateTimeFormat;
    Intl.DateTimeFormat = Object.assign(function (l, o) { return new DTF(loc(l), o); }, { supportedLocalesOf: DTF.supportedLocalesOf });
    Intl.DateTimeFormat.prototype = DTF.prototype;
  }
  function theme(t) {
    if (!t) return;
    var st = D.documentElement.style;
    ["fg", "dim", "accent", "line", "font"].forEach(function (k) { if (typeof t[k] === "string") st.setProperty("--" + k, t[k]); });
  }
  function update(d) {
    if (d.s && typeof d.s === "object") S = d.s;
    if (typeof d.name === "string") NAME = d.name;
    if (typeof d.quiet === "boolean") QUIET = d.quiet;
    if (typeof d.taps === "boolean") TAPS = d.taps;
    if (d.store && typeof d.store === "object") STORE = { data: d.store.data || {}, ready: !!d.store.ready };
    if (d.answers && typeof d.answers === "object") for (var k in d.answers) ASK[k] = d.answers[k];
    if (d.theme) theme(d.theme);
  }

  W.addEventListener("message", function (e) {
    if (e.source !== P) return;
    var d = e.data;
    if (!d || typeof d !== "object") return;
    if (d.ct === "init" && !ME) {
      ID = String(d.id || ""); WORDS = d.words || {}; LOCALE = d.locale || undefined;
      if (!DEF) { post({ ct: "error", msg: "The tile's code didn't call Tile()." }); return; }
      LANGWORDS = DEF.lang && d.lang ? DEF.lang[d.lang] : null;
      localeSetup();
      update(d);
      if (d.fetched) for (var u in d.fetched) FETCHED[u] = { data: d.fetched[u].data, error: d.fetched[u].error || "", at: d.fetched[u].at || 0, busy: false };
      ME = Object.create(API);
      Object.keys(DEF).forEach(function (k) { if (!(k in API)) ME[k] = DEF[k]; });
      if (DEF.css) { var st = D.createElement("style"); st.textContent = String(DEF.css); D.head.appendChild(st); }
      if (DEF.cls) ROOT.className = String(DEF.cls);
      draw();
    } else if (d.ct === "update" && ME) {
      update(d);
      if (d.draw) draw(); else { report(); }
    } else if (d.ct === "fetched" && typeof d.url === "string") {
      FETCHED[d.url] = { data: d.data === undefined ? null : d.data, error: d.error || "", at: d.error ? (FETCHED[d.url] || {}).at || Date.now() : Date.now(), busy: false };
      if (d.error && FETCHED[d.url].data == null) FETCHED[d.url].data = null;
      soon();
    }
  });
  // taps and form submits, only for tiles that said they take taps, and never while the screen is being edited
  ROOT.addEventListener("click", function (e) { if (ME && TAPS && !QUIET && DEF.tap) { try { DEF.tap.call(ME, e, ROOT); } catch (x) { post({ ct: "error", msg: String(x.message || x) }); } } });
  ROOT.addEventListener("submit", function (e) {
    e.preventDefault();
    if (ME && TAPS && !QUIET && DEF.submit) { try { DEF.submit.call(ME, e, ROOT, e.target); } catch (x) { post({ ct: "error", msg: String(x.message || x) }); } }
  }, true);
  D.addEventListener("DOMContentLoaded", function () { post({ ct: "ready" }); });
})();
