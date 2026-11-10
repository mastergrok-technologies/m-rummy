# Deploy automatically to Hostinger Premium with GitHub Actions

The repository's **Check and package** workflow runs syntax checks, builds upload artifacts, and can deploy the exact checked `main` commit over SSH. Deployment is **off until you configure it**. No hosting credentials belong in source code or chat.

Hostinger Premium supports SSH. Confirm your actual IP, username, port, and server-key fingerprints in hPanel → your website → **SSH Access**, and enable SSH there. Shared hosting commonly uses port **65002**; use the value hPanel shows.

Official references: [Enable SSH](https://www.hostinger.com/support/1583645-how-to-enable-ssh-access-in-hostinger/), [Connect via SSH](https://www.hostinger.com/support/1583245-how-to-connect-to-a-hosting-plan-via-ssh-in-hostinger/), [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).

## Fast workflow

Automated test execution is removed from this workflow to reduce runtime. It no longer runs `npm test`, installs Playwright or Chromium, runs `npm run test:ui`, or uploads browser screenshots. Syntax checks, both release artifacts, deployment validation and the HTTPS API smoke check remain. The existing `test` job ID is retained so deployment dependencies and required check names stay compatible.

Run `npm test` locally when needed. Browser regressions remain available through `npm run test:ui` after installing the pinned Playwright version and Chromium from the previous workflow setup.

## 1. Choose the dedicated PHP website directory

Use a dedicated Hostinger PHP website/domain with this layout:

```text
/home/u123456789/domains/rummy.example.com/   ← HOSTINGER_DEPLOY_PATH
  public_html/                             ← existing web document root
  server/                                  ← deployed private code/config
  data/                                    ← private accounts, points, games
  .rummy-backups/                           ← private deployment snapshots
  .rummy-staging/                           ← temporary code-only releases
```

Replace the example with your real path, found in File Manager or with `pwd` over SSH one level above `public_html`. The directory and its `public_html` folder must already exist for the default layout. For an existing nested subdomain use the separate public path below; do not point it at the home directory itself, the public folder, a WordPress site, or a subfolder inside another website's public document root. It refuses unrelated `index.php`/`index.html` sites and symlink deployment paths. See [HOSTINGER.md](HOSTINGER.md) for domain, PHP 8.2+, and SSL setup.

For an existing M Rummy installation, keep the same site directory and private configuration/data. Your existing `app_origin` must exactly match the deployment URL. Your PHP worker must be able to read the private deployment lock; use the normal account-owned Hostinger file permissions.

### Existing subdomain under the main domain

For a Hostinger subdomain already mapped to a folder beneath another site's
public_html, set **HOSTINGER_PUBLIC_PATH** separately. For m.trecx.us use:

| Repository variable | Value |
| --- | --- |
| HOSTINGER_DEPLOY_PATH | /home/u575788507/domains/m.trecx.us |
| HOSTINGER_PUBLIC_PATH | /home/u575788507/domains/trecx.us/public_html/m |
| HOSTINGER_APP_URL | https://m.trecx.us |
| HOSTINGER_PHP_BINARY | php |

Both directories must exist. Keep the current private deployment root to retain
any existing configuration and points. The installer puts only public release
files into the subdomain folder and binds api.php to the private server and
deployment lock. Private data, configuration, staging, and backups remain under
HOSTINGER_DEPLOY_PATH. It does not change the parent site's files.

The custom public path must be a real, non-symlink directory matching
/home/ACCOUNT/domains/DOMAIN/public_html/SUBDOMAIN_FOLDER under the same account.
The main public_html directory itself is refused. The folder must be dedicated to
M Rummy; unrelated index.php, WordPress, or index.html sites are refused.

Ensure hPanel maps m.trecx.us to this exact public folder and DNS/SSL reach this
hosting account. Deployment does not change DNS or Hostinger virtual hosts. A
static test file must be reachable there before expecting the API smoke check
to succeed. An inherited parent .htaccess may also affect subdomain requests.

Omitting HOSTINGER_PUBLIC_PATH preserves the original SITE_DIRECTORY/public_html
layout. Do not switch public targets while live players are using the old one.

## 2. Set up an SSH deploy key

On your computer, generate a separate deployment key:

```sh
ssh-keygen -t ed25519 -C "m-rummy-github-actions" -f ~/.ssh/m_rummy_hostinger
```

Leave the passphrase empty for this dedicated, noninteractive automation key. Add **only the public `.pub` file** to the Hostinger account's authorized SSH keys through hPanel. Keep the private key private and use it only as a GitHub Actions secret. This workflow does not use an SSH password. Verify that this key can connect to the intended hosting account and that `php -v` reports CLI PHP 8.2 or newer; website PHP and CLI PHP can differ.

## 3. Verify and save the SSH server key

Fetch the server's public host key on your computer (replace the host and port):

```sh
ssh-keyscan -p 65002 -t ed25519 YOUR_HOSTINGER_SSH_HOST > hostinger_known_hosts
ssh-keygen -lf hostinger_known_hosts
```

Compare the printed ED25519 SHA256 fingerprint with the one shown in hPanel's SSH Access card. Only if they match, use the contents of `hostinger_known_hosts` for the secret below. The secret must contain the complete known-hosts line, not just its SHA256 fingerprint. If you use an IP for `HOSTINGER_SSH_HOST`, scan that same IP. Never bypass a mismatch or disable host-key checking. The workflow deliberately does not auto-trust keys with `ssh-keyscan` at deployment time.

## 4. Add four GitHub repository secrets

Open [m-rummy → Settings → Secrets and variables → Actions](https://github.com/mastergrok-technologies/m-rummy/settings/secrets/actions). Under **Secrets**, add:

| Secret | Value |
| --- | --- |
| `HOSTINGER_SSH_HOST` | SSH IP/hostname from hPanel, without `https://` or a port |
| `HOSTINGER_SSH_USER` | Hosting SSH username, such as `u123456789` |
| `HOSTINGER_SSH_PRIVATE_KEY` | Full private key contents, including BEGIN/END lines; not the `.pub` key |
| `HOSTINGER_SSH_KNOWN_HOSTS` | Verified complete host-key line from step 3 |

Store these in GitHub, not in a message or a committed `.env`. The deploy job uses the `hostinger-production` environment; optional environment protection rules may be configured there, but repository secrets work without adding an approval gate.

## 5. Add repository variables

In the same settings page, under **Variables**, add:

| Variable | Example / behavior |
| --- | --- |
| `HOSTINGER_DEPLOY_PATH` | `/home/u123456789/domains/rummy.example.com` — private site directory above `public_html`, no trailing slash |
| `HOSTINGER_PUBLIC_PATH` | Optional separate subdomain document root; defaults to HOSTINGER_DEPLOY_PATH/public_html. See above. |
| `HOSTINGER_APP_URL` | `https://rummy.example.com` — exact origin, no trailing slash or path, SSL already working |
| `HOSTINGER_DEPLOY_ENABLED` | `true` — enable after all settings are ready; omit or set `false` to keep deployment off |
| `HOSTINGER_SSH_PORT` | Optional; defaults to `65002`; confirm in hPanel |
| `HOSTINGER_PHP_BINARY` | Optional; defaults to `php`; use the verified CLI executable/path if your account requires another PHP binary |

Keep `HOSTINGER_DEPLOY_ENABLED` as a **repository-level variable**, because it is evaluated before the deployment job starts. Do not include quotes in the variable values.

## 6. Run the first deployment

1. Finish any active game rounds. Deployment refuses to replace code while a non-expired saved round is still playing.
2. Set `HOSTINGER_DEPLOY_ENABLED=true`.
3. Open [Actions → Check and package](https://github.com/mastergrok-technologies/m-rummy/actions/workflows/test.yml).
4. Select **Run workflow**, choose branch **main**, and run it.
5. Confirm the `test` job (syntax checks and release packaging) and **Deploy to Hostinger Premium** job both succeed.
6. Open your HTTPS website and test signup, two-player play, saved points, and mobile browsers.

After setup, pushes to `main` automatically deploy after syntax checks and release packaging pass. Pull requests and other branches still run checks but never deploy. A manual run also checks and packages first and deploys only `main`. The job refuses a stale commit if `main` has advanced, and deployments run one at a time without cancelling an in-progress install.

## What the deployment does

1. Runs JavaScript/PHP/shell syntax checks and builds a code-only release with per-file checksums and the current commit SHA.
2. Uses a temporary runner SSH key file, strict server-key verification, and encrypted SCP to upload into a private staging directory.
3. Verifies release files, target paths, PHP CLI version, private data location, existing origin, and saved state. It takes exclusive deployment and state locks before changing code. New API requests get a retryable HTTP 503 during the short update.
4. Saves a private snapshot of overwritten code, `server/config.php`, and `state.json` under `.rummy-backups/`. Existing private configuration and all accounts/points/game data are preserved. No remote-directory synchronization or broad delete touches them; untracked web files are not removed.
5. Creates a private, HTTPS-enabled `server/config.php` with the supplied origin on a first deployment only. Existing configuration is never replaced. The default welcome/win rewards stay 10,000/100 unless you change the private config.
6. Replaces only release-listed code files using atomic file renames. If copying fails, it restores the previously changed code and leaves live player data untouched. Successful installs record the SHA in `.m-rummy-deploy.json` outside the web root.
7. Calls `/api/session` over HTTPS to verify the application responds, without logging its session/CSRF values. The normal automatic JSON data migration can run on this first request; no SQL command is required.
8. Removes the uploaded staging release after a successful smoke check and removes the runner's temporary SSH identity even if a step fails.

Backups are intentionally retained for manual recovery; monitor disk space and remove old private backups yourself once no longer needed. The snapshots contain credentials and points data: never expose or commit them.

## Failures and recovery

| Failure | Action |
| --- | --- |
| Deploy job skipped | Set the repository variable `HOSTINGER_DEPLOY_ENABLED` to `true`, use `main`, and confirm syntax checks and release packaging passed. |
| Missing secret / key parse error | Check all four secret names and the full unencrypted private key, including newlines. |
| Host key verification failed | Check the same host/IP and port against hPanel; update the verified known-hosts secret only after confirming the fingerprint. |
| Permission denied (publickey) | Authorize the matching `.pub` key on the correct Hostinger account; confirm the username. |
| Target directory refused | Keep the private site directory outside public_html; set HOSTINGER_PUBLIC_PATH for a nested subdomain. Both configured directories must exist and be real, not symlinks. |
| PHP CLI too old | Verify `php -v` over SSH and set `HOSTINGER_PHP_BINARY` to the available 8.2+ executable. |
| A round is still playing | Finish the round, then run the workflow again. No code or balances were replaced. |
| Wrong existing `app_origin` | Correct it in private `server/config.php`, or fix `HOSTINGER_APP_URL`. |
| Code-copy failure | The installer attempts code rollback under the locks; inspect the error and private backup before retrying. |
| HTTPS/API smoke check failed | Code may already be installed. Check DNS, SSL, PHP logs, `.htaccess`, config, and permissions. The job does not automatically roll back data after an HTTP request may have upgraded it. Staging is retained for diagnosis. |
| Automatic migration reports an error | Preserve the private data and migration backups; use [PROFILES.md](PROFILES.md). Do not reset `state.json`. |

For manual recovery, stop new requests first, inspect the private snapshot's `files.json`, and restore matching code carefully. Do not restore an old `state.json` blindly: doing so loses accounts and point awards created since that snapshot. Prefer fixing code/config forward. A live Hostinger deployment remains unverified until you configure the secrets/variables and a real deploy job succeeds.

