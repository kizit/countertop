/* ---------- built-in themes: ready-made looks every Countertop has ----------
   Shared by the dashboard and Controls. Each one is complete, so it looks the same whatever theme you use, and is
   never saved in your settings: look.use and schedule rules just name its id. Ids start with "builtin-", which your own
   themes never do (they start with "t"), and stay the same from release to release. An older Countertop that doesn't
   know an id shows Everyday instead. */
const THEMELIB = (function(){
  const BASE = {mode:"Dark", accent:"#7cb7ff", holiday:false, tiles:"Solid", opacity:60, textScale:100, titles:true, bg:"Sky", bgColor:"#0a0c0f", dim:0, fx:"On"};
  const T = (id, name, sub, values, starter) => ({id:"builtin-" + id, name, sub, values:Object.freeze(Object.assign({}, BASE, values)), builtin:true, starter});
  const L = [
    T("dark", "Dark", "Dark tiles over a sky that follows the sun", {}),
    T("light", "Light", "Light tiles on a soft gray background", {mode:"Light", bg:"Color", bgColor:"#d9e0e8", accent:"#2b7de9"}),
    T("glass", "Glass", "See-through tiles so the sky shows through", {tiles:"See-through", opacity:45}),
    T("photo-frame", "Photo frame", "Your photos behind see-through tiles", {bg:"Photos", tiles:"See-through", opacity:55}),
    T("calm-evening", "Calm evening", "Warmer, a little dimmer, no effects", {accent:"#ff9f5a", dim:30, fx:"Off", tiles:"See-through", opacity:55}),
    T("atmospheric", "Atmospheric", "Warm light over the changing sky", {tiles:"See-through", opacity:38, accent:"#ffcc91"}, "atmospheric"),
    T("minimal", "Minimal", "No boxes, deep green on warm paper", {mode:"Light", bg:"Color", bgColor:"#f4f0e8", tiles:"Clear", accent:"#376a63", fx:"Off"}, "minimal"),
    T("kitchen-table", "Kitchen table", "Light tiles on sage green", {mode:"Light", bg:"Color", bgColor:"#dce4cf", accent:"#56703b", fx:"Off"}, "kitchen"),
    T("weather-station", "Weather station", "Teal on deep blue-green, see-through tiles", {bg:"Color", bgColor:"#132d38", accent:"#69daca", tiles:"See-through", opacity:55}, "weather"),
    T("family-planner", "Family planner", "Light tiles on soft lavender", {mode:"Light", bg:"Color", bgColor:"#e4dfed", accent:"#76508a", fx:"Off"}, "planner")];
  const get = id => L.find(t => t.id === id) || null;
  return {L, BASE, get, has: id => !!get(id), forStarter: key => L.find(t => t.starter === key) || null};
})();
