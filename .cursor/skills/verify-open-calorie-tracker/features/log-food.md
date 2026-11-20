# Log food

Log food lets a signed-in person add a food to today's Food Log, cancel a draft, and open the saved entry again from the daily list.

## Sub-features

- `food-open` opens a blank Add food dialog from the Food Log.
- `food-cancel` discards an unfinished draft and leaves the day empty.
- `food-save` stores a name, a serving size, and the calories per serving.
- `food-reopen` shows those saved values from the daily list.

## How to get to it (user POV)

- Choose `Add food` on the Food Log at `/`.
- Choose the `Food Log` link in the header to return to `/` from Weight or Settings, then choose `Add food`.

## Driving it with ocal

Preconditions:

- `./scripts/verify/ocal doctor` prints `"ok": true` for this run.
- The browser is signed in as `demo`. Run the Log in recipe first.
- Today's list has no entry named `Oatmeal` or `Discard me`. A fresh `up` seeds only the user, so the list reads `No entries for this day`.

- **Open the dialog.** Run `./scripts/verify/ocal browser wait --role button --name "Add food"` and `./scripts/verify/ocal browser click --role button --name "Add food" --exact`. Run `./scripts/verify/ocal browser wait --role dialog --name "Add food"`. The dialog heading is `Add food`.
- **Cancel a draft.** Run `./scripts/verify/ocal browser fill --role textbox --name Food --value "Discard me" --within-role dialog --within-name "Add food"` and `./scripts/verify/ocal browser click --role button --name Cancel --within-role dialog --within-name "Add food"`. Run `./scripts/verify/ocal browser wait --role dialog --name "Add food" --state hidden`. The page still shows `No entries for this day`.
- **Enter the food.** Run `./scripts/verify/ocal browser click --role button --name "Add food" --exact`. Run `./scripts/verify/ocal browser fill --role textbox --name Food --value Oatmeal --within-role dialog --within-name "Add food"`, `./scripts/verify/ocal browser fill --role combobox --name "Serving size" --value "1 bowl" --within-role dialog --within-name "Add food"`, and `./scripts/verify/ocal browser fill --role textbox --name "Calories per serving" --value 150 --within-role dialog --within-name "Add food"`. The submit button name is `Add 150 kcal`.
- **Save.** Run `./scripts/verify/ocal browser screenshot --path artifacts/verify/log-food/dialog.png`. Run `./scripts/verify/ocal browser click --role button --name "Add 150 kcal" --within-role dialog --within-name "Add food" --wait-role button --wait-name "Oatmeal, 150 kcal"`. The daily list has a button whose name contains `Oatmeal, 150 kcal`.
- **Reopen.** Run `./scripts/verify/ocal browser screenshot --path artifacts/verify/log-food/list.png` and `./scripts/verify/ocal browser click --role button --name "Oatmeal, 150 kcal"`. Run `./scripts/verify/ocal browser wait --role dialog --name "Edit food"` and `./scripts/verify/ocal browser text --role textbox --name Food --within-role dialog --within-name "Edit food"`. `value` is `Oatmeal`. Run `./scripts/verify/ocal browser text --role combobox --name "Serving size" --within-role dialog --within-name "Edit food"` and `./scripts/verify/ocal browser text --role textbox --name "Calories per serving" --within-role dialog --within-name "Edit food"`. The values are `1 bowl` and `150`.
- **Stored row.** Run `./scripts/verify/ocal db --sql "SELECT food_entries.name, food_entries.calories, food_entries.quantity, serving_sizes.name AS serving_size FROM food_entries JOIN serving_sizes ON serving_sizes.id = food_entries.serving_size_id"`. One row: `Oatmeal`, `150`, `1`, `1 bowl`.
- **Proof.** Run `./scripts/verify/ocal browser snapshot --aria --path artifacts/verify/log-food/reopened.aria.txt`.

## Gotchas

- `Add food` on the page is absent until today's log has loaded. Wait for the button before clicking it.
- Until name, serving size, and calories are all set, the dialog submit button is named `Add food` and disabled. After they are set it is named `Add <kcal> kcal`. Scope that click with `--within-role dialog` so it does not hit the page button.
- Serving size is a combobox named `Serving size`, not a textbox.
- The entry button's accessible name includes the time of day, so match `Oatmeal, 150 kcal` and do not pass `--exact`.
- The database stores calories for all servings added together. This recipe uses one serving, so the row is 150. Choosing `More servings` makes the row larger than the per-serving field.
- A closed dialog is not proof. Reopen `Oatmeal` from the list and read the SELECT.
- Seed data does not include a food. `No entries for this day` is the required starting state.
