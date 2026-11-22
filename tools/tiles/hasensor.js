/* Sensor: one reading from Home Assistant, big enough to read across the room. If the tile has a "controlled by"
   entity (e.g. the thermostat matching a temperature sensor), its controls sit right under the big value —
   so you can change the setpoint directly under the temperature you see. Plain sensors get a refresh button. */
Tile("hasensor", {
  title:"Sensor", cat:"Home", size:[6, 6, 4, 4], every:5, needs:"homeassistant",
  takeover:"Take over the box when it needs a look (a door left open, a lock left unlocked, water on the floor)",
  desc:"One reading from Home Assistant in big type: the temperature outside, whether the garage door is open, the dryer's power. Doors left open and locks left unlocked turn orange. Pick a \"controlled by\" entity (a thermostat, a light, a switch...) and its controls appear right under the value; plain sensors get a refresh button. A temperature driven by a thermostat turns orange while it heats, green at the setpoint and grey when it is off.",
  settings:{
    src:{type:"source", kind:"homeassistant", label:"Home Assistant", default:""},
    entity:{type:"entity", label:"What to show", default:""},
    control:{type:"entity", label:"Controlled by (optional)", help:"e.g. climate.salon for a salon temperature sensor — its − / + and modes then appear under the value", default:""},
    icon:{type:"bool", label:"Show an icon", default:true},
    changed:{type:"bool", label:"Show how long ago it changed", default:true},
    taps:{type:"bool", label:"Let the screen control this thing", default:true},
    secure:{type:"bool", label:"Allow locks, garage doors and alarms", help:"Off: they're shown but can't be changed from the screen", default:false},
    confirm:{type:"choice", label:"Locks, garage doors and alarms need", choices:["Two taps", "One tap"], default:"Two taps"},
    names:{type:"text", label:"Rename", help:"Just a name to rename what is shown (e.g. Énergie), or entity_id = Display name per ; — e.g. sensor.salon_temperature = Salon", default:""},
    tcolor:{type:"bool", label:"Colour by the thermostat", default:true, help:"Orange while it heats, green at the setpoint, grey when it is off"}
  },
  css:`.m-hasensor{display:flex;flex-direction:column}
    .m-hasensor .bv{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:6px;min-height:0}
    .m-hasensor .ic{font-size:44px;line-height:1}
    .m-hasensor .v{font-size:72px;font-weight:300;line-height:1.05;max-width:100%;overflow:hidden;text-overflow:ellipsis}
    .m-hasensor .v.long{font-size:48px}
    .m-hasensor .n{font-size:24px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
    .m-hasensor .n small{display:block;font-size:17px}
    .m-hasensor.alert .v{color:#ffb74d}
    .m-hasensor .bv.heat .v,.m-hasensor .bv.heat .ic{color:#ffb74d}
    .m-hasensor .bv.ok .v,.m-hasensor .bv.ok .ic{color:#63c98a}
    .m-hasensor .bv.cool .v,.m-hasensor .bv.cool .ic{color:#6fb6ff}
    .m-hasensor .bv.off .v,.m-hasensor .bv.off .ic{color:var(--dim)}
    html.light .m-hasensor .bv.heat .v,html.light .m-hasensor .bv.heat .ic{color:#c46a00}
    html.light .m-hasensor .bv.ok .v,html.light .m-hasensor .bv.ok .ic{color:#1f8a4c}
    html.light .m-hasensor .bv.cool .v,html.light .m-hasensor .bv.cool .ic{color:#1f6fbf}
    .m-hasensor.gone .v{opacity:.45}
    .m-hasensor .msg{font-size:16px;color:#ffb74d;text-align:center}
    .m-hasensor .msg.ask{font-size:20px;color:#fff;background:var(--accent);border-radius:12px;padding:6px 12px}
    .m-hasensor .modes{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;padding:2px 0}
    .m-hasensor .modes .chip,.m-hasensor .ctl .chip{font-size:18px;padding:7px 17px;border-radius:999px;background:rgba(255,255,255,.12);color:var(--dim);cursor:pointer;border:0;transition:background .15s,color .15s}
    .m-hasensor .modes .chip.on,.m-hasensor .ctl .chip.on{background:var(--accent);color:#fff;box-shadow:0 3px 14px rgba(0,0,0,.35)}
    .m-hasensor .ctl{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;padding:6px 0 3px}
    .m-hasensor .ctl .step{display:flex;align-items:center;gap:7px;background:rgba(255,255,255,.1);border-radius:999px;padding:4px 9px}
    .m-hasensor .ctl .step button{font-size:27px;line-height:1;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.16);color:#fff;border:0;cursor:pointer;padding:0;transition:background .15s}
    .m-hasensor .ctl .step button:active{background:var(--accent)}
    .m-hasensor .ctl .step b{font-size:27px;min-width:86px;text-align:center;font-weight:500}
    .m-hasensor .ctl .cbtn{font-size:20px;padding:9px 18px;border-radius:999px;background:rgba(255,255,255,.14);border:0;color:#fff;cursor:pointer;white-space:nowrap;transition:background .15s}
    .m-hasensor .ctl .cbtn.on{background:var(--accent);box-shadow:0 3px 14px rgba(0,0,0,.35)}
    .m-hasensor .ctl .tg{width:72px;height:40px;border-radius:20px;background:rgba(255,255,255,.16);position:relative;transition:background .2s;flex:none}
    .m-hasensor .ctl .tg::after{content:"";position:absolute;top:5px;left:5px;width:30px;height:30px;border-radius:50%;background:#fff;transition:transform .2s}
    .m-hasensor .ctl .tg.on{background:var(--accent)} .m-hasensor .ctl .tg.on::after{transform:translateX(32px)}
    .m-hasensor .ctl .run{font-size:20px;padding:9px 20px;border-radius:999px;background:rgba(255,255,255,.14)}
    .m-hasensor .ctl .st{font-size:24px;color:var(--dim)}
    .m-hasensor [data-ha]{cursor:pointer}`,
  cls:"m-hasensor",
  has(){ return true; },
  state(){ const d = this._fd && this._fd.data; return d && (d.states || [])[0]; },
  urgent(){ const o = this.state(); return !!(o && HA.alert(o)); },
  // the big value's colour when a thermostat drives the reading: heating, at the setpoint, or off
  tone(o, c){
    const isTh = x => !!x && (x.domain === "climate" || x.domain === "water_heater" || /^(climate|water_heater)\./.test(x.id || ""));
    const th = isTh(c) ? c : isTh(o) ? o : null;
    if (!th || !(o.dc === "temperature" || /°/.test(o.unit || "") || isTh(o))) return "";
    if (th.state === "off") return "off";
    const act = String(th.action || "");
    if (act === "heating" || act === "preheating") return "heat";
    if (act === "cooling") return "cool";
    if (act === "idle") return "ok";
    // no hvac_action from this thermostat: compare the reading with the setpoint, knowing the mode
    const t = parseFloat(isTh(o) ? o.current : o.state), tgt = parseFloat(th.target);
    if (!isFinite(t) || !isFinite(tgt)) return "";
    const d = t - tgt, tol = /°F/.test(o.unit || "") ? 0.5 : 0.3, mode = String(th.state || "");
    if (Math.abs(d) <= tol) return "ok";
    if (mode === "cool") return d > 0 ? "cool" : "ok";
    if (mode === "heat") return d < 0 ? "heat" : "ok";
    if (mode === "heat_cool" || mode === "auto") return d < 0 ? "heat" : "cool";
    return "";
  },
  render(el){
    const s = this.s;
    if (HA.setup(this)){ el.innerHTML = '<h3>' + esc(this.name) + '</h3><div class="empty">Set up Home Assistant in Controls → Setup</div>'; return; }
    if (!s.entity){ el.innerHTML = '<h3>' + esc(this.name) + '</h3><div class="empty">Pick what to show in this tile\'s settings</div>'; return; }
    const ids = [s.entity]; if (s.control && s.control !== s.entity) ids.push(s.control);
    const d = tileData(this, HA.url(this, ids), 5), states = (d && d.states) || [];
    const o0 = states.find(x => x.id === s.entity) || states[0];
    if (!o0){ el.innerHTML = '<div class="empty">Loading…</div>'; return; }
    const c0 = s.control ? states.find(x => x.id === s.control) : null;
    const opt = this._opt = this._opt || {}, now = Date.now();
    const withPatch = o => { const p = opt[o.id]; return p && p.until > now ? Object.assign({}, o, p.patch || {state:p.state}) : o; };
    const o = withPatch(o0), c = c0 ? withPatch(c0) : null;
    const tone = s.tcolor === false ? "" : this.tone(o, c);
    const v = HA.text(o) || HA.cap(o.state), ago = s.changed !== false && o.changed ? HA.ago(o.changed) : "", nm = HA.namemap(s, s.entity);
    const taps = s.taps !== false, gone = o.state === "unavailable" || o.state === "missing";
    el.classList.toggle("alert", HA.alert(o)); el.classList.toggle("gone", gone);
    // what sits under the big value: the controls of the "controlled by" entity if there is one, else of the entity itself
    const tgt = taps && !gone && c && HA.CTRL[c.domain] && c.state !== "unavailable" && c.state !== "missing" ? c
              : taps && !gone && HA.CTRL[o.domain] ? o : null;
    let ctl = "", modes = "";
    if (tgt){
      ctl = HA.controls(tgt, taps, s);
      modes = HA.modeChips(tgt);
      // a sensor being shown can always be refreshed, even when a control entity drives the tile
      if (tgt !== o && /^(sensor|binary_sensor)$/.test(o.domain)) ctl = '<span class="ctl"><span class="cbtn" data-ha="' + esc(o.id) + '" data-act="refresh" title="Refresh now">🔄</span></span>' + ctl;
    }
    const tapId = tgt && !HA.held(tgt, s) && HA.TAP[tgt.domain] ? tgt.id : (taps && !HA.held(o, s) && HA.TAP[o.domain] ? o.id : null);
    el.innerHTML = '<div class="bv' + (tone ? " " + tone : "") + '">' + (s.icon !== false ? '<div class="ic">' + HA.icon(o) + '</div>' : "") + '<div class="v' + (v.length > 9 ? " long" : "") + '">' + esc(v) + '</div>' +
      '<div class="n">' + esc(nm[o0.id] || this.it.name || o.name) + (ago ? '<small>' + esc(ago) + '</small>' : "") + '</div></div>' +
      (modes ? '<div class="modes">' + modes + '</div>' : "") +
      (ctl ? '<div class="ctl"' + (tapId ? ' data-ha="' + esc(tapId) + '"' : "") + '>' + ctl + '</div>' : "") +
      (d.error ? '<div class="msg">' + esc(d.error) + '</div>' : "") +
      (this._msg && this._msg.until > now ? '<div class="msg' + (this._msg.ask ? " ask" : "") + '">' + esc(this._msg.text) + '</div>' : "");
    HA.bind(el, this);
  }
});
