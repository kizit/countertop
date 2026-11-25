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

## Keeping it unchanged

`node tests/theme-compat-check.js` loads the dashboard in every built-in theme and a few custom ones and compares the computed colors, borders, radius, padding, gaps and shadows of the elements with `tests/fixtures/theme-compat.json`. If a change should alter the look, regenerate the file with `--write` and say why in the pull request.
