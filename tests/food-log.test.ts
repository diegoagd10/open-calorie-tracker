import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";

import {
  addLocalDays,
  buildCalendarMonth,
  formatLocalDate,
  getNearbyLocalDates,
  localDateAt,
  parseIsoLocalDate,
} from "../app/shared/local-date";
import { compareFoodLogEventsDescending } from "../app/food-log/date";
import {
  FoodLogService,
  FutureFoodLogDateError,
  InvalidFoodLogDateError,
  InvalidFoodLogRangeError,
} from "../app/food-log/food-log.server";
import {
  openApplicationDatabase,
  type ApplicationDatabaseClient,
} from "../app/database/database.server";
import { userPreferences, users } from "../app/database/schema.server";
import { foodEvents } from "../app/food-event/food-event.schema.server";
import { zonedDateTimeToUtc } from "../app/shared/date-time";
import { createDailyGoalService } from "../app/daily-goal/index.server";
import type { DailyGoalTargets } from "../app/daily-goal/daily-goal.model";
import { createWaterEventService } from "../app/water-event/index.server";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function setupDatabase() {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-food-log-"));
  temporaryDirectories.push(directory);
  return openApplicationDatabase({
    databasePath: path.join(directory, "application.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });
}

const dailyGoal: DailyGoalTargets = {
  calorieTarget: 2_050_000,
  waterTarget: "80",
  proteinTarget: 120_000,
  carbohydrateTarget: 230_000,
  fatTarget: 70_000,
  fiberTarget: 25_000,
  sugarMaximum: 50_000,
  sodiumMaximum: 2_300,
};

function insertConfiguredUser(
  client: ApplicationDatabaseClient,
  options: { timeZone: string; username: string },
): number {
  const createdAt = "2026-01-01T00:00:00.000Z";
  const userId = client
    .insert(users)
    .values({ createdAt, usernameNormalized: options.username })
    .returning({ id: users.id })
    .get().id;

  client
    .insert(userPreferences)
    .values({
      createdAt,
      timeZone: options.timeZone,
      updatedAt: createdAt,
      userId,
    })
    .run();
  createDailyGoalService(client, () => new Date(createdAt)).save(userId, dailyGoal);

  return userId;
}

/** A Food Event eaten at `time` (noon by default) on local `date` in New York. */
function insertFoodEvent(
  client: ApplicationDatabaseClient,
  options: {
    date: string;
    id: string;
    time?: string;
    nutrients: {
      carbohydrateMilligrams: number | null;
      energyMilliKcal: number | null;
      fatMilligrams: number | null;
      fiberMilligrams: number | null;
      proteinMilligrams: number | null;
      sodiumMilligrams: number | null;
      sugarMilligrams: number | null;
    };
    userId: number;
  },
) {
  const createdAt = "2026-08-29T12:00:00.000Z";
  client
    .insert(foodEvents)
    .values({
      authoritativeBaseQuantityMicrounits: 100_000_000,
      authoritativeBaseUnit: "g",
      authoritativeNutrition: JSON.stringify({
        carbohydrateMilligrams: null,
        energyMilliKcal: null,
        fatMilligrams: null,
        fiberMilligrams: null,
        proteinMilligrams: null,
        sodiumMilligrams: null,
        sugarMilligrams: null,
      }),
      barcode: null,
      brand: null,
      createdAt,
      logDate: zonedDateTimeToUtc(`${options.date}T${options.time ?? "12:00"}`, "America/New_York")!,
      marketCountry: null,
      originalName: `Entry ${options.id}`,
      provider: "usda-fdc",
      providerFoodId: options.id,
      providerModifiedDate: null,
      providerPublishedDate: null,
      quantityMicrounits: 1_000_000,
      selectedMeasurementBaseQuantityMicrounits: 100_000_000,
      selectedMeasurementId: "base:g:100000000",
      selectedMeasurementLabel: "100 g",
      selectedMeasurementUnit: "g",
      sourceDataType: "Foundation",
      supportedMeasurements: "[]",
      updatedAt: createdAt,
      userId: options.userId,
      ...options.nutrients,
    })
    .run();
}

test("local dates remain stable at UTC boundaries and both DST transitions", () => {
  expect(
    localDateAt(new Date("2026-01-01T09:30:00.000Z"), "Pacific/Honolulu"),
  ).toBe("2025-12-31");
  expect(
    localDateAt(new Date("2026-01-01T09:30:00.000Z"), "Pacific/Kiritimati"),
  ).toBe("2026-01-01");

  expect(
    localDateAt(new Date("2026-03-08T04:59:59.999Z"), "America/New_York"),
  ).toBe("2026-03-07");
  expect(
    localDateAt(new Date("2026-03-08T07:00:00.000Z"), "America/New_York"),
  ).toBe("2026-03-08");

  expect(
    localDateAt(new Date("2026-11-01T05:30:00.000Z"), "America/New_York"),
  ).toBe("2026-11-01");
  expect(
    localDateAt(new Date("2026-11-01T06:30:00.000Z"), "America/New_York"),
  ).toBe("2026-11-01");
});

test("ISO local dates reject normalization and impossible calendar dates", () => {
  expect(parseIsoLocalDate("2026-02-28")).toBe("2026-02-28");
  expect(parseIsoLocalDate("2026-02-29")).toBeUndefined();
  expect(parseIsoLocalDate("2024-02-29")).toBe("2024-02-29");
  expect(parseIsoLocalDate("0099-12-31")).toBe("0099-12-31");
  expect(parseIsoLocalDate("2026-2-03")).toBeUndefined();
  expect(parseIsoLocalDate(" 2026-02-03 ")).toBeUndefined();
});

test("selecting Friday keeps Saturday and the rest of the visible week in place", () => {
  const saturday = getNearbyLocalDates("2026-09-05", "2026-09-05");
  const friday = getNearbyLocalDates("2026-09-04", "2026-09-05");
  expect(friday.map((day) => day.date)).toEqual(saturday.map((day) => day.date));
  expect(friday.find((day) => day.isToday)?.date).toBe("2026-09-05");
  expect(friday.find((day) => day.isSelected)?.date).toBe("2026-09-04");
});

test("nearby dates and calendar months use civil-date arithmetic", () => {
  expect(
    getNearbyLocalDates("2026-03-01", "2026-03-02").map((item) => item.date),
  ).toEqual([
    "2026-02-23",
    "2026-02-24",
    "2026-02-25",
    "2026-02-26",
    "2026-02-27",
    "2026-02-28",
    "2026-03-01",
  ]);

  const calendar = buildCalendarMonth("2024-02", "2024-02-29", "2024-02-28");
  expect(calendar.label).toBe("February 2024");
  expect(calendar.previousMonth).toBe("2024-01");
  expect(calendar.nextMonth).toBeUndefined();
  expect(calendar.leadingEmptyDays).toBe(4);
  expect(calendar.days).toHaveLength(29);
  expect(calendar.days.at(-1)).toEqual({
    date: "2024-02-29",
    day: 29,
    isFuture: false,
    isSelected: false,
    isToday: true,
  });

  expect(addLocalDays("0100-01-01", -1)).toBe("0099-12-31");
  const ancientCalendar = buildCalendarMonth(
    "0099-12",
    "0100-01-01",
    "0099-12-31",
  );
  expect(ancientCalendar.month).toBe("0099-12");
  expect(ancientCalendar.days.at(-1)?.date).toBe("0099-12-31");
});

test.each([
  "x2026-01-01",
  "2026-01-01x",
  "2026-00-01",
  "2026-13-01",
  "2026-01-00",
  "2026-01-32",
  "0000-02-30",
])("ISO local date %s is rejected without normalization", (value) => {
  expect(parseIsoLocalDate(value)).toBeUndefined();
});

test("local-day arithmetic validates both date and integer amount", () => {
  expect(() => addLocalDays("not-a-date", 1)).toThrow("Invalid local date");
  expect(() => addLocalDays("2026-01-01", 0.5)).toThrow("Invalid local date");
  expect(addLocalDays("2026-12-31", 1)).toBe("2027-01-01");
});

test.each(["bad", "x2026-01", "02026-01", "2026-01x", "2026-00", "2026-13", "2026-09"])(
  "calendar request %s falls back to the current month",
  (requestedMonth) => {
    const calendar = buildCalendarMonth(
      requestedMonth,
      "2026-08-31",
      "2026-08-30",
    );
    expect(calendar.month).toBe("2026-08");
    expect(calendar.nextMonth).toBeUndefined();
  },
);

test("a historical calendar exposes exact navigation and day states", () => {
  const calendar = buildCalendarMonth(
    "0099-12",
    "0100-01-01",
    "0099-12-01",
  );
  expect(calendar.previousMonth).toBe("0099-11");
  expect(calendar.nextMonth).toBe("0100-01");
  expect(calendar.days[0]).toEqual({
    date: "0099-12-01",
    day: 1,
    isFuture: false,
    isSelected: true,
    isToday: false,
  });
  expect(calendar.days.at(-1)).toEqual({
    date: "0099-12-31",
    day: 31,
    isFuture: false,
    isSelected: false,
    isToday: false,
  });
  const futureDay = buildCalendarMonth(
    "2026-08",
    "2026-08-15",
    "2026-08-14",
  ).days[15];
  expect(futureDay).toMatchObject({
    date: "2026-08-16",
    isFuture: true,
    isSelected: false,
    isToday: false,
  });
});

test("calendar month boundaries accept January and reject month 13 before today", () => {
  expect(
    buildCalendarMonth("2026-01", "2027-01-15", "2026-01-01").month,
  ).toBe("2026-01");
  expect(
    buildCalendarMonth("2026-13", "2027-01-15", "2027-01-01").month,
  ).toBe("2027-01");
});

test("local date formatting is UTC-stable and rejects invalid dates", () => {
  expect(formatLocalDate("2026-01-02", { dateStyle: "full" })).toBe(
    "Friday, January 2, 2026",
  );
  expect(() => formatLocalDate("2026-02-29", { dateStyle: "full" })).toThrow(
    "Invalid local date",
  );
});

test("Food Log errors retain their public contract", () => {
  expect(new InvalidFoodLogDateError()).toMatchObject({
    message: "Food Log date is invalid",
    name: "InvalidFoodLogDateError",
  });
  expect(new FutureFoodLogDateError()).toMatchObject({
    message: "Future Food Logs cannot be changed",
    name: "FutureFoodLogDateError",
  });
});

test("a selected historical Food Log survives travel between time zones", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, {
    timeZone: "America/New_York",
    username: "travel.user",
  });
  const service = new FoodLogService(
    client,
    () => new Date("2026-03-08T06:30:00.000Z"),
  );

  expect(service.read(userId, "2026-03-07")).toMatchObject({
    isFuture: false,
    selectedDate: "2026-03-07",
    timeZone: "America/New_York",
    today: "2026-03-08",
  });

  client
    .update(userPreferences)
    .set({ timeZone: "Pacific/Kiritimati" })
    .where(eq(userPreferences.userId, userId))
    .run();

  expect(service.read(userId, "2026-03-07")).toMatchObject({
    isFuture: false,
    selectedDate: "2026-03-07",
    timeZone: "Pacific/Kiritimati",
    today: "2026-03-08",
  });
  database.close();
});

test("future Food Log writes are rejected at the server boundary", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, {
    timeZone: "America/Los_Angeles",
    username: "future.user",
  });
  const service = new FoodLogService(
    client,
    () => new Date("2026-08-29T18:00:00.000Z"),
  );

  expect(service.requireWritableDate(userId, "2026-08-29")).toBe(
    "2026-08-29",
  );
  expect(() => service.requireWritableDate(userId, "2026-08-30")).toThrow(
    FutureFoodLogDateError,
  );
  expect(() => service.requireWritableDate(userId, "2026-02-29")).toThrow(
    "Food Log date is invalid",
  );
  database.close();
});

