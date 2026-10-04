import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { sql } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";

import { createDailyGoalService, DailyGoalValidationError } from "../app/daily-goal/index.server";
import type { DailyGoalTargets } from "../app/daily-goal/daily-goal.model";
import { openApplicationDatabase, type ApplicationDatabaseClient } from "../app/database/database.server";
import { userPreferences, users } from "../app/database/schema.server";
import { SetupCompleteError, SetupValidationError } from "../app/setup/setup.exceptions";
import { createSetupService, navigationToday, setupClock } from "../app/setup/runtime.server";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function setupDatabase() {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-setup-"));
  temporaryDirectories.push(directory);
  return openApplicationDatabase({
    databasePath: path.join(directory, "application.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });
}

function insertUser(client: ApplicationDatabaseClient, username: string): number {
  return client
    .insert(users)
    .values({ createdAt: "2026-01-01T00:00:00.000Z", usernameNormalized: username })
    .returning({ id: users.id })
    .get().id;
}

const goal: DailyGoalTargets = {
  calorieTarget: 2_000_000,
  waterTarget: "80",
  proteinTarget: 100_000,
  carbohydrateTarget: 200_000,
  fatTarget: 70_000,
  fiberTarget: 30_000,
  sugarMaximum: 50_000,
  sodiumMaximum: 2_000,
};

const setupNow = () => new Date("2026-01-01T09:30:00.000Z");

function rowCounts(client: ApplicationDatabaseClient, userId: number) {
  return client.get<{ preferences: number; goals: number }>(sql`SELECT
    (SELECT count(*) FROM user_preferences WHERE user_id = ${userId}) AS preferences,
    (SELECT count(*) FROM daily_goals WHERE user_id = ${userId}) AS goals`);
}

test("Setup saves the canonical time zone and the first Daily Goal, completing the account", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertUser(client, "setup.user");
  const service = createSetupService(client, setupNow);

  expect(service.isComplete(userId)).toBe(false);
  service.complete(userId, { timeZone: " Pacific/Honolulu ", goal });

  expect(service.isComplete(userId)).toBe(true);
  expect(client.select().from(userPreferences).all()).toEqual([{
    userId,
    timeZone: "Pacific/Honolulu",
    createdAt: "2026-01-01T09:30:00.000Z",
    updatedAt: "2026-01-01T09:30:00.000Z",
  }]);
  expect(createDailyGoalService(client, setupNow).read(userId)).toMatchObject({ ...goal, userId });
  database.close();
});

test("an invalid time zone is rejected before anything is written", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertUser(client, "bad.zone");
  const service = createSetupService(client, setupNow);

  for (const timeZone of ["", "Mars/Olympus", "A".repeat(101)]) {
    expect(() => service.complete(userId, { timeZone, goal })).toThrow(SetupValidationError);
  }
  expect(() => service.complete(userId, { timeZone: "", goal })).toThrow(
    expect.objectContaining({ field: "timeZone", message: "Enter a valid IANA time zone, such as America/New_York." }) as Error,
  );
  expect(rowCounts(client, userId)).toEqual({ preferences: 0, goals: 0 });
  database.close();
});

test("an invalid goal rolls back the time zone", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertUser(client, "bad.goal");
  const service = createSetupService(client, setupNow);

  expect(() => service.complete(userId, { timeZone: "America/New_York", goal: { ...goal, waterTarget: "500.001" } }))
    .toThrow(DailyGoalValidationError);
  expect(rowCounts(client, userId)).toEqual({ preferences: 0, goals: 0 });
  expect(service.isComplete(userId)).toBe(false);
  database.close();
});

test("a repeat Setup is refused and writes nothing", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertUser(client, "repeat.setup");
  const service = createSetupService(client, setupNow);
  service.complete(userId, { timeZone: "America/New_York", goal });

  expect(() => service.complete(userId, { timeZone: "UTC", goal: { ...goal, calorieTarget: 1_000_000 } }))
    .toThrow(SetupCompleteError);
  expect(client.select().from(userPreferences).get()?.timeZone).toBe("America/New_York");
  expect(createDailyGoalService(client, setupNow).read(userId)?.calorieTarget).toBe(2_000_000);
  database.close();
});

test("Setup is complete only when both the time zone and the Daily Goal exist", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const preferenceOnly = insertUser(client, "preference.only");
  const goalOnly = insertUser(client, "goal.only");
  client.insert(userPreferences).values({
    userId: preferenceOnly,
    timeZone: "UTC",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }).run();
  createDailyGoalService(client, setupNow).save(goalOnly, goal);
  const service = createSetupService(client, setupNow);

  expect(service.isComplete(preferenceOnly)).toBe(false);
  expect(service.isComplete(goalOnly)).toBe(false);
  database.close();
});

function withEnvironment(values: Record<string, string | undefined>, run: () => void) {
  const original = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  try {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    run();
  } finally {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("the setup clock only honors a valid test-only instant", () => {
  withEnvironment({ NODE_ENV: "test", SETUP_TEST_NOW: "2026-01-01T09:30:00.000Z" }, () => {
    const clock = setupClock();
    expect(clock().toISOString()).toBe("2026-01-01T09:30:00.000Z");
    expect(clock()).not.toBe(clock());
  });
  withEnvironment({ NODE_ENV: "test", SETUP_TEST_NOW: undefined }, () => {
    const before = Date.now();
    expect(setupClock()().getTime()).toBeGreaterThanOrEqual(before);
  });
  withEnvironment({ NODE_ENV: "test", SETUP_TEST_NOW: "not-an-instant" }, () => {
    expect(() => setupClock()).toThrow("SETUP_TEST_NOW must be an ISO date-time");
  });
  withEnvironment({ NODE_ENV: "production", SETUP_TEST_NOW: "2026-01-01T09:30:00.000Z" }, () => {
    expect(setupClock()().getTime()).toBeGreaterThan(new Date("2026-01-02T00:00:00.000Z").getTime());
  });
});

test("navigation's today is the account's local date on the Food Log clock, or UTC before Setup", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertUser(client, "navigation.today");
  const otherId = insertUser(client, "navigation.unset");
  client.insert(userPreferences).values({
    userId,
    timeZone: "Pacific/Honolulu",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }).run();

  withEnvironment({ NODE_ENV: "test", FOOD_LOG_TEST_NOW: "2026-08-29T08:00:00.000Z", SETUP_TEST_NOW: "2026-01-01T09:30:00.000Z" }, () => {
    expect(navigationToday(userId, client)).toBe("2026-08-28");
  });
  withEnvironment({ NODE_ENV: "test", FOOD_LOG_TEST_NOW: "bad" }, () => {
    expect(() => navigationToday(userId, client)).toThrow("FOOD_LOG_TEST_NOW must be an ISO date-time");
  });
  withEnvironment({ NODE_ENV: "test", FOOD_LOG_TEST_NOW: undefined }, () => {
    expect(navigationToday(otherId, client)).toBe(new Date().toISOString().slice(0, 10));
  });
  database.close();
});
