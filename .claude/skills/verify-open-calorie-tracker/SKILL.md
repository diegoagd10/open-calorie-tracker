---
name: verify-open-calorie-tracker
description: Start, check, drive and stop an isolated, seeded copy of open-calorie-tracker (NestJS API, Next.js web app and a headless Chromium with a CDP endpoint), from this checkout or from the production Docker images, to verify a change or a dependency bump (Dependabot PRs) in the real app. Required before you report a change to the app as done. Its publish command pushes the screenshots and the command transcript to an evidence branch and links them in the PR's Verification section. Use to prove a feature works through the web UI, to check its side effects through the API, to capture screenshots as evidence, and whenever a verification instance looks broken.
---

# Verify open-calorie-tracker

`control-oct.ts` runs one isolated instance per app URL. Every command takes `--url URL`, or reads `OCT_URL` when the flag is absent, and the default is `http://localhost:3000`. The URL must be `http://localhost:<P>`. Every command prints JSON on stdout and exits 1 on failure. A failure carries `error` and a `next` field that says what to do.

| Port    | Process                                             |
| ------- | --------------------------------------------------- |
| `P`     | Web app on a production build                       |
| `P + 1` | API on a fresh SQLite database                      |
| `P + 2` | Headless Chromium, CDP endpoint on `127.0.0.1` only |

The app runs one of two ways, and every drive command and feature block works the same on both:

| `up`          | API and web app                                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `up`          | `pnpm start:prod` and `next start` from this checkout                                                                                                                                                                                            |
| `up --docker` | The `api` and `web` targets of the `Dockerfile` (Node 26, `NODE_ENV=production`), run by `docker-compose.yml` plus `docker-compose.verify.yml` as the Compose project `oct-verify-<P>`, published on `127.0.0.1` only. Use it for Dependabot PRs |

Chromium runs with `TZ=America/New_York` and `--lang=en-US`, the time zone and locale that `openPage` in `apps/web/test/browser.ts` gives the web tests.

The default `P` is 3000, the port of `pnpm dev:web`, so stop `pnpm dev:web` and `pnpm dev:api` first or pick another URL. Avoid the web tests' ports (3100–3102, 3200–3202) and the production stack's (3010, 3011).

## Launch

Run this from the repo root:

```bash
.claude/skills/verify-open-calorie-tracker/control-oct.ts up [--docker] [--url URL]
```

A local `up` took 7 seconds in one measured run with no earlier build. `up --docker` took 39 seconds with a warm Docker build cache, including the image build. It does these steps:

1. If a state file for `P` exists, it was started the same way (`--docker` or not), its `source` matches this checkout, and every doctor check passes, it prints `"status": "already-up"` and exits 0.
2. If the state file exists but any of these differ or fail, it stops that instance and starts over. The output then has `replaced.failed` with the failed check names, `app` when the way differs, or `source` when the commit or its cleanliness differs.
3. It refuses when the ports are held by processes it did not start, when dependencies or Chromium are missing, when Docker is not usable (`--docker`), or when this checkout already runs a local instance on another URL (local only).
4. It wipes the data dir. Then the app starts:
   - Local: it builds `packages/shared`, then runs `pnpm db:seed` (which builds the API and migrates the database) and `next build` in parallel, and starts the API and the web app.
   - `--docker`: it runs `docker compose down -v` for the project, then `docker compose up -d --build --wait`, which builds both images and waits for their healthchecks, then `docker compose run --rm -T seed`. The SQLite database lives in `<dataDir>/db`, bind-mounted as `DATA_PATH`.
5. It starts Chromium, writes the state file, and waits until `GET /v1/setup`, `GET /login` and `GET /json/version` answer 200. Then it runs the doctor checks.

`up` prints `"status": "started"` and the state when the instance is usable. When a step fails, `up` stops what it started and points at the logs.