test("an account without preferences has no readable or writable Food Log", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = client.insert(users).values({
    createdAt: "2026-01-01T00:00:00.000Z",
    usernameNormalized: "food.log.unconfigured",
  }).returning({ id: users.id }).get().id;
  const service = new FoodLogService(client);

  expect(service.read(userId, "2026-08-29")).toBeUndefined();
  expect(() => service.requireWritableDate(userId, "2026-08-29")).toThrow(
    InvalidFoodLogDateError,
  );
  database.close();
});

test("the default Food Log clock selects the current account-local date", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, {
    timeZone: "America/New_York",
    username: "food.log.default.clock",
  });
  const expectedToday = localDateAt(new Date(), "America/New_York");
  expect(new FoodLogService(client).read(userId)).toMatchObject({
    selectedDate: expectedToday,
    today: expectedToday,
  });
  database.close();
});

test("daily nutrition totals preserve known values and mark only nutrients affected by missing data", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, {
    timeZone: "America/New_York",
    username: "nutrition.summary",
  });
  const otherUserId = insertConfiguredUser(client, {
    timeZone: "America/New_York",
    username: "nutrition.summary.other",
  });

  insertFoodEvent(client, {
    date: "2026-08-29",
    id: "summary-one",
    nutrients: {
      carbohydrateMilligrams: null,
      energyMilliKcal: 1_234,
      fatMilligrams: 0,
      fiberMilligrams: 250,
      proteinMilligrams: 1_501,
      sodiumMilligrams: 0,
      sugarMilligrams: 300,
    },
    userId,
  });
  insertFoodEvent(client, {
    date: "2026-08-29",
    id: "summary-two",
    nutrients: {
      carbohydrateMilligrams: 2_000,
      energyMilliKcal: null,
      fatMilligrams: 100,
      fiberMilligrams: null,
      proteinMilligrams: 500,
      sodiumMilligrams: 100,
      sugarMilligrams: 200,
    },
    userId,
  });
  insertFoodEvent(client, {
    date: "2026-08-28",
    id: "other-day",
    nutrients: {
      carbohydrateMilligrams: 9_000,
      energyMilliKcal: 9_000,
      fatMilligrams: 9_000,
      fiberMilligrams: 9_000,
      proteinMilligrams: 9_000,
      sodiumMilligrams: 9_000,
      sugarMilligrams: 9_000,
    },
    userId,
  });
  insertFoodEvent(client, {
    date: "2026-08-29",
    id: "other-user",
    nutrients: {
      carbohydrateMilligrams: 8_000,
      energyMilliKcal: 8_000,
      fatMilligrams: 8_000,
      fiberMilligrams: 8_000,
      proteinMilligrams: 8_000,
      sodiumMilligrams: 8_000,
      sugarMilligrams: 8_000,
    },
    userId: otherUserId,
  });

  const foodLog = new FoodLogService(
    client,
    () => new Date("2026-08-29T18:00:00.000Z"),
  ).read(userId, "2026-08-29");

  expect(foodLog?.nutritionTotals).toEqual({
    carbohydrateMilligrams: { isIncomplete: true, known: 2_000 },
    energyMilliKcal: { isIncomplete: true, known: 1_234 },
    fatMilligrams: { isIncomplete: false, known: 100 },
    fiberMilligrams: { isIncomplete: true, known: 250 },
    proteinMilligrams: { isIncomplete: false, known: 2_001 },
    sodiumMilligrams: { isIncomplete: false, known: 100 },
    sugarMilligrams: { isIncomplete: false, known: 500 },
  });
  database.close();
});

