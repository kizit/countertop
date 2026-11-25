/* 10-day forecast: one row per day with a high/low bar */
Tile("forecast", {
  title:"10-day forecast", cat:"Weather", every:600, size:[12, 16, 10, 8], feeds:["wx"],
  desc:"The coming days, one row each: icon, chance of rain and a bar showing the low and high, so warm and cold spells stand out.",
  settings:{
    days:{type:"int", label:"Days", default:10, min:3, max:10},
    rain:{type:"bool", label:"Chance of rain", default:true}
  },
  css:`.m-fc .fr{display:grid;grid-template-columns:var(--fcols,3.2em 1.6em 2.6em 2.2em 1fr 2.2em);align-items:center;gap:10px;font-size:24px;padding:5px 0}
    .m-fc .fr .d{color:var(--dim)} .m-fc .fr .p{font-size:17px;color:var(--info);text-align:right}
    .m-fc .fr .lo{color:var(--dim);text-align:right} .m-fc .bar{position:relative;height:8px;border-radius:4px;background:var(--inset)}
    .m-fc .bar i{position:absolute;top:0;bottom:0;border-radius:4px;background:linear-gradient(90deg,#7cc4ff,#ffd166,#ff8a5c)}`,
  cls:"m-fc",
  render(el){
    const j = STATE.wx;
    if (!j){ el.innerHTML = '<h3>' + esc(this.name) + '</h3><div class="empty">' + tr(STATE.noLoc ? "Set your location in Setup" : "Loading…") + '</div>'; return; }
    const D = j.daily, n = Math.min(this.s.days || 10, D.time.length);
    const lo = Math.min(...D.temperature_2m_min.slice(0, n)), hi = Math.max(...D.temperature_2m_max.slice(0, n)), span = Math.max(1, hi - lo);
    const rain = this.s.rain !== false, dflt = !this.name || this.name === this.title || this.name === tr(this.title);      // a name you chose is kept as it is
    let h = '<h3>' + esc(dflt ? tr("{n}-day forecast", {n}) : this.name) + '</h3><div class="rows" data-keep>';
    for (let i = 0; i < n; i++){
      const d = new Date(D.time[i] + "T12:00"), a = D.temperature_2m_min[i], b = D.temperature_2m_max[i], p = (D.precipitation_probability_max || [])[i];
      h += '<div class="fr"><span class="d">' + (i === 0 ? tr("Today") : d.toLocaleDateString([], {weekday:"short"})) + '</span><span>' + wx(D.weather_code[i]).g + '</span>' +
        (rain ? '<span class="p">' + (p >= 20 ? p + "%" : "") + '</span>' : "") + '<span class="lo">' + Math.round(a) + '°</span>' +
        '<span class="bar"><i style="left:' + ((a - lo) / span * 100).toFixed(1) + '%;right:' + ((hi - b) / span * 100).toFixed(1) + '%"></i></span><span>' + Math.round(b) + '°</span></div>';
    }
    el.innerHTML = h + '</div>';
    el.style.setProperty("--fcols", rain ? "" : "3.2em 1.6em 2.2em 1fr 2.2em");
  }
});
