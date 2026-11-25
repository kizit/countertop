# Developing Countertop

New here? [CONTRIBUTING.md](../CONTRIBUTING.md) covers how to propose and submit a change. This page is the hands-on detail.

You can work on Countertop on the same computer that runs your real dashboard. Keep two copies apart:

| | Everyday copy | Development copy |
|---|---|---|
| What runs it | The Countertop app (or Docker) | A git clone of this repo |
| Port | 8090 | 8091 (or any free port) |
| Settings and lists | The app's own data folder | The clone's `work/` folder |
| Changes when | You install a release | You edit files or switch branches |

The two copies never share settings, so trying something out can't break your live home screen.

## Run the development copy

```sh
git clone https://github.com/kizit/countertop.git
cd countertop
python3 tools/countertop.py --port 8091
```

Open `http://localhost:8091/control`. The first time you do this, the setup guide walks you through the basics. To start with a copy of your real settings instead, copy the app's data folder into `work/` first. On a Mac it's `~/Library/Application Support/Countertop` (in the app menu, **Show Settings Folder**). `work/` is ignored by git, so your settings stay out of commits.

To keep development data somewhere else, set `COUNTERTOP_DATA`:

```sh
COUNTERTOP_DATA=~/countertop-dev-data python3 tools/countertop.py --port 8091
```

Press Ctrl-C to stop the server. After you change `tools/countertop.py` or anything in `tools/server/`, restart it. Changes to the pages and tiles in `tools/` take effect the next time you reload them.

## Preview without the real screen

The preview in Controls shows the dashboard as the screen will show it. To try a change on the real screen, point the device at the development copy (`http://<this computer>:8091/dash`) and point it back at port 8090 when you're done.

Select **Portrait** in Controls to preview a 1080×1920 display. To capture the wall display, tablet, calendar, night page and Controls preview with the bundled demo data, run `node demo/capture-readme.js portrait` with Playwright and Chromium installed. Set `OUT` to choose a screenshot folder.

Run `node demo/capture-starters.js` to redraw the premade dashboard pictures in `tools/starters/` that setup and **Add page** show. Pass names (for example `kitchen atmospheric`) to redraw only some of them.

Run `node demo/capture-readme.js manual-portrait` to simulate a browser that keeps reporting 1920×1080 on a vertically mounted display. It saves the setting from a separate Controls browser, checks the open dashboard at its normal address, verifies touch gestures and persistence after a reload, and captures the native landscape framebuffer for each mount.

## Work on the Mac app

`zsh mac/build.sh` builds `~/Applications/Countertop.app` from the clone, so the app runs the server from your clone. `zsh mac/package.sh` makes a downloadable build like the ones attached to releases, in `dist/`.

Only one Countertop app can run at a time, and both use port 8090. On a Mac where you also run the everyday app, `build.sh` quits it, so open your everyday app again when you're done testing.

## Where the server's code lives

`tools/countertop.py` starts the server and holds `VERSION`; everything else is in `tools/server/`, one file per area:

| File | What it holds |
| --- | --- |
| `core.py` | Paths (`WORK`), shared state, logging, small helpers |
| `app.py` | The HTTP handler (every route) and `main()` |
| `config.py`, `upgrades.py` | Reading and saving `dashboard.json`, backups, upgrading older files |
| `sources.py` | Setup sources (calendars, lists, teams, albums, cams, Home Assistant, recipes) |
| `lists.py` | The grocery list and note, Reminders, lists from a web address or another app |
| `homeassistant.py` | Home Assistant states and controls |
| `tiledata.py` | Each tile's own saved data ([Writing a tile](tile-api.md)) |
| `library.py` | Previewing and trying layouts |
| `community.py` | The Community gallery's list ([sharing](sharing-layouts.md#the-community-gallery)) |
| `pages.py` | Puts the dashboard and Controls pages together from their parts (below) |
| `status.py` | Controls > Status, update notice, diagnostics |
| `bench.py` | The `/bench` sandbox test page (below) |
| `feeds/` | Data for built-in tiles: calendar, sports, sky (radar, space, ISS, planes), stocks, meals, sales, cams, photos |

A module imports the names it needs at load time at the top, and names it only uses inside functions at the bottom, so modules can use each other without import loops. `tools/countertop.py` re-exports every name, so `countertop.config_load()` and friends still work in tests and scripts. To swap a function out in a test, use `countertop.patch_everywhere(name, value)`, which replaces it in every file that uses it.

## Where the pages' code lives

