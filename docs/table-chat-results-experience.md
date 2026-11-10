# Joined Tables, Table Chat and Round Results

This milestone improves three existing views using the bundled artwork and current private-table API.

- **Joined Tables:** All, Your turn, Waiting and Completed filters; active turns appear first without changing original table numbers. A turn-attention shortcut opens the relevant table. Table tabs show the remaining turn time with a progress strip. Browsing never pauses or automatically switches a game.
- **Table Chat:** Incoming messages preserve older-history scroll position, composer drafts and text selections. Latest messages returns to the bottom explicitly. A per-table badge counts newly observed peer messages while the active chat is unread. Opening chat or reading the latest messages clears it. Existing snapshot messages form a baseline, so reloading does not label old history as new.
- **Round Results:** A personal summary separates round penalties, table penalty totals and eligible profile rewards. The score table retains server-recorded results and winning groups. Players can review standings or return to Joined Tables. Only the host can deal again, with at least two seated players.

## State and compatibility

Chat read state is held in memory per joined table, bounded by the messages retained in the latest snapshot. It is cleared on account changes and removed on leaving a table. Only observed snapshots produce counts; this does not promise background notifications for inactive tables. New chat messages include the public sender `playerId` alongside the existing fields, allowing duplicate display names to be distinguished. Older messages without sender IDs remain readable.

`public/ui/round-results.js` now owns finished-round markup. The app controller retains polling, navigation, focus and scroll restoration. No scoring, timeout, card privacy or real-money behavior changes.

## Validation

Pure tests cover filtered membership identity, result ownership/rewards, and bounded unread tracking. HTTP tests check the additive sender ID and native module serving. Browser regressions cover Joined filters, chat history/draft selection, result navigation and rematches across phone, tablet and desktop viewports. Browser execution requires the Playwright Chromium dependency.
