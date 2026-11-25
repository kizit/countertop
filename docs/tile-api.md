# Writing a tile

Every tile is one file in `tools/tiles/`. Adding a file adds a tile: the server serves all of them joined at `/tiles.js`, and there is no build step. Look at any file in that folder for a working example; `daily.js` uses everything on this page.

```js
Tile("daily", {
  api:1, uses:["store"],
  title:"Daily to-do", cat:"Lists & food", size:[12, 10, 8, 6], every:60,
  desc:"A checklist for the day that lives on this tile…",
  settings:{ max:{type:"int", label:"Items to show", default:20, min:3, max:60} },
  render(el){ /* draw into el */ },
  tap(e, el){ /* a tap anywhere in the tile */ },
  submit(e, el, form){ /* a form in the tile was submitted */ }
});
```

## The definition

| Field | What it is |
| --- | --- |
| `title`, `desc`, `cat` | Name, one-line description and category in the tile picker and the Library |
| `size` | `[width, height, min width, min height]` on the 48×32 grid |
| `settings` | The tile's settings form. Types: `bool`, `int`, `number`, `text`, `list`, `choice`, `color`, `code`, `source`. Add `share:false` to a setting that holds personal text, so it's left out of shared layouts |
| `render(el)` | Draws the tile. Called when it first shows, when its data changes, and every `every` seconds |
| `every` | Redraw every this many seconds (optional) |
| `feeds` | Shared data the tile reads, so the dashboard loads it: `wx`, `aqi`, `events`, `notes`, `team`, `photos`, `sales` |
| `has()` | Return false when there's nothing to show, and the box skips this tile |
| `css`, `cls` | The tile's own styles and the class its element gets |
| `demo`, `demoData` | Settings and stored data for the Library's example pictures |
| `api`, `uses` | The tile API version the tile is written for (`1`) and what it uses (`"store"`, `"fetch"`, `"events"`…) |
| `narrow` | Width in pixels (on a 1920×1080 screen) at or below which the tile switches to its compact look, `.slot.narrow` in its CSS. Without it, a box 560 px wide or narrower is compact |
| `grow` | How the tile uses extra space. `"value"` enlarges the main value (the `data-keep` element) while everything still fits |
| `hosts` | The sites the tile reads with `this.fetch`, like `["api.example.com"]` or `["*.example.com"]` for one level of subdomain. Names only, no addresses |

## What a tile can use

| On `this` | What it does |
| --- | --- |
| `this.s` | The tile's settings |
| `this.name` | Its name on this dashboard |
| `this.store` | Its own saved data (below) |
| `this.fetch(url, maxAge)` | Data from a web address, cached for `maxAge` seconds. Returns what it has now (or `null`) and redraws the tile when new data arrives. An `https://` address is read by the server, and only on a site the tile lists in `hosts` (below). JSON comes back parsed, anything else as text |
| `this.fetchError(url)` | Why the last `this.fetch` of that address failed, or `""` |
| `this.feed(name)` | Shared data the dashboard already loads: `weather`, `air`, `events`, `notes`, `teams`, `albums`, `sales`. List the matching `feeds` so it gets loaded |
| `this.esc(text)` | The text made safe to put into `innerHTML`. Use it for anything a person typed or a feed sent |
| `this.events({cals, once})` | Coming events from the calendars in Setup, soonest first, each with `date` (a `Date`) added. `cals` limits it to those calendar ids (empty means all); `once: true` shows a repeating event once, with `rep` ("every Tue") |
| `this.sources(kind)` | The sources set up in Setup of one kind (`calendars`, `teams`, `lists`…) as `[{id, name, color}]`, with no addresses or keys. Use it to tell "nothing set up yet" from "nothing to show" |
| `this.t(text, values)` | The text in the dashboard's language (below). `this.locale` is the locale for dates and numbers |
| `this.act(action, args)` | Ask the server to do something the tile is set up to do (below). Resolves with the server's answer, rejects with its error |

`tap(e, el)` and `submit(e, el, form)` are called for taps and form submits in the tile, except while the dashboard is being edited or shown as a preview in Controls. The default action of a submit is already stopped.

## Words in other languages

The dashboard can be set to another language (see [languages](languages.md)). Write a tile's words in English and pass the ones it shows through `this.t()`. Give the tile its own translations in a `lang` block, so it works in that language without a change to Countertop's own word lists:

