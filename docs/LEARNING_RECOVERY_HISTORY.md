# Learn Rummy, Declaration Recovery and Last Deal

Three existing views now provide more useful paths back to play.

## Learn Rummy

The six topics can be opened directly while Back/Next and tutorial completion continue to work. Each topic includes an optional two-choice practice question with immediate explanation. Answers remain while moving between topics during one tutorial visit and reset on reopening. Examples use teaching cards and never issue game commands. A live-game notice explains that turn timers continue while learning.

`public/ui/tutorial.js` renders topic navigation and practice markup from the rule-aligned content in `public/tutorial.js`. Existing source artwork, teaching cards and step sections remain in use.

## Declaration Recovery

The rejected server message stays visible, followed by current snapshot guidance: draw, select a discard, choose a different discard for a just-picked open card, wait for another player, watch after dropping, or return after a finished round. Pending and reconnect states override the guidance. The own-turn countdown is separate from the live status to avoid repeated announcements.

The checklist explains 14 cards, the eligible discard, the two-sequence requirement and server validation. It does not infer group validity locally. Auto-group is disabled without an active hand and while waiting for a request or connection. Review cards closes the dialog and takes focus to the actual hand. A live update preserves dialog scroll and focused controls where possible. The server remains authoritative for all actions.

## Last Deal

Players can select any of the up to 20 completed rounds supplied by the current table, move to older/newer rounds or jump to the latest. A new result does not replace the round being read. If the selected round falls out of server retention, the view returns to the latest available result. Reopening starts at the latest round; switching tables uses only that table's history.

The winner, penalties and historical totals come directly from history. Names are escaped and duplicate display names are not used to infer personal identity or winners among score rows. Historical totals are explicitly separate from current standings and profile play points. The empty state explains when the first result will appear. No live opponent cards are shown.

## Validation

Pure tests cover teaching content, feedback, phase/drop/round transitions, disabled actions, safe names and historical navigation. Browser regressions cover topic practice, retained hand selection, round selection across snapshots, historical bounds and declaration reconnect/turn transitions. Native module HTTP checks include the new tutorial module. No backend schema or rules change.
