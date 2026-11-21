/* Daily: a to-do list for the day, kept on this dashboard itself (work/daily.json).
   Add items right on the screen, tick them off — every day at 00:00 the ticks are cleared, the items stay. */
Tile("daily", {
  title:"Daily list", cat:"Lists & food", size:[12, 8, 8, 6], every:5,
  desc:"A to-do list for the day that lives on this dashboard: type in the box, tap + to add, tap a line to tick it off, × to delete. Every night at midnight the ticks are cleared automatically — the items stay.",
  settings:{
    max:{type:"int", label:"Items to show", default:20, min:5, max:60}
  },
  css:`.m-daily .add{display:flex;gap:8px;margin:4px 0 10px}
    .m-daily .add input{flex:1;min-width:0;font-size:20px;padding:10px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;outline:none}
    .m-daily .add input:focus{border-color:var(--accent)}
    .m-daily .add button{font-size:26px;line-height:1;width:50px;border-radius:12px;border:0;background:var(--accent);color:#fff;cursor:pointer}
    .m-daily .dl{display:flex;flex-direction:column}
    .m-daily .di{display:flex;align-items:center;gap:12px;padding:9px 2px;border-bottom:1px solid rgba(255,255,255,.06);cursor:pointer;font-size:22px}
    .m-daily .di .cb{width:30px;height:30px;border-radius:9px;border:2px solid rgba(255,255,255,.35);display:flex;align-items:center;justify-content:center;font-size:19px;color:#fff;flex:none;transition:background .15s,border-color .15s}
    .m-daily .di.done .cb{background:var(--accent);border-color:var(--accent)}
    .m-daily .di .tx{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .m-daily .di.done .tx{text-decoration:line-through;opacity:.45}
    .m-daily .di .rm{color:var(--dim);font-size:26px;line-height:1;padding:2px 8px;border-radius:8px}
    .m-daily .di .rm:active{color:#ff8a80}
    .m-daily .bar{display:flex;align-items:center;gap:10px;margin-top:8px;color:var(--dim);font-size:16px}
    .m-daily .bar button{font-size:15px;padding:5px 12px;border-radius:999px;background:rgba(255,255,255,.1);border:0;color:var(--dim);cursor:pointer}
    .m-daily h3 small{float:right}`,
  cls:"m-daily",
  has(){ return true; },
  render(el){
    const s = this.s, max = s.max || 20;
    const d = tileData(this, "/daily", 5);
    let h = '<h3>' + esc(this.name) + (d && d.date ? '<small>' + esc(d.date) + '</small>' : "") + '</h3>';
    if (!d){ el.innerHTML = h + '<div class="empty">Loading…</div>'; return; }
    const items = d.items || [];
    h += '<form class="add"><input type="text" maxlength="80" placeholder="Something to do today…" autocomplete="off" autocapitalize="sentences"><button type="button" class="addbtn" title="Add">+</button></form>';
    h += items.length
      ? '<div class="dl">' + items.slice(0, max).map(i =>
          '<div class="di' + (i.done ? " done" : "") + '" data-id="' + esc(i.id) + '"><span class="cb">' + (i.done ? "✓" : "") + '</span><span class="tx">' + esc(i.text) + '</span><span class="rm" data-rm="' + esc(i.id) + '" title="Delete">×</span></div>').join("") + '</div>' +
          (items.length > max ? '<div class="empty">+' + (items.length - max) + ' more</div>' : "")
      : '<div class="empty">Nothing today — add the first thing below… no, above ☝️</div>';
    const done = items.filter(i => i.done).length;
    if (items.length) h += '<div class="bar"><span>' + done + ' / ' + items.length + ' done · ticks reset at 00:00</span><button data-op="reset" title="Untick everything now">Untick all</button></div>';
    el.innerHTML = h;
    if (!el._daily){
      el._daily = true;
      el.addEventListener("submit", e => {
        e.preventDefault();
        if (EDIT.on || PREVIEW) return;
        const inp = el.querySelector(".add input");
        const text = inp ? inp.value.trim() : "";
        if (!text) return;
        inp.value = "";
        this.post("add", {text});
      });
      el.addEventListener("click", e => {
        if (EDIT.on || PREVIEW) return;
        const add = e.target.closest(".addbtn");
        if (add){
          const inp = el.querySelector(".add input");
          const text = inp ? inp.value.trim() : "";
          if (text){ inp.value = ""; this.post("add", {text}); }
          return;
        }
        const rm = e.target.closest("[data-rm]");
        if (rm){ e.stopPropagation(); this.post("remove", {id: rm.getAttribute("data-rm")}); return; }
        const op = e.target.closest("[data-op]");
        if (op){ this.post(op.getAttribute("data-op"), {}); return; }
        const row = e.target.closest(".di");
        if (row) this.post("toggle", {id: row.getAttribute("data-id")});
      });
    }
  },
  post(op, extra){
    fetch("/daily", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(Object.assign({op}, extra || {}))})
      .then(r => r.json())
      .then(j => { if (this._fd){ this._fd.data = j; this._fd.at = Date.now(); } render(this.id); })
      .catch(() => {});
  }
});
