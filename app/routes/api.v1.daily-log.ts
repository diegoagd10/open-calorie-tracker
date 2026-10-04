import type { Route } from "./+types/api.v1.daily-log";
import type { FoodLogService } from "../food-log/food-log.server";
import { parseIsoLocalDate } from "../food-log/date";
import { getFoodLogService } from "../food-log/runtime.server";
import { apiError, authenticateApiRequest, privateHeaders } from "../api-keys/rest.server";
import { presentWaterEvent } from "../water-event/index.server";

type FoodLog = NonNullable<ReturnType<FoodLogService["read"]>>;
type Food = FoodLog["entries"][number];


function presentFood(entry: Food) {
  return {
    id: entry.id,
    foodLogDate: entry.foodLogDate,
    localEventTime: entry.localEventTime,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    name: entry.name,
    originalName: entry.originalName,
    provider: entry.provider,
    providerFoodId: entry.providerFoodId,
    dataType: entry.dataType,
    providerPublishedDate: entry.providerPublishedDate,
    providerModifiedDate: entry.providerModifiedDate,
    brand: entry.brand,
    barcode: entry.barcode,
    marketCountry: entry.marketCountry,
    authoritativeBaseUnit: entry.authoritativeBaseUnit,
    authoritativeBaseQuantityMicrounits: entry.authoritativeBaseQuantityMicrounits,
    authoritativeNutrition: entry.authoritativeNutrition,
    selectedMeasurementId: entry.selectedMeasurementId,
    selectedMeasurementLabel: entry.selectedMeasurementLabel,
    selectedMeasurementUnit: entry.selectedMeasurementUnit,
    supportedMeasurements: entry.supportedMeasurements,
    quantityMicrounits: entry.quantityMicrounits,
    energyMilliKcal: entry.energyMilliKcal,
    proteinMilligrams: entry.proteinMilligrams,
    carbohydrateMilligrams: entry.carbohydrateMilligrams,
    fatMilligrams: entry.fatMilligrams,
    fiberMilligrams: entry.fiberMilligrams,
    sugarMilligrams: entry.sugarMilligrams,
    sodiumMilligrams: entry.sodiumMilligrams,
  };
}

function presentNutritionTotal(value: { known: number; isIncomplete: boolean }) {
  return { known: value.known, isIncomplete: value.isIncomplete };
}

function presentDailyFoodLog(foodLog: FoodLog) {
  const totals = foodLog.nutritionTotals;
  return {
    version: "1" as const,
    selectedDate: foodLog.selectedDate,
    today: foodLog.today,
    isFuture: foodLog.isFuture,
    timeZone: foodLog.timeZone,
    goal: foodLog.goal ? {
      calorieTargetMilliKcal: foodLog.goal.calorieTarget,
      waterTargetOunces: Number(foodLog.goal.waterTarget),
      proteinTargetMilligrams: foodLog.goal.proteinTarget,
      carbohydrateTargetMilligrams: foodLog.goal.carbohydrateTarget,
      fatTargetMilligrams: foodLog.goal.fatTarget,
      fiberTargetMilligrams: foodLog.goal.fiberTarget,
      sugarMaximumMilligrams: foodLog.goal.sugarMaximum,
      sodiumMaximumMilligrams: foodLog.goal.sodiumMaximum,
    } : null,
    foodEntries: foodLog.entries.map(presentFood),
    waterEvents: foodLog.waterEvents.map(presentWaterEvent),
    events: foodLog.events.map((event) => event.kind === "food"
      ? { kind: "food" as const, ...presentFood(event) }
      : { kind: "water" as const, ...presentWaterEvent(event) }),
    nutritionTotals: {
      energyMilliKcal: presentNutritionTotal(totals.energyMilliKcal),
      proteinMilligrams: presentNutritionTotal(totals.proteinMilligrams),
      carbohydrateMilligrams: presentNutritionTotal(totals.carbohydrateMilligrams),
      fatMilligrams: presentNutritionTotal(totals.fatMilligrams),
      fiberMilligrams: presentNutritionTotal(totals.fiberMilligrams),
      sugarMilligrams: presentNutritionTotal(totals.sugarMilligrams),
      sodiumMilligrams: presentNutritionTotal(totals.sodiumMilligrams),
    },
    waterTotalOunces: Number(foodLog.waterTotalOunces),
  };
}

export function headers() {
  return privateHeaders;
}

export function loader({ request }: Route.LoaderArgs) {
  const caller = authenticateApiRequest(request, "daily-log", "daily-log:read");
  if (caller instanceof Response) return caller;
  const dates = new URL(request.url).searchParams.getAll("date");
  if (dates.length !== 1 || !parseIsoLocalDate(dates[0])) return apiError("invalid_date", 400);
  const foodLog = getFoodLogService().read(caller.userId, dates[0]);
  if (!foodLog) return apiError("missing_setup", 409);
  return Response.json(presentDailyFoodLog(foodLog), { headers: privateHeaders });
}

export function action() {
  return apiError("method_not_allowed", 405);
}
