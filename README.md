<h1 align="center">Countertop</h1>

<p align="center"><strong>Make your home screen your own.</strong></p>

<p align="center">
  Put the family calendar, weather, and shared grocery list on your Echo Show 15 or another screen with a browser.
  Arrange it for the way your household gets through the day. No ads or subscription. You don’t need a Countertop account.
</p>

<p align="center">
  Runs on a Mac, a Linux computer, or a Docker or Unraid server in your home. Your calendars, lists, and settings stay there.
</p>

<p align="center">
  <a href="#make-it-yours">Make it yours</a> ·
  <a href="#what-it-can-do">What it can do</a> ·
  <a href="#it-follows-your-day">It follows your day</a> ·
  <a href="#get-started">Get started</a> ·
  <a href="#questions">Questions</a>
</p>

<p align="center">
  <img src="docs/screenshots/overview.gif" alt="Countertop's blue family dashboard showing the week, weather, and groceries as autumn leaves drift behind the tiles" width="100%" />
</p>

## Make it yours

Press and hold a tile to start editing right on the screen. Drag tiles where you want them, make the important ones bigger, and give the clock a look of its own. You can also make changes from a computer and preview them as you go.

<img src="docs/screenshots/clock-designer.gif" alt="The visual designer opens from the dashboard. The clock numbers move to the right, grow, and turn gold. Saving returns to the dashboard with the new clock." width="100%" />

### Many ways to set up the same screen

<table>
  <tr>
    <td width="33%" valign="top">
      <a href="docs/screenshots/everyday.png"><img src="docs/screenshots/everyday.png" alt="Blue layout with a week across the middle, a wide forecast, and separate tiles for groceries and a breakfast idea" width="100%" /></a>
      <strong>Everyday</strong><br />The week, weather, and meal ideas all in view.
    </td>
    <td width="33%" valign="top">
      <a href="docs/screenshots/atmospheric.png"><img src="docs/screenshots/atmospheric.png" alt="Sunset behind a centered serif clock, with see-through cards for the evening agenda, a dinner idea, and sunset time" width="100%" /></a>
      <strong>Atmospheric</strong><br />A sunset sky, glass tiles, and falling leaves.
    </td>
    <td width="33%" valign="top">
      <a href="docs/screenshots/minimal.png"><img src="docs/screenshots/minimal.png" alt="Cream two-column layout with a large green clock and weather beside a simple calendar" width="100%" /></a>
      <strong>Minimal</strong><br />A big clock, the next few plans, and the weather.
    </td>
  </tr>
</table>

Open any of the three layouts to see it full size. They all use the same fictional household data.

### Make your own tiles

Want something the built-in tiles don't do? Open **Tile Studio** (**Library → Tiles → New tile**) to write a tile of your own, or describe what you want, copy the prompt into ChatGPT, Claude, or another assistant you already use, and paste the answer back to fill in the form and live preview. Point at parts of the preview to ask for changes, switch between versions, and share your tile — or download tiles other people made in **Library → Community**.

<img src="docs/screenshots/tile-studio.gif" alt="Tile Studio beside a simulated external AI chat: describing a Walk the Dog? tile, pasting the reply to fill the form and live preview, pinning a note to add a golden puppy, and filling in the updated tile." width="100%" />

*The chat window on the right is a simulated external assistant (ChatGPT, Claude, etc.), not part of Countertop — Countertop has no built-in AI, and Tile Studio works with whatever assistant you already use.*

## What it can do

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/screenshots/phone-to-kitchen.gif" alt="On a phone, someone types Maple syrup into the shared grocery list and taps Add. A moment later it appears on the grocery tile of the dashboard." width="100%" />
      <strong>Share the grocery list.</strong> Add something from your phone’s browser and it shows up on your dashboard within half a minute. No app to install.
    </td>
    <td width="50%" valign="top">
      <a href="docs/screenshots/month.png"><img src="docs/screenshots/month.png" alt="A full month calendar with family and school events in two colors" width="100%" /></a>
      <strong>See the whole family’s plans.</strong> Put several calendars together, then switch between a quick look at the week and a full month.
    </td>
  </tr>
<tr>
  <td width="50%" valign="top">
    <a href="docs/screenshots/home-assistant.png"><img src="docs/screenshots/home-assistant.png" alt="Home Assistant tiles showing light switches, door and lock states, and sensor readings" width="100%" /></a>
    <strong>Keep an eye on your home.</strong> Connect Home Assistant to see lights, doors, and sensors alongside everything else. Switch lights or run scenes with a tap.
  </td>

  <td width="50%" valign="top">
      <a href="docs/screenshots/tile-gallery.png"><img src="docs/screenshots/tile-gallery.png" alt="Twelve example tiles: agenda, forecast, countdown, next event, stocks, sun and moon, soccer team, world clocks, planes overhead, space photo, dad joke, and on this day" width="100%" /></a>
      <strong>Make room for the fun stuff.</strong> Choose from more than 30 tiles, such as photos from a shared iCloud album, your soccer team’s next match, countdowns, planes overhead, and a dad joke.
    </td>
  </tr>
</table>

Meal ideas follow the time of day, from breakfast to dessert, and point out recipes that use something on your list or on sale. Tap one for the whole recipe and add what you need to the list. A box on the screen can hold several tiles that take turns, so meal ideas, deals, and a kitchen tip can share one spot without crowding the screen. Birthdays on the calendar set off confetti.

