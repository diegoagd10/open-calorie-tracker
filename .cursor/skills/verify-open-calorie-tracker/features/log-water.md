# Log water

Log water lets a signed-in person add a drink to today's Food Log from the Add water dialog and see the ounces in the daily list.

## Sub-features

- `water-open` opens the Add water dialog.
- `water-cancel` closes it without a new entry.
- `water-preset` logs a Glass, a Bottle, or a Gallon in one tap.
- `water-custom` logs an amount typed into the amount field.

## How to get to it (user POV)

- Choose `Add water` on the Food Log at `/`.

## Driving it with ocal

Preconditions:

- `./scripts/verify/ocal doctor` prints `"ok": true` for this run.
- The browser is signed in as `demo`. Run the Log in recipe first.
- Today's list has no water entry. A fresh `up` does not seed water, so this holds until this recipe logs one.

- **Open the dialog.** Run `./scripts/verify/ocal browser wait --role button --name "Add water"` and `./scripts/verify/ocal browser click --role button --name "Add water" --exact`. Run `./scripts/verify/ocal browser wait --role dialog --name "Add water"`.
- **Cancel.** Run `./scripts/verify/ocal browser click --role button --name Cancel --within-role dialog --within-name "Add water"` and `./scripts/verify/ocal browser wait --role dialog --name "Add water" --state hidden`. The list has no button whose name contains `Water,`.
- **Log a glass.** Run `./scripts/verify/ocal browser click --role button --name "Add water" --exact` and `./scripts/verify/ocal browser screenshot --path artifacts/verify/log-water/dialog.png`. Run `./scripts/verify/ocal browser click --role button --name Glass --within-role dialog --within-name "Add water" --wait-role button --wait-name "Water, 8 fl oz"`. The list button name contains `Water, 8 fl oz`.
- **Stored row.** Run `./scripts/verify/ocal db --sql "SELECT amount FROM water_entries"`. One row, amount `8`.
- **Custom amount.** Run `./scripts/verify/ocal browser click --role button --name "Add water" --exact` and `./scripts/verify/ocal browser fill --role textbox --name "Amount (fl oz)" --value 12 --within-role dialog --within-name "Add water"`. Run `./scripts/verify/ocal browser click --role button --name "Add 12 fl oz" --within-role dialog --within-name "Add water" --wait-role button --wait-name "Water, 12 fl oz"`. A second SELECT row is `12`.
- **Proof.** Run `./scripts/verify/ocal browser screenshot --path artifacts/verify/log-water/list.png` and `./scripts/verify/ocal browser snapshot --aria --path artifacts/verify/log-water/list.aria.txt`.

## Gotchas

- A preset logs as soon as it is tapped. Do not also press the submit button for that glass.
- The Glass button's accessible name includes the ounces and the projected total, so match `Glass` and do not pass `--exact`.
- The amount field's accessible name is `Amount (fl oz)`. The visible label is `Amount`.
- `Add water` on the page is absent until today's log has loaded.
- Seed data has no water row. An empty `water_entries` result before this recipe is the required starting state, not a broken seed.
