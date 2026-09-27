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
import {
  GoalVersionService,
  GoalVersionUnavailableError,
  InvalidGoalVersionDateError,
} from "../app/goals/goal-version.server";
import {
  convertWaterDisplay,
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

test("unit changes convert the draft water amount instead of resetting it", () => {
  expect(convertWaterDisplay("100", "us", "metric")).toBe("2957.353");
  expect(convertWaterDisplay("2957.353", "metric", "us")).toBe("100");
  expect(convertWaterDisplay("not-water", "metric", "us")).toBeUndefined();
});

test("Goal Version validation reports the exact failing field and message", () => {
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
  } as const;

  expect(
    validateGoalVersionFields(
      { ...validFields, effectiveDate: "not-a-date" },
      "America/New_York",
    ),
  ).toEqual({
    error: "Enter a valid effective date.",
    field: "effectiveDate",
    success: false,
  });
  expect(
    validateGoalVersionFields(
      { ...validFields, carbohydrate: "" },
      "America/New_York",
    ),
  ).toEqual({
    error: "Carbohydrate must be from 0.001 to 2,000 g.",
    field: "carbohydrate",
    success: false,
  });
  expect(
    validateGoalVersionFields(validFields, "not/a-zone"),
  ).toMatchObject({ field: "effectiveDate", success: false });
});

test("saving a converted draft preserves the canonical amount entered before conversion", () => {
  const sourceGoal = {
    calorieTargetMilliKcal: 2_000_000,
    carbohydrateTargetMilligrams: 200_000,
    effectiveDate: "2026-08-29",
    fatTargetMilligrams: 70_000,
    fiberTargetMilligrams: 30_000,
    proteinTargetMilligrams: 100_000,
    sodiumMaximumMilligrams: 2_000,
    sugarMaximumMilligrams: 50_000,
    waterTargetMicroliters: 2_400_000,
  };
  const convertedWater = convertWaterDisplay("2500", "metric", "us")!;

  expect(
    validateGoalVersionFields(
      {
        ...goalFieldsFromCanonical(sourceGoal, "us"),
        displayUnits: "us",
        water: convertedWater,
        waterSourceUnits: "metric",
        waterSourceValue: "2500",
      },
      "America/New_York",
      sourceGoal,
    ),
  ).toMatchObject({
    data: { waterTargetMicroliters: 2_500_000 },
    success: true,
  });
});

test("an unchanged rounded water display preserves its exact canonical value", () => {
  const sourceGoal = {
    calorieTargetMilliKcal: 2_000_000,
    carbohydrateTargetMilligrams: 200_000,
    effectiveDate: "2026-08-29",
    fatTargetMilligrams: 70_000,
    fiberTargetMilligrams: 30_000,
    proteinTargetMilligrams: 100_000,
    sodiumMaximumMilligrams: 2_000,
    sugarMaximumMilligrams: 50_000,
    waterTargetMicroliters: 2_400_000,
  };
  const usFields = goalFieldsFromCanonical(sourceGoal, "us");
  expect(usFields.water).toBe("81.154");

  expect(
    validateGoalVersionFields(
      { ...usFields, displayUnits: "us", water: ` ${usFields.water} ` },
      "America/New_York",
      sourceGoal,
    ),
  ).toMatchObject({
    data: { waterTargetMicroliters: 2_400_000 },
    success: true,
  });
});

test("source water metadata only preserves the source amount while the converted draft is unchanged", () => {
  const fields = {
    calories: "1900",
    carbohydrate: "210",
    displayUnits: "us" as const,
    effectiveDate: "2026-08-30",
    fat: "65",
    fiber: "30",
    protein: "110",
    sodium: "2000",
    sugar: "45",
    waterSourceUnits: "metric",
    waterSourceValue: "2500",
  };

  const converted = convertWaterDisplay("2500", "metric", "us")!;
  expect(
    validateGoalVersionFields(
      { ...fields, water: ` ${converted} ` },
      "America/New_York",
    ),
  ).toMatchObject({ data: { waterTargetMicroliters: 2_500_000 } });
  expect(
    validateGoalVersionFields(
      { ...fields, water: "90" },
      "America/New_York",
    ),
  ).toMatchObject({ data: { waterTargetMicroliters: 2_661_618 } });
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

test("Goal Version history lists one version per date with the date it stops applying", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "history.goals");
  const service = new GoalVersionService(
    client,
    () => new Date("2026-03-01T17:00:00.000Z"),
  );
  service.replace(userId, "2026-03-10", replacement);
  service.replace(userId, "2026-03-10", { ...replacement, calorieTargetMilliKcal: 1_800_000 });
  service.replace(userId, "2026-04-01", replacement);

  const history = service.history(userId);
  expect(history.map(({ effectiveDate, lastDate }) => [effectiveDate, lastDate])).toEqual([
    ["2026-04-01", null],
    ["2026-03-10", "2026-03-31"],
    ["2026-01-01", "2026-03-09"],
  ]);
  expect(history[1].calorieTargetMilliKcal).toBe(1_800_000);
  expect(service.history(userId + 1)).toEqual([]);
  database.close();
});

test("navigation today follows the account time zone and is absent before setup", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "local.today");
  const unconfiguredUserId = client
    .insert(users)
    .values({ createdAt: "2026-01-01T00:00:00.000Z", usernameNormalized: "no.setup" })
    .returning({ id: users.id })
    .get().id;
  const eveningInNewYork = new GoalVersionService(
    client,
    () => new Date("2026-09-28T02:30:00.000Z"),
  );

  expect(eveningInNewYork.localToday(userId)).toBe("2026-09-27");
  expect(eveningInNewYork.localToday(unconfiguredUserId)).toBeUndefined();
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

test("Goal Version service distinguishes unavailable accounts and invalid dates", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "goal.errors");
  const missingUserId = userId + 10_000;
  const service = new GoalVersionService(
    client,
    () => new Date("2026-08-29T16:00:00.000Z"),
  );

  expect(service.read(missingUserId)).toBeUndefined();
  expect(() => service.read(userId, "not-a-date")).toThrow(
    InvalidGoalVersionDateError,
  );
  expect(() => service.replace(missingUserId, "2026-08-30", replacement)).toThrow(
    GoalVersionUnavailableError,
  );
  expect(new InvalidGoalVersionDateError()).toMatchObject({
    message: "Effective date must be today or a future local date.",
    name: "InvalidGoalVersionDateError",
  });
  expect(new GoalVersionUnavailableError()).toMatchObject({
    message: "Goal Versions are unavailable for this account.",
    name: "GoalVersionUnavailableError",
  });
  database.close();
});
