# Production deployment

Run one application container with persistent `/app/data` and a separately
persisted `/app/secrets`; both entries share SQLite, accounts, roles and
nutrition data. The supported path on `svc-01` is:

```text
public HTTPS -> Cloudflare -> cloudflared on svc-01 -> localhost:3001 -> application:3000
LAN HTTP -> 192.168.4.21:3002 -> application:3002
```

These are distinct application listeners, even when Docker gives them the same
socket peer. The Tunnel mapping must stay bound to host loopback. Traefik used
by other services is not part of this application's path.

## Portainer stack values

Create the Git stack from `https://github.com/diegoagd10/open-calory-tracker.git`
with Compose path `docker-compose.yml` and the intended verified Git reference.
Before deploying, create `DATA_PATH` and `APPLICATION_SECRETS_MOUNT_PATH` as
distinct host directories writable by UID/GID 1000, and set the secrets
directory to mode `0700`. Back up the data and secrets with separate access
controls; a routine data backup must not contain both the credential ciphertext
and its master key.

| Variable | Value |
| --- | --- |
| `APPLICATION_URL` | Exact public HTTPS origin, initially `https://calorie.dagdappshub.com`. No credentials, path, query or fragment. |
| `DATA_PATH` | Persistent host directory, for example `/srv/open-calory-tracker/data`. |
| `APPLICATION_SECRETS_MOUNT_PATH` | Separate persistent host secrets directory, for example `/srv/open-calory-tracker/secrets`. It must have mode `0700`; do not place it under `DATA_PATH`. |
| `APPLICATION_SECRETS_PATH` | Generic in-container secrets directory and secrets-mount target, default `/app/secrets`; normally leave unchanged. |
| `APPLICATION_MASTER_KEY_PATH` | Optional generic 32-byte application-master-key file override. When omitted, it defaults to `application-master.key` inside `APPLICATION_SECRETS_PATH`. |
| `WEBAUTHN_ENROLLMENT_PREVIEW` | Optional WebAuthn enrollment preview. Defaults to `0`; set to `1` only for an isolated preview installation after reviewing [Key enrollment preview](#key-enrollment-preview). |
| `LAN_URL` | Optional exact HTTP server IP and port, initially `http://192.168.4.21:3002`. Any client with connectivity may use it. Omit it to disable LAN. |
| `LAN_BIND_IP` | Host IP for the LAN mapping, initially `192.168.4.21`. Keep it consistent with `LAN_URL`. |
| `LAN_HOST_PORT` | LAN host port, default `3002`. Keep it consistent with `LAN_URL`. |
| `HOST_PORT` | Private Tunnel host port, default `3001`; retain cloudflared's `localhost:3001` target. |
| `PORT` | Internal Tunnel listener port, default `3000`. |
| `LAN_PORT` | Distinct internal LAN listener port, default `3002`. |

`TRUST_PROXY` is obsolete and ignored. Remove it from the stack; a residual value
only emits a startup deprecation warning. No Docker CIDR discovery is needed.
The image owns `NODE_ENV`, `DATABASE_PATH` and migration paths; leave them unset.
If the server IP or external LAN port changes, update `LAN_URL` and its mapping
together. A disabled LAN listener can retain an unused Docker mapping, but no
application serves it.

Provider credentials and model choices are configured only through administrator
Settings; Compose has no provider selector, provider key, or provider auth-file
option. The application, running as UID/GID 1000, creates the generic master key
on first startup with mode `0600`. Losing only the secrets mount leaves accounts,
meals, history and catalogs intact, but encrypted external credentials become
unreadable and must be entered again in Settings.
Optional catalog
limits and storage configuration are described in [USDA operations](local-usda-catalog.md),
[OFF operations](local-off-catalog.md) and the [catalog workflow](food-catalog-operations.md).
No USDA/OFF lookup API credentials are needed. Barcode and food lookups use the
installed local SQLite generations.

## Configure and restrict the Tunnel

Keep the public hostname's Tunnel service at `http://localhost:3001` on `svc-01`.
The backend must receive `Host: calorie.dagdappshub.com` (or the exact authority
of `APPLICATION_URL`). Check the effective **HTTP Host Header** override: remove
an incompatible override or set it to that authority. Forwarded host/protocol
headers cannot override the application's configured origin.

Cloudflare must deliver one valid IPv4/IPv6 `CF-Connecting-IP`. Disable the
**Remove visitor IP headers** Managed Transform for this hostname. Normal
requests missing this information return a connection verification error before
routing; logs distinguish missing and invalid information without printing the
header. There is no fallback to the connector IP. Health checks remain usable
without visitor headers; a direct curl to `/login` on the private port is expected
to fail. `CF-Connecting-IP` identifies a rate-limit subject, not an authenticated
user. Shared public IPs share existing counters; distributed attacks retain the
existing limiter's limitations.

The loopback mapping is only one part of the trust boundary. Verify that LAN and
Internet cannot reach the internal Tunnel listener through direct container
routing, alternate mappings, IPv6 exposure or firewall exceptions. Keep Docker
direct routing disabled or explicitly block remote access to that listener, and
do not attach untrusted workloads to its Docker network. Host processes and any
Docker workloads able to reach the listener directly are trusted infrastructure;
record their inventory during deployment. An unpublished container port remains
reachable to workloads on the same network. Do not globally trust a Docker gateway
or assume the container sees a loopback peer.

## Claim a new instance before public exposure

Disconnect the public Tunnel route on an unclaimed database. Enable LAN only on
a trusted local network (or use a private host-forwarded LAN path with its exact
configured authority), register the first administrator and finish setup. Confirm
an anonymous `/register` redirects to `/login`, then enable the public route.
The first-registration model is unchanged; there is no bootstrap token.
Existing migrations preserve users, password hashes and public sessions.

## Verify the deployment

Implementation tests do not replace these checks on the deployed host. This
change does not alter live Tunnel or firewall configuration.

1. Inspect host bindings (`docker compose port application 3000`, host socket
   inventory and Docker network/firewall configuration). Verify loopback-only
   `3001` and the exact LAN IP/port mapped to a different internal listener.
   From a LAN client, both host port `3001` and direct container Tunnel port must
   be unreachable; test alternate mappings and IPv6 too. Record trusted workloads.
2. Confirm Portainer health and public/LAN `/health/ready` return 200. Confirm
   `/login` works through Cloudflare with the expected Host and visitor header;
   inspect missing/invalid-header diagnostics if it fails. Health alone does not
   verify authentication or visitor IP delivery.
3. In real desktop and phone browsers, register/setup on a new database as
   appropriate, then independently sign in at the public and LAN URLs. Perform
   food-log, goals, terminal catalog imports/notifications, AI settings, member management,
   password and photo actions with appropriate fixtures/permissions. Logout in
   one browser/entry must leave another independently logged-in session active.
4. Confirm public cookies retain `__Host-calorie_session` and
   `__Host-calorie_auth_csrf` with Secure, HttpOnly, SameSite=Lax, Path=/ and no
   Domain. LAN cookies use separate `calorie_lan_session` and
   `calorie_lan_auth_csrf` names without Secure. Existing public sessions should
   remain valid within their normal expiry/revocation lifecycle.
5. Check rejected external/null origins, unknown authorities and invalid CSRF,
   and verify member/admin permissions. Forwarded headers on LAN cannot select
   the public mode or visitor IP and cannot authorize internal imports.

HTTP LAN carries credentials and sessions without encryption, as explicitly
accepted for this deployment. Camera scanning and other secure-context features
are not guaranteed there; manual barcode input remains available. Cookies do not
isolate services by port on the same IP. Sessions are independent per entry and
browser; password changes/recovery still revoke other sessions under the existing
security policy, while logout only revokes the session used.

## Recover a forgotten administrator password

If the sole administrator no longer knows the current password, run the local
recovery command inside the running application container. The web service does
not need to be stopped:

```sh
docker compose exec -T application node build/recovery/recover-administrator.js
```

For a Portainer-managed container, use its actual container name:

```sh
docker exec -i <application-container> node build/recovery/recover-administrator.js
```

Run this from a private terminal. The one line written to standard output is a
new, one-time temporary password. Do not redirect it to a file, paste it into
chat or a ticket, include it in a screenshot, or retain it in terminal logs.
Copy it directly into a password manager or the login form, then clear the
terminal display.

The command uses the container's configured `DATABASE_PATH` and migrations. It
finds the account by the `admin` role, replaces its credential, and revokes all
administrator sessions in one transaction. A redacted outcome is written to
standard error. If there is no administrator or the database does not contain
exactly one administrator, the command exits unsuccessfully, prints no
password, and changes nothing.

Password recovery preserves key login and every saved key, and invalidates
pending proofs. If key login is enabled, the temporary password cannot sign in
until key login is deliberately disabled using the separate command below.

After a successful recovery, sign in with the displayed temporary password.
Only password replacement and logout are available until a new private password
is saved; that replacement rotates the session and restores normal
administrator access. If the current private password is still known, use the
authenticated password-change page in Settings instead of this recovery
command.

## Recover lost administrator keys

If all keys belonging to the sole administrator are unavailable, a local
operator can restore password sign-in without providing a key proof. Run this
separate command inside the running production container:

```sh
docker compose exec -T application node build/recovery/recover-administrator-keys.js
```

For Portainer, use the actual container name:

```sh
docker exec -i <application-container> node build/recovery/recover-administrator-keys.js
```

For a local production build, `pnpm admin:recover:keys` runs the same command.
Use the application's configured `DATABASE_PATH` and `MIGRATIONS_PATH` (default
`drizzle` directory). Local operator/container access is required; there is no
HTTP recovery endpoint. The web service may remain running.

