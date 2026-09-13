# Production deployment

Run one application container with persistent `/app/data`; both entries share
SQLite, accounts, roles and nutrition data. The supported path on `svc-01` is:

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
Before deploying, create `DATA_PATH`, writable by UID/GID 1000, and back up the
entire directory for existing installations.

| Variable | Value |
| --- | --- |
| `APPLICATION_URL` | Exact public HTTPS origin, initially `https://calorie.dagdappshub.com`. No credentials, path, query or fragment. |
| `DATA_PATH` | Persistent host directory, for example `/srv/open-calory-tracker/data`. |
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

Photo provider/model/auth settings retain the Compose defaults. Optional catalog
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
   food-log, goals, catalog upload/notifications, AI settings, member management,
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

After a successful recovery, sign in with the displayed temporary password.
Only password replacement and logout are available until a new private password
is saved; that replacement rotates the session and restores normal
administrator access. If the current private password is still known, use the
authenticated password-change page in Settings instead of this recovery
command.

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

## Connect AI from Settings

For a local process, sign in as the administrator and open **Settings → AI photo
estimates → Connect OpenAI**. Follow the browser authorization link and approve.
Pi receives the callback on `localhost:1455` and Settings detects completion
automatically. This does not require entering a code or token or enabling
device-code login.

The browser and the Pi process must share the same localhost. A browser on a
different machine, or on the host while Pi runs in the default isolated Compose
network, cannot reach that callback directly. Do not expose the callback publicly;
use a trusted loopback tunnel or provision Pi's auth file on the application host.

The default Compose configuration persists the connection at
`DATA_PATH/pi/auth.json` on the host. Preserve the existing `DATA_PATH` when
updating. No extra AI variables are required for the default provider and model;
Install USDA Foundation in **Settings → Food Catalogs** for local food search, photo evidence, and logging; see [installation and source policy](local-usda-catalog.md). No USDA API key is used at runtime.
See [photo-analysis.md](photo-analysis.md#operator-setup) for reconnect,
disconnect, and provider prerequisites.

## Updates and backups

### Recover an interrupted catalog update

Catalog imports run inside the single application process; there is no separate worker service to restart. After an application/container restart, sign in as the administrator and open **Settings → Food Catalogs**. Each source recovers independently:

1. A job interrupted before publication keeps the prior catalog active and removes its partial upload, staging data, database, and journal.
2. A job interrupted after publication confirms the replacement database's recorded size and provider schema before removing the prior generation. If confirmation fails, the prior complete generation is restored.
3. Select the same archive again with **Retry USDA Foundation installation** or **Retry Open Food Facts installation**. Upload bytes cannot be resumed.
4. If the page reports that no prior catalog is available, restore the application database and catalog directory from the same backup or perform a fresh catalog installation.

Do not delete UUID-named catalog files by hand. Startup removes abandoned artifacts while preserving both providers' active, retiring, and in-progress generations. A failed/interrupted catalog job does not rewrite Food Entries. See the [USDA](local-usda-catalog.md#operations-and-verification) and [OFF](local-off-catalog.md#resources-and-operations) guides for archive formats, free-space calculations, proxy limits, and source-specific errors.

Use a short maintenance window:

1. Stop the application so SQLite has no writer.
2. Back up the complete `DATA_PATH`, including the SQLite WAL-related files.
3. Pull and redeploy the Git stack.
4. Wait for readiness, then verify login and a known historical entry.

Migrations run before the HTTP listener starts. If startup logs
`startup_failed`, diagnose it before another restart. Preserve the failed data
directory during recovery; restore a complete backup to a new `DATA_PATH` and
use the application version that matches it. Never run an older application
against a database containing newer migrations.


OFF imports recommend the official product JSONL GZIP while preserving existing CSV generations. Defaults allow 16 GiB compressed, 96 GiB expanded, 32 GiB staged SQLite and 8 MiB per JSONL document. Set `OFF_CATALOG_MAX_UPLOAD_BYTES`, `OFF_CATALOG_MAX_EXPANDED_BYTES`, `OFF_CATALOG_MAX_DATABASE_BYTES` and `OFF_CATALOG_MAX_DOCUMENT_BYTES` in the application's environment for future archive growth. Provide up to 80 GiB free for the upload copy, staging and rollback/index work in addition to occupied storage. The expanded archive is streamed without an expanded disk copy. Reverse proxies need corresponding upload limits, buffering space and timeouts (for Nginx, `client_max_body_size 16g` and `proxy_request_buffering off`). A container-visible local-path command bypasses proxy upload limits and still uses all application resource/schema/integrity checks. See [OFF operations](local-off-catalog.md#resources-and-operations).
