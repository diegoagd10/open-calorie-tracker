# Log weight

Log weight lets a signed-in person save today's weight in pounds and see that weigh-in on the Weight page.

## Sub-features

- `weight-open` shows the Weight page and today's empty field.
- `weight-save` stores today's weight.
- `weight-saved` shows `Saved today` after the save.
- `weight-chart` keeps a one-entry chart on its empty message until a second day exists.

## How to get to it (user POV)

- Choose the `Weight` link in the header on the Food Log or on Settings.
- Open `/weight` while signed in.

## Driving it with ocal

Preconditions:

- `./scripts/verify/ocal doctor` prints `"ok": true` for this run.
- The browser is signed in as `demo`. Run the Log in recipe first.
- `weight_entries` has no row for today. A fresh `up` seeds none.

- **Open Weight.** Run `./scripts/verify/ocal browser click --role link --name Weight` and `./scripts/verify/ocal browser wait --role heading --name Weight`. The URL path is `/weight`.
- **Enter today's weight.** Run `./scripts/verify/ocal browser fill --role textbox --name "Today's weight" --value 180.5 --within-role form --within-name "Today's weight"`. Run `./scripts/verify/ocal browser screenshot --path artifacts/verify/log-weight/form.png`.
- **Save.** Run `./scripts/verify/ocal browser click --role button --name Save --within-role form --within-name "Today's weight"`. Run `./scripts/verify/ocal browser wait --text "Saved today"`. The page shows `Saved today`.
- **Stored row.** Run `./scripts/verify/ocal db --sql "SELECT date, weight FROM weight_entries"`. One row whose weight is `180.5`.
- **Proof.** Run `./scripts/verify/ocal browser screenshot --path artifacts/verify/log-weight/saved.png` and `./scripts/verify/ocal browser snapshot --aria --path artifacts/verify/log-weight/saved.aria.txt`.

## Gotchas

- `Save` stays disabled until the history has loaded and the typed weight differs from the saved one. Wait for the textbox named `Today's weight` to be enabled before filling it. `./scripts/verify/ocal browser text --role textbox --name "Today's weight"` reports `disabled`.
- A weight must be from 50 to 999 pounds with at most one decimal. `180.5` is valid. `40` and `180.55` are not, and `Save` stays disabled.
- Several `Save` buttons exist on Settings. On this page, scope the click to the form named `Today's weight`.
- Seed data has no weight goal. The page tells the person to set one in Settings, and the Current, Lost, To go, and Progress tiles stay empty. That is the seeded state. Do not treat it as a failed save.
- The first weigh-in replaces `No weigh-ins yet` with `Your chart starts tomorrow`. A trend needs a weigh-in on another day, which this seed cannot provide. Report that chart as not verified rather than inventing a past day through the database.
