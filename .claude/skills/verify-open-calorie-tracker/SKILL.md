---
name: verify-open-calorie-tracker
description: Start, check, drive and stop an isolated, seeded copy of open-calorie-tracker (NestJS API, Next.js web app and a headless Chromium with a CDP endpoint) to verify a change in the real app. Use to prove a feature works through the web UI, to check its side effects through the API, to capture screenshots as evidence, and whenever a verification instance looks broken.
---

# Verify open-calorie-tracker

`control-oct.ts` runs one isolated instance per base port `N`. Every command prints JSON on stdout and exits 1 on failure. A failure carries `error` and a `next` field that says what to do.

| Port    | Process                                             |
| ------- | --------------------------------------------------- |
| `N`     | Web app, `next start` on a production build         |
| `N + 1` | API, `pnpm start:prod` on a fresh SQLite database   |
| `N + 2` | Headless Chromium, CDP endpoint on `127.0.0.1` only |

Chromium runs with `TZ=America/New_York` and `--lang=en-US`, the time zone and locale that `openPage` in `apps/web/test/browser.ts` gives the web tests.

The default `N` is 3300. It avoids `pnpm dev:web` and `pnpm dev:api` (3000, 3001) and the web tests (3100–3102, 3200–3202).

## Launch

Run this from the repo root:

```bash
.claude/skills/verify-open-calorie-tracker/control-oct.ts up [--base-port N]
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

`up` writes `/tmp/oct-verify-<N>/state.json` and prints the same state. The script uses `os.tmpdir()`, so `$TMPDIR` moves every path under `/tmp` in this skill. Read the state file to find the instance. Its shape is the `State` type in `model.ts`, and `readState(instance)` there loads and validates it. `instanceAt(N)` in the same file derives every port, URL and path from the base port:

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
.claude/skills/verify-open-calorie-tracker/control-oct.ts doctor [--base-port N]
```

It returns `checks`, a list of `{ name, ok, detail?, next? }`, plus a top-level `next` from the first failed check:

| Check                                           | Passes when                                                     |
| ----------------------------------------------- | --------------------------------------------------------------- |
| `state`                                         | A valid state file exists. Reported only when it does not.      |
| `process:api`, `process:web`, `process:browser` | The session still has a live process.                           |
| `port:api`, `port:web`, `port:browser`          | Every pid that `ss -ltnp` shows on the port is in that session. |
| `api`                                           | `GET /v1/setup` answers 200 with `needsSetup: false`.           |
| `web`                                           | `GET /login` answers 200.                                       |
| `login`                                         | `POST /v1/login` with the seed user returns an `accessToken`.   |
| `browser`                                       | `GET /json/version` on the CDP endpoint answers 200.            |

For most failures, `next` tells you to run `up` again, which replaces the broken instance. Read the named log first, because `up` wipes the data dir.

## Drive

The drive commands act on one page, the first tab of Chromium's default context. Chromium owns that tab, so it keeps its URL, open dialogs, scroll position and cookies between commands. Each command attaches over CDP, sizes the tab to 1280x720 (the desktop viewport of the web tests), acts, and disconnects. Only one agent drives an instance at a time, because two agents would share the tab.

| Command                               | What it does                                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `login [--username U] [--password P]` | Clears the cookies and logs in through the `/login` form. The default is the seed user. Ends on `/`. |
| `goto <path>`                         | Opens a path of the web app. Fails when it lands on `/login` and the browser has no session.         |
| `snapshot`                            | Prints `url`, `title`, `timeZone`, `locale` and `aria`, the accessibility tree, one line per node.   |
| `click <role> <name> [--nth I]`       | Clicks the element with this ARIA role and accessible name.                                          |
| `type <role> <name> <text> [--nth I]` | Replaces the value of the field with `text`, like Playwright's `fill`.                               |
| `press <key>`                         | Presses a key on the focused element: `Enter`, `Escape`, `Tab`, `ArrowDown`, `Control+A`.            |
| `screenshot [path] [--mobile]`        | Saves a PNG of the viewport. The default path is `<evidenceDir>/<timestamp>.png`.                    |
| `api <METHOD> <path> [--body JSON]`   | Calls the API as the logged-in user and prints `status` and the parsed `body`.                       |

Each command takes `--base-port N` and `--help`. `goto`, `click`, `type`, `press` and `login` wait until no request has been in flight for 500 ms, for up to 10 seconds, and report `settled: false` when the page never goes quiet.

This journey logs water through the UI and checks the row in the API. Run it from the repo root after `up`:

```bash
C=.claude/skills/verify-open-calorie-tracker/control-oct.ts
$C login
$C click button "Add water"
$C type textbox "Amount (fl oz)" 12
$C press Enter
$C snapshot      # the Entries list shows button "Water, 12 fl oz, 5:06 PM"
$C api GET "/v1/daily-log?date=$(TZ=America/New_York date +%F)&timeZone=America/New_York"
$C screenshot --mobile
```

### Targets

Read the role and the name from a `snapshot` line. `- button "Add water"` is `click button "Add water"`. A name matches exactly first, then case-insensitively as a substring, and the command acts only when one element matches. `click button "Glass"` clicks `button "Glass 8 fl oz → 8 today"`. When no element or several elements match, the command fails with `candidates`:

```json
{
  "ok": false,
  "error": "2 elements match button \"week\"",
  "next": "Pass the full name of one candidate, or --nth I for the I-th candidate, from 0. A name matches by substring only when no name is exact",
  "candidates": ["button \"Previous week\"", "button \"Next week\""]
}
```

