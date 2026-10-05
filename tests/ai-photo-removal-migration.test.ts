import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { openApplicationDatabase, type ApplicationDatabase } from "../app/database/database.server";
import { FoodCatalog } from "../app/catalog/food-catalog.server";
import { FoodEntryService } from "../app/food-entry/food-entry.server";
import { FoodLogService } from "../app/food-log/food-log.server";
import { summarizeDailyLog } from "../app/mcp/daily-log-summary";
import { createMigrationFolder } from "./support/migrations";

const temporaryDirectories: string[] = [];
const createdAt = "2026-09-06T12:00:00.000Z";
const nutrition = '{"carbohydrateMilligrams":{"amount":42,"fixedPointMultiplier":1000},"energyMilliKcal":{"amount":520,"fixedPointMultiplier":1000},"fatMilligrams":{"amount":18,"fixedPointMultiplier":1000},"fiberMilligrams":null,"proteinMilligrams":{"amount":31,"fixedPointMultiplier":1000},"sodiumMilligrams":null,"sugarMilligrams":null}';

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })));
});

function insertEntry(database: ApplicationDatabase, userId: number, values: { idempotencyKey: string; measurement: { id: string; label: string }; name: string; provider: string; sourceDataType: string }) {
  const measurements = JSON.stringify([{ id: values.measurement.id, label: values.measurement.label, unit: "serving", baseQuantityMicrounits: 1000000 }]);
  return database.getClient().$client.prepare(`INSERT INTO food_entries (
    user_id, food_log_date, local_event_time, provider, provider_food_id, source_data_type, original_name,
    authoritative_base_unit, authoritative_base_quantity_microunits, authoritative_nutrition,
    selected_measurement_id, selected_measurement_label, selected_measurement_unit, selected_measurement_base_quantity_microunits,
    supported_measurements, quantity_microunits, authoritative_energy_milli_kcal, authoritative_protein_milligrams,
    authoritative_carbohydrate_milligrams, authoritative_fat_milligrams, idempotency_key, created_at, updated_at
  ) VALUES (?, '2026-09-06', '12:00:00', ?, ?, ?, ?, 'serving', 1000000, ?, ?, ?, 'serving', 1000000, ?, 1000000, 520000, 31000, 42000, 18000, ?, ?, ?) RETURNING id`)
    .get(userId, values.provider, values.idempotencyKey, values.sourceDataType, values.name, nutrition, values.measurement.id, values.measurement.label, measurements, values.idempotencyKey, createdAt, createdAt) as { id: number };
}

async function seedPreRemovalDatabase() {
  const directory = await mkdtemp(path.join(tmpdir(), "ai-photo-removal-"));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, "app.sqlite");
  const migrationsFolder = await createMigrationFolder(path.join(directory, "migrations"), { throughTag: "0030_daily_goal" });
  const database = openApplicationDatabase({ databasePath, migrationsFolder });
  const sqlite = database.getClient().$client;
  const user = sqlite.prepare("INSERT INTO users (username_normalized, created_at) VALUES ('former.ai.member', ?) RETURNING id").get(createdAt) as { id: number };
  sqlite.prepare("INSERT INTO user_preferences (user_id, time_zone, created_at, updated_at) VALUES (?, 'UTC', ?, ?)").run(user.id, createdAt, createdAt);
  const plate = { id: "plate", label: "Analyzed plate" };
  const formerAi = [
    insertEntry(database, user.id, { idempotencyKey: "photo-meal-1", measurement: plate, name: "Chicken rice bowl", provider: "ai-photo", sourceDataType: "AI analysis" }),
    insertEntry(database, user.id, { idempotencyKey: "photo-meal-2", measurement: plate, name: "Pasta salad", provider: "ai-photo", sourceDataType: "AI analysis" }),
  ];
  const manual = insertEntry(database, user.id, { idempotencyKey: "manual-entry-1", measurement: { id: "serving", label: "1 serving" }, name: "Granola", provider: "manual", sourceDataType: "User entered" });
  const insertMeal = sqlite.prepare("INSERT INTO photo_meals (id, user_id, entry_id, food_log_date, local_event_time, photo, mime_type, created_at) VALUES (?, ?, ?, '2026-09-06', '12:00:00', ?, 'image/png', ?)");
  insertMeal.run("meal-1", user.id, formerAi[0].id, Buffer.alloc(12), createdAt);
  insertMeal.run("meal-unattached", user.id, null, Buffer.alloc(12), createdAt);
  sqlite.prepare("INSERT INTO photo_attempts (id, meal_id, user_id, idempotency_key, status, stage, started_at, finished_at) VALUES ('attempt-1', 'meal-1', ?, 'attempt-key-1', 'succeeded', 'Preparing result', ?, ?)").run(user.id, createdAt, createdAt);
  const insertBundle = sqlite.prepare("INSERT INTO encrypted_credential_bundles (name, envelope, configured_at, updated_at) VALUES (?, 'sealed', ?, ?)");
  insertBundle.run("photo-analysis", createdAt, createdAt);
  insertBundle.run("other-integration", createdAt, createdAt);
  const insertMetadata = sqlite.prepare("INSERT INTO application_metadata (key, value, updated_at) VALUES (?, '{}', ?)");
  insertMetadata.run("photo_analysis_configuration", createdAt);
  insertMetadata.run("photo_analysis_test_readiness", createdAt);
  const before = sqlite.prepare("SELECT * FROM food_entries ORDER BY id").all() as Array<Record<string, unknown>>;
  database.close();
  return { before, databasePath, formerAiIds: formerAi.map(entry => entry.id), manualId: manual.id, userId: user.id };
}

