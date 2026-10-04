import type { DailyGoalTargets } from "../../app/daily-goal/daily-goal.model";
import type { ApplicationDatabaseClient } from "../../app/database/database.server";
import { getApplicationDatabase } from "../../app/database/runtime.server";
import { createSetupService } from "../../app/setup/runtime.server";

/** The Daily Goal Setup suggests: 2,050 kcal and 80 fl oz of water. */
export const TEST_DAILY_GOAL: DailyGoalTargets = {
  calorieTarget: 2_050_000,
  waterTarget: "80",
  proteinTarget: 120_000,
  carbohydrateTarget: 230_000,
  fatTarget: 70_000,
  fiberTarget: 25_000,
  sugarMaximum: 50_000,
  sodiumMaximum: 2_300,
};

/** Finishes Setup for `userId` on `database`, or on the application database by default. */
export function completeTestSetup(
  userId: number,
  options: {
    database?: ApplicationDatabaseClient;
    goal?: Partial<DailyGoalTargets>;
    now?: Date;
    timeZone?: string;
  } = {},
) {
  const database = options.database ?? getApplicationDatabase().getClient();
  const now = options.now ?? new Date("2026-01-01T00:00:00.000Z");
  createSetupService(database, () => new Date(now)).complete(userId, {
    goal: { ...TEST_DAILY_GOAL, ...options.goal },
    timeZone: options.timeZone ?? "America/New_York",
  });
}
