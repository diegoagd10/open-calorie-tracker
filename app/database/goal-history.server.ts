import { and, asc, eq, gte, lte } from "drizzle-orm";

import type { ApplicationDatabaseClient } from "./database.server";
import { foodEntries, goalVersions } from "./schema.server";

export type Reader = Pick<ApplicationDatabaseClient, "select">;

/** Target columns of a Goal Version, shared by every goal query. */
export const goalTargetColumns = {
  calorieTargetMilliKcal: goalVersions.calorieTargetMilliKcal,
  carbohydrateTargetMilligrams: goalVersions.carbohydrateTargetMilligrams,
  effectiveDate: goalVersions.effectiveDate,
  fatTargetMilligrams: goalVersions.fatTargetMilligrams,
  fiberTargetMilligrams: goalVersions.fiberTargetMilligrams,
  proteinTargetMilligrams: goalVersions.proteinTargetMilligrams,
  sodiumMaximumMilligrams: goalVersions.sodiumMaximumMilligrams,
  sugarMaximumMilligrams: goalVersions.sugarMaximumMilligrams,
  waterTargetMicroliters: goalVersions.waterTargetMicroliters,
};

/** Every saved Goal Version for a user, oldest first; later saves on a date come last. */
export function readGoalVersionsInOrder(database: Reader, userId: number, throughDate?: string) {
  return database
    .select(goalTargetColumns)
    .from(goalVersions)
    .where(
      throughDate
        ? and(eq(goalVersions.userId, userId), lte(goalVersions.effectiveDate, throughDate))
        : eq(goalVersions.userId, userId),
    )
    .orderBy(asc(goalVersions.effectiveDate), asc(goalVersions.id))
    .all();
}

/** Calories and date of each Food Entry a user logged between two local dates, inclusive. */
export function readFoodEntryCalories(database: Reader, userId: number, firstDate: string, lastDate: string) {
  return database
    .select({
      energyMilliKcal: foodEntries.energyMilliKcal,
      foodLogDate: foodEntries.foodLogDate,
    })
    .from(foodEntries)
    .where(
      and(
        eq(foodEntries.userId, userId),
        gte(foodEntries.foodLogDate, firstDate),
        lte(foodEntries.foodLogDate, lastDate),
      ),
    )
    .all();
}
