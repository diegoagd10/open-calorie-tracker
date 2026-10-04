import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { dailyGoalTargetsFromForm } from "../app/daily-goal";
import { createDailyGoalService, DailyGoalValidationError } from "../app/daily-goal/index.server";
import type { DailyGoalTargets } from "../app/daily-goal/daily-goal.model";
import { openApplicationDatabase, type ApplicationDatabaseClient } from "../app/database/database.server";
import { users } from "../app/database/schema.server";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function setupDatabase() {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-daily-goal-"));
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

const targets: DailyGoalTargets = {
  calorieTarget: 2_050_000,
  waterTarget: "80",
  proteinTarget: 120_000,
  carbohydrateTarget: 230_000,
  fatTarget: 70_000,
  fiberTarget: 25_000,
  sugarMaximum: 50_000,
  sodiumMaximum: 2_300,
};

test("an account has no Daily Goal until one is saved", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertUser(client, "no.goal");

  expect(createDailyGoalService(client, () => new Date()).read(userId)).toBeNull();
  database.close();
});

test("saving creates the Daily Goal, then replaces it and keeps its creation instant", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertUser(client, "goal.owner");
  let now = new Date("2026-08-01T12:00:00.000Z");
  const service = createDailyGoalService(client, () => now);

  const created = service.save(userId, targets);
  expect(created).toEqual({
    ...targets,
    userId,
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
  });
  expect(service.read(userId)).toEqual(created);

  now = new Date("2026-08-29T08:00:00.000Z");
  const replaced = service.save(userId, { ...targets, calorieTarget: 1_800_000, waterTarget: "64.5" });
  expect(replaced).toEqual({
    ...targets,
    calorieTarget: 1_800_000,
    waterTarget: "64.5",
    userId,
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-29T08:00:00.000Z",
  });
  expect(service.read(userId)).toEqual(replaced);
  database.close();
});

test("water targets are stored in their canonical fluid-ounce spelling", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertUser(client, "water.spelling");
  const service = createDailyGoalService(client, () => new Date("2026-08-01T12:00:00.000Z"));

  expect(service.save(userId, { ...targets, waterTarget: "067.500" }).waterTarget).toBe("67.5");
  expect(service.save(userId, { ...targets, waterTarget: "0.001" }).waterTarget).toBe("0.001");
  expect(service.save(userId, { ...targets, waterTarget: "500" }).waterTarget).toBe("500");
  database.close();
});

test.each([
  ["calorieTarget", 0, "Calories must be from 0.001 to 20,000 kcal."],
  ["calorieTarget", 20_000_001, "Calories must be from 0.001 to 20,000 kcal."],
  ["calorieTarget", Number.NaN, "Calories must be from 0.001 to 20,000 kcal."],
  ["calorieTarget", 1.5, "Calories must be from 0.001 to 20,000 kcal."],
  ["waterTarget", "0", "Water must be from 0.001 to 500 fl oz."],
  ["waterTarget", "500.001", "Water must be from 0.001 to 500 fl oz."],
  ["waterTarget", "1.0001", "Water must be from 0.001 to 500 fl oz."],
  ["waterTarget", "-1", "Water must be from 0.001 to 500 fl oz."],
  ["waterTarget", "eighty", "Water must be from 0.001 to 500 fl oz."],
  ["waterTarget", 80, "Water must be from 0.001 to 500 fl oz."],
  ["proteinTarget", 0, "Protein must be from 0.001 to 2,000 g."],
  ["proteinTarget", 2_000_001, "Protein must be from 0.001 to 2,000 g."],
  ["carbohydrateTarget", 2_000_001, "Carbohydrate must be from 0.001 to 2,000 g."],
  ["fatTarget", -1, "Fat must be from 0.001 to 2,000 g."],
  ["fiberTarget", 2_000_001, "Fiber must be from 0.001 to 2,000 g."],
  ["sugarMaximum", 2_000_001, "Sugar maximum must be from 0.001 to 2,000 g."],
  ["sodiumMaximum", 0, "Sodium maximum must be from 1 to 100,000 mg."],
  ["sodiumMaximum", 100_001, "Sodium maximum must be from 1 to 100,000 mg."],
] as const)("saving rejects %s %s and writes nothing", async (field, value, message) => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertUser(client, "invalid.goal");
  const service = createDailyGoalService(client, () => new Date("2026-08-01T12:00:00.000Z"));

  let error: unknown;
  try {
    service.save(userId, { ...targets, [field]: value });
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(DailyGoalValidationError);
  expect(error).toMatchObject({ field, message });
  expect(service.read(userId)).toBeNull();
  database.close();
});

