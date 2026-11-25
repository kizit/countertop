/* Agenda: your next events as a list */
Tile("agenda", {
  api:1, uses:["events"],
  title:"Agenda", cat:"Calendar", cls:"m-today", every:300, size:[12, 12, 8, 6], feeds:["events"],
  desc:"Your next events as a list, with the day and time. Repeating events show once, marked \"every Tue\". Uses the calendars you set up in Setup.",
  settings:{
    cals:{type:"source", kind:"calendars", multi:true, label:"Calendars", default:[]},
    count:{type:"int", label:"How many events", default:5, min:1, max:12},
    repeats:{type:"bool", label:"Show repeating events once", default:true}
  },
  render(el){
    const s = this.s, esc = x => this.esc(x), tr = (x, v) => this.t(x, v);
    const list = this.events({cals:s.cals, once:s.repeats !== false}).slice(0, s.count || 5);
    const today = new Date().toDateString(), tmr = new Date(Date.now() + 86400e3).toDateString();
    const none = !this.sources("calendars").length;
    el.innerHTML = '<h3>' + esc(this.name) + '</h3>' + (list.length ? list.map(e => {
      const d = e.date, ds = d.toDateString();
      const p = ds === today ? "" : ds === tmr ? tr("Tmrw") + " " : d.toLocaleDateString([], d - Date.now() > 6 * 86400e3 ? {month:"short", day:"numeric"} : {weekday:"short"}) + " ";
      return '<div class="li"' + (list[0] === e ? " data-keep" : "") + (e.color ? ' style="--ec:' + esc(e.color) + '"' : "") + '><div class="t">' + p + (e.allDay ? tr("All day") : d.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"})) + '</div><div class="s">' + esc(e.summary) +
        (e.rep ? '<span class="rep">' + esc(e.rep) + '</span>' : "") + '</div></div>';
    }).join("") : '<div class="empty">' + tr(none ? "Connect a calendar in Setup → Calendars" : "Nothing coming up") + '</div>');
  }
});
