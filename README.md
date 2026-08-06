# Daily Intake

A local, single-user nutrition ledger for reusable serving-based foods, dated
food snapshots, hydration, daily comparison targets, and weight history.

## Requirements

- Node.js 22 or newer
- pnpm 11

## Development

Install dependencies and start the app:

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

The SQLite database is created automatically at `data/calories.db`. Override its
location with `DAILY_INTAKE_DB_PATH` (or the legacy `CALORIE_DB_PATH` variable).
Existing `calorie_entries` rows are migrated into editable legacy food snapshots
with unavailable nutrients represented as zero.

## Verification

```bash
pnpm test
pnpm lint
pnpm build
```

Tests follow the repository, business-logic, and HTTP API seams. They use in-memory or temporary SQLite databases and do not modify local application data.

## Docker and Portainer

For the Portainer **Repository** deployment method, use these values:

- Repository URL: `https://github.com/diegoagd10/open-calory-tracker.git`
- Repository reference: `refs/heads/main`
- Compose path: `docker-compose.yml`

Do not include `/tree/main` in the repository URL. Portainer clones the repository,
then the Compose file builds the included `Dockerfile`. `pull_policy: build` makes
Portainer rebuild the image when the repository is redeployed.

The image can also be built and published outside Portainer when the target
Portainer version does not support Git-based Compose builds:

```bash
docker build -t ghcr.io/diegoagd10/open-calory-tracker:1.0.0 .
docker push ghcr.io/diegoagd10/open-calory-tracker:1.0.0
```

The image uses Next.js standalone output and runs as a non-root user on port 3000.
Set `DAILY_INTAKE_IMAGE` to that published tag when using the image-only fallback.
Set `DAILY_INTAKE_PORT` only if the host should expose a port other than 3000.
The `open-calory-tracker-data` named volume keeps the SQLite database when the
container is replaced; back up that volume before removing it.
