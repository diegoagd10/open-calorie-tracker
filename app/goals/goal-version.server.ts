import { and, desc, eq, lte } from "drizzle-orm";

import type { ApplicationDatabaseClient } from "../database/database.server";
import {
  goalVersions,
  userPreferences,
} from "../database/schema.server";
import { localDateAt, parseIsoLocalDate } from "../food-log/date";
import type { DisplayUnits } from "../setup/validation";

export type GoalReplacement = {
  calorieTargetMilliKcal: number;
  carbohydrateTargetMilligrams: number;
  displayUnits: DisplayUnits;
  fatTargetMilligrams: number;
  fiberTargetMilligrams: number;
  proteinTargetMilligrams: number;
  sodiumMaximumMilligrams: number;
  sugarMaximumMilligrams: number;
  waterTargetMicroliters: number;
};

export class InvalidGoalVersionDateError extends Error {
  constructor() {
    super("Effective date must be today or a future local date.");
    this.name = "InvalidGoalVersionDateError";
  }
}

export class GoalVersionUnavailableError extends Error {
  constructor() {
    super("Goal Versions are unavailable for this account.");
    this.name = "GoalVersionUnavailableError";
  }
}

export class GoalVersionService {
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
    if (!selectedDate) throw new InvalidGoalVersionDateError();

    const goal = this.#database
      .select({
        calorieTargetMilliKcal: goalVersions.calorieTargetMilliKcal,
        carbohydrateTargetMilligrams: goalVersions.carbohydrateTargetMilligrams,
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
      ...preference,
      displayUnits: preference.displayUnits as DisplayUnits,
      goal,
      today,
    };
  }

  replace(
    userId: number,
    effectiveDate: string,
    replacement: GoalReplacement,
  ): "created" | "replaced" {
    const createdAt = this.#now().toISOString();

    return this.#database.transaction((transaction) => {
      const preference = transaction
        .select({ timeZone: userPreferences.timeZone })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .get();
      if (!preference) throw new GoalVersionUnavailableError();

      const parsedEffectiveDate = parseIsoLocalDate(effectiveDate);
      const today = localDateAt(this.#now(), preference.timeZone);
      if (!parsedEffectiveDate || parsedEffectiveDate < today) {
        throw new InvalidGoalVersionDateError();
      }

      const existing = transaction
        .select({ id: goalVersions.id })
        .from(goalVersions)
        .where(
          and(
            eq(goalVersions.userId, userId),
            eq(goalVersions.effectiveDate, parsedEffectiveDate),
          ),
        )
        .get();

      transaction
        .insert(goalVersions)
        .values({
          calorieTargetMilliKcal: replacement.calorieTargetMilliKcal,
          carbohydrateTargetMilligrams:
            replacement.carbohydrateTargetMilligrams,
          createdAt,
          effectiveDate: parsedEffectiveDate,
          fatTargetMilligrams: replacement.fatTargetMilligrams,
          fiberTargetMilligrams: replacement.fiberTargetMilligrams,
          proteinTargetMilligrams: replacement.proteinTargetMilligrams,
          sodiumMaximumMilligrams: replacement.sodiumMaximumMilligrams,
          sugarMaximumMilligrams: replacement.sugarMaximumMilligrams,
          userId,
          waterTargetMicroliters: replacement.waterTargetMicroliters,
        })
        .onConflictDoUpdate({
          set: {
            calorieTargetMilliKcal: replacement.calorieTargetMilliKcal,
            carbohydrateTargetMilligrams:
              replacement.carbohydrateTargetMilligrams,
            createdAt,
            fatTargetMilligrams: replacement.fatTargetMilligrams,
            fiberTargetMilligrams: replacement.fiberTargetMilligrams,
            proteinTargetMilligrams: replacement.proteinTargetMilligrams,
            sodiumMaximumMilligrams: replacement.sodiumMaximumMilligrams,
            sugarMaximumMilligrams: replacement.sugarMaximumMilligrams,
            waterTargetMicroliters: replacement.waterTargetMicroliters,
          },
          target: [goalVersions.userId, goalVersions.effectiveDate],
        })
        .run();

      transaction
        .update(userPreferences)
        .set({ displayUnits: replacement.displayUnits, updatedAt: createdAt })
        .where(eq(userPreferences.userId, userId))
        .run();

      return existing ? "replaced" : "created";
    });
  }
}
