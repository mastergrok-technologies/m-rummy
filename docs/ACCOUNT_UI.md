# Account, avatar selection and round history

The profile dialog now has an avatar/identity header, saved point balance, human
round statistics, an accessible avatar picker and filtered activity. Native
expandable rows show round facts without leaving the profile. Filters (All,
Wins, Other rounds and Welcome bonus) reset pagination; pages stay at 20 entries.
Loading errors allow retry. Pending requests preserve legal pagination controls,
closed dialogs ignore stale results, and failed saves keep the selected avatar.

The five avatars reuse the source artwork already shipped for seats. A strict
shared asset allowlist prevents arbitrary asset paths. Saving updates the profile
portrait, header and table avatar. Other seats receive updates during polling,
without changing game versions or timers. An account without an explicit choice
retains its previous seat-index avatar; its profile picker starts at avatar 1.
The selection is saved to the account, so it survives sign-out and device changes.

## API and stored data

- `GET /api/profile?offset=0&filter=all`: accepts `all`, `win`, `loss`, `signup`;
  counts/pages only the authenticated player's matching activity. Adds
  `historyFilter` and `historyAllTotal`, retaining existing history fields.
- `POST /api/profile` with JSON `{ "avatar": 3 }`: authenticated, origin/CSRF
  protected, existing action limits and exclusive storage lock. Only integer IDs
  1–5 are accepted. Unknown fields are rejected. No points, username, password,
  room membership or rewards are changed.
- Optional `users[id].avatar` and immutable per-event `match` facts need no
  migration or backfill. Existing accounts/events continue to work unchanged.
- Newly settled eligible human rounds retain winner name, finish reason and the
  viewing player's own round/total penalty. No hands, deck order or other players'
  account data are added. Old rounds explicitly state that details were not saved.
  Historical facts remain available after a table expires. Idempotent settlement
  keeps rewards and summaries from being written twice.

## Visual scope and verification

The relevant local source frames are account `4:13177`, avatar selection
`4:18473`, and passbook/history `6:25164`, `6:26492`. Figma's access limit blocked
fresh account design context/screenshots. This milestone therefore extends the
existing profile with the lobby palette and bundled components; it does not
claim exact reference parity. A direct Figma/screenshot comparison remains pending.
Cash wallet, login-name changes, withdrawals, offers and pool history remain
outside this implementation.

Node tests cover strict assets, escaped identity/result text, filters, empty state
and pagination. PHP tests cover avatar persistence/validation, unchanged balances,
filtered account isolation and immutable private match summaries. HTTP regressions
cover authentication, origin/CSRF, tampered fields, avatar propagation and unchanged
game versions. Browser tests cover save/retry/reload, filter pagination, expansion,
image decoding and width at 390/768/1920, with CI screenshot artifacts.

Local validation for this milestone: `npm run check`, 26 Node tests, 55 PHP
rule/account/table/presence/deployment tests, Hostinger ZIP and SSH release builds
pass. PHP tests used PHP 8.4 CLI. Full HTTP-server and Chromium suites remain
pending in CI; local browser startup is blocked. The bundled avatar file hashes
match the existing source manifest. No live deployment was performed.
