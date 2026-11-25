/* Clock: the time and date, in one of several styles */
Tile("clock", {
  title:"Clock", cat:"Time", card:false, every:1, size:[18, 6, 10, 4], feeds:["events"],
  desc:"The time and date. Pick a style, then change its font, size and color. Can add a greeting and countdowns to holidays.",
  settings:{
    style:{look:true, type:"choice", label:"Style", choices:["Classic", "Bold", "Serif", "Digital", "Rounded", "Stacked", "Minimal"], default:"Classic", preview:true},
    font:{look:true, type:"choice", label:"Font", choices:["Style default", "System", "Outfit", "Bebas Neue", "DM Serif Display", "Fraunces", "JetBrains Mono", "Nunito", "Space Grotesk"], default:"Style default"},
    size:{look:true, type:"int", label:"Text size (%)", min:60, max:160, default:100},
    align:{look:true, type:"choice", label:"Align", choices:["Left", "Center", "Right"], default:"Left"},
    color:{look:true, type:"color", label:"Time color", default:"#ffffff"},
    ampm:{type:"bool", label:"Show AM/PM", default:true},
    seconds:{type:"bool", label:"Show seconds", default:false},
    date:{part:"date", type:"bool", label:"Show the date", default:true},
    greeting:{part:"greet", type:"bool", label:"Greeting (\"Lunch time? 🥪\")", default:true},
    countdowns:{part:"count", type:"bool", label:"Countdown to the next holidays", default:true},
    extra:{type:"list", share:false, label:"Your own countdowns", help:"One per line: Label, YYYY-MM-DD", default:[]}
  },

  css:`.dz .ap{font-size:.4em;margin-left:.15em;opacity:.85}
    .dz .ss{font-size:.45em;opacity:.75}`,
  // the parts of the clock, for the tile designer: what each would show right now
  parts(){
    const d = new Date(), s = this.s, sea = season(d);
    return [
      {id:"time", label:"Time", html:this.timeHtml(d), big:true},
      {id:"date", label:"Date", html:esc(fmtLongDate(d))},
      {id:"greet", label:"Greeting", html:esc(hello(d)), emoji:true},
      {id:"holiday", label:"Holiday", html:sea.greet ? esc(sea.greet) : "", emoji:true},
      {id:"bday", label:"Birthdays", html:STATE.bday.length ? "🎂 " + STATE.bday.map(e => esc(e.summary)).join(", ") : "", emoji:true},
      {id:"count", label:"Countdowns", html:esc(this.countdowns(d))}];
  },
  timeHtml(d){
    const s = this.s;
    const P = new Intl.DateTimeFormat([], Object.assign({hour:"numeric", minute:"2-digit"}, s.seconds ? {second:"2-digit"} : {}, LOOK.h24 ? {hourCycle:"h23"} : {hour12:true})).formatToParts(d);
    const v = t => (P.find(x => x.type === t) || {}).value || "";
    return '<span class="hh">' + v("hour") + '</span><span class="sep">:</span><span class="mm">' + v("minute") + '</span>' +
      (s.seconds ? '<span class="ss">:' + v("second") + '</span>' : "") + (s.ampm !== false && v("dayPeriod") ? '<span class="ap">' + v("dayPeriod") + '</span>' : "");
  },
  countdowns(d){
    const s = this.s, hol = s.countdowns || designed(this);      // in a design, the Countdowns part's switch decides
    if (!hol && !(s.extra || []).length) return "";
    const t0 = startOfDay(d), all = [];
    for (const raw of (s.extra || [])){
      const m = String(raw).split(",");
      if (m.length >= 2){ const dd = new Date(m[m.length - 1].trim() + "T00:00:00"); if (!isNaN(dd)) all.push({t:m.slice(0, -1).join(",").trim(), d:dd}); }
    }
    if (hol) for (const y of [d.getFullYear(), d.getFullYear() + 1]) holidaysIn(y).forEach(h => all.push({t:h.t.replace(/^\S+\s/, ""), d:h.d}));
    const soon = all.map(x => ({t:x.t, n:Math.round((startOfDay(x.d) - t0) / 86400e3)})).filter(x => x.n > 0)
      .sort((a, b) => a.n - b.n).filter((x, i, a) => a.findIndex(y => y.t === x.t) === i).slice(0, 2);
    return soon.map((x, i) => tr(x.n === 1 ? "{name} tomorrow" : i ? "{name} in {n}" : "{name} in {n} days", {name:x.t, n:x.n})).join("  ·  ");
  },

  render(el){
    if (designed(this)) return designRender(el, this);
    const d = new Date(), s = this.s, st = slug(s.style);
    const key = [st, s.font, s.size, s.align, s.color, s.date].join("|");
    if (!el.querySelector(":scope > .m-clock") || el._k !== key){
      el._k = key; el._c = false;
      el.innerHTML = '<div class="m-clock cs-' + st + '"><div class="t" data-part="time" data-keep></div><div class="d"></div><div class="c" data-part="count"></div></div>';
      styleBox(el.firstChild, s, st, "Left");
      el.querySelector(".t").style.color = s.color && s.color.toLowerCase() !== "#ffffff" && !THEMEV.themeWins ? s.color : "";      // the theme can win over this
    }
    const th = this.timeHtml(d);
    const te = el.querySelector(".t"); if (te.innerHTML !== th) te.innerHTML = th;
    const sea = season(d);
    const bits = [];
    if (s.date !== false) bits.push('<span data-part="date">' + esc(fmtLongDate(d)) + '</span>');
    if (s.greeting) bits.push('<span data-part="greet">' + esc(hello(d)) + '</span>');
    if (sea.greet) bits.push('<b data-part="holiday">' + esc(sea.greet) + '</b>');
    if (STATE.bday.length) bits.push('<b data-part="bday">🎂 ' + STATE.bday.map(e => esc(e.summary)).join(", ") + '</b>');
    const html = bits.join("  ·  ");      // the date, greeting, holiday and birthdays each have their own switch (or none)
    const de = el.querySelector(".d"); if (de.innerHTML !== html) de.innerHTML = html;
    if (d.getSeconds() === 0 || !el._c){ el._c = true; el.querySelector(".c").textContent = this.countdowns(d); }
  }
});