In one transaction, the command finds the sole administrator by role, disables
key login, advances authentication policy state, and revokes all administrator
sessions and pending proofs across public and LAN entries. It preserves the
password, every registered key, account identity, role, restrictions, and
nutrition data. Running it again safely revokes any remaining password sessions
and pending proofs while keeping password mode. Success exits with status 0
and a confirmation; failures exit nonzero with a redacted outcome. No password
or credential material is printed. Missing/multiple administrators or a missing
password credential prevent recovery; storage/revocation failures roll back
the entire operation.

Sign in with the unchanged password, then inspect the retained keys in Security
and delete lost keys before re-enabling key login. If the password is also lost,
run the separate password-recovery command above. That operation issues a
temporary password and still requires replacement at the next sign-in; key
recovery does not clear that restriction. Password recovery alone never
disables key login.

## Import food catalogs from the container

Large catalog archives can be imported from a private container terminal instead
of passing through the public reverse proxy. First copy the archive into the
persistent data volume. A conventional location is `/app/data/imports`; create
it if necessary and keep the source archive there until the import succeeds.

Run the provider-specific command inside the running application container:

```sh
docker compose exec -T application pnpm catalog:import:usda -- /app/data/imports/FoodData_Central_foundation_food_csv.zip
docker compose exec -T application pnpm catalog:import:off -- /app/data/imports/openfoodfacts-products.jsonl.gz
```

