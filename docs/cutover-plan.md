# Cutover plan: replace open-calory-tracker with this project

Owner: **Claude** does it, **You** do it (or approve it), **Both** means Claude prepares and you
check. Tick a box when its "done when" holds.

Decisions: the stack is plain `docker compose` in `~/stacks` (no Portainer) on **svc-01**. The web
app is public at `https://calorie.dagdappshub.com` and the API at
`https://calorie-api.dagdappshub.com`, where Muse reaches MCP at `/v1/mcp`. The old app stays in
charge of the data until the cutover. You register your account in the new app first, and every
import replaces that account's entries with the old app's.

## 0. GitHub repo

- [x] **0.1 Archive the old repo** (You approved, Claude ran). Renamed it to
      `diegoagd10/open-calorie-tracker-legacy` and archived it (read-only).
- [x] **0.2 Publish this repo** (You approved, Claude ran). Renamed local `master` to `main` and
      pushed it to the new public `diegoagd10/open-calorie-tracker` (`origin`).
- [x] **0.3 Local checkouts** (Claude). `~/Projects/open-calorie-tracker` now pushes to the
      legacy repo.
- [ ] **0.4 Branches on GitHub** (Claude). Push each task's branch and open a PR to `main`.

## 1. Code (this repo, test-first)

- [x] **1.1 Health check** (Claude). `GET /v1/health` answers 200 once the database responds.
- [x] **1.2 MCP on the API's own URL** (You decided). No forwarding through the web app: the
      API is published on its own hostname (1.6 and 3.4), and Muse moves to it (3.6).
- [ ] **1.3 Legacy import command** (Claude). `node dist/import-legacy <old database file>`
      reads the old SQLite file and loads its user's food entries, the serving sizes they use,
      water entries and daily goals into the account that already exists, replacing that
      account's, in one transaction. Users and passwords are never touched.

      Tests cover each conversion: units, entries whose servings aren't in steps of 0.5, and
      missing nutrients.

- [ ] **1.4 Login rate limiting** (Claude). Limit failed logins per IP and username, since the
      API is public. Needed before the cutover.
- [x] **1.5 Docker images** (Claude). One `Dockerfile` with an `api` and a `web` target (Next.js
      standalone output), plus `.dockerignore`.
- [x] **1.6 Compose file** (Claude). Defines the `api` and `web` services and a data bind mount.
      Health checks use 1.1. Both are published on `127.0.0.1`, with ports set by variables. Done
      when `docker compose config -q` passes.
- [ ] **1.7 Deployment docs** (Claude). A README section listing the environment variables, how
      to import, how to update and how to back up.
- [ ] **1.8 Review and merge** (You). Review the PRs on GitHub; the work is merged into `main`.

## 2. Staging on svc-01 (old app keeps running)

- [ ] **2.1 Capacity and ports** (Claude). Check RAM, disk and free ports on svc-01, and record
      the chosen web and API ports here.
- [ ] **2.2 Create the stack** (Claude). Create `~/stacks/calorie` on svc-01 from a commit of
      `main` (copied with `git archive` and `rsync`; the server doesn't need GitHub access), with
      an override file and `.env` (`chmod 600`) holding newly generated `JWT_SECRET` and
      `API_KEY_SECRET` values. The stack is not exposed publicly.
- [ ] **2.3 Start** (Claude). Done when both services are healthy, a local `curl` to the web port
      gets the login page and one to the API port gets 200 from `/v1/health`.
- [ ] **2.4 Private HTTPS route** (Claude). Add `calorie-next.local.dagdappshub.com` to svc-01's
      Traefik config. Done when it answers with `ssl_verify=0`.
- [ ] **2.5 Register** (You). Create your account at `https://calorie-next.local.dagdappshub.com`
      before anything else reaches the stack.
- [ ] **2.6 Rehearsal import** (Claude). Take a hot copy of the prod database on svc-02 (SQLite
      backup) and import it into your account. Done when the counts match the old database:
      278 food, 192 water, 1 goal.
- [ ] **2.7 Check the data** (You). Sign in. Compare 3–4 days' totals
      with the old app. Edit an entry, then log and delete one. Re-run 2.6 whenever you want
      fresh data.

## 3. Cutover (about 2 minutes of downtime)

- [ ] **3.1 Pick the time** (You). Say when.
- [ ] **3.2 Rollback point** (Claude). Tag the old image and copy svc-02 `~/open-calorie`.
- [ ] **3.3 Stop the old app and run the final import** (Claude). Stop the old app on svc-02, then
      import into your account on svc-01. Counts match.
- [ ] **3.4 Public hostnames** (You). In Cloudflare Zero Trust, go to Tunnels. Move
      `calorie.dagdappshub.com` from svc-02's tunnel to svc-01's tunnel, pointing at
      `http://127.0.0.1:<web port>`. Then add `calorie-api.dagdappshub.com` to svc-01's tunnel,
      pointing at `http://127.0.0.1:<API port>`.
- [ ] **3.5 Verify publicly** (Both). Check a probe request in the logs of each service, sign in,
      and look at a past day and the water history.
- [ ] **3.6 Muse** (You). Create a new API key in Settings and set Muse's connector to
      `https://calorie-api.dagdappshub.com/v1/mcp` with that key. Done when Muse reads today's
      log.
- [ ] **3.7 LAN route** (Claude). Rename the Traefik route to `calorie.local.dagdappshub.com`.
- [ ] **3.8 Commit the stack** (Claude). Commit in `~/stacks` on svc-01, using the deployed
      commit hash in the message.

Rollback: stop the new stack, point `calorie.dagdappshub.com` back at svc-02 (`127.0.0.1:3001`),
remove `calorie-api.dagdappshub.com` and start the old stack. Its data was never modified.

## 4. Cleanup (about 2 weeks after cutover)

- [ ] **4.1 Remove the old stack** (You run the commands Claude provides). Archive svc-02
      `~/open-calorie` as a backup, then remove the old container, image and
      `~/stacks/calorie` on svc-02.
