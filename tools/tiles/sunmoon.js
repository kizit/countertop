/* Sun & moon: sunrise, sunset, daylight and the moon phase */
Tile("sunmoon", {
  title:"Sun & moon", cat:"Weather", every:300, size:[12, 8, 8, 5], feeds:["wx"],
  desc:"Sunrise and sunset with an arc showing where the sun is now, how much daylight you get (and whether days are getting longer), and tonight's moon.",
  css:`.m-sun .arc{position:relative;height:96px;margin:6px 0 4px}
    .m-sun .arc svg{width:100%;height:100%;overflow:visible}
    .m-sun .rs{display:flex;justify-content:space-between;font-size:26px}
    .m-sun .rs small{display:block;font-size:16px;color:var(--dim)}
    .m-sun .ft{margin-top:8px;font-size:20px;color:var(--dim)}`,
  cls:"m-sun",
  render(el){
    const j = STATE.wx;
    if (!j || !j.daily.sunrise){ el.innerHTML = '<h3>' + esc(this.name) + '</h3><div class="empty">' + tr(STATE.noLoc ? "Set your location in Setup" : "Loading…") + '</div>'; return; }
    const D = j.daily, rise = new Date(D.sunrise[0]), set = new Date(D.sunset[0]), now = new Date();
    const len = (set - rise) / 60e3, len2 = D.sunrise[1] ? (new Date(D.sunset[1]) - new Date(D.sunrise[1])) / 60e3 : len;
    const f = Math.max(0, Math.min(1, (now - rise) / (set - rise))), up = now > rise && now < set;
    const x = 10 + f * 280, y = 90 - Math.sin(f * Math.PI) * 80, mo = moon(now), dm = Math.round(len2 - len);
    el.innerHTML = '<h3>' + esc(this.name) + '</h3><div class="arc"><svg viewBox="0 0 300 96" preserveAspectRatio="none"><path d="M10 90 Q150 -70 290 90" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="2" stroke-dasharray="4 5"/>' +
      '<line x1="0" y1="90" x2="300" y2="90" stroke="rgba(255,255,255,.15)"/>' + (up ? '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="9" fill="#ffd166"/>' : "") + '</svg></div>' +
      '<div class="rs" data-keep><div>🌅 ' + fmtTime(rise) + '<small>' + tr("Sunrise") + '</small></div><div style="text-align:right">🌇 ' + fmtTime(set) + '<small>' + tr("Sunset") + '</small></div></div>' +
      '<div class="ft">' + tr("{h} h {min} min of daylight", {h:Math.floor(len / 60), min:Math.round(len % 60)}) + (dm ? " · " + tr("{change} min tomorrow", {change:(dm > 0 ? "+" : "−") + Math.abs(dm)}) : "") + ' · ' + mo[0] + ' ' + mo[1] + '</div>';
  }
});
