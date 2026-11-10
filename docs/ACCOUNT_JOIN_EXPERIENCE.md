# Create Account, Sign In and Join Friends

## Create Account

Inline native-validation feedback and confirmation matching keep errors beside the form. Password controls explicitly show or hide each field. The client checks the existing server's 128-byte UTF-8 limit before submitting; the server remains authoritative. Helper text distinguishes the public display name from the case-insensitive username. Signup points and server policy are unchanged.

## Sign In

The account tabs now implement arrow/Home/End navigation, selected-tab focus and an associated panel. Switching between signup and sign-in keeps only the name and username in memory; password fields are rebuilt empty. A failed request displays the server message in a focusable inline alert and returns visible passwords to concealed fields. The draft remains for a deliberate retry. Form controls and mode switching are disabled during an authentication request. Successful authentication clears credential inputs and cached identity fields; logout clears cached identity too. Passwords are never put in local/session storage.

## Join Friends

The existing join dialog accepts a 12-character code or a full invite URL from this site's origin and root path. Parsing happens locally; URLs are not fetched and query-string passwords are ignored. Codes are trimmed and uppercased before the API call. Invalid or unrelated links are rejected inline before a request. Server errors retain the invite and room-password draft. Inputs and mode changes are blocked while a request is pending. Hidden server access codes are omitted from join requests, and room/access passwords are cleared on dialog close. Existing memberships and the table cap remain intact.

`public/ui/invite.js` owns the small pure invite parser. Account markup and validation stay in `public/ui/account.js`; requests, focus, drafts and pending state remain in the app controller. No server routes or game rules change.

## Validation

Pure regressions cover account semantics, confirmation matching, multibyte password limits and safe invite parsing. HTTP coverage includes serving the native invite module. Added browser regressions cover signup layouts, password controls, keyboard tabs, pending/rejected sign-in, retained identity, cleared credentials, link normalization and failed joins preserving tables. Automated test execution remains removed from Actions as requested; tests can still run locally.