test("daily nutrition totals are recomputed after edits and deletes and empty Logs report zero known consumption", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, {
    timeZone: "America/New_York",
    username: "nutrition.freshness",
  });
  const service = new FoodLogService(
    client,
    () => new Date("2026-08-29T18:00:00.000Z"),
  );

  const emptyTotals = service.read(userId, "2026-08-29")?.nutritionTotals;
  expect(emptyTotals).toEqual({
    carbohydrateMilligrams: { isIncomplete: false, known: 0 },
    energyMilliKcal: { isIncomplete: false, known: 0 },
    fatMilligrams: { isIncomplete: false, known: 0 },
    fiberMilligrams: { isIncomplete: false, known: 0 },
    proteinMilligrams: { isIncomplete: false, known: 0 },
    sodiumMilligrams: { isIncomplete: false, known: 0 },
    sugarMilligrams: { isIncomplete: false, known: 0 },
  });

  insertFoodEvent(client, {
    date: "2026-08-29",
    id: "fresh-summary",
    nutrients: {
      carbohydrateMilligrams: 1,
      energyMilliKcal: 501,
      fatMilligrams: 1,
      fiberMilligrams: 1,
      proteinMilligrams: 501,
      sodiumMilligrams: 1,
      sugarMilligrams: 1,
    },
    userId,
  });
  const entry = client
    .select({ id: foodEvents.id })
    .from(foodEvents)
    .where(eq(foodEvents.userId, userId))
    .get()!;

  expect(service.read(userId, "2026-08-29")?.nutritionTotals).toMatchObject({
    energyMilliKcal: { isIncomplete: false, known: 501 },
    proteinMilligrams: { isIncomplete: false, known: 501 },
  });

  client
    .update(foodEvents)
    .set({ energyMilliKcal: 1_002, proteinMilligrams: 1_002 })
    .where(eq(foodEvents.id, entry.id))
    .run();
  expect(service.read(userId, "2026-08-29")?.nutritionTotals).toMatchObject({
    energyMilliKcal: { isIncomplete: false, known: 1_002 },
    proteinMilligrams: { isIncomplete: false, known: 1_002 },
  });

  client.delete(foodEvents).where(eq(foodEvents.id, entry.id)).run();
  expect(service.read(userId, "2026-08-29")?.nutritionTotals).toEqual(
    emptyTotals,
  );
  database.close();
});