The seed user is `ana` with the password `correct-horse-battery-staple`, the same as in `apps/web/test/fixtures.ts`. The script imports the seed user from that file. A local `up` also takes the JWT settings and `API_KEY_SECRET` from it.

`up --docker` passes every setting to Compose through the environment and writes none to disk. `JWT_SECRET` and `API_KEY_SECRET` come from your environment when set, else from 32 fresh random bytes on each start. `OPEN_FOOD_FACTS_USER_AGENT` comes from your environment when set. The `api` and `web` containers keep `NODE_ENV=production`, so `dist/seed` and `dist/reset` refuse to run in them. The `seed` service of `docker-compose.verify.yml` runs the same `api` image with `NODE_ENV=verification` and only runs the seed and reset scripts. The overlay also probes the healthchecks every second while the containers start, which changes nothing in production.

Prerequisites, from the repo README. `--docker` also needs Docker with the Compose plugin, usable by your user:

```bash
pnpm install
pnpm --filter web exec playwright install chromium
```

To verify a PR, Dependabot's included, check out its branch in a worktree and run `up --docker` there. The images build from that checkout, so they carry the PR's lockfile.

## State file

`up` writes `/tmp/oct-verify-<P>/state.json` and prints the same state. The script uses `os.tmpdir()`, so `$TMPDIR` moves every path under `/tmp` in this skill. Read the state file to find the instance. Its shape is the `State` type in `model.ts`, and `readState(instance)` there loads and validates it. `parseInstance(url)` in the same file derives every port, URL and path from the web URL:

```json
{
  "app": "local",
  "repo": "/abs/path/to/checkout",
  "source": { "commit": "4c148a718ed97533afab92912c5b414ab4aacdef", "clean": true },
  "dataDir": "/tmp/oct-verify-3000",
  "evidenceDir": "/tmp/oct-verify-3000-evidence",
  "webUrl": "http://localhost:3000",
  "apiUrl": "http://localhost:3001",
  "cdpUrl": "http://127.0.0.1:3002",
  "seedUser": { "username": "ana", "password": "correct-horse-battery-staple" },
  "startedAt": "2026-11-20T20:39:42.817Z",
  "processes": {
    "api": {
      "sid": 143942,
      "startTime": "2443784",
      "port": 3001,
      "log": "/tmp/oct-verify-3000/logs/api.log"
    },
    "web": {
      "sid": 143944,
      "startTime": "2443784",
      "port": 3000,
      "log": "/tmp/oct-verify-3000/logs/web.log"
    },
    "browser": {
      "sid": 143945,
      "startTime": "2443784",
      "port": 3002,
      "log": "/tmp/oct-verify-3000/logs/browser.log"
    }
  }
}
```

- `source` is what the instance was built from. `up` reads `HEAD` and `git status --porcelain` before the build and again after it. `clean` is true only when both reads found no uncommitted or untracked files and the same `HEAD`. A checkout with changes starts and drives the same way, but `publish` does not take its runs.
- `sid` is the session id. Each process starts as the leader of a new session. pnpm moves each script into a process group of its own, so the session is the unit that holds everything one start owns.
- `startTime` is the leader's start time from `/proc/<sid>/stat`. A live leader with another start time means the id was reused, and the tool treats the session as gone.
- A `--docker` state has `"app": "docker"` and only the `browser` process. The containers belong to the Compose project `oct-verify-<P>`.
- The data dir also holds `db.sqlite` (local) or `db/sqlite.db` (`--docker`), `chromium-profile/` and `logs/` (`build.log`, `seed.log`, `api.log`, `web.log`, `browser.log` locally; `docker.log`, `seed.log`, `browser.log` with `--docker`). Container logs come from `docker compose -p oct-verify-<P> logs api web`.

## Doctor

Run doctor first whenever anything looks off. It changes nothing.

```bash
.claude/skills/verify-open-calorie-tracker/control-oct.ts doctor [--url URL]
```

