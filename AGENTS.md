# Verification

A task that changes the app is done only after verify-open-calorie-tracker passes on the final commit and `control-oct.ts publish` has put the proof on the PR. The skill is in `.claude/skills/verify-open-calorie-tracker/SKILL.md`.

1. Commit every change, push, and open the PR.
2. Run `up`.
3. Run the feature file for each feature you touched, and drive the changed behavior.
4. Run `publish --pr N`.
5. Run `down`.
6. Wait until every check on the PR is green, with no conflicts and no unanswered review comments.
7. Tell the user the PR is ready to merge. Do not merge it.

- A change to dependencies, the Dockerfile, or Compose files needs `up --docker` and every feature file.
- If a step or a PR check fails, find the cause, fix it, push, and go back to step 2. Never skip or weaken a check to make it pass. A failure is not a reason to stop and report.
- New commits that touch the app need a new run.
- If the change cannot affect the running app (docs, lint, CI), write `Verification: not applicable, <reason>` in the PR's Verification section.
- Contact the user before step 7 only when you need something only they can give, such as a credential, a product decision, or approval for an irreversible action. Say what you tried.
- Never delete `evidence/*` branches.
