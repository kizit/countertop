# How Countertop fits together

This page is for people changing Countertop's code. It explains the moving parts, where data lives, and the rules every change follows. To write a tile, you mostly need [Writing a tile](tile-api.md).

## The big picture

```
  Echo Show / tablet / browser            Phone or computer
  ┌──────────────────────────┐            ┌──────────────────┐
  │ /dash  (tools/dash/)     │            │ /control (Controls)
  │   tiles from /tiles.js   │            │ /list (phone list)│
  └────────────┬─────────────┘            └─────────┬────────┘
               │ HTTP on your home network          │
               ▼                                    ▼
        ┌───────────────────────────────────────────────┐
        │ tools/countertop.py  (Python standard library)│
        │  • serves the pages and tiles                 │
        │  • reads calendars, lists, weather, feeds     │
        │  • saves settings and tile data               │
        └──────────────────────┬────────────────────────┘
                               ▼
                     data folder (work/ by default)
```

Countertop is one small web server and a few pages. The server runs on a computer in the home (a Mac, a Linux box, or a Docker or Unraid server). Screens are plain browsers that open `/dash`. There is no cloud service, no account, and nothing to compile.

## The server

The server starts from `tools/countertop.py`, which holds `VERSION` and loads the code in `tools/server/`. It uses only the Python standard library (`http.server`, threads, `json`, `urllib`) and runs on Python 3.9 or newer. `python-dateutil` is used for repeating calendar events when it's installed, with a built-in fallback when it isn't.

It does four jobs:

