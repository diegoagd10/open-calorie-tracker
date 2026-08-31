# Mutation testing

StrykerJS measures whether the Vitest suite notices deliberately incorrect
changes in production code. Run the regression check with:

```sh
pnpm mutation:test
```

The command seeds Stryker's incremental cache from the versioned result in
`mutation-testing/`, runs only mutants invalidated by the current changes, and
compares the resulting mutation score with the measured baseline. It exits
nonzero when the exact score decreases. The HTML and JSON reports are written
under the ignored `reports/` directory.

There is deliberately no hand-picked Stryker `thresholds.break` percentage.
The regression gate derives its limit from the checked-in full run and compares
the underlying detected/valid mutant counts without rounded percentages.

## Scope and exclusions

`stryker.config.mjs` includes every executable JavaScript and TypeScript file in
the production roots `app/`, `server/`, and `server.js`. It excludes only:

- `*.d.ts` and `*.d.mts`, because declarations have no runtime behavior;
- `drizzle/`, because generated SQL migrations and snapshots are immutable
  database history rather than application logic;
- `.react-router/`, because React Router regenerates those derived type files.

Styles, images, manifests, and other non-JavaScript assets are not eligible for
StrykerJS mutation. Browser and deployment tests remain outside the Vitest
mutation runner; their production targets still enter the mutation set and are
reported as uncovered when no Vitest test executes them.

## Updating the baseline

Create a new baseline only after reviewing an intentional change to production
behavior or tests:

```sh
pnpm mutation:baseline
git diff -- mutation-testing/
```

This forces every mutant to run. It records the wall-clock duration, mutation
score, all status counts, and surviving/undetected mutants grouped by module and
mutator category in `baseline-summary.json`. The adjacent full Stryker report
contains the individual mutant evidence and doubles as the incremental seed.
Never lower or regenerate the baseline merely to make the check pass.

The initial result exposed a larger route-testing design problem: 2,003
mutants under `app/routes/` had no Vitest coverage. The testing seam, first
measured increment, and reviewable follow-up slices are documented in the
[route testing strategy](route-testing.md).
