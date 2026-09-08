# Local verification

The repository exposes fast and deep gates through the package manager pinned in
`package.json`. Install with `pnpm install --frozen-lockfile` on the supported
Node 24 line before running either gate.

The Codex worktree setup in `.codex/environments/environment.toml` installs the
pinned dependencies and Git hooks automatically. `devEngines.runtime` in
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

- Vitest coverage consumed by Fallow health;
- type-aware Fallow dead-code, duplicate, and health regression gates;
- executable architecture and health policy tests;
- the local-fixture Playwright suite;
- 10,000 deterministic runs per domain property;
- Stryker policy and mutation-score regression checks;
- the allowlist policy, full dependency audit, and local CodeQL policy tests.

The deep gate usually takes 1–5 minutes when Stryker can reuse its incremental
data. A cold run or a change that invalidates many mutants can take 5–15 minutes
or longer. Chromium must already be installed; no browser download is hidden
inside the gate. Like the fast gate, the sequence stops on the first failure
and preserves the failing exit status.

`pnpm mutation:test` first reuses the latest compatible completed report in
`reports/stryker-incremental.json`, including measurements rejected by the score
gate. If the local report is unavailable or incompatible, it looks for a
compatible completed report in the repository's shared Git directory:
`$(git rev-parse --path-format=absolute --git-common-dir)/mutation-cache/v1/`.
Linked worktrees share this cache automatically; independent clones do not.
Each worktree runs Stryker with its own local files, then atomically publishes a
complete report. Concurrent publishers never write into each other's live
reports. Failed or incomplete Stryker runs cannot publish, while a complete
measurement rejected only by the score gate can still be reused. The shared
cache is disposable and is never committed or used as PR approval evidence.

Stryker compares production source and test changes. The existing conservative
context fingerprint separates results by the exact Node version, platform,
architecture, shard, dependencies, configuration, fixtures, migrations, runtime
wiring, scripts, and assets. Changes to these inputs during measurement reject
the result. A compatible shared report can replace an invalid local cache;
otherwise the runner forces a full measurement. On a fresh worktree with no
compatible shared report, the versioned report still seeds the first run.
Malformed shared entries are ignored. The score still has to meet both the
configured threshold and `mutation-testing/baseline-summary.json`.

The Vitest setup forwards Stryker's active mutation into real Node workers and
merges their measured counters back into the current test. Shared modules also
receive activation before initialization in the test thread. Application worker
messages and execution remain unchanged. `mutation:policy` runs an isolated
Stryker regression proving that a worker arithmetic fault and a shared-module
initialization fault are detected. Thresholds, exclusions, and the baseline
apply normally to worker code.
Stryker selects tests using that measured coverage. Its additional Vitest
`related` filter is disabled because Vite's import graph cannot follow a worker
path supplied at runtime; that filter can otherwise run zero tests for covered
worker mutations. The regression uses the repository's configured filter option.

`pnpm mutation:test` runs the full, unsharded local measurement. Optional manual
sharding remains available with `MUTATION_SHARD=1/8 pnpm mutation:test`; combine
all eight reports with `pnpm mutation:merge <directory> 8`.
`pnpm mutation:baseline` forces a complete unsharded measurement and remains
the explicit baseline review operation.

## Pull request gate

GitHub Actions workflows have been removed. Before opening a PR, install the
pinned dependencies and Playwright browsers, and start Docker with Compose
available. Use Node 24 as required by `package.json`.

Install the versioned hooks once in each checkout, with Node 24 and the pinned
pnpm available on PATH:

```sh
pnpm hooks:install
git add <changed-files>
git commit -m "Describe the change" # pre-commit runs both suites
git push -u origin HEAD           # pre-push runs both suites again
pnpm pr:create --title "Describe the change" --body-file /path/to/pr-body.md
```

The installer sets `core.hooksPath` to `.githooks` and preserves an existing
custom hook setup by refusing to replace it. With Git's `worktreeConfig`
extension enabled, the setting applies only to the current worktree; otherwise
it is local to the clone. Hooks are installed explicitly, so dependency installs
in Docker do not depend on a Git checkout.

`pre-commit` verifies the staged tree before the new commit SHA exists. All
tracked changes must be staged and untracked files must be staged or removed;
partial staging is rejected instead of testing content outside the proposed
commit. `git commit -a` is supported using Git's candidate index. A failure
preserves the index and working files and prevents the commit. Its report is
stored under `reports/pr-check/staged/<tree-sha>/summary.json`, with the parent
commit, staged tree, base, and command results. That report never authorizes a PR.

`pre-push` reads Git's proposed ref updates and verifies the exact SHA to be sent.
It accepts one update: the checked-out branch at HEAD, sent to the same branch
name on origin. Pushes of another commit, renamed destinations, tags, or multiple
refs are rejected. Deleting refs or a push with no updates publishes no code and
requires no checks. A failed verification prevents Git from sending the update.
It always reruns both suites, replacing any earlier result for that commit;
a successful push leaves the commit summary required by `pr:create`.

Both hooks stream test stdout/stderr back to the Git caller, preserve a nonzero
failure status, and print the path to the summary and logs. An AI invoking Git
receives those diagnostics in its command result: fix the cause and retry the
same commit or push command. Hooks do not automatically launch an AI or fix code.
The complete deep and deployment suites run on every commit and publishing push,
so both operations need the browser, Docker, registry access, and time for the
full checks. The first failing suite stops the operation.

The default base is `main` on `origin`. Set `git config pr.base release` to use
another base consistently in the hooks and PR commands. `pr:check` and
`pr:create` also accept `--base release` for a single invocation. The fetch and
push URLs for origin must match. Authenticate Git and the GitHub CLI before
publishing. The verification commands never commit or push automatically.

`pnpm pr:check` remains available to explicitly verify an already committed SHA.
With the hooks installed, a normal push performs this verification itself.

`pr:check` requires an attached feature branch and a clean working tree,
including staged and untracked files. It fetches the base and records the branch,
full HEAD SHA, origin URL, base branch, and base SHA. The branch must contain
commits beyond the base. It then runs `pnpm verify:deep` and
`pnpm test:deployment` in order, stopping at the first failure. Fallow uses the
recorded base SHA. Mutation testing uses the complete unsharded measurement and
the former workflow's 94.8% minimum as well as the existing baseline gate.

The ignored directory `reports/pr-check/<full-commit-sha>/` contains
`summary.json` with timestamps, per-command exit status, and the overall result,
plus a log for each executed command. Failed and interrupted runs never authorize
a PR. A rerun replaces the previous result before executing tests. The commands
use a per-worktree lock; if a forced kill leaves it behind, the error gives the
lock directory to remove after confirming the old process has stopped.

`pr:create` requires both checks to have passed for the current clean branch,
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
wrapper. Agents must keep the hooks enabled and use the documented flow.
Existing repository rules that require the deleted Actions checks must be updated separately by a maintainer.
`pr:check` runs tests of the CodeQL report policy through `verify:deep`; it does
not run a CodeQL scan. See [dependency security](dependency-security.md#codeql-results).

## Explicit external suites

The PR gate includes Docker deployment tests. The fast and deep gates remain
usable without Docker. Credentialed live-provider suites are separate:

```sh
pnpm test:deployment # also run by pr:check
pnpm test:photo-live # requires private PHOTO_PILOT_DATASET and PHOTO_AI_AUTH_PATH
FDC_API_KEY=... pnpm test:usda-live
```

`test:deployment` requires a working Docker daemon and Compose. The live suites
require their provider credentials and outbound network access; USDA browser
tests also need Chromium. No GitHub workflow runs these commands automatically.

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
