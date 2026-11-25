/* Tempo: France's RTE Tempo electricity days — today's and tomorrow's color (blue, white, red),
   the current price and off-peak state, read from the Tempo sensors in Home Assistant. */
Tile("tempo", {
  title:"Tempo", cat:"Home",
  // the tile's own French, from its original French version (see docs/languages.md)
  lang:{fr:{"Today":"Aujourd'hui", "Tomorrow":"Demain", "Blue":"Bleu", "White":"Blanc", "Red":"Rouge", "Due this evening":"Annoncé le soir",
    "Off-peak hours":"Heures creuses", "Peak hours":"Heures pleines", "Days left":"Reste", "blue":"bleu", "white":"blanc", "red":"rouge"}}, cls:"m-tempo", size:[12, 8, 8, 6], every:5, needs:"homeassistant",
  desc:"France's RTE Tempo electricity days: today's and tomorrow's color (blue, white, red), the current price per kWh and whether it's off-peak hours right now, read from the Tempo sensors in Home Assistant. Optionally shows the days left in the cycle for each color.",
  settings:{
    src:{type:"source", kind:"homeassistant", label:"Home Assistant", default:""},
    today:{type:"entity", label:"Today's color", default:"sensor.rte_tempo_couleur_actuelle"},
    tomorrow:{type:"entity", label:"Tomorrow's color", default:"sensor.rte_tempo_prochaine_couleur"},
    price:{type:"entity", label:"Current price (€/kWh)", default:"sensor.prix_tempo_courant"},
    offpeak:{type:"entity", label:"Off-peak sensor (on during off-peak hours)", default:"binary_sensor.rte_tempo_heures_creuses"},
    cycle:{type:"bool", label:"Show the days left in the cycle, per color", default:true},
    cycleBlue:{type:"entity", label:"Blue days left", default:"sensor.rte_tempo_cycle_jours_restants_bleu"},
    cycleWhite:{type:"entity", label:"White days left", default:"sensor.rte_tempo_cycle_jours_restants_blanc"},
    cycleRed:{type:"entity", label:"Red days left", default:"sensor.rte_tempo_cycle_jours_restants_rouge"}
  },
  css:`.m-tempo{display:flex;flex-direction:column}
    .m-tempo h3 small{float:right}
    .m-tempo .trow{flex:1;display:flex;gap:10px;min-height:0;align-items:stretch;padding:4px 0}
    .m-tempo .tc{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;border-radius:16px;padding:8px 6px;min-height:0;overflow:hidden}
    .m-tempo .tc small{font-size:14px;letter-spacing:.6px;text-transform:uppercase;opacity:.85;white-space:nowrap}
    .m-tempo .tc b{font-size:27px;font-weight:600;line-height:1.1;white-space:nowrap}
    .m-tempo .tc.bleu{background:#2563eb;color:#fff}
    .m-tempo .tc.blanc{background:#e8ebf2;color:#1c2433}
    .m-tempo .tc.rouge{background:#c0392e;color:#fff}
    .m-tempo .tc.none{background:var(--inset);color:var(--dim)}
    .m-tempo .tc.none b{font-size:17px;font-weight:400}
    .m-tempo .tpr{display:flex;align-items:center;justify-content:center;gap:7px;font-size:18px;color:var(--dim);padding-top:2px;white-space:nowrap}
    .m-tempo .tpr b{color:var(--text);font-weight:600}
    .m-tempo .tpr .hc{color:var(--ok)}
    .m-tempo .tcyc{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:2px 9px;font-size:15px;color:var(--dim);padding-top:3px}
    .m-tempo .tcyc > span{white-space:nowrap}
    .m-tempo .tcyc b{font-weight:600}
    .m-tempo .tcyc .b{color:#9ec5ff}.m-tempo .tcyc .w{color:#f0f3f8}.m-tempo .tcyc .r{color:#ff9f9f}`,

  render(el){
    const s = this.s;
    const CYCLE = s.cycle !== false ? [s.cycleBlue, s.cycleWhite, s.cycleRed] : [];
    const ids = [s.today, s.tomorrow, s.price, s.offpeak].concat(CYCLE).filter(Boolean);
    const d = tileData(this, HA.url(this, ids), 5);
    let h = '<h3><span>' + esc(this.name) + '</span><small>RTE Tempo</small></h3>';
    if (!d){ el.innerHTML = h + '<div class="empty">' + this.t("Loading…") + '</div>'; return; }
    if (d.error){ el.innerHTML = h + '<div class="empty">' + esc(d.error) + '</div>'; return; }
    const st = {};
    (d.states || []).forEach(x => { st[x.id] = x; });
    const col = v => {
      v = String(v == null ? "" : v).toLowerCase();
      if (!v || v === "unknown" || v === "unavailable" || v === "none") return null;
      if (v.includes("bleu") || v.includes("blue") || v === "🔵") return "bleu";
      if (v.includes("blanc") || v.includes("white") || v === "⚪" || v === "⚪️") return "blanc";
      if (v.includes("rouge") || v.includes("red") || v === "🔴") return "rouge";
      return null;
    };
    const cT = col(st[s.today] && st[s.today].state), cM = col(st[s.tomorrow] && st[s.tomorrow].state);
    const LABEL = {bleu:"Blue", blanc:"White", rouge:"Red"};
    h += '<div class="trow" data-keep>' +
      '<div class="tc ' + (cT || "none") + '"><small>' + this.t("Today") + '</small><b>' + (cT ? this.t(LABEL[cT]) : "—") + '</b></div>' +
      '<div class="tc ' + (cM || "none") + '"><small>' + this.t("Tomorrow") + '</small><b>' + (cM ? this.t(LABEL[cM]) : (st[s.tomorrow] ? this.t("Due this evening") : "—")) + '</b></div>' +
      '</div>';
    const hc = st[s.offpeak] && st[s.offpeak].state === "on";
    const pr = st[s.price] && col2num(st[s.price].state);
    h += '<div class="tpr"><span class="' + (hc ? "hc" : "") + '">' + this.t(hc ? "Off-peak hours" : "Peak hours") + '</span>' +
      (pr != null ? '<span>·</span><b>' + esc(pr.toLocaleString([], {maximumFractionDigits:4})) + ' €</b><span>/kWh</span>' : "") + '</div>';
    if (CYCLE.length){
      const c = CYCLE.map(id => col2num(id && st[id] && st[id].state));
      if (c.some(v => v != null)) h += '<div class="tcyc"><span>' + this.t("Days left") + '</span>' +
        '<span><b class="b">' + (c[0] != null ? c[0] : "—") + '</b> ' + this.t("blue") + '</span><span>·</span>' +
        '<span><b class="w">' + (c[1] != null ? c[1] : "—") + '</b> ' + this.t("white") + '</span><span>·</span>' +
        '<span><b class="r">' + (c[2] != null ? c[2] : "—") + '</b> ' + this.t("red") + '</span></div>';
    }
    el.innerHTML = h;

    function col2num(v){
      const n = parseFloat(v);
      return isFinite(n) ? n : null;
    }
  }
});
