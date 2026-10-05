import { createDailyGoalService } from "../daily-goal/index.server";
import type { ApplicationDatabaseClient } from "../database/database.server";
import { readUserTimeZone } from "../database/user-preferences.server";
import { createFoodEventService } from "../food-event/index.server";
import { localDayRange, utcToZonedDateTime } from "../shared/date-time";
import { localDateAt, parseIsoLocalDate } from "../shared/local-date";
import { createWaterEventService } from "../water-event/index.server";
import { compareFoodLogEventsDescending } from "./date";

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

export type DailyCalories = {
  eventCount: number;
  goalMilliKcal: number | null;
  isIncomplete: boolean;
  knownMilliKcal: number;
};

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

    const goal = createDailyGoalService(this.#database, this.#now).read(userId);
    const range = localDayRange(selectedDate, timeZone);
    const food = createFoodEventService(this.#database, this.#now).list(userId, range);
    const water = createWaterEventService(this.#database, this.#now).list(userId, range);
    const events = [
      ...food.events.map((event) => ({ ...event, kind: "food" as const })),
      ...water.events.map((event) => ({ ...event, kind: "water" as const })),
    ].sort(compareFoodLogEventsDescending);

    return {
      foodEvents: food.events,
      events,
      goal,
      isFuture: selectedDate > today,
      nutritionTotals: food.totals,
      selectedDate,
      timeZone,
      today,
      /** The account's current wall-clock date and time, `YYYY-MM-DDTHH:MM`. */
      localNow: utcToZonedDateTime(instant.toISOString(), timeZone).slice(0, 16),
      waterEvents: water.events,
      waterTotalOunces: water.totalOunces,
    };
  }

  /**
   * Calorie totals for several local dates at once, each against `goal`: the Daily Goal the
   * same request's `read()` returned, so the selected day and every summarized date agree.
   * One range read covers every date; days are grouped in the account's time zone.
   */
  dailyCalories(
    userId: number,
    dates: readonly string[],
    goal: { calorieTarget: number } | null,
  ): Record<string, DailyCalories> {
    const timeZone = readUserTimeZone(this.#database, userId);
    if (!dates.length || !timeZone) return {};
    const ordered = [...dates].sort();
    const { days } = createFoodEventService(this.#database, this.#now).list(userId, {
      from: localDayRange(ordered[0], timeZone).from,
      to: localDayRange(ordered[ordered.length - 1], timeZone).to,
    });
    const goalMilliKcal = goal?.calorieTarget ?? null;
    return Object.fromEntries(ordered.map((date) => {
      const day = days[date];
      const energy = day?.totals.energyMilliKcal;
      return [date, {
        eventCount: day?.eventCount ?? 0,
        goalMilliKcal,
        isIncomplete: energy?.isIncomplete ?? false,
        knownMilliKcal: energy?.known ?? 0,
      }];
    }));
  }

  requireWritableDate(userId: number, requestedDate: string): string {
    const foodLog = this.read(userId, requestedDate);
    if (!foodLog) throw new InvalidFoodLogDateError();
    if (foodLog.isFuture) throw new FutureFoodLogDateError();
    return foodLog.selectedDate;
  }
}
