import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { count, eq } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";

import {
  openApplicationDatabase,
  type ApplicationDatabaseClient,
} from "../app/database/database.server";
import {
  goalVersions,
  userPreferences,
  users,
} from "../app/database/schema.server";
import { GoalSetupService } from "../app/setup/goal-setup.server";
import {
  validateSetupFields,
  type SetupSubmission,
} from "../app/setup/validation";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
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

function insertUser(
  client: ApplicationDatabaseClient,
  username: string,
): number {
  return client
    .insert(users)
    .values({ createdAt: "2026-01-01T00:00:00.000Z", usernameNormalized: username })
    .returning({ id: users.id })
    .get().id;
}

const canonicalSetup: SetupSubmission = {
  calorieTargetMilliKcal: 2_000_000,
  carbohydrateTargetMilligrams: 200_000,
  displayUnits: "metric",
  fatTargetMilligrams: 70_000,
  fiberTargetMilligrams: 30_000,
  proteinTargetMilligrams: 100_000,
  sodiumMaximumMilligrams: 2_000,
  sugarMaximumMilligrams: 50_000,
  timeZone: "Pacific/Honolulu",
  waterTargetMicroliters: 2_500_000,
};

test("a database failure rolls back both halves of initial setup", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertUser(client, "atomic.user");
  const service = new GoalSetupService(
    client,
    () => new Date("2026-01-01T09:30:00.000Z"),
  );

  expect(() =>
    service.completeInitial(userId, {
      ...canonicalSetup,
      waterTargetMicroliters: -1,
    }),
  ).toThrow();

  expect(
    client
      .select({ value: count() })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .get()?.value,
  ).toBe(0);
  expect(
    client
      .select({ value: count() })
      .from(goalVersions)
      .where(eq(goalVersions.userId, userId))
      .get()?.value,
  ).toBe(0);
  database.close();
});

test("controlled local-date boundaries produce different initial effective dates", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const honoluluUserId = insertUser(client, "honolulu.user");
  const kiritimatiUserId = insertUser(client, "kiritimati.user");
  const service = new GoalSetupService(
    client,
    () => new Date("2026-01-01T09:30:00.000Z"),
  );

  expect(service.completeInitial(honoluluUserId, canonicalSetup)).toEqual({
    effectiveDate: "2025-12-31",
    ok: true,
  });
  expect(
    service.completeInitial(kiritimatiUserId, {
      ...canonicalSetup,
      timeZone: "Pacific/Kiritimati",
    }),
  ).toEqual({ effectiveDate: "2026-01-01", ok: true });
  database.close();
});

test("validation converts display values without SQLite floating point", () => {
  expect(
    validateSetupFields({
      calories: "1800.125",
      carbohydrate: "210.125",
      displayUnits: "us",
      fat: "60.5",
      fiber: "30.75",
      protein: "90.25",
      sodium: "1900",
      sugar: "45.5",
      timeZone: "America/New_York",
      water: "80",
    }),
  ).toMatchObject({
    data: {
      calorieTargetMilliKcal: 1_800_125,
      proteinTargetMilligrams: 90_250,
      waterTargetMicroliters: 2_365_882,
    },
    success: true,
  });
});
