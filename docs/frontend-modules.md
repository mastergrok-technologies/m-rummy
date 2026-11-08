# Frontend module boundaries

The browser entry point is `public/app.js`. It owns session state, networking, timers, DOM events, and coordination between views. UI markup that does not need those mutable dependencies belongs in `public/ui/`.

| Module | Responsibility | Dependencies |
| --- | --- | --- |
| `public/app.js` | State, requests, polling, event handlers, view orchestration | UI modules, board-state, tutorial |
| `public/ui/account.js` | Registration and sign-in form markup | None |
| `public/ui/tables.js` | Joined-table navigation and multi-table picker markup | Caller-provided data and HTML escape function |
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

- Extract profile and points-history presentation.
- Extract waiting-room and gameplay markup in separate, small PRs (avoid moving the entire game loop at once).
- Extract game panel renderers by panel (chat, standings, settings, declarations).
- Move event handling and state synchronization to dedicated controllers after regression coverage is in place.

This PR starts the modularization without changing backend routes or deployment artifacts.
