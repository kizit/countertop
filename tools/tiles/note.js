/* Note: a message in big type */
Tile("note", {
  api:1, uses:[],
  title:"Note", cat:"Your own", size:[12, 8, 6, 4],
  desc:"A message in big type: Wi-Fi password for guests, a reminder, a welcome. Change it from here any time.",
  settings:{
    text:{type:"list", share:false, label:"Text", help:"Each line shows on its own line", placeholder:"Welcome home!", default:["Have a great day! 🌞"]},
    big:{type:"int", label:"Text size", default:44, min:20, max:120},
    align:{type:"choice", label:"Align", choices:["Left", "Center"], default:"Center"},
    color:{type:"color", label:"Text color", default:"#ffffff"},
    title:{type:"bool", label:"Show its name as a title", default:false}
  },
  css:`.m-note{display:flex;flex-direction:column}
    .m-note .tx{flex:1;display:flex;flex-direction:column;justify-content:center;line-height:1.2;overflow:hidden}`,
  cls:"m-note",
  render(el){
    const s = this.s, esc = x => this.esc(x);
    el.innerHTML = (s.title ? '<h3>' + esc(this.name) + '</h3>' : "") + '<div class="tx" style="font-size:' + (+s.big || 44) + 'px;text-align:' + (s.align === "Left" ? "left" : "center") + ';color:' + esc(s.color || "#fff") + '">' +
      ((s.text || []).map(esc).join("<br>") || "&nbsp;") + '</div>';
  }
});
