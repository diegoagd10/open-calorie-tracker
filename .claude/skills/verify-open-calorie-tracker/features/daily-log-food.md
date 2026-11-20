# Food

A user adds a food by hand on the Food Log: its name, a serving size, the number of servings, the calories per serving, and optional nutrients. The `Calories` total, the nutrient bars, and the `Daily log` list update at once. The user can then edit or delete the entry.

## Sub-features

- `food-dialog` opens `Add food` with an empty form, today's calories, and the amount to go.
- `food-serving-size-create` offers `Create “<name>”` for a serving size the user has not saved, and saves it with the food.
- `food-serving-size-pick` lists the user's saved serving sizes that match what is typed.
- `food-servings` steps the servings by 0.5 with `More servings` and `Fewer servings`, and multiplies the calories and nutrients.
- `food-nutrients` opens six optional fields per serving: protein, carbohydrate, fat, fiber, sugar, and sodium.
- `food-preview` names the total on the submit button, as in `Add 225 kcal`, and previews today's calories.
- `food-edit` opens an entry in `Edit food` and saves the changes in place.
- `food-delete` deletes an entry after the `Delete this food?` confirmation.

## How to get to it (user POV)

- Choose `Add food` under the Daily log on the Food Log, `/`.
- Choose a food entry in the `Entries` list to edit or delete it.

## Driving it with control-oct

Preconditions:

- A fresh `up`. Today has no entries and the seed user has no serving sizes.

```bash
C=.claude/skills/verify-open-calorie-tracker/control-oct.ts
E=/tmp/oct-verify-3300-evidence
TODAY=$(TZ=America/New_York date +%F)
$C login
$C click button "Add food"
$C type textbox "Food" "Greek yogurt"
$C type combobox "Serving size" cup
$C click button "Create “cup”"
$C click button "More servings"         # Servings 1.5
$C type textbox "Calories per serving" 150
$C click button "Nutrients"
$C type textbox "Protein g" 12
$C snapshot                             # "1.5 × 150 kcal = 225 kcal", "With 225 kcal: 225 / 1,600 kcal", button "Add 225 kcal"
$C click button "Add 225 kcal"          # Entries has "Greek yogurt, 225 kcal"; Calories 225 / 1,600 kcal
$C click button "Add food"
$C type textbox "Food" Banana
$C type combobox "Serving size" cu
$C click button "cup"                   # the saved serving size, listed under "Matching serving sizes"
$C type textbox "Calories per serving" 105
$C click button "Add 105 kcal"
$C click button "Greek yogurt, 225 kcal"   # dialog "Edit food"
$C click button "Fewer servings"        # Servings 1
$C click button "Save 150 kcal"
$C click button "Banana, 105 kcal"
$C click button "Delete"                # alertdialog "Delete this food?"
$C click button "Delete 105 kcal"
$C snapshot                             # Calories 150 / 1,600 kcal, Protein 12 / 120 g; Entries has only "Greek yogurt, 150 kcal" with "cup × 1"
$C api GET "/v1/daily-log?date=$TODAY&timeZone=America/New_York"   # one entry: Greek yogurt, servingSize cup, quantity 1, calories 150, protein 12
$C api GET /v1/serving-sizes            # [{name: cup}]
$C screenshot $E/daily-log-food.png
```

End state that proves it works:

- The last snapshot and `daily-log-food.png` show `150 / 1,600 kcal` and one entry, `Greek yogurt`, `cup × 1`, `150 kcal`.
- `GET /v1/daily-log` for today returns that entry with `source` `manual`, `quantity` 1, `calories` 150, and `protein` 12, and `totals.foodEntries` 1.
- `GET /v1/serving-sizes` returns the `cup` that the first save created, once.

## Gotchas

- The web app has no barcode scanner. Barcode lookup exists only in the API, as `GET /v1/products/:barcode` and the MCP tool behind API keys. It calls Open Food Facts at `OPEN_FOOD_FACTS_URL`, which `up` leaves at the real `https://world.openfoodfacts.org`. Do not call it in a proof. No production boundary mocks it in this instance.
- The dialog stores calories and nutrients multiplied by the servings. `Edit food` shows them per serving again, as the label prints them.
- `Add food` stays disabled until the food has a name, a serving size, and a calorie value. `0` counts as a value. Typing a new serving size is enough. `Create` only marks it as new.
- A blank nutrient is stored as `null` and counts as 0 in the totals.
- The serving size list opens only once something is typed. It lists at most 5 matches.
- `Edit food` sends nothing when nothing changed, so `Save` closes the dialog without a request.