*All pictures show fictional data.*

## It follows your day

The sky behind your tiles follows the sun, from sunrise to sunset. At bedtime, a dim clock with your next event takes over. It moves a little each minute so nothing burns into the screen, and a tap brings the dashboard back for a moment.

<img src="docs/screenshots/day-to-night.gif" alt="The same dashboard at sunrise, midday, and sunset, with the sky changing color behind the tiles, then the dim bedtime clock showing tomorrow's dentist appointment." width="100%" />

Effects match the weather outside: rain, snow, fog, passing clouds, sun rays, and stars on clear nights. Falling leaves and holiday touches arrive at the right time of year. There are 25 effects in all, and you can turn each one on, off, or schedule it.

<img src="docs/screenshots/weather-effects.gif" alt="A close-up of the weather corner as it changes from rain to snow to a sunny day to a clear night, with the matching effect drifting behind the tiles." width="100%" />

When rain is close, the radar can take over the space that normally shows your hourly forecast. Once the rain passes, that space goes back to the forecast.

<img src="docs/screenshots/radar-takeover.gif" alt="The dashboard shows its hourly forecast, then an approaching rain forecast triggers an animated radar map in the same tile." width="100%" />

Pick a theme for the colors, background and tiles, and schedule others by time of day, day of the week, or date, for example a calmer theme on weekends or a festive one in December.

*Shown with fictional weather and map data.*

## Set it and forget it

- **Stays on.** The dashboard keeps the Echo Show awake and full screen.
- **Updates itself.** Changes you make from Controls show up on the screen without touching it.
- **Recovers on its own.** It refreshes once a night and reloads if a page ever gets stuck.

## Good to know

- **You need a computer that stays on.** Countertop runs on a Mac, a Linux computer, or a Docker or Unraid server on your home network.
- **Designed for the Echo Show 15.** Layouts are made for its 1920×1080 screen in the Silk browser. A tablet or monitor with a modern browser works too.
- **Your grocery list can live where you like.** Use the built-in list from any phone, send an Apple Reminders list with an iPhone Shortcut or the Countertop Mac app, or point Countertop at a list that's online. See [list sync](docs/list-sync.md).
- **Works with Home Assistant.** Show lights, doors and sensors, and switch lights or run scenes from the screen. See [Home Assistant](docs/home-assistant.md).
- **Save and share layouts.** The Library keeps earlier layouts to switch back to, lets you try one on the screen for two minutes, and shares any layout as a small file with your calendars and personal text left out. Tiles, themes and your own emoji effects can be shared as files too, and Library → Community has layouts, tiles, themes and effects other people made, downloaded only when you choose. See [sharing and the community gallery](docs/sharing-layouts.md).
- **Some features are limited.** Store deals use US weekly ads by ZIP code. Sports cover soccer leagues such as MLS, NWSL, the Premier League, and the Champions League. Photos come from shared iCloud albums.
- **Keep it on your home network.** Anyone who can reach the dashboard can open Controls.

## Get started

1. **Run Countertop** on a computer or home server that stays on. On a Mac, [download the app](docs/setup.md#run-it-on-a-mac) and open it. For Docker, Unraid or Linux, see the [Docker and Unraid guide](docs/install-docker-unraid.md) or the [Linux steps](docs/setup.md#run-it-on-linux).
2. **Open it on your screen.** Use the dashboard address from setup. On an Echo Show 15, say **“Alexa, open Silk,”** open that address, and tap the page once to start full screen.
3. **Add your own details.** Open **Controls** from a computer or phone on the same home network. A short setup guide asks for your town, your calendar and where your grocery list lives. Preview six premade dashboards, keep the Everyday default, or start from scratch. Later, **Controls → Pages → Add page** adds swipeable pages, including full-screen ones like a month calendar. Tap **Main** to change its layout; earlier layouts stay in **Saved layouts**.

If something isn't working, **Controls → Status** shows what's wrong. Its **Download diagnostics** button saves a file to attach to a [bug report](https://github.com/kizit/countertop/issues/new?template=bug_report.yml), with your private links and location removed. See [what's new](CHANGELOG.md) in each version.

## Questions

<details>
<summary><strong>Does Alexa still work?</strong></summary>

Yes. Countertop is a web page in the Silk browser, so Alexa keeps listening as usual.
</details>

<details>
<summary><strong>Do I need to install anything on the Echo Show?</strong></summary>

No. There’s nothing to sideload and no developer mode. You open a web address in Silk and bookmark it.
</details>

<details>
<summary><strong>What happens after a power cut or an Echo update?</strong></summary>

Countertop starts again with your computer or server. If the Echo Show goes back to its home screen, open Silk again and tap the page once.
</details>

<details>
<summary><strong>Can I use a tablet or a spare monitor instead?</strong></summary>

Yes. Any screen with a modern browser works. Layouts are designed for a wide 16:9 screen, so a landscape tablet or monitor looks best.
</details>

---

[Setup tips and more details](docs/setup.md) · [Docker and Unraid](docs/install-docker-unraid.md) · [Contributing](CONTRIBUTING.md) · [Developing](docs/development.md) · [Writing a tile](docs/tile-api.md) · [MIT license](LICENSE)

<sub>Countertop is an independent project. Echo, Echo Show, Alexa, and Silk are trademarks of Amazon.com, Inc.</sub>
