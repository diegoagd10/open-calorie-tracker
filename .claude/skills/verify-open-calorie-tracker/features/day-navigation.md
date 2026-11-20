# Day navigation

The Food Log shows one day at a time under a week strip from Monday to Sunday. A user picks a day in the strip, turns to the previous or next week, and comes back with `Today`. Food and water added while another day is in view land on that day, and today stays as it was.

## Sub-features

- `day-pick` selects a day from its button in the `Week` list. The `Daily log` names the day, and the footer reads `Food Log date <date>`.
- `week-turn` moves to the same weekday of the previous or next week with `Previous week` and `Next week`. The heading names the week and how far it is from this one, as in `Last week`.
- `day-today` returns to today with `Today`, a button that shows only away from today.
- `day-log` adds water and food to the day in view, without changing today.
- `week-progress` marks each day of the strip with its calories against the goal, after food is logged on it.

## How to get to it (user POV)

- Open the Food Log, `/`. The week strip is above the totals.
- On a phone, swipe the strip left for the next week and right for the previous one.

## Driving it with control-oct

Preconditions:

- A fresh `up`. No day has entries.

```bash
C=.claude/skills/verify-open-calorie-tracker/control-oct.ts
E=/tmp/oct-verify-3300-evidence
TODAY=$(TZ=America/New_York date +%F)
WEEK_AGO=$(TZ=America/New_York date -d '-7 days' +%F)
LAST_MONDAY=$(TZ=America/New_York date -d "-$(( $(TZ=America/New_York date +%u) + 6 )) days" +%F)
$C login
$C click button "Previous week"         # "· Last week", button "Today"; contentinfo "Food Log date $WEEK_AGO"
$C click button "$LAST_MONDAY"          # Daily log names that Monday; contentinfo "Food Log date $LAST_MONDAY"
$C click button "Add water"
$C click button "Bottle"
$C click button "Add food"
$C type textbox "Food" Toast
$C type combobox "Serving size" slice
$C type textbox "Calories per serving" 120
$C click button "Add 120 kcal"
$C snapshot                             # Calories 120 / 1,600 kcal, Water 16 fl oz / 64 fl oz, Entries "Toast, 120 kcal" and "Water, 16 fl oz"
$C press Home                           # scrolls back to the week strip
$C screenshot $E/day-navigation.png
$C click button "Today"                 # "· This week"; contentinfo "Food Log date $TODAY"; "No entries for this day"
$C click button "Next week"             # "· Next week"; the footer names today's weekday a week ahead
$C click button "Today"                 # contentinfo "Food Log date $TODAY" again
$C api GET "/v1/daily-log?date=$LAST_MONDAY&timeZone=America/New_York"   # Toast 120 kcal and water 16, with loggedAt on that Monday
$C api GET "/v1/daily-log?date=$TODAY&timeZone=America/New_York"         # entries []
$C api GET "/v1/daily-summaries?from=$LAST_MONDAY&to=$TODAY&timeZone=America/New_York"   # calories 120 on $LAST_MONDAY only
```

End state that proves it works:

- `day-navigation.png` shows `Last week` with its Monday selected and ringed, and the Toast and the water in its Daily log.
- `GET /v1/daily-log` for that Monday returns both entries, and for today returns none.
- `GET /v1/daily-summaries` counts the 120 kcal on that Monday and 0 on every other day.

## Gotchas

- The URL stays `/` on every day. Read the day from the footer, `Food Log date <date>`, or from the Daily log heading.
- Each day button is named by its ISO date, such as `button "2026-11-16"`, and shows `Mon 16`.
- A week runs from Monday to Sunday. `Previous week` keeps the weekday of the day in view, so `LAST_MONDAY` is computed from `date +%u`.
- The browser decides what today is, in America/New_York. A run that crosses midnight there moves `TODAY`.
- Swipes need touch input, which the drive commands do not send. `screenshot --mobile` only renders the phone size.
- `Next week` opens future weeks too.
