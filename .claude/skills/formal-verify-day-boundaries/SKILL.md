---
name: formal-verify-day-boundaries
description: Formally verify which day an entry of open-calorie-tracker belongs to, by running the real dayRange and loggedAtOnDay on every time zone and every clock change from 1970 to 2037. Use before and after any change to apps/api/src/daily-log/day.ts, daily-log.service.ts, loggedAtOnDay, time zone validation, or the Node version, and for any bug about an entry on the wrong day, midnight, daylight saving time or time zones.
---

# Formally verify the day boundaries

A day is the time between two local midnights, and some zones skip midnight when the clocks change. Tests that use New York never see it. No model checker or verifier runs on this TypeScript and its time zone data, so this check runs the real functions on every case in its bounds.

## What must hold

| Rule                            | Promise                                                                                  | Harm when it breaks                          |
| ------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------- |
| `FirstMoment`                   | `dayRange` starts a day at the first moment whose local date is that day or a later one. | Late food counts on the wrong day.           |
| `DaysTile`                      | A day ends where the next one starts.                                                    | An entry is on two days, or on none.         |
| `OwnDay`                        | From 2011, every moment is in the range of its own local date.                           | Food shows on a day the user did not eat it. |
| `EveryZone`                     | Each time zone name that the API accepts gives a day of 24 hours on an ordinary date.    | The Food Log answers 500 to that user.       |
| `LogsOnItsDay`                  | From 2011, `loggedAtOnDay` gives a moment in the range of the day in view.               | An entry added to one day shows on another.  |
| The daily log and the summaries | `DailyLogService` puts each entry on its own day around every clock change of 2026.      | The log and the week strip disagree.         |

## Run it

Run this from the repo root, after `pnpm install`:

```bash
.claude/skills/formal-verify-day-boundaries/check.ts
```

It takes about 40 seconds. It needs no tool beyond the repo's. Exit code 0 means verified, and 1 means a check failed. Each failed rule prints how often it breaks and one case. The check also runs three broken designs of `dayRange`, in `broken.ts`, and fails when a rule does not catch its design. `guessedOffset` is the method the code used before this skill.

## Does my change touch it?

It does when it changes a file in `coverage.json`, when it adds another way to turn a date into moments or a moment into a date, or when it changes the Node version, which brings the time zone data.

## Read the result

- **A rule breaks.** The line names the zone, the date and the moment. Reproduce it with `seedFoodEntry` in `apps/api/test/daily-log.e2e-spec.ts`, or with the browser set to that zone. The code has the bug, unless the case is new time zone data that the rule does not expect. Do not narrow the years or the zones to make it pass.
- **Only the covered code fails.** The content changed, and the rules still hold. Read the diff, as the next section says, and confirm it.
- **A broken design does not break its rule.** The rule lost the ability to fail. Fix the rule before you trust a pass.

## Update it

1. Find the last confirmed commit and read what changed since:
   ```bash
   cd .claude/skills/formal-verify-day-boundaries
   SYNC=$(git log -1 --format=%H -- coverage.json)
   jq -r 'keys[]' coverage.json | (cd ../../.. && xargs git diff "$SYNC" --)
   ```
2. When a function moves or gets another signature, update the imports and `RULES` in `days.spec.ts`.
3. Break the new code on purpose, such as by ending `dayRange` 24 hours after its start. Run the check, see it fail, and drop the break.
4. Only when you have read the diff, run `check.ts --confirm`. It rewrites `coverage.json` when every other check passes. Commit it with the change, so that the sync commit moves.

## How the check maps to the code

| Check                               | Code                                                                  |
| ----------------------------------- | --------------------------------------------------------------------- |
| `firstMoment`, `daysTile`, `ownDay` | `dayRange` in `apps/api/src/daily-log/day.ts`                         |
| `everyZone`                         | `dayQuerySchema` and `dayRange` in the same file                      |
| `logsOnItsDay`                      | `loggedAtOnDay` in `apps/web/src/components/food-log/selected-day.ts` |
| The daily log and the summaries     | `DailyLogService.dailyLog` and `dailySummaries`                       |

`Intl.DateTimeFormat` says what the local date of a moment is. The code uses `Temporal`, so the check does not judge the code by its own method. `Temporal` only finds the clock changes to look at, and makes the broken designs.

## Scope

- The zones of `Intl.supportedValuesOf('timeZone')`, plus legacy names for `EveryZone`.
- The two days around each clock change from 1970 to 2037, and every day of 2026. `OwnDay` looks at every 30 minutes within 25 hours of a change, and the millisecond before. `LogsOnItsDay` tries 48 times of day.
- `OwnDay` and `LogsOnItsDay` start in 2011. Until November 2010, Newfoundland, parts of Labrador and New Brunswick, and Casey Station set the clocks back over midnight, so one date came in two pieces, and no single range can hold it.
- `LogsOnItsDay` skips a date that a zone never had, such as 2011-12-30 in Samoa.
- The time zone data of this Node. A browser or a server with other data can disagree.
- Left out: `todayIn`, `useToday`, and a time zone that changes while the page is open.
