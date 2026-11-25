/* Planes overhead: aircraft flying near your home right now */
Tile("planes", {
  title:"Planes overhead", cat:"Around you", every:15, size:[16, 12, 10, 8], noFit:true,
  takeover:"Take over the box when a plane is very close",
  desc:"Aircraft flying near your home right now, on a little map with the closest ones listed: flight, plane type, height and speed. Live data from adsb.lol, shared by plane spotters' receivers. Uses your location from Setup.",
  settings:{
    radius:{type:"int", label:"Look this far (miles; shown in km on a metric dashboard)", default:15, min:3, max:60},
    low:{type:"int", label:"Very close means under (feet)", default:5000, min:1000, max:30000},
    list:{type:"int", label:"Planes to list", default:3, min:0, max:6},
    hideEmpty:{type:"bool", label:"Hide when no planes are around", default:false}
  },
  css:`.m-planes{display:flex;gap:16px;padding:14px 16px}
    .m-planes .map{position:relative;flex:1 1 55%;min-width:0;border-radius:12px;background:radial-gradient(circle,rgba(124,183,255,.10),rgba(124,183,255,.02) 70%);overflow:hidden}
    .m-planes .ring{position:absolute;left:50%;top:50%;border:1px dashed var(--line);border-radius:50%;transform:translate(-50%,-50%)}
    .m-planes .home{position:absolute;left:50%;top:50%;width:10px;height:10px;margin:-5px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 5px rgba(124,183,255,.25)}
    .m-planes .pl{position:absolute;font-size:24px;line-height:1;margin:-12px;transition:left 14s linear,top 14s linear}
    .m-planes .pl.lf b{left:auto;right:24px}
    .m-planes .pl.up b{top:auto;bottom:2px}
    .m-planes .pl b{position:absolute;left:24px;top:2px;font-size:13px;font-weight:600;color:var(--dim);white-space:nowrap}
    .m-planes .side{flex:1 1 45%;min-width:0;display:flex;flex-direction:column}
    .m-planes .pr{padding:7px 0;border-bottom:1px solid var(--line)}
    .m-planes .pr:last-child{border-bottom:0}
    .m-planes .pr .f{font-size:24px;font-weight:600} .m-planes .pr .f span{font-size:17px;color:var(--dim);font-weight:400;margin-left:8px}
    .m-planes .pr .x{font-size:18px;color:var(--dim)}
    .m-planes.stack{flex-direction:column;gap:10px}
    .m-planes.stack .map{flex:1 1 40%;min-height:90px}
    .m-planes.stack .side{flex:1 1 60%}
    .m-planes .side:empty,.m-planes.nolist .side{display:none}
    .m-planes .cnt{position:absolute;left:10px;top:8px;font-size:15px;color:var(--dim)}`,
  cls:"m-planes",
  data(){ return tileData(this, "/planes?r=" + (this.s.radius || 15), 15); },
  near(d){
    const g = S("general"), k = Math.cos(g.lat * Math.PI / 180);
    return (d && d.planes || []).filter(p => !p.ground).map(p => {
      const dy = (p.lat - g.lat) * 69.05, dx = (p.lon - g.lon) * 69.05 * k;
      return Object.assign({}, p, {dx, dy, dist:Math.hypot(dx, dy)});
    }).sort((a, b) => a.dist - b.dist);
  },
  has(){ const d = this.data(); return !this.s.hideEmpty || this.near(d).length > 0; },
  urgent(){ return this.near(this.data()).some(p => p.alt != null && p.alt < (this.s.low || 5000) && p.dist < 3); },
  render(el){
    const g = S("general");
    if (!g.lat && !g.lon){ el.innerHTML = '<div class="empty">Set your location in Setup</div>'; return; }
    const d = this.data(), P = this.near(d), R = this.s.radius || 15;
    if (!el.querySelector(".map")) el.innerHTML = '<div class="map" data-keep><div class="ring" style="width:50%;height:50%"></div><div class="ring" style="width:98%;height:98%"></div><div class="home"></div></div><div class="side"></div>';
    // a narrow or tall box stacks the map above the list instead of dropping the map
    const slot = el.parentNode, narrow = el.clientWidth < 480 || (slot && /\bnarrow\b/.test(slot.className));
    el.classList.toggle("stack", narrow);
    const n = this.s.list == null ? 3 : this.s.list, met = g.units === "C";
    el.classList.toggle("nolist", n === 0);
    const map = el.querySelector(".map"), seen = new Set();
    for (const p of P.slice(0, 40)){
      const id = "p" + (p.reg || p.flight || p.lat).toString().replace(/\W/g, ""); seen.add(id);
      let e = map.querySelector('[data-p="' + id + '"]');
      if (!e){ e = document.createElement("div"); e.className = "pl"; e.dataset.p = id; map.appendChild(e); }
      e.innerHTML = '<span style="display:inline-block;transform:rotate(' + ((p.track || 0) - 45) + 'deg)">✈️</span><b>' + esc(p.flight || p.type || "") + '</b>';
      const px = 50 + p.dx / R * 49, py = 50 - p.dy / R * 49;
      e.style.left = px + "%"; e.style.top = py + "%";
      e.classList.toggle("lf", px > 62); e.classList.toggle("up", py > 85);   // labels stay inside the map
    }
    map.querySelectorAll(".pl").forEach(e => { if (!seen.has(e.dataset.p)) e.remove(); });
    const ft = v => v == null ? "" : Math.round(v / 100) * 100 >= 18000 ? "FL" + Math.round(v / 100) : met ? Math.round(v * .3048 / 10) * 10 + " m" : Math.round(v).toLocaleString() + " ft";
    const dist = v => met ? (v * 1.609).toFixed(1) + " km" : v.toFixed(1) + " mi", within = met ? Math.round(R * 1.609) + " km" : R + " mi";
    let cnt = map.querySelector(".cnt"); if (!cnt){ cnt = document.createElement("div"); cnt.className = "cnt"; map.appendChild(cnt); }
    cnt.textContent = n === 0 && P.length ? P.length + " within " + within : "";
    el.querySelector(".side").innerHTML = '<h3>' + esc(this.name) + '<small>' + (P.length ? P.length + " within " + within : "") + '</small></h3>' +
      (P.length ? P.slice(0, n).map(p => '<div class="pr"><div class="f">' + esc(p.flight || p.reg || "Unknown") + '<span>' + esc(p.desc || p.type || "") + '</span></div>' +
        '<div class="x">' + [ft(p.alt), p.speed ? (met ? Math.round(p.speed * 1.852) + " km/h" : Math.round(p.speed * 1.151) + " mph") : "", dist(p.dist) + " away"].filter(Boolean).join(" · ") + '</div></div>').join("")
        : '<div class="empty">' + (d && d.error ? "Can't reach the plane feed right now" : d ? "No planes nearby right now" : "Looking…") + '</div>');
  }
});
