# Local verification

The repository exposes fast and deep gates through the package manager pinned in
`package.json`. Install with `pnpm install --frozen-lockfile` on the supported
Node 24 line before running either gate.

The Codex worktree setup in `.codex/environments/environment.toml` installs the
pinned dependencies and Git hook automatically. `devEngines.runtime` in
`package.json` pins Node 24.13.0: pnpm downloads that runtime during installation
and uses it for project scripts, even when the host shell uses another Node
version. `pnpm exec node --version` verifies the project runtime. Browser
installation and Docker remain the host prerequisites described below.

## Fast gate

```sh
pnpm verify
```

Use the fast gate while developing and before handing off a normal change. It
runs TypeScript and React Router type generation, type-aware linting, the
deterministic Vitest suite, a new-only Fallow audit, and the exception-free
production dependency audit. Each step runs in sequence, stops at the first
failure, and returns that command's non-zero exit code.

The fast audit uses Fallow's static coverage estimate and does not require a
pre-existing coverage report. Commands in the deep gate pass the freshly
generated Istanbul report explicitly to Fallow health.

On a warm development machine it should normally finish in under one minute;
the dependency audit can vary with registry latency. Fallow compares the
working change with the merge base it discovers from Git. The PR gate pins that base
with `FALLOW_AUDIT_BASE`.

`pnpm lint:check` is the type-aware lint command used by this gate. Oxlint's
type-aware engine requires TypeScript 7, while the stable Drizzle declarations
keep this repository on TypeScript 6. ESLint with `typescript-eslint` project
service is therefore the documented single fallback; a parallel syntax-only
Oxlint pass would create a second, weaker contract.

## Deep gate

```sh
pnpm exec playwright install chromium webkit # once per machine
pnpm verify:deep
```

The camera scanner journey always runs with mobile Chromium. Supported
local hosts also run that same tagged journey with the iPhone WebKit profile.
Playwright's WebKit binary is skipped only on Arch-derived hosts, which its
published Linux binary does not support.

Use the deep gate before a release and after broad production, architecture,
testing, or tooling changes. It first runs the complete fast gate, then adds:

- Vitest production-code coverage thresholds, with the report also consumed by Fallow health;
- type-aware Fallow dead-code, duplicate, and health regression gates;
- executable architecture and health policy tests;
- the local-fixture Playwright suite;
- 10,000 deterministic runs per domain property;
- the allowlist policy, full dependency audit, and local CodeQL policy tests.

The coverage gate includes every TypeScript or JavaScript module under `app/`
and `server/`, plus the root production entry point `server.js`, even when a
module was never loaded by a test. Declaration files, deterministic
`app/**/test-fixture.server.ts` browser adapters, and the Playwright-only HTTPS
host are excluded because they are test tooling rather than production code.
Configuration, scripts, migrations, and other repository tooling are outside
the include list.

Statements, branches, functions, and lines must each exceed 95% in aggregate;
`vitest.config.ts` expresses that strict boundary as 95.01%. The command fails
when any metric falls below it, so the same gate applies anywhere
`pnpm test:coverage` or `pnpm verify:deep` runs.

The browser gate runs application action journeys over public HTTPS and LAN HTTP.
The camera matrix stays on the secure entry. `pnpm test:browser:catalog` runs the
public and LAN catalog projects in separate server lifetimes so each starts with
a fresh fixture database; when running the catalog config directly, select one
project with `--project chromium` or `--project lan-chromium`.

Chromium must already be installed; no browser download is hidden inside the
deep gate. Like the fast gate, the sequence stops on the first failure and
preserves the failing exit status.

## Pull request gate

GitHub Actions workflows have been removed. Before opening a PR, install the
pinned dependencies and Playwright browsers. Use Node 24 as required by
`package.json`.

Install the versioned hook once in each checkout, with Node 24 and the pinned
pnpm available on PATH:

```sh
pnpm hooks:install
git add <changed-files>
git commit -m "Describe the change"
git push -u origin HEAD           # pre-push runs verify:deep
pnpm pr:create --title "Describe the change" --body-file /path/to/pr-body.md
```

The installer sets `core.hooksPath` to `.githooks` and preserves an existing
custom hook setup by refusing to replace it. With Git's `worktreeConfig`
extension enabled, the setting applies only to the current worktree; otherwise
it is local to the clone. The hook is installed explicitly, so dependency installs
in Docker do not depend on a Git checkout.

