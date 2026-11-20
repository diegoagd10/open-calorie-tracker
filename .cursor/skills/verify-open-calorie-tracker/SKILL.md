---
name: verify-open-calorie-tracker
description: >-
  Verify the Open Calorie Tracker web app and its HTTP API.
  Use when an agent must prove the app still works after a change, including a
  dependency bump, by starting an isolated stack, driving a user path, and
  running the unit and Playwright tests.
---

# Verify Open Calorie Tracker

Open Calorie Tracker is the Next.js app in `apps/web` and the NestJS API in `apps/api`. The user-facing surfaces are the Food Log at `/`, Weight at `/weight`, Settings at `/settings`, and Log in at `/login`. Registration at `/register` is only open while the database has no user. The API listens under `/v1`. There is no WebSocket server.

The harness is `./scripts/verify/ocal`. It starts the built API (`node dist/main.js`) and `next start` on their own ports and SQLite file. `docker compose` is the production stack: the image sets `NODE_ENV=production`, and `apps/api/src/seed.ts` refuses to seed in production, so do not use compose for this check. The Playwright suite in `apps/web/test` builds into `.next` and serves ports 3100–3202. This harness serves `.next-ocal` on 3410 and 3411, so the two can run at the same time. A second harness run needs its own `OCAL_WEB_PORT`, `OCAL_API_PORT`, and `OCAL_RUN_DIR`.

Run every command from the checkout root with Node.js 26 on `PATH`. The API imports `argon2` from `node:crypto`, which the `node:26` image in the `Dockerfile` provides. stdout is one JSON object. `"ok": true` and exit code 0 are the pass. `"next"` says what to do when it fails.

## Launch

```bash
./scripts/verify/ocal up
```

Ready when the process exits 0 and the JSON has `"ready"."health"."status": "ok"`, `"ready"."page": "Log in"`, and `"ready"."auth"."username": "demo"`. `webUrl` is `http://127.0.0.1:3410` and `apiUrl` is `http://127.0.0.1:3411` unless the ports were overridden. The login page has rendered the heading `Log in` and the text `Open Calorie Tracker`, and `GET /v1/settings/profile` accepted the seed user's token. A TCP response alone is not ready.

The database is `<run dir>/data/sqlite.db`. The default run directory is `/tmp/ocal-verify-3410`. Migrations run when the database opens. The seed user is `demo` / `demo-password` unless `SEED_USER_USERNAME` and `SEED_USER_PASSWORD` are set. Those values, plus `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`, `API_KEY_SECRET`, and `OPEN_FOOD_FACTS_USER_AGENT`, come from the environment. Unset variables use the local test defaults printed by `./scripts/verify/ocal --help`. An inherited `DATABASE_URL` is ignored.

Set `OCAL_SKIP_SEED=1` before `up` only when a recipe needs a database with no user. Ready then has `"ready"."page": "Create account"` and `"ready"."auth": null`, and `/register` renders `Create account`.

Tear the stack down with:

```bash
./scripts/verify/ocal down
```

## Doctor

```bash
./scripts/verify/ocal doctor
```

Require `"ok": true`. That means both recorded pids are alive, each listening port is owned by that pid or its child, `apps/api/dist/main.js` and `apps/web/.next-ocal/BUILD_ID` still match the build `up` recorded, and `git status` matches that moment. For a seeded run, `demo` can log in and `auth.username` is `demo`. `webUrl`, `dataDir`, and `gitSha` in the JSON are the instance to drive. Do not drive a server this run did not start. If doctor fails, run `./scripts/verify/ocal logs`, then `./scripts/verify/ocal down` and `./scripts/verify/ocal up`.

## Drive

Recipes live in `features/`. Use ARIA roles and accessible names. The first `browser` command starts one Chromium for this run, and later commands continue on that same page, so a username typed in one command is still there for the next. `browser reset` and `down` close it.

Sign in, then log one food (the proof path):

