import { getBarcodeService } from "../barcode/index.server";
import { getFoodCatalog } from "../catalog/runtime.server";
import { getApplicationDatabase } from "../database/runtime.server";
import { FoodEntryService } from "./food-entry.server";

let foodEntryService: FoodEntryService | undefined;

function foodEntryClock(): () => Date {
  const configuredInstant =
    process.env.NODE_ENV === "test" ? process.env.FOOD_LOG_TEST_NOW : undefined;
  if (!configuredInstant) return () => new Date();
  const instant = new Date(configuredInstant);
  if (Number.isNaN(instant.getTime())) {
    throw new Error("FOOD_LOG_TEST_NOW must be an ISO date-time");
  }
  return () => new Date(instant);
}

export function getFoodEntryService(now?: Date): FoodEntryService {
  if (now) {
    return new FoodEntryService(
      getApplicationDatabase().getClient(),
      getFoodCatalog(),
      () => new Date(now),
      getBarcodeService(),
    );
  }
  foodEntryService ??= new FoodEntryService(
    getApplicationDatabase().getClient(),
    getFoodCatalog(),
    foodEntryClock(),
    getBarcodeService(),
  );
  return foodEntryService;
}
