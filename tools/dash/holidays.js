/* ---------- holidays by region (Controls → Language and formats → Holidays) ---------- */
// Each region lists its days as [emoji, name, a function from the year to a date]. Names go through tr(), so they follow the screen's language.
function easterOf(y){            // Easter Sunday (the usual Gregorian calculation)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const t = h + l - 7 * m + 114;
  return new Date(y, Math.floor(t / 31) - 1, (t % 31) + 1);
}
const fixedDay = (m, d) => y => new Date(y, m - 1, d);
const afterEaster = n => y => { const e = easterOf(y); e.setDate(e.getDate() + n); return e; };
const lastWeekday = (m, wd) => y => { const d = new Date(y, m, 0); d.setDate(d.getDate() - (d.getDay() - wd + 7) % 7); return d; };      // m = 1-12
const mondayBefore = (m, d) => y => { const x = new Date(y, m - 1, d); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; };       // the Monday on or before
const nthDay = (m, wd, n) => y => nthWeekday(y, m - 1, wd, n);

const HOLIDAY_REGIONS = {
  "United States": {july4:true, stPatrick:true, countdownAfterThanks:true, thanks:y => nthWeekday(y, 10, 4, 4), national:[],
    days:() => [["☘️", tr("St. Patrick's Day"), fixedDay(3, 17)], ["🎆", tr("Fourth of July"), fixedDay(7, 4)], ["🦃", tr("Thanksgiving"), nthDay(11, 4, 4)]]},
  "Canada": {stPatrick:true, thanks:y => nthWeekday(y, 9, 1, 2),
    national:[{m:6, d:1, accent:"#ff5a5a", greet:() => "🍁 " + tr("Happy Canada Day")}],
    days:() => [["☘️", tr("St. Patrick's Day"), fixedDay(3, 17)], ["✝️", tr("Good Friday"), afterEaster(-2)], ["🐣", tr("Easter"), afterEaster(0)],
      ["👑", tr("Victoria Day"), mondayBefore(5, 24)], ["🍁", tr("Canada Day"), fixedDay(7, 1)], ["🦃", tr("Thanksgiving"), nthDay(10, 1, 2)],
      ["🌺", tr("Remembrance Day"), fixedDay(11, 11)], ["🎁", tr("Boxing Day"), fixedDay(12, 26)]]},
  "United Kingdom": {stPatrick:true, thanks:null,
    days:() => [["☘️", tr("St. Patrick's Day"), fixedDay(3, 17)], ["✝️", tr("Good Friday"), afterEaster(-2)], ["🐣", tr("Easter"), afterEaster(0)],
      ["🐣", tr("Easter Monday"), afterEaster(1)], ["🌷", tr("Early May bank holiday"), nthDay(5, 1, 1)], ["🌷", tr("Spring bank holiday"), lastWeekday(5, 1)],
      ["☀️", tr("Summer bank holiday"), lastWeekday(8, 1)], ["🎆", tr("Bonfire Night"), fixedDay(11, 5)], ["🌺", tr("Remembrance Sunday"), nthDay(11, 0, 2)],
      ["🎁", tr("Boxing Day"), fixedDay(12, 26)]]},
  "Australia": {thanks:null,
    national:[{m:0, d:26, accent:"#ffd36e", greet:() => "🇦🇺 " + tr("Happy Australia Day")}],
    days:() => [["🇦🇺", tr("Australia Day"), fixedDay(1, 26)], ["✝️", tr("Good Friday"), afterEaster(-2)], ["🐣", tr("Easter"), afterEaster(0)],
      ["🐣", tr("Easter Monday"), afterEaster(1)], ["🌺", tr("Anzac Day"), fixedDay(4, 25)], ["🎁", tr("Boxing Day"), fixedDay(12, 26)]]},
  "France": {thanks:null,
    national:[{m:6, d:14, accent:"#6fa0ff", greet:() => "🇫🇷 " + tr("Happy Bastille Day")}],
    days:() => [["🐣", tr("Easter"), afterEaster(0)], ["🐣", tr("Easter Monday"), afterEaster(1)], ["🌷", tr("Labour Day"), fixedDay(5, 1)],
      ["🕊️", tr("Victory in Europe Day"), fixedDay(5, 8)], ["✨", tr("Ascension Day"), afterEaster(39)], ["🕊️", tr("Whit Monday"), afterEaster(50)],
      ["🇫🇷", tr("Bastille Day"), fixedDay(7, 14)], ["⛪", tr("Assumption"), fixedDay(8, 15)], ["🕯️", tr("All Saints' Day"), fixedDay(11, 1)],
      ["🌺", tr("Armistice Day"), fixedDay(11, 11)]]},
  "None": {thanks:null, none:true, days:() => []}
};
function holidayRegion(){
  const R = HOLIDAY_REGIONS[(S("general") || {}).holidays] || HOLIDAY_REGIONS["United States"];
  return R;
}
function holidayRegionName(){ return HOLIDAY_REGIONS[(S("general") || {}).holidays] ? S("general").holidays : "United States"; }
// the days every region shares, then the region's own, as [{d, t}] for a year
function holidaysIn(y){
  const R = holidayRegion();
  if (R.none) return [];
  const all = [["🎉", tr("New Year's Day"), fixedDay(1, 1)], ["💕", tr("Valentine's Day"), fixedDay(2, 14)], ["🎃", tr("Halloween"), fixedDay(10, 31)],
    ["🎅", tr("Christmas Eve"), fixedDay(12, 24)], ["🎄", tr("Christmas"), fixedDay(12, 25)], ["🥂", tr("New Year's Eve"), fixedDay(12, 31)]].concat(R.days());
  return all.map(([e, n, f]) => ({d:f(y), t:e + " " + n})).sort((a, b) => a.d - b.d);
}