When several elements share the exact name, `--nth I` picks the I-th candidate, from 0 in page order. On `/weight` without a weight goal, the header and the notice both have `link "Settings"`, and `click link "Settings" --nth 1` clicks the notice's link.

A modal dialog leaves the page behind it inert. While one is open, `click` and `type` look only inside the last dialog opened, and a miss fails with `no <target> in the open dialog "<name>"`. `snapshot` still prints the whole page. In the Change password dialog, `click button "Change password"` clicks the dialog's submit button, not the button in Profile that opened it.

Selectors that the web tests use: `button "Log in"` on `/login`, `button "Add water"`, `button "Add food"`, `dialog "Add water"`, `textbox "Amount (fl oz)"`, `link "Weight"`, `link "Settings"` and `button "Log out"`.

### Mobile screenshots

`screenshot --mobile` applies the `MOBILE` profile of `apps/web/test/browser.ts` to the live page for one capture: a 390x844 viewport at device scale factor 3 (a 1170x2532 PNG), the mobile viewport meta tag, and touch support. Then it restores the desktop viewport. The page state stays, so an open dialog shows in the capture. It does not change the user agent. It does not make clicks into taps or emulate a slow network or CPU, and later commands run at 1280x720 again.

### API calls

`api` sends the browser's `access_token` cookie as a bearer token, the same token that the web app forwards to the API. It acts as the user that `login` logged in, and it fails with `next: Run login` when the browser has no session. It exits 0 for any HTTP status, so read `status`. Useful reads:

- `GET /v1/daily-log?date=YYYY-MM-DD&timeZone=America/New_York` lists the day's food and water entries, totals and goals.
- `GET /v1/settings/profile`, `GET /v1/settings/daily-goals` and `GET /v1/settings/weight-goal` read the settings.
- `POST /v1/water-entries --body '{"amount": 8}'` writes through the API. Use it for setup only. A proof writes through the UI.

## Feature map

Before you verify a feature, read [`features/README.md`](features/README.md) and follow the file for that feature. Each file lists the feature's entry points and a block of commands, run on a fresh `up`, that ends in a screenshot and an `api` read that prove it works. When a change adds, renames or removes a route, label or flow, update its file in the same change and run its block again. `/pstack:maintain-verification-skill` checks the map against the app.

## Evidence

A proof meets these standards:

- Drive the real user path: `login`, then `click`, `type` and `press`. Do not seed the database or call write endpoints to fake the state under test.
- Capture the action and the state it produced. Take a `screenshot` before the action and one after, and keep the `snapshot` output that shows the change.
- Verify the side effect with `api`. A row that the UI shows but the API does not return is not a pass.
- Shoot the screens a phone user sees with `screenshot --mobile` when the change touches layout.
- Keep the JSON output of each command as the transcript.

Screenshots go to `/tmp/oct-verify-<N>-evidence/` by default. `down` keeps that directory.

## Cleanup

```bash
.claude/skills/verify-open-calorie-tracker/control-oct.ts down [--base-port N] [--dry-run]
```

`down` sends SIGTERM to every process in the three recorded sessions, waits up to 10 seconds, and sends SIGKILL to what is left. It never kills by process name. Then it removes the data dir. `--dry-run` reports `wouldStop` and `wouldRemove` and changes nothing.

`down` keeps the evidence dir, `/tmp/oct-verify-<N>-evidence`, and reports it as `kept`. Put screenshots and response bodies there. `down` is safe to run twice.

## Helpers

- `control-oct.ts --help` lists the commands. `control-oct.ts <command> --help` shows one command.
- `model.ts` holds the data shapes (state file, process records, check results, command registry, parsed requests) and the helpers that build, read and write them. `control-oct.ts` holds the process and HTTP work. `drive.ts` holds the drive commands. `roles.ts` lists the ARIA roles that `getByRole` accepts, checked against Playwright's type.
- `tsconfig.json` and `package.json` in this folder exist so that `pnpm check` type-checks the skill. The `.ts` files run directly with Node's type stripping, with no build step.
- The script needs Linux. It reads `/proc` and runs `ss`.
- It resolves `playwright` from `apps/web` with `createRequire`, because pnpm installs it only there. The repo root has no dependency on it.
- For a step that the drive commands do not cover, attach to the same page with Playwright from `apps/web`. `browser.close()` on a CDP connection disconnects and leaves Chromium and the page running:

```ts
const { chromium } = createRequire(`${repo}/apps/web/package.json`)('playwright')
const browser = await chromium.connectOverCDP(state.cdpUrl)
const page = browser.contexts()[0].pages()[0]
```

## Gotchas

- One instance per checkout. Instances share `apps/web/.next` and `apps/api/dist`, so `up` refuses a second base port in the same checkout. Use another worktree for a second instance.
- Five wrong passwords lock an account for 15 minutes (`MAX_FAILED_ATTEMPTS` in `packages/shared/src/auth.ts`). Run `up` again to reseed when you lock the seed user.
- An instance that an older `control-oct.ts` started reports `already-up` but runs Chromium without the time zone flags. Check `timeZone` in `snapshot`, and run `down`, then `up`, when it is not `America/New_York`.
- `next build` writes `apps/web/.next`. Stop `pnpm dev:web` before `up`, because `next dev` locks that directory. Do not run the web tests in this checkout while an instance is up. Their `next build` rewrites the build that `next start` serves.