test("daily calories summarize every requested date against the current Daily Goal", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, {
    timeZone: "America/New_York",
    username: "daily.calories",
  });
  const otherUserId = insertConfiguredUser(client, {
    timeZone: "America/New_York",
    username: "daily.calories.other",
  });
  createDailyGoalService(client, () => new Date("2026-08-28T00:00:00.000Z"))
    .save(userId, { ...dailyGoal, calorieTarget: 1_800_000 });
  const nutrients = (energyMilliKcal: number | null) => ({
    carbohydrateMilligrams: null,
    energyMilliKcal,
    fatMilligrams: null,
    fiberMilligrams: null,
    proteinMilligrams: null,
    sodiumMilligrams: null,
    sugarMilligrams: null,
  });
  insertFoodEvent(client, { date: "2026-08-27", id: "day-one", nutrients: nutrients(2_100_000), userId });
  insertFoodEvent(client, { date: "2026-08-28", id: "day-two-a", nutrients: nutrients(900_000), userId });
  insertFoodEvent(client, { date: "2026-08-28", id: "day-two-b", nutrients: nutrients(null), userId });
  insertFoodEvent(client, { date: "2026-08-28", id: "other-user", nutrients: nutrients(5_000_000), userId: otherUserId });
  const service = new FoodLogService(client, () => new Date("2026-08-29T16:00:00.000Z"));

  const goal = service.read(userId)!.goal;
  expect(service.dailyCalories(userId, ["2026-08-29", "2026-08-27", "2026-08-28", "2024-12-31"], goal)).toEqual({
    "2024-12-31": { eventCount: 0, goalMilliKcal: 1_800_000, isIncomplete: false, knownMilliKcal: 0 },
    "2026-08-27": { eventCount: 1, goalMilliKcal: 1_800_000, isIncomplete: false, knownMilliKcal: 2_100_000 },
    "2026-08-28": { eventCount: 2, goalMilliKcal: 1_800_000, isIncomplete: true, knownMilliKcal: 900_000 },
    "2026-08-29": { eventCount: 0, goalMilliKcal: 1_800_000, isIncomplete: false, knownMilliKcal: 0 },
  });
  expect(service.dailyCalories(otherUserId, ["2026-08-28"], service.read(otherUserId)!.goal)["2026-08-28"]).toEqual(
    { eventCount: 1, goalMilliKcal: 2_050_000, isIncomplete: false, knownMilliKcal: 5_000_000 },
  );
  expect(service.dailyCalories(userId, [], goal)).toEqual({});
  database.close();
});

