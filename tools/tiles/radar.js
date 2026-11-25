/* Rain radar: an animated map of rain and snow around your home */
viewTile("radar", {
  title:"Rain radar", cat:"Weather", size:[26, 18, 12, 10], feeds:["wx"],
  takeover:"Take over the box when rain is near", demo:{onlyRain:false},
  desc:"An animated map of rain and snow around your home, from RainViewer, with a few minutes of forecast. Can stay hidden until rain is close, and take over its box when it is.",
  settings:{
    zoom:{type:"choice", label:"Map", choices:["Close", "Region", "Wide"], default:"Region"},
    onlyRain:{type:"bool", label:"Only show when rain or snow is near", default:true},
    hours:{type:"int", label:"Counts as near within (hours)", default:2, min:1, max:6},
    chance:{type:"int", label:"…at a chance of at least (%)", default:40, min:10, max:90}
  },
  has(){ return !this.s.onlyRain || !!rainSoon(this.s); },
  urgent(){ return !!rainSoon(this.s); }
}, {
  build(box){
    box.innerHTML = '<div class="map" data-keep><div class="lyr base"></div><div class="lyr frames"></div><div class="lyr labels"></div><div class="home"></div></div>' +
      '<div class="ovl tl"><b class="rk"></b><span class="rt"></span></div><div class="ovl br rtime"></div><div class="rbar"><i></i></div>' + OSM_CREDIT;
    this.box = box; this.frames = []; this.fi = 0; this.loadedAt = 0;
  },
  async show(){
    const box = this.box, g = S("general"), s = this.s;
    const zm = String(s.zoom || "").toLowerCase(), z = zm === "close" ? 9 : zm === "wide" ? 7 : 8,      // saved lowercase choices still work
       rz = Math.min(z - 1, 7);
    const W = box.clientWidth, H = box.clientHeight, cx = TILE.x(g.lon, z), cy = TILE.y(g.lat, z);
    const key = [W, H, z, g.lat, g.lon].join();
    if (this.mapKey !== key){
      TILE.fill(box.querySelector(".base"), OSM, z, z, cx, cy, W, H, "dkmap");
      box.querySelector(".frames").replaceChildren();
      this.frames = [];
      this.width = W; this.height = H;
      this.mapKey = key; this.loadedAt = 0;
    }
    this.headline();
    if (Date.now() - this.loadedAt < 5 * 60e3 && this.frames.length) return this.play();
    if (this.request && this.request.key === key) return;
    const request = this.request = {key};
    let R;
    try{ R = await getJSON("/radar"); }catch(e){ R = null; }
    if (this.request !== request) return;
    this.request = null;
    this.loadedAt = Date.now();
    if (!R || !R.past || !R.past.length){ box.querySelector(".rtime").textContent = "Radar unavailable" + (R && R.error ? " (" + R.error + ")" : ""); return; }
    const list = R.past.slice(-8).map(f => ({t:f.time * 1000, path:f.path, fc:false}))
      .concat((R.nowcast || []).slice(0, 3).map(f => ({t:f.time * 1000, path:f.path, fc:true})));
    const fl = box.querySelector(".frames");
    fl.innerHTML = "";
    this.frames = list.map(f => {
      const d = document.createElement("div"); d.className = "lyr fr"; fl.appendChild(d);
      // radar tiles at zoom rz (RainViewer's free maps stop at zoom 7), stretched over the base map
      TILE.fill(d, (zz, x, y) => R.host + f.path + "/256/" + zz + "/" + x + "/" + y + "/2/1_1.png", rz, z, cx, cy, W, H);
      return Object.assign(f, {el:d});
    });
    this.fi = 0;
    this.play();
  },
  play(){
    clearTimeout(this.timer);
    const step = () => {
      if (!this.frames.length || !this.active) return;
      const f = this.frames[this.fi];
      this.frames.forEach(x => x.el.style.opacity = x === f ? ".78" : "0");
      const t = new Date(f.t), past = Math.round((Date.now() - f.t) / 60e3);
      this.box.querySelector(".rtime").textContent = (f.fc ? "Forecast " : "") + fmtTime(t) + (f.fc ? "" : past <= 5 ? " · now" : " · " + past + " min ago");
      this.box.querySelector(".rbar i").style.width = ((this.fi + 1) / this.frames.length * 100) + "%";
      const last = this.fi === this.frames.length - 1;
      this.fi = (this.fi + 1) % this.frames.length;
      this.timer = setTimeout(step, last ? 2200 : 550);
    };
    step();
  },
  headline(){
    const r = rainSoon(this.s), b = this.box.querySelector(".rk"), t = this.box.querySelector(".rt");
    if (!r){ b.textContent = "Radar"; t.textContent = "Nothing nearby right now"; return; }
    b.textContent = r.inMin <= 10 ? (r.kind === "Snow" ? "Snowing" : r.kind === "Storms" ? "Storms" : "Raining") + " now" :
      r.kind + " in about " + (r.inMin < 90 ? Math.round(r.inMin / 5) * 5 + " min" : Math.round(r.inMin / 60) + " hours");
    t.textContent = r.inMin > 10 ? r.pp + "% chance" : "";
  },
  hide(){ clearTimeout(this.timer); },
  tick(){
    if (this.width !== this.box.clientWidth || this.height !== this.box.clientHeight || Date.now() - this.loadedAt > 5 * 60e3) this.show();
    else this.headline();
  }
});
