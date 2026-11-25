/* ---------- emoji swaps: tap the emoji to change (from the ones the dashboard uses), then tap what shows instead ---------- */
const EMO_RE = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2})(?:️|⃣|[\u{1F3FB}-\u{1F3FF}]|‍(?:\p{Extended_Pictographic}|\p{Emoji_Component})️?)*/gu;
const emoKey = e => String(e || "").replace(/️/g, "").trim();
const EMO_PICK = [
  ["Weather and sky", "☀️ 🌤️ ⛅ 🌥️ ☁️ 🌦️ 🌧️ ⛈️ 🌩️ 🌨️ ❄️ ☃️ ⛄ 🌬️ 💨 🌪️ 🌫️ 🌈 ☔ ⚡ 🔥 💧 🌊 🌞 🌝 🌙 🌛 ⭐ 🌟 ✨ 🌠 🌅 🌄 🌇 🌆 🌃 🌑 🌒 🌓 🌔 🌕 🌖 🌗 🌘"],
  ["Faces", "😀 😃 😄 😁 😊 🙂 😉 😍 🥰 😘 😎 🤓 🥳 😴 🥱 🤔 🙃 😬 😮 😱 🥶 🥵 🤒 😷 🤠 😇 👋 👍 👏 🙌 💪 🙏"],
  ["Food and drink", "🍎 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍒 🍑 🥭 🍍 🥥 🥑 🥦 🥕 🌽 🌶️ 🥔 🍠 🧄 🧅 🥖 🥐 🥯 🧀 🥚 🍳 🥞 🧇 🥓 🍗 🍖 🌭 🍔 🍟 🍕 🌮 🌯 🥗 🍝 🍜 🍲 🍣 🍱 🥟 🍪 🍩 🧁 🍰 🎂 🥧 🍫 🍬 🍿 ☕ 🍵 🥛 🧃 🍺 🍷 🥂 🍹"],
  ["Animals and plants", "🐶 🐱 🐭 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦆 🦉 🦇 🐺 🐴 🦄 🐝 🦋 🐞 🐢 🐍 🐙 🐠 🐬 🐳 🦖 🦃 🐿️ 🦔 🌲 🌳 🌴 🌵 🌷 🌸 🌹 🌻 🌼 🍀 🍁 🍂 🍃 🌾 🍄"],
  ["Holidays and fun", "🎉 🎊 🎈 🎁 🎀 🎃 👻 🦇 🕸️ 🍬 🦃 🥧 🎄 🎅 🤶 ⛄ ❄️ 🕎 🎆 🎇 🥳 🍾 💝 💕 💖 ❤️ 🌹 🍀 🐣 🐰 🥚 🇺🇸 🎗️ 🕯️ 🎂 🎵 🎶"],
  ["Sports", "⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🏓 🏸 🏒 🏑 🥍 🏏 ⛳ 🏌️ 🏃 🚴 🏊 ⛷️ 🏂 🎿 ⛸️ 🥅 🏆 🥇 🏅 🎯"],
  ["Things", "📅 📆 🗓️ ⏰ ⏱️ ⌛ 🔔 📣 📌 📍 📝 ✏️ 📚 💼 🎒 🏠 🏡 🏫 🏥 🏢 🚗 🚕 🚌 🚲 ✈️ 🚀 ⛽ 🛒 💡 🔑 🎮 📺 📷 🎧 💊 🧺 🧹 🧼 🗑️ 📦 💰 💵 💳"],
  ["Symbols", "✅ ✔️ ☑️ ❌ ⚠️ ❗ ❓ 💯 ➡️ ⬅️ ⬆️ ⬇️ ↗️ 🔄 ⏩ ⏪ 🔴 🟠 🟡 🟢 🔵 🟣 🟤 ⚫ ⚪ 🟥 🟧 🟨 🟩 🟦 🟪 ⬛ ⬜ 🔶 🔷 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 ✳️ ✴️ 💠"]];
