<img src="assets/icon.svg" width="64" height="64" alt="">

# open-calorie-tracker

Created in [T3 Code](https://t3.codes).

## Stack

- `apps/web` — Next.js (App Router, TypeScript, Tailwind)
- `apps/api` — NestJS + Drizzle ORM (SQLite)
- `packages/shared` — login schema (zod) and auth constants used by the web app, the API and the tests

## Development

```bash
pnpm install
pnpm --filter web exec playwright install chromium   # browser tests
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm --filter api db:seed     # creates the development user (SEED_USER_* in apps/api/.env)
pnpm dev:api                  # http://localhost:3001
pnpm dev:web                  # http://localhost:3000
pnpm --filter @open-calorie-tracker/shared dev   # only when editing packages/shared
```

## Code quality ([Vite+](https://viteplus.dev))

```bash
pnpm check      # TypeScript-only rule + format + lint + type check
pnpm check:fix  # same, auto-fixing format and lint issues
pnpm lint       # vp lint (Oxlint)
pnpm fmt        # vp fmt (Oxfmt)
pnpm test       # vp test (Vitest)
pnpm test:cov   # tests with coverage; fails below 95% of statements
```

`packages/shared` is built with `vp pack` on `pnpm install`, on `pnpm build` and before the tests;
while editing it, keep its `dev` script running in watch mode.

The web tests run `next build`, and Next.js locks its build directory while `next dev` runs, so
stop `pnpm dev:web` before running them. They start two environments, one with the seed user and
one without users, on ports 3100–3102 and 3200–3202. To run them next to another checkout's tests,
pick other ports with `WEB_TEST_BASE_PORT` (the second environment uses the base port + 100):

```bash
WEB_TEST_BASE_PORT=4100 pnpm --filter web exec vp test run
```

Lint and format settings live in the root `vite.config.ts`; test settings live in each package's
`vite.config.ts`.

## Deployment

`docker-compose.yml` runs the API and the web app from the `Dockerfile` (targets `api` and `web`),
each published on the host's loopback for a tunnel or reverse proxy in front. The API runs its
migrations on startup and keeps its SQLite database in `DATA_PATH`. Put the variables in a `.env`
beside the compose file (`chmod 600`):

| Variable                         |                                                                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`                     | Required. Random, at least 32 characters (`openssl rand -hex 32`).                                                                              |
| `API_KEY_SECRET`                 | Required. Random, at least 32 characters. Changing it makes stored API keys unreadable.                                                         |
| `OPEN_FOOD_FACTS_USER_AGENT`     | Required. Names the app and a contact to Open Food Facts, e.g. `OpenCalorieTracker/0.0.1 (https://github.com/diegoagd10/open-calorie-tracker)`. |
| `DATA_PATH`                      | Required. Host folder for the database, writable by UID 1000.                                                                                   |
| `WEB_HOST_PORT`, `API_HOST_PORT` | Host ports, 3010 and 3011 by default.                                                                                                           |
| `WEB_BIND`, `API_BIND`           | Host addresses, `127.0.0.1` by default.                                                                                                         |
| `TRUST_PROXY`                    | Express "trust proxy", `loopback, uniquelocal` by default.                                                                                      |

```bash
docker compose up -d --build
docker compose ps   # both services healthy
```

A new database sends every visitor to `/register` until the first account exists, so register
before exposing the web app. Back up by stopping the stack and copying `DATA_PATH`.

To update, replace the source with the new commit (keeping `.env` and
`docker-compose.override.yml`) and run `docker compose up -d --build`; migrations run on startup.
Tag the running images first to be able to go back.

### Automatic deploys

`.github/workflows/deploy.yml` ships the tip of `main` after CI passes. It publishes both images to
GHCR under the commit SHA, joins the tailnet for one job and runs `deploy/calorie-deploy` on the
server over SSH. The script backs up the database, starts the new version, checks `/v1/health` and
`/login`, and goes back to the previous version when they fail. It restores the backup only when
the new version migrated the database, and then keeps the newer database beside the backup.

It stays off until it is set up:

1. Server: copy `deploy/calorie-deploy` to `~/bin/` and add the deploy key to
   `~/.ssh/authorized_keys` as
   `restrict,command="$HOME/bin/calorie-deploy" ssh-ed25519 …`. The user needs Docker access,
   `sqlite3`, `flock` and `curl`, and the stack in `~/stacks/calorie` must already run. Later changes
   to the script or `docker-compose.yml` are copied by hand.
2. Tailscale: create `tag:ci`, allow it only the server's SSH port, and add a federated identity
   with the `auth_keys` scope for the subject
   `repo:diegoagd10/open-calorie-tracker:environment:production`.
3. GitHub: create the `production` environment, limited to `main`, with the variables
   `TS_OAUTH_CLIENT_ID` and `TS_AUDIENCE` and the secrets `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`,
   `DEPLOY_HOST` and `DEPLOY_USER`.
4. Run the Deploy workflow by hand with `check`, then with `deploy`. After the first publish, make
   both GHCR packages public if they are private, or the server cannot pull them.
5. Set the repository variable `DEPLOY_ON_MERGE` to `true`.

| Result            | Exit code | Meaning                                                             |
| ----------------- | --------- | ------------------------------------------------------------------- |
| `deployed`        | 0         | The new version runs. `already-running` and `ok` (check) also are 0 |
| `unhealthy`       | 1         | `check` found a problem                                             |
| `rejected`        | 2         | Not a valid request                                                 |
| `busy`            | 3         | Another deploy is running                                           |
| `interrupted`     | 4         | `check` found a half-done deploy; the next deploy recovers first    |
| `not-started`     | 10        | The running app was not touched                                     |
| `rolled-back`     | 20        | The previous version runs again                                     |
| `rollback-failed` | 30        | Neither version runs; the output names the backup                   |
