# Player accounts and persistent play points

## What a player sees

Create an account with a display name, a unique username, and a password. Usernames are case-insensitive and contain 3–24 letters/numbers/underscores. Passwords must be at least 10 characters and at most 128 UTF-8 bytes. The app asks for password confirmation before signup. Keep the username/password safe; this private app does not provide email verification or self-service forgotten-password recovery.

Every new account starts with **10,000 play points**, granted once. The header shows the current balance; tap it to open the profile with wins, human rounds played, points earned, and paginated points history. Signing out or using another device does not reset anything: sign in to the same account. Profile data has no automatic expiry, even after the 30-day session or 24-hour room expiry. Its durability depends on preserving and backing up the private server data directory.

## How winning rewards work

| Event | Profile balance |
| --- | --- |
| New account | +10,000 once |
| Win against one registered human | +100 |
| Win against three registered humans | +300 |
| Lose or drop a round | No deduction |
| Play only against practice bots | No award and no profile win/round stats |

The host may change `win_points_per_opponent` in `server/config.php`, from 1 to 10,000. The default is 100. The configured value and eligible registered human players are captured when the host deals a new round, so changing configuration or registering mid-round does not change that round's payout. Bots and unregistered legacy guest seats never increase the award. A mixed table with two registered humans plus bots awards 100 to a human winner; a bot winner receives no account credit. A last remaining human after other players drop can win and earn points.

These are accumulating **play points with no cash value**. They are not stakes: players do not buy in, lose balance when beaten, transfer points, redeem points, or withdraw money. Round penalty scores still work separately: the winner scores zero penalty, lower penalty totals are better, and profile play points increase when winning.

The server records both the winner's credit and every eligible human's round/win statistics once. The points history includes the signup bonus, wins with positive amounts, and losses with zero amounts. All history remains in private storage; the profile displays 20 entries per page.

## Upgrading from the guest-only release

**No database migration command or MySQL setup is required.**

1. Finish current rounds if possible. Back up `server/config.php` and the complete private `data/` directory through Hostinger File Manager.
2. Upload all public/server files from the new release together. In particular, include the changed `public_html/.htaccess`, browser files, and new `server/accounts.php`. Keep your existing private configuration and data.
3. Optionally add `'win_points_per_opponent' => 100` to `server/config.php`. Existing configurations without it use 100 automatically.
4. Open the hosted site. The first API request locks storage, copies the original `state.json` to a private `state.v1.<timestamp>.<random>.backup.json`, and upgrades to schema version 2. If backup or save fails, the API reports an error instead of resetting your games.
5. Existing rooms, seats, hands, room history, and sessions remain. A guest can use **Create your profile**, register, and retain the same seat. Login to a different existing account requires leaving a legacy guest table first. Guest-only rounds already dealt before the upgrade receive no retroactive rewards. New rounds capture registered participants normally.
6. Verify signup grants exactly 10,000. Play a two-account round and drop the losing player: the winner should show 10,100, and the loser 10,000. Refresh several times to verify the credit does not repeat. Sign out and back in, including on a second browser/device, to verify the balance and seat survive.

The migration is idempotent: subsequent requests do not create new bonuses or repeat the upgrade. The application refuses to open a save marked with a newer schema version. Do not roll back to the old guest-only server code on upgraded data; restore matching old code and the complete pre-upgrade state backup while the site is stopped. That rollback discards all accounts/progress created since the backup, so prefer fixing forward.

## Security and backups

Account passwords are hashed server-side using PHP's password hashing API with a fixed-length SHA-256 prehash; plaintext passwords are never saved. Authentication rotates the browser's random bearer cookie and CSRF token. Login/signup are rate-limited. Profile endpoints always return the authenticated account's data and do not accept another player's account ID. Balances and award amounts cannot be set by browser requests.

The existing separate file lock and atomic temporary-file rename cover account changes, round settlement, and saved game state. The same round's immutable event IDs prevent duplicate rewards and stats on retries or polling. Rooms and sessions may expire, but accounts and point-event history are retained.

Protect and back up the entire private `data/` directory, including `state.json`. It now contains password hashes, session credentials, and the authoritative points ledger as well as live hands. Keep it outside the document root; never publish it, upload it into `public_html`, or commit it to Git. Keep all migration backups private too. This remains a single-server friends-and-family app; large public deployments and multi-server state sharing need a database and additional account/abuse controls.

## Account avatar and round details

The profile now includes five bundled avatar choices, stored on the account and
shown in the header and at joined tables. Save does not change game versions,
timers, credentials or points. History filters show All activity, Wins, Other
rounds or the Welcome bonus, with 20 entries per page. Expand a row for its facts.
Newly settled human rounds retain your own penalty summary after room expiry;
older rows explicitly identify unavailable details. See [ACCOUNT_UI.md](ACCOUNT_UI.md)
for endpoint contracts, compatibility, privacy and reference-design limitations.
