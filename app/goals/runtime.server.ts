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
