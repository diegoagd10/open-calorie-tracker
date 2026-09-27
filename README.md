# Open Calory Tracker

## What it is

Open Calory Tracker is a private, self-hosted web application for tracking
nutrition and water. It helps people find existing foods, record what they
consume, set their own goals, compare daily totals, and revisit or correct past
entries.

## Why it exists

It was built for people who want a fast way to track nutrition and water
without manually transcribing food data or giving up control of their history.
The application keeps past records useful even when its external food catalog
changes or is temporarily unavailable, and presents progress factually without
coaching, judgment, or gamification.

## Deployment

For production configuration, deployment, updates, and backups, follow the
[production deployment guide](docs/deployment.md).

## Connect an external application

The [OAuth integration guide](https://diegoagd10.github.io/open-calory-tracker-docs/)
explains how to register a public or confidential client, request a Food Log
owner's permission, exchange an authorization code with PKCE, and call the
read-only Daily Food Log API. The guide is published from a dedicated public
repository.

## Install food catalogs from the terminal

Catalog installation is command-only. Food Catalogs in Settings shows installed
sources, official downloads and metadata-only update checks.

USDA Foundation powers **Search food**. Open Food Facts is installed only for
camera scans and manually entered barcode lookup; it is not included in text
search results.

1. Use Node 24 and the pinned pnpm. Run `pnpm install --frozen-lockfile` and
   `pnpm build` to build the server, import worker and command artifacts.
2. Start the application with `pnpm start` and your deployment configuration.
   In another terminal, use the same `DATABASE_PATH`, `CATALOG_DIRECTORY` (if
   overridden), and `PORT`, from the same application working directory. The
   command reads the running server's private `.local-import-token` in the
   catalog directory and uses its loopback-only authenticated API. No food API
   key or browser session is needed; the command must run on the server host.
3. Download the **Foundation Foods CSV ZIP** from [USDA's official
   downloads](https://fdc.nal.usda.gov/download-datasets/). Keep the ZIP compressed;
   JSON, Branded, FNDDS, SR Legacy and full-dataset archives are unsupported.
   Download the **product JSONL GZIP** (recommended for source-backed serving
   nutrition; tab-separated CSV GZIP remains supported) from [Open Food Facts's
   official data page](https://world.openfoodfacts.org/data); keep the `.gz`
   compressed. Place each archive in a non-empty, readable regular file (no
   symlinks), visible at the same absolute path to both command and server.
4. Run either command, independently:

```sh
pnpm catalog:import:usda -- /absolute/path/to/Foundation.zip
pnpm catalog:import:off -- /absolute/path/to/openfoodfacts-products.jsonl.gz
```

For Docker Compose, download into an `imports/` subdirectory of the host
`DATA_PATH` bind mount and make the files readable by the container's `node`
user. The image already includes the build and application configuration. Use
container paths, rather than the host's Downloads path:

```sh
docker compose exec -T application pnpm catalog:import:usda -- /app/data/imports/Foundation.zip
docker compose exec -T application pnpm catalog:import:off -- /app/data/imports/openfoodfacts-products.jsonl.gz
```

For another container manager, use `docker exec <application-container>` with
those same commands and container-visible paths. Installing from a terminal
outside the container does not make a host file visible inside it.

Run the same command with a newer archive or the same archive for deliberate
replacement/reimport. Progress and detailed errors appear in the terminal;
exit status is zero only for a persisted successful activation and nonzero for
failure, interruption or command/connection errors. Once accepted, backend work
continues independently of the command process. Losing the command connection
is not proof of failure: check catalog availability and server diagnostics before
retrying. On server restart, unfinished pre-activation work is interrupted and
partial artifacts are removed; run the command again with the full archive.
A published handoff is validated and recovered using the existing lifecycle.

All connected signed-in clients receive source-specific installed/updated
toasts on any application page. Failure/interruption toasts are administrator-only
and direct the operator back to the terminal. Each browser profile remembers
delivered outcomes for the signed-in account across navigation, refresh, and
browser restarts. A fetched batch is recorded together so refresh cannot walk
through an old outcome backlog, while another account or client still receives
its own notification. Only the newest successful outcome for each catalog is
queued; a later installation or replacement has a new outcome identity and can
notify again.
Prior valid catalogs remain available during replacement and after a failed
replacement; saved Food Entries retain their original nutrition and measurements.

See the [food catalog operations guide](docs/food-catalog-operations.md) for
storage, capacity, recovery, update uncertainty and end-to-end verification.

Camera barcode scanning requirements and privacy behavior are documented in
[the camera scanning guide](docs/barcode-scanning.md).

Plate photos: see [capture, corrections, encrypted provider setup, and live smoke verification](docs/photo-analysis.md).

## Contributing

Install the [local Git hook](docs/verification.md#pull-request-gate) with
`pnpm hooks:install`. Pushes run the deep verification suite and stop on failure.
After a successful push, create the PR with `pnpm pr:create`.
