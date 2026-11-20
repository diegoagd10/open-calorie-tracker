# Change daily goals

Change daily goals lets a signed-in person set the calorie and nutrient targets the Food Log measures each day against.

## Sub-features

- `goals-open` shows the Daily goals form on Settings with the default targets.
- `goals-unchanged` keeps `Save` disabled when nothing was edited.
- `goals-invalid` keeps `Save` disabled for an empty or zero goal.
- `goals-save` stores a new calorie target and shows `Daily goals saved.`

## How to get to it (user POV)

- Choose the `Settings` link in the header on the Food Log or on Weight.
- Open `/settings` while signed in. Daily goals is on that page.

## Driving it with ocal

Preconditions:

- `./scripts/verify/ocal doctor` prints `"ok": true` for this run.
- The browser is signed in as `demo`. Run the Log in recipe first.
- `daily_goals` has no row. A fresh `up` does not seed goals. The form still shows the defaults: 1600 kcal, 120 g protein, 230 g carbohydrate, 70 g fat, 25 g fiber, 50 g sugar, 2300 mg sodium, and 64 fl oz water.

- **Open Settings.** Run `./scripts/verify/ocal browser click --role link --name Settings` and `./scripts/verify/ocal browser wait --role heading --name "Daily goals"`. The URL path is `/settings`.
- **Unchanged save.** Run `./scripts/verify/ocal browser text --role button --name Save --within-role form --within-name "Daily goals"`. `disabled` is true.
- **Reject zero.** Run `./scripts/verify/ocal browser fill --role textbox --name Calories --value 0 --within-role form --within-name "Daily goals"`. Run `./scripts/verify/ocal browser text --role button --name Save --within-role form --within-name "Daily goals"`. `disabled` is still true.
- **Set calories.** Run `./scripts/verify/ocal browser fill --role textbox --name Calories --value 1800 --within-role form --within-name "Daily goals"` and `./scripts/verify/ocal browser screenshot --path artifacts/verify/daily-goals/form.png`. Run `./scripts/verify/ocal browser click --role button --name Save --within-role form --within-name "Daily goals"` and `./scripts/verify/ocal browser wait --text "Daily goals saved."`.
- **Stored row.** Run `./scripts/verify/ocal db --sql "SELECT calories, protein, carbohydrate, fat, fiber, sugar, sodium, water FROM daily_goals"`. One row: `1800`, `120`, `230`, `70`, `25`, `50`, `2300`, `64`.
- **Proof.** Run `./scripts/verify/ocal browser screenshot --path artifacts/verify/daily-goals/saved.png` and `./scripts/verify/ocal browser snapshot --aria --path artifacts/verify/daily-goals/saved.aria.txt`.

## Gotchas

- `Save` is disabled until a goal actually changes and every field is a whole number from 1 to 99999. Leaving the defaults on screen is not a failed save.
- The calorie field is the textbox named `Calories` inside the form named `Daily goals`. Settings also has a `Save` button on the weight goal form. Scope the click.
- Before the first save, `SELECT` from `daily_goals` returns no rows even though the form shows 1600. That empty table is the seeded state. The row appears only after `Daily goals saved.`
- The other targets stay at their defaults when only calories is changed. A proof that only checks for a row, without the calorie value 1800, is incomplete.
