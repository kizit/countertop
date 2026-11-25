/* Meal ideas: breakfast, lunch, dinner or dessert, following the time of day. Tap it for the whole recipe.
   The type stays "dinner" so layouts made before the rename keep their tile. */
const MEAL_ORDER = ["breakfast", "lunch", "dinner", "dessert"];
const MEAL_NAME = {breakfast:"Breakfast", lunch:"Lunch", dinner:"Dinner", dessert:"Dessert"};
Tile("dinner", {
  title:"Meal ideas", cat:"Lists & food", cls:"m-dinner", every:60, size:[10, 12, 8, 6],
  desc:"A breakfast, lunch, dinner or dessert idea with a photo, following the time of day. It says when a recipe uses something on your list or on sale. Tap it for the ingredients and steps, and add what you need to your list. Recipes come from TheMealDB, or Spoonacular with your own key (Setup, Recipes).",
  settings:{
    meals:{type:"choice", label:"Which meals", choices:["Follow the time of day", "Breakfast", "Lunch", "Dinner", "Dessert"], default:"Follow the time of day",
      help:"Following the time of day: breakfast until 10:30, lunch until 2, dinner until 7:30, then dessert"},
    breakfast:{type:"bool", when:{meals:"Follow the time of day"}, label:"Breakfast in the morning", default:true},
    lunch:{type:"bool", when:{meals:"Follow the time of day"}, label:"Lunch at midday", default:true},
    dessert:{type:"bool", when:{meals:"Follow the time of day"}, label:"Dessert in the evening", default:true, help:"Turned off, dinner ideas stay up instead"},
    diet:{type:"choice", label:"Diet", choices:["Anything", "Vegetarian", "Vegan", "No pork", "No seafood", "No pork or seafood"], default:"Anything"},
    src:{type:"source", kind:"recipes", label:"Recipes from", default:"", none:"TheMealDB, with its free key"},
    why:{type:"bool", label:"Say when it uses something on your list or on sale", default:true},
    every:{type:"int", label:"Minutes per idea", default:30, min:5, max:1440}
  },
  css:`.m-dinner .ph{cursor:pointer;position:relative}
    .m-dinner .tapme{display:inline-block;margin-left:8px;font-size:14px;padding:2px 9px;border-radius:12px;background:rgba(0,0,0,.45);color:#fff;white-space:nowrap}      /* sits beside the cuisine line, never over the title */
    .m-dinner .why{display:flex;align-items:center;gap:8px;font-size:17px;color:var(--dim);line-height:1.25}
    .m-dinner .why i{font-style:normal;flex:none}
    .m-dinner .why b{font-weight:500;color:var(--fg,#e9ecf1)}
    .m-dinner .empty{margin:auto 0}
    #recipe{position:fixed;inset:0;z-index:7;background:rgba(6,8,12,.97);display:flex;gap:40px;padding:40px 48px;color:#e9ecf1}
    #recipe .l{flex:0 0 520px;display:flex;flex-direction:column;gap:18px;min-height:0}
    #recipe .img{flex:0 0 auto;width:520px;height:390px;border-radius:18px;background:#1c2128 center/cover no-repeat}
    #recipe h2{margin:0;font-size:40px;line-height:1.1;font-weight:600}
    #recipe .meta{color:#9aa3ad;font-size:20px}
    #recipe .why{color:#cfe6c4;font-size:20px}
    #recipe .credit{color:#7d8792;font-size:15px;line-height:1.35;overflow-wrap:anywhere}
    #recipe .r{flex:1;min-width:0;display:flex;flex-direction:column;gap:18px;min-height:0;overflow:hidden}
    #recipe .ing{columns:3;column-gap:28px;font-size:var(--rf);line-height:1.35;flex:none}
    #recipe .ing div{break-inside:avoid;padding:2px 0 2px 1.3em;position:relative}
    #recipe .ing b{color:var(--accent);font-weight:500}
    #recipe.pick .ing div{cursor:pointer}
    #recipe.pick .ing div::before{content:"";position:absolute;left:0;top:.42em;width:.8em;height:.8em;border-radius:50%;border:2px solid #5d6672;box-sizing:border-box}
    #recipe.pick .ing div.on::before{background:var(--accent);border-color:var(--accent)}
    #recipe.pick .ing div.has{color:#7d8792}
    #recipe .sh{font-size:15px;letter-spacing:.08em;text-transform:uppercase;color:#9aa3ad;flex:none;display:flex;justify-content:space-between;gap:12px}
    #recipe .sh em{font-style:normal;text-transform:none;letter-spacing:0}
    #recipe ol{margin:0;padding-left:1.4em;columns:2;column-gap:36px;column-fill:auto;font-size:var(--rf);line-height:1.4;flex:1;min-height:0;overflow:hidden}
    #recipe ol li{break-inside:avoid;margin-bottom:.5em}
    #recipe .btns{display:flex;gap:12px;margin-top:auto;flex-wrap:wrap}
    #recipe button{font:inherit;font-size:22px;padding:12px 22px;border-radius:14px;border:0;background:#232a33;color:#e9ecf1}
    #recipe button.pri{background:var(--accent);color:#06121f;font-weight:600}
    #recipe button:disabled{opacity:.5}
    @media (orientation:portrait){
      #recipe{flex-direction:column;gap:24px;padding:clamp(16px,4vw,40px)}
      #recipe .l{flex:none;display:grid;grid-template-columns:minmax(0,2fr) minmax(0,3fr);grid-template-rows:auto auto auto 1fr;gap:12px 20px}
      #recipe .img{grid-row:1/5;width:100%;height:clamp(120px,28vw,340px)}
      #recipe h2{font-size:clamp(24px,4vw,40px)}
      #recipe .credit{display:none}
      #recipe button{font-size:clamp(16px,2.3vw,22px)}
      #recipe .ing{columns:2}
      #recipe ol{columns:1}
    }`,

  // which meal to show right now
  meal(){
    const s = this.s, pick = String(s.meals || "").toLowerCase();
    if (MEAL_ORDER.includes(pick)) return pick;
    const d = new Date(), t = d.getHours() * 60 + d.getMinutes();
    let m = t >= 240 && t < 630 ? "breakfast" : t >= 630 && t < 840 ? "lunch" : t >= 840 && t < 1170 ? "dinner" : "dessert";
    if (m === "breakfast" && s.breakfast === false) m = s.lunch === false ? "dinner" : "lunch";
    if (m === "lunch" && s.lunch === false) m = "dinner";
    if (m === "dessert" && s.dessert === false) m = "dinner";
    return m;
  },
  render(el){
    const s = this.s, meal = this.meal();
    const url = "/meals?meal=" + meal + "&diet=" + encodeURIComponent(s.diet || "Anything") + "&src=" + encodeURIComponent(s.src || "");
    const d = tileData(this, url, 1800), D = d && d.ideas && d.ideas.length ? d.ideas : null;
    const k = D ? Math.floor(Date.now() / ((s.every || 30) * 60e3)) % D.length : -1;
    const key = url + "|" + (D ? D[k].id + D[k].title + (s.why !== false ? D[k].why : "") : d ? "e" + d.error : "…");
    if (el._key === key) return;
    el._key = key; el._meals = d;
    let h = '<h3><span>' + esc(this.it.name || MEAL_NAME[meal] + " idea") + '</span></h3>';
    if (D){
      const i = D[k];
      h += '<div class="ph" data-recipe="' + k + '"' + (i.thumb ? ' style="background-image:url(&quot;' + esc(i.thumb) + '&quot;)"' : "") + '>' +
        '<div><b data-keep>' + esc(i.title) + '</b><span>' +
        esc([i.area, i.cat].filter(Boolean).join(" · ")) + '</span>' + ((i.steps || []).length ? '<span class="tapme">Recipe ›</span>' : "") + '</div></div>';
      if (s.why !== false && i.why) h += '<div class="why"><i>' + (/on sale/.test(i.why) ? "🏷" : "📝") + '</i><span>' + esc(i.why) + '</span></div>';
    } else h += '<div class="empty">' + esc(d ? d.error || "No ideas right now" : "Finding ideas…") + '</div>';
    el.innerHTML = h;
    if (!el._tap){ el._tap = true; el.addEventListener("click", e => { const p = e.target.closest("[data-recipe]"); if (p && !EDIT.on && !PREVIEW) recipeOpen(el._meals, +p.dataset.recipe, this.s.why !== false); }); }
  }
});