For a Portainer-managed container, open its console and run the corresponding
`pnpm` command directly, or replace `docker compose exec -T application` with
`docker exec -i <application-container>`. The path must name a non-empty regular
file visible inside the container; symbolic links are rejected.

The command uses the same configured database, catalog directory, limits,
locking, import worker, persisted progress, and atomic generation handoff as the
Food Catalogs settings page. It stays attached until the import reaches a
terminal outcome, reports progress to standard output, and exits non-zero on
failure or interruption. The source archive is never deleted automatically.
The catalog directory's `.local-import-token` authorizes only this loopback
control channel; keep it private and do not expose or edit it.
After success, verify the installed generation in **Settings → Food Catalogs**,
then remove the copied source archive if it is no longer needed. Do not remove
UUID-named files from the catalog directory.

## Configure Photo Analysis credentials

Sign in as the administrator and open **Settings → AI photo estimates**. Enter
the Gemini and TypeSafe API keys together. The application validates both before
atomically replacing the encrypted shared bundle; it never returns saved values
to the browser. Replacing the pair needs no additional password or key ceremony.
Deletion requires checking the explicit confirmation and affects future bundle
reads without deleting users, meals, Food Entries, history or catalogs.

Replacement validates both new keys before atomically replacing the working
pair. A validation failure leaves the previous pair active. Deletion disables
new starts, corrections, and retries; attempts that already captured a pair may
finish. Keys belong in Settings, not Compose variables, shell profiles, catalog
directories, or deployment logs.

The encrypted bundle lives in the application database, while its AES-256-GCM
master key lives only at `APPLICATION_MASTER_KEY_PATH`. Persist the secrets mount
across container replacement and keep its containing directory at mode `0700`.
If that key file is missing, startup creates a new one, Settings reports that the
old bundle needs re-entry, and saving a newly validated pair replaces the
unreadable row.