test("daily calories use the Daily Goal the request already read, even after a later save", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, {
    timeZone: "America/New_York",
    username: "daily.calories.snapshot",
  });
  const service = new FoodLogService(client, () => new Date("2026-08-29T16:00:00.000Z"));
  const foodLog = service.read(userId)!;

  createDailyGoalService(client, () => new Date("2026-08-29T15:30:00.000Z"))
    .save(userId, { ...dailyGoal, calorieTarget: 1_800_000 });

  expect(foodLog.goal?.calorieTarget).toBe(2_050_000);
  expect(service.dailyCalories(userId, ["2026-08-28", "2026-08-29"], foodLog.goal)).toMatchObject({
    "2026-08-28": { goalMilliKcal: 2_050_000 },
    "2026-08-29": { goalMilliKcal: 2_050_000 },
  });
  database.close();
});

test("the selected day uses the current Daily Goal for past days, days before the goal existed, and after it changes", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, {
    timeZone: "America/New_York",
    username: "selected.goal",
  });
  const service = new FoodLogService(client, () => new Date("2026-08-29T16:00:00.000Z"));
  const expectedGoal = { ...dailyGoal, userId, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };

  for (const date of ["2026-08-29", "2026-08-01", "2025-06-01", "2026-09-15"]) {
    expect(service.read(userId, date)?.goal).toEqual(expectedGoal);
  }

  createDailyGoalService(client, () => new Date("2026-08-29T15:00:00.000Z"))
    .save(userId, { ...dailyGoal, calorieTarget: 1_500_000, waterTarget: "64.5" });
  expect(service.read(userId, "2025-06-01")?.goal).toMatchObject({ calorieTarget: 1_500_000, waterTarget: "64.5" });
  expect(service.read(userId, "2026-08-29")?.goal).toMatchObject({ calorieTarget: 1_500_000, waterTarget: "64.5" });
  database.close();
});