It returns `app`, `source`, `webUrl`, `apiUrl`, `evidenceDir` and `checks`, a list of `{ name, ok, detail?, next? }`, plus a top-level `next` from the first failed check. A check runs only for the processes the instance has:

| Check                                           | Passes when                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| `state`                                         | A valid state file exists. Reported only when it does not.           |
| `containers`                                    | `--docker` only: the `api` and `web` containers run and are healthy. |
| `process:api`, `process:web`, `process:browser` | The session still has a live process.                                |
| `port:api`, `port:web`, `port:browser`          | Every pid that `ss -ltnp` shows on the port is in that session.      |
| `api`                                           | `GET /v1/setup` answers 200 with `needsSetup: false`.                |
| `web`                                           | `GET /login` answers 200.                                            |
| `login`                                         | `POST /v1/login` with the seed user returns an `accessToken`.        |
| `browser`                                       | `GET /json/version` on the CDP endpoint answers 200.                 |

For most failures, `next` tells you to run `up` again, which replaces the broken instance. Read the named log first, because `up` wipes the data dir.

## Drive

The drive commands act on one page, the first tab of Chromium's default context. Chromium owns that tab, so it keeps its URL, open dialogs, scroll position and cookies between commands. Each command attaches over CDP, sizes the tab to 1280x720 (the desktop viewport of the web tests), acts, and disconnects. Only one agent drives an instance at a time, because two agents would share the tab.

| Command                               | What it does                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `login [--username U] [--password P]` | Clears the cookies and logs in through the `/login` form. The default is the seed user. Ends on `/`.                                  |
| `goto <path>`                         | Opens a path of the web app. Fails when it lands on `/login` and the browser has no session.                                          |
| `snapshot`                            | Prints `url`, `title`, `timeZone`, `locale` and `aria`, the accessibility tree, one line per node.                                    |
| `click <role> <name> [--nth I]`       | Clicks the element with this ARIA role and accessible name.                                                                           |
| `type <role> <name> <text> [--nth I]` | Replaces the value of the field with `text`, like Playwright's `fill`.                                                                |
| `press <key>`                         | Presses a key on the focused element: `Enter`, `Escape`, `Tab`, `ArrowDown`, `Control+A`.                                             |
| `screenshot [path] [--mobile]`        | Saves a PNG of the viewport. The default path is `<evidenceDir>/<timestamp>.png`, and a relative path is relative to `<evidenceDir>`. |
| `api <METHOD> <path> [--body JSON]`   | Calls the API as the logged-in user and prints `status` and the parsed `body`.                                                        |
| `reset`                               | Setup only. Deletes every user with the API's `dist/reset` script, for the first-account flow.                                        |

Each command takes `--url URL` and `--help`. `goto`, `click`, `type`, `press` and `login` wait until no request has been in flight for 500 ms, for up to 10 seconds, and report `settled: false` when the page never goes quiet.

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

Run the same lines after `up --docker` to check the production images. With another URL, `export OCT_URL=http://localhost:3400` once and run them unchanged.

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

Screenshots go to `/tmp/oct-verify-<P>-evidence/` by default. A screenshot path must end in `.png`. `doctor`, `reset` and every drive command also append one JSON line to `transcript.jsonl` there, whether they pass or fail: `{ at, source, app, startedAt, command, argv, ok, result }`. A `screenshot` in the evidence dir has its relative `file` and the `sha256` of the PNG in `result`. `down` keeps the directory, and `publish` copies it off `/tmp`.

The transcript replaces JWTs with `<jwt>`, API keys with `<api-key>`, the checkout path with `<checkout>` and the home directory with `~`. It never holds the session cookie. Screenshots are not redacted, and the repo is public, so shoot only seed data and never a revealed API key.

## Publish

```bash
.claude/skills/verify-open-calorie-tracker/control-oct.ts publish --pr N [--url URL]
```

