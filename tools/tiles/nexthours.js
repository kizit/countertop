/* Next hours: a chart of temperature and rain for the rest of the day, with your events on it */
viewTile("nexthours", {
  title:"Next hours chart", cat:"Weather", size:[26, 18, 12, 8], feeds:["wx", "events"],
  desc:"A chart of the temperature and chance of rain for the next hours, with sunset and your events marked on it.",
  settings:{
    hours:{type:"int", label:"Hours on the chart", default:18, min:6, max:36},
    events:{type:"bool", label:"Show my events", default:true},
    cals:{type:"source", kind:"calendars", multi:true, label:"Events from", default:[]}
  },
  css:`.v-nexthours .tl{right:22px}
    .v-nexthours.sm .tl b{display:none} .v-nexthours.sm .tl span{font-size:17px;line-height:1.25}`
}, {
  build(box){ box.innerHTML = '<canvas data-keep></canvas><div class="ovl tl"><b>Next hours</b><span class="gs"></span></div>'; this.box = box; },
  show(){ this.drawn = Date.now(); this.wx = STATE.wx; this.ev = STATE.events; this.draw(); },
  draw(){
    const box = this.box, cv = box.querySelector("canvas"), W = box.clientWidth, H = box.clientHeight;
    if (!W || !H) return;
    box.classList.toggle("sm", H < 350);
    this.size = W + "x" + H;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
    const css = getComputedStyle(box), TX = css.getPropertyValue("--text").trim() || "#e9ecf1", DIM = css.getPropertyValue("--text-dim").trim() || "#98a0aa",
      INFO = css.getPropertyValue("--info").trim() || "#8fc3ff", ACC = css.getPropertyValue("--accent").trim() || "#7cb7ff";      // the chart's text and event colors follow the theme
    const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    const rows = hourlyFrom(STATE.wx, this.s.hours || 18);
    if (rows.length < 3){ c.fillStyle = DIM; c.font = "22px system-ui"; c.fillText(tr(STATE.noLoc ? "Set your location in Setup to see the forecast" : "Waiting for the forecast…"), 30, H / 2); return; }
    const compact = H < 350;
    const ovl = box.querySelector(".ovl"), top = (ovl ? ovl.offsetHeight : 0) + 18, labelY = top + 22;      // the summary sits top left: nothing is drawn under it
    const B = H - Math.min(120, H * .27), n = rows.length;
    const L = 40, R = W - 40, T = Math.min(B - 40, Math.max(Math.min(185, H * .55), labelY + 14 + (compact ? 38 : 86)));
    const X = i => L + (R - L) * i / (n - 1);
    const temps = rows.map(r => r.temp), lo = Math.min(...temps) - 3, hi = Math.max(...temps) + 3;
    const Y = v => B - (v - lo) / (hi - lo) * (B - T);
    const tOf = ms => { const f = (ms - rows[0].t) / (rows[n - 1].t - rows[0].t); return f >= 0 && f <= 1 ? L + (R - L) * f : null; };
    // night shading
    rows.forEach((r, i) => { if (!r.day && i < n - 1){ c.fillStyle = "rgba(10,14,40,.35)"; c.fillRect(X(i), 40, X(i + 1) - X(i) + 1, H - 40); } });
    // rain bars
    const bw = Math.max(6, (R - L) / n * .55);
    rows.forEach((r, i) => {
      if (!r.pp) return;
      const h = (H - B - 46) * r.pp / 100;
      c.fillStyle = r.pp >= 50 ? "rgba(110,175,255,.85)" : "rgba(110,175,255,.45)";
      c.beginPath(); c.roundRect ? c.roundRect(X(i) - bw / 2, H - 46 - h, bw, h, 4) : c.rect(X(i) - bw / 2, H - 46 - h, bw, h); c.fill();
      if (!compact && r.pp >= 30 && (i % 2 === 0 || n <= 12)){ c.fillStyle = INFO; c.font = "600 14px system-ui"; c.textAlign = "center"; c.fillText(r.pp + "%", X(i), H - 52 - h); }
    });
    // temperature area + line
    const grad = c.createLinearGradient(0, T, 0, B + 40);
    grad.addColorStop(0, "rgba(255,180,90,.45)"); grad.addColorStop(1, "rgba(255,180,90,0)");
    c.beginPath(); c.moveTo(X(0), Y(temps[0]));
    for (let i = 1; i < n; i++){ const xm = (X(i - 1) + X(i)) / 2; c.bezierCurveTo(xm, Y(temps[i - 1]), xm, Y(temps[i]), X(i), Y(temps[i])); }
    const line = new Path2D(); line.moveTo(X(0), Y(temps[0]));
    for (let i = 1; i < n; i++){ const xm = (X(i - 1) + X(i)) / 2; line.bezierCurveTo(xm, Y(temps[i - 1]), xm, Y(temps[i]), X(i), Y(temps[i])); }
    c.lineTo(X(n - 1), B + 40); c.lineTo(X(0), B + 40); c.closePath(); c.fillStyle = grad; c.fill();
    c.strokeStyle = "#ffbe6b"; c.lineWidth = 4; c.lineJoin = "round"; c.stroke(line);
    // labels: temp + icon every few hours, hour ticks
    const every = n > 24 ? 4 : n > 12 ? 3 : 2;
    c.textAlign = "center";
    rows.forEach((r, i) => {
      if (i % every) return;
      c.fillStyle = TX; c.font = compact ? "600 19px system-ui" : "600 22px system-ui";
      c.fillText(Math.round(r.temp) + "°", X(i), Y(r.temp) - (compact ? 21 : 34));
      if (!compact){ c.font = "24px system-ui"; c.fillText(wx(r.code, !r.day).g, X(i), Y(r.temp) - 62); }      // a short chart keeps the temperatures and drops the icons
      c.fillStyle = DIM; c.font = "16px system-ui";
      c.fillText(i === 0 ? tr("Now") : new Date(r.t).toLocaleTimeString([], {hour:"numeric"}).replace(" ", "").toLowerCase(), X(i), H - 20);
      c.fillStyle = TX; c.beginPath(); c.arc(X(i), Y(r.temp), 5, 0, 7); c.fill();
    });
    // sunrise / sunset markers
    const j = STATE.wx;
    if (j && j.daily && j.daily.sunrise){
      for (let k = 0; k < j.daily.sunrise.length; k++){
        for (const [v, g] of [[j.daily.sunrise[k], "🌅"], [j.daily.sunset[k], "🌇"]]){
          const x = tOf(new Date(v).getTime()); if (x == null) continue;
          c.strokeStyle = "rgba(255,210,120,.5)"; c.setLineDash([4, 6]); c.lineWidth = 2;
          c.beginPath(); c.moveTo(x, labelY + 8); c.lineTo(x, H - 44); c.stroke(); c.setLineDash([]);
          c.font = "18px system-ui"; c.fillStyle = "#ffd98a"; c.fillText(g + " " + fmtTime(new Date(v)).replace(/\s?([AP])M/i, (m, a) => a.toLowerCase()), x, labelY);
        }
      }
    }
    // events: a marker on the temperature line at the start time, a thin line down, and a label with time and temperature
    const tempAt = ms => { const f = (ms - rows[0].t) / 3600e3, i = Math.max(0, Math.min(n - 2, Math.floor(f))), u = Math.max(0, Math.min(1, f - i));
      return temps[i] + (temps[i + 1] - temps[i]) * u; };
    const evs = this.s.events === false ? [] : calEvents(this.s.cals).filter(e => !e.allDay).map(e => ({e, ms:evDate(e).getTime(), x:tOf(evDate(e).getTime())})).filter(p => p.x != null).slice(0, 6);
    let lastX = -1e9, row = 0;
    evs.forEach(p => {
      const tv = tempAt(p.ms), cy = Y(tv);
      row = p.x - lastX < 230 ? (row + 1) % 2 : 0;
      if (compact && row && p.x - lastX < 230) return;      // a short chart has one row of event labels, below the curve
      lastX = p.x;
      const ly = compact ? B + 14 : B - 16 - row * 32;
      c.strokeStyle = ACC; c.globalAlpha = .7; c.lineWidth = 2; c.setLineDash([3, 4]);
      c.beginPath(); c.moveTo(p.x, cy + 8); c.lineTo(p.x, ly - 12); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
      c.fillStyle = "#0b0f16"; c.strokeStyle = ACC; c.lineWidth = 3; c.beginPath(); c.arc(p.x, cy, 7, 0, 7); c.fill(); c.stroke();
      const nm = p.e.summary.length > 20 ? p.e.summary.slice(0, 19) + "…" : p.e.summary;
      const tx = shortTime(new Date(p.ms)) + " " + nm + " · " + Math.round(tv) + "°";
      c.font = "600 16px system-ui"; const tw = c.measureText(tx).width;
      let lx = p.x - tw / 2 - 8; lx = Math.max(L - 10, Math.min(R + 10 - tw - 16, lx));
      c.fillStyle = "rgba(20,40,70,.92)"; c.beginPath(); c.roundRect ? c.roundRect(lx, ly - 12, tw + 16, 26, 8) : c.rect(lx, ly - 12, tw + 16, 26); c.fill();
      c.fillStyle = TX; c.textAlign = "left"; c.fillText(tx, lx + 8, ly + 6); c.textAlign = "center";
    });
    // summary line
    let iHi = 0, iLo = 0; temps.forEach((v, i) => { if (v > temps[iHi]) iHi = i; if (v < temps[iLo]) iLo = i; });
    const hr = i => i === 0 ? tr("now") : new Date(rows[i].t).toLocaleTimeString([], {hour:"numeric"});
    const wet = rows.findIndex(r => r.pp >= 50);
    box.querySelector(".gs").textContent = tr("High {temp} {time}", {temp:Math.round(temps[iHi]) + "°", time:hr(iHi)}) + " · " + tr("Low {temp} {time}", {temp:Math.round(temps[iLo]) + "°", time:hr(iLo)}) +
      " · " + (wet < 0 ? tr("Dry") : SNOWY(rows[wet].code) ? tr(wet === 0 ? "Snow likely now" : "Snow likely from {time}", {time:hr(wet)}) : tr(wet === 0 ? "Rain likely now" : "Rain likely from {time}", {time:hr(wet)}));
    const oh = box.querySelector(".ovl").offsetHeight;
    if (oh !== this.ovh){ this.ovh = oh; this.draw(); }      // the summary's height decides where the chart starts
  },
  tick(){
    if (this.size !== this.box.clientWidth + "x" + this.box.clientHeight || Date.now() - this.drawn > 60e3 ||
        this.wx !== STATE.wx || this.ev !== STATE.events) this.show();
  },
  hide(){}
});