test("an account with a time zone but no Daily Goal reads days without a goal", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = client
    .insert(users)
    .values({ createdAt: "2026-01-01T00:00:00.000Z", usernameNormalized: "zone.only" })
    .returning({ id: users.id })
    .get().id;
  client.insert(userPreferences).values({
    createdAt: "2026-01-01T00:00:00.000Z",
    timeZone: "UTC",
    updatedAt: "2026-01-01T00:00:00.000Z",
    userId,
  }).run();
  const service = new FoodLogService(client, () => new Date("2026-08-29T16:00:00.000Z"));

  expect(service.read(userId, "2026-08-29")?.goal).toBeNull();
  expect(service.dailyCalories(userId, ["2026-08-29"], null)["2026-08-29"].goalMilliKcal).toBeNull();
  database.close();
});

test("daily calories group events by local day in the account's time zone, including 25-hour days", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, {
    timeZone: "America/New_York",
    username: "daily.calories.zone",
  });
  const nutrients = (energyMilliKcal: number) => ({
    carbohydrateMilligrams: null,
    energyMilliKcal,
    fatMilligrams: null,
    fiberMilligrams: null,
    proteinMilligrams: null,
    sodiumMilligrams: null,
    sugarMilligrams: null,
  });
  // New York falls back on 2026-11-01: 23:30 that night is 04:30 UTC on November 2.
  insertFoodEvent(client, { date: "2026-10-31", id: "before", nutrients: nutrients(100_000), time: "23:59", userId });
  insertFoodEvent(client, { date: "2026-11-01", id: "midnight", nutrients: nutrients(200_000), time: "00:00", userId });
  insertFoodEvent(client, { date: "2026-11-01", id: "late", nutrients: nutrients(300_000), time: "23:30", userId });
  insertFoodEvent(client, { date: "2026-11-02", id: "next", nutrients: nutrients(400_000), time: "00:30", userId });
  const service = new FoodLogService(client, () => new Date("2026-11-03T16:00:00.000Z"));

  expect(service.dailyCalories(userId, ["2026-11-01", "2026-10-31", "2026-11-02"], null)).toEqual({
    "2026-10-31": { eventCount: 1, goalMilliKcal: null, isIncomplete: false, knownMilliKcal: 100_000 },
    "2026-11-01": { eventCount: 2, goalMilliKcal: null, isIncomplete: false, knownMilliKcal: 500_000 },
    "2026-11-02": { eventCount: 1, goalMilliKcal: null, isIncomplete: false, knownMilliKcal: 400_000 },
  });
  expect(service.read(userId, "2026-11-01")?.foodEvents.map((event) => event.originalName)).toEqual(["Entry late", "Entry midnight"]);
  database.close();
});

