/* Photo frame: photos from a shared album, one at a time */
Tile("photos", {
  title:"Photo frame", cat:"Photos & video", cls:"m-photos", every:1, size:[16, 12, 8, 6], feeds:["photos"],
  desc:"Shows the photos from an album or folder one at a time. Set it up in Setup → Photo albums (iCloud, a local folder, Nextcloud/ownCloud, Immich, Plex, Jellyfin or PhotoPrism).",
  settings:{
    album:{type:"source", kind:"albums", label:"Album", default:""},
    every:{type:"int", label:"Seconds per photo", default:60, min:10, max:3600},
    shuffle:{type:"bool", label:"Shuffle", default:true},
    captions:{type:"bool", label:"Show captions", default:true}
  },

  render(el){
    const s = this.s, P = STATE.albums[s.album || ""];
    if (!P || !P.photos || !P.photos.length){
      const none = !(SOURCES.albums || []).length;
      const why = none ? "Add a photo album in Setup → Photo albums" : P && P.error ? "Couldn't load the album: " + P.error : "Loading photos…";
      el.innerHTML = '<div class="ph"><b>📷</b><div>' + esc(this.name) + '</div><small>' + esc(why) + '</small></div>';
      el._layers = null; el._shown = null;
      return;
    }
    if (!el._layers){
      el.innerHTML = '<div class="blur" data-deco></div><div class="img"></div><div class="blur" data-deco style="opacity:0"></div><div class="img" style="opacity:0"></div><div class="cap"></div>';
      el._layers = true; el._flip = 0; el._order = []; el._i = -1; el._errs = 0;
    }
    if (el._shown && Date.now() - el._shownAt < (s.every || 60) * 1000 - 500) return;
    if (!el._order.length || el._order.length !== P.photos.length){
      el._order = P.photos.map((_, i) => i);
      if (s.shuffle) for (let i = el._order.length - 1; i > 0; i--){ const k = Math.floor(Math.random() * (i + 1)); [el._order[i], el._order[k]] = [el._order[k], el._order[i]]; }
      el._i = -1;
    }
    el._i = (el._i + 1) % el._order.length;
    const ph = P.photos[el._order[el._i]];
    const img = new Image();
    img.onload = () => {
      el._errs = 0;
      const blurs = el.querySelectorAll(".blur"), imgs = el.querySelectorAll(".img"), f = el._flip;
      if (imgs.length < 2) return;
      const portrait = (img.naturalHeight && img.naturalWidth) ? img.naturalHeight > img.naturalWidth : ph.h > ph.w;
      blurs[1 - f].style.backgroundImage = imgs[1 - f].style.backgroundImage = 'url("' + ph.url + '")';
      imgs[1 - f].classList.toggle("fit", portrait);
      blurs[1 - f].style.opacity = portrait ? "1" : "0"; imgs[1 - f].style.opacity = "1";
      blurs[f].style.opacity = "0"; imgs[f].style.opacity = "0";
      el._flip = 1 - f;
      const when = ph.date ? new Date(ph.date) : null;
      el.querySelector(".cap").innerHTML = s.captions ? (esc(ph.caption || P.album || "") + '<span>' +
        (when && !isNaN(when) ? when.toLocaleDateString([], {month:"long", year:"numeric"}) + " · " : "") + (el._i + 1) + " of " + el._order.length + '</span>') : "";
    };
    img.onerror = () => {
      el._errs = (el._errs || 0) + 1;
      el._shownAt = Date.now() - Math.max(0, ((s.every || 60) - 5) * 1000);
      if (el._errs >= 2 && Date.now() - (el._reloadedAt || 0) > 60000 && typeof loadPhotos === "function"){
        el._reloadedAt = Date.now(); loadPhotos();
      }
    };
    img.src = ph.url;
    el._shown = ph.url; el._shownAt = Date.now();
  }
});
