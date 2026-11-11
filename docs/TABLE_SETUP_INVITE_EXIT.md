# Create Table, Invite Friends and Leave/Drop Confirmation

## Create Table

The setup view now explains host responsibilities, the minimum player count and the effect of setting a room password. The summary updates without displaying the password. A show/hide control helps with entering a shared room password; it is explicitly separate from the account password. Closing the dialog clears room/access passwords and resets visibility. Pending submission text identifies creation or joining while controls are locked. Existing API policy and the table cap are unchanged.

## Invite Friends

The invite dialog shows the selected room, open-seat count, password-protection notice and separate copy-link/copy-code controls. Links never contain room passwords. Successful clipboard writes produce an inline status. If clipboard access is unavailable, the relevant read-only field is focused and selected for manual copying. An operation token prevents an old clipboard result from updating a closed or reopened dialog. Room facts refresh without rebuilding focused fields; a no-longer-selected table blocks copying. The view explains that sharing neither pauses timers nor reserves seats.

## Leave/Drop Confirmation

Confirmations show table/round context, the drop penalty or seat consequence, and action-specific button text. Cancel makes no game request. Confirmation snapshots bind actions to their original table and round. A changed drop penalty, changed declaration hand/turn/deadline, ended round or newly started round prevents the old intent from being submitted. Unrelated chat/presence updates do not invalidate a legitimate decision. Offline or pending-request state also disables confirmation, and validity is checked again at click time. Closing clears the stored intent; confirming consumes it once.

The server remains authoritative and retains its version checks, drop/declaration rules and leave restrictions. No backend behavior changes. Pure presentation/snapshot helpers live in `public/ui/table-flows.js`; clipboard, dialog state and networking remain in the app controller.

## Validation

Pure tests cover setup wording, escaped invite data, chat-tolerant confirmation checks and turn/card/round/penalty invalidation. HTTP checks include the new native module. Added browser regressions cover setup on phone/tablet/desktop, clipboard success/fallback, live invite seats, stale drop/leave decisions and changed declaration hands. Automated tests remain disabled in Actions as requested; local checks/tests and release builds are run separately.
