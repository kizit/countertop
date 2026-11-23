/* Home: lights, switches, thermostats, covers, locks, alarms... from Home Assistant, all controllable from the screen */
const HA = {
  // what a plain tap on the row does ("toggle" or "run"); rows without an entry are driven by their buttons only
  TAP:{light:"toggle", switch:"toggle", fan:"toggle", input_boolean:"toggle", scene:"run", script:"run", cover:"toggle", vacuum:"toggle", media_player:"media_play_pause",
    sensor:"update_entity", binary_sensor:"update_entity", device_tracker:"update_entity", person:"update_entity", button:"press", input_button:"press"},
  // domains the tile can show controls for (used by both the Home tile and the Sensor tile)
  CTRL:{light:1, switch:1, fan:1, input_boolean:1, scene:1, script:1, climate:1, water_heater:1, cover:1, lock:1, media_player:1, vacuum:1, alarm_control_panel:1,
    number:1, input_number:1, select:1, input_select:1, button:1, input_button:1, sensor:1, binary_sensor:1, device_tracker:1, person:1},
  ICON:{light:"💡", switch:"🔌", fan:"🌀", input_boolean:"🔘", scene:"🎬", script:"▶️", lock:"🔒", climate:"🌡️", water_heater:"🚿", media_player:"🎵",
    vacuum:"🧹", lawn_mower:"🌱", weather:"⛅", alarm_control_panel:"🛡️", camera:"📷", person:"🧑", device_tracker:"🧑", humidifier:"💧", valve:"🚰",
    siren:"🚨", update:"⬆️", calendar:"📅", todo:"📝", sun:"☀️"},
  DC:{door:"🚪", garage_door:"🚗", garage:"🚗", window:"🪟", opening:"🚪", motion:"🏃", occupancy:"🏃", presence:"🏠", moisture:"💧", smoke:"🔥", gas:"⚠️",
    carbon_monoxide:"⚠️", temperature:"🌡️", humidity:"💧", power:"⚡", energy:"⚡", battery:"🔋", illuminance:"☀️", carbon_dioxide:"🌫️", pm25:"🌫️",
    shade:"🪟", blind:"🪟", curtain:"🪟", shutter:"🪟", plug:"🔌", outlet:"🔌", connectivity:"📶", problem:"⚠️", safety:"⚠️", sound:"🔊", vibration:"📳"},
  icon(o){
    if (o.domain === "lock") return o.state === "locked" ? "🔒" : "🔓";
    if (o.domain === "cover") return o.dc === "garage" ? "🚗" : o.dc === "door" || o.dc === "gate" ? "🚪" : "🪟";
    return this.DC[o.dc] || this.ICON[o.domain] || "•";
  },
  cap(t){ t = String(t == null ? "" : t).replace(/_/g, " "); return t.charAt(0).toUpperCase() + t.slice(1); },
  num(v){ const n = parseFloat(v); if (!isFinite(n) || String(v).trim() === "" || /[^\d.\-e+]/i.test(String(v).trim())) return null;
    return Math.abs(n) >= 100 ? Math.round(n).toLocaleString() : (Math.round(n * 10) / 10).toString(); },
  clamp(n, lo, hi){ return Math.max(lo == null ? -1e9 : lo, Math.min(hi == null ? 1e9 : hi, n)); },
  // the state in plain words, the way you'd say it in the kitchen
  text(o){
    const s = o.state, dc = o.dc;
    if (s === "unavailable" || s === "missing") return s === "missing" ? "Not found" : "Unavailable";
    if (s === "unknown") return o.domain === "scene" || o.domain === "script" ? "" : "Unknown";
    if (o.domain === "binary_sensor"){
      const on = s === "on", W = {door:["Open", "Closed"], garage_door:["Open", "Closed"], window:["Open", "Closed"], opening:["Open", "Closed"],
        motion:["Motion", "Clear"], occupancy:["Someone there", "Clear"], presence:["Home", "Away"], moisture:["Wet", "Dry"], smoke:["Smoke!", "Clear"],
        gas:["Gas!", "Clear"], carbon_monoxide:["CO!", "Clear"], battery:["Low", "OK"], plug:["Plugged in", "Unplugged"], connectivity:["Connected", "Offline"],
        problem:["Problem", "OK"], lock:["Unlocked", "Locked"]}[dc] || ["On", "Off"];
      return on ? W[0] : W[1];
    }
    if (o.domain === "person" || o.domain === "device_tracker") return s === "home" ? "Home" : s === "not_home" ? "Away" : this.cap(s);
    if (o.domain === "climate" || o.domain === "water_heater") return (o.current != null ? this.num(o.current) + "°" : "") + (o.target != null ? " → " + this.num(o.target) + "°" : "") || this.cap(s);
    if (o.domain === "weather") return (o.temp != null ? this.num(o.temp) + (o.unit || "°") + " · " : "") + this.cap(s.replace("partlycloudy", "partly cloudy").replace("clear-night", "clear"));
    if (o.domain === "media_player") return o.media || this.cap(s);
    if (o.domain === "alarm_control_panel") return this.cap(s.replace(/_/g, " "));
    const n = this.num(s);
    if (n != null) return n + (o.unit ? (/^°|%$/.test(o.unit) ? "" : " ") + o.unit : "");
    return this.cap(s);
  },
  // worth a glance: a door left open, a lock left unlocked, water on the floor
  alert(o){
    const s = o.state;
    if (o.domain === "lock") return s === "unlocked" || s === "open" || s === "jammed";
    if (o.domain === "cover") return (o.dc === "garage" || o.dc === "door" || o.dc === "gate") && s !== "closed";
    if (o.domain === "binary_sensor") return s === "on" && /^(door|garage_door|window|opening|moisture|smoke|gas|carbon_monoxide|problem|safety|lock)$/.test(o.dc);
    if (o.domain === "alarm_control_panel") return s === "triggered";
    return false;
  },
  isOn(o){ return ["on", "open", "playing", "home", "unlocked", "armed_home", "armed_away", "armed_night", "armed_vacation"].includes(o.state); },
  ago(iso){
    const t = Date.parse(iso); if (!t) return "";
    const m = Math.round((Date.now() - t) / 60e3);
    return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago";
  },
  url(t, ids){ return "/ha/states?src=" + encodeURIComponent(t.s.src || "") + "&ids=" + encodeURIComponent(ids.join(",")); },
  setup(t){ return !(SOURCES.homeassistant || []).length; },
  stateOf(tile, id){ const c = tile._fd, l = c && c.data && (c.data.states || []); return l && l.find(o => o.id === id); },
  // the "names" setting: "entity_id = Display name" per ";" — or, with no "=", a plain name for fallbackId (the shown entity)
  namemap(s, fallbackId){
    const raw = String((s && s.names) || ""), m = {};
    let hasEq = false;
    raw.split(";").forEach(part => {
      const i = part.indexOf("=");
      if (i > 0){ hasEq = true; const id = part.slice(0, i).trim(), nm = part.slice(i + 1).trim(); if (id && nm) m[id] = nm; }
    });
    if (!hasEq){ const nm = raw.trim(); if (nm && fallbackId) m[fallbackId] = nm; }
    return m;
  },
  // translate a button press into a Home Assistant service call {action, data}
  act(o, act, v){
    const dom = o.domain;
    if (dom === "climate" || dom === "water_heater"){
      if (act === "inc" || act === "dec"){
        let t = (o.target != null ? o.target : (o.current != null ? o.current : 20)) + (act === "inc" ? 0.5 : -0.5);
        t = Math.round(this.clamp(t, o.min, o.max) * 2) / 2;
        return {action:"set_temperature", data:{temperature:t}};
      }
      if (act === "mode") return {action: dom === "climate" ? "set_hvac_mode" : "set_operation_mode", data: dom === "climate" ? {hvac_mode:v} : {operation_mode:v}};
    }
    if (dom === "light" && (act === "inc" || act === "dec")){
      let l = (o.level != null ? o.level : 50) + (act === "inc" ? 10 : -10);
      l = Math.round(this.clamp(l, o.min != null ? o.min : 1, o.max != null ? o.max : 100));
      return {action:"turn_on", data:{brightness_pct:l}};
    }
    if (dom === "fan" && (act === "inc" || act === "dec")){
      let l = (o.level != null ? o.level : 50) + (act === "inc" ? 10 : -10);
      l = Math.round(this.clamp(l, 0, 100));
      return {action:"set_percentage", data:{percentage:l}};
    }
    if (dom === "cover"){
      if (act === "open") return {action:"open_cover"};
      if (act === "close") return {action:"close_cover"};
      if (act === "stop") return {action:"stop_cover"};
      if (act === "inc" || act === "dec"){
        let p = (o.level != null ? o.level : 50) + (act === "inc" ? 10 : -10);
        p = Math.round(this.clamp(p, 0, 100));
        return {action:"set_cover_position", data:{position:p}};
      }
    }
    if (dom === "lock" && v) return {action:v};
    if (dom === "media_player"){
      if (act === "pp") return {action:"media_play_pause"};
      if (act === "play") return {action: o.state === "playing" ? "media_pause" : "media_play"};
      if (act === "next") return {action:"media_next_track"};
      if (act === "prev") return {action:"media_previous_track"};
      if (act === "inc" || act === "dec"){
        let vol = (o.vol != null ? o.vol : 30) + (act === "inc" ? 5 : -5);
        vol = Math.round(this.clamp(vol, 0, 100));
        return {action:"volume_set", data:{volume_level: vol / 100}};
      }
    }
    if (dom === "vacuum"){
      if (act === "start") return {action:"start"};
      if (act === "pause") return {action:"pause"};
      if (act === "dock") return {action:"return_to_base"};
    }
    if (dom === "alarm_control_panel" && v) return {action:v};
    if (dom === "number" || dom === "input_number"){
      if (act === "inc" || act === "dec"){
        const step = o.step || 1;
        let val = (parseFloat(o.state) || 0) + (act === "inc" ? step : -step);
        val = Math.round(this.clamp(val, o.min, o.max) / step) * step;
        return {action:"set_value", data:{value: val}};
      }
    }
    if (dom === "select" || dom === "input_select"){
      if (act === "option") return {action:"select_option", data:{option:v}};
      if (act === "next") return {action:"select_next"};
      if (act === "prev") return {action:"select_previous"};
    }
    if (dom === "button" || dom === "input_button"){
      if (act === "press") return {action:"press"};
    }
    if (act === "refresh") return {action:"update_entity"};
    return null;
  },
  // what the row should show right away, before Home Assistant answers
  patch(action, data, st){
    const p = {}, on = this.isOn(st);
    if (action === "toggle") p.state = on ? "off" : "on";
    else if (action === "turn_on") p.state = "on";
    else if (action === "turn_off") p.state = "off";
    else if (action === "set_temperature") p.target = data && data.temperature;
    else if (action === "set_hvac_mode") p.state = data && data.hvac_mode;
    else if (action === "set_operation_mode") p.state = data && data.operation_mode;
    else if (action === "set_away_mode") p.away = data && data.away_mode;
    else if (action === "set_percentage"){ p.level = data && data.percentage; p.state = p.level > 0 ? "on" : "off"; }
    else if (action === "set_cover_position") p.level = data && data.position;
    else if (action === "open_cover"){ p.level = 100; p.state = "open"; }
    else if (action === "close_cover"){ p.level = 0; p.state = "closed"; }
    else if (action === "lock") p.state = "locked";
    else if (action === "unlock") p.state = "unlocked";
    else if (action === "open") p.state = "open";
    else if (action === "volume_set") p.vol = Math.round((data && data.volume_level || 0) * 100);
    else if (action === "media_play") p.state = "playing";
    else if (action === "media_pause" || action === "media_stop") p.state = "paused";
    else if (action === "media_play_pause") p.state = st.state === "playing" ? "paused" : "playing";
    else if (action === "disarm") p.state = "disarmed";
    else if (action === "arm_home") p.state = "armed_home";
    else if (action === "arm_away") p.state = "armed_away";
    else if (action === "arm_night") p.state = "armed_night";
    else if (action === "arm_vacation") p.state = "armed_vacation";
    else if (action === "start") p.state = "cleaning";
    else if (action === "pause") p.state = "paused";
    else if (action === "return_to_base") p.state = "returning";
    else if (action === "set_value") p.state = data && data.value != null ? String(data.value) : p.state;
    else if (action === "select_option") p.state = data && data.option;
    if (action === "turn_on" && data && data.brightness_pct != null){ p.level = data.brightness_pct; p.state = "on"; }
    return p;
  },
  // the buttons on the right of a row (shared by the Home tile and the Sensor tile)
  // locks, alarm panels and garage doors, gates and doors: shown, but not controlled from the screen
  secure(o){ return o.domain === "lock" || o.domain === "alarm_control_panel" || (o.domain === "cover" && /^(garage|gate|door)$/.test(o.dc || "")); },
  // a lock, alarm or garage door on a tile that doesn't allow them: shown, not controllable (the server checks this too)
  held(o, s){ return this.secure(o) && !(s && s.secure); },
  controls(o, taps, s){
    const dom = o.domain, gone = o.state === "unavailable" || o.state === "missing";
    if (gone || this.held(o, s)) return '<span class="st">' + esc(HA.text(o)) + '</span>';
    const id = esc(o.id), C = [], tapDef = taps ? this.TAP[dom] : null;
    const step = (act, label) => '<span class="step"><button data-ha="' + id + '" data-act="dec">−</button><b>' + label + '</b><button data-ha="' + id + '" data-act="inc">+</button></span>';
    if (dom === "climate" || dom === "water_heater"){
      if (o.target != null) C.push(step(null, this.num(o.target) + "°"));
      else C.push('<span class="st">' + esc(this.cap(o.state)) + '</span>');
    }
    else if (dom === "light" && o.level != null && o.state === "on") C.push(step(null, o.level + "%"));
    else if (dom === "fan" && o.level != null && o.state === "on") C.push(step(null, o.level + "%"));
    else if (dom === "cover"){
      C.push('<span class="cbtn" data-ha="' + id + '" data-act="close" title="Close">▼</span>');
      C.push('<span class="st">' + (o.level != null ? o.level + "%" : esc(this.cap(o.state))) + '</span>');
      C.push('<span class="cbtn" data-ha="' + id + '" data-act="open" title="Open">▲</span>');
      C.push('<span class="cbtn" data-ha="' + id + '" data-act="stop" title="Stop">■</span>');
    }
    else if (dom === "lock"){
      const locked = o.state === "locked";
      C.push('<span class="cbtn' + (locked ? "" : " on") + '" data-ha="' + id + '" data-act="lock" data-v="' + (locked ? "unlock" : "lock") + '">' + (locked ? "🔓 Unlock" : "🔒 Lock") + '</span>');
    }
    else if (dom === "media_player"){
      C.push('<span class="cbtn" data-ha="' + id + '" data-act="prev">⏮</span>');
      C.push('<span class="cbtn" data-ha="' + id + '" data-act="play">' + (o.state === "playing" ? "⏸" : "▶") + '</span>');
      C.push('<span class="cbtn" data-ha="' + id + '" data-act="next">⏭</span>');
      if (o.vol != null) C.push(step(null, o.vol + "%"));
    }
    else if (dom === "vacuum"){
      if (o.state === "docked" || o.state === "idle") C.push('<span class="cbtn on" data-ha="' + id + '" data-act="start">▶ Start</span>');
      else { C.push('<span class="cbtn" data-ha="' + id + '" data-act="pause">⏸</span><span class="cbtn" data-ha="' + id + '" data-act="dock">🏠 Base</span>'); }
    }
    else if (dom === "alarm_control_panel"){
      const F = o.feats || 0, modes = [["disarm", "Disarm", true], ["arm_home", "Home", !!(F & 1)], ["arm_away", "Away", !!(F & 2)], ["arm_night", "Night", !!(F & 4)], ["arm_vacation", "Vacation", !!(F & 8)]];
      C.push(modes.filter(m => m[2]).map(m => '<span class="chip' + (o.state === m[0] || (m[0] === "disarm" && o.state === "disarmed") ? " on" : "") + '" data-ha="' + id + '" data-act="alarm" data-v="' + m[0] + '">' + m[1] + '</span>').join(""));
    }
    else if (dom === "number" || dom === "input_number"){
      const u = o.unit ? (/^°|%$/.test(o.unit) ? o.unit : " " + o.unit) : "";
      C.push(step(null, (this.num(o.state) != null ? this.num(o.state) : o.state) + u));
    }
    else if (dom === "select" || dom === "input_select"){
      C.push((o.options || []).map(op => '<span class="chip' + (o.state === op ? " on" : "") + '" data-ha="' + id + '" data-act="option" data-v="' + esc(op) + '">' + esc(this.cap(op)) + '</span>').join(""));
      if (!C.length) C.push('<span class="st">' + esc(this.cap(o.state)) + '</span>');
    }
    else if (dom === "button" || dom === "input_button"){
      C.push('<span class="cbtn on" data-ha="' + id + '" data-act="press">▶ Press</span>');
    }
    else if (dom === "sensor" || dom === "binary_sensor" || dom === "device_tracker" || dom === "person"){
      C.push('<span class="cbtn" data-ha="' + id + '" data-act="refresh" title="Refresh now">🔄</span>');
    }
    if (tapDef === "toggle") C.push('<span class="tg' + (this.isOn(o) && o.domain !== "cover" ? " on" : "") + '"></span>');
    else if (tapDef === "run") C.push('<span class="run">Run</span>');
    else if (!C.length) C.push('<span class="st">' + esc(this.text(o)) + '</span>');
    return '<span class="ctl">' + C.join("") + '</span>';
  },
  // mode chips shown under a thermostat's name
  modeChips(o){
    if ((o.domain !== "climate" && o.domain !== "water_heater") || !o.modes || !o.modes.length) return "";
    return o.modes.map(m => '<button class="chip' + (o.state === m ? " on" : "") + '" data-ha="' + esc(o.id) + '" data-act="mode" data-v="' + esc(m) + '">' + esc(this.cap(m)) + '</button>').join(" ");
  },
  bind(el, tile){
    if (el._haTap) return; el._haTap = true;
    el.addEventListener("click", e => {
      if (EDIT.on || PREVIEW) return;
      const b = e.target.closest("[data-act]");
      if (b){
        const id = b.getAttribute("data-ha"), st = HA.stateOf(tile, id);
        const a = st && HA.act(st, b.getAttribute("data-act"), b.getAttribute("data-v"));
        if (a){ e.preventDefault(); e.stopPropagation(); HA.send(tile, id, a.action, a.data, st); }
        return;
      }
      const r = e.target.closest("[data-ha]");
      if (r){
        const id = r.getAttribute("data-ha"), st = HA.stateOf(tile, id), kind = st && HA.TAP[id.split(".")[0]];
        if (st && kind) HA.send(tile, id, kind === "run" ? "turn_on" : kind, {}, st);
      }
    });
  },
  send(tile, id, action, data, st){
    const c = tile._fd, opt = tile._opt = tile._opt || {};
    // a lock, alarm or garage door asks for a second tap: the server hands out a token the second tap brings back
    const cf = tile._confirm && tile._confirm.id === id && tile._confirm.action === action && tile._confirm.until > Date.now() ? tile._confirm : null;
    tile._confirm = null;
    opt[id] = {patch: HA.patch(action, data, st) || {}, until: Date.now() + 6000};   // show the change right away
    render(tile.id);
    tile.act("ha.call", {entity:id, action:action, data:data || {}, confirm:cf ? cf.token : ""})
      .then(j => {
        delete opt[id];
        if (j.confirm){
          const nm = HA.namemap(tile.s)[id] || (st && st.name) || id;
          tile._confirm = {id, action, token:j.confirm, until:Date.now() + (j.seconds || 6) * 1000};
          tile._msg = {text:"Tap again to " + HA.verb(action) + " " + nm, until:tile._confirm.until, ask:true};
          setTimeout(() => render(tile.id), (j.seconds || 6) * 1000 + 50);
          return;
        }
        tile._msg = null;
        if (j.state && c && c.data){ const i = (c.data.states || []).findIndex(o => o.id === id); if (i >= 0) c.data.states[i] = j.state; }
      })
      .catch(e => { delete opt[id]; tile._msg = {text:"Didn't work: " + (e.message || e), until: Date.now() + 6000}; })
      .finally(() => { if (c) c.at = 0; render(tile.id); });
  },
  verb(action){
    return {unlock:"unlock", open:"open", lock:"lock", disarm:"disarm", arm_home:"arm (home)", arm_away:"arm (away)", arm_night:"arm (night)",
      arm_vacation:"arm (vacation)", open_cover:"open", close_cover:"close", stop_cover:"stop", toggle:"open or close", set_cover_position:"move"}[action] || "change";
  },
  // the two settings every tile that controls Home Assistant has for locks, alarms and garage doors
  SECURE:{
    // share:false: a shared layout never carries these, so an imported one can't arrive with locks already allowed
    secure:{type:"bool", share:false, label:"Allow locks, garage doors and alarms", help:"Off: they're shown but can't be changed from the screen", default:false},
    confirm:{type:"choice", share:false, label:"Locks, garage doors and alarms need", choices:["Two taps", "One tap"], default:"Two taps"}
  }
};

