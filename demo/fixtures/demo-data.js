/* Demo fixture for README screenshots.
 * Injected before the page loads (Playwright addInitScript). It answers every data feed the
 * dashboard and Controls ask for with made-up data, so screenshots never show a real calendar,
 * list, location, team, purchase history or camera. Nothing here is read from the owner's files.
 */
(() => {
  const now = window.__DEMO_TIME ? new Date(window.__DEMO_TIME) : new Date();
  const day = n => { const d = new Date(now); d.setDate(d.getDate() + n); return d; };
  const p2 = v => String(v).padStart(2, "0");
  const iso = (d, h, m) => { const x = new Date(d); x.setHours(h, m || 0, 0, 0);
    return x.getFullYear() + "-" + p2(x.getMonth() + 1) + "-" + p2(x.getDate()) + "T" + p2(x.getHours()) + ":" + p2(x.getMinutes()) + ":00"; };
  const ymd = d => iso(d, 0).slice(0, 10);

  // ---- pictures (drawn here, no downloads) ----
  const svg = s => "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">' + s + '</svg>');
  const dish = (bg, bowl, food, garnish) => svg(
    '<defs><radialGradient id="g" cx=".5" cy=".45" r=".7"><stop offset="0" stop-color="' + bg[0] + '"/><stop offset="1" stop-color="' + bg[1] + '"/></radialGradient>' +
    '<radialGradient id="f" cx=".45" cy=".4" r=".6"><stop offset="0" stop-color="' + food[0] + '"/><stop offset="1" stop-color="' + food[1] + '"/></radialGradient></defs>' +
    '<rect width="1200" height="900" fill="url(#g)"/>' +
    '<ellipse cx="600" cy="490" rx="420" ry="330" fill="#000" opacity=".25"/>' +
    '<circle cx="600" cy="450" r="380" fill="' + bowl + '"/><circle cx="600" cy="450" r="300" fill="url(#f)"/>' +
    garnish.map(([x, y, r, c]) => '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + c + '"/>').join("") +
    '<rect x="80" y="120" width="40" height="660" rx="20" fill="#d9c7a8" opacity=".85"/>');
  const sky = (top, bot) => svg('<defs><linearGradient id="a" x2="0" y2="1"><stop offset="0" stop-color="' + top + '"/><stop offset="1" stop-color="' + bot + '"/></linearGradient></defs>' +
    '<rect width="1200" height="900" fill="url(#a)"/><circle cx="880" cy="250" r="90" fill="#fff4d6" opacity=".9"/>' +
    '<path d="M0 640 L240 430 L420 560 L640 330 L860 540 L1020 440 L1200 560 L1200 900 L0 900Z" fill="#26364a"/>' +
    '<path d="M0 720 L300 560 L520 690 L760 520 L1000 660 L1200 600 L1200 900 L0 900Z" fill="#17222f"/>');
  const nebula = svg('<defs><radialGradient id="n" cx=".55" cy=".5" r=".55"><stop offset="0" stop-color="#ffb1d8"/><stop offset=".35" stop-color="#8a4fd6"/><stop offset=".7" stop-color="#22306e"/><stop offset="1" stop-color="#05060d"/></radialGradient></defs>' +
    '<rect width="1200" height="900" fill="#05060d"/><ellipse cx="640" cy="450" rx="520" ry="360" fill="url(#n)"/>' +
    [...Array(140)].map((_, i) => '<circle cx="' + ((i * 397) % 1200) + '" cy="' + ((i * 211) % 900) + '" r="' + (1 + (i % 3)) + '" fill="#fff" opacity=".' + (4 + i % 6) + '"/>').join(""));

  // ---- weather: a mild late-autumn week, showers tomorrow afternoon ----
  function weather(){
    const base = new Date(now); base.setMinutes(0, 0, 0);
    const H = {time:[], temperature_2m:[], precipitation_probability:[], weather_code:[], is_day:[]};
    for (let i = -30; i < 72; i++){
      const d = new Date(base.getTime() + i * 3600e3), h = d.getHours();
      const soon = window.__DEMO_RAIN && i >= 1 && i <= 4;
      const rain = soon || (i > 26 && i < 33);
      H.time.push(iso(d, h).slice(0, 16));
      H.temperature_2m.push(Math.round(49 + 11 * Math.sin((h - 9) / 24 * 2 * Math.PI)));
      H.precipitation_probability.push(soon ? 85 : rain ? 60 : (i % 7 === 0 ? 10 : 3));
      H.weather_code.push(rain ? 61 : (h > 10 && h < 16 ? 1 : 2));
      H.is_day.push(h >= 7 && h < 17 ? 1 : 0);
    }
    const D = {time:[], temperature_2m_max:[], temperature_2m_min:[], weather_code:[], precipitation_probability_max:[], sunrise:[], sunset:[]};
    [1, 61, 3, 0, 0, 2, 71, 3, 1, 0, 2].forEach((c, i) => { const k = ymd(day(i));
      D.time.push(k); D.temperature_2m_max.push([58, 52, 49, 55, 61, 57, 38, 44, 50, 54, 56][i]); D.temperature_2m_min.push([34, 37, 31, 30, 35, 36, 27, 25, 29, 33, 34][i]);
      D.weather_code.push(c); D.precipitation_probability_max.push(c === 61 ? 60 : c === 71 ? 70 : 5);
      D.sunrise.push(k + "T06:53"); D.sunset.push(k + "T16:39"); });
    const h = now.getHours();
    return {current:{temperature_2m:H.temperature_2m[30], weather_code:1, is_day: h >= 7 && h < 17 ? 1 : 0}, hourly:H, daily:D};
  }

  // ---- calendar: a busy, ordinary family month ----
  function events(){
    const E = [], add = (n, title, h, m, len, cal, extra) => { const s = iso(day(n), h, m);
      E.push(Object.assign({summary:title, start:s, end:len ? iso(new Date(new Date(s).getTime() + len * 60e3), new Date(new Date(s).getTime() + len * 60e3).getHours(), new Date(new Date(s).getTime() + len * 60e3).getMinutes()) : undefined,
        cal, color: cal === "school" ? "#f4a259" : "#7cb7ff"}, extra || {})); };
    const allDay = (n, title, cal) => E.push({summary:title, start:ymd(day(n)), allDay:true, cal, color: cal === "school" ? "#f4a259" : "#7cb7ff"});
    add(0, "Coffee with Sam", 10, 30, 60, "fam", {location:"Maple Street Café"});
    add(0, "Piano lesson", 16, 0, 45, "school");
    add(0, "Soccer practice", 18, 0, 90, "school", {location:"Westside Fields"});
    add(1, "Dentist – Ava", 8, 15, 45, "fam");
    add(1, "Science fair setup", 15, 30, 60, "school");
    add(2, "Book club", 19, 0, 120, "fam");
    allDay(3, "Grandma visiting", "fam"); allDay(4, "Grandma visiting", "fam");
    add(3, "Swim meet", 9, 0, 180, "school");
    add(4, "Pancake breakfast", 8, 30, 90, "fam");
    add(5, "Car service", 11, 0, 60, "fam");
    allDay(6, "No school – teacher day", "school");
    add(7, "Leo's recital", 18, 30, 90, "school");
    add(8, "Trash night", 20, 0, 0, "fam");
    add(9, "Movie night", 19, 30, 150, "fam");
    add(10, "Volunteer at food bank", 9, 0, 180, "fam");
    add(12, "Parent–teacher conference", 16, 15, 30, "school");
    allDay(14, "Ski trip", "fam"); allDay(15, "Ski trip", "fam"); allDay(16, "Ski trip", "fam");
    add(18, "Haircuts", 10, 0, 60, "fam");
    add(20, "Holiday concert", 18, 0, 90, "school");
    add(-2, "Yard cleanup", 10, 0, 120, "fam"); add(-5, "Soccer game", 9, 0, 90, "school"); add(-8, "Date night", 19, 0, 150, "fam");
    add(-12, "Field trip", 8, 0, 420, "school"); add(-15, "Dinner at the Lees'", 18, 0, 150, "fam");
    add(23, "Cookie swap", 14, 0, 120, "fam"); add(25, "Winter break starts", 15, 0, 0, "school");
    return {events:E};
  }

  const notes = {list:"Grocery", source:"dashboard", note:"Pick up the cake on Friday",
    items:["Milk", "Eggs", "Sourdough bread", "Coffee beans", "Bananas", "Spinach", "Greek yogurt", "Chicken thighs", "Sparkling water", "Parmesan"]
      .map((t, i) => ({id:"d" + i, text:t, done:false}))};

  const prod = (e, c) => svg('<rect width="1200" height="900" fill="' + c + '"/><circle cx="600" cy="450" r="330" fill="#fff" opacity=".35"/><text x="600" y="560" font-size="340" text-anchor="middle" font-family="Noto Color Emoji">' + e + '</text>');
  const sales = {watching:42, at:Math.floor(now / 1000), deals:[
    {want:"Coffee beans", why:"onlist", img:prod("☕","#f4a259"), name:"House blend whole bean coffee 12 oz", store:"Corner Market", price:"$6.99", now:6.99, usual:8.49},
    {want:"Sparkling water", why:"onlist", img:prod("🥤","#7cc6a4"), name:"Lime sparkling water 12-pk", store:"Big Box", price:"3/$12.00", now:4, usual:5.29},
    {want:"x", why:"usual", img:prod("🌮","#e8c547"), name:"Tortilla chips family size", store:"Corner Market", price:"$2.50", now:2.5, usual:3.99},
    {want:"x", why:"usual", img:prod("🍨","#c3a6ff"), name:"Vanilla bean ice cream 1.5 qt", store:"Big Box", price:"$3.99", now:3.99, usual:5.49},
    {want:"x", why:"usual", img:prod("🌭","#f28482"), name:"Breakfast sausage links", store:"Warehouse Club", price:"$7.98", now:7.98, usual:9.48},
    {want:"x", why:"usual", img:prod("🍕","#f6bd60"), name:"Frozen pepperoni pizza", store:"Corner Market", price:"2/$9.00", now:4.5, usual:6.29},
    {want:"x", why:"usual", img:prod("🧃","#ffb703"), name:"Orange juice, no pulp 52 oz", store:"Big Box", price:"$3.49", now:3.49, usual:4.29},
    {want:"x", why:"usual", img:prod("🧀","#ffd166"), name:"Cheddar cheese block 16 oz", store:"Warehouse Club", price:"$4.99", now:4.99, usual:6.49},
    {want:"x", why:"usual", img:prod("🥣","#a3c4f3"), name:"Granola bars 12-ct", store:"Corner Market", price:"$3.00", now:3, usual:4.19},
    {want:"x", why:"usual", img:prod("🧻","#bde0fe"), name:"Paper towels 6 rolls", store:"Big Box", price:"$7.49", now:7.49, usual:9.99},
    {want:"x", why:"usual", img:prod("🍎","#ef476f"), name:"Honeycrisp apples 3 lb", store:"Corner Market", price:"$4.99", now:4.99, usual:6.99},
    {want:"x", why:"usual", img:prod("🥤","#90be6d"), name:"Diet ginger ale 12-pk", store:"Big Box", price:"$4.99", now:4.99, usual:6.79}]};

  function team(){
    const g = (n, opp, home) => ({date:new Date(iso(day(n), 19, 30)).toISOString(), home, opp, note:"League match"});
    return {team:"Riverside FC", upcoming:[g(3, "Harbor City", true), g(10, "Lakeside United", false), g(17, "Northport", true)],
      next:Object.assign(g(3, "Harbor City", true), {us:null, them:null, done:false, live:false, venue:"Riverside Park"}),
      last:{date:day(-4).toISOString(), home:false, opp:"Lakeside United", us:2, them:1, done:true, winner:true, note:"League match"}};
  }

  const dinner = {ideas:[
    {title:"Butternut squash soup", area:"American", cat:"Vegetarian", thumb:dish(["#3b2a1e", "#120c08"], "#f1ece4", ["#f6a64a", "#d9762b"], [[540, 400, 18, "#fff7e8"], [660, 470, 14, "#5f8f3e"], [610, 380, 10, "#5f8f3e"]]), big:null,
      ingredients:[["1", "butternut squash, cubed"], ["1", "onion, diced"], ["2 cloves", "garlic"], ["4 cups", "vegetable stock"], ["½ cup", "cream"], ["", "salt & pepper"]],
      steps:["Roast the squash at 400°F for 30 minutes.", "Soften the onion and garlic in butter.", "Add squash and stock; simmer 15 minutes.", "Blend smooth, stir in cream and season."]},
    {title:"Lemon herb chicken", area:"Mediterranean", cat:"Chicken", thumb:dish(["#2c3320", "#0e110a"], "#fafafa", ["#e7b65a", "#b97a2e"], [[520, 420, 22, "#f7e15b"], [690, 430, 12, "#4d7d32"], [600, 520, 12, "#4d7d32"]]),
      ingredients:[["6", "chicken thighs"], ["2", "lemons"], ["3 tbsp", "olive oil"], ["", "rosemary & thyme"]], steps:["Marinate 30 minutes.", "Roast at 425°F for 35 minutes."]},
    {title:"Mushroom risotto", area:"Italian", cat:"Vegetarian", thumb:dish(["#2a2622", "#0e0c0a"], "#f4f1ea", ["#efe2c4", "#c9b48a"], [[560, 420, 26, "#7a5a3a"], [650, 480, 22, "#7a5a3a"], [620, 380, 10, "#5f8f3e"]]),
      ingredients:[["1½ cups", "arborio rice"], ["8 oz", "mushrooms"], ["5 cups", "warm stock"], ["½ cup", "parmesan"]], steps:["Toast the rice.", "Add stock a ladle at a time.", "Finish with parmesan."]}]};

  const space = {media_type:"image", url:nebula, title:"A Stellar Nursery in Monoceros",
    explanation:"Clouds of glowing hydrogen surround a cluster of young, hot stars. Dark lanes of dust trace where the next generation is forming.", copyright:"Demo image"};

  const OTD = {selected:[{year:1969, text:"Apollo 12 astronauts became the second crew to walk on the Moon."},
    {year:1863, text:"Abraham Lincoln delivered the Gettysburg Address at the dedication of a military cemetery."},
    {year:1998, text:"The first module of the International Space Station was launched."}]};
  const JOKE = {joke:"Why did the scarecrow win an award? Because he was outstanding in his field."};

  window.__DEMO_IMG = {sky:sky("#f2a65a", "#3c4f74"), sky2:sky("#8fb8de", "#2b3b55"), nebula};
  const photos = {photos:[{url:window.__DEMO_IMG.sky, w:1200, h:900}, {url:window.__DEMO_IMG.sky2, w:1200, h:900}]};

  function route(u){
    if (/api\.open-meteo\.com/.test(u)) return weather();
    if (/air-quality/.test(u)) return {current:{us_aqi:24}};
    if (/geocoding-api/.test(u)) return {results:[{name:"Lakewood", admin1:"Colorado", country:"United States", latitude:39.7047, longitude:-105.0814, postcodes:["80226"]}]};
    if (/onthisday/.test(u)) return OTD;
    if (/icanhazdadjoke/.test(u)) return JOKE;
    const p = u.replace(/^https?:\/\/[^/]+/, "");
    if (/^\/events/.test(p)) return events();
    if (/^\/notes/.test(p)) return notes;
    if (/^\/sales/.test(p)) return sales;
    if (/^\/team/.test(p)) return team();
    if (/^\/dinner/.test(p)) return dinner;
    if (/^\/space/.test(p)) return space;
    if (/^\/photos/.test(p)) return photos;
    if (/^\/radar/.test(p)) return window.__DEMO_RADAR || {host:"", past:[], nowcast:[], error:"demo"};
    if (/^\/cams/.test(p)) return {cams:[]};
    if (/^\/stocks/.test(p)){ const q = (sym, name, price, prev) => ({sym, name, price, prev, spark:[...Array(40)].map((_, i) => +(prev + (price - prev) * i / 39 + Math.sin(i / 3) * prev * .003).toFixed(2))});
      return {stocks:[q("^GSPC", "S&P 500", 5932.1, 5901.4), q("^DJI", "Dow Jones", 43210.5, 43350.2), q("ACME", "Acme Corp", 182.44, 179.9)]}; }
    if (/^\/planes/.test(p)) return {planes:[], error:null};
    return undefined;
  }
  window.__DEMO_ROUTE = route;
  const realFetch = window.fetch.bind(window);
  window.fetch = function(input, opt){
    const u = typeof input === "string" ? input : input.url;
    const method = (opt && opt.method) || (input && input.method) || "GET";
    // Only the clock recording saves config, against its own disposable server.
    const saveDemoDesign = window.__DEMO_SAVE_CONFIG && new URL(u, location.href).pathname === "/config";
    if (method !== "GET" && /\/(config|sources|notes|report)\b/.test(u) && !saveDemoDesign) return Promise.resolve(new Response('{"ok":true}', {headers:{"Content-Type":"application/json"}}));
    const d = method === "GET" ? route(u) : undefined;
    if (d !== undefined) return Promise.resolve(new Response(JSON.stringify(d), {headers:{"Content-Type":"application/json"}}));
    return realFetch(input, opt);
  };
})();
