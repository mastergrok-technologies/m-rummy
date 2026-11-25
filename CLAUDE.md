# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

M Rummy: a private, play-for-fun 13-card Indian rummy web app for Hostinger Premium shared hosting. Runtime is **PHP 8.2+ plus static HTML/CSS/native ES-module JS only**: no database, no Composer, no npm runtime dependencies, no bundler, no WebSockets, no cron. Node.js 22+ is only for dev tooling and tests. Don't introduce dependencies or build steps that break this.

## Commands

```sh
npm run dev                 # PHP dev server on :3000 (wraps: RUMMY_DEV=1 php -S 127.0.0.1:3000 -t public public/router.php)
npm run check               # syntax-check every JS module (node --check) and PHP file (php -l); this is also `npm run build`
npm test                    # all Node + PHP test suites (see package.json for the chain)
python3 tools/package.py    # build dist/m-rummy-hostinger.zip upload layout
```

Run a single suite:
- PHP rules/game: `php test/run.php` (also `test/accounts.php`, `test/account-settings.php`, `test/tables.php`, `test/presence.php`, `test/deploy.php`)
- Node unit: `node --test test/board-state.test.mjs` or `node --test test/ui-modules.test.mjs`
- HTTP integration (spawns a temp PHP server with `RUMMY_TEST_DATA_DIR`): `node --test test/http.test.mjs`
- Filter by name: `node --test --test-name-pattern="<regex>" test/ui-modules.test.mjs`
- Browser (optional, Playwright, not in `npm test`): `npm install --no-save --package-lock=false playwright@1.56.1 && npx playwright install chromium && npm run test:ui`

The PHP test harness is homemade (`test/helpers.php`: `test()`, `same()`, `check()`, `rejects()`, `cards('S1 H13 J0')` card-spec builder, `table()`). It stops at the first failure.

`PHP_BIN` overrides the PHP executable for `tools/dev.mjs` and the HTTP test; `.runtime/php` (gitignored) is picked up automatically if present.

**When adding a new browser JS module or PHP file, add it to the `check` script in package.json.** CI runs `npm run check`, then packages. Run `npm test` locally.

## Architecture

### Backend (`server/`, entry `public/api.php`)

- `public/api.php` takes a shared lock on `.deploy.lock` (returns 503 during deploys), then calls `rummy_api()` in `server/bootstrap.php`.
- `rummy_api()` loads config (defaults merged with optional `server/config.php`; see `config.example.php`), takes an **exclusive `flock` on `data/state.lock`**, loads the **entire app state from one `data/state.json`**, runs migrations (`rummy_migrate`, `RUMMY_SCHEMA_VERSION` in `accounts.php`), does periodic cleanup, dispatches to `rummy_handle()`, then atomically saves (temp file + rename). Every request serializes through this lock; that is the concurrency model.
- On `RuntimeException`/`RummyApiError` (except 409), the store is rolled back to its pre-request state but rate-limit counters (`limits`) are kept. Throw via `rummy_require($cond, $msg)` for user-facing validation errors.
- `rummy_handle()` is the route switch (session, room, tables, create, join, action, register, login, logout, profile, username, feedback). Session is the `mr_session` HttpOnly cookie, and POSTs require JSON plus a CSRF token.
- Pure-ish domain modules operating on arrays passed by reference: `rules.php` (deck, melds, `rummy_analyze` exact declaration/penalty solver), `game.php` (room lifecycle: create/join/start/draw/discard/declare/drop/leave, `rummy_tick` for timeouts and bots, `rummy_public` for the per-player redacted view), `accounts.php` (registration, play-point credits with idempotent event IDs, `rummy_settle`), `presence.php`, `feedback.php`.
- **No background process:** turn timers and bot moves advance lazily in `rummy_tick` on any request from a seated player.
- **Information hiding:** `rummy_public` must never leak opponents' hands or stock order during a round. Hands become public only in finished-round results.

**Adding an API route needs three edits:** the route allowlist in `rummy_api()`, the `RewriteRule` in `public/.htaccess` (production Apache/LiteSpeed), and the handler in `rummy_handle()`. `public/router.php` (dev server only) matches `/api/[a-z]+` generically, but **new static files must be added to its explicit allowlist** (currently `ui/**.js`, `assets/figma/**`, `fonts/*.woff2` plus named files) or they 404 locally. The production CSP is `default-src 'self'`, so fonts and scripts must be self-hosted.

### Frontend (`public/`)

- `public/app.js` is the single controller: state, polling (~1.2s `/api/tables`), timers, requests, DOM event delegation, view orchestration.
- `public/ui/**` and `public/board-state.js` are **pure rendering/calculation functions** taking explicit inputs (including an escape helper) and returning HTML strings. They are unit-tested in `test/ui-modules.test.mjs`. Follow `docs/frontend-modules.md`: keep state, listeners, requests and timers in `app.js`. Don't import mutable globals into UI modules. Escape untrusted values. Preserve existing DOM IDs/data attributes, since `app.js` and the Playwright tests depend on them.
- Styles: `design-system.css` holds tokens, self-hosted fonts and shared controls, all inside `:where()` (zero specificity). `style.css` holds every screen. It loads first, yet its rules still win. Table pages use a night theme through `body:has(#app.room-page)`. See the "Shared visual foundation" section of `docs/frontend-modules.md` for the responsive rules (e.g. the phone hand dock).
- `sw.js` only caches the offline page assets (`CACHE` name versioned). It must never intercept `/api/*`. Bump the cache name when changing cached files.

### Deployment layout

Only `public/` is web-served. `server/` and `data/` sit beside it, outside the document root (bootstrap refuses a data dir under the doc root). The app must live at a domain root, not a subdirectory. `tools/package.py` builds the upload zip, and `tools/build-release.py`, `tools/deploy-hostinger.sh` and `tools/install-release.php` handle the optional GitHub Actions SSH deploy on `main` (see `docs/GITHUB_ACTIONS.md`, `docs/HOSTINGER.md`). Never commit `server/config.php` or `data/`.

## Docs

`docs/` has a per-feature design note for most features (e.g. `MULTIPLE_TABLES.md`, `PLAYER_PRESENCE.md`, `PROFILES.md`, `GAME_BOARD_IMPLEMENTATION.md`). Read the relevant one before changing a feature. The game rules as implemented (jokers, scoring, drop penalties, 80-point cap) are listed in README.md under "Rules used here".
