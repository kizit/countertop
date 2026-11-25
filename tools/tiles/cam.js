/* Live cam: a muted YouTube live stream (animal cams, beaches, cities) */
viewTile("cam", {
  title:"Live cam", cat:"Photos & video", size:[26, 18, 12, 8],
  desc:"A muted YouTube live stream, like an aquarium or animal cam. Add channels or videos in Setup → Live cams; this tile switches between the ones that are live.",
  settings:{
    cams:{type:"source", kind:"cams", multi:true, label:"Cams", default:[]},
    every:{type:"int", label:"Switch cams every (seconds)", default:600, min:60, max:7200}
  }
}, {
  build(box){ box.innerHTML = '<div class="cam" data-keep></div><div class="ovl tl cm"><b></b><span></span></div>'; this.box = box; this.i = -1; this.at = 0; },
  async show(){
    if (!this.data || Date.now() - this.at > 20 * 60e3){
      try{ this.data = await getJSON("/cams" + ((this.s.cams || []).length ? "?ids=" + encodeURIComponent(this.s.cams.join(",")) : "")); this.at = Date.now(); }catch(e){ this.data = {cams:[], errors:[String(e)]}; }
    }
    if (!this.active) return;
    const C = (this.data && this.data.cams) || [], box = this.box;
    if (!C.length){
      box.querySelector(".cam").innerHTML = "";
      box.querySelector(".cm b").textContent = this.tile.name;
      box.querySelector(".cm span").textContent = (SOURCES.cams || []).length ? "None of the cams are live right now." : "Add YouTube live cams in Setup → Live cams.";
      return;
    }
    this.i = (this.i + 1) % C.length; this.shownAt = Date.now();
    const c = C[this.i];
    box.querySelector(".cam").innerHTML = '<iframe allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" src="https://www.youtube-nocookie.com/embed/' +
      encodeURIComponent(c.id) + '?autoplay=1&mute=1&controls=0&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1"></iframe>';
    box.querySelector(".cm b").textContent = c.title || "Live cam";
    box.querySelector(".cm span").textContent = (c.channel ? c.channel + " · " : "") + "LIVE";
    clearTimeout(this.fade); box.querySelector(".cm").classList.remove("dim");
    this.fade = setTimeout(() => box.querySelector(".cm").classList.add("dim"), 12e3);
  },
  // drop the player when hidden so the Echo isn't decoding video in the background
  hide(){ clearTimeout(this.fade); const c = this.box.querySelector(".cam"); setTimeout(() => { if (!this.active) c.innerHTML = ""; }, 1300); },
  tick(){ if (Date.now() - this.shownAt > Math.max(60, this.s.every || 600) * 1000) this.show(); }
});
