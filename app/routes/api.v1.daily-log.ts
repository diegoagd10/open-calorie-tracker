import type { Route } from "./+types/api.v1.daily-log";
import type { FoodLogService } from "../food-log/food-log.server";
import { parseIsoLocalDate } from "../shared/local-date";
import { getFoodLogService } from "../food-log/runtime.server";
import { apiError, authenticateApiRequest, privateHeaders } from "../api-keys/rest.server";
import { presentFoodEvent, presentNutritionTotals } from "../food-event/index.server";
import { presentWaterEvent } from "../water-event/index.server";

type FoodLog = NonNullable<ReturnType<FoodLogService["read"]>>;

function presentDailyFoodLog(foodLog: FoodLog) {
  return {
    version: "2" as const,
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
    foodEvents: foodLog.foodEvents.map(presentFoodEvent),
    waterEvents: foodLog.waterEvents.map(presentWaterEvent),
    events: foodLog.events.map((event) => event.kind === "food"
      ? { kind: "food" as const, ...presentFoodEvent(event) }
      : { kind: "water" as const, ...presentWaterEvent(event) }),
    nutritionTotals: presentNutritionTotals(foodLog.nutritionTotals),
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