let EMO_USED = null, EMO_NEW = "";
// every emoji in the dashboard's own code and tiles: the ones that can show up on the screen
function emoUsed(){
  if (EMO_USED) return EMO_USED;
  EMO_USED = "loading";
  Promise.all(["/dash/content", "/tiles.js"].map(u => fetch(u).then(r => r.text()).catch(() => ""))).then(T => {
    const seen = new Map();
    for (const m of T.join("\n").matchAll(EMO_RE)){
      const e = m[0], k = emoKey(e);
      if (!k || seen.has(k)) continue;
      if (!/\p{Emoji_Presentation}/u.test(k) && !e.includes("️") && !/\p{Regional_Indicator}/u.test(k)) continue;     // ©, ↔ and other plain text characters
      seen.set(k, e.includes("️") || /\p{Emoji_Presentation}/u.test(k) ? (e.endsWith("️") || /\p{Emoji_Presentation}/u.test(k) ? e : e + "️") : e);
    }
    EMO_USED = [...seen.values()].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
    if ((stack[stack.length - 1] || "").startsWith("emo:")) show();
  });
  return EMO_USED;
}
const swapList = () => (mods.general.settings.swap = Array.isArray(mods.general.settings.swap) ? mods.general.settings.swap : []);
const swapParse = s => { const i = String(s).indexOf("="); return i < 0 ? [String(s).trim(), ""] : [String(s).slice(0, i).trim(), String(s).slice(i + 1).trim()]; };
function swapRows(){
  const L = swapList();
  return sec("Swap emoji", L.map((s, i) => { const [a, b] = swapParse(s);
      return '<div class="row swp"><button class="emb" data-emo="' + i + ':old" title="Change which emoji">' + esc(a || "?") + '</button><span class="arr">→</span>' +
        '<button class="emb' + (b ? "" : " none") + '" data-emo="' + i + ':new" title="Change what shows instead">' + (b ? esc(b) : "nothing") + '</button>' +
        '<span class="t"></span><button class="lnk" data-emodel="' + i + '">Remove</button></div>'; }).join("") +
    row({t:"Swap an emoji", chev:true, cls:"add", attrs:'data-emo="new:old"'}),
    "Tap an emoji to pick it from a list. A swap changes it everywhere on the screen.");
}
function emoScreen(cur){
  const [, i, side] = cur.split(":"), L = swapList(), pair = i === "new" ? [EMO_NEW, ""] : swapParse(L[+i] || "");
  const btn = e => '<button class="emp' + (emoKey(e) === emoKey(pair[side === "old" ? 0 : 1]) ? " on" : "") + '" data-emopick="' + esc(e) + '" title="' + esc(e) + '">' + esc(e) + '</button>';
  let h = '<div class="big">' + (side === "old" ? "Which emoji?" : "Show instead") + '</div>';
  if (side === "old"){
    h += '<p class="intro">Every emoji the dashboard can show. Tap the one to change.</p>';
    const U = emoUsed();
    h += U === "loading" ? '<p class="intro">Loading…</p>' : '<div class="sec"><div class="emgrid">' + U.map(btn).join("") + '</div></div>';
  } else {
    h += '<p class="intro">' + (pair[0] ? 'What shows instead of <span class="embig">' + esc(pair[0]) + '</span>' : "Pick what shows instead") + '</p>';
    h += sec("", '<button class="btnrow" data-emopick="">Show nothing (hide it)</button>');
    for (const [g, list] of EMO_PICK) h += '<div class="sec"><h2>' + esc(g) + '</h2><div class="emgrid">' + list.split(" ").filter(Boolean).map(btn).join("") + '</div></div>';
  }
  h += sec("Or paste one", '<div class="row"><input type="text" data-emoin placeholder="Paste or type an emoji" style="flex:1"><button class="lnk" data-emouse>Use it</button></div>');
  return h;
}
function emoPick(v){
  const cur = stack[stack.length - 1], [, i, side] = cur.split(":"), L = swapList();
  v = String(v || "").trim();
  if (i === "new"){
    if (side === "old"){ if (!v) return; EMO_NEW = emoKey(v); stack[stack.length - 1] = "emo:new:new"; show(); scrollTo(0, 0); return; }
    L.push(EMO_NEW + " = " + v); EMO_NEW = "";
  } else {
    const p = swapParse(L[+i] || "");
    if (side === "old"){ if (!v) return; p[0] = emoKey(v); } else p[1] = v;
    L[+i] = p[0] + " = " + p[1];
  }
  save(); stack.pop(); show();
}
document.addEventListener("click", e => {
  const t = e.target.closest("[data-emo],[data-emopick],[data-emodel],[data-emouse]"); if (!t) return;
  const d = t.dataset;
  if (d.emo){ go("emo:" + d.emo); return; }
  if (d.emodel != null){ swapList().splice(+d.emodel, 1); save(); show(); return; }
  if (d.emouse != null){ const inp = document.querySelector("[data-emoin]"); if (inp && inp.value.trim()) emoPick(inp.value); return; }
  if (d.emopick != null) emoPick(d.emopick);
});
