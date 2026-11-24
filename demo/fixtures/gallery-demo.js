// A small fictional gallery for the release screenshots: the shape of the real index.json,
// with made-up items and authors. Used by demo/capture-release.js through COUNTERTOP_GALLERY_URL.
const item = (kind, id, author, name, description, body, version = 1) => ({
  id: kind + "s/" + id, kind, name, description, author, version, updated: "2026-11-21",
  item: Object.assign({ countertop: kind, format: 1, name, description, made: "2026-11-21" }, body),
});

module.exports = {
  countertop: "gallery", format: 1, updated: "2026-11-22", revoked: [],
  items: [
    item("theme", "calm-evening", "riverside-ross", "Calm evening",
      "Warmer and a little dimmer, with see-through tiles and no effects. Made for after dinner.",
      { values: { mode: "Dark", accent: "#ff9f5a", tiles: "See-through", opacity: 55, bg: "Sky", dim: 30, fx: "Off" } }),
    item("theme", "soft-linen", "maple-lane", "Soft linen",
      "A light, quiet look in warm neutrals.",
      { values: { mode: "Light", bg: "Color", bgColor: "#efe8dc", accent: "#8a5a44", tiles: "See-through", opacity: 60, fx: "Off" } }),
    item("theme", "harbor-blue", "lakewood-lee", "Harbor blue",
      "Deep blues with a bright accent for a big kitchen screen.",
      { values: { mode: "Dark", bg: "Color", bgColor: "#0f2233", accent: "#5ec2e8", tiles: "Solid", opacity: 80, fx: "Off" } }),
    item("effect", "pumpkin-patch", "riverside-ross", "Pumpkin patch",
      "Pumpkins, candy and the odd bat drift down through October.",
      { effect: { glyphs: ["🎃", "🍬", "🦇"], motion: "fall", size: "Big", speed: "Slow", spin: true, from: "10-1", to: "10-31" } }),
    item("effect", "garden-party", "maple-lane", "Garden party",
      "Butterflies and blossoms wandering across the screen all spring.",
      { effect: { glyphs: ["🦋", "🌸", "🌼"], motion: "wander", size: "Medium", speed: "Slow", spin: false, from: "4-1", to: "5-31" } }),
    item("tile", "porch-lights", "maple-lane", "Porch lights",
      "The porch light and the front door lock, with buttons right under the tile.",
      { id: "porch-lights", size: [12, 10, 10, 8], taps: false,
        devices: { light: { label: "Porch light", domains: ["light", "switch"] }, lock: { label: "Front door lock", domains: ["lock"] } },
        controls: [{ id: "on", device: "light", action: "turn_on" }, { id: "off", device: "light", action: "turn_off" },
          { id: "lock", device: "lock", action: "lock" }, { id: "unlock", device: "lock", action: "unlock" }],
        settings: {}, demoData: {},
        code: 'Tile("porch-lights", {\n  render(el){\n    const d = this.devices(), line = (o, what) => "<div class=li><span class=s>" + this.esc(what) + "</span><span class=t>" + this.esc(o ? o.state : "not picked") + "</span></div>";\n    el.innerHTML = "<h3>" + this.esc(this.name) + "</h3>" + line(d.light, "Light") + line(d.lock, "Lock");\n  }\n});\n' }),
    item("layout", "weekend-board", "lakewood-lee", "Weekend board",
      "A big month calendar beside what is coming up.",
      { look: { mode: "Light", bg: "Color", bgColor: "#e4dfed", accent: "#76508a" },
        pages: [{ name: "Weekend board", boxes: [
          { x: 0, y: 0, w: 19, h: 7, tiles: [{ type: "clock", settings: { style: "Bold" } }] },
          { x: 19, y: 0, w: 29, h: 7, tiles: [{ type: "weather", settings: {} }] },
          { x: 0, y: 7, w: 32, h: 25, tiles: [{ type: "month", settings: {} }] },
          { x: 32, y: 7, w: 16, h: 25, tiles: [{ type: "agenda", settings: {} }] },
        ] }] }),
  ],
};
