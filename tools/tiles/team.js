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
    el.innerHTML = h;
  }
});
