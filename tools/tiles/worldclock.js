/* World clocks: the time in other places */
Tile("worldclock", {
  title:"World clocks", cat:"Time", every:30, size:[12, 8, 8, 4],
  desc:"The time in other places, with whether it's day or night there. Good for family far away.",
  settings:{
    places:{type:"list", share:false, label:"Places", help:"One per line: a name, then its time zone. For example: Grandma, Europe/London", placeholder:"Grandma, Europe/London", default:["London, Europe/London", "Tokyo, Asia/Tokyo"]},
    day:{type:"bool", label:"Show the day if it's different from here", default:true}
  },
  css:`.m-world .wc{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--surface-line)}
    .m-world .wc:last-child{border-bottom:0}
    .m-world .wc .n{font-size:26px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .m-world .wc .n small{display:block;font-size:17px;color:var(--dim)}
    .m-world .wc .tm{font-size:44px;font-weight:300;white-space:nowrap}
    .m-world.tight[data-room~="tall"] .wc{flex-direction:column;align-items:flex-start;gap:0;padding:6px 0}
    .m-world.tight[data-room~="tall"] .wc .n{max-width:100%;font-size:22px}
    .m-world.tight[data-room~="tall"] .wc .n small{font-size:15px}
    .m-world.tight[data-room~="tall"] .wc .tm{font-size:34px}`,
  cls:"m-world",
  render(el){
    const now = new Date(), here = now.toLocaleDateString("en-CA");
    let first = 0;      // the first place is the main content; the others go when the box is short
    const rows = (this.s.places || []).map(line => {
      const m = String(line).split(/[,;]/).map(x => x.trim()); const tz = m[1] || m[0];
      try{
        const t = now.toLocaleTimeString([], {hour:"numeric", minute:"2-digit", timeZone:tz, hour12:!LOOK.h24});
        const h = +now.toLocaleString("en-US", {hour:"numeric", hour12:false, timeZone:tz}) % 24;
        const day = now.toLocaleDateString("en-CA", {timeZone:tz}), other = day !== here;
        const sub = (h >= 6 && h < 19 ? "☀️ " : "🌙 ") + (other && this.s.day !== false ? tr(day > here ? "Tomorrow" : "Yesterday") : tr("Today"));
        return '<div class="wc"><div class="n">' + esc(m[0]) + '<small>' + sub + '</small></div><div class="tm"' + (first++ ? "" : " data-keep") + '>' + esc(t) + '</div></div>';
      }catch(e){ return '<div class="wc"><div class="n">' + esc(m[0]) + '<small>Unknown time zone "' + esc(tz) + '"</small></div></div>'; }
    });
    el.innerHTML = '<h3>' + esc(this.name) + '</h3>' + (rows.join("") || '<div class="empty">Add places in this tile\'s settings</div>');
  }
});
