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
- `this.act` is refused: a community tile can't send actions.
- Frames can't hold frames, objects or embeds, and WebRTC is removed before the tile's code runs.
- A screen runs at most 6 community tiles at once, only for the page that's showing. A 7th waits, and its box says why.
- While a community tile shows, the screen checks in every 5 seconds. An endless loop in a tile freezes the whole screen on the Echo, so when the server hears nothing for 30 seconds, or the screen restarts 3 times in 10 minutes with community tiles on it, it turns on safe mode: every community tile stays off until it's switched back on in Controls → Status.

The server reads community tiles from `community/tiles/<id>.json` in the data folder. The id can't be a built-in tile's, and the code is at most 64 KB.
