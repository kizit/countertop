/* On sale: things you usually buy that are in this week's store ads */
Tile("sales", {
  title:"On sale", cat:"Lists & food", cls:"m-sales", size:[12, 12, 8, 6], feeds:["sales"],
  desc:"Things you usually buy that are in this week's store ads, with the price and what you usually pay. Set your ZIP code and stores in Setup → Store deals. The Cards layout fills a whole page.",
  settings:{
    count:{type:"int", label:"Deals to show", default:6, min:1, max:20},
    layout:{type:"choice", label:"Layout", choices:["List", "Cards"], default:"List"},
    skipListed:{type:"bool", label:"Skip deals a list tile already shows", default:false}
  },
  has(){ return !this.s.skipListed || deals().filter(d => d.why !== "onlist").length > (STATE.salesShown || 0); },
  render(el){
    const s = this.s, n = s.count || 6, st = STATE.sales || {};
    let D = deals();
    if (s.skipListed) D = D.filter(d => d.why !== "onlist").slice(STATE.salesShown || 0);
    const setup = CFG.deals && CFG.deals.settings && CFG.deals.settings.zip;
    const empty = !setup ? "Set your ZIP code and stores in Setup → Store deals" : !STATE.sales || st.loading || st.busy ? "Checking this week's ads…" :
      st.error ? "Couldn't reach the weekly ads" : st.library === false ? "No purchase history yet" : "None of your usuals are on sale";
    el.classList.toggle("cards", s.layout === "Cards");
    if (s.layout === "Cards"){
      const stores = [...new Set(D.map(d => d.store))], upd = st.at ? new Date(st.at * 1000) : null;
      let h = '<div class="mh"><h1>' + esc(this.name) + '<small>' + esc(stores.join(" · ")) + '</small></h1><div class="back">' +
        (st.watching ? "Watching " + st.watching + " things you buy" + (upd ? " · checked " + upd.toLocaleDateString([], {weekday:"short"}) + " " + shortTime(upd) : "") : "") + '</div></div>';
      if (!D.length){ el.innerHTML = h + '<div class="empty big">' + empty + '</div>'; return; }
      const until = d => { const t = d.until ? new Date(d.until) : null; return t && !isNaN(t) ? "through " + new Date(t - 1000).toLocaleDateString([], {weekday:"short", month:"numeric", day:"numeric"}) : ""; };
      el.innerHTML = h + '<div class="sgrid" data-keep>' + D.slice(0, n).map(d => {
        const price = !d.price || /^\s*sale\s*$/i.test(d.price) ? "On sale" : d.price;
        const save = d.usual && d.now && d.usual > d.now + 0.05 ? "You usually pay $" + d.usual.toFixed(2) : (d.story && !/^\s*(on )?sale\s*$/i.test(d.story) ? d.story : "");
        return '<div class="sc' + (d.why === "onlist" ? " onlist" : "") + '">' +
          (d.img ? '<div class="im" style="background-image:url(&quot;' + esc(d.img) + '&quot;)"></div>' : '<div class="im none">🏷</div>') +
          '<div class="tx"><b>' + esc(dealName(d)) + '</b><span class="pr">' + esc(price) + '</span>' +
          '<span class="st">' + esc(d.store) + (d.why === "onlist" ? ' · <u>on your list</u>' : "") + '</span>' +
          (save ? '<span class="sv">' + esc(save) + '</span>' : "") + '<span class="un">' + esc(until(d)) + '</span></div></div>';
      }).join("") + '</div>';
      return;
    }
    let h = '<h3><span>' + esc(this.name) + '</span><small>' + (D.length ? "things you usually buy" : "") + '</small></h3>';
    h += D.length ? '<div class="dl" data-keep>' + D.slice(0, n).map(dealRow).join("") + '</div>' : '<div class="empty">' + empty + '</div>';
    el.innerHTML = h;
  }
});
