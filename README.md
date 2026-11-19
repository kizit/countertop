<h1 align="center">Countertop</h1>

<p align="center">
  <img src="docs/screenshots/overview.gif" alt="Countertop on an Echo Show 15, with autumn leaves and sun rays moving over the dashboard" width="100%" />
</p>

<h2 align="center">Turn the Echo Show on your kitchen wall into the family screen you actually wanted.<br />
No ads, no rotating promos, just your day.</h2>

<p align="center">
  A small Python server on your own computer feeds a full-screen dashboard to the <b>Silk browser on an Echo Show 15</b>:
  <b>your calendars</b>, <b>the weather</b>, <b>the grocery list</b>, <b>what's on sale this week</b>, your team's next match and a dozen more tiles.
  You lay it out by dragging tiles around on the screen itself. No account, no cloud, no API keys.
</p>

<p align="center">
  <img alt="Runs on" src="https://img.shields.io/badge/runs%20on-macOS%20%7C%20Linux%20%7C%20Docker-555" />
  <img alt="Python" src="https://img.shields.io/badge/python-3%20stdlib%20only-3776AB" />
  <img alt="Device" src="https://img.shields.io/badge/screen-Echo%20Show%2015%20(1920%C3%971080)-00CAFF" />
  <img alt="API keys" src="https://img.shields.io/badge/API%20keys-none-success" />
  <img alt="Telemetry" src="https://img.shields.io/badge/telemetry-none-success" />
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue" /></a>
</p>

<p align="center">
  <a href="#why-it-exists">Why it exists</a> ·
  <a href="#whats-on-the-screen">What's on the screen</a> ·
  <a href="#make-it-yours">Make it yours</a> ·
  <a href="#controls-from-any-computer">Controls</a> ·
  <a href="#install-in-ten-minutes">Install</a> ·
  <a href="#things-to-know-first">Things to know first</a> ·
  <a href="#questions-youre-about-to-ask">FAQ</a>
</p>

