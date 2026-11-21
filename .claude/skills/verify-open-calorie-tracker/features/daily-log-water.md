# Water

A user logs water on the Food Log with one tap on a preset or with a custom amount, then edits or deletes an entry. The `Water` total and the `Daily log` list update at once.

## Sub-features

- `water-dialog` opens `Add water` with today's total, the amount to go, and what each preset would bring the total to.
- `water-preset` logs a `Glass` (8 fl oz), a `Bottle` (16 fl oz), or a `Gallon` (128 fl oz) with one tap.
- `water-custom` logs the amount typed in `Amount (fl oz)` with `Add` or with `Enter`.
- `water-edit` opens an entry in `Edit water`, where a preset replaces the amount with one tap and `Save` keeps a typed amount.
- `water-delete` deletes an entry after the `Delete this glass?` confirmation, and `Keep it` goes back to `Edit water`.

## How to get to it (user POV)

- Choose `Add water` under the Daily log on the Food Log, `/`.
- Choose a water entry in the `Entries` list to edit or delete it.

## Driving it with control-oct

Preconditions:

- A fresh `up`. Today has no entries.

```bash
C=.claude/skills/verify-open-calorie-tracker/control-oct.ts
TODAY=$(TZ=America/New_York date +%F)
$C login
$C click button "Add water"
$C snapshot                             # dialog "Add water": "0 of 64 fl oz today · 64 to go", button "Glass 8 fl oz → 8 today"
$C click button "Glass"                 # the dialog closes; Entries has "Water, 8 fl oz"
$C click button "Add water"
$C type textbox "Amount (fl oz)" 12
$C press Enter                          # Entries has "Water, 12 fl oz" above "Water, 8 fl oz"; Water 20 fl oz / 64 fl oz
$C click button "Water, 12 fl oz"       # dialog "Edit water"
$C click button "Bottle 16"             # the dialog closes; the entry is now "Water, 16 fl oz"
$C click button "Water, 8 fl oz"
$C click button "Delete"                # alertdialog "Delete this glass?" over "Edit water"
$C click button "Keep it"               # back to "Edit water"
$C click button "Delete"
$C click button "Delete 8 fl oz"        # both dialogs close
$C snapshot                             # Water 16 fl oz / 64 fl oz; Entries has only "Water, 16 fl oz"
$C api GET "/v1/daily-log?date=$TODAY&timeZone=America/New_York"   # one entry {type: water, amount: 16}, totals.water 16
$C screenshot daily-log-water.png
```

End state that proves it works:

- The last snapshot and `daily-log-water.png` show `16 fl oz / 64 fl oz` and one entry, `Water, 16 fl oz`.
- `GET /v1/daily-log` for today returns that one water entry with `amount` 16 and `totals.water` 16.

## Gotchas

- An entry's button name ends with its time, such as `Water, 16 fl oz, 5:06 PM`. Target it by the part before the time.
- The `Add` button names nothing until an amount is typed, and it stays disabled for `0`, `0.0`, and `.`. A custom amount goes up to 128 fl oz with one decimal.
- The Water bar stays blue past the goal. The other bars turn red over theirs.
- The confirmation names the preset that matches the amount, as in `Delete this glass?`. An amount that matches no preset asks to delete a `water entry`.
- `Edit water` sends nothing when the amount did not change.
