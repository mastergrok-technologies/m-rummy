# View Cards, Table Information and Offline Recovery

## View Cards

The private hand inspector adds All, Hearts, Diamonds, Clubs, Spades and Jokers filters with current counts. Jokers includes printed jokers and the current wild rank. Filtering never modifies card order, saved groups, selection or server state; it does not judge whether a group is valid. Empty filtered results have a clear return-to-All message. Incoming snapshots preserve the chosen filter and its focus; opening the view or changing table/round resets it to All. Only the user's own cards are rendered, and stale group IDs are reconciled before rendering.

## Table Information

Topic shortcuts focus and scroll to table details, declaration guidance or joker/drop choices. Rule text describes the existing engine: printed cut jokers make aces wild, open-deck jokers cannot be picked, the just-picked open card cannot be returned immediately, and a player must discard before dropping after drawing. The view distinguishes dropping from leaving between rounds. Dialog scroll and focused topic controls/headings survive snapshot updates. No live hand appears here.

## Offline Recovery

The fallback now gives concrete reconnection steps and explains that turns continue and seats may expire. Browser online/offline events update an advisory message; they never imply the server was reached or automatically redirect. The Return link keeps only a validated 12-hex room code, discarding arbitrary destinations and other query fields. Recovery makes no API calls, stores no credentials and replays no actions.

The service-worker cache version is incremented. Its fixed asset list contains offline HTML, its small recovery script and CSS. API/game requests and the application shell continue to use the network. Recovery assets use network-first fallback and same-origin paths. The PHP development router explicitly serves the new script.

## Validation

Pure regressions cover private filter counts/group immutability, rule topics, sanitized recovery navigation and service-worker cache/network boundaries. HTTP tests cover the recovery module. Browser regressions cover responsive hand filters, selected-card/group retention, focus during information updates and explicit offline-return navigation. Automated test execution remains disabled in Actions as requested; tests and release builds are run locally.