```js
Tile("tempo", {
  title:"Tempo",
  lang:{fr:{"Today's color":"Couleur du jour", "{n} days left":"{n} jours restants"}},
  render(el){ el.textContent = this.t("{n} days left", {n:12}); }
});
```

- `this.t(text, values)` gives the tile's own translation, then Countertop's (`tools/lang/<code>.json`), then the English. `{name}` placeholders are filled from `values`.
- The tile's default name (`title`) is translated the same way.
- Dates, times and numbers from `toLocaleDateString([], …)`, `toLocaleTimeString([], …)`, `toLocaleString()` and `Intl.DateTimeFormat([], …)` already follow the chosen language. `this.locale` is the locale in use (`undefined` means the device's own).
- Settings labels in Controls are not translated yet.

## Saved data: `this.store`

A tile that needs to remember something (a list, a tally, whose turn it is) keeps it in its store. Each tile on the dashboard has its own store, so a second tile of the same kind starts empty and never touches the first one's data. The server keeps it in `tiles/<tile id>.json` in the data folder.

```js
const d = this.store.get();                        // the data, {} when there's none yet
this.store.set("day", "2026-11-21");               // set a value (null removes it)
this.store.push("items", {text:"Walk the dog"});   // add to a list; the item gets an id
this.store.update("items", id, {done:true});       // change one item
this.store.remove("items", id);                    // delete one item
this.store.updateAll("items", {done:false});       // change every item
this.store.removeWhere("items", {done:true});      // delete every item that matches
this.store.change([op, op, …], unless);            // several at once, all or nothing
```

- Changes show on the screen at once and are saved by the server one at a time, so two screens (or a screen and a phone) changing the same tile don't undo each other. Other screens pick up changes within 15 seconds.
- `change(ops, unless)` skips the whole change when the data already has the values in `unless`. Use it for once-a-day work that every screen might try, like clearing yesterday's ticks: `change([…, {op:"set", key:"day", value:today}], {day:today})`.
- `this.store.ready` is false until the first load; draw a "Loading…" state until then.
- Nothing is saved while the dashboard is being edited, in a Controls preview, in the Library, or while a layout is being tried.
- Limits: 256 KB per tile, 500 items per list, plain JSON values.

Stored data is not a setting. Controls doesn't save it, it's never part of a shared layout, and it's backed up with the settings (every 15 minutes, newest 12 kept). When a tile is removed, its data moves to `tiles/.trash` for 30 days, so undoing the removal brings it back.

## Actions: `this.act`

Some things only the server can do, like switching a light in Home Assistant. A tile asks with `this.act`, and the server looks the tile up in the saved settings and checks the request against that tile's own settings. A tile can only do what it's set up to do, and nothing happens while editing or previewing.

| Action | Args | Who can use it |
| --- | --- | --- |
| `ha.call` | `{entity, action, data, confirm}` | Home and Sensor tiles, for the things they show. Locks, alarms and garage doors need the tile's **Allow locks, garage doors and alarms**, and with **Two taps** the first answer is `{confirm, seconds}`: send the same action again with that `confirm` token to do it |
| `tile.control` | `{control, confirm}` | Sent by the dashboard, never by tile code, when someone taps one of a community control tile's buttons (below). Only `control` and `confirm` are read |

New actions go in `TILE_ACTIONS` on the server.

## Server routes

Tiles normally use `this.store`. The routes behind it:

| Route | What it does |
| --- | --- |
| `GET /tile-data?since=<rev>` | `{rev, tiles:{<tile id>: data}}` for every tile on the saved dashboard changed after `rev` (all of them for `0`) |
| `POST /tile-data/<tile id>` | One operation, or `{ops:[…], unless:{…}}`. Answers `{rev, data}`. Refused (404) for a tile that isn't on the saved dashboard |
| `POST /tile-act/<tile id>` | `{action, args}`. Refused (404) for a tile that isn't on the saved dashboard |
| `GET /tile-fetch?type=<tile type>&url=<address>&maxAge=<seconds>` | The address, read by the server for a site that kind of tile lists in `hosts` (below) |

## Web addresses: `hosts`

A tile never reaches the internet by itself for an `https://` address: the server reads it, and only when the address is on a site the tile lists in `hosts`. The server refuses anything else:

- plain `http://`, another port, a name and password in the address, or a numeric address instead of a name;
- a name that points to the home network or the computer itself (private, loopback, link-local, carrier-grade NAT, multicast and reserved addresses, and IPv6 local, unique-local and IPv4-in-IPv6 forms). The name is looked up once and the server connects to exactly the address it checked;
- more than 3 redirects, or a redirect to anywhere the first address couldn't go;
- answers over 1 MB, slower than 10 seconds, or that aren't text or data.

Answers are kept for `maxAge` seconds (at least 30), failures for 30 seconds.

## Community tiles

A community tile is the same `Tile("<id>", {...})` code, run in a sandboxed frame of its own instead of in the page. It gets the same `this`, answered by the dashboard over messages, and nothing else: no network of its own, no access to the page around it, and no other tile's data. Only what it declares in its tile file:

```json
{
  "countertop": "tile", "id": "moon-facts", "version": 1, "name": "Moon facts", "author": "someone",
  "description": "A fact about the moon.", "size": [12, 8, 8, 6],
  "uses": ["store", "fetch"], "feeds": ["wx"], "hosts": ["api.example.com"], "taps": true, "every": 60,
  "settings": {"label": {"type": "text", "label": "Label", "default": "Taps"}},
  "code": "Tile(\"moon-facts\", { render(el){ … } });"
}
```

- `feeds` lists the shared data the tile reads with `this.feed`, `this.events` and `this.sources`; anything else comes back empty. `this.events()` gives each event a real `date`, as in the page.
- **Personal data or the internet, never both.** A tile whose `feeds` include `events`, `notes`, `photos` or `sales` gets no `hosts`, whatever its file says. Even so, these tiles are reviewed and contained, not sealed: a frame can still send one request by loading another page, and the dashboard removes a frame that does.
- `taps: true` lets taps and form submits reach `tap` and `submit`; never while the screen is being edited or previewed.
- `has()` and `urgent()` are asked inside the frame after every draw and every change, and the box remembers the answer.
- `this.act` is refused: a community tile can't send actions. A tile that works things in the house is a control tile (below).
- Frames can't hold frames, objects or embeds, and WebRTC is removed before the tile's code runs.
- A screen runs at most 6 community tiles at once, only for the page that's showing. A 7th waits, and its box says why.
- While a community tile shows, the screen checks in every 5 seconds. An endless loop in a tile freezes the whole screen on the Echo, so when the server hears nothing for 30 seconds, or the screen restarts 3 times in 10 minutes with community tiles on it, it turns on safe mode: every community tile stays off until it's switched back on in Controls → Status.

The server reads community tiles from `community/tiles/<id>.json` in the data folder. The id can't be a built-in tile's, and the code is at most 64 KB.

### From the gallery

People get community tiles from Library → Community. A gallery tile is an item of kind `tile` in the gallery's `index.json`, with the tile file above inline as `item`, the id `tiles/<tile id>`, and optionally a screenshot at `shot` (`items/tiles/<tile id>.png`). Countertop leaves out any tile that doesn't check out, or reads personal data and also asks for sites.

- **Before Download** the tile's page lists everything it can do: the data it sees, the sites it reads, its API keys, the devices it has buttons for and what they do, and whether it responds to taps. Tiles that see personal data or the home's devices also say "Reviewed and contained, not sealed".
- **Download** sends the list the person saw. The server reads the tile from the gallery itself and refuses if it can now do anything that wasn't on the list. It saves the tile with a note of where it came from: `"gallery": {"id", "v", "by", "perms"}`.
- **Updates** never happen by themselves. Community shows Update when the gallery has a newer version, and a version that can do more marks what's new and asks again. Doing less never asks.
- **Remove** takes the tile out of every page and drops its API keys.
- **Take-downs.** While a tile from the gallery is installed, the server reads `index.json` once a day (an hour later after a failure) and sends nothing about the install. A tile in its `revoked` list stops: its frame isn't served, its box says it was taken down, and Status says so. It runs again if the gallery lists it again.
- **Shared layouts** name a gallery tile and its version (`"from": {"id", "v"}`), never its code. A Countertop without the tile offers it from Community, or leaves its box out.

Test galleries are in `tests/fixtures/community-tiles/gallery/`. Point Countertop at one with `COUNTERTOP_GALLERY_URL`.

### Control tiles

A community tile can work lights, switches, locks and other things in Home Assistant, but its code never sends an action. It declares what it works, and the dashboard draws the buttons itself, below the tile's frame:

```json
{
  "devices": {"light": {"label": "Porch light", "domains": ["light", "switch"]},
              "lock": {"label": "Front door lock", "domains": ["lock"]}},
  "controls": [{"id": "on", "device": "light", "action": "turn_on"},
               {"id": "dim", "device": "light", "action": "turn_on", "data": {"brightness_pct": 30}},
               {"id": "unlock", "device": "lock", "action": "unlock"}]
}
```

- `devices` names up to 8 slots, each with the Home Assistant kinds it accepts. The person picks the real device for each slot in the tile's settings on the dashboard; that choice is the tile's grant, saved with that one tile.
- `controls` lists up to 12 buttons. Each works one slot with one action every kind in the slot supports, plus optional fixed `data` (simple values Home Assistant takes, never an alarm `code`). Nothing else is ever sent.
- The dashboard labels each button from its action and the picked device's own name, not from the tile. A tap counts only when it's a real one, never while editing or previewing, and only one at a time.
- The server checks every tap against the saved tile: the button must be in the tile file, its slot must be granted with a device of the right kind, and safe mode must be off.
- Locks, alarms and garage doors, gates and doors also need the tile's **Allow locks, garage doors and alarms**, and always ask first: the dashboard covers the tile with "Unlock Front door?" and needs a second real tap.
- `this.devices()` in the frame gives the state of each picked device by slot (`null` for a slot not picked yet), so the tile can show what's on or locked. The frame never sees which devices were picked.
- The state of the house is personal data, so a control tile gets no `hosts`.

The settings the dashboard adds for this start with `@` (`@src`, `@secure`, `@<slot>`). A tile's own settings can't use those names, and they're never shared in a layout. To try one without real devices, run the stand-in Home Assistant in `tests/fake_ha.py`.

### API keys

A community tile that reads a site needing a key asks for it with a `secret` setting. The server keeps the key and adds it to the tile's requests; the tile's code never sees it.

```json
"settings": {
  "key": {"type": "secret", "label": "API key", "help": "From your account page on example.com",
          "host": "api.example.com", "header": "X-Api-Key"}
}
```

- `host` is the one site the key is sent to: one of the tile's `hosts`, written out in full (no `*.`).
- `header` sends it in that request header, after an optional `prefix` like `"Bearer "`. Or use `"query": "appid"` to add it to the address as `appid=<key>`, in place of any `appid` the tile wrote there. Headers the server sets itself (like `Host`, `Cookie` or `User-Agent`) can't be used.
- At most 3 keys per tile. A tile that reads personal data has no sites, so it can't have keys.
- The person types the key in the tile's settings and taps **Save key**. It's saved on the server in `tile-keys.json` in the data folder, never in the settings, so it's never part of a shared layout, a settings backup or Diagnostics. Every copy of the tile on the screens uses the same key.
- In the frame, `this.s.key` is `true` when a key is saved and `false` when not, so the tile can ask for one. The key itself never reaches any page.
- `/tile-fetch` adds the key only to requests to exactly `host`. A redirect to another site never carries it, and is refused if its address holds the key. Wherever the site's answer repeats the key, it's blanked out (`********`) before the tile gets it.
- If an update to the tile sends a key to another site or in another way, the saved key isn't used until the person types it again.

### Web pictures and `fetch()` in a frame

A community tile's frame has no network, but two ordinary ways of reading a site still work for the sites in its `hosts`:

- `fetch("https://…")` (GET or HEAD only) is answered by the server through `/tile-fetch`, like `this.fetch`, and resolves to a `Response`. Anything else is refused with a `TypeError`.
- An `<img>` whose address is on one of its sites is shown from a copy the server read (PNG, JPEG, GIF or WebP only, never SVG), whether it's in the HTML, set with `.src` or with `setAttribute`.

`this.reloadIn(seconds)` (at least 55) asks the dashboard to start the tile over in a fresh frame, for code that reads everything once when it loads.

## Tile Studio

Controls → Library → Make → **Tile Studio** opens Tile Studio, where anyone can write a tile without a code editor or a gallery. It's the same tile file as a community tile, with a form for its name, size, settings, sites, devices and buttons, and a box for its code. A preview beside it runs the tile sealed off like any community tile, with made-up data or the screen's own, at its small, usual or big size, and lists what went wrong inside (errors, refused requests and pictures that couldn't be read). **Let AI fill it in** sits at the top: describe the tile, **Copy for chat** writes a request that lists everything the form can set, this API and the reply's shape (one code block with the settings, a -----CODE----- line and the code; two blocks or only code also work), and pasting the answer into the second box and pressing **Fill in the form** sets every field. The reply is checked like typing: unknown data, addresses, API keys and sites for a tile that reads personal data are left out, and nothing is saved or turned on until you press Save. Each fill adds a **version** (v1 is the form before the first fill, up to 5 are kept) in a row of chips under the preview. Pick one and its form, notes and preview load; **Save** keeps only the version shown and lets the rest go.

**Change it** sits under the preview once a tile has code. **Point at something**, then tap a part of the preview (the light, the reason line): a box asks what should change there, with quick phrases like Bigger or Move up. Each note leaves a numbered pin on that part (8 at most), and one more box takes a note about the whole tile. **Copy change request** writes a request with the tile as it is, each note tied to its part (its tags and classes, its place in the tile, its text size and, with made-up data, its words) and a reminder to send back the whole tile. Paste the answer into box 2 as before; the answer becomes a new version with no notes, and the version it came from keeps its notes. With your own data showing, the request says where each part is, never what it says.

**Size check.** The preview also draws the tile at its smallest size out of sight, and the problems list says when words or shapes run past the tile's edge or sit on top of each other, for example "At Smallest: “Walk the dog?” overlaps a shape". It looks only at the made-up data, so it can miss problems that real data would cause, and it can flag harmless overlaps such as words over a picture. The note under the size buttons shows the tile's size in pixels, and **Copy for chat** and **Copy change request** tell the chat to hide secondary lines at the smallest size and list any problems the check found.

Picking is part of the sandbox, in two messages. The Studio's preview page sends the tile's frame `pick` (on or off, whether words may be sent, and the pins, each only a number and a place in the tile like `:scope>div:nth-child(1)>span:nth-child(2)`), and only when Controls asked for it: tile code can't send it, because the frame listens only to the dashboard page, and the dashboard only sends it on a Studio preview. While it's on, the frame catches taps before the tile's code sees them, outlines the part, and answers one `picked` message when a part is tapped. The dashboard accepts `picked` only from that frame, only while picking is on, and cuts every field down (short names, a handful of class names, positions as percentages, no words unless made-up data is showing) before Controls sees it. Pins are drawn by the frame's runtime over the tile and carry no note text.

- Tiles made here are saved in `mytiles/<id>.json` in the data folder, with ids that start with `my-`. Gallery and other community tiles can't use that prefix, so the two never meet. Each save adds one to the tile's version.
- **Download file** and **Copy as text** give a tile file without the `my-`, ready to import on another Countertop or submit to the gallery. **Submit to the gallery** opens the gallery's submission form with the tile filled in (or copies it, when it's too big for an address).
- A tile file imported here, and a Studio tile that arrives in a shared layout, gets a new `my-` id and doesn't run until the person reads its code and taps **Let it run**.
- A Studio tile counts as a community tile everywhere else: in the 6-frame limit, safe mode, settings, API keys and control-tile grants.

### What happened to Your own tile

Your own tile (HTML in a frame of its own) is now Tile Studio. When Countertop updates, it checks each Your own tile:

- One whose page works sealed off becomes a Studio tile in every box that had it. Its HTML is drawn into the tile, its inline `onclick` and other handlers keep working, and the https:// sites it reads become its `hosts`. The original is kept, and **Restore** puts it back.
- One that can't move (it reads devices on the home network or plain http:// addresses, loads scripts or styles from the web, sends data, opens other pages, builds addresses that can't be checked, and so on) stays as it is and keeps working. Its settings and Controls → Library → Tiles say why, with **Convert** to make it a Studio tile anyway (the parts named stop working, and Restore puts it back).
- A shared layout's Your own tile is checked the same way once the person taps Run on it.

## Fitting a tile to its box

A box can be small, wide, tall or large, and the screen fits the tile to it: text shrinks a little, then whole lines and rows that don't fit are dropped (never half a row). Three marks tell it what matters:

- `data-keep` on the main content (a number, a value, the times). Everything else is shrunk and dropped first, and the main content is never taken out. Without a mark, only the first thing in the tile is protected, which is usually just the title.
- `data-deco` on a decoration that bleeds past the tile (a blurred backdrop). It doesn't count when working out whether the tile fits.
- `.mini` on the tile when a tile without a card (clock, weather) is too small for its normal layout. Style it to show less, and the fitter shrinks that instead of the normal layout.

A tile with a card also gets `data-room` (`wide`, `tall` and/or `big`) and `--room` (its area as a multiple of its usual area), so its CSS can show more when there is room. Text inside an element that hides its own overflow is cut at the last whole line with "…".
