import { getApplicationDatabase } from "../database/runtime.server";
import { GoalVersionService } from "./goal-version.server";

let goalVersionService: GoalVersionService | undefined;

function goalVersionClock(): () => Date {
  const configuredInstant =
    process.env.NODE_ENV === "test" ? process.env.FOOD_LOG_TEST_NOW : undefined;
  if (!configuredInstant) return () => new Date();

  const instant = new Date(configuredInstant);
  if (Number.isNaN(instant.getTime())) {
    throw new Error("FOOD_LOG_TEST_NOW must be an ISO date-time");
  }
  return () => new Date(instant);
}

export function getGoalVersionService(now?: Date): GoalVersionService {
  if (now) {
    return new GoalVersionService(
      getApplicationDatabase().getClient(),
      () => new Date(now),
    );
  }

  goalVersionService ??= new GoalVersionService(
    getApplicationDatabase().getClient(),
    goalVersionClock(),
  );
  return goalVersionService;
}

/** The date navigation links treat as today: the account's local date once setup saved a time zone. */
export function navigationToday(userId: number): string {
  return getGoalVersionService().localToday(userId) ?? new Date().toISOString().slice(0, 10);
}
