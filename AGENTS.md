# Notes for AI coding agents

This file gives AI coding tools the rules human contributors follow. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/architecture.md](docs/architecture.md) before making changes. To write a tile, read [docs/tile-api.md](docs/tile-api.md).

## Layout

- `tools/countertop.py`: starts the server and holds `VERSION`. The code is in `tools/server/` (`app.py` routes and `main()`, `config.py` settings and `CONFIG_SCHEMA`, `upgrades.py` `CONFIG_UPGRADES`, `actions.py` tile actions, `feeds/` data for tiles). Python standard library only.
- `tools/dash/` (dashboard) and `tools/control/` (Controls): each has an `index.html` that includes its other files with `<!--#include path-->`, put together by the server with no build step. `tools/shared/` is used by both. `tools/list.html` and `tools/shell.html` are single files.
- `tools/tiles/*.js`: one tile per file, served joined at `/tiles.js`. New tiles use `api:1`.
- `tools/lang/`: translations. `tests/`: `unittest` server tests and Node/Playwright page checks. `demo/work/`: fictional demo data.
- `changes/`: one-line release notes per pull request. `docker/` and `mac/`: packaging. Do not edit `docs/` screenshots or `tools/starters/` unless asked.

## Run and check

```sh
python3 tools/countertop.py --port 8091     # dev server; data in work/ (git-ignored)
python3 -m unittest discover -s tests
node tests/check-js.js
node tests/check-lang.js
node tests/check-holidays.js
node tests/browser-check.js                 # needs Playwright + Chromium
node tests/tile-data-check.js               # needs Playwright + Chromium
```

Restart the server after editing Python. Run the checks before you finish.

## Rules

- Don't add dependencies, a package manager, a bundler or a build step. Python must run on 3.9.
- Don't add Mac-only features. Everything must work on Linux, Docker and Unraid.
- Every user-facing option needs a control in Controls. Don't tell people to edit files.
- Keep settings (`dashboard.json`), sources with secrets (`sources.json`) and tile data (`tiles/<id>.json`) separate. Never put secrets or personal data in settings, logs, diagnostics or shared layouts. Mark personal tile settings `share:false`.
- Changing how settings are stored needs a step in `CONFIG_UPGRADES` (`upgrades.py`), a `CONFIG_SCHEMA` bump (`config.py`) and a test with old-shape settings.
- Passwordless access to Controls on the home network is intentional. Cross-origin requests are a separate concern: don't change request handling or add origin checks as a side effect of another task; raise it in an issue first.
- Security architecture questions (how requests, secrets or sandboxing should work) are ordinary design discussions: raise them in an issue. A suspected vulnerability is different. If you find something that looks exploitable, such as a way to read secrets, get past a confirmation, run code, or reach files outside the data folder, don't write it up in an issue, pull request, commit message or code comment. Tell the person you're working for to report it privately through GitHub's security reporting (the repository's Security tab → Report a vulnerability, see [SECURITY.md](SECURITY.md)).
- Locks, garage doors and alarms stay opt-in per tile with server-enforced confirmation.
- The Community gallery is a separate repository (`kizit/countertop-gallery`) with its own rules; this repository holds the app side (Library → Community). Don't start work on community tiles or a tile sandbox without a maintainer's agreement in an issue.
- Wrap new on-screen text in `tr()` or `this.t()`.
- Keep pages light enough for the Echo Show browser.
- For changes people will notice, add a one-line note under `changes/new/`, `changes/changed/` or `changes/fixed/`. Don't edit `CHANGELOG.md` or `VERSION`; releases do that.
- Write on-screen text, release notes and commit messages in plain, friendly language for the household, in the present tense.
- Never commit anything from `work/`, real links, keys, IP addresses or personal details. Use the demo data.
- Keep a pull request to one change.
