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

Food search uses USDA FoodData Central from the server. Set `FDC_API_KEY` to a
registered data.gov key; the application remains usable without it, but catalog
search reports that it is not configured. `FDC_TIMEOUT_MS` defaults to 5000.
Never place the key in browser configuration or client-side environment files.

## Verification

```sh
pnpm typecheck
pnpm typecheck:usda
pnpm test
pnpm exec playwright install chromium
pnpm test:browser
pnpm build
```

The offline suite uses deterministic catalog fixtures. With a registered key,
run the opt-in provider spike separately:

```sh
FDC_API_KEY=... pnpm test:usda-live
```

The spike rejects `DEMO_KEY`; exercises representative, no-result, and GTIN
search/detail paths; records duplicate revisions, market and serving metadata,
and all seven nutrient null rates; checks energy precedence and fixed-point
scaling; and reports aggregate observed latency without logging the key.

The TypeScript 7.0.2 compile spike exposed invalid declarations in stable
Drizzle 0.45.2, so the project uses the newest prior stable TypeScript line,
6.0.3. Drizzle's declarations still fail declaration checking on that line (as
they do on 5.9), so `skipLibCheck` omits declaration-file implementation
checking. The application schema, typed Drizzle connection, queries, services,
routes, and tests are TypeScript sources and remain included in strict checking.

## Container

Build the production image directly from the repository and frozen lockfile:

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

Create the stack from this Git repository with `docker-compose.yml`. The
production Compose contract has no host port: it attaches the application to an
existing external Traefik network and mounts an existing external data volume.
It requires the canonical HTTPS origin, the Traefik network name and CIDR, and
the stable data-volume name before Portainer can render the stack. Traefik
routing remains in the existing external Traefik configuration; this stack does
not define router or service labels.

See [Production deployment](docs/deployment.md) for the exact Portainer values,
Traefik configuration, volume setup, migration/maintenance workflow, backups,
health behavior, logging, and emergency restore procedure.

- `GET /health/live` reports whether the HTTP process is alive.
- `GET /health/ready` verifies the complete migration journal, required SQLite
  pragmas, and a rolled-back write against application storage.
