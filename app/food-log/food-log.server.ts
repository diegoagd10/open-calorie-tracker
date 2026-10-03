import { and, desc, eq, lte } from "drizzle-orm";

import type { ApplicationDatabaseClient } from "../database/database.server";
import {
  readFoodEntryCalories,
  readGoalVersionsInOrder,
} from "../database/goal-history.server";
import {
  foodEntries,
  goalVersions,
  userPreferences,
} from "../database/schema.server";
import { foodEntrySnapshot } from "../food-entry/snapshot.server";
import type { DisplayUnits } from "../goals/water-conversion";
import { localDayRange, utcToZonedDateTime } from "../shared/date-time";
import {
  createWaterEventService,
  waterEventLocalDateTime,
} from "../water-event/index.server";
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

export type DailyCalories = {
  entryCount: number;
  goalMilliKcal: number | null;
  isIncomplete: boolean;
  knownMilliKcal: number;
};

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

    const instant = this.#now();
    const today = localDateAt(instant, preference.timeZone);
    const selectedDate = requestedDate
      ? parseIsoLocalDate(requestedDate)
      : today;
    if (!selectedDate) throw new InvalidFoodLogDateError();

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
    const water = createWaterEventService(this.#database, this.#now).list(
      userId,
      localDayRange(selectedDate, preference.timeZone),
    );
    const events = [
      ...entries.map((entry) => ({ ...entry, kind: "food" as const })),
      ...water.events.map((event) => ({
        ...event,
        foodLogDate: selectedDate,
        kind: "water" as const,
        localEventTime: waterEventLocalDateTime(event.logDate, preference.timeZone).slice(11),
      })),
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
      /** The account's current wall-clock date and time, `YYYY-MM-DDTHH:MM`. */
      localNow: utcToZonedDateTime(instant.toISOString(), preference.timeZone).slice(0, 16),
      waterEvents: water.events,
      waterTotalOunces: water.totalOunces,
    };
  }

  /**
   * Calorie totals for several local dates at once, each with the calorie goal
   * of the Goal Version effective on that date.
   */
  dailyCalories(userId: number, dates: readonly string[]): Record<string, DailyCalories> {
    if (!dates.length) return {};
    const ordered = [...dates].sort();
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const entries = readFoodEntryCalories(this.#database, userId, first, last);
    const goals = readGoalVersionsInOrder(this.#database, userId, last);

    return Object.fromEntries(
      ordered.map((date) => {
        const dayEntries = entries.filter((entry) => entry.foodLogDate === date);
        const goal = goals.filter((version) => version.effectiveDate <= date).pop();
        return [
          date,
          {
            entryCount: dayEntries.length,
            goalMilliKcal: goal?.calorieTargetMilliKcal ?? null,
            isIncomplete: dayEntries.some((entry) => entry.energyMilliKcal === null),
            knownMilliKcal: dayEntries.reduce(
              (total, entry) => total + (entry.energyMilliKcal ?? 0),
              0,
            ),
          },
        ];
      }),
    );
  }

  requireWritableDate(userId: number, requestedDate: string): string {
    const foodLog = this.read(userId, requestedDate);
    if (!foodLog) throw new InvalidFoodLogDateError();
    if (foodLog.isFuture) throw new FutureFoodLogDateError();
    return foodLog.selectedDate;
  }
}
