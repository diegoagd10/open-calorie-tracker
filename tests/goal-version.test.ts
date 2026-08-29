import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { sql } from "drizzle-orm";
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
import { GoalVersionService } from "../app/goals/goal-version.server";
import {
  goalFieldsFromCanonical,
  validateGoalVersionFields,
} from "../app/goals/validation";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function setupDatabase() {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-goals-"));
  temporaryDirectories.push(directory);
  return openApplicationDatabase({
    databasePath: path.join(directory, "application.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });
}

function insertConfiguredUser(
  client: ApplicationDatabaseClient,
  username: string,
): number {
  const createdAt = "2026-01-01T00:00:00.000Z";
  const userId = client
    .insert(users)
    .values({ createdAt, usernameNormalized: username })
    .returning({ id: users.id })
    .get().id;

  client
    .insert(userPreferences)
    .values({
      createdAt,
      displayUnits: "us",
      timeZone: "America/New_York",
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
      effectiveDate: "2026-01-01",
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

const replacement = {
  calorieTargetMilliKcal: 1_900_000,
  carbohydrateTargetMilligrams: 210_000,
  displayUnits: "metric" as const,
  fatTargetMilligrams: 65_000,
  fiberTargetMilligrams: 30_000,
  proteinTargetMilligrams: 110_000,
  sodiumMaximumMilligrams: 2_000,
  sugarMaximumMilligrams: 45_000,
  waterTargetMicroliters: 2_400_000,
};

test("same-date replacement exposes one complete latest Goal Version", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "same.date");
  const service = new GoalVersionService(
    client,
    () => new Date("2026-08-29T16:00:00.000Z"),
  );

  expect(service.replace(userId, "2026-08-30", replacement)).toBe("created");
  expect(
    service.replace(userId, "2026-08-30", {
      ...replacement,
      calorieTargetMilliKcal: 1_850_000,
      sodiumMaximumMilligrams: 1_900,
    }),
  ).toBe("replaced");

  expect(service.read(userId, "2026-08-30")).toMatchObject({
    displayUnits: "metric",
    goal: {
      calorieTargetMilliKcal: 1_850_000,
      effectiveDate: "2026-08-30",
      sodiumMaximumMilligrams: 1_900,
    },
  });
  database.close();
});

test("US and metric presentation round-trips canonical fixed-point goals", () => {
  const goal = {
    calorieTargetMilliKcal: 1_800_125,
    carbohydrateTargetMilligrams: 210_125,
    effectiveDate: "2026-08-29",
    fatTargetMilligrams: 60_500,
    fiberTargetMilligrams: 30_750,
    proteinTargetMilligrams: 90_250,
    sodiumMaximumMilligrams: 1_900,
    sugarMaximumMilligrams: 45_500,
    waterTargetMicroliters: 2_365_882,
  };

  const usFields = goalFieldsFromCanonical(goal, "us");
  expect(usFields).toMatchObject({
    calories: "1800.125",
    protein: "90.25",
    sodium: "1900",
    water: "80",
  });
  expect(
    validateGoalVersionFields(
      { ...usFields, displayUnits: "us", effectiveDate: "2026-08-30" },
      "America/New_York",
    ),
  ).toMatchObject({
    data: {
      calorieTargetMilliKcal: 1_800_125,
      proteinTargetMilligrams: 90_250,
      waterTargetMicroliters: 2_365_882,
    },
    success: true,
  });

  expect(goalFieldsFromCanonical(goal, "metric")).toMatchObject({
    calories: "1800.125",
    protein: "90.25",
    sodium: "1900",
    water: "2365.882",
  });
});

test.each([
  ["incomplete", { carbohydrate: "" }, "carbohydrate"],
  ["negative", { sugar: "-1" }, "sugar"],
  ["unbounded", { sodium: "100001" }, "sodium"],
  ["invalid date", { effectiveDate: "2026-02-29" }, "effectiveDate"],
  ["manipulated units", { displayUnits: "imperial" }, "displayUnits"],
] as const)("%s Goal Version submissions are rejected", (_case, change, field) => {
  const validFields = {
    calories: "1900",
    carbohydrate: "210",
    displayUnits: "metric",
    effectiveDate: "2026-08-30",
    fat: "65",
    fiber: "30",
    protein: "110",
    sodium: "2000",
    sugar: "45",
    water: "2400",
  };

  expect(
    validateGoalVersionFields(
      { ...validFields, ...change },
      "America/New_York",
    ),
  ).toMatchObject({ field, success: false });
});

test("multiple Goal Versions resolve without changing earlier Food Log goals", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "historical.goals");
  const service = new GoalVersionService(
    client,
    () => new Date("2026-08-29T16:00:00.000Z"),
  );

  service.replace(userId, "2026-08-29", replacement);
  service.replace(userId, "2026-09-15", {
    ...replacement,
    calorieTargetMilliKcal: 2_200_000,
  });

  expect(service.read(userId, "2026-08-28")?.goal).toMatchObject({
    calorieTargetMilliKcal: 2_050_000,
    effectiveDate: "2026-01-01",
  });
  expect(service.read(userId, "2026-08-29")?.goal).toMatchObject({
    calorieTargetMilliKcal: 1_900_000,
    effectiveDate: "2026-08-29",
  });
  expect(service.read(userId, "2026-09-15")?.goal).toMatchObject({
    calorieTargetMilliKcal: 2_200_000,
    effectiveDate: "2026-09-15",
  });
  database.close();
});

test("effective dates use the account local day across DST boundaries", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "dst.goals");
  const beforeMidnight = new GoalVersionService(
    client,
    () => new Date("2026-03-08T04:59:59.999Z"),
  );
  const afterMidnight = new GoalVersionService(
    client,
    () => new Date("2026-03-08T05:00:00.000Z"),
  );

  beforeMidnight.replace(userId, "2026-03-07", replacement);
  expect(() => afterMidnight.replace(userId, "2026-03-07", replacement)).toThrow(
    "Effective date must be today or a future local date.",
  );
  afterMidnight.replace(userId, "2026-03-08", replacement);
  expect(afterMidnight.read(userId)?.today).toBe("2026-03-08");
  database.close();
});

test("a failed Goal Version replacement leaves goals and display units unchanged", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "atomic.goals");
  const service = new GoalVersionService(
    client,
    () => new Date("2026-08-29T16:00:00.000Z"),
  );
  client.run(sql.raw(`CREATE TRIGGER fail_goal_version_replacement
    BEFORE INSERT ON goal_versions
    WHEN NEW.user_id = ${userId}
    BEGIN
      SELECT RAISE(FAIL, 'forced Goal Version failure');
    END`));

  expect(() =>
    service.replace(userId, "2026-08-30", replacement),
  ).toThrow("forced Goal Version failure");
  expect(service.read(userId, "2026-08-30")).toMatchObject({
    displayUnits: "us",
    goal: {
      calorieTargetMilliKcal: 2_050_000,
      effectiveDate: "2026-01-01",
    },
  });
  database.close();
});

test("Goal Version reads and replacements stay scoped to one user", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const ownerId = insertConfiguredUser(client, "goal.owner");
  const otherId = insertConfiguredUser(client, "goal.other");
  const service = new GoalVersionService(
    client,
    () => new Date("2026-08-29T16:00:00.000Z"),
  );

  service.replace(ownerId, "2026-08-29", replacement);

  expect(service.read(otherId, "2026-08-29")).toMatchObject({
    displayUnits: "us",
    goal: { calorieTargetMilliKcal: 2_050_000 },
  });
  database.close();
});
