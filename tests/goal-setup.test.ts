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
import { setupClock } from "../app/setup/runtime.server";
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

test("initial setup refuses either half of a pre-existing setup", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const preferenceUserId = insertUser(client, "preference.exists");
  const goalUserId = insertUser(client, "goal.exists");
  const createdAt = "2026-01-01T00:00:00.000Z";
  client.insert(userPreferences).values({
    createdAt,
    displayUnits: "metric",
    timeZone: "UTC",
    updatedAt: createdAt,
    userId: preferenceUserId,
  }).run();
  client.insert(goalVersions).values({
    ...canonicalSetup,
    createdAt,
    effectiveDate: "2026-01-01",
    userId: goalUserId,
  }).run();
  const service = new GoalSetupService(
    client,
    () => new Date("2026-01-01T12:00:00.000Z"),
  );

  expect(service.completeInitial(preferenceUserId, canonicalSetup)).toEqual({
    error: "already-complete",
    ok: false,
  });
  expect(service.completeInitial(goalUserId, canonicalSetup)).toEqual({
    error: "already-complete",
    ok: false,
  });
  database.close();
});

test.each([
  "SQLITE_CONSTRAINT_PRIMARYKEY",
  "SQLITE_CONSTRAINT_UNIQUE",
])("a %s race is reported as already complete", (code) => {
  const database = {
    transaction() {
      throw Object.assign(new Error("setup race"), { code });
    },
  } as unknown as ApplicationDatabaseClient;
  const service = new GoalSetupService(
    database,
    () => new Date("2026-01-01T12:00:00.000Z"),
  );

  expect(service.completeInitial(1, canonicalSetup)).toEqual({
    error: "already-complete",
    ok: false,
  });
});

test.each([
  new Error("ordinary failure"),
  Object.assign(new Error("different constraint"), {
    code: "SQLITE_CONSTRAINT_CHECK",
  }),
  { code: "SQLITE_CONSTRAINT_UNIQUE" },
])("non-race setup failures are rethrown", (error) => {
  const database = {
    transaction() {
      throw error;
    },
  } as unknown as ApplicationDatabaseClient;
  const service = new GoalSetupService(database);

  expect(() => service.completeInitial(1, canonicalSetup)).toThrow(error);
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

const validSetupFields = {
  calories: "2000",
  carbohydrate: "200",
  displayUnits: "metric",
  fat: "70",
  fiber: "30",
  protein: "100",
  sodium: "2000",
  sugar: "50",
  timeZone: "America/New_York",
  water: "2500",
};

test.each([
  ["decimal prefix", { calories: "1.000junk" }, "calories"],
  ["decimal suffix", { calories: "junk1.000" }, "calories"],
  ["integer prefix", { sodium: "1junk" }, "sodium"],
  ["integer suffix", { sodium: "junk1" }, "sodium"],
  ["zero calories", { calories: "0" }, "calories"],
  ["zero water", { water: "0" }, "water"],
] as const)("validation rejects a %s", (_label, change, field) => {
  expect(validateSetupFields({ ...validSetupFields, ...change })).toMatchObject({
    field,
    success: false,
  });
});

test("validation trims numeric values and returns every canonical field", () => {
  expect(
    validateSetupFields({
      ...validSetupFields,
      calories: " 2000 ",
      sodium: " 2000 ",
      timeZone: " Pacific/Honolulu ",
    }),
  ).toEqual({
    data: {
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
    },
    success: true,
  });
});

test("validation enforces time-zone boundaries and exact errors", () => {
  expect(
    validateSetupFields({ ...validSetupFields, displayUnits: "imperial" }),
  ).toEqual({
    error: "Choose US or metric display units.",
    field: "displayUnits",
    success: false,
  });
  expect(
    validateSetupFields({ ...validSetupFields, timeZone: "" }),
  ).toMatchObject({ field: "timeZone", success: false });
  expect(
    validateSetupFields({ ...validSetupFields, timeZone: "A".repeat(101) }),
  ).toEqual({
    error: "Enter a valid IANA time zone, such as America/New_York.",
    field: "timeZone",
    success: false,
  });
  expect(
    validateSetupFields({ ...validSetupFields, timeZone: "A".repeat(100) }),
  ).toMatchObject({ field: "timeZone", success: false });
});

test("validation exposes exact calorie, nutrient, and sodium errors", () => {
  expect(
    validateSetupFields({ ...validSetupFields, calories: "20000.001" }),
  ).toEqual({
    error: "Calories must be from 0.001 to 20,000 kcal.",
    field: "calories",
    success: false,
  });
  expect(
    validateSetupFields({ ...validSetupFields, protein: "2000.001" }),
  ).toEqual({
    error: "Protein must be from 0.001 to 2,000 g.",
    field: "protein",
    success: false,
  });
  expect(
    validateSetupFields({ ...validSetupFields, sodium: "100001" }),
  ).toEqual({
    error: "Sodium maximum must be from 1 to 100,000 mg.",
    field: "sodium",
    success: false,
  });
});

test("the setup clock only honors a valid test-only instant", () => {
  const originalNodeEnvironment = process.env.NODE_ENV;
  const originalSetupNow = process.env.SETUP_TEST_NOW;
  try {
    process.env.NODE_ENV = "test";
    process.env.SETUP_TEST_NOW = "2026-01-01T09:30:00.000Z";
    const clock = setupClock();
    expect(clock().toISOString()).toBe("2026-01-01T09:30:00.000Z");
    expect(clock()).not.toBe(clock());

    delete process.env.SETUP_TEST_NOW;
    const before = Date.now();
    expect(setupClock()().getTime()).toBeGreaterThanOrEqual(before);

    process.env.SETUP_TEST_NOW = "not-an-instant";
    expect(() => setupClock()).toThrow(
      "SETUP_TEST_NOW must be an ISO date-time",
    );

    process.env.NODE_ENV = "production";
    process.env.SETUP_TEST_NOW = "2026-01-01T09:30:00.000Z";
    expect(setupClock()().getTime()).toBeGreaterThan(
      new Date("2026-01-02T00:00:00.000Z").getTime(),
    );
  } finally {
    if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnvironment;
    if (originalSetupNow === undefined) delete process.env.SETUP_TEST_NOW;
    else process.env.SETUP_TEST_NOW = originalSetupNow;
  }
});
