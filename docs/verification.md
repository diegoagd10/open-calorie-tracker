# Local verification

The repository exposes two stable gates through the package manager pinned in
`package.json`. Install with `pnpm install --frozen-lockfile` on the supported
Node 24 line before running either gate.

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
working change with the merge base it discovers from Git. CI can pin that base
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

The camera scanner journey always runs with mobile Chromium. CI and supported
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

## GitHub Actions

GitHub runs the same package scripts on the supported Node 24 line with the
project's pinned `pnpm@11.19.0`. The fast verification workflow runs for every
pull request. It checks out the complete Git history and sets
`FALLOW_AUDIT_BASE` to the pull request's exact base commit, so Fallow evaluates
only the proposed change even when the pull request targets a branch other than
`main`.

The deep verification workflow runs every Wednesday at 06:29 UTC and can also
be started from **Actions > Deep verification > Run workflow**. It installs
Chromium explicitly before invoking `pnpm verify:deep`.

Expensive focused workflows use path filters that cover their implementation,
tests, configuration, dependency graph, and workflow definition:

| Workflow | Automatic trigger scope |
| --- | --- |
| Fast verification | Every change, with no path exclusions. |
| Mutation testing | Application and server code, tests, mutation baselines and tooling, root build/test configuration, or dependencies. |
| CodeQL | JavaScript or TypeScript sources, dependencies, or its workflow. |
| Dependency audit | Dependency manifests and lockfile, audit policy and allowlist, or its workflow. |
| Deployment tests | Image and Compose inputs, production code, scripts and assets, migrations, deployment tests, root build configuration, or dependencies. |

Every gate keeps its non-zero exit status, so a typecheck, lint, test,
architecture, mutation regression, or security failure fails the corresponding
check. Console logs are retained as workflow artifacts for 14 days; the deep,
mutation, and CodeQL jobs also retain their generated coverage, browser,
mutation, or SARIF reports when available. Artifact uploads use `if: always()`
so diagnostics survive a failed gate.

## Explicit external suites

Docker, live network access, and credentials remain outside both gates:

```sh
pnpm test:deployment
FDC_API_KEY=... pnpm test:usda-live
```

`test:deployment` requires a working Docker daemon. `test:usda-live` requires a
registered USDA FoodData Central key and calls the live provider. These suites
must be selected deliberately because their environment and failure modes are
not reproducible in the ordinary local gate.

GitHub keeps them in separate workflows:

- **Deployment tests** runs on GitHub-hosted Linux runners, where Docker and
  Docker Compose are available. It runs automatically only for paths that can
  change the production container contract and is also manually dispatchable.
- **USDA live tests** is manual-only because it exercises an external API and
  website. Configure an Actions repository secret named `FDC_API_KEY` before
  dispatching it. The job requires outbound network access, a registered key
  other than `DEMO_KEY`, and Chromium; the workflow validates the secret and
  installs the browser explicitly.

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
