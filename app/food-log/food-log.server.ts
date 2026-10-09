import { createDailyGoalService } from "../daily-goal/index.server";
import type { ApplicationDatabaseClient } from "../database/database.server";
import { readUserTimeZone } from "../database/user-preferences.server";
import type { DailyGoal } from "../daily-goal/daily-goal.model";
import type { FoodEvent, Nutrient, NutritionTotals } from "../food-event/food-event.model";
import { createFoodEventService } from "../food-event/index.server";
import { nutritionTotals } from "../food-event/nutrition";
import { localDayRange, utcToZonedDateTime } from "../shared/date-time";
import { addLocalDays, localDateAt, parseIsoLocalDate } from "../shared/local-date";
import { createWaterEventService, type WaterEvent } from "../water-event/index.server";
import { formatOunceThousandths, ounceThousandths } from "../water-event/water-event.utils";
import { compareFoodLogEventsDescending } from "./date";

/** The most local dates one range read covers: a quarter. */
export const MAXIMUM_RANGE_DAYS = 92;

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

export class InvalidFoodLogRangeError extends Error {
  constructor() {
    super(`Food Log range must be valid dates, start on or before end, and cover at most ${MAXIMUM_RANGE_DAYS} days`);
    this.name = "InvalidFoodLogRangeError";
  }
}

export type FoodLogDay = NonNullable<ReturnType<FoodLogService["read"]>>;

/**
 * `startDate` and `endDate` when both are `YYYY-MM-DD` dates, in order, covering at most
 * `MAXIMUM_RANGE_DAYS` dates counting both; otherwise undefined.
 */
export function parseFoodLogRange(startDate: string, endDate: string): { startDate: string; endDate: string } | undefined {
  const start = parseIsoLocalDate(startDate);
  const end = parseIsoLocalDate(endDate);
  if (!start || !end || start > end || addLocalDays(start, MAXIMUM_RANGE_DAYS - 1) < end) return undefined;
  return { startDate: start, endDate: end };
}

/** Every local date from `startDate` through `endDate`, with totals and per-day averages. */
export type FoodLogRange = {
  startDate: string;
  endDate: string;
  today: string;
  timeZone: string;
  /** Each date in the range, ascending, including empty and future dates. */
  days: FoodLogDay[];
  totals: NutritionTotals;
  waterTotalOunces: string;
  averages: {
    /** Dates with at least one Food Event; nutrition averages divide by this. */
    foodDayCount: number;
    /** Dates with at least one Water Event; the water average divides by this. */
    waterDayCount: number;
    /** Known canonical amounts per food day, rounded to whole milli-kcal or milligrams. */
    nutrition: Record<Nutrient, number>;
    /** Fluid ounces per water day, rounded to the nearest thousandth. */
    waterOunces: string;
  };
};

/** What every day of one request shares: the account's clock, time zone, and Daily Goal. */
type DayContext = { goal: DailyGoal | null; instant: Date; timeZone: string; today: string };

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
    return this.#day({ goal, instant, timeZone, today }, selectedDate, food, water);
  }

  /**
   * Each local date from `startDate` through `endDate` (inclusive, at most 92), shaped like
   * `read()` and measured against the current Daily Goal, plus range totals and averages.
   * One range read covers food and one covers water; days are grouped in the account's time zone.
   */
  readRange(userId: number, startDate: string, endDate: string): FoodLogRange | undefined {
    const requested = parseFoodLogRange(startDate, endDate);
    if (!requested) throw new InvalidFoodLogRangeError();
    const { startDate: start, endDate: end } = requested;
    const timeZone = readUserTimeZone(this.#database, userId);
    if (!timeZone) return undefined;

    const instant = this.#now();
    const context = {
      goal: createDailyGoalService(this.#database, this.#now).read(userId),
      instant,
      timeZone,
      today: localDateAt(instant, timeZone),
    };
    const range = { from: localDayRange(start, timeZone).from, to: localDayRange(end, timeZone).to };
    const food = createFoodEventService(this.#database, this.#now).list(userId, range);
    const water = createWaterEventService(this.#database, this.#now).list(userId, range);
    const foodByDay = groupByLocalDate(food.events, timeZone);
    const waterByDay = groupByLocalDate(water.events, timeZone);

    const days: FoodLogDay[] = [];
    for (let date = start; date <= end; date = addLocalDays(date, 1)) {
      days.push(this.#day(context, date, {
        events: foodByDay.get(date) ?? [],
        totals: food.days[date]?.totals ?? nutritionTotals([]),
      }, {
        events: waterByDay.get(date) ?? [],
        totalOunces: water.days[date]?.totalOunces ?? "0",
      }));
    }

    const foodDayCount = Object.keys(food.days).length;
    const waterDayCount = Object.keys(water.days).length;
    const waterThousandths = ounceThousandths(water.totalOunces)!;
    return {
      startDate: start,
      endDate: end,
      today: context.today,
      timeZone,
      days,
      totals: food.totals,
      waterTotalOunces: water.totalOunces,
      averages: {
        foodDayCount,
        waterDayCount,
        nutrition: Object.fromEntries(Object.entries(food.totals).map(([nutrient, { known }]) => [
          nutrient,
          foodDayCount ? Math.round(known / foodDayCount) : 0,
        ])) as Record<Nutrient, number>,
        waterOunces: waterDayCount
          ? formatOunceThousandths((2n * waterThousandths + BigInt(waterDayCount)) / (2n * BigInt(waterDayCount)))
          : "0",
      },
    };
  }

  /** One local date's Food Log from the food and water already read for it. */
  #day(
    { goal, instant, timeZone, today }: DayContext,
    selectedDate: string,
    food: { events: FoodEvent[]; totals: NutritionTotals },
    water: { events: WaterEvent[]; totalOunces: string },
  ) {
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

/** Events by the local date of their `logDate` in `timeZone`, keeping their order. */
function groupByLocalDate<T extends { logDate: string }>(events: readonly T[], timeZone: string): Map<string, T[]> {
  const byDay = new Map<string, T[]>();
  for (const event of events) {
    const day = utcToZonedDateTime(event.logDate, timeZone).slice(0, 10);
    const dayEvents = byDay.get(day);
    if (dayEvents) dayEvents.push(event);
    else byDay.set(day, [event]);
  }
  return byDay;
}
