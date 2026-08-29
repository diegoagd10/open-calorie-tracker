import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";

import {
  addLocalDays,
  buildCalendarMonth,
  compareFoodLogEventsDescending,
  getNearbyLocalDates,
  localDateAt,
  parseIsoLocalDate,
} from "../app/food-log/date";
import {
  FoodLogService,
  FutureFoodLogDateError,
} from "../app/food-log/food-log.server";
import {
  openApplicationDatabase,
  type ApplicationDatabaseClient,
} from "../app/database/database.server";
import {
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

test("nearby dates and calendar months use civil-date arithmetic", () => {
  expect(
    getNearbyLocalDates("2026-03-01", "2026-03-02").map((item) => item.date),
  ).toEqual([
    "2026-02-24",
    "2026-02-25",
    "2026-02-26",
    "2026-02-27",
    "2026-02-28",
    "2026-03-01",
    "2026-03-02",
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