test("the first rejected target in form order is reported", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertUser(client, "two.errors");
  const service = createDailyGoalService(client, () => new Date("2026-08-01T12:00:00.000Z"));

  expect(() => service.save(userId, { ...targets, calorieTarget: 0, waterTarget: "0", sodiumMaximum: 0 }))
    .toThrow(expect.objectContaining({ field: "calorieTarget" }) as Error);
  expect(() => service.save(userId, { ...targets, waterTarget: "0", sodiumMaximum: 0 }))
    .toThrow(expect.objectContaining({ field: "waterTarget" }) as Error);
  database.close();
});

test("the largest accepted targets are saved", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertUser(client, "largest.goal");
  const service = createDailyGoalService(client, () => new Date("2026-08-01T12:00:00.000Z"));
  const largest: DailyGoalTargets = {
    calorieTarget: 20_000_000,
    waterTarget: "500",
    proteinTarget: 2_000_000,
    carbohydrateTarget: 2_000_000,
    fatTarget: 2_000_000,
    fiberTarget: 2_000_000,
    sugarMaximum: 2_000_000,
    sodiumMaximum: 100_000,
  };

  expect(service.save(userId, largest)).toMatchObject(largest);
  database.close();
});

test("goal inputs convert typed amounts to canonical units and leave unreadable ones for save to reject", () => {
  const form = new FormData();
  form.set("calorieTarget", " 2050.5 ");
  form.set("waterTarget", " 67.628 ");
  form.set("proteinTarget", "120.25");
  form.set("carbohydrateTarget", "1.0001");
  form.set("fatTarget", "070");
  form.set("sugarMaximum", "50");
  form.set("sodiumMaximum", "2300.5");

  const parsed = dailyGoalTargetsFromForm(form);
  expect(parsed).toEqual({
    calorieTarget: 2_050_500,
    waterTarget: "67.628",
    proteinTarget: 120_250,
    carbohydrateTarget: Number.NaN,
    fatTarget: Number.NaN,
    fiberTarget: Number.NaN,
    sugarMaximum: 50_000,
    sodiumMaximum: Number.NaN,
  });
  form.set("sodiumMaximum", "2300");
  expect(dailyGoalTargetsFromForm(form).sodiumMaximum).toBe(2_300);
});

test("each account reads and replaces only its own Daily Goal", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const ownerId = insertUser(client, "goal.owner");
  const otherId = insertUser(client, "goal.other");
  const service = createDailyGoalService(client, () => new Date("2026-08-01T12:00:00.000Z"));

  service.save(ownerId, targets);
  expect(service.read(otherId)).toBeNull();
  service.save(otherId, { ...targets, calorieTarget: 1_500_000 });

  expect(service.read(ownerId)?.calorieTarget).toBe(2_050_000);
  expect(service.read(otherId)?.calorieTarget).toBe(1_500_000);
  database.close();
});

test("deleting an account deletes its Daily Goal", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertUser(client, "deleted.owner");
  const service = createDailyGoalService(client, () => new Date("2026-08-01T12:00:00.000Z"));
  service.save(userId, targets);

  client.$client.prepare("DELETE FROM users WHERE id = ?").run(userId);

  expect(service.read(userId)).toBeNull();
  expect(client.$client.prepare("SELECT count(*) AS count FROM daily_goals").get()).toEqual({ count: 0 });
  database.close();
});
