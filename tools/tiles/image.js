/* Picture from a link: any image on the web, refreshed now and then */
Tile("image", {
  title:"Picture from a link", cat:"Photos & video", size:[16, 12, 6, 4], noFit:true,
  desc:"Any picture on the web, by its link: a traffic or ski-hill webcam snapshot, a chart, a comic. It reloads on the schedule you pick.",
  settings:{
    url:{type:"text", share:false, label:"Picture link", placeholder:"https://…/snapshot.jpg", help:"A link that opens a picture by itself (ends in .jpg, .png, .gif or .webp, or a webcam's snapshot link)", default:""},
    every:{type:"int", label:"Reload every (minutes, 0 = never)", default:10, min:0, max:1440},
    fit:{type:"choice", label:"Fit", choices:["Fill the box", "Show all of it"], default:"Fill the box"},
    caption:{type:"text", share:false, label:"Caption", default:""}
  },
  css:`.m-img{padding:0;display:flex;align-items:center;justify-content:center;background:#000}
    .m-img img{width:100%;height:100%;display:block}
    .m-img .cap{position:absolute;left:0;right:0;bottom:0;padding:24px 16px 10px;font-size:20px;background:linear-gradient(transparent,rgba(0,0,0,.7))}`,
  cls:"m-img",
  render(el){
    const s = this.s;
    if (!/^https?:\/\//.test(s.url || "")){ el.innerHTML = '<div class="empty" style="padding:20px">Paste a picture link in this tile\'s settings</div>'; return; }
    const due = !el._at || (+s.every > 0 && Date.now() - el._at > s.every * 60e3), key = s.url + "|" + s.fit + "|" + s.caption;
    if (!due && el._k === key) return;
    el._at = Date.now(); el._k = key;
    const src = s.url + (+s.every > 0 ? (s.url.includes("?") ? "&" : "?") + "_=" + Math.floor(Date.now() / 60e3) : "");
    el.innerHTML = '<img referrerpolicy="no-referrer" alt="" style="object-fit:' + (s.fit === "Show all of it" ? "contain" : "cover") + '" src="' + esc(src) + '">' + (s.caption ? '<div class="cap">' + esc(s.caption) + '</div>' : "");
    el.querySelector("img").onerror = () => { el.innerHTML = '<div class="empty" style="padding:20px">Couldn\'t load that picture. Check the link.</div>'; };
  },
  every:60
});
