# How a theme becomes what you see

Every color, size and shape on the dashboard comes from one of these layers. A later layer wins over an earlier one.

1. **Built-in defaults.** What Everyday and the built-in themes start from (`THEMELIB.BASE` in `tools/shared/themes.js`).
2. **The active theme.** The theme in use, or the one a schedule rule picks. It fills in every theme setting.
3. **Tile presets and tile designs.** A tile's own colors, such as the Clock's time color or a tile design's part colors. These beat the theme.
4. **Theme colors win over tile colors.** When this theme switch is on, layer 3's colors are ignored and the theme's text and big-number colors are used.
5. **Holiday accents.** On a holiday's day the accent color is replaced by the holiday's. Nothing else changes.

Meaningful colors do not follow the theme: green for savings and prices, red for alerts, amber for warnings, the Team tile's team colors, and the photo tiles' white text over pictures.

## One resolver

`THEMELIB.resolve(values)` (in `tools/shared/themes.js`) turns a theme's values into the final colors: text, dimmer text, big numbers, tile background, border and accent. The dashboard (`themeApply` in `tools/dash/looks.js`) and the Controls previews (`lookColors` in `tools/control/look.js`) both call it, so the preview and the real screen agree.

## Tokens

`tools/dash/style.css` defines semantic tokens on `:root` (and `html.light`): `--text`, `--text-dim`, `--text-faint`, `--surface`, `--surface-line`, `--inset`, `--accent`, the status colors `--ok`, `--info`, `--warn`, `--bad`, and the shape tokens `--font`, `--radius`, `--pad-y`, `--pad-x`, `--gap`, `--shadow`. The older names (`--fg`, `--dim`, `--card`, `--line` and so on) stay as they are, because community tiles and tile designs use them. Use a token instead of a hard-coded color in tile styles. The editor's own controls keep their fixed colors.

## Theme options

A theme carries these settings besides its colors (all in `THEMELIB.BASE`; `THEMELIB.tokens(values)` turns them into the tokens above, and the dashboard and the Controls previews both use it):

- **Fonts.** Text font (five that read well small) and Big numbers font (all eight bundled fonts, or Default: each tile's own). A font picked in a Clock or Weather design beats the theme's Big numbers font. Community tiles get both through `fontDisplay` in the theme they receive.
- **Tile edges and corners.** Edges: Classic (as before), Flat, Soft, Outline, Glass (a bright edge and a shine, no blur). Corners: Square, Rounded (as before), Soft.
- **Spacing.** Compact, Normal (as before) or Roomy: the gap between tiles, the padding in tiles and the margin around the page. The grid editor reads the gap through `gapPx()`, so boxes are placed the way they are drawn.
- **Background.** Sky, Color, Gradient, Texture (drawn in CSS over the background color), Wallpaper, or Photos (an album of your choice, changing every few minutes), then an optional tint over it and the existing dimming. There is no blur.
- **Effects.** A theme can name the effects it plays; none named means the ones turned on in Effects.

An old theme has none of these keys and gets the defaults, which draw exactly what it drew before (`tests/theme-compat-check.js`).

## The editor

Themes → a theme → Customize (or New theme) opens a draft with six tabs: Colors (palette presets, accent, text colors), Type, Surfaces, Spacing, Background and Effects. Each choice is a picture, the preview beside it follows the draft, and **Reset this section** puts one tab back to how the theme was. Nothing is saved until Save. In a Clock design or the tile designer, a **Theme** swatch makes a color follow the theme (Theme colors win still decides who wins). `tools/control/look-editor.js` holds the tabs; a new theme setting needs a place in `LTAB_KEYS` there.

![The Colors tab](screenshots/theme-editor-colors.png)

## What may leave this Countertop

A **wallpaper** is a picture uploaded to this Countertop's own data folder (PNG, JPEG or WebP, up to 8 MB, checked by its first bytes; `tools/server/wallpaper.py`). A theme only names its id, and a **photo album** is only named by its id too. Neither may travel. Everything that leaves goes through `THEMELIB.portable(values)`: a shared theme, a shared layout, a gallery submission and a Theme Studio prompt all call it, so a setting can't leak by being forgotten in one place. It drops the settings listed in `THEMELIB.LOCAL`, turns a theme on a wallpaper into a gradient one, and keeps only effects everyone has. Files and codes coming in are read with the same list: a wallpaper or album named in a shared file is ignored.

## Keeping it unchanged

`node tests/theme-compat-check.js` loads the dashboard in every built-in theme and a few custom ones and compares the computed colors, borders, radius, padding, gaps and shadows of the elements with `tests/fixtures/theme-compat.json`. If a change should alter the look, regenerate the file with `--write` and say why in the pull request.
