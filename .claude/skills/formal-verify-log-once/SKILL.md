---
name: formal-verify-log-once
description: Formally verify that adding a food or a water on the Food Log of open-calorie-tracker logs it once, with a TLA+ model, every step of which is replayed on the real Food Log in Chromium and the real API. Use before and after any change to the Add food or Add water dialog, useSubmission, sendRequest, useCreateRequest, requestId or attempt, POST /v1/food-entries, POST /v1/water-entries, the MCP tools log_food and log_water, or the food_entries and water_entries tables.
---

# Formally verify that an entry is logged once

A request can be lost, its answer can be lost, and a request the page stopped waiting for can still arrive. The user then presses `Add` again, with the same or other values, or presses `Cancel`. This check covers every order of those events within its bounds.

## What must hold

| Rule            | Promise                                                                      | Harm when it breaks                                     |
| --------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------- |
| `OneEntry`      | One Add dialog puts at most one entry in the log.                            | The calories or the water of the day count twice.       |
| `LastPressWins` | Once the API has the request of the last press, every entry has its values.  | The log keeps values that the user corrected.           |
| `ListIsTrue`    | When the dialog closes, the page shows what the database has at that moment. | The user does not see a saved entry, and adds it again. |

## Run it

Run this from the repo root, after `pnpm install` and `pnpm --filter web exec playwright install chromium`:

```bash
.claude/skills/formal-verify-log-once/check.ts
```

It takes about 10 seconds. It needs Java 11 or later, or mise, which installs Java. The first run downloads TLC 1.7.4 to `~/.cache/open-calorie-tracker` and checks its SHA-256. Exit code 0 means verified, 1 means a check failed, and 2 means that a tool did not run.

| Part                                     | What it proves                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Model of the code                        | The rules hold in every state of `LogOnce.tla` with the `Design` in `LogOnce.cfg`, for up to 3 presses.                                    |
| Replay on the real code                  | For up to 2 presses, the real `FoodLog` in Chromium and the real API have the dialog, the rows and the list of the model after every step. |
| Broken designs that the check must catch | Each rule can fail. `InsertEveryPress` is the code before this skill.                                                                      |
| Covered code                             | The files in `coverage.json` have the content that someone last confirmed.                                                                 |

## Does my change touch it?

It does when it changes a file in `coverage.json`, when it adds a way to create a food or water entry, or when it changes how the Food Log reloads.

## Read the result

Read every result with the pstack `/statechart` skill, on `LogOnce.tla`, `LogOnce.cfg` and the view `view.ts`. Work on a copy outside the repo.

- **A rule breaks in the model, and the replay passes.** The code has the bug. The failed line lists the steps, and the tests named `retries` and `is lost` in `apps/api/test` and `apps/web/test` show how to reproduce one. Report it. Do not weaken the rule.
- **The replay fails.** The message lists the steps up to the first difference, such as `food: PressAdd, Arrive1, AnswerLost, PressAdd, Arrive2`, and the diff compares the model with the dialog, the rows or the list. If the change was not meant to alter this, the code has the bug. If it was, update the model first.
- **Only the covered code fails.** The content changed, and the replay still sees the behavior of the model. Read the diff, as the next section says, and confirm it.
- **A broken design does not break its rule.** The model lost the ability to fail. Fix the model before you trust a pass.

## Update it

1. Find the last confirmed commit and read what changed since:
   ```bash
   cd .claude/skills/formal-verify-log-once
   SYNC=$(git log -1 --format=%H -- coverage.json)
   jq -r 'keys[]' coverage.json | (cd ../../.. && xargs git diff "$SYNC" --)
   ```
2. Update `LogOnce.tla` from the code, not from the result. The INSERT is one SQL statement, so it is one action. Keep it one statement, or split the action.
3. When a label or a button of the dialog changes, update `KINDS` and `dialogState` in `replay.spec.ts`.
4. Break the new code on purpose, such as by making a new `requestId` for each attempt in `useCreateRequest`. Run the check, see it fail, and drop the break.
5. Only when you have confirmed that the model describes the new code, run `check.ts --confirm`. It rewrites `coverage.json` when every other check passes. Commit it with the change, so that the sync commit moves.

## How the model maps to the code

| Model                                      | Code                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `PressAdd`                                 | `submit` of `useSubmission`, with the next attempt of `useCreateRequest`                      |
| `Arrive1`, `Arrive2`, `Arrive3`, `Save`    | The `onConflictDoUpdate` INSERT in `create` of `FoodEntriesService` and `WaterEntriesService` |
| `AnswerArrives`                            | `onDone` of `useSubmission`, which closes the dialog and reloads the Food Log                 |
| `AnswerLost`, `RequestLost`, `RequestLate` | `sendRequest` answers `failed`                                                                |
| `Cancel`, `Reloads`                        | `close` of `AddWaterDialog` and `FoodDialog`                                                  |
| `rows`                                     | `food_entries` or `water_entries`                                                             |
| `list`                                     | The Entries list, from `useDailyLog`                                                          |
| `savedLast`, `listIsTrue`, `travelling`    | Nothing in the code. They record what really happens, for the rules.                          |

## Scope

- One Add dialog and one user. Two dialogs have two request ids, so adding the same food in a new dialog logs it twice, as it should.
- A request that arrives after the dialog closes is in the model for `OneEntry` and `LastPressWins`. `ListIsTrue` looks only at the moment of closing, so such an entry shows after the next reload.
- Left out: deleting or editing the entry while a request of its dialog still travels, reloading the page with the dialog open, a reload that fails, and the Edit and Delete dialogs.
- The replay sends the requests of the page to the API without the Next.js routes, which pass the body on unread. It stubs `next/link`.
- The MCP tools call the same `create` methods. The replay does not call them, and `apps/api/test/mcp.e2e-spec.ts` covers their `requestId`. A client that sends none gets an entry for each call.