test("a date range reads every local date with one day's detail, range totals, and averages over days with records", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, {
    timeZone: "America/New_York",
    username: "food.log.range",
  });
  const otherUserId = insertConfiguredUser(client, {
    timeZone: "America/New_York",
    username: "food.log.range.other",
  });
  const nutrients = (energyMilliKcal: number | null, sodiumMilligrams: number | null = 100) => ({
    carbohydrateMilligrams: null,
    energyMilliKcal,
    fatMilligrams: null,
    fiberMilligrams: null,
    proteinMilligrams: null,
    sodiumMilligrams,
    sugarMilligrams: null,
  });
  insertFoodEvent(client, { date: "2026-08-27", id: "breakfast", nutrients: nutrients(2_100_000), time: "08:15", userId });
  insertFoodEvent(client, { date: "2026-08-28", id: "lunch", nutrients: nutrients(900_000, 200), userId });
  // 23:30 in New York is 03:30 UTC on the next day.
  insertFoodEvent(client, { date: "2026-08-28", id: "late", nutrients: nutrients(null, 1), time: "23:30", userId });
  insertFoodEvent(client, { date: "2026-08-28", id: "other", nutrients: nutrients(5_000_000), userId: otherUserId });
  const now = () => new Date("2026-08-29T16:00:00.000Z");
  const water = createWaterEventService(client, now);
  water.save(userId, { logDate: "2026-08-26T16:00:00.000Z", quantity: { ounces: "16" } });
  water.save(userId, { logDate: "2026-08-27T16:00:00.000Z", quantity: { ounces: "8.125" } });
  water.save(userId, { logDate: "2026-08-29T03:30:00.000Z", quantity: { ounces: "0.5" } });
  water.save(otherUserId, { logDate: "2026-08-27T16:00:00.000Z", quantity: { ounces: "100" } });
  const service = new FoodLogService(client, now);

  const range = service.readRange(userId, "2026-08-26", "2026-08-30")!;
  expect(range).toMatchObject({
    startDate: "2026-08-26",
    endDate: "2026-08-30",
    today: "2026-08-29",
    timeZone: "America/New_York",
    waterTotalOunces: "24.625",
    averages: {
      foodDayCount: 2,
      waterDayCount: 3,
      // 24.625 fl oz over three days is 8.208333…
      waterOunces: "8.208",
    },
  });
  expect(range.days.map((day) => day.selectedDate)).toEqual([
    "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30",
  ]);
  for (const day of range.days) expect(day).toEqual(service.read(userId, day.selectedDate));
  expect(range.days.map((day) => [day.foodEvents.length, day.waterTotalOunces, day.isFuture])).toEqual([
    [0, "16", false], [1, "8.125", false], [2, "0.5", false], [0, "0", false], [0, "0", true],
  ]);
  expect(range.totals.energyMilliKcal).toEqual({ known: 3_000_000, isIncomplete: true });
  expect(range.totals.sodiumMilligrams).toEqual({ known: 301, isIncomplete: false });
  expect(range.totals.proteinMilligrams).toEqual({ known: 0, isIncomplete: true });
  expect(range.averages.nutrition).toEqual({
    energyMilliKcal: 1_500_000,
    proteinMilligrams: 0,
    carbohydrateMilligrams: 0,
    fatMilligrams: 0,
    fiberMilligrams: 0,
    sugarMilligrams: 0,
    // 301 mg over two days rounds to the nearest milligram.
    sodiumMilligrams: 151,
  });
  database.close();
});

