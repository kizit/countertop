# Contributing to Countertop

Thanks for helping make Countertop better. This page covers what you need to make a change and get it merged. If you only want to run Countertop at home, start with [setup](docs/setup.md) instead.

- [Ways to help](#ways-to-help)
- [Your first contribution](#your-first-contribution)
- [Before you start](#before-you-start)
- [Set up a development copy](#set-up-a-development-copy)
- [Make your change](#make-your-change)
- [Run the checks](#run-the-checks)
- [Open a pull request](#open-a-pull-request)
- [How review works](#how-review-works)
- [Releases](#releases)

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security problem, follow [SECURITY.md](SECURITY.md) and don't open a public issue.

## Ways to help

- **Report a bug.** Use the [bug report form](https://github.com/kizit/countertop/issues/new/choose) and attach the diagnostics file from **Controls → Status**. Open the zip and look through it before you upload it: issues are public. It removes calendar and list links, keys, tokens, your location and network addresses, but you know your own setup best.
- **Suggest an idea.** Open an issue that describes what you want the screen to do for your household. A photo or sketch helps.
- **Write a tile.** Tiles are the easiest place to start: one file each, no build step. See [Writing a tile](docs/tile-api.md).
- **Translate.** Add or improve a language in `tools/lang/`. See [languages](docs/languages.md).
- **Fix something.** Issues labelled [`good first issue`](https://github.com/kizit/countertop/labels/good%20first%20issue) are small and well described. [`help wanted`](https://github.com/kizit/countertop/labels/help%20wanted) issues are bigger but ready for someone to pick up.
- **Improve the docs.** If a step confused you, it will confuse the next person too.

## Your first contribution

You don't need to know the whole codebase. A good first change is a typo in the docs, a translation fix, a wording tweak on screen, or a small tile. Pick an issue labelled `good first issue`, or open one describing what you'd like to try, and say you're working on it. If you get stuck, open a draft pull request and ask. Asking early is welcome. The [design rules](docs/architecture.md#design-rules) apply to every change, but a maintainer will help you meet them.

## Before you start

**Countertop or the Community gallery?** This repository is the Countertop application: the server, pages, tiles, docs and packaging. The [Community gallery](https://github.com/kizit/countertop-gallery) is a separate repository where people share layouts, themes and effects with other households. To share one of yours, use **Library → Community → Submit yours** in Controls ([how it works](docs/sharing-layouts.md#the-community-gallery)); it has its own review and rules. Changes to the app itself, including how the Library and Community work, belong here. Tiles with their own code can't be in the gallery yet.

For a typo, a small bug fix or a new tile, go ahead and open a pull request.

For anything bigger, open an issue first (or comment on an existing one) and describe what you plan to do. That includes a new data source, a change to how settings are stored, a new server route, a change to the tile API or tile actions, or reworking a page. Community tiles (see [Architecture](docs/architecture.md#tiles)) are planned, and their sandbox design needs agreement before any code: please discuss in an issue first. A short conversation up front saves you from building something that can't be merged as it is. Say on the issue that you're working on it so nobody else starts the same thing.

Read [Architecture](docs/architecture.md) before you change the server or the pages. It explains how the pieces fit and lists the rules every change has to follow.

## Set up a development copy

You need Python 3.9 or newer and git. Nothing else is required to run the server or the Python tests. Node 22 and Playwright are only needed for the page checks.

```sh
git clone https://github.com/kizit/countertop.git     # or your fork
cd countertop
python3 tools/countertop.py --port 8091
```

Open `http://localhost:8091/control`. The setup guide walks you through the basics the first time.

- Your development copy keeps its settings and lists in `work/`, which git ignores. Set `COUNTERTOP_DATA=<folder>` to keep them somewhere else.
- To try changes with realistic data, copy `demo/work/` into `work/`. It is a fictional household with calendars, lists and a full dashboard.
- Restart the server after you change Python in `tools/`. Pages and tiles update when you reload them.
- If you also run Countertop for real on the same computer, keep the development copy on a different port. Your everyday copy uses 8090.

[Developing Countertop](docs/development.md) has more: previewing on a real screen, portrait displays, redrawing screenshots, and building the Mac app.

## Where things are

| You want to change | Look in |
| --- | --- |
| The dashboard | `tools/dash/` (`index.html` includes the other files) |
| Controls | `tools/control/` (same layout) |
| A tile, or add one | `tools/tiles/` |
| The server | `tools/server/`: `app.py` has the routes, `config.py` the saved settings, `upgrades.py` the settings upgrades |
| Words in another language | `tools/lang/` |
| Docs | `docs/`, and `README.md` for the consumer-facing front page |

There's no build step. The server puts each page together from its parts when it's asked for it. [Architecture](docs/architecture.md) has the full map.

## Make your change

1. Create a branch from `main` with a short, descriptive name, such as `fix-month-overflow` or `tile-chores`.
2. Keep each pull request to one change. Two unrelated fixes are two pull requests, which are easier to review and to undo.
3. Follow the [design rules](docs/architecture.md#design-rules). The short version:
   - **No new required dependencies.** The server uses only the Python standard library, and pages use no framework and no build step.
   - **Works on Python 3.9**, the version a Mac ships with.
   - **Works everywhere Countertop runs**: Mac, Linux, Docker and Unraid. Don't add features that only work on a Mac. Apple Reminders sync is the one exception, and it lives in the Mac app.
   - **Works on the Echo Show's browser.** Check your change on a real device or a small, slow screen if you can.
   - **Settings are edited in Controls**, not in files. A new option needs a control in the Controls page.
   - **Add words through `tr()`** (dashboard) or `this.t()` (tiles) so they can be translated, and run `node tests/check-lang.js`.
   - **Personal data stays out of shared layouts.** Mark personal tile settings with `share:false`. Secrets belong in sources, never in `dashboard.json`.
4. If you change how settings are stored, add an upgrade step to `CONFIG_UPGRADES` in `tools/server/upgrades.py`, bump `CONFIG_SCHEMA` in `tools/server/config.py`, and add a test with a settings file in the old shape. People's dashboards must keep working after they update.
5. Add or update tests for what you changed (see below).
6. If people will notice your change, add a release note (below).

### Add a release note

Don't edit `CHANGELOG.md`. Instead, add one small file under `changes/`:

- `changes/new/` for something people can now do
- `changes/changed/` for something that works differently
- `changes/fixed/` for something that was broken

Name it after the change and write one line for the people who use Countertop, not for developers:

```markdown
- **Chores tile.** Shows whose turn it is for each chore, and moves to the next person when you tap it.
```

Internal changes like refactors, tests and CI need no note. See [changes/README.md](changes/README.md).

### Commits

- Write the subject as what the change does for people, in the present tense: "Keep the month view from overflowing on portrait screens".
- Use your GitHub `noreply` address if you don't want your email in the public history ([how](https://docs.github.com/en/account-and-profile/setting-up-and-managing-your-personal-account-on-github/managing-email-preferences/setting-your-commit-email-address)).
- Never commit anything from `work/`, real calendar or album links, API keys, IP addresses or other personal details. Use the demo data in tests and screenshots.

## Run the checks

These are the same checks that run on every pull request:

```sh
python3 -m unittest discover -s tests     # server tests
node tests/check-js.js                    # every script in the pages and tiles parses
node tests/check-lang.js                  # translations are complete
node tests/check-holidays.js              # holiday regions give the right dates
node tests/browser-check.js               # pages open with the demo data and log no errors (needs Playwright)
node tests/tile-data-check.js             # tile data end to end on a real page (needs Playwright)
node tests/sandbox-check.js               # community tiles in their sandbox (needs Playwright)
```

To install Playwright for the browser checks:

```sh
npm install --no-save --no-package-lock playwright@1.63.0
npx playwright install chromium
```

Where tests go:

| You changed | Add or update |
| --- | --- |
| Server code (`tools/server/`) | A `tests/test_*.py` file using `unittest`. Tests import the server through `countertop`, and `countertop.patch_everywhere(name, value)` swaps a function in a test |
| Calendar parsing | `tests/test_calendar.py`. It runs with and without `python-dateutil` in CI, so make sure both paths pass |
| How settings are stored | `tests/test_settings.py`, with an old-shape settings file |
| A tile's stored data | `tests/test_tiledata.py`, and `tests/tile-data-check.js` for on-screen behavior |
| Community tiles, `/tile-fetch`, safe mode | `tests/test_sandbox.py`, `tests/test_tilefetch.py`, and `tests/sandbox-check.js` in a browser |
| A page or tile | It must load in `browser-check.js` without console errors. New pieces of a page go in the page's `index.html` |

## Open a pull request

1. Push your branch and open a pull request against `main`. The template has a short checklist.
2. Say what changed and why, and link the issue it closes (`Closes #12`). Keep it to one change: that's what makes it quick to review.
3. For anything visible, add a before and after screenshot or a short recording. Use the demo data, not your own dashboard.
4. Make sure the checks pass. If one fails and you can't tell why, say so in the pull request and we'll help.

Draft pull requests are welcome if you want early feedback.

## How review works

Countertop is maintained by [@kizit](https://github.com/kizit), who reviews and merges pull requests. See [MAINTAINERS.md](MAINTAINERS.md).

- Countertop is volunteer-maintained. We aim to respond within about a week, but can't promise it. A polite nudge on the pull request is always fine.
- A reviewer may ask for changes. Push new commits to the same branch; there's no need to open a new pull request or force-push.
- Once it's approved and the checks pass, a maintainer merges it.

What reviewers look for:

- It does one thing, and does what the description says.
- It follows the design rules above, and adds no dependency, build step or Mac-only feature.
- Existing dashboards keep working after an update, including settings saved by older versions.
- Nothing personal or secret leaks into logs, diagnostics, shared layouts or the repository.
- It has tests, and a release note if people will notice it.
- Text on screen is short, plain and friendly, in the same voice as the rest of Countertop.

## Releases

Only maintainers publish releases. Merged changes wait in `changes/` and go out together in the next release, which is built from GitHub Actions. You don't need to do anything for your change to be included. See [releasing](docs/releasing.md).

## Using AI coding tools

You're welcome to use them. You are responsible for every line you submit: read it, run it, and make sure the checks pass. [AGENTS.md](AGENTS.md) gives these tools the project's rules, so they follow the same guidelines as everyone else.

## Questions

Open an [issue](https://github.com/kizit/countertop/issues) and ask. There are no silly questions, and your question probably means the docs need fixing.
