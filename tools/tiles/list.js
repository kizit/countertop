/* List: a shopping or to-do list kept on this dashboard, or mirrored from another app */
Tile("list", {
  title:"List", cat:"Lists & food", cls:"m-groc", size:[12, 12, 8, 6], feeds:["notes", "sales"],
  desc:"A shopping or to-do list. Lists kept on this dashboard can be added to and ticked right on the tile or in Controls → Lists — no other app needed — and a list can clear its ticks every day at 00:00 while the items stay (Controls → Lists). Lists kept in another app are shown here and added from your phone at /list.",
  settings:{
    list:{type:"source", kind:"lists", label:"List", default:""},
    max:{type:"int", label:"Items to show", default:20, min:2, max:40},
    addBox:{type:"bool", label:"Add box on the tile", default:true, help:"Off: the tile only shows the items; add and edit them in Controls → Lists instead."},
    saleTag:{type:"bool", label:"Tag items that are on sale this week", default:true, needs:"deals"},
    deals:{type:"bool", label:"Fill spare room with deals on things you usually buy", default:false, needs:"deals"}
  },
  css:`.m-groc.editable .gl{grid-template-columns:1fr}
    .m-groc .add{display:flex;gap:8px;margin:2px 0 10px}
    .m-groc .add input{flex:1;min-width:0;font-size:20px;padding:9px 13px;border-radius:12px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;outline:none}
    .m-groc .add input:focus{border-color:var(--accent)}
    .m-groc .add button{font-size:26px;line-height:1;width:48px;border-radius:12px;border:0;background:var(--accent);color:#fff;cursor:pointer;flex:none}
    .m-groc.editable .gi{cursor:pointer}
    .m-groc .gi i.cb{width:28px;height:28px;border-radius:8px;border:2px solid rgba(255,255,255,.35);background:transparent;opacity:1;display:flex;align-items:center;justify-content:center;font-size:17px;font-style:normal;color:#fff;flex:none;transition:background .15s,border-color .15s}
    .m-groc .gi.done i.cb{background:var(--accent);border-color:var(--accent)}
    .m-groc .gi > span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
    .m-groc .gi.done > span{text-decoration:line-through;opacity:.45}
    .m-groc .gi .rm{flex:none;color:var(--dim);font-size:24px;line-height:1;padding:2px 7px;border-radius:8px;cursor:pointer}
    .m-groc .gi .rm:active{color:var(--bad)}
    .m-groc .bar{display:flex;align-items:center;gap:10px;margin-top:8px;color:var(--dim);font-size:15px}
    .m-groc .bar button{font-size:14px;padding:5px 11px;border-radius:999px;background:rgba(255,255,255,.1);border:0;color:var(--dim);cursor:pointer}
    .m-groc h3 small{float:right}`,

  render(el){
    const s = this.s, max = s.max || 12;
    const src = (SOURCES.lists || []).find(x => x.id === s.list);
    const local = !!(src && (!src.kind || src.kind === "This dashboard"));
    const d = local ? tileData(this, "/notes?list=" + encodeURIComponent(s.list), 5) : STATE.notes;
    el.classList.toggle("editable", local);
    const daily = !!(d && d.daily);
    const name = this.it.name || (d && d.list) || (src && src.name) || this.name;
    let h = '<h3><span>' + esc(name) + '</span><small>' + (local
      ? (daily ? "ticks reset at 00:00" : "kept on this dashboard")
      : (d && d.source === "reminders" ? "from Reminders" : d && (d.source === "pushed" || d.source === "url") ? "from " + esc(d.via || "another app") : "add from your phone: " + esc(location.host) + "/list")) + '</small></h3>';
    if (!d){ el.innerHTML = h + '<div class="empty">Loading…</div>'; return; }
    if (d.note) h += '<div class="note">📌 ' + esc(d.note) + '</div>';

    if (local){
      const items = d.items || [], addBox = s.addBox !== false;
      if (addBox) h += '<form class="add"><input type="text" maxlength="80" placeholder="Add something…" autocomplete="off" autocapitalize="sentences"><button type="button" class="addbtn" title="Add">+</button></form>';
      h += items.length
        ? '<div class="gl" data-keep>' + items.slice(0, max).map(i =>
            '<div class="gi' + (i.done ? " done" : "") + '" data-id="' + esc(i.id) + '"><i class="cb">' + (i.done ? "✓" : "") + '</i><span>' + esc(i.text) + '</span><span class="rm" data-rm="' + esc(i.id) + '" title="Delete">×</span></div>').join("") + '</div>' +
            (items.length > max ? '<div class="empty">+' + (items.length - max) + ' more</div>' : "")
        : '<div class="empty">Nothing on the list yet' + (addBox ? " — add the first item above…" : "") + '</div>';
      const done = items.filter(i => i.done).length;
      if (items.length) h += '<div class="bar"><span>' + done + ' / ' + items.length + ' done' + (daily ? " · resets at 00:00" : "") + '</span><button data-op="reset" title="Untick everything now">Untick all</button></div>';
    } else {
      const open = (d.items || []).filter(i => !i.done);
      h += open.length ? '<div class="gl" data-keep>' + open.slice(0, max).map(i => { const dl = s.saleTag !== false && dealFor(i.text);
        return '<div class="gi"><i></i><span>' + esc(i.text) + '</span>' + (dl ? '<u>🏷 ' + esc(dl.price) + ' ' + esc(dl.store) + '</u>' : "") + '</div>'; }).join("") + '</div>' +
        (open.length > max ? '<div class="empty">+' + (open.length - max) + ' more</div>' : "")
        : '<div class="empty">' + (d.error ? (d.source === "reminders" ? "Reminders didn't answer yet" : esc(d.error)) : "Nothing on the list 🎉") + '</div>';
      // spare room: extras that give way as the list grows
      const blocks = [];
      const SD = deals().filter(d => d.why !== "onlist");
      if (s.deals && SD.length){
        blocks.push('<div class="fb sl"><small>On sale · things you usually buy</small><div class="dl">' + SD.slice(0, 6).map(dealRow).join("") + '</div></div>');
      }
      h += '<div class="filler">' + blocks.join("") + '</div>';
    }
    el.innerHTML = h;

    if (local){
      if (!el._listBound){
        el._listBound = true;
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
          const row = e.target.closest(".gi[data-id]");
          if (row) this.post("toggle", {id: row.getAttribute("data-id")});
        });
      }
      return;
    }

    // narrow tile: one item per line; if that overflows, two columns; then smaller text
    el.classList.remove("two", "small");
    const gl = el.querySelector(".gl");
    if (gl && el.clientWidth < 600){
      el.classList.add("narrow");
      if (el.scrollHeight > el.clientHeight + 2) el.classList.add("two");
      if (el.scrollHeight > el.clientHeight + 2) el.classList.add("small");
    } else el.classList.remove("narrow");
    // show only the extras that fit; the list always wins
    const f = el.querySelector(".filler"), fb = [...f.children];
    requestAnimationFrame(() => {
      let room = f.clientHeight;
      fb.forEach(b => {
        b.hidden = false;
        if (b.classList.contains("sl")){                       // trim deals to fit before giving up the block
          const rows = [...b.querySelectorAll(".dr")];
          while (b.offsetHeight + 14 > room && rows.length > 2) rows.pop().remove();
        }
        const need = b.offsetHeight + 14; if (need > room) b.hidden = true; else room -= need;
        if (b.classList.contains("sl")) STATE.salesShown = b.hidden ? 0 : b.querySelectorAll(".dr").length;
      });
      if (!f.querySelector(".sl")) STATE.salesShown = 0;
    });
  },

  post(op, extra){
    fetch("/notes", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(Object.assign({op, list:this.s.list}, extra || {}))})
      .then(r => r.json())
      .then(j => { if (this._fd){ this._fd.data = j; this._fd.at = Date.now(); } render(this.id); })
      .catch(() => {});
  }
});
