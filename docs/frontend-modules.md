# Frontend module boundaries

The browser entry point is `public/app.js`. It owns session state, networking, timers, DOM events, and coordination between views. UI markup that does not need those mutable dependencies belongs in `public/ui/`.

| Module | Responsibility | Dependencies |
| --- | --- | --- |
| `public/app.js` | State, requests, polling, event handlers, view orchestration | UI modules, board-state, tutorial |
| `public/ui/home.js` | Private-table lobby, Points/Joined navigation, live membership cards and empty state | Caller-provided account, memberships and formatting helpers |
| `public/ui/account.js` | Registration and sign-in form markup | None |
| `public/ui/tables.js` | Joined-table navigation and multi-table picker markup | Caller-provided data and HTML escape function |
| `public/ui/avatars.js` | Strict IDs and paths for the five bundled account avatars | None |
| `public/ui/profile.js` | Player profile, avatar form, filtered points history and round-detail markup | Caller-provided profile, offset and formatting functions |
| `public/ui/waiting-room.js` | Waiting-room seats, host controls, invite and chat markup | Room snapshot, draft and caller-provided helpers |
| `public/ui/gameplay.js` | In-game table, cards, round results and sidebar markup | Room snapshot, local hand grouping, draft and helper functions |
| `public/ui/panels/chat.js` | Private table chat dialog markup | Messages, composer state and helpers |
| `public/ui/panels/information.js` | Game information and room rules dialog markup | Room snapshot and formatting helpers |
| `public/ui/panels/settings.js` | Display settings dialog markup | Preferences, last-deal availability and save status |
| `public/board-state.js` | Pure table state calculations | None |
| `public/tutorial.js` | Tutorial content | None |

## Rules for further extraction

1. Keep state mutations, event listeners, requests and timers in the controller until they can be moved with focused tests.
2. Export pure rendering functions accepting explicit inputs rather than importing mutable globals from `app.js`.
3. Escape untrusted values before interpolating HTML; pass the existing escaping helper to renderers when needed.
4. Preserve existing DOM IDs, data attributes and event delegation contracts so the browser UI and API remain compatible.
5. Add focused Node tests for extracted pure functions; keep Playwright regression tests for browser behavior.
6. Extend `npm run check` for every new browser module. No bundler is required: native ES modules work with the current deployment.

## Suggested follow-up phases

- Profile and points-history presentation: extracted in phase 2.
- Waiting-room markup: extracted in phase 3. Gameplay markup: extracted in phase 4; next split it into smaller components while preserving existing DOM contracts.
- Game panel renderers: chat, information and settings extracted in phase 5; standings, hand, last-deal and declarations remain for subsequent phases.
- Move event handling and state synchronization to dedicated controllers after regression coverage is in place.

This PR starts the modularization without changing backend routes or deployment artifacts.

## Phase 6: hand and standings dialogs

`public/ui/panels/hand.js` owns arranged-hand inspection markup. `public/ui/panels/standings.js` owns ranked scores and optional revealed hands. The app retains dialog lifecycle, state and disclosure preservation. Last-deal and declaration panels remain to be extracted in a later PR.

## Phase 7: last-deal and declaration dialogs

`public/ui/panels/last-deal.js` renders server-recorded round penalties and the empty state. `public/ui/panels/declaration.js` renders invalid-declaration retry and best-declaration guidance. The controller continues to own errors, dialog lifecycle, timers, event handling and connection status.
