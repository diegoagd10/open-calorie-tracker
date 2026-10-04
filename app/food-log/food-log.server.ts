import { and, desc, eq, gte, lte } from "drizzle-orm";

import { createDailyGoalService } from "../daily-goal/index.server";
import type { ApplicationDatabaseClient } from "../database/database.server";
import { foodEntries } from "../database/schema.server";
import { readUserTimeZone } from "../database/user-preferences.server";
import { foodEntrySnapshot } from "../food-entry/snapshot.server";
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

  #dailyGoals() {
    return createDailyGoalService(this.#database, this.#now);
  }

  /** The selected local day's Food Log, measured against the account's current Daily Goal. */
  read(userId: number, requestedDate?: string) {
    const timeZone = readUserTimeZone(this.#database, userId);
    if (!timeZone) return undefined;

    const instant = this.#now();
    const today = localDateAt(instant, timeZone);
    const selectedDate = requestedDate
      ? parseIsoLocalDate(requestedDate)
      : today;
    if (!selectedDate) throw new InvalidFoodLogDateError();

    const goal = this.#dailyGoals().read(userId);

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
      localDayRange(selectedDate, timeZone),
    );
    const events = [
      ...entries.map((entry) => ({ ...entry, kind: "food" as const })),
      ...water.events.map((event) => ({
        ...event,
        foodLogDate: selectedDate,
        kind: "water" as const,
        localEventTime: waterEventLocalDateTime(event.logDate, timeZone).slice(11),
      })),
    ].sort(compareFoodLogEventsDescending);

    return {
      entries,
      events,
      goal,
      isFuture: selectedDate > today,
      nutritionTotals: nutritionTotals(entries),
      selectedDate,
      timeZone,
      today,
      /** The account's current wall-clock date and time, `YYYY-MM-DDTHH:MM`. */
      localNow: utcToZonedDateTime(instant.toISOString(), timeZone).slice(0, 16),
      waterEvents: water.events,
      waterTotalOunces: water.totalOunces,
    };
  }

  /** Calorie totals for several local dates at once, each against the account's current Daily Goal. */
  dailyCalories(userId: number, dates: readonly string[]): Record<string, DailyCalories> {
    if (!dates.length) return {};
    const ordered = [...dates].sort();
    const entries = this.#database
      .select({ energyMilliKcal: foodEntries.energyMilliKcal, foodLogDate: foodEntries.foodLogDate })
      .from(foodEntries)
      .where(and(
        eq(foodEntries.userId, userId),
        gte(foodEntries.foodLogDate, ordered[0]),
        lte(foodEntries.foodLogDate, ordered[ordered.length - 1]),
      ))
      .all();
    const goalMilliKcal = this.#dailyGoals().read(userId)?.calorieTarget ?? null;

    return Object.fromEntries(
      ordered.map((date) => {
        const dayEntries = entries.filter((entry) => entry.foodLogDate === date);
        return [
          date,
          {
            entryCount: dayEntries.length,
            goalMilliKcal,
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
