# Playing experience improvements

The active board now explains the player's next step: draw, select exactly one
discard, or use the selected card to discard/declare. Waiting and dropped players
see their actual role. A just-picked open-deck card explains why it cannot be the
final discard; Discard and Declare stay disabled for that selection, matching the
existing server rule. The hand footer names the selected card, offers Clear
Selection, and keeps the action buttons at a minimum 46px height. Go to my cards
moves to the hand heading without submitting a move.

A countdown and progress indicator beside the hand use the existing server-offset
clock. Human turns use the existing 60-second scale; this adds no grace period,
match countdown or new phase. At ten seconds or less, a polite announcement runs
once per active turn per table. The number itself has no live-region ticking.
Pending/reconnecting guidance states that actions are waiting for confirmation or
a fresh snapshot. The server remains authoritative for elapsed turns and legality.

## Arrangement and position

Sort, Group, Ungroup and successful server Auto-group retain one previous local
layout, including the prior selection. Undo arrangement restores only that layout;
it never reverses a draw, discard, declaration or drop. Clear Selection does not
alter the groups. Undo is isolated by table/round and a sorted physical-card-ID
signature. A changed hand or new round invalidates it. Switching tables/Home
retains the in-memory undo for a matching hand; a page reload keeps the existing
saved groups but starts without undo history. Snapshots contain card IDs and group
titles, not private opponent data.

Within the same table and round, a markup refresh restores horizontal hand scroll,
focused card/control and page position. This applies to local selection and new
server snapshots. A removed/disabled control falls back to the hand heading. The
selection handler uses preventScroll to avoid jumping back to the start of a
long mobile hand. Leaving releases its cached table UI instead of recreating it.

The implementation composes existing cards, source artwork and native controls.
No asset replacements, API, game-rule, score or deployment changes are required.
No automatic game actions, sounds, vibration or browser notifications are added.

## Validation

Presentation tests cover actual phase/ownership, multi-selection, picked-open
restrictions, dropped/finished states, escaped player names and physical-ID-bound
snapshot independence. Browser regressions cover undo across tables, invalidation
after drawing, Clear Selection, open-deck restrictions without rejected commands,
mobile scroll/focus retention on selection and polling, pending/reconnect guards,
and turn guidance/countdown at 390/768/1920. CI publishes three gameplay screenshots.