test("an empty date range averages zero, and one date is a valid range", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, {
    timeZone: "America/New_York",
    username: "food.log.range.empty",
  });
  const service = new FoodLogService(client, () => new Date("2026-08-29T16:00:00.000Z"));

  const range = service.readRange(userId, "2026-08-29", "2026-08-29")!;
  expect(range.days).toEqual([service.read(userId, "2026-08-29")]);
  expect(range.waterTotalOunces).toBe("0");
  expect(range.averages).toEqual({
    foodDayCount: 0,
    waterDayCount: 0,
    nutrition: {
      energyMilliKcal: 0,
      proteinMilligrams: 0,
      carbohydrateMilligrams: 0,
      fatMilligrams: 0,
      fiberMilligrams: 0,
      sugarMilligrams: 0,
      sodiumMilligrams: 0,
    },
    waterOunces: "0",
  });
  database.close();
});

test("a date range covers at most 92 dates, in order, and needs account setup", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, {
    timeZone: "America/New_York",
    username: "food.log.range.limits",
  });
  const service = new FoodLogService(client, () => new Date("2026-08-29T16:00:00.000Z"));

  // January through March 2026 plus April 1 and 2 is 31 + 28 + 31 + 2 = 92 dates.
  expect(service.readRange(userId, "2026-01-01", "2026-04-02")?.days).toHaveLength(92);
  for (const [start, end] of [
    ["2026-01-01", "2026-04-03"],
    ["2026-08-29", "2026-08-28"],
    ["2026-02-30", "2026-03-01"],
    ["2026-03-01", "not-a-date"],
  ]) {
    expect(() => service.readRange(userId, start, end)).toThrow(InvalidFoodLogRangeError);
  }
  expect(new InvalidFoodLogRangeError()).toMatchObject({ name: "InvalidFoodLogRangeError" });

  const unconfigured = client.insert(users).values({
    createdAt: "2026-01-01T00:00:00.000Z",
    usernameNormalized: "food.log.range.unconfigured",
  }).returning({ id: users.id }).get().id;
  expect(service.readRange(unconfigured, "2026-08-01", "2026-08-29")).toBeUndefined();
  database.close();
});

test("Food Log events sort by consumption time, save time, kind, then id descending", () => {
  const events = [
    {
      createdAt: "2026-08-29T17:00:00.000Z",
      id: 3,
      kind: "food" as const,
      logDate: "2026-08-29T16:00:00.000Z",
    },
    {
      createdAt: "2026-08-29T18:00:00.000Z",
      id: 1,
      kind: "food" as const,
      logDate: "2026-08-29T16:00:00.000Z",
    },
    {
      createdAt: "2026-08-29T18:00:00.000Z",
      id: 2,
      kind: "food" as const,
      logDate: "2026-08-29T16:00:00.000Z",
    },
    {
      createdAt: "2026-08-29T16:00:00.000Z",
      id: 4,
      kind: "water" as const,
      logDate: "2026-08-29T16:01:00.000Z",
    },
  ];

  expect(events.sort(compareFoodLogEventsDescending).map((event) => event.id)).toEqual([
    4, 2, 1, 3,
  ]);

  // Food and water IDs come from different tables, so kind decides before ID.
  const crossType = [
    {
      createdAt: "2026-08-29T18:00:00.000Z",
      id: 9,
      kind: "water" as const,
      logDate: "2026-08-29T16:00:00.000Z",
    },
    {
      createdAt: "2026-08-29T18:00:00.000Z",
      id: 7,
      kind: "food" as const,
      logDate: "2026-08-29T16:00:00.000Z",
    },
    {
      createdAt: "2026-08-29T18:00:00.000Z",
      id: 7,
      kind: "water" as const,
      logDate: "2026-08-29T16:00:00.000Z",
    },
  ];
  expect(
    crossType
      .sort(compareFoodLogEventsDescending)
      .map((event) => `${event.kind}-${event.id}`),
  ).toEqual(["food-7", "water-9", "water-7"]);
});
