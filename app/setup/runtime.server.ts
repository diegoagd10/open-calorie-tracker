import { getApplicationDatabase } from "../database/runtime.server";
import { GoalSetupService } from "./goal-setup.server";

let goalSetupService: GoalSetupService | undefined;

function setupClock(): () => Date {
  const configuredInstant =
    process.env.NODE_ENV === "test" ? process.env.SETUP_TEST_NOW : undefined;
  if (!configuredInstant) return () => new Date();

  const instant = new Date(configuredInstant);
  if (Number.isNaN(instant.getTime())) {
    throw new Error("SETUP_TEST_NOW must be an ISO date-time");
  }
  return () => new Date(instant);
}

export function getGoalSetupService(): GoalSetupService {
  goalSetupService ??= new GoalSetupService(
    getApplicationDatabase().getClient(),
    setupClock(),
  );
  return goalSetupService;
}
