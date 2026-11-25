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
  // the dashboard only listens once the frame says it's ready: what the tile's code asks before that (a page's own
  // scripts run while the frame loads) waits here, and goes right after
  var EARLY = [];
  var send = function (m) { try { P.postMessage(m, "*"); } catch (e) { /* the dashboard went away */ } };
  var post = function (m) { if (EARLY) { if (EARLY.length < 100) EARLY.push(m); } else send(m); };
  var ROOT = D.getElementById("tile");
  var DEF = null, ME = null, S = {}, NAME = "", ID = "", WORDS = {}, LANGWORDS = null, LOCALE, QUIET = true, TAPS = false;
  var STORE = { data: {}, ready: false }, ASK = {}, ASKED = {}, FETCHED = {}, STATE = { has: null, urgent: null };
  var due = false, RELOAD = null, WAITING = {}, IMAGES = {};

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
      if (!c || (!c.busy && Date.now() - c.at > (c.error ? 30 : Math.max(30, age)) * 1000)) {
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
    // start this tile again from scratch in `sec` seconds (at least a minute), as a fresh frame: for pages converted from
    // Your own tile, which used to reload every few minutes
    reloadIn: function (sec) {
      if (RELOAD || QUIET) return;
      RELOAD = setTimeout(function () { post({ ct: "reload" }); }, Math.max(60, +sec || 0) * 1000);
    },
    act: function () { return Promise.reject(new Error("A community tile can't send actions. Its buttons are drawn by the dashboard.")); }
  };

  /* ---- 4. fetch() and pictures from the tile's own sites, through the dashboard and the server ----
     The frame has no network (connect-src 'none', img-src data: blob:), so these never reach anything by themselves.
     fetch(url) asks the server to read it (only the sites the tile declared; GET only) and answers with a Response.
     An <img> with an https:// address is shown from a copy the server read, as a data: address. */
  var nativeResponse = W.Response;
  W.fetch = function (input, init) {
    var url = String(input && input.url ? input.url : input), method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") return Promise.reject(new TypeError("A tile can only read sites (GET), not send to them."));
    if (!/^https:\/\//i.test(url)) return Promise.reject(new TypeError("A tile can only read https:// addresses on its own sites."));
    return new Promise(function (ok, no) {
      (WAITING[url] = WAITING[url] || []).push([ok, no]);
      post({ ct: "fetch", url: url, maxAge: 30 });
    });
  };
  function answer(url, c) {
    var L = WAITING[url]; if (!L) return;
    delete WAITING[url];
    L.forEach(function (w) {
      if (c.error) return w[1](new TypeError(c.error));
      var text = typeof c.data === "string" ? c.data : JSON.stringify(c.data);
      try { w[0](new nativeResponse(text, { status: 200, headers: { "Content-Type": typeof c.data === "string" ? "text/plain" : "application/json" } })); }
      catch (e) { w[1](e); }
    });
  }
  var srcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  var setAttr = Element.prototype.setAttribute;
  function picture(img, url) {
    url = String(url);
    if (!/^https:\/\//i.test(url)) return false;
    img.setAttribute("data-ct-src", url);
    var c = IMAGES[url];
    if (c && c.data) { srcDesc.set.call(img, c.data); return true; }
    if (!c) { c = IMAGES[url] = { imgs: [], data: null }; post({ ct: "image", url: url }); }
    c.imgs.push(img);
    return true;
  }
  if (srcDesc && srcDesc.set) {
    Object.defineProperty(HTMLImageElement.prototype, "src", { configurable: true, enumerable: srcDesc.enumerable,
      get: function () { return this.getAttribute("data-ct-src") || srcDesc.get.call(this); },
      set: function (v) { if (!picture(this, v)) srcDesc.set.call(this, v); } });
  }
  Element.prototype.setAttribute = function (name, v) {
    if (this instanceof HTMLImageElement && String(name).toLowerCase() === "src" && picture(this, v)) return;
    return setAttr.call(this, name, v);
  };
  // pictures written as HTML (<img src="https://…">): the page's policy stops the browser's own request before it's sent
  function scan(root) {
    var L = root.querySelectorAll ? root.querySelectorAll("img[src^='https:'],img[src^='HTTPS:']") : [];
    if (root.nodeName === "IMG" && /^https:/i.test(root.getAttribute("src") || "")) L = [root].concat([].slice.call(L));
    for (var i = 0; i < L.length; i++) picture(L[i], L[i].getAttribute("src"));
  }
  new MutationObserver(function (ms) {
    ms.forEach(function (m) {
      if (m.type === "attributes") { if (m.target.nodeName === "IMG" && /^https:/i.test(m.target.getAttribute("src") || "")) picture(m.target, m.target.getAttribute("src")); }
      else for (var i = 0; i < m.addedNodes.length; i++) if (m.addedNodes[i].nodeType === 1) scan(m.addedNodes[i]);
    });
  }).observe(D.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
  // what the page's policy stopped, for Tile Studio's list of problems
  D.addEventListener("securitypolicyviolation", function (e) {
    if (/^img-src/.test(e.violatedDirective || e.effectiveDirective || "") && /^https:/i.test(e.blockedURI || "")) return;     // shown through the server instead
    post({ ct: "blocked", what: String(e.effectiveDirective || e.violatedDirective || "").slice(0, 40), uri: String(e.blockedURI || "").slice(0, 200) });
  });

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

    pinsDraw();
    fitSoon();
  }
  /* Tile Studio's size check: after the tile has settled, look for words or shapes that run past the tile's edge or sit
     on top of each other, and tell the dashboard in a few short phrases. The dashboard only keeps this for Tile
     Studio's preview pages; it is just a list of short notes and changes nothing. */
  var fitT = null, fitLast = "";
  function fitSoon() { clearTimeout(fitT); fitT = setTimeout(fitCheck, 900); }
  function fitName(el) {
    var t = String(el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 30);
    return t || "";
  }
  function fitBoxes() {
    var out = [], all = ROOT.querySelectorAll("*");
    for (var i = 0; i < all.length && out.length < 120; i++) {
      var el = all[i], tag = el.tagName.toLowerCase();
      if (tag === "style" || tag === "script") continue;
      var cs = W.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.3) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 6 || r.height < 6) continue;
      var own = "";
      for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) own += c.nodeValue;
      own = own.replace(/\s+/g, " ").trim();
      if (own) { out.push({ r: r, t: own.slice(0, 30), text: true }); continue; }
      if (el.children.length) continue;
      var bg = cs.backgroundColor, shape = tag === "img" || tag === "svg" || tag === "canvas" || tag === "video" ||
        (bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg) && r.width >= 12 && r.height >= 12);
      if (shape) out.push({ r: r, t: "", text: false });
    }
    return out;
  }
  function fitCheck() {
    fitT = null;
    if (!ME || !ROOT) return;
    var issues = [], root = ROOT.getBoundingClientRect(), W2 = W.innerWidth, H2 = W.innerHeight;
    var box = { left: Math.max(0, root.left), top: Math.max(0, root.top), right: Math.min(W2, root.right), bottom: Math.min(H2, root.bottom) };
    var list = [];
    try { list = fitBoxes(); } catch (e) { return; }
    list.forEach(function (b) {
      var r = b.r;
      if (issues.length < 3 && (r.right > box.right + 3 || r.bottom > box.bottom + 3 || r.left < box.left - 3 || r.top < box.top - 3)) issues.push({ k: "over", a: b.t });
    });
    for (var i = 0; i < list.length && issues.length < 3; i++) for (var j = i + 1; j < list.length && issues.length < 3; j++) {
      var a = list[i], b = list[j];
      if (!a.text && !b.text) continue;
      var w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w <= 0 || h <= 0) continue;
      var small = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
      if (w * h > small * 0.25) issues.push({ k: "lap", a: a.t, b: b.t });
    }
    var key = JSON.stringify(issues);
    if (key !== fitLast) { fitLast = key; post({ ct: "fit", issues: issues }); }
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
  var THEME_VARS = { fg: "fg", dim: "dim", accent: "accent", line: "line", font: "font", text: "text", textDim: "text-dim", faint: "text-faint",
    surface: "surface", surfaceLine: "surface-line", ok: "ok", info: "info", warn: "warn", bad: "bad", radius: "radius", fontDisplay: "font-display" };
  function theme(t) {
    if (!t) return;
    var st = D.documentElement.style;
    Object.keys(THEME_VARS).forEach(function (k) { if (typeof t[k] === "string" && t[k].length < 400) st.setProperty("--" + THEME_VARS[k], t[k]); });
  }
  // Bundled theme fonts arrive as bytes from the dashboard (this frame's policy still has font-src 'none'): only these names, only a small file
  var FONT_OK = { "Bebas Neue": 1, "DM Serif Display": 1, "Fraunces": 1, "JetBrains Mono": 1, "Nunito": 1, "Outfit": 1, "Space Grotesk": 1 }, FONTS = {};
  function font(d) {
    if (typeof d.family !== "string" || !FONT_OK[d.family] || FONTS[d.family] || !(d.data instanceof ArrayBuffer) || d.data.byteLength > 120000) return;
    if (typeof d.weight !== "string" || !/^\d{3}( \d{3})?$/.test(d.weight)) return;
    FONTS[d.family] = 1;
    try { var ff = new FontFace(d.family, d.data, { weight: d.weight, display: "swap" }); ff.load().then(function () { D.fonts.add(ff); }, function () { delete FONTS[d.family]; }); }
    catch (x) { delete FONTS[d.family]; }
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

  /* ---- 4. Tile Studio's "Point at something" (only ever started by a message from the dashboard page, which sends it
     only for the Studio preview). While it's on, a touch or click is caught here before the tile's code sees it, the part
     under it is outlined, and one small description of that part goes back: its tags and class names, where it sits, and
     (with made-up data only) its words. Pins are numbers drawn over the parts earlier notes were about; they carry no note text. ---- */
  var PICK = { on: false, text: false, pins: [] }, LAYER = null, OUT = null;
  function layer() {
    if (LAYER) return LAYER;
    LAYER = D.createElement("div");
    LAYER.style.cssText = "position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;";
    OUT = D.createElement("div");
    OUT.style.cssText = "position:absolute;display:none;box-sizing:border-box;border:3px solid #ffd54a;background:rgba(255,213,74,.16);border-radius:4px;";
    LAYER.appendChild(OUT);
    D.documentElement.appendChild(LAYER);
    return LAYER;
  }
  function pinsDraw() {
    if (!LAYER && !PICK.pins.length) return;
    var L = layer();
    Array.prototype.slice.call(L.querySelectorAll("[data-pin]")).forEach(function (n) { n.remove(); });
    PICK.pins.forEach(function (p) {
      var el = null;
      try { el = ROOT.querySelector(p.sel); } catch (e) { /* a part that's gone */ }
      if (p.sel === ":scope") el = ROOT;
      if (!el) return;
      var r = el.getBoundingClientRect();
      var pin = D.createElement("div");
      pin.setAttribute("data-pin", p.n);
      pin.textContent = String(p.n);
      pin.style.cssText = "position:absolute;width:26px;height:26px;line-height:26px;border-radius:13px;text-align:center;font:700 16px/26px system-ui,sans-serif;background:#ffd54a;color:#000;box-shadow:0 1px 4px rgba(0,0,0,.5);" +
        "left:" + Math.max(2, Math.min(W.innerWidth - 28, r.left - 6)) + "px;top:" + Math.max(2, Math.min(W.innerHeight - 28, r.top - 6)) + "px;";
      L.appendChild(pin);
    });
  }
  function pickTarget(e) {
    var t = e.target;
    return t && t.nodeType === 1 && ROOT.contains(t) && t !== ROOT ? t : ROOT;
  }
  function pickSel(el) {
    var steps = [], n = el;
    while (n && n !== ROOT && n.parentNode) {
      steps.unshift(n.tagName.toLowerCase() + ":nth-child(" + (Array.prototype.indexOf.call(n.parentNode.children, n) + 1) + ")");
      n = n.parentNode;
    }
    while (steps.length > 12) { steps.shift(); }          // too deep: the part is the closest ancestor that isn't
    return { sel: ":scope" + steps.map(function (x) { return ">" + x; }).join(""), steps: steps.length };
  }
  function pickHere(el) {
    var s = pickSel(el), target = el, path = [];
    // the same steps, found again from the root (so the part named is the one a pin will find later)
    try { target = s.steps ? ROOT.querySelector(s.sel) || el : ROOT; } catch (e) { target = el; }
    if (!s.steps) target = ROOT;
    var n = target;
    while (n && n !== ROOT) {
      var c = String(n.getAttribute("class") || "").split(/\s+/).filter(Boolean)[0];
      path.unshift(n.tagName.toLowerCase() + (c ? "." + c : ""));
      n = n.parentNode;
    }
    var r = target.getBoundingClientRect(), w = W.innerWidth || 1, h = W.innerHeight || 1;
    var cs = W.getComputedStyle(target);
    var own = "";
    if (PICK.text) own = String(target.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
    return { ct: "picked", sel: s.sel, tag: target === ROOT ? "div" : target.tagName.toLowerCase(),
      cls: String(target.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 6), path: path.slice(-6),
      box: [r.left / w * 100, r.top / h * 100, r.width / w * 100, r.height / h * 100], fs: parseFloat(cs.fontSize) || 0, text: own };
  }
  function pickMove(e) {
    if (!PICK.on) return;
    var el = pickTarget(e), r = el.getBoundingClientRect(); layer();
    OUT.style.display = "block"; OUT.style.left = r.left + "px"; OUT.style.top = r.top + "px"; OUT.style.width = r.width + "px"; OUT.style.height = r.height + "px";
  }
  function pickCatch(e) {
    if (!PICK.on) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.type === "pointerdown") pickMove(e);
    if (e.type === "click") post(pickHere(pickTarget(e)));
  }
  // on the window, in the capture phase, ahead of everything else (the hold and swipe listeners and the tile's own)
  ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "click", "submit", "contextmenu"].forEach(function (n) { W.addEventListener(n, pickCatch, true); });
  ["pointermove", "pointerover"].forEach(function (n) { W.addEventListener(n, pickMove, true); });
  W.addEventListener("resize", pinsDraw);
  W.addEventListener("message", function (e) {
    if (e.source !== P) return;
    var d = e.data;
    if (!d || typeof d !== "object" || d.ct !== "pick") return;
    PICK.on = d.on === true; PICK.text = d.text === true;
    PICK.pins = (Array.isArray(d.pins) ? d.pins : []).slice(0, 8).filter(function (p) {
      return p && typeof p.n === "number" && typeof p.sel === "string" && p.sel.length <= 400 && /^:scope(>[a-z][a-z0-9]*:nth-child\(\d+\))*$/.test(p.sel);
    });
    layer();
    if (!PICK.on) OUT.style.display = "none";
    pinsDraw();
  });

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
    } else if (d.ct === "fonts") {
      font(d);
    } else if (d.ct === "update" && ME) {
      update(d);
      if (d.draw) draw(); else { report(); }
    } else if (d.ct === "fetched" && typeof d.url === "string") {
      FETCHED[d.url] = { data: d.data === undefined ? null : d.data, error: d.error || "", at: Date.now(), busy: false };
      if (d.error && FETCHED[d.url].data == null) FETCHED[d.url].data = null;
      answer(d.url, { data: d.data === undefined ? null : d.data, error: d.error || "" });
      soon();
    } else if (d.ct === "imaged" && typeof d.url === "string" && IMAGES[d.url]) {
      var c = IMAGES[d.url];
      if (typeof d.data === "string" && /^data:image\/(png|jpeg|gif|webp);base64,/.test(d.data)) {
        c.data = d.data;
        c.imgs.forEach(function (img) { if (img.getAttribute("data-ct-src") === d.url) srcDesc.set.call(img, d.data); });
      } else {
        delete IMAGES[d.url];
        c.imgs.forEach(function (img) { img.dispatchEvent(new Event("error")); });
      }
      c.imgs = [];
    }
  });
  // holding a finger on the tile starts editing the screen, as it does on any other tile: the dashboard can't see
  // touches inside this frame, so it's told. (A tile could send this by itself; all it would do is open the editor,
  // and the dashboard takes it at most once every 10 seconds)
  var holdT = null, holdAt = null, held = false;
  function holdStop() { clearTimeout(holdT); holdT = null; }
  D.addEventListener("pointerdown", function (e) {
    held = false; holdAt = [e.clientX, e.clientY]; holdStop();
    holdT = setTimeout(function () { holdT = null; held = true; post({ ct: "hold" }); }, 700);
  }, true);
  D.addEventListener("pointermove", function (e) { if (holdT && Math.abs(e.clientX - holdAt[0]) + Math.abs(e.clientY - holdAt[1]) > 12) holdStop(); }, true);
  ["pointerup", "pointercancel"].forEach(function (n) { D.addEventListener(n, holdStop, true); });
  // a swipe across the tile turns the page, as it does anywhere else on the screen
  var sw = null;
  function swEnd(x, y) {
    if (!sw) return;
    var dx = x - sw[0], dy = y - sw[1]; sw = null;
    if (Math.abs(dx) > 90 && Math.abs(dx) > Math.abs(dy) * 1.3) { holdStop(); post({ ct: "swipe", dir: dx < 0 ? 1 : -1 }); }
  }
  D.addEventListener("touchstart", function (e) { var t = e.touches[0]; if (t) sw = [t.clientX, t.clientY]; }, { passive: true, capture: true });
  D.addEventListener("touchend", function (e) { var t = e.changedTouches[0]; if (t) swEnd(t.clientX, t.clientY); }, true);
  D.addEventListener("pointerdown", function (e) { if (e.pointerType !== "touch") sw = [e.clientX, e.clientY]; }, true);
  D.addEventListener("pointerup", function (e) { if (e.pointerType !== "touch") swEnd(e.clientX, e.clientY); }, true);
  // the tap that ends a hold isn't a tap
  D.addEventListener("click", function (e) { if (held) { held = false; e.stopPropagation(); e.preventDefault(); } }, true);
  // taps and form submits, only for tiles that said they take taps, and never while the screen is being edited
  ROOT.addEventListener("click", function (e) { if (ME && TAPS && !QUIET && DEF.tap) { try { DEF.tap.call(ME, e, ROOT); } catch (x) { post({ ct: "error", msg: String(x.message || x) }); } } });
  ROOT.addEventListener("submit", function (e) {
    e.preventDefault();
    if (ME && TAPS && !QUIET && DEF.submit) { try { DEF.submit.call(ME, e, ROOT, e.target); } catch (x) { post({ ct: "error", msg: String(x.message || x) }); } }
  }, true);
  D.addEventListener("DOMContentLoaded", function () { var L = EARLY; EARLY = null; send({ ct: "ready" }); L.forEach(send); });
})();
