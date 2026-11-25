/* In season: fruit and vegetables at their best this month */
Tile("inseason", {
  title:"In season", cat:"Lists & food", cls:"m-dinner", every:3600, size:[10, 8, 8, 6],
  desc:"Fruit and vegetables at their best this month. The list is for the northern US; choose the southern hemisphere to flip the seasons.",
  settings:{
    region:{type:"choice", label:"Where", choices:["Northern hemisphere", "Southern hemisphere"], default:"Northern hemisphere", help:"The southern hemisphere's seasons are six months apart"}
  },
  css:`.m-dinner .chips.big i{max-width:100%;box-sizing:border-box;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .m-dinner.tight .chips.big i{font-size:18px;padding:4px 10px}`,
  render(el){
    const south = /^south/i.test(this.s.region || ""), m = (new Date().getMonth() + (south ? 6 : 0)) % 12;
    const title = this.it.name || "In season in " + new Date().toLocaleDateString([], {month:"long"});
    const key = m + "|" + title;
    if (el._m === key) return; el._m = key;
    el.innerHTML = '<h3><span>' + esc(title) + '</span></h3><div class="chips big" data-keep>' +
      IN_SEASON[m].map(x => '<i>' + esc(x) + '</i>').join("") + '</div>';
  }
});