Back up the master key with the secrets mount under access controls separate from
the data backup. Restoring credentials requires the database ciphertext and the
matching master key. If the key is lost, do not restore or copy arbitrary key
bytes: allow the service user to create a replacement, sign in as administrator,
and re-enter both provider keys. Key loss does not recalculate or remove existing
Photo Analysis history.

## Verify Photo Analysis readiness

After saving the Gemini and TypeSafe credential pair, select available models and
thresholds in **Settings → AI photo estimates**. Install or reimport USDA
Foundation from the terminal workflow, then confirm **New-attempt readiness** is
**Ready**. The readiness card links to Food Catalogs when catalog recovery is
required. Do not expose provider keys as environment variables or copy them into
the catalog directory.

Gemini receives the validated image and bounded meal/correction context. TypeSafe
receives Gemini's structured observations and bounded locally installed USDA
category/candidate descriptions, not the image. The application validates the
choices and performs authoritative USDA arithmetic locally. Every attempt has
one ten-second deadline; a provider, schema, catalog, or deadline failure leaves
the attempt failed and requires an explicit retry.

Install USDA Foundation with the [terminal workflow](../README.md#install-food-catalogs-from-the-terminal) for local food search, photo evidence, and logging; Food Catalogs shows availability and update checks. No USDA API key is used at runtime.
See [photo-analysis.md](photo-analysis.md#operator-setup) for provider and
readiness details.

## Upgrade from the retired photo provider

Redeploying this release does not recalculate existing photo history or Food
Entries. Manual USDA search, barcode/OFF lookup, and other Food Entry methods are
unchanged. An older USDA generation remains available to manual search but must
be reimported normally before it can support new photos.

The application no longer reads, writes, or deletes the legacy credential file
at `data/pi/auth.json`; it has no retired-provider fallback or selection switch.
Leave that operator-owned file untouched during this deployment. Only after the
Gemini/Jev live smoke and deployed Photo Analysis are verified should the human
operator follow `TKT-aab75c6c` to remove that exact file in a maintenance window.
Application automation must not perform that cleanup.

## Updates and backups

### Recover an interrupted catalog update

Catalog imports run inside the single application process; there is no separate worker service to restart. After an application/container restart, sign in as the administrator and open **Settings → Food Catalogs**. Each source recovers independently:

1. A job interrupted before publication keeps the prior catalog active and removes its partial upload, staging data, database, and journal.
2. A job interrupted after publication confirms the replacement database's recorded size and provider schema before removing the prior generation. If confirmation fails, the prior complete generation is restored.
3. Rerun `pnpm catalog:import:usda -- PATH` or `pnpm catalog:import:off -- PATH` on the running server with the full server-visible archive, following the [README workflow](../README.md#install-food-catalogs-from-the-terminal). Partial imports cannot be resumed.
4. If Food Catalogs shows the source as not installed, restore the application database and catalog directory from the same backup or perform a fresh catalog installation.

Do not delete UUID-named catalog files by hand. Startup removes abandoned artifacts while preserving both providers' active, retiring, and in-progress generations. A failed/interrupted catalog job does not rewrite Food Entries. See the [USDA](local-usda-catalog.md#operations-and-verification) and [OFF](local-off-catalog.md#resources-and-operations) guides for archive formats, free-space calculations, archive limits, and source-specific errors.

Use a short maintenance window:

1. Stop the application so SQLite has no writer.
2. Back up the complete `DATA_PATH`, including the SQLite WAL-related files. Back
   up `APPLICATION_SECRETS_MOUNT_PATH` separately with tighter access controls;
   do not merge it into the routine data backup.
3. Pull and redeploy the Git stack.
4. Wait for readiness, then verify login and a known historical entry.

Migrations run before the HTTP listener starts. If startup logs
`startup_failed`, diagnose it before another restart. Preserve the failed data
directory during recovery; restore a complete backup to a new `DATA_PATH` and
use the application version that matches it. Never run an older application
against a database containing newer migrations.

OFF imports recommend the official product JSONL GZIP while preserving existing CSV generations. Defaults allow 16 GiB compressed, 96 GiB expanded, 32 GiB staged SQLite and 8 MiB per JSONL document. Set `OFF_CATALOG_MAX_UPLOAD_BYTES`, `OFF_CATALOG_MAX_EXPANDED_BYTES`, `OFF_CATALOG_MAX_DATABASE_BYTES` and `OFF_CATALOG_MAX_DOCUMENT_BYTES` in the application's environment for future archive growth. Provide up to 80 GiB free for the staged compressed archive, staging and rollback/index work in addition to occupied storage. The expanded archive is streamed without an expanded disk copy. The command submits a container-visible local file path, so public reverse-proxy upload limits do not apply; all application resource/schema/integrity checks remain enforced. See [OFF operations](local-off-catalog.md#resources-and-operations).

## Key enrollment preview

TKT-a82279ff, TKT-352998d7, and TKT-647394a7 add WebAuthn enrollment, multiple
named keys, username/key sign-in, and an account-level key-login toggle.
Enrollment is off by default: `WEBAUTHN_ENROLLMENT_PREVIEW=1` enables it only for
an isolated preview installation. Do not enable it on the production stack until
the parent spec's key management and recovery tickets are complete. The standard
Compose stack forwards this opt-in flag and defaults it to `0`. Already enrolled
preview accounts continue to require their key if the flag is reset or removed.

Credentials use the exact HTTPS `APPLICATION_URL` origin and its hostname as the
RP ID. Development at HTTP localhost uses separate credentials; an HTTP LAN IP
cannot enroll or authenticate a key. Personal security navigation on LAN redirects
to public HTTPS without transferring session or proof tokens. Password-mode
accounts retain their existing LAN access. Enabling key login retains the password
hash, replaces ordinary password login, revokes older public/LAN sessions and
pending ceremonies, and rotates the verified current session without extending
its absolute lifetime. Password reset preserves key mode and mandatory password
replacement; it does not provide a password-login fallback.

Security settings list each account's named keys. Adding a key while key login
is enabled first requires fresh verification with an existing key. Registration
and verification of the new key must then complete within the original five-minute
ceremony window. Any saved key can sign in; enrollment order grants no extra
permissions. Adding to retained keys in password mode preserves password mode
without an additional account-password prompt. Names identify credentials for the
user; they do not certify hardware provenance.

Disabling key login requires fresh verification with any saved key, preserves all
keys and password material, invalidates sessions and pending ceremonies, and
returns to password sign-in. Saved keys cannot sign in while disabled. After
password sign-in, re-enable explicitly by verifying a retained key; there is no
additional account-password prompt. That proof authorizes only re-enabling.
Successful re-enabling invalidates older public/LAN sessions and pending attempts
and rotates the current session with its original absolute expiry. Failed,
canceled, expired, replayed, or superseded attempts leave the mode unchanged.
Accounts with no keys must enroll their first key instead.

The account-password form uses fresh registered-key verification while key login
is enabled. No old account password is needed, and the change preserves key mode
and every saved key. The new fallback password becomes usable for sign-in only
after deliberate disable/recovery. In password mode, the form still requires the
current password. Password resets preserve keys/mode and mandatory replacement:
a restricted key-authenticated user can replace the temporary password with a
key, but cannot use application settings beforehand or reuse that temporary
password. Replacement revokes older sessions and pending proofs and rotates the
current session without extending its absolute deadline. This maintenance flow
remains available to enrolled preview users when enrollment preview is turned off.

Member recovery is available in Users on public HTTPS. An already signed-in
administrator confirms the target username and freshly verifies their own password
or a saved administrator key. The administrator password is accepted for this
recovery action even in key mode; it never enables ordinary password sign-in or
personal key/password changes. Recovery disables the member's key login, preserves
their password and all saved keys, and atomically revokes their sessions and pending
proofs across public/LAN entries. Disabled members remain disabled and mandatory
password replacement remains required. Already-disabled recovery reports that
state and still revokes remaining authentication. Invalid or stale targets must be
refreshed and confirmed again. The five-attempt limit per administrator lasts
15 minutes and persists across restarts. Recovery remains available if enrollment
preview is turned off. After password sign-in, members can inspect retained keys,
delete lost keys with fresh password proof, and re-enable using a retained working
key. If the password is also lost, use the separate password-reset operation.
Administrators cannot enroll or delete member keys through recovery.

Automated verification uses real signed ES256 protocol fixtures, Chromium virtual
authenticators, and a non-loopback HTTP listener. Actual YubiKey USB/NFC and
Proton Pass extension/mobile enrollment and sign-in remain required before a
parent release compatibility claim. Touch-only U2F keys cannot satisfy the required
user verification. A key's PIN/biometrics is separate from the account password.
