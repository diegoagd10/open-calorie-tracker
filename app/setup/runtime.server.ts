import { createDailyGoalService } from "../daily-goal/index.server";
import type { ApplicationDatabaseClient } from "../database/database.server";
import { getApplicationDatabase } from "../database/runtime.server";
import { readUserTimeZone } from "../database/user-preferences.server";
import { localDateAt } from "../food-log/date";
import { SetupService } from "./setup.server";

let setupService: SetupService | undefined;

function testClock(variable: "FOOD_LOG_TEST_NOW" | "SETUP_TEST_NOW"): () => Date {
  const configuredInstant =
    process.env.NODE_ENV === "test" ? process.env[variable] : undefined;
  if (!configuredInstant) return () => new Date();

  const instant = new Date(configuredInstant);
  if (Number.isNaN(instant.getTime())) {
    throw new Error(`${variable} must be an ISO date-time`);
  }
  return () => new Date(instant);
}

export function setupClock(): () => Date {
  return testClock("SETUP_TEST_NOW");
}

/** A Setup service over `database` with its own clock, for callers that already hold a client. */
export function createSetupService(database: ApplicationDatabaseClient, now: () => Date): SetupService {
  return new SetupService(database, createDailyGoalService(database, now), now);
}

export function getSetupService(): SetupService {
  setupService ??= createSetupService(getApplicationDatabase().getClient(), setupClock());
  return setupService;
}

/**
 * The date navigation links treat as today: the account's local date on the Food Log clock once
 * Setup saved a time zone, or the UTC date before.
 */
export function navigationToday(
  userId: number,
  database: ApplicationDatabaseClient = getApplicationDatabase().getClient(),
): string {
  const timeZone = readUserTimeZone(database, userId);
  return timeZone
    ? localDateAt(testClock("FOOD_LOG_TEST_NOW")(), timeZone)
    : new Date().toISOString().slice(0, 10);
}
