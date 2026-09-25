import { and, asc, desc, eq, lte } from "drizzle-orm";

import type { ApplicationDatabaseClient } from "../database/database.server";
import {
  foodEntries,
  goalVersions,
  userPreferences,
  waterEvents,
} from "../database/schema.server";
import { foodEntrySnapshot } from "../food-entry/snapshot.server";
import type { DisplayUnits } from "../goals/water-conversion";
import {
  compareFoodLogEventsDescending,
  localDateAt,
  parseIsoLocalDate,
} from "./date";

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

const nutritionFields = [
  "carbohydrateMilligrams",
  "energyMilliKcal",
  "fatMilligrams",
  "fiberMilligrams",
  "proteinMilligrams",
  "sodiumMilligrams",
  "sugarMilligrams",
] as const;

type FoodEntrySnapshot = ReturnType<typeof foodEntrySnapshot>;

function nutritionTotals(entries: FoodEntrySnapshot[]) {
  return Object.fromEntries(
    nutritionFields.map((field) => {
      let isIncomplete = false;
      let known = 0;
      for (const entry of entries) {
        const value = entry[field];
        if (value === null) {
          isIncomplete = true;
        } else {
          known += value;
        }
      }
      return [field, { isIncomplete, known }];
    }),
  ) as Record<
    (typeof nutritionFields)[number],
    { isIncomplete: boolean; known: number }
  >;
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

    const goalFields = {
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
    const goal =
      this.#database
        .select(goalFields)
        .from(goalVersions)
        .where(
          and(
            eq(goalVersions.userId, userId),
            lte(goalVersions.effectiveDate, selectedDate),
          ),
        )
        .orderBy(desc(goalVersions.effectiveDate), desc(goalVersions.id))
        .limit(1)
        .get() ??
      this.#database
        .select(goalFields)
        .from(goalVersions)
        .where(eq(goalVersions.userId, userId))
        .orderBy(asc(goalVersions.effectiveDate), asc(goalVersions.id))
        .limit(1)
        .get();

    const entries = this.#database
      .select()
      .from(foodEntries)
      .where(
        and(
          eq(foodEntries.userId, userId),
          eq(foodEntries.foodLogDate, selectedDate),
        ),
      )
      .orderBy(
        desc(foodEntries.localEventTime),
        desc(foodEntries.createdAt),
        desc(foodEntries.id),
      )
      .all()
      .map(foodEntrySnapshot);
    const water = this.#database
      .select()
      .from(waterEvents)
      .where(
        and(
          eq(waterEvents.userId, userId),
          eq(waterEvents.foodLogDate, selectedDate),
        ),
      )
      .orderBy(
        desc(waterEvents.localEventTime),
        desc(waterEvents.createdAt),
        desc(waterEvents.id),
      )
      .all();
    const events = [
      ...entries.map((entry) => ({ ...entry, kind: "food" as const })),
      ...water.map((event) => ({ ...event, kind: "water" as const })),
    ].sort(compareFoodLogEventsDescending);

    return {
      displayUnits: preference.displayUnits as DisplayUnits,
      entries,
      events,
      goal,
      isFuture: selectedDate > today,
      nutritionTotals: nutritionTotals(entries),
      selectedDate,
      timeZone: preference.timeZone,
      today,
      waterEvents: water,
      waterTotalMicroliters: water.reduce(
        (total, event) => total + event.amountMicroliters,
        0,
      ),
    };
  }

  requireWritableDate(userId: number, requestedDate: string): string {
    const foodLog = this.read(userId, requestedDate);
    if (!foodLog) throw new InvalidFoodLogDateError();
    if (foodLog.isFuture) throw new FutureFoodLogDateError();
    return foodLog.selectedDate;
  }
}
