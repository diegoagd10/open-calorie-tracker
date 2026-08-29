import { getApplicationDatabase } from "../database/runtime.server";
import { FoodLogService } from "./food-log.server";

let foodLogService: FoodLogService | undefined;

function foodLogClock(): () => Date {
  const configuredInstant =
    process.env.NODE_ENV === "test" ? process.env.FOOD_LOG_TEST_NOW : undefined;
  if (!configuredInstant) return () => new Date();

  const instant = new Date(configuredInstant);
  if (Number.isNaN(instant.getTime())) {
    throw new Error("FOOD_LOG_TEST_NOW must be an ISO date-time");
  }
  return () => new Date(instant);
}

export function getFoodLogService(): FoodLogService {
  foodLogService ??= new FoodLogService(
    getApplicationDatabase().getClient(),
    foodLogClock(),
  );
  return foodLogService;
}
