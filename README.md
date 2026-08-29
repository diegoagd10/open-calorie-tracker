# Open Calory Tracker

The current application is the deployable walking skeleton for Open Calory
Tracker. It serves an English SSR readiness page, applies reviewed Drizzle
migrations to server-side SQLite before accepting traffic, and exposes separate
liveness and readiness endpoints.

## Local development

Requires Node 24.7 or newer on the Node 24 line and pnpm 11.19.0. Node 24.7
provides the asynchronous Argon2id implementation used for credentials.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The default development database is `data/open-calory-tracker.sqlite`. Override
it with `DATABASE_PATH`. The internal HTTP port defaults to `3000` and can be
changed with `PORT`. Set `APPLICATION_URL` to the exact external application
origin so state-changing requests can enforce strict Origin checks.

## Verification

```sh
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:browser
pnpm build
```

The TypeScript 7.0.2 compile spike exposed invalid declarations in stable
Drizzle 0.45.2 while dependency declaration checking was enabled. The project
therefore uses the newest prior stable TypeScript line, 6.0.3, and keeps the
Drizzle runtime call behind a small typed compatibility boundary. Application
compilation remains strict with `skipLibCheck` disabled.

## Container

Build the multi-stage Node 24 Debian-slim image:

```sh
docker build -t open-calory-tracker .
```

Run it with a persistent volume and a configurable internal port:

```sh
docker volume create open-calory-tracker-data
docker run --rm \
  --name open-calory-tracker \
  --mount source=open-calory-tracker-data,target=/app/data \
  --env APPLICATION_URL=https://calories.example.test \
  --env PORT=3000 \
  --publish 3000:3000 \
  open-calory-tracker
```

Production deployments should expose the container only through the private
Traefik network rather than publishing a host port. Persist `/app/data` across
replacement containers.

### Portainer

Create the stack from this Git repository and set **Compose path** to
`docker-compose.yml`. The stack builds the checked-in `Dockerfile`, stores the
SQLite database in the `application-data` volume, and publishes port `3001` by
default. The container listens on port `3000`; set `APP_PORT` in Portainer to
publish a different host port. Set `APPLICATION_URL` to the externally visible
HTTPS origin before putting the stack behind Traefik. If Traefik supplies
forwarded client addresses, set `TRUST_PROXY` to only its Docker network CIDR;
the persisted authentication abuse limits otherwise use the direct peer IP.
Argon2id defaults to the reviewed 19 MiB, two-pass, single-lane profile. The
deployment can raise `AUTH_ARGON2_MEMORY_KIB`, `AUTH_ARGON2_PASSES`, or
`AUTH_ARGON2_PARALLELISM` after measuring the server; minimums cannot be lowered
outside the isolated test environment, and a parameter change rehashes a
credential after its next successful sign-in.

After routing the service through a private Traefik network, remove the `ports`
mapping and attach the `application` service to that network instead.

- `GET /health/live` reports whether the HTTP process is alive.
- `GET /health/ready` verifies the reviewed migration, required SQLite pragmas,
  and a rollbacked write against application storage.
