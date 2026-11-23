# Verification

A task that changes the app is done only after verify-open-calorie-tracker passes on the final commit and `control-oct.ts publish` has put the proof on the PR. The skill is in `.claude/skills/verify-open-calorie-tracker/SKILL.md`.

Every formal verification must also pass on the final commit. They are the skills in `.claude/skills/formal-verify-*/`, and `.claude/formal-verification/check-all.ts` runs them all.

1. Run `.claude/formal-verification/check-all.ts` until it passes.
2. Commit every change, push, and open the PR. Put the last line that `check-all.ts` printed in its Verification section.
3. Run `up`.
4. Run the feature file for each feature you touched, and drive the changed behavior.
5. Run `publish --pr N`.
6. Run `down`.
7. Wait until every check on the PR is green, with no conflicts and no unanswered review comments.
8. Tell the user the PR is ready to merge. Do not merge it.

- A change to dependencies, the Dockerfile, or Compose files needs `up --docker` and every feature file.
- If a step or a PR check fails, find the cause, fix it, push, and go back to step 1. Never skip or weaken a check to make it pass. A failure is not a reason to stop and report.
- If a formal verification fails, read its SKILL.md to tell a bug in the code from a model that no longer describes it. Fix the one that is wrong, run `check-all.ts` again, and repeat until it passes. Never weaken a rule, a bound or a broken design to make it pass, and run `check.ts --confirm` only after you read the diff of the covered code.
- New commits that touch the app need a new run.
- If the change cannot affect the running app (docs, lint, CI), write `Verification: not applicable, <reason>` in the PR's Verification section.
- Contact the user before step 8 only when you need something only they can give, such as a credential, a product decision, or approval for an irreversible action. Say what you tried.
- Never delete `evidence/*` branches.
