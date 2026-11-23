---
name: formal-verify-login-lock
description: Formally verify the login lock of open-calorie-tracker (the limit on wrong passwords and the 15 minute lock in AuthService.login) with a TLA+ model, every step of which is replayed on the real code. Use before and after any change to apps/api/src/auth/auth.service.ts, auth.controller.ts, users.service.ts or the login constants in packages/shared/src/auth.ts, and for any change to login attempts, lockout, rate limits or API statuses 401, 423 and 429 of POST /v1/login.
---

# Formally verify the login lock

Logins arrive at the same time, and each one waits for an Argon2 check. Tests that log in one at a time never see a login arrive while another one waits. This check covers every order of those events within its bounds.

## What must hold

| Rule         | Promise                                                                         | Harm when it breaks                                         |
| ------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `GuessLimit` | At most 5 password checks start between two resets.                             | An attacker tries thousands of passwords in one batch.      |
| `LockHolds`  | No login gets a token while the lock is active.                                 | A correct guess gets in through the lock and removes it.    |
| `NotShutOut` | When no check runs and no lock is active, the next login gets a password check. | The owner cannot log in until the API process is restarted. |

A reset is a successful login or the end of a lock. A check that still runs at a reset counts toward the next 5. A check that throws reveals nothing and does not count.

## Run it

Run this from the repo root, after `pnpm install`:

```bash
.claude/skills/formal-verify-login-lock/check.ts
```

It takes about 5 seconds. It needs Java 11 or later, or mise, which installs Java. The first run downloads TLC 1.7.4 to `~/.cache/open-calorie-tracker` and checks its SHA-256. Exit code 0 means verified, 1 means a check failed, and 2 means that a tool did not run.

| Part                                     | What it proves                                                                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Model of the code                        | The three rules hold in every state of `LoginLock.tla` with the `Design` in `LoginLock.cfg`.                                                    |
| Replay on the real code                  | `AuthService.login` answers every step of the model with the status that the model says, and it leaves no gap within a tick for one more check. |
| Broken designs that the check must catch | Each rule can fail. `CountAfterCheck` is the code before this skill, and `LeakOnError` keeps the slot of a check that throws.                   |
| Covered code                             | The files in `coverage.json` have the same content as when someone last confirmed that the model describes them.                                |

## Does my change touch it?

It does when it changes a file in `coverage.json`, or when it adds code that reads or writes `AuthService.attempts`, or another way to check a password without a token. Another caller of `verifyPassword` is out of scope only when it needs a token, as `changePassword` does.

## Read the result

Read every result with the pstack `/statechart` skill, on `LoginLock.tla`, `LoginLock.cfg` and the view `view.ts`. Work on a copy outside the repo.

- **A rule breaks in the model, and the model's steps replay.** The output has `Replayed`. The code has the bug. The failed line lists the steps. Reproduce them over HTTP, as the parallel logins in `apps/api/test/auth.e2e-spec.ts` do, and report the bug. Do not weaken the rule.
- **A `starts no` test of the replay fails.** The code starts a check after the limit, in the same tick or a few microtasks later. The code has the bug.
- **The replay of the model fails.** The code and the model differ. The assertion diff shows the first step where they differ, such as `- RefuseFull: refused 429` against `+ RefuseFull: checking`. If the change was not meant to alter the lock, the code has the bug. If it was, update the model first.
- **Only the covered code fails.** The content changed, and the model still matches the behavior that the replay observes. Read the diff, as the next section says, and confirm it.
- **A broken design does not break its rule.** The model lost the ability to fail. Fix the model before you trust a pass.

## Update it

1. Find the last confirmed commit and read what changed since:
   ```bash
   cd .claude/skills/formal-verify-login-lock
   SYNC=$(git log -1 --format=%H -- coverage.json)
   git -C ../../.. diff "$SYNC" -- apps/api/src/auth/auth.service.ts apps/api/src/auth/auth.controller.ts apps/api/src/users/users.service.ts packages/shared/src/auth.ts
   ```
2. Update `LoginLock.tla` from the code, not from the result. Keep each stretch of code without an `await` as one action.
3. When a status changes on purpose, update `EXPECTED` in `replay.spec.ts`. When `MAX_FAILED_ATTEMPTS` changes, update it in `LoginLock.cfg` and `view.ts`, keep `MaxArrivals` above twice its value, and keep the states under the 500 that `/statechart` draws.
4. Break the new code on purpose, such as by removing `attempts.checking` from the limit in `reserveCheck`. Run the check, see it fail, and drop the break.
5. Only when you have confirmed that the model describes the new code, run `check.ts --confirm`. It rewrites `coverage.json` when every other check passes. Commit it with the change, so that the sync commit moves.

## How the model maps to the code

| Model                                           | Code in `apps/api/src/auth/auth.service.ts`                          |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| `ArriveWrong`, `ArriveRight`                    | `login` up to its first `await`, where `reserveCheck` takes a slot   |
| `RefuseLocked`, `RefuseFull`                    | The 423 and 429 of `reserveCheck`                                    |
| `WrongCounted`, `WrongLocks`                    | `login` from the end of `verifyPassword` to the 401 or 423           |
| `RightConfirmed`                                | `login` from the end of `verifyPassword` to `issueAccessToken`       |
| `CheckThrows`                                   | The `finally` of `login` when the lookup or the check throws         |
| `LockRunsOut`                                   | `lockedUntil` passes, and `currentAttempts` then starts over         |
| `failures`, `checking`, `lock`                  | `Attempts`                                                           |
| `wrong`, `right`, `guesses`, `letInWhileLocked` | Nothing in the code. They record what really happens, for the rules. |

## Scope

- One IP and username, 5 attempts, and at most 11 logins that reach a check. Those 11 cover two whole lock cycles.
- One API process. A restart clears the attempts, and two processes would each have their own.
- Left out: how the IP is found (`TRUST_PROXY`, `X-Forwarded-For`), the time a check takes, the size of `AuthService.attempts`, token lifetime, and an attacker with many IPs.
- The replay mocks `verifyPassword` and the user lookup, so it does not check Argon2 or SQL.
- The search within a tick covers 20 microtasks after a wrong password.
