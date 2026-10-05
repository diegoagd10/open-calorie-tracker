import type { FoodCatalog } from "../catalog/food-catalog.server";
import { getFoodCatalog } from "../catalog/runtime.server";
import type { ApplicationDatabaseClient } from "../database/database.server";
import { getApplicationDatabase } from "../database/runtime.server";
import { testRequestInstant } from "../runtime.server";
import { FoodEventRepository } from "./food-event.repository.server";
import { FoodEventService } from "./food-event.server";

let foodEventService: FoodEventService | undefined;

function foodEventClock(): () => Date {
  const configuredInstant =
    process.env.NODE_ENV === "test" ? process.env.FOOD_LOG_TEST_NOW : undefined;
  if (!configuredInstant) return () => new Date();
  const instant = new Date(configuredInstant);
  if (Number.isNaN(instant.getTime())) {
    throw new Error("FOOD_LOG_TEST_NOW must be an ISO date-time");
  }
  return () => new Date(instant);
}

/** The production catalog, read when a save needs it, so a replaced test catalog is honored. */
const runtimeCatalog: Pick<FoodCatalog, "getFood"> = {
  getFood: (provider, providerFoodId, context) => getFoodCatalog().getFood(provider, providerFoodId, context),
};

/** A Food Event service over `database` with its own clock, for callers that already hold a client. */
export function createFoodEventService(
  database: ApplicationDatabaseClient,
  now: () => Date,
  catalog: Pick<FoodCatalog, "getFood"> = runtimeCatalog,
): FoodEventService {
  return new FoodEventService(new FoodEventRepository(database, now), catalog, now);
}

/** The instant a web request treats as now: a browser test's pinned instant, or the service clock's. */
export function requestInstant(request: Request): Date {
  return testRequestInstant(request) ?? foodEventClock()();
}

export function getFoodEventService(now?: Date): FoodEventService {
  if (now) {
    return createFoodEventService(getApplicationDatabase().getClient(), () => new Date(now));
  }
  foodEventService ??= createFoodEventService(getApplicationDatabase().getClient(), foodEventClock());
  return foodEventService;
}
