/* Space station: where the ISS is right now, on a world map */
viewTile("iss", {
  title:"Space station", cat:"Around you", size:[26, 18, 12, 8],
  desc:"Where the International Space Station is right now, on a world map with its path, height and speed."
}, {
  build(box){
    box.innerHTML = '<div class="map" data-keep><div class="lyr base"></div><svg class="trk"></svg><div class="iss">🛰️</div></div><div class="ovl tl"><b>Space station</b><span class="is"></span></div>' + OSM_CREDIT;
    this.box = box;
  },
  show(){ this.active = true; this.poll(); },
  hide(){ this.active = false; clearTimeout(this.timer); },
  async poll(){
    if (!this.active) return;
    let d = null;
    try{ d = await getJSON("/iss"); }catch(e){}
    if (d && d.lat != null) this.place(d);
    else this.box.querySelector(".is").textContent = "Position unavailable" + (d && d.error ? " (" + d.error + ")" : "");
    this.timer = setTimeout(() => this.poll(), 5000);
  },
  place(d){
    const box = this.box, W = box.clientWidth, H = box.clientHeight;
    const z = W > 1000 ? 3 : 2, world = 256 * Math.pow(2, z);
    const cx = TILE.x(d.lon, z), cy = Math.max(H / 2, Math.min(world - H / 2, TILE.y(Math.max(-55, Math.min(55, d.lat * .6)), z)));
    // re-tile only when the view has drifted a fair way
    if (!this.c || Math.abs(this.c[0] - cx) > W * .2 || this.c[2] !== z || this.c[3] !== W){
      TILE.fill(box.querySelector(".base"), OSM, z, z, cx, cy, W, H, "dkmap");
      this.c = [cx, cy, z, W];
    }
    const [vx, vy] = this.c, x0 = vx - W / 2, y0 = vy - H / 2;
    let ix = TILE.x(d.lon, z) - x0; while (ix < 0) ix += world; while (ix > W) ix -= world;
    const iy = TILE.y(d.lat, z) - y0;
    // keep the track continuous around the station: each point goes to its copy nearest the station
    const px = (lat, lon) => { let x = TILE.x(lon, z) - x0; while (x - ix > world / 2) x -= world; while (x - ix < -world / 2) x += world; return [x, TILE.y(lat, z) - y0]; };
    const sat = box.querySelector(".iss"); sat.style.left = ix + "px"; sat.style.top = iy + "px";
    // the station never sits under the title: when it gets close to it, the title moves to the bottom corner
    const tl = box.querySelector(".tl"), r = 30;
    tl.classList.toggle("low", ix > 22 - r && ix < 22 + tl.offsetWidth + r && iy > 18 - r && iy < 18 + tl.offsetHeight + r);
    // ground track, split where it wraps around the world
    let past = "", fut = "", prev = null;
    (d.track || []).forEach(p => {
      const [x, y] = px(p.lat, p.lon), jump = prev && Math.abs(x - prev) > world / 2;
      const seg = (jump || prev === null ? " M" : " L") + x.toFixed(1) + "," + y.toFixed(1);
      if (p.t <= d.t) past += seg; else fut += seg;
      prev = x;
    });
    if (fut && past){ fut = " M" + ix.toFixed(1) + "," + iy.toFixed(1) + fut.replace(/^ M/, " L"); }
    box.querySelector(".trk").innerHTML = '<path d="' + past + '" class="p"/><path d="' + fut + '" class="f"/>';
    const met = S("general").units === "C";
    const alt = met ? Math.round(d.alt) + " km" : Math.round(d.alt * .6214) + " mi", vel = met ? Math.round(d.vel).toLocaleString() + " km/h" : Math.round(d.vel * .6214).toLocaleString() + " mph";
    box.querySelector(".is").textContent = Math.abs(d.lat).toFixed(1) + "°" + (d.lat >= 0 ? "N" : "S") + " " + Math.abs(d.lon).toFixed(1) + "°" + (d.lon >= 0 ? "E" : "W") +
      " · " + alt + " up · " + vel + (d.vis ? " · " + (d.vis === "daylight" ? "in sunlight" : "in Earth's shadow") : "");
  }
});
