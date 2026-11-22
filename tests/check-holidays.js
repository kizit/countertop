// Checks the holiday regions in tools/dash/holidays.js: the dates people expect, and nothing for "None".
//   node tests/check-holidays.js
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "..", "tools", "dash", "holidays.js"), "utf8");
let setting = "United States";
const ctx = {
  tr: s => s, S: () => ({holidays: setting}),
  nthWeekday: (y, m, wd, n) => { const d = new Date(y, m, 1); d.setDate(1 + (wd - d.getDay() + 7) % 7 + 7 * (n - 1)); return d; },
  Date, Math, Object, Array
};
vm.createContext(ctx);
vm.runInContext(src + "\nthis.holidaysIn = holidaysIn; this.holidayRegion = holidayRegion; this.easterOf = easterOf;", ctx);

let bad = 0;
const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
function expect(region, year, name, date) {
  setting = region;
  const h = ctx.holidaysIn(year).find(x => x.t.endsWith(" " + name));
  const got = h ? iso(h.d) : "(missing)";
  if (got !== date) { bad++; console.log("✗ " + region + " " + year + " " + name + ": " + got + ", expected " + date); }
}
function absent(region, year, name) {
  setting = region;
  if (ctx.holidaysIn(year).some(x => x.t.endsWith(" " + name))) { bad++; console.log("✗ " + region + " should not have " + name); }
}

expect("United States", 2026, "Thanksgiving", "2026-11-26");
expect("United States", 2026, "Fourth of July", "2026-07-04");
expect("Canada", 2026, "Thanksgiving", "2026-10-12");        // second Monday of October
expect("Canada", 2025, "Thanksgiving", "2025-10-13");
expect("Canada", 2026, "Canada Day", "2026-07-01");
expect("Canada", 2026, "Victoria Day", "2026-05-18");        // the Monday before May 25
expect("Canada", 2025, "Victoria Day", "2025-05-19");
expect("Canada", 2026, "Remembrance Day", "2026-11-11");
expect("Canada", 2026, "Good Friday", "2026-04-03");
expect("United Kingdom", 2026, "Easter Monday", "2026-04-06");
expect("United Kingdom", 2026, "Spring bank holiday", "2026-05-25");
expect("United Kingdom", 2026, "Summer bank holiday", "2026-08-31");
expect("United Kingdom", 2026, "Early May bank holiday", "2026-05-04");
expect("United Kingdom", 2026, "Boxing Day", "2026-12-26");
expect("Australia", 2026, "Australia Day", "2026-01-26");
expect("Australia", 2026, "Anzac Day", "2026-04-25");
expect("France", 2026, "Bastille Day", "2026-07-14");
expect("France", 2026, "Easter", "2026-04-05");
expect("France", 2026, "Ascension Day", "2026-05-14");
expect("France", 2026, "Whit Monday", "2026-05-25");
expect("France", 2026, "Armistice Day", "2026-11-11");
for (const r of ["Canada", "United Kingdom", "Australia", "France"]) absent(r, 2026, "Fourth of July");
for (const r of ["United Kingdom", "Australia", "France"]) absent(r, 2026, "Thanksgiving");
absent("France", 2026, "Boxing Day");
setting = "None";
if (ctx.holidaysIn(2026).length) { bad++; console.log("✗ None should have no holidays"); }
setting = "Nowhere";
if (!ctx.holidaysIn(2026).some(x => x.t.endsWith(" Thanksgiving"))) { bad++; console.log("✗ an unknown region should fall back to the United States"); }
if (ctx.easterOf(2025).getMonth() !== 3 || ctx.easterOf(2025).getDate() !== 20) { bad++; console.log("✗ Easter 2025"); }

console.log(bad ? bad + " holiday checks failed" : "✓ holiday regions give the expected dates");
process.exit(bad ? 1 : 0);