```bash
./scripts/verify/ocal browser reset
./scripts/verify/ocal browser open /login
./scripts/verify/ocal browser fill --role textbox --name Username --value demo
./scripts/verify/ocal browser fill --role textbox --name Password --value demo-password
./scripts/verify/ocal browser click --role button --name "Log in" --wait-role heading --wait-name "Food Log"
./scripts/verify/ocal browser wait --role button --name "Add food"
./scripts/verify/ocal browser click --role button --name "Add food" --exact
./scripts/verify/ocal browser wait --role dialog --name "Add food"
./scripts/verify/ocal browser fill --role textbox --name Food --value Oatmeal --within-role dialog --within-name "Add food"
./scripts/verify/ocal browser fill --role combobox --name "Serving size" --value "1 bowl" --within-role dialog --within-name "Add food"
./scripts/verify/ocal browser fill --role textbox --name "Calories per serving" --value 150 --within-role dialog --within-name "Add food"
./scripts/verify/ocal browser screenshot --path artifacts/verify/log-food/dialog.png
./scripts/verify/ocal browser click --role button --name "Add 150 kcal" --within-role dialog --within-name "Add food" --wait-role button --wait-name "Oatmeal, 150 kcal"
./scripts/verify/ocal browser screenshot --path artifacts/verify/log-food/list.png
./scripts/verify/ocal browser click --role button --name "Oatmeal, 150 kcal"
./scripts/verify/ocal browser wait --role dialog --name "Edit food"
./scripts/verify/ocal browser text --role textbox --name Food --within-role dialog --within-name "Edit food"
./scripts/verify/ocal browser snapshot --aria --path artifacts/verify/log-food/reopened.aria.txt
./scripts/verify/ocal db --sql "SELECT food_entries.name, food_entries.calories, food_entries.quantity, serving_sizes.name AS serving_size FROM food_entries JOIN serving_sizes ON serving_sizes.id = food_entries.serving_size_id"
```

The reopened field value is `Oatmeal`. The SELECT returns one row: name `Oatmeal`, calories `150`, quantity `1`, serving size `1 bowl`. The list screenshot shows `Open Calorie Tracker` and `Food Log`.

Read the API as the same user with `./scripts/verify/ocal call GET /v1/settings/profile --auth`. A day log is `./scripts/verify/ocal call GET '/v1/daily-log?date=YYYY-MM-DD&timeZone=America/New_York' --auth`, using the date in the Food Log footer. Do not create the food through `POST /v1/food-entries`. That skips the dialog the person uses.

`./scripts/verify/ocal test` runs the shared unit tests, the API unit and e2e tests, and the Playwright suite:

```bash
pnpm --filter @open-calorie-tracker/shared test
pnpm --filter api exec vp test run
pnpm --filter web exec vp test run
```

The web suite builds `.next` and does not need this stack stopped.

## Evidence

Write proof under `artifacts/verify/` (override with `OCAL_EVIDENCE_DIR`). Capture the action and the state it produced.

- `artifacts/verify/log-food/dialog.png` is the filled Add food dialog before save.
- `artifacts/verify/log-food/list.png` is the Food Log after the entry appears. The header reads `Open Calorie Tracker`.
- `artifacts/verify/log-food/reopened.aria.txt` is the ARIA snapshot of the reopened entry.
- The `db` JSON is the stored row. Keep that stdout.
- `./scripts/verify/ocal test` writes `artifacts/verify/test/result.json` plus each package log. Keep the summary lines (`Test Files`, `Tests`).
- Save `up` and `doctor` stdout next to those files when you are proving a change.

A toast or a closed dialog is not proof. Reopen the entry from the daily list and read the row.

## Cleanup

```bash
./scripts/verify/ocal down
```

This sends `SIGTERM`, then `SIGKILL`, to the two pids recorded in the run file. It does not search by process name. It then deletes the run directory (database, logs, browser jar). It does not delete `artifacts/verify`. Confirm with `test -f artifacts/verify/log-food/list.png` after `down`. `./scripts/verify/ocal down --dry-run` prints the pids and the directory it would remove.

`./scripts/verify/ocal browser reset` drops only the cookie jar. Use it between recipes. Use `down` when the database itself must go.

## Helpers

`scripts/verify/ocal` is executable.

```bash
./scripts/verify/ocal --help
./scripts/verify/ocal up
./scripts/verify/ocal doctor
./scripts/verify/ocal seed
./scripts/verify/ocal call GET /v1/health
./scripts/verify/ocal call GET /v1/settings/profile --auth
./scripts/verify/ocal logs
./scripts/verify/ocal logs api --lines 80
./scripts/verify/ocal db --sql "SELECT name, calories FROM food_entries"
./scripts/verify/ocal test
./scripts/verify/ocal down --dry-run
./scripts/verify/ocal down
./scripts/verify/ocal browser open /login
./scripts/verify/ocal browser reset
```

`--dry-run` plans `up`, `down`, `seed`, `call`, `test`, and the browser actions `open`, `click`, `fill`, `press`, and `reset` without performing them. `doctor`, `logs`, `db`, and browser `wait`, `text`, `snapshot`, and `screenshot` only read.