`publish` puts the proof for `HEAD` on the open PR `N`. It reads the evidence dir of the URL, so it works after `down`. It needs `git` with push access to `origin` and a logged-in `gh`.

1. It requires that the head of the PR is the local `HEAD` and that `origin` pushes to the PR's repository.
2. It keeps the transcript entries whose `source` is `HEAD` and clean. They must have at least one screenshot and one `api` GET with a 2xx status. Each screenshot must still match its `sha256`, and the last one taken under a name counts.
3. It commits the screenshots and the kept entries to the branch `evidence/pr-N` under `<first 12 characters of HEAD>/`, and pushes without force. The directory of an earlier commit stays. The working tree, the index and the local branches do not change.
4. It writes a block into the `## Verification` section of the PR body, between `<!-- oct-verify:start -->` and `<!-- oct-verify:end -->`. The block has the line `Verified commit: <sha>`, a table of the runs, and links to the transcript and the screenshots. It adds the section when the body has none, and changes nothing outside the block.

It prints `commit`, `evidenceBranch`, `evidenceCommit`, `screenshots`, `transcript` (the number of entries `published`, `failed` and `ignored`), `bodyUpdated` and `prUrl`. A second run with the same evidence changes nothing. `publish` replaces the directory of the same commit, so run local and `--docker` on one URL to show both. Never delete an `evidence/*` branch, because the PR links to its commits.

## Cleanup

```bash
.claude/skills/verify-open-calorie-tracker/control-oct.ts down [--url URL] [--dry-run]
```

`down` sends SIGTERM to every process in the recorded sessions, waits up to 10 seconds, and sends SIGKILL to what is left. It never kills by process name. When the Compose project `oct-verify-<P>` has containers, it runs `docker compose down -v --remove-orphans` for that project alone and reports `removedContainers`. Then it removes the data dir, the SQLite database of a `--docker` instance included. `--dry-run` reports `wouldStop` and `wouldRemove` and changes nothing.

`down` keeps the evidence dir, `/tmp/oct-verify-<P>-evidence`, and reports it as `kept`. `down` is safe to run twice.

## Helpers

- `control-oct.ts --help` lists the commands. `control-oct.ts <command> --help` shows one command.
- `model.ts` holds the data shapes (state file, process records, check results, command registry, parsed requests) and the helpers that build, read and write them. `control-oct.ts` holds the process and HTTP work. `drive.ts` holds the drive commands. `proof.ts` writes the transcript and publishes it. `roles.ts` lists the ARIA roles that `getByRole` accepts, checked against Playwright's type.
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

- A state file that an older `control-oct.ts` wrote has no `source`, so it counts as missing, and `up` refuses because the ports are in use. Run `down` with the older version first, because `down` of this version does not find its processes.
- One local instance per checkout. Local instances share `apps/web/.next` and `apps/api/dist`, so `up` refuses a second local URL in the same checkout. Use another worktree, or `--docker`, whose images build in Docker and share nothing with the checkout.
- `up --docker` builds from the files in the checkout, including uncommitted changes, minus what `.dockerignore` drops. A failed build or healthcheck reports `docker.log` and the `docker compose logs` command to run.
- `docker-compose.verify.yml` only adds to `docker-compose.yml`. Run it through `control-oct.ts`, which sets the variables both files need. `docker compose up` alone, without `-f`, still starts production and never reads the overlay.
- Five wrong passwords lock an account for 15 minutes (`MAX_FAILED_ATTEMPTS` in `packages/shared/src/auth.ts`). Run `up` again to reseed when you lock the seed user.
- An instance that an older `control-oct.ts` started reports `already-up` but runs Chromium without the time zone flags. Check `timeZone` in `snapshot`, and run `down`, then `up`, when it is not `America/New_York`.
- `next build` writes `apps/web/.next`. Stop `pnpm dev:web` before `up`, because `next dev` locks that directory. Do not run the web tests in this checkout while an instance is up. Their `next build` rewrites the build that `next start` serves.
