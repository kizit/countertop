# Sharing layouts, themes and effects, and the community gallery

Open **Library** in Controls to see your saved layouts, the premade ones, every tile, your themes and the effects. **Share a layout** turns Main or any saved layout into a small `.countertop` file or a share code. A theme's page and your own effect's page have **Share** too. **Import a file** opens any of them.

The `countertop` field says what a file holds: `layout`, `theme` or `effect`.

## What a layout file holds

A `.countertop` file is JSON:

```json
{
  "countertop": "layout",
  "format": 1,
  "name": "Family planner",
  "description": "A month view beside the family agenda.",
  "made": "2026-11-21",
  "look": {"mode": "Light", "bg": "Color", "bgColor": "#e4dfed", "accent": "#76508a"},
  "pages": [{
    "name": "Family planner",
    "boxes": [
      {"x": 0, "y": 0, "w": 19, "h": 7, "tiles": [{"type": "clock", "settings": {"style": "Bold"}}]},
      {"x": 0, "y": 7, "w": 32, "h": 25, "tiles": [{"type": "month", "settings": {}}]}
    ]
  }]
}
```

Boxes sit on the 48 × 32 grid. A box with more than one tile has `every`, the seconds each tile shows before the next takes its turn. A share code is the same JSON, base64url-encoded, after `CT1.`.

## What is left out

When a layout is shared, these never go in the file:

- Settings of type `source`: which calendars, lists, teams, albums, cams, recipe services or Home Assistant a tile uses. Whoever opens the file picks their own under **Fill in from your setup**.
- Settings of type `entity` (Home Assistant devices).
- Settings a tile marks `share:false`, such as a note's text, countdown dates and picture links. Tile authors: add `share:false` to any setting that is likely to hold something personal.

A **Your own tile** keeps its code, and Share says so. When someone opens the layout, that code doesn't run until they tap **Run** on the tile. It runs in its own frame, can't see or change the rest of the dashboard, and can load things only from secure https:// addresses, so it can't reach plain http:// addresses such as most devices on a home network.

## What importing checks

Opening a file never runs anything from it. Every tile type must be one this Countertop has; others are left out and listed. Each setting is checked against its type in the tile file (numbers are kept within their range, choices must be one of the choices, colors must be colors), and settings the tile doesn't have are dropped. Saved tile designs keep only numbers and short plain words. Nothing changes until you choose **Use on Main**, **Add as a new page** or **Save to My layouts**.

## Themes

A theme file holds a theme's settings and nothing else:

```json
{
  "countertop": "theme",
  "format": 1,
  "name": "Calm evening",
  "description": "Warmer and a little dimmer.",
  "made": "2026-11-22",
  "values": {"mode": "Dark", "accent": "#ff9f5a", "tiles": "See-through", "opacity": 55, "dim": 30, "fx": "Off"}
}
```

Each value is checked against the theme settings, the same way as a layout's `look`. A theme with a Photos background uses the photos of whoever opens it. Opening a theme shows it on the preview with your own pages. **Add to my themes** keeps it without changing the screen; **Add and use it** also puts it on the screen.

## Effects

Your own effects (Library → Effects → **New effect**) are plain data: emoji and how they move. There is no code, so an effect file can't run anything.

```json
{
  "countertop": "effect",
  "format": 1,
  "name": "Pumpkin fall",
  "description": "Pumpkins and bats for October.",
  "made": "2026-11-22",
  "effect": {"glyphs": ["🎃", "🦇", "🍬"], "motion": "fall", "size": "Big", "speed": "Slow", "spin": true, "from": "10-1", "to": "10-31"}
}
```

- `glyphs`: up to 8 emoji. Anything that isn't an emoji is dropped.
- `motion`: `fall`, `rise` (float up), `fly` (across the top) or `flutter` (wander around).
- `size`: `Small`, `Medium` or `Big`. `speed`: `Slow`, `Normal` or `Fast`. `spin`: whether falling emoji turn as they fall.
- `from` and `to`: an optional season, as month-day. Without one, it plays all year.

The built-in effects are drawn by code, so they can't be shared as files.

## The community gallery

**Library → Community** lists layouts, themes and effects other people made, from the [Countertop gallery](https://github.com/kizit/countertop-gallery). Open a card to see it with your own weather, calendars and pages, then press **Download**.

- Nothing from the gallery is part of your Library until you press Download. A download is an ordinary saved layout, theme or effect, and you can change it like one. It remembers where it came from.
- **Updates.** When the author shares a new version, its card says *Update available*, and the Library rail shows how many. Updating replaces your copy; changes you made to it are lost.
- **Remove** takes a download out of your Library. A removed item can be downloaded again.
- **Taken down.** If the gallery takes something down, Community tells you. It stays in your Library and keeps working until you remove it.
- Everything is checked again when you download it, the same way as a file from a friend. Effects have no code in them.
- Countertop reads the gallery's list only when you open Community (and when you press Refresh), keeps it for ten minutes, and sends nothing about your install.
- **Submit yours** opens the gallery's submission form. Paste a share code (Share, then Copy share code); it's checked right away and reviewed before it appears.

Layouts with a *Your own tile* (one that runs its own code) can't be in the gallery yet.
