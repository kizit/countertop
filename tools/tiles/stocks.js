/* Stocks: prices and today's change for the symbols you pick */
Tile("stocks", {
  api:1, uses:["fetch"],
  title:"Stocks", cat:"Money", every:60, size:[12, 10, 8, 5],
  desc:"Prices for the stocks, funds or indexes you pick, with today's change and a little chart of the day. Prices can be up to 15 minutes old. Not investment advice.",
  settings:{
    syms:{type:"list", label:"Symbols", help:"One per line, like on Yahoo Finance: AAPL, VOO, ^GSPC (S&P 500), BTC-USD", placeholder:"AAPL", default:["^GSPC", "^DJI", "^IXIC"]},
    names:{type:"bool", label:"Show company names", default:true},
    chart:{type:"bool", label:"Little chart of the day", default:true}
  },
  css:`.m-stocks .sk{display:grid;grid-template-columns:minmax(0,1fr) 90px auto;align-items:center;gap:12px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.06)}
    .m-stocks .sk:last-child{border-bottom:0}
    .m-stocks .sk .n{font-size:24px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .m-stocks .sk .n small{display:block;font-size:15px;font-weight:400;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .m-stocks .sk .v{text-align:right;font-size:24px;white-space:nowrap}
    .m-stocks .sk .v small{display:block;font-size:17px}
    .m-stocks .up{color:#7ee08a} .m-stocks .dn{color:#ff8a80}
    .m-stocks svg{width:90px;height:32px}
    .slot.narrow > .m-stocks svg{display:none} .slot.narrow > .m-stocks .sk{grid-template-columns:minmax(0,1fr) auto}`,
  cls:"m-stocks",
  render(el){
    const esc = x => this.esc(x);
    const syms = (this.s.syms || []).map(x => String(x).trim()).filter(Boolean);
    if (!syms.length){ el.innerHTML = '<h3>' + esc(this.name) + '</h3><div class="empty">Add symbols in this tile\'s settings</div>'; return; }
    const d = this.fetch("/stocks?s=" + encodeURIComponent(syms.join(",")), 300);
    const NAMES = {"^GSPC":"S&P 500", "^DJI":"Dow Jones", "^IXIC":"Nasdaq", "^RUT":"Russell 2000"};
    let h = '<h3>' + esc(this.name) + '</h3>';
    if (!d){ el.innerHTML = h + '<div class="empty">Loading…</div>'; return; }
    h += (d.stocks || []).map(q => {
      if (q.price == null) return '<div class="sk"><div class="n">' + esc(q.sym) + '<small>Couldn\'t load</small></div></div>';
      const ch = q.prev ? (q.price - q.prev) / q.prev * 100 : 0, cls = ch >= 0 ? "up" : "dn";
      let sv = "";
      if (this.s.chart !== false && q.spark && q.spark.length > 2){
        const lo = Math.min(...q.spark, q.prev || Infinity), hi = Math.max(...q.spark, q.prev || -Infinity), sp = hi - lo || 1;
        const pts = q.spark.map((v, i) => (i / (q.spark.length - 1) * 90).toFixed(1) + "," + (30 - (v - lo) / sp * 28).toFixed(1)).join(" ");
        sv = '<svg viewBox="0 0 90 32">' + (q.prev ? '<line x1="0" x2="90" y1="' + (30 - (q.prev - lo) / sp * 28).toFixed(1) + '" y2="' + (30 - (q.prev - lo) / sp * 28).toFixed(1) + '" stroke="rgba(255,255,255,.2)" stroke-dasharray="3 3"/>' : "") +
          '<polyline fill="none" stroke="' + (ch >= 0 ? "#7ee08a" : "#ff8a80") + '" stroke-width="2" points="' + pts + '"/></svg>';
      }
      const price = q.price >= 1000 ? Math.round(q.price).toLocaleString() : q.price.toFixed(2);
      return '<div class="sk"><div class="n">' + esc(NAMES[q.sym] || q.sym) + (this.s.names !== false && q.name && q.name !== q.sym && !NAMES[q.sym] ? '<small>' + esc(q.name) + '</small>' : "") + '</div>' + (sv || "<span></span>") +
        '<div class="v">' + price + '<small class="' + cls + '">' + (ch >= 0 ? "▲ " : "▼ ") + Math.abs(ch).toFixed(2) + '%</small></div></div>';
    }).join("");
    el.innerHTML = h;
  }
});
