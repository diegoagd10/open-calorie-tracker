import { presentFoodEvent, presentNutritionTotals } from "../food-event/index.server";
import { presentWaterEvent } from "../water-event/index.server";
import { localTimeOfDay } from "./date";
import type { FoodLogDay, FoodLogRange } from "./food-log.server";

/**
 * JSON for the REST daily Food Log resources, in canonical units: milli-kilocalories,
 * milligrams, and fluid ounces.
 */

/** One local date's Food Log, the `/api/v1/daily-log` version 2 body. */
export function presentDailyFoodLog(day: FoodLogDay) {
  return {
    version: "2" as const,
    selectedDate: day.selectedDate,
    today: day.today,
    isFuture: day.isFuture,
    timeZone: day.timeZone,
    goal: day.goal ? {
      calorieTargetMilliKcal: day.goal.calorieTarget,
      waterTargetOunces: Number(day.goal.waterTarget),
      proteinTargetMilligrams: day.goal.proteinTarget,
      carbohydrateTargetMilligrams: day.goal.carbohydrateTarget,
      fatTargetMilligrams: day.goal.fatTarget,
      fiberTargetMilligrams: day.goal.fiberTarget,
      sugarMaximumMilligrams: day.goal.sugarMaximum,
      sodiumMaximumMilligrams: day.goal.sodiumMaximum,
    } : null,
    foodEvents: day.foodEvents.map(presentFoodEvent),
    waterEvents: day.waterEvents.map(presentWaterEvent),
    events: day.events.map((event) => event.kind === "food"
      ? { kind: "food" as const, ...presentFoodEvent(event) }
      : { kind: "water" as const, ...presentWaterEvent(event) }),
    nutritionTotals: presentNutritionTotals(day.nutritionTotals),
    waterTotalOunces: Number(day.waterTotalOunces),
  };
}

/**
 * Every local date of a range, the `/api/v1/daily-logs` version 1 body: each day as
 * `/api/v1/daily-log` shows it, each food with its `HH:MM` time in the account's time zone,
 * and the range's totals and averages.
 */
export function presentDailyFoodLogs(range: FoodLogRange) {
  return {
    version: "1" as const,
    startDate: range.startDate,
    endDate: range.endDate,
    today: range.today,
    timeZone: range.timeZone,
    nutritionTotals: presentNutritionTotals(range.totals),
    waterTotalOunces: Number(range.waterTotalOunces),
    averages: {
      foodDayCount: range.averages.foodDayCount,
      waterDayCount: range.averages.waterDayCount,
      nutrition: { ...range.averages.nutrition },
      waterOunces: Number(range.averages.waterOunces),
    },
    days: range.days.map((day) => {
      const { version: _version, ...presented } = presentDailyFoodLog(day);
      return {
        ...presented,
        foodEvents: presented.foodEvents.map((event) => ({
          ...event,
          localTime: localTimeOfDay(event.logDate, day.timeZone),
        })),
      };
    }),
  };
}
