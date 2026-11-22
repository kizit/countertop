/* ---------- effects library: every effect is one small animation that can be turned on, sized and timed on its own ----------
   Shared by the dashboard (full-screen canvases) and Controls (little live previews on each card). */
const FXLIB = (function(){
  const R = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const weighted = list => { const tot = list.reduce((a, x) => a + x[1], 0); let r = Math.random() * tot; for (const x of list){ r -= x[1]; if (r <= 0) return x; } return list[0]; };
  const COLORS = ["#ff6b6b","#ffd36e","#6bd3ff","#8fffa0","#c58bff","#ff9ad5","#ffffff"];
  const AMT = {Few:.5, Some:1, Lots:1.8};
  // emoji are drawn once into small canvases and reused (much cheaper than fillText every frame)
  const sprites = {};
  function sprite(g, s){
    s = Math.max(12, Math.round(s / 4) * 4);
    const k = g + s;
    if (!sprites[k]){
      const c = document.createElement("canvas"); c.width = c.height = Math.ceil(s * 1.3);
      const x = c.getContext("2d"); x.font = s + "px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(g, c.width / 2, c.height / 2 + s * .06);
      sprites[k] = c;
    }
    return sprites[k];
  }
  function drawSprite(cx, g, s, x, y, rot, a, sy){
    const sp = sprite(g, s);
    cx.save(); cx.globalAlpha = a; cx.translate(x, y); if (rot) cx.rotate(rot); if (sy) cx.scale(1, sy);
    cx.drawImage(sp, -sp.width / 2, -sp.height / 2); cx.restore();
  }

  /* ----- weather ----- */
  function rain(o){
    const n = Math.round((o.kind === "drizzle" ? 70 : 140) * o.amt), P = [];
    const drop = init => ({x:R(0, o.W * 1.1), y:init ? R(-o.H, o.H) : R(-80, -10), v:R(16, 26), l:R(14, 26)});
    for (let i = 0; i < n; i++) P.push(drop(true));
    let flash = 0, next = Date.now() + R(3e3, 8e3);
    return cx => {
      cx.strokeStyle = o.front ? "rgba(185,210,255,.34)" : "rgba(160,195,255,.3)"; cx.lineWidth = 1.5;
      cx.beginPath();
      for (const p of P){ cx.moveTo(p.x, p.y); cx.lineTo(p.x - p.l * .25, p.y + p.l); p.y += p.v; p.x -= p.v * .25; if (p.y > o.H) Object.assign(p, drop(false)); }
      cx.stroke();
      if (o.kind === "storm" || o.preview){
        if (Date.now() > next){ flash = .16; next = Date.now() + (o.preview ? R(4e3, 7e3) : R(9e3, 25e3)); }
        if (flash > 0){ cx.fillStyle = "rgba(220,230,255," + flash.toFixed(3) + ")"; cx.fillRect(0, 0, o.W, o.H); flash -= .012; }
      }
      return true;
    };
  }
  function snow(o){
    const P = [], f = init => ({x:R(0, o.W), y:init ? R(-o.H, o.H) : R(-30, -5), v:R(.8, 2.2), r:R(2, 5), ph:R(0, 6.3)});
    for (let i = 0; i < Math.round(110 * o.amt); i++) P.push(f(true));
    return cx => {
      cx.fillStyle = "rgba(255,255,255,.7)"; cx.beginPath();
      for (const p of P){ p.ph += .02; p.y += p.v; p.x += Math.sin(p.ph) * .6; cx.moveTo(p.x + p.r, p.y); cx.arc(p.x, p.y, p.r, 0, 6.29); if (p.y > o.H + 5) Object.assign(p, f(false)); }
      cx.fill(); return true;
    };
  }
  function clouds(o){
    const P = [], c = () => ({x:R(-300, o.W), y:R(-60, o.H * .6), v:R(.1, .3), r:R(240, 460)});
    for (let i = 0; i < Math.max(2, Math.round(6 * o.amt)); i++) P.push(c());
    return cx => {
      for (const p of P){
        p.x += p.v; if (p.x - p.r > o.W){ p.x = -p.r; p.y = R(-60, o.H * .6); }
        const g = cx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, "rgba(190,200,215,.13)"); g.addColorStop(1, "rgba(190,200,215,0)");
        cx.fillStyle = g; cx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
      }
      return true;
    };
  }
  function fog(o){
    const P = [];
    for (let i = 0; i < Math.max(2, Math.round(5 * o.amt)); i++) P.push({x:R(-o.W, 0), y:R(0, o.H), v:R(.2, .45), h:R(90, 200)});
    return cx => {
      for (const p of P){
        p.x += p.v; if (p.x > o.W) p.x = -o.W;
        const g = cx.createLinearGradient(0, p.y - p.h, 0, p.y + p.h);
        g.addColorStop(0, "rgba(190,198,208,0)"); g.addColorStop(.5, "rgba(190,198,208,.12)"); g.addColorStop(1, "rgba(190,198,208,0)");
        cx.fillStyle = g; cx.fillRect(p.x, p.y - p.h, o.W, p.h * 2);
      }
      return true;
    };
  }
  function sun(o){
    const P = [];
    for (let i = 0; i < Math.round(26 * o.amt); i++) P.push({x:R(0, o.W), y:R(0, o.H), vx:R(-.15, .15), vy:R(-.25, -.05), r:R(1.5, 3.5), ph:R(0, 6.3)});
    let a = 0;
    return cx => {
      const sx = o.W * .8, sy = -60, H = o.H;
      const g = cx.createRadialGradient(sx, sy, 0, sx, sy, H * .95);
      g.addColorStop(0, "rgba(255,214,140,.32)"); g.addColorStop(.5, "rgba(255,200,120,.09)"); g.addColorStop(1, "rgba(255,200,120,0)");
      cx.fillStyle = g; cx.fillRect(0, 0, o.W, H);
      a += .0012;
      cx.save(); cx.translate(sx, sy); cx.rotate(a);
      for (let i = 0; i < 12; i++){
        cx.rotate(Math.PI / 6);
        const rg = cx.createLinearGradient(0, 0, 0, H * 1.1);
        rg.addColorStop(0, "rgba(255,225,160,.11)"); rg.addColorStop(1, "rgba(255,225,160,0)");
        cx.fillStyle = rg; cx.beginPath(); cx.moveTo(0, 0); cx.lineTo(-70, H * 1.1); cx.lineTo(70, H * 1.1); cx.closePath(); cx.fill();
      }
      cx.restore();
      for (const p of P){
        p.ph += .02; p.x += p.vx; p.y += p.vy; if (p.y < -10){ p.y = H + 10; p.x = R(0, o.W); }
        cx.fillStyle = "rgba(255,236,190," + (.25 + .2 * Math.sin(p.ph)).toFixed(3) + ")";
        cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 6.29); cx.fill();
      }
      return true;
    };
  }
  function stars(o){
    const P = [];
    for (let i = 0; i < Math.round(70 * o.amt); i++) P.push({x:R(0, o.W), y:R(0, o.H * .7), r:R(.7, 1.9), ph:R(0, 6.3), sp:R(.01, .03)});
    return cx => {
      for (const p of P){ p.ph += p.sp; cx.fillStyle = "rgba(225,232,255," + (.3 + .3 * Math.sin(p.ph)).toFixed(3) + ")"; cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 6.29); cx.fill(); }
      return true;
    };
  }

  /* ----- seasonal: emoji drifting across the screen. [glyph, weight, motion]: fall | rise | fly | flutter ----- */
  const SETS = {
    leaves:    {n:16, dots:0,  g:[["🍂",5,"fall"],["🍁",5,"fall"],["🌰",1,"fall"],["🍎",1,"fall"]]},
    halloween: {n:16, dots:0,  g:[["🍂",3,"fall"],["🍁",3,"fall"],["🎃",3,"fall"],["🦇",2,"fly"],["👻",1,"rise"],["🍬",1,"fall"]]},
    thanks:    {n:18, dots:0,  g:[["🍂",5,"fall"],["🍁",5,"fall"],["🦃",1,"fall"],["🥧",1,"fall"],["🌽",1,"fall"],["🎃",1,"fall"]]},
    xmas:      {n:12, dots:45, g:[["❄️",4,"fall"],["⭐",1,"fall"],["🎁",1,"fall"],["🔔",1,"fall"],["🍬",1,"fall"],["🎄",1,"fall"]]},
    winter:    {n:8,  dots:55, g:[["❄️",1,"fall"]]},
    newyear:   {n:10, dots:0,  g:[["🎉",1,"fall"],["✨",2,"fall"],["🥳",1,"fall"]]},
    valentine: {n:14, dots:0,  g:[["💕",2,"rise"],["💗",2,"rise"],["❤️",1,"rise"]]},
    spring:    {n:12, dots:0,  g:[["🌸",4,"fall"],["🌼",2,"fall"],["🦋",1,"flutter"]]},
    july4:     {n:10, dots:0,  g:[["⭐",2,"fall"],["🇺🇸",1,"fall"]]},
    summer:    {n:5,  dots:0,  g:[["🦋",2,"flutter"],["🐝",1,"flutter"]]}
  };
  // set: a name in SETS, or one of your own effects (see mine below): {n, dots, g, size, speed, spin}
  function falling(set){
    return o => {
      const S = typeof set === "string" ? SETS[set] : set, W = o.W, H = o.H, P = [], D = [], sz = S.size || 1, sp = S.speed || 1;
      const part = init => {
        const [g, , mo] = weighted(S.g), s0 = R(24, 58), depth = (s0 - 24) / 34, s = s0 * sz;
        const p = {g, mo, s, a:.55 + depth * .4, ph:R(0, 6.3), rot:S.spin === false ? 0 : R(-.6, .6), vr:S.spin === false ? 0 : R(-.02, .02)};
        if (mo === "fall"){ p.x = R(0, W); p.y = init ? R(-H, H) : R(-80, -30) * sz; p.vy = (R(.7, 1.3) + depth * 1.3) * sp; }
        if (mo === "rise"){ p.x = R(0, W); p.y = init ? R(0, H * 2) : H + 50 * sz; p.vy = -(R(.6, 1.1) + depth) * sp; }
        if (mo === "fly"){ p.x = init ? R(-W, W) : -80 * sz; p.y = R(H * .05, H * .6); p.vx = (R(1.6, 3) + depth) * sp; p.rot = 0; p.vr = 0; }
        if (mo === "flutter"){ p.x = R(0, W); p.y = R(H * .1, H * .9); p.vx = R(-1, 1) * sp; p.vy = R(-.6, .6) * sp; p.rot = 0; p.vr = 0; }
        return p;
      };
      for (let i = 0; i < Math.max(1, Math.round(S.n * o.amt)); i++) P.push(part(true));
      for (let i = 0; i < Math.round(S.dots * o.amt); i++) D.push({x:R(0, W), y:R(-H, H), r:R(1.2, 3.6), v:R(.5, 1.6), ph:R(0, 6.3)});
      return cx => {
        if (D.length){
          cx.fillStyle = "rgba(255,255,255,.7)"; cx.beginPath();
          for (const d of D){ d.ph += .02; d.y += d.v; d.x += Math.sin(d.ph) * .5; if (d.y > H + 5){ d.y = -5; d.x = R(0, W); } cx.moveTo(d.x + d.r, d.y); cx.arc(d.x, d.y, d.r, 0, 6.29); }
          cx.fill();
        }
        for (const p of P){
          p.ph += .02;
          if (p.mo === "fall"){ p.y += p.vy; p.x += Math.sin(p.ph) * (1 + p.s / 40); p.rot += p.vr + (S.spin === false ? 0 : Math.sin(p.ph) * .01); }
          if (p.mo === "rise"){ p.y += p.vy; p.x += Math.sin(p.ph) * .8; }
          if (p.mo === "fly"){ p.x += p.vx; p.y += Math.sin(p.ph * 2) * 1.2; }
          if (p.mo === "flutter"){
            p.vx = Math.max(-1.6 * sp, Math.min(1.6 * sp, p.vx + R(-.15, .15))); p.vy = Math.max(-sp, Math.min(sp, p.vy + R(-.12, .12)));
            p.x += p.vx; p.y += p.vy; if (p.x < -40) p.x = W + 30; if (p.x > W + 40) p.x = -30; if (p.y < 0 || p.y > H) p.vy = -p.vy;
          }
          const flap = (p.mo === "fly" || p.mo === "flutter") ? .65 + .35 * Math.abs(Math.sin(p.ph * 5)) : 0;
          drawSprite(cx, p.g, p.s, p.x, p.y, p.rot, p.a, flap);
          if (p.y > H + 70 * sz || p.y < -90 * sz || p.x > W + 90 * sz) Object.assign(p, part(false));
        }
        return true;
      };
    };
  }

  /* ----- shows: a short scene that plays once, then ends ----- */
  function show(kind){
    return o => {
      const W = o.W, H = o.H, a = o.amt; let fx = [];
      const N = n => Math.max(1, Math.round(n * a));
      const gust = glyphs => { for (let i = 0; i < N(40); i++) fx.push({k:"spr", g:pick(glyphs), s:R(26, 60), x:R(-600, -40), y:R(H * .1, H * .9), vx:R(9, 16), vy:0, ph:R(0, 6.3), amp:R(1.5, 4), rot:R(0, 6.3), vr:R(.05, .15), a:.9}); };
      if (kind === "gust") gust(["🍂","🍁","🍂","🍁","🌰"]);
      if (kind === "flurry") for (let i = 0; i < N(90); i++) fx.push({k:"dot", x:R(-700, -10), y:R(0, H), vx:R(8, 15), vy:R(.5, 2), r:R(1.5, 4.5), ph:R(0, 6.3)});
      if (kind === "turkey") fx.push({k:"walker", g:"🦃", s:110, x:W + 80, y:H - 70, vx:-2.6, ph:0, trail:"🍂"});
      if (kind === "santa") fx.push({k:"sleigh", x:W + 150, t:0});
      if (kind === "bats") for (let i = 0; i < N(14); i++) fx.push({k:"spr", g:"🦇", s:R(30, 64), x:R(-500, -40), y:R(H * .05, H * .55), vx:R(5, 9), vy:0, ph:R(0, 6.3), amp:R(2, 5), rot:0, vr:0, a:.95, flap:true});
      if (kind === "heartburst") for (let i = 0; i < N(30); i++) fx.push({k:"spr", g:pick(["💕","💗","❤️","💖"]), s:R(26, 56), x:R(0, W), y:H + R(20, 400), vx:0, vy:-R(3, 6), ph:R(0, 6.3), amp:R(1, 3), rot:0, vr:0, a:.9});
      if (kind === "butterflies") for (let i = 0; i < N(6); i++) fx.push({k:"spr", g:pick(["🦋","🦋","🐝"]), s:R(34, 56), x:R(-400, -40), y:R(H * .2, H * .8), vx:R(2.5, 4.5), vy:0, ph:R(0, 6.3), amp:R(2, 4), rot:0, vr:0, a:.95, flap:true});
      if (kind === "fireworks") for (let i = 0; i < N(7); i++) fx.push({k:"rocket", x:R(W * .1, W * .9), y:H + 10, vy:-R(19, 25) * Math.sqrt(H / 1080), fuse:R(.3, .6) * H, delay:i * R(500, 1100), born:Date.now(), c:pick(COLORS)});
      if (kind === "confetti") fx.push({k:"confgen", until:Date.now() + (o.ms || 4500)});
      function step(cx, f, now){
        if (f.k === "spr"){
          f.ph += .06; f.x += f.vx; f.y += f.vy + Math.sin(f.ph) * f.amp; f.rot += f.vr;
          if (f.fade) f.a = Math.max(0, f.a - .01);
          drawSprite(cx, f.g, f.s, f.x, f.y, f.rot, f.a, f.flap ? .6 + .4 * Math.abs(Math.sin(f.ph * 3)) : 0);
          return f.x < W + 120 && f.y > -120 && f.a > 0;
        }
        if (f.k === "dot"){
          f.ph += .05; f.x += f.vx; f.y += f.vy + Math.sin(f.ph) * 2;
          cx.fillStyle = "rgba(255,255,255,.8)"; cx.beginPath(); cx.arc(f.x, f.y, f.r, 0, 6.29); cx.fill();
          return f.x < W + 20;
        }
        if (f.k === "walker"){
          f.ph += .25; f.x += f.vx;
          drawSprite(cx, f.g, f.s, f.x, f.y - Math.abs(Math.sin(f.ph)) * 10, Math.sin(f.ph) * .08, 1, 0);
          if (Math.random() < .08) fx.push({k:"spr", g:f.trail, s:R(20, 30), x:f.x + 40, y:f.y + 20, vx:R(.5, 1.5), vy:-R(.5, 1.5), ph:0, amp:.3, rot:R(0, 6), vr:.05, a:.8, fade:1});
          return f.x > -150;
        }
        if (f.k === "sleigh"){
          f.t += 1; f.x -= 5.2;
          const y = H * .2 + Math.sin(f.x / W * Math.PI) * -H * .08 + Math.sin(f.t * .08) * 6;
          for (let i = 0; i < 3; i++) drawSprite(cx, "🦌", 58, f.x + i * 66, y + Math.sin(f.t * .25 + i) * 5, 0, 1, 0);
          drawSprite(cx, "🛷", 74, f.x + 230, y + 12, 0, 1, 0);
          drawSprite(cx, "🎅", 56, f.x + 226, y - 18, 0, 1, 0);
          if (f.t % 2 === 0) fx.push({k:"spark", x:f.x + 270 + R(-10, 10), y:y + R(-20, 25), life:1, c:pick(["#fff6c2","#ffe27a","#ffffff","#bfe3ff"])});
          return f.x > -420;
        }
        if (f.k === "spark"){
          f.life -= .025; f.y += .4;
          cx.fillStyle = f.c; cx.globalAlpha = Math.max(0, f.life); cx.beginPath(); cx.arc(f.x, f.y, 2.6 * f.life + .5, 0, 6.29); cx.fill(); cx.globalAlpha = 1;
          return f.life > 0;
        }
        if (f.k === "rocket"){
          if (now - f.born < f.delay) return true;
          f.y += f.vy; f.vy *= .975;
          cx.strokeStyle = "rgba(255,240,190,.8)"; cx.lineWidth = 3;
          cx.beginPath(); cx.moveTo(f.x, f.y); cx.lineTo(f.x, f.y - f.vy * 3); cx.stroke();
          if (H - f.y > f.fuse + H * .25 || f.vy > -3){
            for (let i = 0; i < 80; i++){ const an = R(0, 6.29), sp = R(2, 8); fx.push({k:"spk", x:f.x, y:f.y, vx:Math.cos(an) * sp, vy:Math.sin(an) * sp, life:1, c:f.c}); }
            return false;
          }
          return true;
        }
        if (f.k === "spk"){
          f.x += f.vx; f.y += f.vy; f.vy += .07; f.vx *= .985; f.life -= .016;
          cx.globalAlpha = Math.max(0, f.life); cx.fillStyle = f.c; cx.beginPath(); cx.arc(f.x, f.y, 2.8, 0, 6.29); cx.fill(); cx.globalAlpha = 1;
          return f.life > 0;
        }
        if (f.k === "confgen"){
          for (let i = 0; i < Math.max(1, Math.round(3 * a)); i++) fx.push({k:"conf", x:R(0, W), y:-10, vx:R(-2, 2), vy:R(2, 6), r:R(0, 6.3), vr:R(-.2, .2), c:pick(COLORS), w:R(8, 14)});
          return now < f.until;
        }
        if (f.k === "conf"){
          f.x += f.vx; f.y += f.vy; f.vy += .05; f.r += f.vr;
          cx.save(); cx.translate(f.x, f.y); cx.rotate(f.r); cx.fillStyle = f.c; cx.fillRect(-f.w / 2, -3, f.w, 6); cx.restore();
          return f.y < H + 20;
        }
        return false;
      }
      return cx => {
        const now = Date.now(), cur = fx; fx = [];          // a step may add sparks, trails or confetti
        const kept = cur.filter(f => step(cx, f, now));
        fx = kept.concat(fx);
        return fx.length > 0;
      };
    };
  }

  /* ----- the catalog. layer: sky = always behind the tiles; fall = follows "in front of tiles"; show = always in front ----- */
  const L = [
    {id:"rain", grp:"Weather", name:"Rain", icon:"🌧️", layer:"fall", wx:["rain", "drizzle", "storm"], make:rain,
     desc:"Rain streaks down the screen while it's raining outside. Drizzle is lighter, and thunderstorms add an occasional flash of lightning."},
    {id:"snow", grp:"Weather", name:"Snow", icon:"🌨️", layer:"fall", wx:["snow"], make:snow,
     desc:"Soft snowflakes drift down while it's snowing outside."},
    {id:"fog", grp:"Weather", name:"Fog", icon:"🌫️", layer:"sky", wx:["fog"], make:fog,
     desc:"Slow bands of mist roll across the background on foggy days."},
    {id:"clouds", grp:"Weather", name:"Clouds", icon:"☁️", layer:"sky", wx:["clouds"], make:clouds,
     desc:"Faint clouds drift across the background when it's cloudy."},
    {id:"sun", grp:"Weather", name:"Sun rays", icon:"☀️", layer:"sky", wx:["sun"], make:sun,
     desc:"A warm glow and slowly turning rays from the top corner, with specks of light floating up, on clear days."},
    {id:"stars", grp:"Weather", name:"Stars", icon:"✨", layer:"sky", wx:["stars"], make:stars,
     desc:"Stars twinkle in the background on clear nights."},

    {id:"leaves", grp:"Seasons", name:"Falling leaves", icon:"🍂", layer:"fall", season:[["09-22", "11-30"]], make:falling("leaves"),
     desc:"Autumn leaves drift down, with the odd acorn or apple."},
    {id:"halloween", grp:"Seasons", name:"Halloween", icon:"🎃", layer:"fall", replaces:["leaves"], season:[["10-20", "10-31"]], make:falling("halloween"),
     desc:"Pumpkins, leaves and candy fall, bats flit across and a ghost floats up now and then. Takes the place of the plain falling leaves."},
    {id:"thanks", grp:"Seasons", name:"Thanksgiving", icon:"🦃", layer:"fall", replaces:["leaves"], season:"thanks", make:falling("thanks"),
     desc:"Falling leaves with a turkey, a pie or an ear of corn mixed in. Plays the week of Thanksgiving, in place of the plain falling leaves."},
    {id:"xmas", grp:"Seasons", name:"Christmas", icon:"🎄", layer:"fall", replaces:["winter"], season:[["12-01", "12-25"]], make:falling("xmas"),
     desc:"Snowflakes, stars, presents and bells fall over fine snow."},
    {id:"winter", grp:"Seasons", name:"Winter snowflakes", icon:"❄️", layer:"fall", season:[["12-26", "02-28"]], make:falling("winter"),
     desc:"A few big snowflakes over fine snow, whatever the weather is doing."},
    {id:"newyear", grp:"Seasons", name:"New Year's sparkle", icon:"🥳", layer:"fall", season:[["12-31", "01-01"]], make:falling("newyear"),
     desc:"Party poppers and sparkles fall on New Year's Eve and Day."},
    {id:"valentine", grp:"Seasons", name:"Valentine hearts", icon:"💕", layer:"fall", season:[["02-07", "02-14"]], make:falling("valentine"),
     desc:"Hearts float slowly up the screen in the week before Valentine's Day."},
    {id:"spring", grp:"Seasons", name:"Spring blossoms", icon:"🌸", layer:"fall", season:[["03-01", "05-31"]], make:falling("spring"),
     desc:"Blossoms drift down and a butterfly flutters by."},
    {id:"july4", grp:"Seasons", name:"Fourth of July", icon:"🇺🇸", layer:"fall", season:[["07-01", "07-04"]], regions:["United States"], make:falling("july4"),
     desc:"Stars and little flags drift down."},
    {id:"summer", grp:"Seasons", name:"Butterflies & bees", icon:"🦋", layer:"fall", season:[["06-01", "08-31"]], make:falling("summer"),
     desc:"A few butterflies and bees wander around the screen."},

    {id:"gust", grp:"Shows", name:"Leaf gust", icon:"🍁", layer:"show", season:[["09-22", "11-30"]], make:show("gust"),
     desc:"A gust of wind blows a swirl of leaves across the screen."},
    {id:"bats", grp:"Shows", name:"Bats", icon:"🦇", layer:"show", season:[["10-20", "10-31"]], make:show("bats"),
     desc:"A colony of bats flaps across the top of the screen."},
    {id:"turkey", grp:"Shows", name:"Turkey walk", icon:"🦃", layer:"show", season:"thanks", make:show("turkey"),
     desc:"A turkey struts along the bottom of the screen, kicking up leaves."},
    {id:"santa", grp:"Shows", name:"Santa's sleigh", icon:"🎅", layer:"show", season:[["12-01", "12-25"]], make:show("santa"),
     desc:"Santa and his reindeer fly across the sky, trailing sparkles."},
    {id:"flurry", grp:"Shows", name:"Snow flurry", icon:"🌬️", layer:"show", season:[["12-01", "02-28"]], make:show("flurry"),
     desc:"A burst of snow blows sideways across the screen."},
    {id:"fireworks", grp:"Shows", name:"Fireworks", icon:"🎆", layer:"show", season:[["12-31", "01-01"], ["07-03", "07-04"]], make:show("fireworks"),
     desc:"Rockets shoot up and burst into color. New Year's and the Fourth of July."},
    {id:"heartburst", grp:"Shows", name:"Hearts rising", icon:"💖", layer:"show", season:[["02-07", "02-14"]], make:show("heartburst"),
     desc:"A rush of hearts floats up from the bottom of the screen."},
    {id:"butterflies", grp:"Shows", name:"Butterflies fly by", icon:"🦋", layer:"show", season:[["03-01", "08-31"]], make:show("butterflies"),
     desc:"A few butterflies and a bee cross the screen."},

    {id:"confetti", grp:"Celebrations", name:"Birthday confetti", icon:"🎂", layer:"show", party:true, make:show("confetti"),
     desc:"Confetti rains down when a calendar event today has \"birthday\" in its name: when the birthday is first seen, then once an hour."}
  ];
  const BY = {}; L.forEach(d => { BY[d.id] = d; d.emoji = d.grp !== "Weather"; });     // everything but the weather is drawn with emoji

  /* ----- your own effects: plain data (emoji, how they move, size, speed, spin, a season), no code. Saved in effects.mine, shared as .countertop files ----- */
  const MOTIONS = [["fall", "Fall"], ["rise", "Float up"], ["fly", "Fly across"], ["flutter", "Wander"]];
  const SIZE = {Small:.6, Medium:1, Big:1.5}, SPEED = {Slow:.55, Normal:1, Fast:1.7};
  const MD = /^(1[0-2]|0?[1-9])-(3[01]|[12]\d|0?[1-9])$/;
  function mineDef(m){
    const mo = MOTIONS.some(x => x[0] === m.motion) ? m.motion : "fall", season = MD.test(m.from || "") && MD.test(m.to || "") ? [[m.from, m.to]] : null;
    return {id:m.id, grp:"Yours", name:String(m.name || "My effect"), icon:m.glyphs[0], layer:"fall", mine:true, emoji:true, season,
      desc:(MOTIONS.find(x => x[0] === mo)[1]) + ": " + m.glyphs.join(" "),
      make:falling({n:14, dots:0, g:m.glyphs.map(g => [g, 1, mo]), size:SIZE[m.size] || 1, speed:SPEED[m.speed] || 1, spin:m.spin !== false})};
  }
  function setMine(list){
    for (let i = L.length - 1; i >= 0; i--) if (L[i].mine){ delete BY[L[i].id]; L.splice(i, 1); }
    for (const m of Array.isArray(list) ? list : []) if (m && typeof m.id === "string" && Array.isArray(m.glyphs) && m.glyphs.length && !BY[m.id]){ const d = mineDef(m); L.push(d); BY[d.id] = d; }
  }
  const GROUPS = [["Weather", "Plays when the weather outside matches."], ["Seasons", "Things that drift across the screen at their time of year."],
    ["Shows", "Short scenes that play now and then, then leave. Always in front of the tiles."], ["Celebrations", ""]];

  /* ----- when does an effect play ----- */
  function nthWeekday(y, m, wd, n){ const d = new Date(y, m, 1); d.setDate(1 + (wd - d.getDay() + 7) % 7 + 7 * (n - 1)); return d; }
  const mdNum = s => { const [m, d] = String(s).split("-").map(Number); return m * 100 + d; };
  const inMd = (d, a, b) => { const k = (d.getMonth() + 1) * 100 + d.getDate(), x = mdNum(a), y = mdNum(b); return x <= y ? k >= x && k <= y : k >= x || k <= y; };
  // the holiday region (Controls → Language and formats → Holidays) decides when Thanksgiving is, or whether there is one
  let thanksOn = y => nthWeekday(y, 10, 4, 4), region = "United States";
  function setRegion(name, thanks){ region = name; thanksOn = thanks || (() => null); }
  function seasonRanges(def, y){
    if (def.regions && !def.regions.includes(region)) return [];
    if (def.season === "thanks"){ const t = thanksOn(y); if (!t) return []; const s = new Date(t); s.setDate(t.getDate() - 7);
      const f = d => (d.getMonth() + 1) + "-" + d.getDate(); return [[f(s), f(t)]]; }
    return def.season || [];
  }
  function inSeason(def, d){ return seasonRanges(def, d.getFullYear()).some(r => inMd(d, r[0], r[1])); }
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const mdTxt = s => { const [m, d] = String(s).split("-").map(Number); return MON[m - 1] + " " + d; };
  function seasonText(def){
    if (def.season === "thanks") return "Thanksgiving week";
    return (def.season || []).map(r => r[0] === r[1] ? mdTxt(r[0]) : mdTxt(r[0]) + "–" + mdTxt(r[1])).join(" and ");
  }
  const WXTXT = {rain:"When it's raining", snow:"When it's snowing", fog:"When it's foggy", clouds:"When it's cloudy", sun:"On clear days", stars:"On clear nights"};
  // one effect's settings: what's saved, filled in with its defaults
  function conf(saved, id){
    const def = BY[id], o = (saved || []).find(x => x && x.id === id) || {};
    return Object.assign({id, on:true, amount:"Some", when: def.wx ? "weather" : def.party ? "birthday" : def.season ? "season" : "always", every: def.layer === "show" ? 15 : 0, from:"", to:""}, o);
  }
  function whenText(c){
    const def = BY[c.id];
    if (c.when === "always") return def.layer === "show" ? "All year" : "Always";
    if (c.when === "dates") return c.from && c.to ? mdTxt(c.from) + "–" + mdTxt(c.to) : "Pick dates";
    if (def.wx) return WXTXT[c.id] || "Matching weather";
    if (def.party) return "On birthdays";
    return def.season ? seasonText(def) : "All year";
  }
  function timeOk(c, d){
    if (c.when === "always") return true;
    if (c.when === "dates") return !!(c.from && c.to) && inMd(d, c.from, c.to);
    if (BY[c.id].season) return inSeason(BY[c.id], d);
    return false;
  }
  function wxMode(code, day){
    if (code == null) return null;
    if (code >= 95) return "storm";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
    if (code >= 51 && code <= 67) return code <= 57 ? "drizzle" : "rain";
    if (code >= 80 && code <= 82) return "rain";
    if (code === 45 || code === 48) return "fog";
    if (code === 2 || code === 3) return "clouds";
    return day ? "sun" : "stars";
  }

  /* ----- a canvas that runs effects. Drawing is in 1920-wide units (opt.base) and scaled to the canvas ----- */
  function Runner(cv, opt){
    opt = opt || {};
    const cx = cv.getContext("2d");
    let W = 1920, H = 1080, k = 1, list = [], running = false, last = 0, paused = false;
    function size(){
      const w = opt.full ? innerWidth : cv.clientWidth || 320, h = opt.full ? innerHeight : cv.clientHeight || 180;
      const dpr = opt.full ? 1 : Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      W = opt.base || 1920; k = cv.width / W; H = cv.height / k;
      list.forEach(e => { if (e.keep) e.draw = e.make(); });
    }
    size(); if (opt.full) addEventListener("resize", size);
    function frame(ts){
      if (!running) return;
      requestAnimationFrame(frame);
      if (ts - last < 1000 / (opt.fps || 25)) return;
      last = ts;
      cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, cv.width, cv.height);
      cx.setTransform(k, 0, 0, k, 0, 0);
      if (opt.under) opt.under(cx, W, H);
      const beh = opt.over ? list.filter(e => e.behind) : [], top = opt.over ? list.filter(e => !e.behind) : list;
      const run = e => { let alive = true; try{ alive = e.draw(cx); }catch(err){ alive = false; } if (!alive && !e.keep){ e.dead = true; if (e.done) e.done(); } };
      beh.forEach(run);
      if (opt.over) opt.over(cx, W, H);
      top.forEach(run);
      list = list.filter(e => !e.dead);
      if (!list.length && !opt.always){ running = false; cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, cv.width, cv.height); }
    }
    function start(){ if (!running && !paused && (list.length || opt.always)){ running = true; requestAnimationFrame(frame); } }
    function inst(id, p, keep){
      const def = BY[id]; if (!def) return null;
      const e = {id, key:id + "|" + p.amount + "|" + (p.kind || "") + "|" + !!p.front, keep, behind:!!p.behind,
        make:() => def.make({amt:AMT[p.amount] || 1, kind:p.kind, front:p.front, preview:opt.preview, ms:p.ms, W, H})};
      e.draw = e.make(); return e;
    }
    return {
      // the continuous effects that should be running now: [{id, amount, kind, front, behind}]
      set(want){
        const keys = want.map(p => p.id + "|" + p.amount + "|" + (p.kind || "") + "|" + !!p.front);
        list = list.filter(e => !e.keep || keys.includes(e.key));
        want.forEach((p, i) => { if (!list.some(e => e.keep && e.key === keys[i])){ const e = inst(p.id, p, true); if (e) list.push(e); } });
        start();
      },
      play(id, p, done){ const e = inst(id, p || {}, false); if (!e) return; e.done = done; list.push(e); start(); },
      busy(){ return list.some(e => !e.keep); },
      pause(p){ paused = p; if (p){ running = false; list = list.filter(e => e.keep); cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, cv.width, cv.height); } else start(); },
      clear(){ list = []; },
      size, start
    };
  }
  return {L, BY, GROUPS, AMT, conf, whenText, timeOk, inSeason, seasonText, wxMode, Runner, mdTxt, MOTIONS, SIZE, SPEED, MD, setMine, setRegion};
})();

