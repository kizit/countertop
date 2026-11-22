# What's new in Countertop

Each version gets a section here. The newest is on top. Install a version from the [releases page](https://github.com/kizit/countertop/releases); Docker and Unraid use the `ghcr.io/kizit/countertop` image with the same tag.

## v0.6.1 (2026-11-22)

### New
- **Dashboard name.** Controls → Dashboard name changes the "Kitchen" shown in the browser tab, the screen's top bar and the shopping-list page.
- **Holidays for your country.** Controls → Language and formats → Holidays: United States, Canada, United Kingdom, Australia, France or None. The clock's countdowns, the week and month tiles, the seasonal greeting and the Thanksgiving effect follow it (for example Canadian Thanksgiving in October). French names show when the language is Français.
- **Temperature colours on the Sensor tile.** A temperature driven by a thermostat (its "Controlled by" setting) turns orange while it heats, green once it reaches the setpoint and grey when the thermostat is off; cooling is blue. Turn it off with the tile's "Colour by the thermostat" setting.

### Fixed
- **Shared photo albums.** A link that is not a shared album's Public Website link, or a network problem reaching Apple, now says what to check instead of showing a raw error.

## v0.6.0 (2026-11-22)

### New
- **Community.** Library → Community lists layouts, themes and effects other people made, from the [Countertop gallery](https://github.com/kizit/countertop-gallery). Open one to see it with your own pages, then **Download** it: nothing joins your Library until you do. Downloads can be updated when their author ships a new version, removed, and are flagged if the gallery takes them down. **Submit yours** opens the gallery's submission form.
- **Daily to-do tile.** A checklist for the day that you add to and tick off right on the screen. Each morning the ticks clear and the items stay. Every Daily to-do tile keeps its own list.
- **Adjustable entities and tap-to-refresh.** The Home and Sensor tiles now also handle number/input_number (a − / + stepper honoring min, max and step), select/input_select (tappable option chips), button/input_button (a Press button) and text inputs. Tapping a plain sensor, binary sensor, person or device tracker refreshes its state right away (homeassistant.update_entity). As before, only entities shown on a tile with control enabled can be touched.
- **Control Home Assistant from the screen.** The Home tile and the Sensor tile are no longer read-only: thermostats show − / + to change the target temperature (by 0.5°) and tappable mode chips (off / auto / heat…), lights and fans have a brightness/speed stepper next to the on/off switch, covers such as blinds have open / close / stop, media players have play/pause/next/previous and volume, and the vacuum can start, pause and return to base. Everything still only works for entities already shown on a Home or Sensor tile with control enabled. Locks, alarm panels and garage doors, gates and doors show their state, and can be changed only on tiles where **Allow locks, garage doors and alarms** is on. Turning off control on a Sensor tile is now enforced by the server too.
- **Rename entities on a tile.** The Home and Sensor tiles have a "Rename" setting: one per line-ish, `entity_id = Display name`, separated by `;` — e.g. `sensor.cap_energie_power = Linky power`. The display name replaces Home Assistant's friendly name on that tile only.
- **Setpoint controls directly under a temperature.** The Sensor tile has a new "Controlled by" setting: point a temperature sensor tile at its thermostat (e.g. sensor.salon_temperature → climate.salon) and the − / + setpoint stepper and the mode chips (off / auto / heat…) appear right under the big temperature, along with a refresh button for the sensor itself.
- **Immich photo albums.** The Photo frame tile and the Photos background can now use an album from a self-hosted Immich server as well as an iCloud Shared Album. Set it up in Setup → Photo albums: pick Immich, give the server's address, an API key from your account, and the album's name. The dashboard server fetches the album (cached 30 minutes) and hands the screen plain image links it proxies itself — the API key stays on the server, and only photos that are in the album are ever served. Works with any recent Immich: the older /albums/{id}/assets endpoint or the new v3 timeline API, whichever your server answers.
- **Landscape screen orientation.** Settings → Screen orientation has a Landscape choice. It keeps every page in landscape, even on a browser that reports a tall screen.
- **Language setting.** Choose English or French under Settings → Language and formats. The dashboard's weather, dates, times, greeting and tile names switch to French. Controls stays in English for now.
- **Library.** A full-screen Library in Controls holds your saved layouts, every premade layout and every tile type, with live examples; tap + Add on a tile to put it in an empty spot on any page and open the editor on it. A layout's page shows it with your own weather, calendars and lists before you pick it, and Try it on the screen shows it on the display for two minutes before your own layout comes back.
- **Editable lists, right where the list lives.** A list kept on this dashboard (Setup → Lists, "This dashboard") can now be filled in and ticked off in two places, no other app or account needed: on the **List tile** (type in the box and tap +, tap a line to tick it off, × to delete) and in **Controls → Lists**, right under the list's own settings, with the same items, ticks and an Add box. A new **Clear the ticks every day at 00:00** option on the list itself turns it into a daily checklist: the ticks are cleared overnight while the items stay, and an **Untick all** button does the same reset on demand. Lists kept in another app stay read-only on the dashboard as before, and the phone page at `/list` keeps editing the first dashboard list. Items are stored per list in `work/lists.json`, and items already on a dashboard list carry over when you update. A tile can also hide its Add box to show just the items — tick things off on the screen, edit the items in Controls → Lists.
- **Meal ideas.** The Dinner idea tile is now Meal ideas: it follows the time of day from breakfast to lunch, dinner and dessert, picks from a much bigger set of recipes, and says when a recipe uses something on your list or on sale. It has a diet setting, and the recipe screen can add the ingredients you need to your list. Pick where recipes come from in Setup, Recipes: TheMealDB (free, or with a supporter key) or Spoonacular with your own free key.
- **Portrait layouts.** When your screen is in portrait, the editor shows a tall page on a portrait grid, so you can arrange each page for portrait. Pages start from an automatic arrangement of the landscape layout, and the landscape layout is kept for when the screen is turned back.
- **Saved layouts and full-screen pages.** Changing Main's layout keeps the old one in Saved layouts, where you can put it back, add it as a page or delete it. Add page has a new Full-screen tab with a month calendar, the next hours, deals and a photo frame.
- **Settings backups.** Countertop keeps recent copies of your settings in the data folder's `backups` folder. If the settings file is ever damaged, it is kept aside and the last good copy is put back, instead of starting over. Status in Controls says when that happens.
- **Share a layout.** Save any layout as a small .countertop file or a share code, and open one in Library › Import a file. Calendars, lists and other sources, your own text and Home Assistant devices are left out; whoever opens it picks their own.
- **Share themes, and make your own effects.** A theme's page in the Library has **Share**, which makes a small `.countertop` file or share code. Library → Effects → **New effect** makes an effect from your own emoji: pick how they move (fall, float up, fly across or wander), their size and speed, and an optional season. Your effects can be shared the same way. **Import a file** now opens layouts, themes and effects, and shows each one before anything is added.
- **Tempo tile.** France's RTE Tempo electricity days on the dashboard: today's and tomorrow's color (blue, white, red) as big color cards, the current price per kWh and whether it's off-peak hours right now, plus the days left in the cycle for each color. It reads the Tempo sensors from Home Assistant (picked in the tile's settings), so any integration that exposes them works.
- **Tiles can save their own data.** Each tile on the dashboard now has its own small store on the server, so tiles that remember things (like the Daily to-do) never share or overwrite each other's data. It's backed up with your settings, and a removed tile's data is kept for 30 days in case you undo. Tile authors: see [Writing a tile](docs/tile-api.md).

### Changed
- **Add several tiles in a row.** In the on-screen editor, **Add a tile** now stays open after you add one, so you can fill a page in one go. The new tile is highlighted; tap any tile on the page to change its settings.
- **Locks, garage doors and alarms from the screen, only if you allow it.** Home and Sensor tiles have **Allow locks, garage doors and alarms** (off by default) and a choice of one or two taps to confirm. The server checks every tap against the tile's own settings, so a tile only reaches the things it shows.
- **A layout's colors come as a theme of their own.** Using a premade, saved or shared layout with its colors now adds them as a theme (named after the layout) and uses it, instead of writing over Everyday. Using the same layout again reuses that theme, and colors that match a theme you already have use that one. Saved layouts remember which theme they had. **Add page** and **Change layout** now open the Library to pick, with empty grids included, instead of their own galleries.
- **Themes and Effects are in the Library.** The Library now has Themes and Effects next to Layouts and Tiles, with a live preview beside them that follows the theme or effect you're looking at. The Theme and Effects rows in Controls open them there. Using, customizing and scheduling themes, and turning effects on and off, work the same as before.
- **Dashboard and Controls code split into smaller files.** The dashboard's code now lives in `tools/dash/` and Controls' in `tools/control/`, a file per area, and the effects library both use is one file in `tools/shared/`. There's still no build step: the server puts each page together when it's opened, and the pages work the same as before.
- **Tidier Pages in Controls.** Every page, Main included, opens from one list with a small picture of its layout, and you can drag pages into a new order. Add page is now the single place to find dashboards and empty grids. Tap Main to change its layout. New installs start with just Main and the night page, and Month is one tap away under Add page → Full-screen.
- **Release notes can open with a story.** Bigger releases can start with a plain-language introduction and screenshots, followed by the usual New, Changed and Fixed notes.
- **Server code split into smaller files.** The server now lives in `tools/server/`, one file per area, instead of one 3,000-line file. It starts the same way (`python3 tools/countertop.py`) and behaves the same.
- **Looks are now Themes, and Controls is easier to find your way around.** Tap a theme to see it on the preview, then press **Use this theme** to put it on the screen (with Undo), or **Customize** to change it. Customizing is a draft: the preview follows your changes, and nothing changes on the screen until you press **Save** (or **Cancel** to drop them). A theme can still take over at set times from Themes → Schedule. The night page now sits with your other pages, Effects and Themes share a Style section, and Location, Language and formats, Icons and emoji, and Screen orientation have moved from Setup to a new Settings section.
- **The Week ahead tile says "Nothing else today" on a free day**, instead of "Nothing else on", and it is now translated.

### Fixed
- **Add tile on a full page.** When a page has no room, adding a tile now says the page is full instead of quietly making it take turns inside an existing box.
- **Community errors.** When the gallery's list can't be read, Community says so in plain words.
- **New effect picture.** Changing the emoji in New effect (or an effect of yours) updates the picture at the top of the editor again.
- **Library > Effects preview.** Opening Effects straight from Controls now loads the live preview beside it, so Play works without visiting Themes first.
- **Library wording.** Share a layout no longer says a community gallery is planned, adding a page no longer talks about replacing Main, themes name the one actually showing, and a few small phrases read better.
- **New pages showed empty boxes while editing.** A premade layout added as a page while the editor was open showed its boxes without their tiles, and saving the editor then lost them.
- **Portrait layout.** Side-by-side boxes keep their left-to-right order on a tall screen, and a box with nothing to show right now (like radar waiting for rain) no longer leaves an empty row.
- **Typing then tapping in New effect and Customize.** After typing a name or emoji, the first tap on Save or another button was lost. Taps now work straight away.

## v0.5.0 (2026-11-20)

### New
- **Check for Updates in the Mac app menu.** Look for a new version right away, instead of waiting for the twice-a-day check.
- **Portrait displays.** The dashboard arranges your boxes into rows on tall screens and wraps the Week ahead tile. Try the 1080×1920 preview in Controls, or set **Screen orientation** manually for a display that keeps reporting landscape.
- Preview six editable dashboards or start from scratch during setup and when adding a page. Everyday is the default layout.

## v0.4.0 (2026-11-20)

### New
- **Home Assistant tiles.** Connect Home Assistant in Controls → Setup with its address and an access token, then add a **Home** tile (lights, switches, doors and sensors, with on/off switches and Run buttons for scenes) or a **Sensor** tile (one reading in big type). Locks, garage doors and alarms are shown but can't be changed from the screen. See [Home Assistant](docs/home-assistant.md).

### Changed
- The diagnostics file now removes every private field from Setup, including Home Assistant tokens, and anything else that looks like a token.

## v0.3.1 (2026-11-20)

### Fixed
- **The Mac app no longer freezes on its first start** when it opens from the folder it was downloaded to. It now asks you to move it to Applications.
- **Moving from the old Kitchen Dashboard app keeps your settings.** The downloaded app copies them in and runs its own server, instead of running the old folder.
- **Reminders Sync problems show in the menu.** The menu used to say everything was working while the icon was orange. Reminders Sync also checks the server address when you set it up.

### Changed
- When the server runs on the same Mac, the Reminders Sync menu points you to the simpler choice: Apple Reminders in Controls > Setup > Lists.

## v0.3.0 (2026-11-20)

### New
- **A Countertop app for Mac you can download.** Each release now includes a ready-made app with the server and everything it needs inside: no Xcode, Terminal or Python needed. It sits in the menu bar, shows whether everything is working, installs new versions with one click, and keeps your settings in Application Support.
- **Reminders Sync is part of the Mac app.** It replaces the separate List Sync helper, and it fills in the sync key for you when the server runs on the same Mac. It also works with a server on Docker or Unraid.

### Changed
- The menu bar app is now called Countertop (it was Kitchen Dashboard) and its menu is shorter. Building it from the source is now `zsh mac/build.sh`. It takes over from the old app, its login item and the old List Sync helper.
- The server only starts HTTPS when a certificate exists, instead of failing to start.

### Fixed
- **Shorter clock and weather boxes keep their text size.** Making a Clock or Weather now box shorter takes away its empty space first; the text only gets smaller once it no longer fits. Before, a tile made with the designer shrank all its text with the box, and the plain styles often shrank more than they needed to.

## v0.2.0 (2026-11-20)

### New
- **A setup guide for new installs.** The first time you open Controls, it asks for your town, a calendar and where your grocery list lives, then shows the addresses to open on the Echo and on your phone. You can run it again from Controls → Status.
- **Status in Controls.** See at a glance whether the screen is checking in, when the weather, calendars and list last loaded, and anything that needs a look.
- **Update notices.** Controls tells you when a new version is out, with a link to what changed and how to update. Countertop asks GitHub for the newest version number twice a day and sends nothing about your setup. Turn it off in Status.
- **Download diagnostics.** One button saves a zip with your settings, version and recent logs to attach to a bug report. Private links, sync keys, your location and network addresses are removed first.
- **Show your Apple Reminders list without a Mac server.** A list can be "Sent from another app": an iPhone Shortcut or the new Countertop List Sync helper for Mac sends it to Countertop, wherever the server runs. See [list sync](docs/list-sync.md).
- **Read a list from a web address.** Point a list at a published text file, Markdown checklist, JSON or iCal to-dos, and Countertop reads it every five minutes.
- **Edit the screen by touch on the Echo.** Controls on the Echo has an "Edit the screen" button, the editor has a ⚙ Settings button, and dragging tiles works better with fingers. The screen no longer reloads while you're editing.

### Fixed
- Controls on the Echo no longer jumps back to the dashboard about 30 seconds after you save a change.

## v0.1.0 (2026-11-19)

The first public release.

- The kitchen dashboard for the Echo Show 15 and other browser screens: clock, weather, calendars, the shared grocery list, sports, photos, deals and more than 30 tiles.
- Controls with an on-screen editor, looks, effects, pages and a night page.
- Docker images for amd64 and arm64, a Docker Compose file, and an Unraid template.
