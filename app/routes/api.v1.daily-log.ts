import type { Route } from "./+types/api.v1.daily-log";
import type { FoodLogService } from "../food-log/food-log.server";
import { parseIsoLocalDate } from "../food-log/date";
import { getFoodLogService } from "../food-log/runtime.server";
import { apiError, authenticateApiKey, presentFood, privateHeaders } from "./api-v1.server";

type FoodLog = NonNullable<ReturnType<FoodLogService["read"]>>;
type Water = FoodLog["waterEvents"][number];

const acceptedScopes = ["daily-log:read"] as const;

function presentWater(event: Water) {
  return {
    id: event.id,
    foodLogDate: event.foodLogDate,
    localEventTime: event.localEventTime,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    amountMicroliters: event.amountMicroliters,
    preset8Count: event.preset8Count,
    preset16Count: event.preset16Count,
    preset24Count: event.preset24Count,
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
    displayUnits: foodLog.displayUnits,
    goal: foodLog.goal ? {
      effectiveDate: foodLog.goal.effectiveDate,
      calorieTargetMilliKcal: foodLog.goal.calorieTargetMilliKcal,
      waterTargetMicroliters: foodLog.goal.waterTargetMicroliters,
      proteinTargetMilligrams: foodLog.goal.proteinTargetMilligrams,
      carbohydrateTargetMilligrams: foodLog.goal.carbohydrateTargetMilligrams,
      fatTargetMilligrams: foodLog.goal.fatTargetMilligrams,
      fiberTargetMilligrams: foodLog.goal.fiberTargetMilligrams,
      sugarMaximumMilligrams: foodLog.goal.sugarMaximumMilligrams,
      sodiumMaximumMilligrams: foodLog.goal.sodiumMaximumMilligrams,
    } : null,
    foodEntries: foodLog.entries.map(presentFood),
    waterEvents: foodLog.waterEvents.map(presentWater),
    events: foodLog.events.map((event) => event.kind === "food"
      ? { kind: "food" as const, ...presentFood(event) }
      : { kind: "water" as const, ...presentWater(event) }),
    nutritionTotals: {
      energyMilliKcal: presentNutritionTotal(totals.energyMilliKcal),
      proteinMilligrams: presentNutritionTotal(totals.proteinMilligrams),
      carbohydrateMilligrams: presentNutritionTotal(totals.carbohydrateMilligrams),
      fatMilligrams: presentNutritionTotal(totals.fatMilligrams),
      fiberMilligrams: presentNutritionTotal(totals.fiberMilligrams),
      sugarMilligrams: presentNutritionTotal(totals.sugarMilligrams),
      sodiumMilligrams: presentNutritionTotal(totals.sodiumMilligrams),
    },
    waterTotalMicroliters: foodLog.waterTotalMicroliters,
  };
}

export function headers() {
  return privateHeaders;
}

export function loader({ request }: Route.LoaderArgs) {
  const caller = authenticateApiKey(request, "daily-log", acceptedScopes);
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
