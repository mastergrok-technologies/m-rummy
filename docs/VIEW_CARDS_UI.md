# View Cards UI

Source: the same downloaded `m-rummy.fig`, frame `11:74211`, View Modal `11:74367`. Surface `11:74368` is #117954 with #85d0b6 border; scrollbar `11:78492` is purple. No new static assets are needed: sample card faces represent dynamic game data.

The private inspector shows only `state.hand`, grouped using existing reconciled local groups, with ungrouped cards last. Every card is fully visible in a responsive grid, including printed jokers and live WILD badges. Existing card rendering and gameplay rules are reused. Source clipping is adapted to native vertical scrolling. System fonts replace the unavailable SF Pro Display.

The room, round, card count, dropped state and wild rank come from the active table. Snapshot changes refresh the contents and preserve scroll position and return-button focus. Empty hands show a waiting message. Returning or pressing Escape only closes the native dialog; playing, arranging and declaring stay on the board, and the server timer continues.

Browser coverage checks desktop/mobile geometry, 13/14 cards, local groups and partial leftovers, privacy, jokers, keyboard return, live hand replacement, empty/rematch states, and multi-table isolation. Full CI results and screenshot review are recorded on the milestone PR.