Tile("ha", {
  title:"Home", cat:"Home", size:[10, 12, 6, 6], every:5, needs:"homeassistant",
  desc:"Lights, switches, thermostats, covers, locks and the alarm from Home Assistant. Tap a light or switch to turn it on or off; use − and + to set a temperature, a brightness or a volume; run scenes and scripts with Run. Locks, garage doors and alarms can be changed only if you allow it in the tile's settings, with a second tap to confirm.",
  settings:{
    src:{type:"source", kind:"homeassistant", label:"Home Assistant", default:""},
    entities:{type:"entity", multi:true, label:"Things to show", help:"In the order you want them", default:[]},
    taps:{type:"bool", label:"Let the screen control these things", default:true},
    secure:HA.SECURE.secure, confirm:HA.SECURE.confirm,
    changed:{type:"bool", label:"Show how long ago doors and sensors changed", default:true},
    names:{type:"text", share:false, label:"Rename things", help:"entity_id = Display name, separated by ; — e.g. sensor.cap_energie_power = Linky power", default:""}
  },
  css:`.m-ha .hl{display:grid;grid-template-columns:1fr;gap:0 28px;align-content:start}
    .slot:not(.narrow) > .m-ha.wide .hl{grid-template-columns:1fr 1fr}
    .m-ha .hr{display:grid;grid-template-columns:40px minmax(0,1fr) auto;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.06)}
    .m-ha .ic{font-size:28px;text-align:center}
    .m-ha .nm{font-size:25px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .m-ha .nm small{display:block;font-size:16px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .m-ha .nm small .chip{margin:2px 4px 0 0}
    .m-ha .st{font-size:24px;color:var(--dim);white-space:nowrap;text-align:right}
    .m-ha .hr.alert .st,.m-ha .hr.alert .nm{color:#ffb74d}
    .m-ha .hr.off .ic{opacity:.45} .m-ha .hr.gone{opacity:.45}
    .m-ha .tg{width:72px;height:40px;border-radius:20px;background:rgba(255,255,255,.16);position:relative;transition:background .2s;flex:none}
    .m-ha .tg::after{content:"";position:absolute;top:5px;left:5px;width:30px;height:30px;border-radius:50%;background:#fff;transition:transform .2s}
    .m-ha .tg.on{background:var(--accent)} .m-ha .tg.on::after{transform:translateX(32px)}
    .m-ha .hr.busy .tg,.m-ha .hr.busy .run,.m-ha .hr.busy .ctl{opacity:.5}
    .m-ha .run{font-size:20px;padding:7px 18px;border-radius:20px;background:rgba(255,255,255,.14)}
    .m-ha .ctl{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
    .m-ha .step{display:flex;align-items:center;gap:5px;background:rgba(255,255,255,.09);border-radius:999px;padding:3px 8px}
    .m-ha .step button{font-size:21px;line-height:1;width:37px;height:37px;border-radius:50%;background:rgba(255,255,255,.16);color:#fff;border:0;cursor:pointer;padding:0;transition:background .15s}
    .m-ha .step button:active{background:var(--accent)}
    .m-ha .step b{font-size:20px;min-width:64px;text-align:center;font-weight:500}
    .m-ha .chip{font-size:16px;padding:6px 15px;border-radius:999px;background:rgba(255,255,255,.12);color:var(--dim);cursor:pointer;border:0;transition:background .15s,color .15s}
    .m-ha .chip.on{background:var(--accent);color:#fff;box-shadow:0 3px 14px rgba(0,0,0,.35)}
    .m-ha .cbtn{font-size:18px;padding:7px 15px;border-radius:999px;background:rgba(255,255,255,.14);border:0;color:#fff;cursor:pointer;white-space:nowrap;transition:background .15s}
    .m-ha .cbtn.on{background:var(--accent);box-shadow:0 3px 14px rgba(0,0,0,.35)}
    .m-ha [data-ha]{cursor:pointer}
    .m-ha .msg{font-size:17px;color:#ffb74d;margin-top:6px}
    .m-ha .msg.ask{font-size:22px;color:#fff;background:var(--accent);border-radius:12px;padding:8px 14px}`,
  cls:"m-ha",
  has(){ return true; },
  render(el){
    const s = this.s, ids = (s.entities || []).filter(Boolean);
    let h = '<h3>' + esc(this.name) + '</h3>';
    if (HA.setup(this)){ el.innerHTML = h + '<div class="empty">Set up Home Assistant in Controls → Setup</div>'; return; }
    if (!ids.length){ el.innerHTML = h + '<div class="empty">Pick what to show in this tile\'s settings</div>'; return; }
    const d = tileData(this, HA.url(this, ids), 5);
    if (!d){ el.innerHTML = h + '<div class="empty">Loading…</div>'; return; }
    const opt = this._opt = this._opt || {}, now = Date.now(), nm = HA.namemap(s);
    h += '<div class="hl">' + (d.states || []).map(o0 => {
      const p = opt[o0.id], o = p && p.until > now ? Object.assign({}, o0, p.patch || {state:p.state}) : o0;
      const taps = s.taps !== false, tap = taps && !HA.held(o, s) && HA.TAP[o.domain], gone = o.state === "unavailable" || o.state === "missing";
      const modes = HA.modeChips(o);
      const sub = modes || (s.changed !== false && !tap && o.changed && /^(binary_sensor|lock|cover|person|device_tracker)$/.test(o.domain) ? HA.ago(o.changed)
        : o.domain === "light" && o.state === "on" && o.level != null ? o.level + "%" : "");
      return '<div class="hr' + (HA.alert(o) ? " alert" : "") + (tap === "toggle" && !HA.isOn(o) ? " off" : "") + (gone ? " gone" : "") + (p && p.until > now ? " busy" : "") + '"' +
        (tap ? ' data-ha="' + esc(o.id) + '"' : "") + '><span class="ic">' + HA.icon(o) + '</span><span class="nm">' + esc(nm[o0.id] || o.name) + (sub ? '<small>' + sub + '</small>' : "") + '</span>' + HA.controls(o, taps, s) + '</div>';
    }).join("") + '</div>';
    if (d.error) h += '<div class="msg">' + esc(d.error) + '</div>';
    if (this._msg && this._msg.until > now) h += '<div class="msg' + (this._msg.ask ? " ask" : "") + '">' + esc(this._msg.text) + '</div>';
    el.innerHTML = h;
    el.classList.toggle("wide", el.clientWidth > 820 && ids.length > 4);
    HA.bind(el, this);
  }
});