`pre-push` reads Git's proposed ref updates and verifies the exact SHA to be sent.
It accepts one update: the checked-out branch at HEAD, sent to the same branch
name on origin. Pushes of another commit, renamed destinations, tags, or multiple
refs are rejected. Deleting refs or a push with no updates publishes no code and
requires no checks. A failed verification prevents Git from sending the update.
It always reruns `pnpm verify:deep`, replacing any earlier result for that commit;
a successful push leaves the commit summary required by `pr:create`.

The hook streams test stdout/stderr back to the Git caller, preserves a nonzero
failure status, and prints the path to the summary and logs. An AI invoking Git
receives those diagnostics in its command result: fix the cause and retry the
same push command. The hook does not automatically launch an AI or fix code.
The complete deep suite runs on every publishing push, so it needs the browser,
registry access, and time for the full checks.

The default base is `main` on `origin`. Set `git config pr.base release` to use
another base consistently in the hook and PR commands. `pr:check` and
`pr:create` also accept `--base release` for a single invocation. The fetch and
push URLs for origin must match. Authenticate Git and the GitHub CLI before
publishing. The verification commands never commit or push automatically.

`pnpm pr:check` remains available to explicitly verify an already committed SHA.
With the hook installed, a normal push performs this verification itself.

`pr:check` requires an attached feature branch and a clean working tree,
including staged and untracked files. It fetches the base and records the branch,
full HEAD SHA, origin URL, base branch, and base SHA. The branch must contain
commits beyond the base. It then runs `pnpm verify:deep`, stopping on failure.
Fallow uses the recorded base SHA. The production coverage thresholds run as
part of `verify:deep`.

The ignored directory `reports/pr-check/<full-commit-sha>/` contains
`summary.json` with timestamps, per-command exit status, and the overall result,
plus a log for each executed command. Failed and interrupted runs never authorize
a PR. A rerun replaces the previous result before executing tests. The commands
use a per-worktree lock; if a forced kill leaves it behind, the error gives the
lock directory to remove after confirming the old process has stopped.

`pr:create` requires the check to have passed for the current clean branch,
commit, origin, and freshly fetched base SHA. It also checks that the branch
already published on origin points to that exact commit before invoking
`gh pr create` with an explicit repository, base, and head. Changes to the commit
(including amend/rebase), branch name, or base invalidate the saved result.
Changing tracked files during checks also fails the gate.

Supported PR options are `--title`, `--body`, `--body-file`, `--draft`, `--fill`,
`--fill-first`, `--fill-verbose`, `--reviewer`, `--assignee`, `--label`,
`--milestone`, and `--project`. Head and repository overrides are rejected.

This is a local workflow gate, not GitHub branch protection. Git allows hooks
to be bypassed, and the website or a direct `gh pr create` call bypasses the PR
wrapper. Agents must keep the hook enabled and use the documented flow.
Existing repository rules that require the deleted Actions checks must be updated separately by a maintainer.
`pr:check` runs tests of the CodeQL report policy through `verify:deep`; it does
not run a CodeQL scan. See [dependency security](dependency-security.md#codeql-results).

## Credentialed external suite

The credentialed AI photo pilot remains separate:

```sh
PHOTO_PILOT_DATASET=... PHOTO_AI_AUTH_PATH=... PHOTO_PILOT_USDA_ARCHIVE=... pnpm test:photo-live
```

The photo pilot requires its AI-provider credentials, a local USDA Foundation
archive, and outbound AI access. No GitHub workflow runs it automatically.

## Fallow baselines

The versioned files in `fallow-baselines/` record inherited dead code,
duplication, and health debt. The gates suppress only matching inherited
findings and fail when a new finding appears. They are review artifacts, not
generated output: never regenerate them merely to make a gate pass.

After an intentional debt change has been reviewed, update only the affected
baseline from a clean base and inspect its diff:

```sh
pnpm exec fallow dead-code --type-aware --type-aware-require best-effort \
  --save-baseline fallow-baselines/dead-code.json
pnpm exec fallow dupes --type-aware --type-aware-require best-effort \
  --save-baseline fallow-baselines/dupes.json
pnpm test:coverage
pnpm exec fallow health --type-aware --type-aware-require best-effort \
  --coverage coverage/coverage-final.json --baseline-mode identity \
  --save-baseline fallow-baselines/health.json
git diff -- fallow-baselines/
```