1. **Serves the pages.** `/dash`, `/control`, `/list`, and `/tiles.js`, which is every file in `tools/tiles/` joined together.
2. **Gathers data.** Calendars (ICS links), grocery and to-do lists, weather, Home Assistant, recipes and sales, and the feeds some tiles use (sports, stocks, planes, space and so on). Results are cached so screens can ask often without hitting outside services every time.
3. **Saves settings and data.** See [Where data lives](#where-data-lives).
4. **Reports health.** Controls → Status and the diagnostics zip, with secrets removed.

One file per area, in `tools/server/`:

| File | What it holds |
| --- | --- |
| `app.py` | The HTTP handler (every route) and `main()` |
| `core.py` | Paths (`WORK`), shared state, logging, small helpers |
| `config.py` | Reading and saving `dashboard.json`, backups, and `CONFIG_SCHEMA` |
| `upgrades.py` | `CONFIG_UPGRADES`: turning settings saved by older versions into the current shape |
| `sources.py` | Setup sources: calendars, lists, teams, albums, cams, Home Assistant, recipes |
| `lists.py` | The grocery list and note, Reminders, lists from a web address or another app |
| `homeassistant.py` | Home Assistant states and controls |
| `tiledata.py` | Each tile's own saved data |
| `actions.py` | Tile actions (`TILE_ACTIONS`) and the two-tap confirmation |
| `library.py` | Previewing and trying layouts |
| `community.py` | The Community gallery's list for Library → Community. Downloads are checked again like any imported file |
| `sandbox.py` | Community tiles: reading their files, the sandboxed frame page each one runs in, and safe mode |
| `tilefetch.py` | Web addresses read for tiles (`/tile-fetch`): only https, only the sites a tile declares, never the home network |
| `tilekeys.py` | Community tiles' API keys (`POST /tile-key`): kept on the server, added by `/tile-fetch` only to the one site each is for |
| `pages.py` | Puts the dashboard and Controls pages together from their parts |
| `status.py` | Status, the update notice, diagnostics |
| `feeds/` | Data for built-in tiles: calendar, sports, sky (radar, space, ISS, planes), meals, sales, cams, photos |

`tools/countertop.py` re-exports every name, so tests and scripts use `countertop.config_load()` and friends. See [Developing Countertop](development.md#where-the-servers-code-lives) for how modules import each other.

### Routes, briefly

| Route | Used by | What it does |
| --- | --- | --- |
| `GET /dash`, `/control`, `/list` | Browsers | The dashboard, Controls and phone list pages |
| `GET /tiles.js` | Dashboard, Controls | Every tile definition |
| `GET`/`POST /config` | Dashboard, Controls | The saved dashboard settings (`dashboard.json`) |
| `GET`/`POST /sources` | Controls | Calendars, lists, Home Assistant and other connections. Secrets are never sent back to the page |
| `GET /events`, `/notes`, `/sales`, `/meals`, … | Tiles | Data feeds |
| `GET /tile-data`, `POST /tile-data/<id>` | Tiles | Each tile's own saved data |
| `POST /tile-act/<id>` | Tiles | Things only the server can do, such as switching a Home Assistant light |
| `GET /tile-fetch?type=&url=` | Tiles | A web address read on a tile's behalf, for the sites that kind of tile declares in `hosts` |
| `GET /tile-frame/<id>` | Dashboard | The sandboxed page a community tile runs in, with its code at `/tile-frame/<id>/tile.js` |
| `POST /sandbox/beat`, `/sandbox/safe` | Dashboard, Controls | Check-ins while community tiles show, and the safe mode switch |
| `POST /trial` | Library | Try a layout on the screen without saving it |
| `GET /community` | Library → Community | The gallery's list of layouts, themes and effects (cached ten minutes) |
| `GET /status`, `/diagnostics`, `/version` | Controls, Docker health check | Health and support |

The route table lives in `tools/server/app.py`. This list is a summary, so check `app.py` for the full set.

## The pages

The dashboard and Controls are each a folder of plain files in `tools/`. There's no framework, no bundler and no npm packages at runtime. The server puts each page together when it's asked for it: a line `<!--#include dash/editor.js-->` in the page's `index.html` is replaced by that file, so the browser gets one page.

| Folder or file | Served at | What it is |
| --- | --- | --- |
| `dash/` | `/dash` | The dashboard: `index.html`, `style.css` and scripts for start-up and settings (`core.js`), the tile API (`tile-api.js`), community tile frames (`sandbox.js`), pages, feeds and night mode (`screen.js`), the grid (`grid.js`), on-screen editing (`editor.js`), the designer, looks, and demo data |
| `sandbox/` | `/tile-frame/<id>` | The page a community tile runs in (`frame.html`) and the runtime that gives its code `this` (`runtime.js`) |
| `control/` | `/control` | Controls: `index.html`, `style.css` and scripts for the setup guide, sources, lists, status, layout editing, looks, emoji, the Library and the preview |
| `shared/` | | Code both pages use, such as the effects library |
| `list.html` | `/list` | A phone-friendly grocery list |
| `shell.html` | | A thin wrapper for the Echo Show browser that keeps the dashboard loaded and refreshes it gently |
| `tiles/*.js` | `/tiles.js` | One file per tile |
| `lang/*.json` | | Translations, one file per language |
| `starters/*.jpg` | | Pictures of the premade dashboards shown in setup and **Add page** |

Each page is still one script, so a name defined in one file can be used in the others. Add a new file to the page's `index.html` where it should run. `node tests/check-js.js` checks every part on its own and each page put together. [Developing Countertop](development.md#where-the-pages-code-lives) lists what each file holds.

The pages must work in the Echo Show's built-in browser (Silk), which is slower and older than a desktop browser. Avoid heavy animation, very new JavaScript or CSS features, and large downloads.

## Tiles

A tile is one JavaScript file in `tools/tiles/` that calls `Tile(name, {...})`. It declares its title, size on the 48×32 grid, settings form, and a `render(el)` function. The dashboard and Controls both read the same definitions, so a new tile shows up in the picker, the Library and the editor with no other changes.

Tiles written for the tile API (`api:1`) can use `this.store` for their own saved data, `this.act` for actions the server performs (today: Home Assistant), `this.fetch` for web data, `this.feed` for data the dashboard already loads, and `this.t()` for translated text. Full details are in [Writing a tile](tile-api.md).

Community tiles run in a sandboxed frame each (`tools/sandbox/`, `tools/dash/sandbox.js`, `tools/server/sandbox.py`) with the same `this`, and can only reach the web addresses they declare, through the server. See [Community tiles](tile-api.md#community-tiles). The sandbox is a security-sensitive design: please discuss in an issue before changing it or anything that loads tile code from outside the repository. Most built-in tiles still use older globals; they move onto the tile API a few at a time.

## Where data lives

Everything the server saves is in one data folder: `work/` next to `tools/` by default, `COUNTERTOP_DATA` if set, `/app/work` in Docker, and `~/Library/Application Support/Countertop` in the Mac app.

| File | What it holds | Shared in layouts? |
| --- | --- | --- |
| `dashboard.json` | **Settings**: pages, boxes, tiles and their settings, looks | Yes, except settings marked `share:false` |
| `sources.json` | **Sources**: calendar links, lists, Home Assistant, recipe and other connections, including tokens and keys | Never |
| `tile-keys.json` | **API keys** typed into community tiles' settings | Never |
| `tiles/<tile id>.json` | **Tile data**: what a tile has saved with `this.store` | Never |
| `notes.json`, `pushed_lists.json` | Lists kept on the server, and lists sent from the Mac app or a phone shortcut | Never |
| `backups/` | Recent copies of the settings and tile data | |
| `heartbeat.log`, `server.log` | Logs (included, redacted, in diagnostics) | |

Keep these three kinds of data apart. A setting describes how the screen looks and is safe to share. A source connects to someone's accounts and holds secrets. Tile data is a household's own content. Anything personal or secret must never end up in `dashboard.json`, because that file is what layout sharing exports.

**Upgrades.** `dashboard.json` has a schema number (`CONFIG_SCHEMA` in `config.py`). When the shape of the settings changes, add a step to `CONFIG_UPGRADES` in `upgrades.py` that turns the old shape into the new one, and a test that loads an old file. The server backs up the file before upgrading it, and never overwrites a file it can't read.

## Ways Countertop is installed

| | How it runs the server | Lives in |
| --- | --- | --- |
| From a clone | `python3 tools/countertop.py` | the repository |
| Docker / Compose | `python:3.12-slim` image, port 8090, data volume `/app/work` | `docker/` |
| Unraid | The Docker image, from Community Apps | `docker/unraid/countertop.xml` |
| Mac app | A menu bar app with its own Python, which also syncs Apple Reminders | `mac/` |

The server code is the same everywhere. Code that needs to know where it runs can check `COUNTERTOP_DOCKER`. Apple Reminders sync is the only Mac-only feature, and it lives in the Mac app, which sends the list to any Countertop server. Other Mac-only features aren't accepted, so that Docker and Unraid users get everything.

## Checks and releases

`.github/workflows/checks.yml` runs on every pull request:

- Python tests on 3.9 without `python-dateutil` and on 3.13 with it.
- A syntax check of every page and tile script, and a check that translations are complete.
- Playwright: each page opens with the demo data and logs no errors, and tile data works end to end.

`container.yml` builds and smoke-tests the Docker image, and `mac-app.yml` builds the Mac app.

Releases are published by a maintainer from **Actions → Release**. The workflow gathers the notes in `changes/` into `CHANGELOG.md`, sets `VERSION`, tags the release, and publishes the Docker image and Mac app. Installed copies notice the new version within 12 hours. See [releasing](releasing.md).

## Trust and security model

Countertop is meant to run on a home network for one household.

- **Anyone on the home network can open Controls and change settings, without a password.** This is intentional: the people in the house are the users, and a kitchen screen shouldn't need a login. Don't expose Countertop to the internet, and don't add features that assume it is.
- **Requests from other websites are a separate concern.** Open access on the LAN doesn't mean a web page someone visits in a browser at home should be able to change settings or trigger actions. This is a known area to think about: it's welcome as a [private vulnerability report](../SECURITY.md) or, for a design discussion, an issue. A change here needs discussion first because it touches every route.
- **Secrets stay on the server.** Tokens and keys live in `sources.json`, and community tiles' API keys in `tile-keys.json`. Secret fields are write-only: the server never sends them back to a page, and diagnostics remove them. New code must keep them out of logs and error messages too.
- **Actions in the home need care.** Turning on a light is fine with one tap. Locks, garage doors and alarms are opt-in per tile and can require two taps, and the server, not the page, enforces both.
- **Shared layouts, themes, effects and gallery downloads are untrusted input.** Everything is checked again when it's imported or downloaded, layouts carry no secrets or personal data, and effects contain no code. Community tiles run sandboxed, get only the data they declare, and can't reach addresses on the home network.

See [SECURITY.md](../SECURITY.md) for how to report a problem.

## Design rules

Every change follows these:

1. **No new required dependencies.** Standard library Python, plain HTML, CSS and JavaScript, no build step.
2. **Python 3.9.** It's what a Mac ships with.
3. **Everywhere, not just a Mac.** Mac, Linux, Docker and Unraid get the same features.
4. **Works on the Echo Show.** Light enough for its browser.
5. **Settings live in Controls.** Every option has a control. Nobody should have to edit a file.
6. **Updates never break a dashboard.** Old settings are upgraded, not discarded, and there's a test for it.
7. **Personal data stays home.** Nothing personal or secret goes into shared layouts, logs, diagnostics, screenshots or the repository.
8. **Plain words on screen.** Short, friendly text for a household, not for a developer.
