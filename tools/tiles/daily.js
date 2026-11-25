/* Daily to-do: a checklist kept by this tile itself (the tile API's this.store). Ticks clear each morning; the items stay. */
Tile("daily", {
  api:1, uses:["store"],
  title:"Daily to-do", cat:"Lists & food", size:[12, 10, 8, 6], every:60,
  desc:"A checklist for the day that lives on this tile: add things right on the screen, tap to tick them off. Each morning the ticks clear and the items stay, ready for the new day. Every Daily to-do tile keeps its own list.",
  settings:{
    max:{type:"int", label:"Items to show", default:20, min:3, max:60},
    reset:{type:"bool", label:"Clear the ticks every morning", default:true},
    add:{type:"bool", label:"Show the Add box", help:"Turn off once the list is set, so nothing gets added by accident", default:true},
    done:{type:"choice", label:"Ticked items", choices:["Stay in place", "Move to the bottom"], default:"Move to the bottom"}
  },
  demoData:{day:"", items:[{id:"a", text:"Take vitamins", done:true}, {id:"b", text:"Water the plants", done:false},
    {id:"c", text:"Walk the dog", done:false}, {id:"d", text:"Pack lunches", done:true}]},
  css:`.m-daily{display:flex;flex-direction:column}
    .m-daily h3 small{font-weight:400;color:var(--dim)}
    .m-daily .add{display:flex;gap:8px;margin:2px 0 8px}
    .m-daily .add input{flex:1;min-width:0;font:inherit;font-size:22px;padding:10px 14px;border-radius:12px;border:1px solid var(--line);background:var(--line);color:inherit;outline:none}
    .m-daily .add input:focus{border-color:var(--accent)}
    .m-daily .add button{font:inherit;font-size:28px;line-height:1;width:2.2em;border:0;border-radius:12px;background:var(--accent);color:#fff}
    .m-daily .dl{flex:1 1 auto;min-height:0}
    .m-daily .di{display:flex;align-items:center;gap:.55em;font-size:26px;padding:.3em 0;border-bottom:1px solid var(--line)}
    .m-daily .di .cb{width:1.25em;height:1.25em;flex:none;border-radius:.3em;border:2px solid var(--dim);display:flex;align-items:center;justify-content:center;font-size:.9em}
    .m-daily .di.done .cb{background:var(--accent);border-color:var(--accent);color:#fff}
    .m-daily .di .tx{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .m-daily .di.done .tx{text-decoration:line-through;opacity:.45}
    .m-daily .di .rm{color:var(--dim);padding:0 .3em;font-size:1.2em;line-height:1}
    .m-daily .empty{color:var(--dim);font-size:22px}
    .m-daily.narrow .di{font-size:21px}
    .m-daily.mini h3{display:none} .m-daily.mini .add{margin:0 0 4px} .m-daily.mini .add input{padding:4px 10px}`,
  cls:"m-daily",
  dayNow(){ const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); },
  render(el){
    const s = this.s, st = this.store, d = st.get(), today = this.dayNow();
    // ticks from an earlier day: untick everything once (`unless` makes a second screen doing the same a no-op).
    // Every tick also stamps the day, so a tick made today never counts as yesterday's.
    if (st.ready && s.reset !== false && d.day !== today && (d.items || []).some(i => i.done) && el._resetFor !== today){
      el._resetFor = today;
      st.change([{op:"updateAll", key:"items", fields:{done:false}}, {op:"set", key:"day", value:today}], {day:today});
    }
    let items = (d.items || []).slice();
    if (s.done !== "Stay in place") items = items.filter(i => !i.done).concat(items.filter(i => i.done));
    const max = Math.max(1, +s.max || 20), left = items.filter(i => !i.done).length;
    const inp = el.querySelector(".add input"), typed = inp ? inp.value : "", focused = inp && document.activeElement === inp;
    el.innerHTML = '<h3><span>' + esc(this.name) + '</span>' + (items.length ? '<small>' + (left ? left + " to go" : "all done ✓") + '</small>' : "") + '</h3>' +
      (s.add !== false ? '<form class="add"><input type="text" maxlength="80" enterkeyhint="done" autocomplete="off" placeholder="Add something for today"><button type="submit" aria-label="Add">+</button></form>' : "") +
      (!st.ready ? '<div class="empty">Loading…</div>'
        : items.length ? '<div class="dl">' + items.slice(0, max).map(i => '<div' + (i === items[0] ? " data-keep" : "") + ' class="di' + (i.done ? " done" : "") + '" data-id="' + esc(i.id) + '"><span class="cb">' + (i.done ? "✓" : "") +
          '</span><span class="tx">' + esc(i.text) + '</span><span class="rm" data-rm="1" aria-label="Delete">×</span></div>').join("") + '</div>' +
          (items.length > max ? '<div class="empty">+' + (items.length - max) + ' more</div>' : "")
        : '<div class="empty">' + (s.add !== false ? "Nothing yet. Add the first thing above." : "Nothing on this list. Turn on the Add box in its settings to add things.") + '</div>');
    const ni = el.querySelector(".add input");     // a redraw mustn't eat what someone is typing
    if (ni){ ni.value = typed; if (focused) ni.focus(); }
    el.classList.toggle("narrow", el.clientWidth < 520);
  },
  tap(e){
    const row = e.target.closest(".di"); if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest("[data-rm]")) this.store.remove("items", id);
    else this.store.change([{op:"update", key:"items", id, fields:{done:!row.classList.contains("done")}}, {op:"set", key:"day", value:this.dayNow()}]);
  },
  submit(e, el, form){
    const inp = form.querySelector("input"), text = (inp.value || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!text) return;
    inp.value = "";
    this.store.push("items", {text, done:false});
  }
});
