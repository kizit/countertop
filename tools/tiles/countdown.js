/* Countdown: days until the dates you care about */
Tile("countdown", {
  api:1, uses:[],
  title:"Countdown", cat:"Time", every:600, size:[12, 8, 8, 5],
  desc:"Days until the dates you care about: a trip, a birthday, the last day of school. The nearest one is big; the next few are listed under it. Past dates drop off on their own.",
  settings:{
    dates:{type:"list", share:false, label:"Dates", help:"One per line: name, then the date. For example: Beach trip, 2027-06-14", placeholder:"Beach trip, 2027-06-14", default:[]},
    yearly:{type:"bool", label:"Dates without a year come back every year", default:true},
    more:{type:"int", label:"How many more to list", default:3, min:0, max:6}
  },
  demo:{dates:["Beach trip, " + (new Date().getFullYear() + 1) + "-06-14", "Grandma's birthday, 03-02", "Last day of school, " + (new Date().getFullYear() + 1) + "-05-22"]},
  css:`.m-count .big{display:flex;align-items:baseline;gap:14px;margin:4px 0 6px}
    .m-count .big b{font-size:96px;font-weight:200;line-height:1;color:var(--accent)}
    .m-count .big span{font-size:26px;color:var(--dim)}
    .m-count .what{font-size:32px;font-weight:500;line-height:1.2}
    .m-count .li .t{min-width:110px}`,
  cls:"m-count",
  list(){
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const out = [];
    for (const line of this.s.dates || []){
      const m = String(line).match(/^(.*?)[,;]\s*(?:(\d{4})-)?(\d{1,2})-(\d{1,2})\s*$/); if (!m) continue;
      let d = new Date(m[2] ? +m[2] : now.getFullYear(), +m[3] - 1, +m[4]);
      if (d < now && (!m[2] && this.s.yearly !== false)) d = new Date(now.getFullYear() + 1, +m[3] - 1, +m[4]);
      if (d < now) continue;
      out.push({name:m[1].trim(), d, days:Math.round((d - now) / 86400e3)});
    }
    return out.sort((a, b) => a.d - b.d);
  },
  has(){ return this.list().length > 0; },
  render(el){
    const L = this.list(), esc = x => this.esc(x), tr = (x, v) => this.t(x, v);
    if (!L.length){ el.innerHTML = '<h3>' + esc(this.name) + '</h3><div class="empty">Add dates in this tile\'s settings</div>'; return; }
    const a = L[0], n = a.days;
    let h = '<h3>' + esc(this.name) + '</h3><div class="what">' + esc(a.name) + '</div><div class="big"><b>' + (n === 0 ? tr("Today!") : n) + '</b><span>' +
      (n === 0 ? "" : tr(n === 1 ? "day to go" : "days to go")) + '</span></div>';
    h += L.slice(1, 1 + (this.s.more == null ? 3 : this.s.more)).map(x => '<div class="li"><div class="t">' + x.days + (x.days === 1 ? " day" : " days") + '</div><div class="s">' + esc(x.name) + '</div></div>').join("");
    el.innerHTML = h;
  }
});
