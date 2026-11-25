/* Weather now: temperature, conditions, high/low, air quality, sunrise and sunset */
Tile("weather", {
  title:"Weather now", cat:"Weather", card:false, size:[14, 6, 8, 4], feeds:["wx", "aqi"],
  desc:"The temperature right now with today's high and low. Can add air quality, sunrise and sunset, and a note when rain is coming. Uses your location from Setup.",
  settings:{
    style:{look:true, type:"choice", label:"Style", choices:["Classic", "Big temperature", "Compact", "Big icon", "Minimal"], default:"Classic", preview:true},
    font:{look:true, type:"choice", label:"Font", choices:["Style default", "System", "Outfit", "Bebas Neue", "DM Serif Display", "Fraunces", "JetBrains Mono", "Nunito", "Space Grotesk"], default:"Style default"},
    size:{look:true, type:"int", label:"Text size (%)", min:60, max:160, default:100},
    align:{look:true, type:"choice", label:"Align", choices:["Left", "Center", "Right"], default:"Right"},
    icon:{part:"icon", type:"bool", label:"Weather icon", default:true},
    cond:{part:"cond", type:"bool", label:"Conditions (\"Overcast\")", default:true},
    hilo:{part:"hilo", type:"bool", label:"Today's high and low", default:true},
    air:{part:"air", type:"bool", label:"Air quality", default:true},
    sun:{part:"sun", type:"bool", label:"Sunrise, sunset and moon", default:true},
    rain:{part:"rain", type:"bool", label:"Note when rain or snow is coming", default:true}
  },

  // the parts of the weather, for the tile designer
  parts(){
    const j = STATE.wx, o = ((designOf(this) || {}).parts || {}).icon || {};
    if (!j) return [{id:"msg", label:"Message", html:tr(STATE.noLoc ? "Set your location in Setup" : STATE.wxErr ? "Weather unavailable" : "Loading weather…")}];
    const cur = j.current, dd = j.daily, w = wx(cur.weather_code, cur.is_day === 0), hm = x => new Date(x).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
    return [
      {id:"icon", label:"Weather icon", html: o.set === "Symbols" ? wxSymbol(cur.weather_code, cur.is_day === 0) : w.g, icon:true},
      {id:"temp", label:"Temperature", html:Math.round(cur.temperature_2m) + "°", big:true},
      {id:"cond", label:"Conditions", html:esc(w.t)},
      {id:"hilo", label:"High and low", html:tr("H {high} · L {low}", {high:Math.round(dd.temperature_2m_max[0]) + "°", low:Math.round(dd.temperature_2m_min[0]) + "°"})},
      {id:"air", label:"Air quality", html:STATE.aqi != null ? tr("Air") + " " + Math.round(STATE.aqi) + " · " + this.aqiLabel(STATE.aqi) : ""},
      {id:"sun", label:"Sunrise and sunset", html:dd.sunrise ? "🌅 " + hm(dd.sunrise[0]) + "  ·  🌇 " + hm(dd.sunset[0]) : "", emoji:true},
      {id:"moon", label:"Moon", html:moon(new Date()).join(" "), emoji:true},
      {id:"rain", label:"Rain or snow coming", html:STATE.rain || ""}];
  },
  aqiLabel(v){ return tr(v <= 50 ? "Good" : v <= 100 ? "Moderate" : v <= 150 ? "Unhealthy (sensitive)" : v <= 200 ? "Unhealthy" : "Very unhealthy"); },

  render(el){
    if (designed(this)) return designRender(el, this);
    const j = STATE.wx, s = this.s, st = slug(s.style);
    if (!j){ el.innerHTML = '<div class="m-weather"><div class="m" data-part="msg">' + tr(STATE.noLoc ? "Set your location in Setup to see the weather" : STATE.wxErr ? "Weather unavailable" : "Loading weather…") + '</div></div>'; return; }
    const cur = j.current, dd = j.daily, w = wx(cur.weather_code, cur.is_day === 0);
    const parts = [], P = (id, h) => '<span data-part="' + id + '">' + h + '</span>';
    if (s.cond !== false) parts.push(P("cond", esc(w.t)));
    if (s.hilo !== false) parts.push(P("hilo", tr("H {high} · L {low}", {high:Math.round(dd.temperature_2m_max[0]) + "°", low:Math.round(dd.temperature_2m_min[0]) + "°"})));
    if (s.air && STATE.aqi != null) parts.push(P("air", tr("Air") + " " + Math.round(STATE.aqi) + " · " + this.aqiLabel(STATE.aqi)));
    let sub = "";
    if (s.sun && dd.sunrise){
      const hm = x => new Date(x).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
      sub = P("sun", "🌅 " + hm(dd.sunrise[0]) + "  ·  🌇 " + hm(dd.sunset[0])) + "  ·  " + P("moon", moon(new Date()).join(" "));
    }
    const line = st === "compact" || st === "minimal";
    el.innerHTML = '<div class="m-weather ws-' + st + '"><div class="row">' + (s.icon !== false ? '<div class="g" data-part="icon">' + w.g + '</div>' : "") +
      '<div class="tt" data-part="temp" data-keep>' + Math.round(cur.temperature_2m) + '°</div>' + (parts.length ? '<div class="m">' + parts.join(line ? "  ·  " : "<br>") + '</div>' : "") + '</div>' +
      (sub ? '<div class="s">' + sub + '</div>' : "") + (s.rain && STATE.rain ? '<div class="rn" data-part="rain">' + STATE.rain + '</div>' : "") + '</div>';
    styleBox(el.firstChild, s, st, "Right");
  }
});
