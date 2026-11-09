# Home / Lobby

Signed-in players without a restored table now open a private-table lobby. The
Points tab explains free play and lists current memberships. Joined shows table
cards, empty state, seat counts, round status, turn deadlines and a Rejoin/Open
button. The board's Home tool and header brand return without leaving a seat;
local card groups, selections and chat drafts restore on re-entry. Refresh keeps
restoring the previous selected table as before.

Create table and Join friends share the existing native dialog and PHP endpoints.
The table cap and connection/pending guards apply to both. Invite links prefill
Join even when a player already has another table. Password failures retain the
input. Aggregate polls update membership cards without rebuilding the form or
stealing its focus; empty lobbies can recover from an interrupted request.

## Design evidence and adaptations

Figma `TdUDKIqWOlKTXIEnFEW05x`, frames `2:4860` (Points) and `2:4876`
(Joined): high-fidelity design context and screenshots retrieved 9 November 2026.
The supplied local export has the same node IDs. Original repeating pattern,
Points/Joined filled/outline icons and player icon are downloaded into
`public/assets/figma/home/`. There are no temporary Figma URLs at runtime.

Uses the source lavender `#f0eff4` surface, purple `#27245d` labels, muted
`#6d6b94` labels, green `#16996b` actions, 8px cards, six seat segments,
12px card padding and 16px list gaps. Mobile navigation and Create/Join stay at
the bottom; desktop uses a two-column list and inline navigation. The existing
system fallback supplies Inter when unavailable.

This is a responsive private-game adaptation, not a pixel-perfect full-copy
claim. Membership data replaces public contest/entry-fee samples. Play points
replace wallet amounts. The cash-prize banner, cash controls, unsupported
Pool/Streak tabs and fake Android status bar are omitted. Points uses ordinary
welcome/how-to-play text instead of a cash promotion. Figma's tool limit blocked
the separate Create Game and Joined Empty contexts. Those states reuse the
existing tested dialog and semantic empty-state text, and need a later direct
reference comparison. No pool mode, cash flow, rewards or backend rules change.

## Validation

Node module tests cover escaped account/table text, empty/waiting/playing/watching/
finished states and the membership cap. Browser regressions cover returning to
private cards with selection intact, tab navigation, empty states at 360/768/1920,
bundled icon decoding, page width, create/join and failed password retention,
invite prefilling, capacity and reconnection. CI publishes Points/Joined preview
screenshots with the existing UI artifact. Local PHP is unavailable and local
Chromium cannot start in this environment; full checks and visual review must use
CI results before claiming verified browser delivery.
