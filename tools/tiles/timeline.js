/* Day timeline: today's events laid out along the hours */
Tile("timeline", {
  title:"Day timeline", cat:"Calendar", every:60, size:[24, 6, 16, 4], feeds:["events"],
  desc:"Today laid out along the hours, with your events as blocks and a line for now, so free time is easy to spot. After the evening it shows tomorrow.",
  settings:{
    cals:{type:"source", kind:"calendars", multi:true, label:"Calendars", default:[]},
    from:{type:"int", label:"Starts at (hour)", default:7, min:0, max:12},
    to:{type:"int", label:"Ends at (hour)", default:22, min:13, max:24}
  },
  css:`.m-tl .ax{position:relative;flex:1 1 auto;min-height:60px;margin-top:4px}
    .m-tl .hr{position:absolute;top:0;bottom:22px;border-left:1px solid var(--surface-line)}
    .m-tl .hr span{position:absolute;bottom:-24px;left:-14px;font-size:15px;color:var(--faint);white-space:nowrap}
    .m-tl .hr.first span{left:0} .m-tl .hr.last span{left:auto;right:-1px}
    .m-tl .ev{position:absolute;height:38px;border-radius:9px;background:var(--ec,color-mix(in srgb,var(--accent) 35%,transparent));padding:6px 10px;font-size:19px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box;border:1px solid var(--surface-line)}
    .m-tl .now{position:absolute;top:-4px;bottom:18px;border-left:2px solid var(--bad)}
    .m-tl{display:flex;flex-direction:column}`,
  cls:"m-tl", noFit:true,
  render(el){
    const s = this.s, a = s.from == null ? 7 : s.from, b = s.to == null ? 22 : s.to, now = new Date();
    const day = now.getHours() >= b ? new Date(now.getTime() + 86400e3) : now, d0 = startOfDay(day).getTime();
    const t0 = d0 + a * 3600e3, t1 = d0 + b * 3600e3, pct = t => ((t - t0) / (t1 - t0) * 100);
    const E = eventsOn(day, s.cals).filter(e => !e.allDay), allday = eventsOn(day, s.cals).filter(e => e.allDay);
    let h = (el.clientHeight && el.clientHeight < 180 ? "" : '<h3><span>' + tr(day === now ? "Today" : "Tomorrow") + '</span>' + (allday.length ? '<small>' + esc(allday.map(e => e.summary).join(" · ")) + '</small>' : "") + '</h3>') + '<div class="ax" data-keep>';      // a very short box keeps the hours and drops the heading
    const stepH = b - a > 10 ? 2 : 1, lastX = a + Math.floor((b - a) / stepH) * stepH;      // the first and last hour labels sit inside the edges
    for (let x = a; x <= b; x += stepH) h += '<div class="hr' + (x === a ? " first" : x === lastX ? " last" : "") + '" style="left:' + pct(d0 + x * 3600e3) + '%"><span>' + new Date(d0 + x * 3600e3).toLocaleTimeString([], {hour:"numeric"}) + '</span></div>';
    const lanes = [];
    E.forEach(e => {
      const st = evDate(e).getTime(), en = e.end ? new Date(e.end).getTime() : st + 3600e3;
      if (en < t0 || st > t1) return;
      let ln = lanes.findIndex(x => x <= st); if (ln < 0){ ln = lanes.length; lanes.push(0); } lanes[ln] = en;
      const L = Math.max(0, pct(st)), R = Math.min(100, pct(en));
      h += '<div class="ev" style="left:' + L + '%;width:calc(' + Math.max(R - L, 3) + '% - 3px);top:' + (ln * 44) + 'px' + (e.color ? ";--ec:color-mix(in srgb," + esc(e.color) + " 53%,transparent)" : "") + '">' + esc(e.summary || "") + '</div>';
    });
    if (day === now && now.getTime() > t0 && now.getTime() < t1) h += '<div class="now" style="left:' + pct(now.getTime()) + '%"></div>';
    if (!E.length) h += '<div class="empty" style="position:absolute;top:4px;left:0">Nothing scheduled' + ((SOURCES.calendars || []).length ? "" : ": connect a calendar in Setup") + '</div>';
    el.innerHTML = h + '</div>';
  }
});