// a pantry staple doesn't need to go on the list
const RECIPE_STAPLES = /^(water|salt|pepper|black pepper|salt (and|&) pepper|sea salt|oil|olive oil|vegetable oil|sugar|ice|boiling water|cold water|hot water)$/i;
function recipeOnList(name, list){
  const w = t => String(t).toLowerCase().match(/[a-z]+/g) || [], a = w(name).map(x => x.replace(/s$/, ""));
  return (list || []).some(t => { const b = w(t).map(x => x.replace(/s$/, "")); const [s, l] = a.length <= b.length ? [a, b] : [b, a]; return s.length && s.every(x => l.includes(x)); });
}
// the whole recipe over the screen; closes with Close, or by itself after 15 minutes
function recipeOpen(d, k, why){
  const D = (d && d.ideas) || [], i = D[k]; if (!i) return;
  recipeClose();
  const L = d.list || {}, ings = i.ingredients || [];
  const r = document.createElement("div"); r.id = "recipe";
  const ing = ings.map(([m, n], x) => { const has = recipeOnList(n, L.items), on = !has && !RECIPE_STAPLES.test(String(n).trim());
    return '<div data-i="' + x + '" class="' + (on ? "on" : "") + (has ? " has" : "") + '">' + (m ? '<b>' + esc(m) + '</b> ' : "") + esc(n) + (has ? " · on your list" : "") + '</div>'; }).join("");
  const steps = (i.steps || []).map(x => '<li>' + esc(x) + '</li>').join("");
  const credit = i.credit === "TheMealDB" ? "Recipe and photo from TheMealDB (themealdb.com)" + (i.link ? ". Original: " + i.link : "")
    : "Recipe from " + (i.credit || "the web") + (i.link ? " (" + i.link + ")" : "") + (i.via ? ", found with " + i.via : "");
  r.innerHTML = '<div class="l"><div class="img" style="background-image:url(&quot;' + esc(i.big || i.thumb || "") + '&quot;)"></div><h2>' + esc(i.title) + '</h2>' +
    '<div class="meta">' + esc([i.area, i.cat].filter(Boolean).join(" · ")) + '</div>' +
    (why && i.why ? '<div class="why">' + esc(i.why) + '</div>' : "") + '<div class="credit">' + esc(credit) + '</div>' +
    '<div class="btns"><button class="pri" data-r="close">Close</button>' + (D.length > 1 ? '<button data-r="next">Another idea</button>' : "") +
    (L.canAdd && ings.length ? '<button data-r="pick">Add to list</button>' : "") + '</div></div>' +
    '<div class="r">' + (ing ? '<div class="sh"><span>Ingredients</span><em></em></div><div class="ing">' + ing + '</div>' : "") +
    (steps ? '<div class="sh">Steps</div><ol>' + steps + '</ol>' : '<div class="meta">This one came without steps. Tap Another idea.</div>') + '</div>';
  document.body.appendChild(r);
  r.addEventListener("pointerdown", e => e.stopPropagation());
  r.addEventListener("touchstart", e => e.stopPropagation(), {passive:true});
  const pickBtn = r.querySelector('[data-r="pick"]'), hint = r.querySelector(".sh em");
  const count = () => r.querySelectorAll(".ing div.on").length;
  const label = () => { if (!r.classList.contains("pick")) return; const n = count();
    pickBtn.textContent = n ? "Add " + n + " to " + (L.name || "the list") : "Tap what you need"; pickBtn.disabled = !n;
    hint.textContent = "Tap to choose what to add"; };
  r.addEventListener("click", async e => {
    const row = e.target.closest(".ing div");
    if (row && r.classList.contains("pick")){ row.classList.toggle("on"); label(); return; }
    const b = e.target.closest("[data-r]"); if (!b) return;
    if (b.dataset.r === "next") return recipeOpen(d, (k + 1) % D.length, why);
    if (b.dataset.r !== "pick") return recipeClose();
    if (!r.classList.contains("pick")){ r.classList.add("pick"); label(); return; }
    const add = [...r.querySelectorAll(".ing div.on")].map(x => ings[+x.dataset.i][1]);
    b.disabled = true; b.textContent = "Adding…";
    let ok = 0;
    for (const text of add){
      try{ const q = await fetch("/notes", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({op:"add", text})}); if (q.ok) ok++; }catch(err){}
    }
    r.classList.remove("pick"); hint.textContent = "";
    b.textContent = ok === add.length ? "✓ Added " + ok + " to " + (L.name || "the list") : "Added " + ok + " of " + add.length;
    try{ loadNotes(); }catch(err){}
  });
  // no scrolling: shrink the text until everything fits
  const ol = r.querySelector("ol"), rr = r.querySelector(".r");
  const over = () => (ol && (ol.scrollHeight > ol.clientHeight + 2 || ol.scrollWidth > ol.clientWidth + 2)) || rr.scrollHeight > rr.clientHeight + 2;
  let f = 26; do { r.style.setProperty("--rf", f + "px"); f--; } while (f >= 12 && over());
  recipeClose.t = setTimeout(recipeClose, 15 * 60e3);
}
function recipeClose(){ clearTimeout(recipeClose.t); const d = document.getElementById("recipe"); if (d) d.remove(); }