> Every screenshot in this README uses made-up demo data (a fictional family in Lakewood, CO, a fictional soccer team and fictional stores). See [Screenshots and demo data](#screenshots-and-demo-data).

---

## Why it exists

The Echo Show 15 is a great kitchen screen with a bad home screen: it rotates ads, "try saying…" cards and shopping prompts. You can't replace that home screen, but you *can* keep a web page in front of it. This project is that page, plus everything it takes to keep it there all day.

| What the family sees | What you stop fiddling with |
| :--- | :--- |
| **The day at a glance.** Time, weather, today's events and the week ahead, readable from across the room. | **Silk timing out.** A keep-alive shell holds full screen and stops the Echo drifting back to the home screen. |
| **The list on the wall.** Add milk from your phone and it's on the screen a few seconds later. | **Reloading the device.** Change a setting and the screen refreshes itself; it also recovers on its own if a page stalls. |
| **Dinner ideas and deals.** A recipe idea, what's in season, and which things you usually buy are on sale this week. | **Juggling apps and keys.** Weather, radar, sports and more come from free public sources. Nothing to sign up for. |
| **A calm screen at night.** A dim clock with tomorrow's first event takes over at bedtime. | **Hand-editing config.** Everything is set from a Controls page on your computer or right on the touch screen. |

---

## What's on the screen

The main page is a grid of **tiles**. A box on the grid can hold one tile or several that **take turns**, and a tile can **take over** its box when something urgent happens (rain on the way, a match about to start). Swipe sideways for more pages.

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="docs/screenshots/month.png"><img src="docs/screenshots/month.png" alt="Month page" width="100%" /></a>
      <p align="center"><sub><b>Month page:</b> every calendar in its own color, sports fixtures, holidays and each day's forecast.</sub></p>
    </td>
    <td width="50%" valign="top">
      <a href="docs/screenshots/deals.png"><img src="docs/screenshots/deals.png" alt="On sale this week" width="100%" /></a>
      <p align="center"><sub><b>On sale this week:</b> weekly-ad deals on the things <i>you</i> usually buy, with what you normally pay.</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="docs/screenshots/recipe.png"><img src="docs/screenshots/recipe.png" alt="Recipe view" width="100%" /></a>
      <p align="center"><sub><b>Dinner idea:</b> tap the tile for ingredients and steps, sized to read while you cook.</sub></p>
    </td>
    <td width="50%" valign="top">
      <a href="docs/screenshots/night.png"><img src="docs/screenshots/night.png" alt="Night clock" width="100%" /></a>
      <p align="center"><sub><b>Night page:</b> a dim clock, the moon and tomorrow's first event. It drifts a few pixels each minute.</sub></p>
    </td>
  </tr>
</table>

### The tile library

<p align="center">
  <a href="docs/screenshots/tile-gallery.png"><img src="docs/screenshots/tile-gallery.png" alt="A selection of tiles" width="100%" /></a>
  <br /><sub><b>A few of the 30+ tiles:</b> agenda, 8-day forecast, countdowns, next event, stocks, sun &amp; moon, your team, world clocks, planes overhead, NASA's picture of the day, dad jokes and "on this day".</sub>
</p>

- **Time and weather:** clock (seven styles or your own design), current weather, hourly strip, 10-day forecast, a "next hours" chart with your events marked on it, rain radar that takes over when rain is close, sun &amp; moon.
- **Calendar:** week strip, month view, agenda, next event, today's timeline, countdowns to the dates you care about. Birthdays get confetti.
- **Kitchen:** grocery list (add items from any phone at `/list`), dinner ideas with full recipes, what's in season, weekly deals.
- **Family and fun:** your sports team's fixtures and results, photo frame from a shared album, live cams, dad jokes, kitchen tips, "on this day".
- **Out the window:** planes overhead (with type and altitude), the space station's position, stocks, world clocks.
- **Your own:** a note, a picture from a link, or a custom tile.

<p align="center">
  <a href="docs/screenshots/phone-list.png"><img src="docs/screenshots/phone-list.png" alt="Phone list page" width="260" /></a>
  <br /><sub><b>The phone page:</b> open <code>/list</code> on any phone on your Wi-Fi to add to the grocery list. No app to install.</sub>
</p>

---

## Make it yours

Press and hold anywhere on the Echo (or click **Edit on screen** in Controls) and the dashboard becomes its own editor.

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="docs/screenshots/editor.png"><img src="docs/screenshots/editor.png" alt="On-screen editor" width="100%" /></a>
      <p align="center"><sub><b>Edit on screen:</b> drag and resize boxes, switch pages, and change a tile's settings in the side panel. Undo, redo, cancel.</sub></p>
    </td>
    <td width="50%" valign="top">
      <a href="docs/screenshots/tile-store.png"><img src="docs/screenshots/tile-store.png" alt="Add a tile" width="100%" /></a>
      <p align="center"><sub><b>Add a tile:</b> pick from the library by category; tiles in the same box take turns.</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="docs/screenshots/designer.png"><img src="docs/screenshots/designer.png" alt="Tile designer" width="100%" /></a>
      <p align="center"><sub><b>Tile designer:</b> start from a style, then drag, resize and recolor each part of the clock or weather tile.</sub></p>
    </td>
    <td width="50%" valign="top">
      <a href="docs/screenshots/look-glass.png"><img src="docs/screenshots/look-glass.png" alt="A different look" width="100%" /></a>
      <p align="center"><sub><b>Looks:</b> a sky that follows the sun, see-through tiles, light or dark, and text size. Schedule looks by time or date.</sub></p>
    </td>
  </tr>
</table>

- **Effects that match the moment:** rain, snow, fog and clouds when the weather outside matches; falling leaves in autumn; seasonal and holiday touches. 25 effects, each one on, off or scheduled.
- **No scrolling, ever:** every tile fits its box. Text shrinks a little, then whole rows drop, rather than anything getting cut off mid-word.
- **Pages:** add pages from a starting layout, choose how long before the screen swipes back to the main page, and give the night page its own tiles.

---

## Controls from any computer

Open `http://<server>:8090/control` on a laptop. You get a live, full-size preview of the Echo screen next to every setting.

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="docs/screenshots/controls.png"><img src="docs/screenshots/controls.png" alt="Controls" width="100%" /></a>
      <p align="center"><sub><b>Controls:</b> set up sources once (calendars, lists, teams, albums, cams, stores) and any tile can use them.</sub></p>
    </td>
    <td width="50%" valign="top">
      <a href="docs/screenshots/controls-location.png"><img src="docs/screenshots/controls-location.png" alt="Location and units" width="100%" /></a>
      <p align="center"><sub><b>Location &amp; units:</b> search for a place by name; pick °F/°C, 12/24-hour time and date format.</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="docs/screenshots/controls-looks.png"><img src="docs/screenshots/controls-looks.png" alt="Looks" width="100%" /></a>
      <p align="center"><sub><b>Looks and schedule:</b> an everyday look, plus others that switch in by time of day or date.</sub></p>
    </td>
    <td width="50%" valign="top">
      <a href="docs/screenshots/controls-effects.png"><img src="docs/screenshots/controls-effects.png" alt="Effects" width="100%" /></a>
      <p align="center"><sub><b>Effects library:</b> live previews of every effect, with when it plays and how much.</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="docs/screenshots/controls-night.png"><img src="docs/screenshots/controls-night.png" alt="Night page settings" width="100%" /></a>
      <p align="center"><sub><b>Night page:</b> when it starts, how dark it gets, and burn-in protection.</sub></p>
    </td>
    <td width="50%" valign="top">
      <a href="docs/screenshots/controls-newpage.png"><img src="docs/screenshots/controls-newpage.png" alt="Add a page" width="100%" /></a>
      <p align="center"><sub><b>Add a page:</b> start from a layout, then fill the boxes on screen.</sub></p>
    </td>
  </tr>
</table>

---

## Under the hood

```
 ┌──────────────────────────── your LAN ─────────────────────────────┐
 │                                                                   │
 │  Echo Show 15 (Silk)            Server (Mac / Linux box)          │
 │  ┌──────────────────┐   HTTP   ┌──────────────────────────────┐   │
 │  │ /dash  shell     │◀────────▶│ tools/countertop.py          │   │
 │  │  └ /dash/content │          │  · serves pages + tiles      │   │
 │  │     (dashboard)  │          │  · fetches ICS calendars     │──────▶ Open-Meteo, RainViewer,
 │  └──────────────────┘          │  · list, deals, sports, ...  │   │   ESPN / MLS, Flipp, NASA,
 │  Phone   ─ /list               │  · work/  = your settings    │   │   adsb.lol, Wikipedia ...
 │  Laptop  ─ /control            └──────────────────────────────┘   │
 └───────────────────────────────────────────────────────────────────┘
```

* **One Python file, standard library only.** `tools/countertop.py` is the whole server. No pip install, no database; settings live as JSON in `work/`.
* **Tiles are plain JS files.** Each tile type is one file in `tools/tiles/`, served together at `/tiles.js`. A tile declares its size, settings and data feeds, and the editor builds its settings form from that.
* **A shell that never lets go.** `/dash` is a thin page that owns full screen, wake lock and a silent-audio keep-alive, and hosts the dashboard in an iframe. It reloads the dashboard when files or settings change, once a night, or if it stops reporting in.
* **Secrets stay on the server.** Calendar URLs are write-only: the browser never sees them. `work/sources.json` is saved with owner-only permissions.
* **Built for one device.** Layout is a 48×32 grid at 1920×1080 (the Echo Show 15 in full screen). It runs in any modern browser, which is how Controls shows its preview.

---

## Install in ten minutes

### 1. Run the server

You need a computer that stays on and is on the same network as the Echo: a Mac mini, a Linux box, a NAS. Python 3 is the only requirement.

```sh
git clone https://github.com/kizit/countertop.git
cd countertop
python3 tools/countertop.py --port 8090
```

It prints the addresses to use, e.g. `http://192.168.1.20:8090/dash` for the Echo and `/control` for setup. To keep it running after you log out:

```sh
nohup python3 tools/countertop.py --port 8090 > work/server.log 2>&1 &
```

> **Using Docker or Unraid?** See the [Docker and Unraid installation guide](docs/install-docker-unraid.md) for the prebuilt image, persistent storage and manual Unraid setup.

### 2. Point the Echo at it

1. Say **"Alexa, open Silk."**
2. Go to `http://<server-ip>:8090/dash` and bookmark it.
3. **Tap the screen once.** That arms the keep-alive and switches to full screen.

### 3. Set it up from your computer

Open `http://<server-ip>:8090/control` and work down the **Setup** list:

1. **Location & units:** search for your town.
2. **Calendars:** paste an ICS link. For iCloud: iPhone → Calendar → Calendars → (i) → *Public Calendar* → *Share Link*. Google: *Settings → your calendar → Secret address in iCal format*.
3. **Lists:** keep the grocery list on the dashboard (add from `/list` on your phone) or mirror an Apple Reminders list.
4. **Sports teams, Photo albums, Live cams, Store deals:** optional.

Then press **Edit dashboard on screen** to arrange tiles.

### Optional: Mac menu bar app

`tools/menubar/` has a small menu bar app to start, stop and restart the server and open Controls. Build it with `tools/menubar/build.sh` (needs the Xcode command line tools).

---

## Things to know first

- **It's built for the Echo Show 15.** The layout assumes 1920×1080. Other Echo models with Silk may work but are untested. Any wall tablet or old monitor with a browser works too.
- **Silk is still Silk.** This doesn't replace Amazon's home screen; it keeps a page in front of it. After a power cut or update you may need to say "Alexa, open Silk" again.
- **Mac-only features:**
  1. **Apple Reminders list sync** uses `osascript`, so it only works when the server runs on a Mac. On Linux/Docker, use the built-in list (`/list`) instead. Other ways to sync a list from a phone (an iPhone Shortcut push, a small Mac helper) are planned.
  2. **The menu bar app** is macOS only.
- **Weekly deals need your purchase history.** The deals tile learns what you usually buy from your purchase history and your list history. Drop a CSV with the columns `date,store,brand,item,size,price` (optionally `regular`) into `work/purchases/`; there's also a ready-made importer for one grocery chain's receipt pages. It then searches public weekly ads by ZIP code for those items. Without an export it only matches items on your list.
- **Free public data sources** (Open-Meteo, RainViewer, ESPN, Flipp, NASA, adsb.lol, Wikipedia and others) can change or rate-limit without notice.
- **No login on your LAN.** Anyone on your network can open Controls. Don't expose port 8090 to the internet.

---

## Questions you're about to ask

<details>
<summary><b>Does it need an Amazon developer account, ADB or sideloading?</b></summary>

No. The Echo Show 15 has no ADB and can't sideload apps. Everything runs in the stock Silk browser.
</details>

<details>
<summary><b>Will Alexa still work?</b></summary>

Yes, voice commands work as usual. If Alexa takes over the screen, the dashboard may need "Alexa, open Silk" to come back.
</details>

<details>
<summary><b>Where is my data stored?</b></summary>

On your server, in `work/`: layout and settings (`dashboard.json`), calendar and other source links (`sources.json`), the shared list (`notes.json`) and any purchase exports. Nothing is sent anywhere except the requests to the public data sources above.
</details>

<details>
<summary><b>Can I write my own tile?</b></summary>

Yes. Copy a small one such as `tools/tiles/note.js`, change the type name, and it shows up in the tile library on the next reload. The `Tile(...)` call declares size, settings and feeds; `render()` draws it.
</details>

<details>
<summary><b>Can I run it on Unraid or a Raspberry Pi?</b></summary>

Yes. It's one Python file with no dependencies. Everything works except Apple Reminders sync and the menu bar app.
</details>

---

## Screenshots and demo data

The screenshots are taken from the real app with a fake-data fixture, so no real calendar, list, location, team or purchase history is shown. To regenerate them:

```sh
demo/screenshots.sh        # needs Node + Playwright
```

It copies the app to a temp folder with the demo settings in `demo/work/`, starts the server there, and answers every data feed from `demo/fixtures/demo-data.js`. Your own `work/` folder is never read.

---

## License

[MIT](LICENSE). The bundled fonts in `tools/fonts/` are under the SIL Open Font License 1.1.

## Credits

Weather and air quality by [Open-Meteo](https://open-meteo.com). Radar by [RainViewer](https://www.rainviewer.com). Maps by [CARTO](https://carto.com). Weekly ads via Flipp. Sports data from ESPN and MLS. Planes from [adsb.lol](https://adsb.lol). Space photos from NASA APOD. "On this day" from Wikipedia. Jokes from icanhazdadjoke.

Not affiliated with Amazon. Echo, Echo Show, Alexa and Silk are trademarks of Amazon.com, Inc.
