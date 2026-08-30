# Production deployment

The supported production topology is one Open Calory Tracker container built by
Portainer from this GitHub repository, attached to the existing private Traefik
network, with one external Docker volume mounted at `/app/data`. Traefik is the
only host-facing HTTPS entry point. Do not publish an application host port and
do not run more than one writable application replica against the SQLite file.

## Prerequisites

Before creating the stack:

1. Point the application DNS name at the Traefik host and confirm the existing
   `websecure` entrypoint can serve TLS for it.
2. Find the exact external Docker network used by Traefik and its subnet CIDR.
   Portainer shows both under **Networks**; on the host,
   `docker network inspect <network-name>` shows the same IPAM subnet.
3. In Portainer, create an external volume named
   `open-calory-tracker-data`, or choose another stable name. Compose will not
   create or delete this external volume.
4. If this is an upgrade, stop the application and take an offline backup of the
   entire data volume before deploying code with new migrations.

The data volume contains the SQLite database and its WAL-related files. There is
no uploads or images volume.

## Create the Portainer Git stack

Use Portainer's Git repository build workflow with:

- Repository URL: `https://github.com/diegoagd10/open-calory-tracker.git`
- Repository reference: `refs/heads/main`
- Compose path: `docker-compose.yml`

The checked-in Compose file builds the checked-in multi-stage `Dockerfile` with
the frozen pnpm lockfile. Configure these stack environment values:

| Name | Required value |
| --- | --- |
| `APPLICATION_URL` | Exact canonical origin, for example `https://calories.example.com`; no credentials, path, query, or fragment. Production rejects non-HTTPS origins. |
| `DATA_VOLUME_NAME` | Existing external volume name; defaults to `open-calory-tracker-data`. |

Optional values:

| Name | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Internal-only application port exposed to attached Docker networks. The externally managed Traefik service must target the same port; Compose does not publish it on the host. |
| `TRUST_PROXY` | unset | Optional private IPv4 CIDR for a trusted reverse-proxy network. Leave unset to ignore forwarded client-IP headers and use the immediate proxy address. If set, prefixes from 16 through 32 are accepted; do not use `true`, a hop count, or a public network. |
| `FDC_API_KEY` | unset | USDA FoodData Central key. Store it as a Portainer secret value. Readiness remains healthy when USDA is unconfigured or unavailable. |
| `FDC_TIMEOUT_MS` | `5000` | USDA request timeout from 100 through 20000 milliseconds. |
| `AUTH_ARGON2_MEMORY_KIB` | `19456` | Argon2id memory cost; production cannot set less than the reviewed minimum. |
| `AUTH_ARGON2_PASSES` | `2` | Argon2id pass count; production cannot set less than the reviewed minimum. |

Keep `NODE_ENV=production`, `DATABASE_PATH`, and `MIGRATIONS_PATH` at their image
defaults. Do not set test-fixture variables in production. Seeds are not part of
container startup; test data creation remains explicit in the test harness.

Traefik routing is intentionally not declared in this Compose file. Configure
the existing Traefik installation through its established external mechanism:
route the hostname from `APPLICATION_URL` through the `websecure` TLS
entrypoint, attach the application to the appropriate proxy network outside this
Compose definition, target `PORT`, and use `/health/ready` as the service
healthcheck. Do not add a second HTTP/TLS entry point or publish the application
port on the host.

## Startup and updates

At startup the process opens `/app/data/open-calory-tracker.sqlite`, enables
foreign keys, WAL, and a five-second busy timeout, and serially applies every
pending reviewed migration inside a SQLite transaction. It then verifies the
migration journal, required pragmas, and a rollback-only write probe. The HTTP
listener is created only after all those checks succeed.

Use a brief maintenance window for redeployment:

1. Stop the existing application container so there is only one writer.
2. Back up the external data volume.
3. Ask Portainer to pull and redeploy the Git stack.
4. Confirm the build used `pnpm install --frozen-lockfile`, then wait for the
   container healthcheck and the externally managed Traefik readiness check to
   pass.
5. Exercise registration/login or the existing Food Log after a first deploy;
   after an update, verify a known historical Food Entry and Water Event.

A migration failure is fatal: the transaction is rolled back, the database is
closed, the server does not listen, and a structured `startup_failed` record is
written to stderr. Do not run seeds or repeatedly restart against an unexplained
failure.

## Backup and rollback

For a consistent file-level backup, stop the application first and archive the
whole external volume, not just the main `.sqlite` file. Retain the backup under
a release/date identifier and perform restore drills before relying on it.

The normal rollback path is a corrective forward migration in a new image. Do
not run an older application image against a database that has newer applied
migrations, and do not edit or delete an already-deployed migration.

For an emergency restore:

1. Stop the application and keep the failed volume unchanged for diagnosis.
2. Create a new external Docker volume with a distinct restore name.
3. Restore the complete offline backup into the new volume.
4. Set `DATA_VOLUME_NAME` to the restored volume and deploy the application
   version compatible with that backup.
5. Verify readiness and representative historical data before resuming normal
   use.

This approach keeps the failed volume recoverable and avoids partially
overwriting the only copy of production data.

## Health and logs

- `GET /health/live` returns process liveness without querying SQLite or USDA.
- `GET /health/ready` verifies the applied migration journal, SQLite pragmas,
  and writable storage with a rolled-back probe. It returns 503 when any local
  invariant fails. USDA availability does not affect it.
- The image healthcheck uses readiness. Configure the externally managed
  Traefik service healthcheck to use the same endpoint so traffic reaches only
  a fully migrated writable instance.

Logs are one JSON object per stdout/stderr line. Startup and request completion
records include an event name and timestamp; request records include a request
ID, method, path without query data, status, and duration. A valid inbound
`X-Request-ID` is preserved; otherwise the server creates one. Operational
logging redacts sensitive keys and configured password, session/CSRF token, and
API-key values. Do not enable a proxy access-log format that records cookies,
authorization headers, form bodies, or raw query strings.

## Release verification

Run the normal checks plus the opt-in real-container suite before deployment:

```sh
pnpm typecheck
pnpm typecheck:usda
pnpm test
pnpm test:browser
pnpm build
pnpm test:deployment
```

The deployment suite builds the final image and verifies its Node/Debian and
non-root runtime, production-only dependencies, configurable port, fresh and
replacement startup, persistent SQLite data, pending and failed migrations,
read-only storage, missing configuration, health behavior, and the Compose
topology. Its temporary images, containers, and volumes are removed at the end.
