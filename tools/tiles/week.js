/* Week ahead: a row of days with the weather, your events, holidays and matches */
Tile("week", {
  title:"Week ahead", cat:"Calendar", card:false, every:300, size:[48, 8, 24, 6], feeds:["wx", "events", "team"],
  css:".m-week .day > *{flex:none}",
  desc:"The next few days side by side: each day's weather, your events, holidays and your teams' matches. Today gets the most room.",
  settings:{
    days:{type:"int", label:"Days to show", default:7, min:3, max:7},
    perDay:{type:"int", label:"Events per day (more in a tall box)", default:2, min:0, max:4},
    cals:{type:"source", kind:"calendars", multi:true, label:"Calendars", default:[]},
    teams:{type:"source", kind:"teams", multi:true, label:"Teams' matches", default:[]},
    holidays:{type:"bool", label:"Holidays", default:true},
    weather:{type:"bool", label:"Show weather", default:true}
  },

  render(el){
    const s = this.s, j = s.weather === false ? null : STATE.wx, n = Math.max(3, Math.min(7, s.days || 7)), set = s.perDay == null ? 2 : s.perDay;
    const today = startOfDay(new Date());
    el.className = "m-week";
    const wrap = !EDIT.on && matchMedia("(orientation:portrait)").matches;
    const dayH = (el.clientHeight || 0) / (wrap ? 2 : 1), per = set > 0 && dayH > 380 ? Math.max(set, Math.floor((dayH - 150) / 36)) : set;      // a tall box shows more events; weekFit drops what doesn't fit
    const columns = Math.ceil((n + 1) / 2);
    el.style.gridTemplateColumns = wrap ? "repeat(" + columns + ",minmax(0,1fr))" : "2.1fr repeat(" + (n - 1) + ",1fr)";
    el.style.gridTemplateRows = wrap ? "repeat(2,minmax(0,1fr))" : "";
    let html = "";
    for (let i = 0; i < n; i++){
      const day = new Date(today.getTime() + i * 86400e3 + 3600e3 * 2); day.setHours(0,0,0,0);
      const dn = i === 0 ? tr("Today") : day.toLocaleDateString([], {weekday:"short"});
      let w = "", pp = "";
      if (j && j.daily && j.daily.time){
        const k = j.daily.time.findIndex(t => dayKey(new Date(t + "T00:00:00")) === dayKey(day));
        if (k >= 0){
          w = '<span>' + wx(j.daily.weather_code[k], false).g + '</span>' + Math.round(j.daily.temperature_2m_max[k]) + '° <small>/ ' + Math.round(j.daily.temperature_2m_min[k]) + '°</small>';
          const p = j.daily.precipitation_probability_max ? j.daily.precipitation_probability_max[k] : null;
          if (p != null && p >= 30) pp = "💧 " + p + "%";
        }
      }
      const hol = this.s.holidays === false ? "" : holidayOn(day), matches = teamMatchesOn(day, this.s.teams);
      let evs = eventsOn(day, this.s.cals);
      if (i === 0) evs = evs.filter(e => e.allDay || evDate(e).getTime() > Date.now() - 1800e3);
      const chips = [];
      if (hol) chips.push('<div class="ev hol">' + esc(hol) + '</div>');
      for (const {g:match, team, league} of matches) chips.push('<div class="ev team">' + (match.done ? "" : shortTime(new Date(match.date)) + " ") + sportIcon(league) + ' ' + esc(teamShort(team)) + (match.home ? " vs " : " @ ") + esc(match.opp) + '</div>');
      if (i === 0){
        evs.slice(0, 3).forEach(e => chips.push('<div class="ev"><em>' + (e.allDay ? tr("All day") : esc(fmtTime(evDate(e)))) + '</em>' + esc(e.summary) + '</div>'));
        if (!evs.length && !hol && !matches.length){
          const tm = eventsOn(new Date(today.getTime() + 86400e3 + 7200e3), this.s.cals)[0];
          chips.push('<div class="ev">' + tr("Nothing else today") + ' 🎉</div>');
          if (tm) chips.push('<div class="ev"><em>' + tr("Tomorrow") + '</em>' + esc(tm.summary) + (tm.allDay ? "" : " · " + esc(fmtTime(evDate(tm)))) + '</div>');
        }
      } else {
        evs.slice(0, per).forEach(e => chips.push('<div class="ev">' + (e.allDay ? "" : esc(shortTime(evDate(e))) + " ") + esc(e.summary) + '</div>'));
        if (evs.length > per) chips.push('<div class="more">+' + (evs.length - per) + ' more</div>');
      }
      html += '<div class="day' + (i === 0 ? " today" : "") + '"><div class="dn"><b' + (i === 0 ? " data-keep" : "") + '>' + dn + '</b><span>' +
        (i === 0 ? day.toLocaleDateString([], {weekday:"short", day:"numeric"}) : day.getDate()) + '</span></div>' +
        (j ? '<div class="w">' + w + '</div>' : "") + (i && j ? '<div class="pp">' + (pp || "&nbsp;") + '</div>' : "") + chips.join("") + '</div>';
    }
    el.innerHTML = html;
    if (wrap){
      el.firstElementChild.style.gridColumn = "span 2";
      el.lastElementChild.style.gridColumn = "span " + (columns * 2 - n);
    }
    weekFit(el); requestAnimationFrame(() => weekFit(el));
  }
});
// a short day box shows fewer events: drop the last ones that don't fit and say how many are hidden
function weekFit(el){
  for (const d of el.querySelectorAll(".day")){
    if (!d.clientHeight) continue;
    const m0 = d.querySelector(".more"), base = m0 ? +m0.textContent.replace(/\D/g, "") : 0;
    let hid = 0;
    const pp = d.querySelector(".pp");
    if (pp && d.scrollHeight > d.clientHeight + 1 && !pp.textContent.trim()) pp.remove();     // no rain line: give its room to an event
    while (d.scrollHeight > d.clientHeight + 1){
      const last = [...d.querySelectorAll(".ev:not(.hol):not(.team)")].pop() || [...d.querySelectorAll(".ev")].pop();
      if (!last) break;
      last.remove(); hid++;
      let m = d.querySelector(".more");
      if (!m){ m = document.createElement("div"); m.className = "more"; d.appendChild(m); }
      m.textContent = "+" + (base + hid) + " more";
    }
    for (const x of [".more", ".pp"]) if (d.scrollHeight > d.clientHeight + 1 && d.querySelector(x)) d.querySelector(x).remove();      // a very small box: no room even for the count
  }
}
