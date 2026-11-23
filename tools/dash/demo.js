/* ---------- made-up data for the tile store's examples (?solo=<tile>): nothing about the owner shows ---------- */
function demoJSON(u){
  const now = new Date(), day = n => { const d = new Date(now); d.setDate(d.getDate() + n); return d; };
  const iso = (d, h, m) => { const x = new Date(d); x.setHours(h, m || 0, 0, 0); const p = v => String(v).padStart(2, "0");
    return x.getFullYear() + "-" + p(x.getMonth() + 1) + "-" + p(x.getDate()) + "T" + p(x.getHours()) + ":" + p(x.getMinutes()) + ":00"; };
  if (/api\.open-meteo\.com/.test(u)){
    const base = new Date(now); base.setMinutes(0, 0, 0);
    const H = {time:[], temperature_2m:[], precipitation_probability:[], weather_code:[], is_day:[]};
    for (let i = -30; i < 48; i++){
      const d = new Date(base.getTime() + i * 3600e3), h = d.getHours();
      H.time.push(iso(d, h).slice(0, 16)); H.temperature_2m.push(Math.round(58 + 10 * Math.sin((h - 9) / 24 * 2 * Math.PI)));
      H.precipitation_probability.push(i > 6 && i < 11 ? 55 : 5); H.weather_code.push(i > 6 && i < 11 ? 61 : 2); H.is_day.push(h >= 7 && h < 18 ? 1 : 0);
    }
    const D = {time:[], temperature_2m_max:[], temperature_2m_min:[], weather_code:[], precipitation_probability_max:[], sunrise:[], sunset:[]};
    [2, 61, 3, 1, 0, 2, 3, 1].forEach((c, i) => { const d = day(i), k = iso(d, 0).slice(0, 10);
      D.time.push(k); D.temperature_2m_max.push(66 + (i % 3) * 2); D.temperature_2m_min.push(47 + (i % 2) * 3); D.weather_code.push(c);
      D.precipitation_probability_max.push(c === 61 ? 60 : 10); D.sunrise.push(k + "T06:52"); D.sunset.push(k + "T17:31"); });
    const h = now.getHours();
    return {current:{temperature_2m:62, weather_code:2, is_day: h >= 7 && h < 18 ? 1 : 0}, hourly:H, daily:D};
  }
  if (/air-quality/.test(u)) return {current:{us_aqi:28}};
  if (/^\/events/.test(u)) return {events:[
    {summary:"Soccer practice", start:iso(day(0), 18, 30)}, {summary:"Dentist", start:iso(day(1), 9)},
    {summary:"Book club", start:iso(day(2), 19)}, {summary:"Farmers market", start:iso(day(4), 0).slice(0, 10), allDay:true},
    {summary:"Movie night", start:iso(day(5), 20)}]};
  if (/^\/notes/.test(u)) return {list:"Grocery", source:"reminders", note:"", items:["Milk", "Eggs", "Bread", "Coffee", "Bananas", "Pasta"].map((t, i) => ({id:"d" + i, text:t, done:false}))};
  if (/^\/sales/.test(u)) return {watching:30, at:Math.floor(now / 1000), deals:[
    {want:"Coffee", why:"onlist", name:"House blend coffee 12 oz", store:"Corner Market", price:"$6.99", now:6.99, usual:8.49},
    {want:"x", why:"usual", name:"Sparkling water 12-pk", store:"Big Box", price:"3/$12.00", now:4, usual:5.29},
    {want:"x", why:"usual", name:"Tortilla chips", store:"Corner Market", price:"$2.50", now:2.5, usual:3.99},
    {want:"x", why:"usual", name:"Vanilla ice cream", store:"Big Box", price:"$3.99", now:3.99, usual:5.49},
    {want:"x", why:"usual", name:"Breakfast sausage", store:"Warehouse Club", price:"$7.98", now:7.98, usual:9.48}]};
  if (/^\/team/.test(u)){
    const g = (n, opp, home) => ({date:new Date(iso(day(n), 19)).toISOString(), home, opp, note:"League match"});
    return {team:"Home FC", upcoming:[g(3, "River City", true), g(8, "Lakeside", false), g(13, "Northport", true)],
      next:Object.assign(g(3, "River City", true), {us:null, them:null, done:false, live:false, venue:"Home Stadium"}),
      last:{date:day(-4).toISOString(), home:false, opp:"Lakeside", us:2, them:1, done:true, winner:true, note:"League match"}};
  }
  if (/^\/photos/.test(u)) return {photos:[]};
  if (/^\/planes/.test(u)){ const g = S("general"), P = (f, t, dx, dy, alt, tr) => ({flight:f, type:t, desc:t, lat:g.lat + dy / 69, lon:g.lon + dx / 53, alt, speed:420, track:tr});
    return {planes:[P("SWA1234", "Boeing 737-800", 2, 1, 9800, 80), P("DAL88", "Airbus A321", -6, 4, 24000, 260), P("N512CP", "Cessna 172", 1, -3, 2500, 10), P("UAL301", "Boeing 787-9", 9, -7, 35000, 300)], error:null}; }
  if (/^\/tile-fetch\?type=stocks&/.test(u)){       // Yahoo's chart for one symbol, made up
    const url = decodeURIComponent(u.split("&url=")[1] || ""), sym = decodeURIComponent((/\/chart\/([^?]+)/.exec(url) || [0, ""])[1]);
    const P = {"^GSPC":["S&P 500", 5932.1, 5901.4], "^DJI":["Dow Jones", 43210.5, 43350.2], "^IXIC":["Nasdaq", 19102.3, 18990.8]}[sym] || ["Acme Corp", 182.44, 179.9];
    const close = [...Array(78)].map((_, i) => +(P[2] + (P[1] - P[2]) * i / 77 + Math.sin(i / 4) * P[2] * .002).toFixed(2));
    return {chart:{result:[{meta:{shortName:P[0], regularMarketPrice:P[1], chartPreviousClose:P[2]}, indicators:{quote:[{close}]}}]}};
  }
  return undefined;     // anything else (meal ideas, cams, radar, space) holds nothing personal
}
// one tile of the asked-for type on a page of its own, made-up data, no personal settings
function demoConfig(){
  const g = CFG.general && CFG.general.settings;
  if (g) Object.assign(g, {place:"Anytown", lat:39.74, lon:-104.99});
  SOURCES = {calendars:[{id:"demo", name:"Family", color:"#7cb7ff"}], teams:[{id:"demo", name:"Home FC", league:"usa.1"}], lists:[{id:"demo", name:"Grocery"}], albums:[], cams:[]};
  let opt = {};
  try{ opt = JSON.parse(decodeURIComponent((location.search.match(/[?&]opt=([^&]+)/) || [])[1] || "null")) || {}; }catch(e){}
  const T = TYPES[SOLO] || {}, sz = T.size || [12, 8];
  CFG.tiles = {on:true, settings:{items:[{id:"demo", type:SOLO, settings:Object.assign({}, T.demo || {}, opt)}]}};
  CFG.pages = {on:true, settings:{items:[{id:"main", name:"Main", on:true, cols:48, slots:[{id:"d1", x:0, y:0, w:Math.min(48, sz[0]), h:Math.min(32, sz[1]), mod:"demo"}]}]}};
  if (CFG.effects) CFG.effects.on = false;
}

