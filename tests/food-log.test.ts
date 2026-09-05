import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";

import {
  addLocalDays,
  buildCalendarMonth,
  compareFoodLogEventsDescending,
  formatLocalDate,
  getNearbyLocalDates,
  localDateAt,
  parseIsoLocalDate,
} from "../app/food-log/date";
import {
  FoodLogService,
  FutureFoodLogDateError,
  InvalidFoodLogDateError,
} from "../app/food-log/food-log.server";
import {
  localEventTimeForNewFoodLogEvent,
  nextUpdatedAt,
  type EventTimeDatabase,
} from "../app/food-log/event-time.server";
import {
  openApplicationDatabase,
  type ApplicationDatabaseClient,
} from "../app/database/database.server";
import {
  foodEntries,
  goalVersions,
  userPreferences,
  users,
} from "../app/database/schema.server";

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
      displayUnits: "us",
      timeZone: options.timeZone,
      updatedAt: createdAt,
      userId,
    })
    .run();
  client
    .insert(goalVersions)
    .values({
      calorieTargetMilliKcal: 2_050_000,
      carbohydrateTargetMilligrams: 230_000,
      createdAt,
      effectiveDate: "2025-01-01",
      fatTargetMilligrams: 70_000,
      fiberTargetMilligrams: 25_000,
      proteinTargetMilligrams: 120_000,
      sodiumMaximumMilligrams: 2_300,
      sugarMaximumMilligrams: 50_000,
      userId,
      waterTargetMicroliters: 2_365_882,
    })
    .run();

  return userId;
}

function insertFoodEntry(
  client: ApplicationDatabaseClient,
  options: {
    date: string;
    id: string;
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
    .insert(foodEntries)
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
      foodLogDate: options.date,
      idempotencyKey: options.id,
      localEventTime: "12:00:00",
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

test("event clocks cover current, retroactive, cap, and monotonic boundaries", () => {
  const currentDatabase = {
    get: () => undefined,
  } as unknown as EventTimeDatabase;
  expect(
    localEventTimeForNewFoodLogEvent(
      currentDatabase,
      1,
      "2026-08-29",
      "2026-08-29",
      new Date("2026-08-29T18:45:30.000Z"),
      "America/New_York",
    ),
  ).toBe("14:45:30");

  const retroactive = (localEventTime: string | null | undefined) =>
    localEventTimeForNewFoodLogEvent(
      {
        get: () =>
          localEventTime === undefined ? undefined : { localEventTime },
      } as unknown as EventTimeDatabase,
      1,
      "2026-08-28",
      "2026-08-29",
      new Date("2026-08-29T18:45:30.000Z"),
      "UTC",
    );
  expect(retroactive(undefined)).toBe("12:00:00");
  expect(retroactive(null)).toBe("12:00:00");
  expect(retroactive("12:34:56")).toBe("12:35:56");
  expect(retroactive("23:59:00")).toBe("23:59:00");
  expect(retroactive("23:59:30")).toBe("23:59:30");

  expect(
    nextUpdatedAt(
      new Date("2026-08-29T18:45:31.000Z"),
      "2026-08-29T18:45:30.000Z",
    ),
  ).toBe("2026-08-29T18:45:31.000Z");
  expect(
    nextUpdatedAt(
      new Date("2026-08-29T18:45:30.000Z"),
      "2026-08-29T18:45:30.000Z",
    ),
  ).toBe("2026-08-29T18:45:30.001Z");
  expect(
    nextUpdatedAt(
      new Date("2026-08-29T18:45:29.000Z"),
      "2026-08-29T18:45:30.000Z",
    ),
  ).toBe("2026-08-29T18:45:30.001Z");
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

  insertFoodEntry(client, {
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
  insertFoodEntry(client, {
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
  insertFoodEntry(client, {
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
  insertFoodEntry(client, {
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

  insertFoodEntry(client, {
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
    .select({ id: foodEntries.id })
    .from(foodEntries)
    .where(eq(foodEntries.userId, userId))
    .get()!;

  expect(service.read(userId, "2026-08-29")?.nutritionTotals).toMatchObject({
    energyMilliKcal: { isIncomplete: false, known: 501 },
    proteinMilligrams: { isIncomplete: false, known: 501 },
  });

  client
    .update(foodEntries)
    .set({ energyMilliKcal: 1_002, proteinMilligrams: 1_002 })
    .where(eq(foodEntries.id, entry.id))
    .run();
  expect(service.read(userId, "2026-08-29")?.nutritionTotals).toMatchObject({
    energyMilliKcal: { isIncomplete: false, known: 1_002 },
    proteinMilligrams: { isIncomplete: false, known: 1_002 },
  });

  client.delete(foodEntries).where(eq(foodEntries.id, entry.id)).run();
  expect(service.read(userId, "2026-08-29")?.nutritionTotals).toEqual(
    emptyTotals,
  );
  database.close();
});

test("Food Log events sort by local time, creation instant, then id descending", () => {
  const events = [
    {
      createdAt: "2026-08-29T17:00:00.000Z",
      id: 3,
      kind: "food" as const,
      localEventTime: "12:00:00",
    },
    {
      createdAt: "2026-08-29T18:00:00.000Z",
      id: 1,
      kind: "food" as const,
      localEventTime: "12:00:00",
    },
    {
      createdAt: "2026-08-29T18:00:00.000Z",
      id: 2,
      kind: "food" as const,
      localEventTime: "12:00:00",
    },
    {
      createdAt: "2026-08-29T16:00:00.000Z",
      id: 4,
      kind: "water" as const,
      localEventTime: "12:01:00",
    },
  ];

  expect(events.sort(compareFoodLogEventsDescending).map((event) => event.id)).toEqual([
    4, 2, 1, 3,
  ]);

  const crossTypeCollision = [
    {
      createdAt: "2026-08-29T18:00:00.000Z",
      id: 7,
      kind: "water" as const,
      localEventTime: "12:00:00",
    },
    {
      createdAt: "2026-08-29T18:00:00.000Z",
      id: 7,
      kind: "food" as const,
      localEventTime: "12:00:00",
    },
  ];
  expect(
    crossTypeCollision
      .sort(compareFoodLogEventsDescending)
      .map((event) => event.kind),
  ).toEqual(["food", "water"]);
});
