# Weight goal

A user sets a starting weight and a goal weight in Settings, logs today's weight on the Weight page, and sees how far they have come: the current weight, the pounds lost and to go, the progress percentage, and a chart once there are weigh-ins on two days.

## Sub-features

- `weight-goal-notice` shows a notice on `/weight`, with a link to the Weight goal section of Settings, while no goal exists.
- `weight-goal-set` saves the starting and goal weight. The goal starts today in the browser's time zone.
- `weight-log` saves today's weigh-in from the `Today's weight` form.
- `weight-log-replace` replaces today's weigh-in when the user saves again the same day.
- `weight-progress` measures the last weigh-in against the goal in the `Current`, `Lost`, `To go`, and `Progress` tiles.
- `weight-chart` draws the `Weight chart` once two days have weigh-ins, with the `Period` choices `30D`, `90D`, `1Y`, and `All`.
- `weight-goal-reached` says `Goal reached` once a weigh-in is at or under the goal.

## How to get to it (user POV)

- Choose the `Weight` link in the header of the Food Log or Settings.
- On `/weight` without a goal, choose the `Settings` link in the notice. It opens `/settings#weight-goal-heading`.
- Choose the `Settings` link in the header and scroll to `Weight goal`.

## Driving it with control-oct

Preconditions:

- A fresh `up`. The seed user has no weight goal and no weigh-ins.

```bash
C=.claude/skills/verify-open-calorie-tracker/control-oct.ts
TODAY=$(TZ=America/New_York date +%F)
WEEK_AGO=$(TZ=America/New_York date -d '-7 days' +%F)
$C login
$C click link "Weight"                  # url /weight
$C snapshot                             # the notice "Set your starting and goal weight in Settings", tiles "—", "No weigh-ins yet"
$C screenshot weight-goal-before.png
$C click link "Settings" --nth 1        # the notice's link, after the header's: url /settings#weight-goal-heading
$C type textbox "Starting weight" 180
$C type textbox "Goal weight" 165
$C press Enter                          # submits the Weight goal form
$C snapshot                             # form "Weight goal" shows "Weight goal saved."
$C api GET /v1/settings/weight-goal     # 200 {startWeight: 180, goalWeight: 165, startDate: $TODAY}
$C click link "Weight"
$C type textbox "Today's weight" 176.4
$C click button "Save"
$C snapshot                             # "Saved today", Current 176.4 lb, Lost 3.6 lb, To go 11.4 lb, Progress 24%
$C screenshot weight-goal-after.png
$C screenshot weight-goal-after-mobile.png --mobile
$C type textbox "Today's weight" 175.2
$C click button "Save"
$C api GET /v1/weight-history           # one entry for $TODAY, weight 175.2: the second save replaced the first
$C api POST /v1/weight-entries --body "{\"weight\": 181, \"date\": \"$WEEK_AGO\", \"timeZone\": \"America/New_York\"}"
$C goto /weight                         # setup above: a past weigh-in, which the UI cannot write
$C snapshot                             # radiogroup "Period" with radio "90D" [checked], img "Weight chart"
$C click radio "All"
$C type textbox "Today's weight" 164
$C click button "Save"
$C snapshot                             # "Goal reached", To go 0 lb, Progress 100%
$C api GET /v1/weight-history           # entries $WEEK_AGO 181 and $TODAY 164, goal 180 to 165, stats.progress 100
$C screenshot weight-goal-reached.png
```

End state that proves it works:

- The `weight-goal-after` screenshots show `Saved today` and the four tiles for 176.4 lb against a goal of 180 to 165 lb.
- `GET /v1/settings/weight-goal` returns the goal that the form saved, with `startDate` today.
- The last `GET /v1/weight-history` returns one entry for today, written by the form, and `stats` that match the tiles.
- The last snapshot shows `Goal reached` and the chart.

## Gotchas

- The header and the notice both have a link named `Settings`. Pass `--nth 1` for the notice's link. The notice is gone once a goal exists, and then `click link "Settings"` finds the header link.
- Settings has two buttons named `Save`, one for Daily goals and one for Weight goal. Press `Enter` in a field of the form you mean.
- The form saves only today's weight. A weigh-in for another day comes only from the API, as `POST /v1/weight-entries` with `date`. Use it for setup only.
- The chart needs weigh-ins on two days. With one, the Chart region says `Your chart starts tomorrow`.
- The goal weight must be under the starting weight, and a weight must be from 50 to 999 lb. Settings refuses a goal that is not under the start.
- A save that crosses the goal throws confetti, which a screenshot can catch mid-flight. With reduced motion there is no confetti, and `Goal reached` still shows.
