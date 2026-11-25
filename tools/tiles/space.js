/* Space photo: NASA's astronomy picture of the day */
viewTile("space", {
  title:"Space photo", cat:"Photos & video", size:[26, 18, 12, 8],
  desc:"NASA's Astronomy Picture of the Day, with its title and a short explanation."
}, {
  build(box){
    box.innerHTML = '<div class="img" data-keep></div><div class="ovl bl ap"></div>'; this.box = box; this.at = 0;
    // a short box keeps the picture: the explanation is left out so the text never covers it
    const size = () => box.classList.toggle("short", box.clientHeight < 300);
    size(); if (window.ResizeObserver) new ResizeObserver(size).observe(box);
  },
  async show(){
    if (Date.now() - this.at < 30 * 60e3 && this.data) return;
    try{ this.data = await getJSON("/space"); this.at = Date.now(); }catch(e){ this.data = null; }
    const A = this.data, box = this.box;
    const src = A && (A.media_type === "image" ? A.url : A.thumbnail_url);
    if (!src){ box.querySelector(".ap").innerHTML = '<b>NASA picture of the day</b><span>' + esc(A && A.error ? "Couldn't load it: " + A.error : "Not available today") + '</span>'; return; }
    box.querySelector(".img").style.backgroundImage = 'url("' + src + '")';
    const ex = String(A.explanation || "").split(/(?<=\.)\s+/).slice(0, 2).join(" ");
    box.querySelector(".ap").innerHTML = '<small>NASA · Astronomy picture of the day</small><b>' + esc(A.title || "") + '</b><span>' + esc(ex) + '</span>' +
      (A.copyright ? '<small>© ' + esc(String(A.copyright).trim()) + '</small>' : "");
  },
  hide(){}
});
