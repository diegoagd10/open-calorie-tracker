import type { DailyGoalTargets } from "./daily-goal.model";

/** A target the Daily Goal rules reject; `message` is safe to show to the account holder. */
export class DailyGoalValidationError extends Error {
  constructor(public readonly field: keyof DailyGoalTargets, message: string) {
    super(message);
    this.name = "DailyGoalValidationError";
  }
}
