/* Team: your team's next match, live score and last result */
Tile("team", {
  title:"Team", cat:"Sports", cls:"m-team", every:300, size:[12, 8, 8, 6], narrow:400, feeds:["team"],
  takeover:"Take over the box on match day",
  desc:"Your team's next match, the live score during a game and the last result. Narrow boxes list the next few matches. Hides itself when no match is near, so a box can show something else. Set up teams in Setup → Sports teams.",
  settings:{
    team:{type:"source", kind:"teams", label:"Team", default:""},
    count:{type:"int", label:"Matches to list (narrow box)", default:3, min:1, max:5},
    within:{type:"int", label:"Show when the next match is within (days)", default:10, min:1, max:60},
    always:{type:"bool", label:"Always show, even with no match coming", default:false}
  },

  /* The team's own colors (the feed's `colors`: main and alternate, "#rrggbb"). The card's gradient is a deep shade of them, so the
     light text on it always reads; the crest and the badge use the colors themselves, with dark or light letters, whichever reads.
     No colors: the stylesheet's usual red, blue and gold stay. */
  lum(h){ const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4)); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; },
  mix(a, b, t){ const n = i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t); return "#" + [1, 3, 5].map(i => ("0" + n(i).toString(16)).slice(-2)).join(""); },
  ink(bg){ const r = c => (Math.max(this.lum(c), this.lum(bg)) + .05) / (Math.min(this.lum(c), this.lum(bg)) + .05); return r("#ffffff") >= r("#14171c") ? "#ffffff" : "#14171c"; },   // white or near-black letters, whichever reads better
  readable(bg){     // the color for a label's background: the team's own, nudged a little darker or lighter only if no letters read on it
    for (let i = 0; i < 10; i++){
      const ink = this.ink(bg), r = (Math.max(this.lum(ink), this.lum(bg)) + .05) / (Math.min(this.lum(ink), this.lum(bg)) + .05);
      if (r >= 4.5) return bg;
      bg = this.mix(bg, ink === "#ffffff" ? "#000000" : "#ffffff", .08);
    }
    return bg;
  },
  deep(h){ let x = h; for (let i = 0; i < 12 && this.lum(x) > .045; i++) x = this.mix(x, "#000000", .22); return x; },     // dark enough for light text
  palette(colors){
    const ok = c => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
    if (!Array.isArray(colors) || !ok(colors[0])) return null;
    const main = colors[0].toLowerCase(), alt = ok(colors[1]) ? colors[1].toLowerCase() : main;
    const bright = this.lum(main) < .02 && this.lum(alt) < .02 ? "#e8e8e8" : this.lum(main) < .02 ? alt : main;    // a black team still needs something to show
    const badge = this.readable(alt === main ? this.mix(main, "#ffffff", .35) : alt), crest = this.readable(main);
    return {"--team":crest, "--teamy":badge,
      "--teamb":this.deep(main), "--teamm":this.deep(this.mix(main, alt, .6)), "--teame":this.deep(this.mix(alt, "#000000", .35)),
      "--teamh":this.mix(bright, "#ffffff", .78), "--teamt":this.ink(crest), "--teambt":this.ink(badge),
      "--teamline":this.mix(bright, "#000000", .15) + "99", "--teamring":"0 0 0 2px rgba(255,255,255,.22)"};
  },
  paint(el, t){
    const P = this.palette(t && t.colors), VARS = ["--team", "--teamy", "--teamb", "--teamm", "--teame", "--teamh", "--teamt", "--teambt", "--teamline", "--teamring"];
    VARS.forEach(k => P ? el.style.setProperty(k, P[k]) : el.style.removeProperty(k));
  },
  // a playoff or knockout round, not just any cup match (a regular cup game isn't "PLAYOFFS")
  isPlayoff(notes){ return /\b(play-?offs?|postseason|knockout|(semi|quarter)-?finals?|finals?|round of \d+|last (16|32|8))\b/i.test(notes || ""); },
  compact(el, t){
    const up = (t.upcoming && t.upcoming.length ? t.upcoming : t.next ? [t.next] : []).slice(0, this.s.count || 3);
    const notes = up.map(g => g.note || "").join(" ") + " " + ((t.last && t.last.note) || "");
    const live = up.find(g => g.live), playoff = this.isPlayoff(notes);
    let h = '<h3><span>' + esc(teamShort(t.team)) + (up.length ? " · upcoming" : "") + '</span>' +
      (live ? '<span class="badge live">LIVE</span>' : playoff ? '<span class="badge">PLAYOFFS</span>' : "") + '</h3>';
    up.forEach((g, i) => {
      const d = new Date(g.date), today = dayKey(d) === dayKey(new Date());
      const day = g.live ? "Now" : today ? "Today" : d.toLocaleDateString([], {weekday:"short"}) + " " + (d.getMonth() + 1) + "/" + d.getDate();
      const right = g.live ? esc(g.us) + "–" + esc(g.them) + " · " + esc(g.clock || "") : esc(LOOK.h24 ? fmtTime(d) : fmtTime(d).replace(":00", ""));
      h += '<div class="g' + (i === 0 ? " next" : "") + '"><span class="d">' + esc(day) + '</span><span class="o"' + (i === 0 ? " data-keep" : "") + '>' + (g.home ? "vs " : "@ ") + esc(g.opp) +
        '</span><span class="t">' + right + '</span></div>';
    });
    if (!up.length) h += '<div class="g"><span class="o">No match scheduled</span></div>';
    const L = t.last;
    if (L && L.us != null){
      const r = L.winner === true ? "W" : (Number(L.us) === Number(L.them) ? "D" : "L");
      h += '<div class="lst">Last: <b class="' + r.toLowerCase() + '">' + r + " " + esc(L.us) + "–" + esc(L.them) + '</b> ' + (L.home ? "vs " : "@ ") + esc(L.opp) + '</div>';
    }
    el.classList.add("up");
    this.paint(el, t);
    el.innerHTML = h;
  },
  data(){ const id = this.s.team || ((SOURCES.teams || [])[0] || {}).id; return id ? STATE.teams[id] : null; },
  has(){
    const t = this.data(), s = this.s;
    if (!t || (!t.next && !t.last)) return !!s.always && !!t;
    if (s.always) return true;
    const now = Date.now();
    if (t.next && (t.next.live || new Date(t.next.date) - now < (s.within || 10) * 86400e3)) return true;
    if (t.last && now - new Date(t.last.date) < 2 * 86400e3) return true;
    return false;
  },
  urgent(){ const t = this.data(); if (!t || !t.next) return false; return !!t.next.live || Math.abs(new Date(t.next.date) - Date.now()) < 3 * 3600e3; },
  render(el){
    const t = this.data();
    if (!t){ el.innerHTML = '<h3>' + esc(this.name) + '</h3><div class="empty">' + ((SOURCES.teams || []).length ? "Loading…" : "Add your team in Setup → Sports teams") + '</div>'; return; }
    if (el.parentNode && /\b(pair|narrow)\b/.test(el.parentNode.className)) return this.compact(el, t);
    el.classList.remove("up");
    const g = t.next, name = t.team || this.name, playoff = this.isPlayoff(((g && g.note) || "") + " " + ((t.last && t.last.note) || ""));
    let h = '<h3><span>' + esc(name) + '</span>' + (g && g.live ? '<span class="badge live">LIVE</span>' : playoff ? '<span class="badge">PLAYOFFS</span>' : "") + '</h3>';
    if (g){
      const d = new Date(g.date), days = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400e3);
      const rel = days <= 0 ? "today" : days === 1 ? "tomorrow" : "in " + days + " days";
      const when = g.live ? (g.us + "–" + g.them + " · " + esc(g.clock)) :
        d.toLocaleDateString([], {weekday:"short"}) + " " + fmtTime(d) + " · " + (g.home ? "Home" : "Away") + " · " + rel;
      h += '<div class="row"><div class="crest">' + esc(teamShort(t.team)) + '</div><div><div class="vs" data-keep>' + (g.home ? "vs. " : "@ ") + esc(g.opp) +
        '</div><div class="when">' + when + '</div></div></div>';
    } else {
      h += '<div class="row"><div class="crest">' + esc(teamShort(t.team)) + '</div><div><div class="vs" data-keep>No match scheduled</div>' +
        (t.error ? '<div class="when">Couldn\'t load the schedule: ' + esc(String(t.error).slice(0, 120)) + '</div>' : "") + '</div></div>';
    }
    const L = t.last;
    if (L && L.us != null){
      const r = L.winner === true ? "W" : (Number(L.us) === Number(L.them) ? "D" : "L");
      h += '<div class="last">Last: <b class="' + r.toLowerCase() + '">' + r + " " + esc(L.us) + "–" + esc(L.them) + '</b> ' + (L.home ? "vs. " : "@ ") + esc(L.opp) + '</div>';
    }
    this.paint(el, t);
    el.innerHTML = h;
  }
});
