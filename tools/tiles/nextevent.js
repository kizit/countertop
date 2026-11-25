/* Next event: the next thing on your calendar, big, with a countdown */
Tile("nextevent", {
  title:"Next event", cat:"Calendar", every:30, size:[12, 8, 8, 5], feeds:["events"],
  takeover:"Take over the box shortly before an event",
  desc:"The next thing on your calendar in big type, with how long until it starts. Can stay hidden until something is coming up, and take over its box in the half hour before.",
  settings:{
    cals:{type:"source", kind:"calendars", multi:true, label:"Calendars", default:[]},
    allday:{type:"bool", label:"Include all-day events", default:false},
    within:{type:"int", label:"Only show when it's within (hours, 0 = always)", default:0, min:0, max:168},
    soon:{type:"int", label:"Take over this many minutes before", default:30, min:5, max:180}
  },
  css:`.m-next .when{font-size:24px;color:var(--accent);margin-bottom:6px}
    .m-next .what{font-size:46px;font-weight:500;line-height:1.15;margin-bottom:8px}
    .m-next .sub{font-size:22px;color:var(--dim)}`,
  cls:"m-next",
  next(){
    const now = Date.now();
    return calEvents(this.s.cals).find(e => (this.s.allday || !e.allDay) && evDate(e).getTime() > now - (e.allDay ? 0 : 5 * 60e3)) || null;
  },
  has(){ const e = this.next(); return !!e && (!this.s.within || evDate(e) - Date.now() < this.s.within * 3600e3); },
  urgent(){ const e = this.next(); if (!e || e.allDay) return false; const d = evDate(e) - Date.now(); return d < (this.s.soon || 30) * 60e3 && d > -5 * 60e3; },
  render(el){
    const e = this.next();
    if (!e){ el.innerHTML = '<h3>' + esc(this.name) + '</h3><div class="empty">' + tr((SOURCES.calendars || []).length ? "Nothing coming up" : "Connect a calendar in Setup → Calendars") + '</div>'; return; }
    const d = evDate(e), mins = Math.round((d - Date.now()) / 60e3), days = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400e3);
    const rel = mins <= 0 ? tr("Now") : mins < 60 ? tr("In {min} min", {min:mins}) : days === 0 ? (mins % 60 ? tr("In {h} h {min} min", {h:Math.floor(mins / 60), min:mins % 60}) : tr("In {h} h", {h:mins / 60})) :
      days === 1 ? tr("Tomorrow") : d.toLocaleDateString([], {weekday:"long"});
    el.innerHTML = '<h3>' + esc(this.name) + '</h3><div class="when">' + esc(rel) + '</div><div class="what" data-keep' + (e.color ? ' style="border-left:6px solid ' + esc(e.color) + ';padding-left:12px"' : "") + '>' + esc(e.summary || "") + '</div>' +
      '<div class="sub">' + (e.allDay ? tr("All day") : fmtTime(d)) + (days > 1 ? " · " + d.toLocaleDateString([], {month:"short", day:"numeric"}) : "") + (e.location ? " · " + esc(e.location) : "") + '</div>';
  }
});