test("upgrading converts AI photo entries to manual entries and deletes photo data, AI secrets and AI configuration", async () => {
  const seeded = await seedPreRemovalDatabase();
  const database = openApplicationDatabase({ databasePath: seeded.databasePath, migrationsFolder: path.resolve("drizzle") });
  try {
    const sqlite = database.getClient().$client;
    const after = sqlite.prepare("SELECT * FROM food_entries ORDER BY id").all() as Array<Record<string, unknown>>;
    expect(after).toEqual(seeded.before.map(entry => seeded.formerAiIds.includes(entry.id as number)
      ? { ...entry, provider: "manual", source_data_type: "User entered" }
      : entry));
    expect(after.find(entry => entry.id === seeded.formerAiIds[0])).toMatchObject({ original_name: "Chicken rice bowl", selected_measurement_label: "Analyzed plate", authoritative_energy_milli_kcal: 520000 });

    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'photo_%'").all();
    expect(tables).toEqual([]);
    expect(sqlite.prepare("SELECT name FROM encrypted_credential_bundles ORDER BY name").all()).toEqual([{ name: "other-integration" }]);
    expect(sqlite.prepare("SELECT key FROM application_metadata WHERE key LIKE 'photo_analysis%'").all()).toEqual([]);
    expect(database.getStatus()).toMatchObject({ foreignKeysEnabled: true, migrationsCurrent: true });

    expect(() => insertEntry(database, seeded.userId, { idempotencyKey: "photo-meal-3", measurement: { id: "plate", label: "Analyzed plate" }, name: "Rejected", provider: "ai-photo", sourceDataType: "AI analysis" }))
      .toThrow(/CHECK constraint failed/);
  } finally { database.close(); }
});

test("a former AI photo entry behaves like a manual entry", async () => {
  const seeded = await seedPreRemovalDatabase();
  const database = openApplicationDatabase({ databasePath: seeded.databasePath, migrationsFolder: path.resolve("drizzle") });
  try {
    const entries = new FoodEntryService(database.getClient(), new FoodCatalog([]), () => new Date("2026-09-08T12:00:00Z"));
    const formerAi = entries.read(seeded.userId, seeded.formerAiIds[0]);
    expect(formerAi).toMatchObject({ provider: "manual", dataType: "User entered", name: "Chicken rice bowl", selectedMeasurementLabel: "Analyzed plate" });

    const updated = entries.update(seeded.userId, formerAi.id, { expectedUpdatedAt: formerAi.updatedAt, foodLogDate: formerAi.foodLogDate, name: "Edited bowl", quantity: "2", selectedMeasurementId: "plate", energyKcal: "1040" });
    expect(updated).toMatchObject({ name: "Edited bowl", energyMilliKcal: 1040000, selectedMeasurementLabel: "Analyzed plate" });

    expect(entries.saveManualEntry(seeded.userId, formerAi.id)).toMatchObject({ name: "Edited bowl" });
    expect(entries.isManualEntrySaved(seeded.userId, formerAi.id)).toBe(true);

    const copy = entries.copyToToday(seeded.userId, formerAi.id, { foodLogDate: formerAi.foodLogDate, idempotencyKey: `copy:${formerAi.id}:former-ai` });
    expect(copy).toMatchObject({ provider: "manual", name: "Edited bowl", energyMilliKcal: 1040000 });
  } finally { database.close(); }
});

test("the MCP daily log reports a former AI photo entry as a manual entry", async () => {
  const seeded = await seedPreRemovalDatabase();
  const database = openApplicationDatabase({ databasePath: seeded.databasePath, migrationsFolder: path.resolve("drizzle") });
  try {
    const foodLog = new FoodLogService(database.getClient(), () => new Date("2026-09-08T12:00:00Z")).read(seeded.userId, "2026-09-06")!;
    const { structured, text } = summarizeDailyLog(foodLog);
    expect(structured.foods.find(food => food.name === "Chicken rice bowl")).toMatchObject({ provider: "manual", dataType: "User entered", serving: "Analyzed plate × 1", energyKcal: 520 });
    expect(text).toContain("Chicken rice bowl, Manual, Analyzed plate × 1: 520 kcal");
  } finally { database.close(); }
});
