# open-calorie-tracker verification map

This directory is the maintained source for verifying the user-facing behavior of open-calorie-tracker. Read this index before you drive the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Run every block from the repo root.
- Start each feature from its own instance. Run `control-oct.ts down`, then `control-oct.ts up`. `up` takes about 5 seconds once the builds exist.
- The instance runs on base port 3300. Its seed user is `ana` with the password `correct-horse-battery-staple`, and it has no entries, goals beyond the defaults, serving sizes, or API keys.
- `doctor` must pass before a block starts.

## Driving conventions

- Every block sets `C` to the script and `E` to the evidence dir, `/tmp/oct-verify-3300-evidence`.
- Every block sets `TODAY` to the date in America/New_York, the time zone of the instance's Chromium. Compute other days from it the same way.
- Run a block as written, line by line, in one shell. A line that ends in `# exits 1` is a check that must fail.
- Read each target from a `snapshot` line, as `<role> "<name>"`. Log entries are named with their time, such as `button "Water, 16 fl oz, 5:06 PM"`, so target them by the part before the time.
- While a modal dialog is open, `click` and `type` look only inside the last one opened.

## Proof and skip reporting

- Capture the user action and the state it produced. A feature's proof is a `snapshot` line, a screenshot, and an `api` read that agree.
- Write through the UI. An `api` write is setup, and each block names it as setup.
- Report an unreachable path with the command you ran and the precondition that was missing. Do not report it as verified through another path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph about the user-visible behavior. Then it has four H2 sections in this order.

1. `Sub-features` lists short IDs, one line for each behavior.
2. `How to get to it (user POV)` lists every entry point a user has.
3. `Driving it with control-oct` lists the preconditions, the block, and the end state that proves the feature works.
4. `Gotchas` lists traps that waste or invalidate a run.

## Features

- [Weight goal](./weight-goal.md) sets a starting and goal weight, logs today's weight, and shows progress and the chart.
- [Water](./daily-log-water.md) logs water from a preset or a custom amount, edits it, and deletes it.
- [Food](./daily-log-food.md) adds food by hand with a serving size, servings, and nutrients, edits it, and deletes it.
- [Day navigation](./day-navigation.md) moves between days and weeks and logs entries on the day in view.
- [Auth](./auth.md) covers a failed login, login, logout, and registering the first account.
- [Settings](./settings.md) covers daily goals, the password, and API keys.
