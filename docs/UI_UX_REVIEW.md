# Application UI/UX review and shared design

## Scope and evidence

This pass reviews the current application's rendering modules, controller interactions, styles, offline page and delivery paths. The previous implementation accumulated screen-specific palettes, typefaces, radii and controls. Utility dialogs alternated between navy, gray and bright green; headers used different graphic/typographic treatments; some close icons looked like back actions. Local browser launch was attempted but the environment rejected Chromium's process socket. This is a source and behavior review with automated nonbrowser validation, not a completed visual or user study.

## Design decisions implemented

- Green primary actions, neutral light utility surfaces, one system type stack and a compact/standard/wide dialog size scale. The actual game board retains its distinct dark playing surface and existing card/seat geometry.
- Shared canvas, surface, text, subdued text, borders, primary/hover, focus, danger and disabled tokens. A 4/8/12/16/24/32 spacing scale, 8/12/16 radii and 44px control baseline establish reusable foundations.
- Dialog headings use text instead of decorative title backgrounds; all game-dialog close controls use ×. Return actions remain explicit buttons such as Back to settings or Return to table. Existing accessible labels remain intact.
- Form inputs use 16px text on touch screens, with matching surfaces/borders and visible focus. Error, informational and disabled states use consistent colors. Keyboard focus is visible on both neutral and playing surfaces.
- A skip link reaches the focusable main landmark. User-initiated returns home focus its heading. Lobby labels are Play and My tables, matching the actions available there; play-point balances remain separately identified.
- System reduced-motion and the in-app Reduce motion setting suppress nonessential motion. Short landscape chat windows can scroll to the composer rather than clipping it.

## Screen/flow audit

| Area | Review finding | Result in this pass |
| --- | --- | --- |
| Shared header/footer | Tight mobile header, mixed typography, no skip link | Flexible header, common type/action sizing, main-content skip link |
| Signup and sign-in | Good inline validation and draft controls; surfaces/sizes differed from account pages | Shared inputs, password controls, selected tabs, error/focus states |
| Play and My tables | Lobby purple palette conflicted with green account/table actions; Points label ambiguous | Brand tokens, clearer labels, consistent filters and primary/secondary actions |
| Create/join table | Native forms and pending guards already existed | Shared overlay, touch-sized password controls, consistent summaries/errors |
| Waiting room | Seat geometry and host guards already handled 2–6 players | Shared chrome/sidebar surfaces; felt/seats and authoritative guards retained |
| Active game | Card actions and local arrangements must remain stable | Distinct playing surface, common navigation/action styling; no card sizes changed |
| View Cards | Previous green modal differed from every other utility | Neutral overlay, consistent group panels, filters and return action |
| Chat | Dark composer and pale controls conflicted with light utility views | Neutral chat/log, readable message text, green composer actions, short-window scrolling |
| Settings | Green modal, inconsistent icon/close language | Shared overlay, readable preference/disabled states, common close control |
| Table Information | Decorative title and bespoke gray surface | Plain text title, shared topic navigation, consistent rule/fact surfaces |
| Standings and results | Separate title/surface treatments | Common title/score-table language; winner/self highlights remain distinct |
| Last Deal | Dark surface mixed with light browser/score table | Consistent historical-summary surface and readable explanatory text |
| Declaration/retry/guide | Navy backgrounds mixed with pale feedback and unrelated type | Neutral utility, danger notice for rejected declaration, common guidance surfaces |
| Tutorials and house rules | Each step repeated its own surface and radius | Shared shell and green teaching callouts; existing teaching-card content retained |
| Invite/confirmation/mobile guide | Back and close icon ambiguity | Same close convention, consistent summaries/controls; explicit return paths retained |
| Profile/avatar/history | Purple account palette conflicted with primary brand | Shared balance surface, ledger/filter colors and focus treatment |
| Username/suggestions/receipt | Good server feedback but separate form styling | Same overlay, field and action language as sign-in/profile |
| Reconnect and offline | Recovery behavior already separated from moves | Shared visual foundation, offline delivery of theme, existing no-replay behavior retained |

## Implementation boundaries

`public/design-system.css` loads after `style.css`. The older sheet retains screen structure, source artwork and card/board geometry; the new sheet is the authoritative shared visual foundation. Future cross-screen presentation work belongs in this file and should use its tokens. It deliberately does not implement a second state controller or change game rules.

The shared stylesheet is served by the local PHP router, shipped in both release formats, cached with the offline recovery assets and required by the release installer. The cache version is incremented so existing users receive the updated recovery bundle. No API or hand data enters the offline cache.

## Validation and remaining review

- Local Node tests check normal-text contrast of supported text/surface pairs (at least 4.5:1), focus contrast (at least 3:1), entry-point stylesheet ordering and offline cache boundaries.
- Existing PHP and HTTP suites cover game/account/deployment behavior; HTTP additionally checks that the exact design stylesheet is served. Deployment tests reject a release missing the stylesheet before changing code.
- Added browser regressions check common modal background/title/close controls, overflow, Home heading focus and screenshots across 320/390/768/1440px widths. Legacy assertions tied to graphic close/title artwork were updated to the new text/control contract.
- Browser regressions and visual screenshots remain unrun because Chromium cannot launch in this workspace. The next acceptance check should cover actual phone landscape/portrait, long names/messages, keyboard/screen-reader use and multi-device play. Automated tests remain disabled in GitHub Actions as requested; syntax checks, packaging and deployment checks remain.

Remaining structural debt: legacy screen styling is still present beneath the shared foundation. It can be removed incrementally after browser comparisons confirm each old selector is no longer needed. Music remains explicitly unavailable; this pass does not introduce an unsupported control or service.
