/* Your own tile: HTML you paste (or have ChatGPT write), run in its own frame */
Tile("custom", {
  // retired: Tile Studio (Controls → Library → Tiles) makes tiles now. Ones that already exist keep working; ones that
  // work in the sandbox were converted into Tile Studio tiles by the server (tools/server/mytiles.py)
  title:"Your own tile", cat:"Your own", cls:"m-mine", every:60, size:[12, 8, 4, 4], hidden:true,
  desc:"Paste HTML, CSS and JavaScript to make any tile you like, or have ChatGPT write it with the instructions in its settings. It runs in its own frame: it can't see or change the rest of the dashboard, and it can only load things from secure https:// addresses. Plain http:// addresses, which is how most devices on a home network answer, are blocked.",
  settings:{
    ask:{type:"text", share:false, label:"What should it show?", help:"Goes into the ChatGPT instructions below", placeholder:"e.g. days until summer vacation", default:""},
    html:{type:"code", label:"Code (HTML)", default:'<div style="display:grid;place-items:center;height:100%;font-size:40px">Hello 👋</div>'},
    every:{type:"int", label:"Reload every (minutes, 0 = never)", default:0, min:0, max:1440},
    taps:{type:"bool", label:"Let it respond to taps", default:false},
    frame:{type:"bool", label:"Show on a card", default:true},
    title:{type:"bool", label:"Show its name as a title", default:false}
  },
  // What the code may reach. A tile made before this limit keeps the access it had ("lan": true, set by the server's
  // settings upgrade and never by an import); every other one may only load and fetch from https:// addresses.
  // The rule is a <meta> policy placed first in <head>, before any of the tile's own code, so the code can only add
  // rules, never loosen them. connect-src https: also covers wss: (secure WebSockets).
  policy:"default-src https: data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src https:; img-src https: data: blob:; " +
    "media-src https: data: blob:; form-action 'none'; base-uri 'none'",
  css:".mine-ask{height:100%;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:10px;font-size:20px;line-height:1.3}" +
    ".mine-ask span{color:var(--dim)}.mine-ask button{font:inherit;font-weight:600;padding:10px 26px;border-radius:12px;border:0;background:var(--accent);color:#000}",
  lanOpen(){ return !!(this.it && this.it.lan === true); },
  waitsRun(){ return !!(this.it && this.it.review); },
  doc(html, open){
    const cs = getComputedStyle(document.documentElement), v = k => cs.getPropertyValue(k).trim();
    return '<!doctype html><html><head>' + (open ? "" : '<meta http-equiv="Content-Security-Policy" content="' + this.policy + '">') +
      '<meta charset="utf-8"><style>:root{--fg:' + (v("--fg") || "#e9ecf1") + ';--dim:' + (v("--dim") || "#a9b1bb") +
      ';--accent:' + (v("--accent") || "#5aa9ff") + '}html,body{margin:0;height:100%;background:transparent;color:var(--fg);' +
      'font:22px/1.3 -apple-system,system-ui,"Segoe UI",Roboto,sans-serif;overflow:hidden}</style></head><body>' + (html || "") + '</body></html>';
  },
  // shared code: the box says so and waits for Run (approving it is saved, so it asks once)
  askRun(el){
    const kb = Math.max(1, Math.round(new Blob([this.s.html || ""]).size / 1024));
    el.innerHTML = '<div class="mine-ask"><b>' + esc(this.name) + '</b><span>This tile came in a shared layout with its own code (' + kb + ' KB). ' +
      'It only runs if you say so.</span>' + (PREVIEW ? '<span>Tap Run on the dashboard to start it.</span>' : '<button type="button">Run it</button>') + '</div>';
    const b = el.querySelector("button");
    if (b) b.addEventListener("click", e => { e.stopPropagation(); if (!EDIT.on) this.runNow(); });
  },
  async runNow(){
    const it = this.it;
    try{ await fetch("/tile-trust/" + encodeURIComponent(this.id), {method:"POST", headers:{"Content-Type":"application/json"}, body:"{}"}); }catch(e){}
    delete it.review;          // a layout being tried isn't saved: it runs for now and asks again next time
    render(this.id);
  },
  // a note at the top of its settings in the editor
  editNote(){
    if (this.waitsRun()) return '<p class="pd"><b>Shared code, not run yet.</b> This tile came in a shared layout. Read its code below, and run it only if you trust it.</p>' +
      '<button class="wide" data-act="minerun">Run its code</button>';
    const L = (typeof LEGACY === "object" && LEGACY[this.id]) || null;
    const why = L && L.reasons && L.reasons.length ? '<p class="pd"><b>Your own tile is now Tile Studio.</b> This one stays as it is and keeps working, because: ' +
      esc(L.reasons.join("; ")) + '. Convert it in Controls → Library → Tiles when you\'re ready (the parts above stop working, and Restore puts it back).</p>' : "";
    if (this.lanOpen()) return why + '<p class="pd" style="color:var(--warn,#f5b84a)"><b>Can reach your home network.</b> This tile was made before Your own tiles were limited to secure https:// addresses, ' +
      'so its code can still reach plain http:// addresses and the devices on your home network that answer that way. Keep it only if you wrote it or trust whoever did.</p>';
    return why;
  },
  render(el){
    const s = this.s, open = this.lanOpen(), key = [s.html, s.title, s.taps, s.frame, this.name, THEME && THEME.id, open, this.waitsRun()].join("\u0001");
    el.classList.toggle("bare", s.frame === false);
    if (el._k !== key){
      el._k = key; el._at = Date.now();
      if (this.waitsRun()) return this.askRun(el);
      el.innerHTML = (s.title ? '<h3>' + esc(this.name) + '</h3>' : "") + '<iframe class="mine" data-keep sandbox="allow-scripts" referrerpolicy="no-referrer" title="' + esc(this.name) + '"></iframe>';
      const f = el.querySelector("iframe");
      f.style.pointerEvents = s.taps ? "auto" : "none";
      f.srcdoc = this.doc(s.html, open);
    } else if (!this.waitsRun() && +s.every > 0 && Date.now() - el._at > s.every * 60e3){ el._at = Date.now(); el.querySelector("iframe").srcdoc = this.doc(s.html, open); }
  }
});
