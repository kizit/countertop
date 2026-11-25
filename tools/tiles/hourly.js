/* Hourly strip: the next few hours, one column each */
Tile("hourly", {
  title:"Hourly strip", cat:"Weather", card:false, every:600, size:[24, 6, 12, 4], feeds:["wx"],
  desc:"The next few hours in a row: time, icon, temperature and chance of rain.",
  settings:{ hours:{type:"int", label:"Hours", default:6, min:3, max:12} },

  render(el){
    const j = STATE.wx; el.className = "m-hourly";
    if (!j){ el.innerHTML = '<div class="hour"><div class="h">' + (STATE.noLoc ? tr("Set your location in Setup") : "…") + '</div></div>'; return; }
    const H = j.hourly, n = this.s.hours || 6, i0 = Math.max(0, H.time.findIndex(t => new Date(t) >= new Date()));
    let h = "";
    for (let i = i0; i < i0 + n && i < H.time.length; i++){
      const p = H.precipitation_probability ? H.precipitation_probability[i] : null;
      h += '<div class="hour"><div class="h">' + new Date(H.time[i]).toLocaleTimeString([], {hour:"numeric"}) + '</div><div class="t" data-keep>' +
        wx(H.weather_code[i], H.is_day && H.is_day[i] === 0).g + " " + Math.round(H.temperature_2m[i]) + '°</div><div class="p">' + (p > 15 ? p + "%" : "&nbsp;") + '</div></div>';
    }
    el.innerHTML = h;
  }
});
