# Next three account pages

1. **Change Username**, source `4:23443`: native responsive account sheet with
   the existing handle, current-password verification, validation and Save.
   Success updates the header/profile account. The public player name, stable
   account ID, sessions, avatar, points and tables stay attached to the account.
   Next login uses the new handle; the old name is released.
2. **Suggestion Box**, source `11:88251`: category and message form with a
   1,000-character limit, counter, pending/offline guards and retained in-memory
   draft. Available from the profile and Points home guide.
3. **Submission Confirmation**, source `11:88422`: receipt reference, server
   timestamp, category and escaped message; Send another and Back to profile.
   The last receipt can be reopened after refresh for that signed-in account.

## Design evidence

The Change Username screenshot/design context was retrieved from Figma. Its
white rounded sheet, purple labels, lavender input, green Save and centered
18px title inform the implementation. The extra current-password field is an
application requirement. Figma's limit blocked subsequent requests for the
isolated modal and Suggestion Box frames. The local export confirms the latter
form and “We Heard You” result, including their text overrides. Those two views
compose the existing lobby palette and repeating source pattern. Source
illustrations were not retrieved or substituted; exact parity and their direct
visual comparison remain pending. Receipt wording reports server storage,
without claiming that someone read the suggestion or promising an ETA.

## API and storage

`POST /api/username` accepts exactly `username` and `currentPassword` for the
signed-in account, under the normal origin/CSRF protection and storage lock.
Names use the existing case-insensitive 3–24 character rules. Verification runs
against the current account before changing the username index. Five attempts
per 15 minutes are allowed per account. Passwords are never put in URLs or
browser storage, and the form clears the password after requests and on close.

`POST /api/feedback` accepts exactly a 32-character lowercase hexadecimal `id`,
`category` (`idea`, `issue`, `other`) and a nonblank UTF-8 `message` up to 1,000
code points/4,000 bytes. Each submission is stored in private `state.json` under
`feedback[id]` with its account ID, time and `received` status. An unchanged
retry with the same account/token/content returns the original receipt. Reusing
an ID with different content/account is rejected. New writes are limited to five
per 24 hours per account and 1,000 retained records server-wide; retries do not
consume new-submission quota. Once full, the server reports that the host must
review/maintain the queue. No email, chat or external notification is sent.

`GET /api/feedback?id=...` returns a receipt only to its submitting account and
omits the internal owner ID. A missing or other-account receipt gives the same
404. The browser stores only its last reference in session storage; draft text
stays in memory and clears on sign-out. Inputs/results are rendered as escaped
text. No game hands, device metadata or automatically captured room data are
attached to feedback.

The optional `feedback` key is additive to schema v2; no reset or migration is
needed. The host can review it in the private data file and correlate stable
owner IDs with `users`. Back up the complete file before maintenance and keep it
outside the public root. The release installer now requires `server/feedback.php`
so an incomplete release is rejected before replacing running code.

## Validation

Node rendering tests cover escaping and credential-form requirements. PHP tests
cover credential verification, duplicate names, stable sessions/game state,
authentication, origin/CSRF protection, validation, queue limits and private
idempotent receipts. HTTP tests cover both routes, sign-out/re-login and durable
receipts. Browser regressions cover all three views at 360/768/1920, rejected
passwords, safe confirmation text, history return, last-receipt retrieval and
recovery of an uncertain save. CI produces screenshots for the three views.
