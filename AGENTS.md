# Verification

A task that changes the app is done only after verify-open-calorie-tracker passes on the final commit and `control-oct.ts publish` has put the proof on the PR. The skill is in `.claude/skills/verify-open-calorie-tracker/SKILL.md`.

1. Commit every change, push, and open the PR.
2. Run `up`.
3. Run the feature file for each feature you touched, and drive the changed behavior.
4. Run `publish --pr N`.
5. Run `down`.

- A change to dependencies, the Dockerfile, or Compose files needs `up --docker` and every feature file.
- If a step fails, report it and do not say the task is done.
- New commits that touch the app need a new run.
- If the change cannot affect the running app (docs, lint, CI), write `Verification: not applicable, <reason>` in the PR's Verification section.
- Never delete `evidence/*` branches.
