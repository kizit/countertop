/* Dad joke: a groaner, with the punchline a few seconds later */
Tile("joke", {
  title:"Dad joke", cat:"Fun", cls:"m-fun", every:5, size:[10, 6, 8, 6], narrow:340,
  desc:"A dad joke from icanhazdadjoke.com. The punchline shows a few seconds after the setup.",
  settings:{
    every:{type:"int", label:"Seconds per joke", default:90, min:20, max:3600},
    punch:{type:"int", label:"Punchline after (seconds)", default:7, min:0, max:60}
  },
  render(el){
    if (!funDue(el, this.s)) return;
    dadJoke().then(j => {
      let item = j;
      if (!item){
        const P = FALLBACK.filter(f => f.h === "Dad joke"), f = P[Math.floor(Math.random() * P.length)], p = f.t.split(/(?<=[?.!])\s+(?=\S)/);
        item = {h:f.h, t:p[0], a:p.slice(1).join(" ")};
      }
      funShow(el, item, this.s.punch);
    });
  }
});
