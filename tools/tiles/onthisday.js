/* On this day: something that happened on today's date, from Wikipedia */
Tile("onthisday", {
  title:"On this day", cat:"Fun", cls:"m-fun", every:5, size:[10, 6, 8, 6], narrow:340,
  desc:"Something that happened on today's date in history, from Wikipedia. A new one every minute or two.",
  settings:{ every:{type:"int", label:"Seconds per item", default:90, min:20, max:3600} },
  render(el){
    if (!funDue(el, this.s)) return;
    loadOnThisDay().then(() => {
      if (!onThisDay.length) return funShow(el, FALLBACK.find(f => f.h === "Kitchen fact"));
      el._i = ((el._i == null ? Math.floor(Math.random() * onThisDay.length) : el._i) + 1) % onThisDay.length;
      funShow(el, onThisDay[el._i]);
    });
  }
});