The dashboard (`/dash`) and Controls (`/control`) are each a folder of plain files. There's still no build step: the server puts each page together when it's asked for it, so the browser gets one page as before.

- `tools/dash/index.html` and `tools/control/index.html` hold the page's HTML. A line `<!--#include dash/editor.js-->` in them is replaced by that file.
- `tools/dash/`: `style.css`; `core.js` (start-up, settings, language, weather words, sky colors); `tile-api.js` (what every tile can use, see [Writing a tile](tile-api.md)); `screen.js` (pages, data feeds, the night page, the clock tick, boot); `grid.js` (boxes on the 48×32 grid); `editor.js`; `designer.js` (laying out a tile's parts); `demo.js` (made-up data for the Library's examples); `looks.js`.
- `tools/control/`: `style.css`; `core.js` (start-up and helpers); `screens.js`; `lists.js`; `status.js`; `setup-guide.js`; `edits.js`; `look.js`; `look-editor.js`; `emoji.js`; `library.js`; `preview.js`.
- `tools/shared/effects.js`: the effects library, used by both pages (full-screen on the dashboard, small previews in Controls).
- `tools/shared/themes.js`: the built-in themes, used by both pages. Each is complete and has a fixed `builtin-` id that `look.use`, schedule rules and `?theme=` can name; they are never copied into settings.

Each page is still one script, so a name defined in one file can be used in the others. Keep each file whole top-level statements, and add a new file to the page's `index.html` where it should run. `node tests/check-js.js` checks every part on its own and each page put together.

## Run the checks

Countertop needs Python 3.9 or newer, with nothing else to install. The same checks run on every pull request:

```sh
python3 -m unittest discover -s tests     # server: settings, tile data, calendars, Home Assistant, meal ideas
node tests/check-js.js                    # every script in the pages and tiles parses
node tests/check-lang.js                  # translations keep their placeholders; lists missing words
node tests/browser-check.js               # the pages open with the demo data and log no errors (needs Playwright)
node tests/tile-data-check.js            # two Daily to-do tiles keep separate lists on a real screen (needs Playwright)
node tests/sandbox-check.js              # community tiles in their frames, a hostile tile, safe mode (needs Playwright)
```

Repeating calendar events use python-dateutil when it's installed and a built-in expander when it isn't, so the calendar tests run against both. When you change how settings are stored, add a step to `CONFIG_UPGRADES` in `tools/server/upgrades.py`, bump `CONFIG_SCHEMA` in `tools/server/config.py`, and add a test with a settings file in the old shape.

## The sandbox test page

`/bench` is a page for trying sandboxed frames on a real screen. Nothing links to it. Open `http://<server-ip>:8090/bench` in Silk (or any browser), then:

- **Run 1 / Run 6 / Run 12** put that many busy frames on the page (a canvas animation, a clock and DOM updates each) for 30 seconds and measure the page's frame rate, slow frames, long tasks, memory where the browser reports it, and how quickly a tap is answered. Swipe the bar and tap during a run. Add `?secs=5` to the address for a shorter run.
- **Escape checks** loads one frame and tries to reach the server by `fetch`, a `POST /config`, an image, a prefetch link, `window.open` and top-level navigation, all of which must fail. Leaving the frame's own page for the server must work, and the page sees a second load. It also notes whether WebRTC exists and how many candidates it gathers.
- **Loop test** starts an endless loop in one frame after a 5-second countdown. The page shows a ticking clock and sends the server a beat each second, so the result shows whether the page froze, for how long, and whether it recovered. Don't run it in automated tests.

The frame is `/bench/frame`, served with the same kind of policy header a community tile's frame will use (`sandbox allow-scripts`, `connect-src 'none'`) inside `<iframe sandbox="allow-scripts">`. Results (numbers and yes/no answers only, never settings) are saved to `bench.json` in the data folder, read at `/bench/results`, and shown under Status in Controls once there are any. `tests/browser-check.js` runs the 1-frame test and the escape checks in headless Chromium.

## Your settings are backed up

The server keeps up to 12 recent copies of `dashboard.json` in the data folder's `backups/` folder, at most one every 15 minutes, plus one right before an upgrade changes the file. If `dashboard.json` can't be read, the server never writes over it: it renames it to `dashboard.broken-<time>.json`, puts the newest backup back, and says so under Status in Controls.

## Ship a change

Open a pull request against `main`, and add a one-line note under [changes/](../changes/README.md) if people will notice the change. Once it is merged, a release puts it in front of everyone, including your own everyday copy. See [releasing](releasing.md).
