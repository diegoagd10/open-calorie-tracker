---
name: verify-open-calorie-tracker
description: Start, check and stop an isolated, seeded copy of open-calorie-tracker (NestJS API, Next.js web app and a headless Chromium with a CDP endpoint) to verify a change in the real app. Use before driving the web UI or the API to prove a feature works, and whenever a verification instance looks broken.
---

# Verify open-calorie-tracker

`control-oct.mjs` runs one isolated instance per base port `N`. Every command prints JSON on stdout and exits 1 on failure. A failure carries `error` and a `next` field that says what to do.

| Port    | Process                                             |
| ------- | --------------------------------------------------- |
| `N`     | Web app, `next start` on a production build         |
| `N + 1` | API, `pnpm start:prod` on a fresh SQLite database   |
| `N + 2` | Headless Chromium, CDP endpoint on `127.0.0.1` only |

The default `N` is 3300. It avoids `pnpm dev:web` and `pnpm dev:api` (3000, 3001) and the web tests (3100–3102, 3200–3202).

## Launch

Run this from the repo root:

```bash
.claude/skills/verify-open-calorie-tracker/control-oct.mjs up [--base-port N]
```

`up` took 7 seconds in one measured run with no earlier build. It does these steps:

1. If a state file for `N` exists and every doctor check passes, it prints `"status": "already-up"` and exits 0.
2. If the state file exists but a check fails, it stops that instance and starts over. The output then has `replaced.failed` with the failed check names.
3. It refuses when the ports are held by processes it did not start, when this checkout already runs an instance on another base port, or when dependencies or Chromium are missing.
4. It wipes the data dir and builds `packages/shared`, then runs `pnpm db:seed` (which builds the API and migrates the database) and `next build` in parallel.
5. It starts the API, the web app and Chromium, writes the state file, and waits until `GET /v1/setup`, `GET /login` and `GET /json/version` answer 200. Then it runs the doctor checks.

`up` prints `"status": "started"` and the state when the instance is usable. When a step fails, `up` stops what it started and points at the logs.

The seed user is `ana` with the password `correct-horse-battery-staple`, the same as in `apps/web/test/fixtures.ts`. The script imports the seed user, the JWT settings and `API_KEY_SECRET` from that file.

Prerequisites, from the repo README:

```bash
pnpm install
pnpm --filter web exec playwright install chromium
```

## State file

`up` writes `/tmp/oct-verify-<N>/state.json` and prints the same state. The script uses `os.tmpdir()`, so `$TMPDIR` moves every path under `/tmp` in this skill. Read the state file to find the instance. Its shape is the `State` typedef in `model.mjs`, and `readState(basePort)` there loads it:

```json
{
  "basePort": 3300,
  "repo": "/abs/path/to/checkout",
  "dataDir": "/tmp/oct-verify-3300",
  "evidenceDir": "/tmp/oct-verify-3300-evidence",
  "webUrl": "http://localhost:3300",
  "apiUrl": "http://localhost:3301",
  "cdpUrl": "http://127.0.0.1:3302",
  "seedUser": { "username": "ana", "password": "correct-horse-battery-staple" },
  "startedAt": "2026-11-20T20:39:42.817Z",
  "processes": {
    "api": {
      "sid": 143942,
      "startTime": "2443784",
      "port": 3301,
      "log": "/tmp/oct-verify-3300/logs/api.log"
    },
    "web": {
      "sid": 143944,
      "startTime": "2443784",
      "port": 3300,
      "log": "/tmp/oct-verify-3300/logs/web.log"
    },
    "browser": {
      "sid": 143945,
      "startTime": "2443784",
      "port": 3302,
      "log": "/tmp/oct-verify-3300/logs/browser.log"
    }
  }
}
```

- `sid` is the session id. Each process starts as the leader of a new session. pnpm moves each script into a process group of its own, so the session is the unit that holds everything one start owns.
- `startTime` is the leader's start time from `/proc/<sid>/stat`. A live leader with another start time means the id was reused, and the tool treats the session as gone.
- The data dir also holds `db.sqlite`, `chromium-profile/` and `logs/` (`build.log`, `seed.log`, `api.log`, `web.log`, `browser.log`).

## Doctor

Run doctor first whenever anything looks off. It changes nothing.

```bash
.claude/skills/verify-open-calorie-tracker/control-oct.mjs doctor [--base-port N]
```

It returns `checks`, a list of `{ name, ok, detail?, next? }`, plus a top-level `next` from the first failed check:

| Check                                           | Passes when                                                     |
| ----------------------------------------------- | --------------------------------------------------------------- |
| `state`                                         | The state file exists. Reported only when it is missing.        |
| `process:api`, `process:web`, `process:browser` | The session still has a live process.                           |
| `port:api`, `port:web`, `port:browser`          | Every pid that `ss -ltnp` shows on the port is in that session. |
| `api`                                           | `GET /v1/setup` answers 200 with `needsSetup: false`.           |
| `web`                                           | `GET /login` answers 200.                                       |
| `login`                                         | `POST /v1/login` with the seed user returns an `accessToken`.   |
| `browser`                                       | `GET /json/version` on the CDP endpoint answers 200.            |

For most failures, `next` tells you to run `up` again, which replaces the broken instance. Read the named log first, because `up` wipes the data dir.

## Cleanup

```bash
.claude/skills/verify-open-calorie-tracker/control-oct.mjs down [--base-port N] [--dry-run]
```

`down` sends SIGTERM to every process in the three recorded sessions, waits up to 10 seconds, and sends SIGKILL to what is left. It never kills by process name. Then it removes the data dir. `--dry-run` reports `wouldStop` and `wouldRemove` and changes nothing.

`down` keeps the evidence dir, `/tmp/oct-verify-<N>-evidence`, and reports it as `kept`. Put screenshots and response bodies there. `down` is safe to run twice.

## Helpers

- `control-oct.mjs --help` lists the commands. `control-oct.mjs <command> --help` shows one command.
- `model.mjs` holds the data shapes (state file, process records, check results, command registry) and the helpers that build, read and write them. `control-oct.mjs` holds the process and HTTP work.
- The script needs Linux. It reads `/proc` and runs `ss`.
- It resolves `playwright` from `apps/web` with `createRequire`, because pnpm installs it only there. The repo root has no dependency on it.
- Attach to the running browser with Playwright from `apps/web`. `browser.close()` on a CDP connection disconnects and leaves Chromium running:

```js
const { chromium } = createRequire(`${repo}/apps/web/package.json`)('playwright')
const browser = await chromium.connectOverCDP(state.cdpUrl)
const page = await (await browser.newContext()).newPage()
```

## Gotchas

- One instance per checkout. Instances share `apps/web/.next` and `apps/api/dist`, so `up` refuses a second base port in the same checkout. Use another worktree for a second instance.
- `next build` writes `apps/web/.next`. Stop `pnpm dev:web` before `up`, because `next dev` locks that directory. Do not run the web tests in this checkout while an instance is up. Their `next build` rewrites the build that `next start` serves.
