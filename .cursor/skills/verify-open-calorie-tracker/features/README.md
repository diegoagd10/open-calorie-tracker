# Open Calorie Tracker verification map

This directory is the maintained source for verifying the user-facing behavior of Open Calorie Tracker. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch the app with `./scripts/verify/ocal up` from the checkout root.
- The seeded stack serves `http://127.0.0.1:3410` and the API at `http://127.0.0.1:3411`. Override both ports and `OCAL_RUN_DIR` together when another run is already using them.
- The database starts empty except for the seed user `demo` / `demo-password`. `up` runs migrations and that seed. It does not insert food, water, weight, or goals.
- Put `./scripts/verify/ocal` on the command line as that path. It does not need to be on `PATH`.
- Run `./scripts/verify/ocal doctor` and require `"ok": true`, plus the `webUrl`, `dataDir`, and `gitSha` of this run.
- Never drive an instance that was not started by this verification run.
- The Playwright regression uses ports 3100–3202. Do not point `OCAL_WEB_PORT` or `WEB_TEST_BASE_PORT` at each other.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Prefer ARIA roles and accessible names over CSS selectors or DOM position.
- Treat every command as literal. Keep quoted names and flags unchanged.
- Run browser actions through `./scripts/verify/ocal browser`.
- Run HTTP actions through `./scripts/verify/ocal call`.
- Read stored rows through `./scripts/verify/ocal db`.
- Sign in with the Log in recipe before any other recipe. `./scripts/verify/ocal browser reset` drops a leftover cookie jar without deleting the database.
- `down` removes the database. Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an ARIA snapshot and a screenshot with `Open Calorie Tracker` visible.
- Command proof includes the command, the JSON on stdout, and the exit code.
- Mutation proof includes a `db` SELECT of the stored row and a second view in the UI.
- Record the feature file and the entry point with every artifact under `artifacts/verify/`.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with ocal` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Log in](./log-in.md) covers the login form, a rejected password, and the redirect onto the Food Log.
- [Log food](./log-food.md) covers adding a food, canceling a draft, and reading it back from the list.
- [Log water](./log-water.md) covers the Add water dialog, a Glass preset, and a typed amount.
- [Log weight](./log-weight.md) covers today's weigh-in on the Weight page.
- [Change daily goals](./daily-goals.md) covers the calorie target on Settings.
