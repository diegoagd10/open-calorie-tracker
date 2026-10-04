import type { ApplicationDatabaseClient } from "../database/database.server";
import { getApplicationDatabase } from "../database/runtime.server";
import { DailyGoalRepository } from "./daily-goal.repository.server";
import { DailyGoalService } from "./daily-goal.server";

let dailyGoalService: DailyGoalService | undefined;

/** Stamps `created_at` and `updated_at` only; no goal rule depends on the date. */
function dailyGoalClock(): () => Date {
  const configuredInstant =
    process.env.NODE_ENV === "test" ? process.env.FOOD_LOG_TEST_NOW : undefined;
  if (!configuredInstant) return () => new Date();
  const instant = new Date(configuredInstant);
  if (Number.isNaN(instant.getTime())) {
    throw new Error("FOOD_LOG_TEST_NOW must be an ISO date-time");
  }
  return () => new Date(instant);
}

/** A Daily Goal service over `database` with its own clock, for callers that already hold a client. */
export function createDailyGoalService(database: ApplicationDatabaseClient, now: () => Date): DailyGoalService {
  return new DailyGoalService(new DailyGoalRepository(database, now));
}

export function getDailyGoalService(): DailyGoalService {
  dailyGoalService ??= createDailyGoalService(getApplicationDatabase().getClient(), dailyGoalClock());
  return dailyGoalService;
}
