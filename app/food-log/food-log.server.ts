import { and, desc, eq, lte } from "drizzle-orm";

import type { ApplicationDatabaseClient } from "../database/database.server";
import { goalVersions, userPreferences } from "../database/schema.server";
import { localDateAt, parseIsoLocalDate } from "./date";

export class InvalidFoodLogDateError extends Error {
  constructor() {
    super("Food Log date is invalid");
    this.name = "InvalidFoodLogDateError";
  }
}

export class FutureFoodLogDateError extends Error {
  constructor() {
    super("Future Food Logs cannot be changed");
    this.name = "FutureFoodLogDateError";
  }
}

export class FoodLogService {
  readonly #database: ApplicationDatabaseClient;
  readonly #now: () => Date;

  constructor(
    database: ApplicationDatabaseClient,
    now: () => Date = () => new Date(),
  ) {
    this.#database = database;
    this.#now = now;
  }

  read(userId: number, requestedDate?: string) {
    const preference = this.#database
      .select({
        displayUnits: userPreferences.displayUnits,
        timeZone: userPreferences.timeZone,
      })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .get();
    if (!preference) return undefined;

    const today = localDateAt(this.#now(), preference.timeZone);
    const selectedDate = requestedDate
      ? parseIsoLocalDate(requestedDate)
      : today;
    if (!selectedDate) throw new InvalidFoodLogDateError();

    const goal = this.#database
      .select({
        calorieTargetMilliKcal: goalVersions.calorieTargetMilliKcal,
        carbohydrateTargetMilligrams:
          goalVersions.carbohydrateTargetMilligrams,
        effectiveDate: goalVersions.effectiveDate,
        fatTargetMilligrams: goalVersions.fatTargetMilligrams,
        fiberTargetMilligrams: goalVersions.fiberTargetMilligrams,
        proteinTargetMilligrams: goalVersions.proteinTargetMilligrams,
        sodiumMaximumMilligrams: goalVersions.sodiumMaximumMilligrams,
        sugarMaximumMilligrams: goalVersions.sugarMaximumMilligrams,
        waterTargetMicroliters: goalVersions.waterTargetMicroliters,
      })
      .from(goalVersions)
      .where(
        and(
          eq(goalVersions.userId, userId),
          lte(goalVersions.effectiveDate, selectedDate),
        ),
      )
      .orderBy(desc(goalVersions.effectiveDate), desc(goalVersions.id))
      .limit(1)
      .get();

    return {
      displayUnits: preference.displayUnits,
      goal,
      isFuture: selectedDate > today,
      selectedDate,
      timeZone: preference.timeZone,
      today,
    };
  }

  requireWritableDate(userId: number, requestedDate: string): string {
    const foodLog = this.read(userId, requestedDate);
    if (!foodLog) throw new InvalidFoodLogDateError();
    if (foodLog.isFuture) throw new FutureFoodLogDateError();
    return foodLog.selectedDate;
  }
}
