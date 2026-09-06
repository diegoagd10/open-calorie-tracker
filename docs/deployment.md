# Production deployment

The checked-in `docker-compose.yml` publishes one host port. Traefik terminates
HTTPS and forwards requests to that port:

```text
browser -> Traefik HTTPS -> Docker host:HOST_PORT -> application:PORT
```

Run one application container. SQLite supports only one writable application
replica, and `/app/data` must persist across container replacements.

## Values to collect

Configure these Portainer stack variables:

| Variable | Value |
| --- | --- |
| `APPLICATION_URL` | Exact public HTTPS origin (scheme and host, plus an optional port), for example `https://calories.example.com`. |
| `DATA_PATH` | Existing host directory that will be mounted at `/app/data`, for example `/srv/open-calory-tracker/data`. Back up this entire directory. |
| `HOST_PORT` | Unused port on the Docker host that Traefik will target, for example `3001`. Defaults to `3000`. |
| `TRUST_PROXY` | Subnet CIDR of the application's Docker network. Follow the next section. |

Optional variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `FDC_API_KEY` | unset | USDA FoodData Central key. Store it as a secret value. Food search reports that it is unconfigured when omitted. |
| `FDC_TIMEOUT_MS` | `5000` | USDA request timeout in milliseconds; accepted range is 100 through 20000. |
| `OPEN_FOOD_FACTS_CONTACT_EMAIL` | unset | Contact email included in the required Open Food Facts `User-Agent`. Barcode lookup reports that it is unconfigured when this is omitted or blank; startup, USDA search, and saved Food Entries remain available. |
| `PORT` | `3000` | Internal application port. Keep the default unless Traefik and the published port mapping are updated with it. |

The image owns `NODE_ENV`, `DATABASE_PATH`, and the migrations path. Leave them
unset in Portainer.

Open Food Facts product reads leave only from the application server. They use
the read-only v3 API with the identifying `User-Agent`; no Open Food Facts login,
access token, or browser-side provider request is used. The server must have
outbound HTTPS access to `world.openfoodfacts.org`. Open Food Facts currently
limits product reads to 15 requests per minute per IP and can also return global
503 responses, so lookup availability is not guaranteed. The application
coalesces repeated concurrent lookups and keeps only a small in-memory cache.

Keep `APPLICATION_URL` on HTTPS in production. Barcode camera work requires a
browser secure context; the manual barcode field remains available without a
camera. This release provides manual entry and product review only and does not
upload or download product images.

## Set `TRUST_PROXY` exactly

When running the compiled application directly on the host behind a local HTTPS
proxy such as Tailscale Serve, use `TRUST_PROXY=127.0.0.1/32` and set
`APPLICATION_URL` to the external HTTPS origin. This trusts only the proxy's
IPv4 loopback connection. Build with `pnpm build` and run with `pnpm start` for
mobile testing; development dependency URLs can become stale during other builds
or tests and prevent browser hydration.

For Docker deployments, follow the subnet configuration below.

`TRUST_PROXY` is the subnet of the network attached to the **application**
container. It is not the application IP, the Traefik container's network, the
Docker host's LAN IP, or a public IP.

On the first deployment, the application network does not exist yet. Use
`192.168.255.255/32` as a temporary value and keep Traefik disconnected. After
Portainer creates the stack:

1. Open the application container and note its connected network name.
2. Open **Networks**, select that network, and copy **IPAM > Subnet**.
3. Replace the temporary value with that complete CIDR and redeploy the stack.

The same lookup on the Docker host is:

```sh
docker inspect <application-container> \
  --format '{{range $name, $network := .NetworkSettings.Networks}}{{println $name}}{{end}}'

docker network inspect <application-network> \
  --format '{{range .IPAM.Config}}{{println .Subnet}}{{end}}'
```

Example:

```text
application IP: 172.22.0.2
network gateway: 172.22.0.1
network subnet: 172.22.0.0/16
TRUST_PROXY: 172.22.0.0/16
```

Use the subnet exactly as reported before connecting Traefik. A wrong CIDR can
leave pages and health checks working while registration, login, and other
mutations fail with `400 Bad Request`: Express then ignores Traefik's forwarded
HTTPS protocol and React Router rejects the apparent HTTP/HTTPS origin mismatch.

## Create the Portainer stack

Create a Git stack from
`https://github.com/diegoagd10/open-calory-tracker.git`, reference
`refs/heads/main`, with Compose path `docker-compose.yml`.

Before deployment, create `DATA_PATH` on the Docker host and make it writable
by the image's `node` user (UID/GID 1000). Enter the variables from the tables
above, deploy, discover the application network subnet, and replace the
temporary `TRUST_PROXY` value.

The container is ready when Portainer reports it healthy and
`GET /health/ready` returns 200.

## Claim a new instance before public exposure

A database with no users is intentionally unclaimed. The first successful
registration becomes the sole administrator, receives an authenticated session,
and closes public registration. There is no bootstrap token or second approval.

Keep Traefik disconnected from a new instance until you have opened the
application through a trusted local path, registered the administrator, and
finished the nutrition setup. Afterward, verify that an anonymous request to
`/register` redirects to `/login`; only then expose the instance publicly.

Existing installations are claimed automatically during migration: the oldest
user becomes the administrator and all other legacy users become members. Their
usernames, password hashes, sessions, and nutrition data are preserved.

## Configure Traefik

Route the hostname from `APPLICATION_URL` through the existing `websecure`
entrypoint. In the Traefik service, use the Docker host's LAN address and
`HOST_PORT`:

```yaml
services:
  open-calory-tracker:
    loadBalancer:
      servers:
        - url: "http://192.168.1.10:3001"
```

Replace the hostname, Docker host address, and port with the values from your
environment. Use `/health/ready` for the Traefik service health check when the
existing Traefik configuration supports one.

## Verify the deployment

Complete all checks after the initial deployment or a configuration change:

1. Confirm Portainer reports the container as healthy.
2. Confirm `https://<hostname>/health/ready` returns 200.
3. On a new database, claim the administrator before connecting the public
   route; on an existing database, sign in with the oldest account. This verifies
   `TRUST_PROXY`, forwarded HTTPS, cookies, CSRF protection, and writable SQLite
   storage together.
4. Confirm the container logs contain a successful POST rather than
   `singleFetchAction` followed by `400 Bad Request`.

If step 3 fails with `400 Bad Request`, inspect the application's current
network again. Docker may assign a different subnet when a network is recreated;
update `TRUST_PROXY` and redeploy.

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

## Connect AI from Settings

After deployment, sign in as the administrator and open **Settings → AI photo
estimates → Connect OpenAI**. Follow the OpenAI link, enter the displayed code,
and approve. Settings detects completion automatically. This works from a phone
without opening a container console or exposing an OAuth callback port.

The default Compose configuration persists the connection at
`DATA_PATH/pi/auth.json` on the host. Preserve the existing `DATA_PATH` when
updating. No extra AI variables are required for the default provider and model;
`FDC_API_KEY` remains the optional operator-supplied key for USDA lookup.
See [photo-analysis.md](photo-analysis.md#operator-setup) for reconnect,
disconnect, and provider prerequisites.

## Updates and backups

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
