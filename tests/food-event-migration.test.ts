import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { sql } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";

import { FoodCatalog } from "../app/catalog/food-catalog.server";
import { openApplicationDatabase, type ApplicationDatabase } from "../app/database/database.server";
import { initializeApplicationDatabase, shutdownApplicationDatabase } from "../app/database/runtime.server";
import { loadFoodEventDialogs } from "../app/food-event/dialogs.server";
import { createFoodEventService } from "../app/food-event/runtime.server";
import { createMigrationFolder } from "./support/migrations";

const temporaryDirectories: string[] = [];
const createdAt = "2026-08-26T12:00:00.000Z";
const nutrition = '{"carbohydrateMilligrams":null,"energyMilliKcal":{"amount":60,"fixedPointMultiplier":1000},"fatMilligrams":null,"fiberMilligrams":null,"proteinMilligrams":null,"sodiumMilligrams":null,"sugarMilligrams":null}';
const servings = '[{"baseQuantityMicrounits":1000000,"id":"serving","label":"1 serving","unit":"serving"}]';

afterEach(async () => {
  shutdownApplicationDatabase();
  vi.unstubAllEnvs();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

type Sqlite = ApplicationDatabase["getClient"] extends () => infer C ? C extends { $client: infer S } ? S : never : never;

function insertUser(sqlite: Sqlite, username: string, timeZone: string | null): number {
  const { id } = sqlite.prepare("INSERT INTO users (username_normalized, created_at) VALUES (?, ?) RETURNING id").get(username, createdAt) as { id: number };
  if (timeZone) {
    sqlite.prepare("INSERT INTO user_preferences (user_id, time_zone, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, timeZone, createdAt, createdAt);
  }
  return id;
}

/** A manual Food Entry as the 0032 schema stored it: a local date and time, and an idempotency key. */
function insertEntry(sqlite: Sqlite, values: { userId: number; date: string; time: string; key: string; name: string; savedFoodId?: number }): number {
  const { id } = sqlite.prepare(`INSERT INTO food_entries (
    user_id, food_log_date, local_event_time, provider, provider_food_id, source_saved_food_id, source_data_type, original_name,
    authoritative_base_unit, authoritative_base_quantity_microunits, authoritative_nutrition,
    selected_measurement_id, selected_measurement_label, selected_measurement_unit, selected_measurement_base_quantity_microunits,
    supported_measurements, quantity_microunits, authoritative_energy_milli_kcal, idempotency_key, created_at, updated_at
  ) VALUES (?, ?, ?, 'manual', ?, ?, 'User entered', ?, 'serving', 1000000, ?, 'serving', '1 serving', 'serving', 1000000, ?, 3000000, 180000, ?, ?, ?)
  RETURNING id`).get(
    values.userId, values.date, values.time, values.key, values.savedFoodId ?? null, values.name, nutrition, servings, values.key, createdAt, createdAt,
  ) as { id: number };
  return id;
}

function savedFoodJson(name: string, key: string): string {
  return JSON.stringify({
    authoritativeBaseQuantityMicrounits: 1_000_000,
    authoritativeBaseUnit: "serving",
    authoritativeNutrition: nutrition,
    barcode: null,
    brand: null,
    carbohydrateMilligrams: null,
    editedName: null,
    energyMilliKcal: 180_000,
    fatMilligrams: null,
    fiberMilligrams: null,
    marketCountry: null,
    originalName: name,
    proteinMilligrams: null,
    provider: "manual",
    providerFoodId: key,
    providerModifiedDate: null,
    providerPublishedDate: null,
    quantityMicrounits: 3_000_000,
    selectedMeasurementBaseQuantityMicrounits: 1_000_000,
    selectedMeasurementId: "serving",
    selectedMeasurementLabel: "1 serving",
    selectedMeasurementUnit: "serving",
    sodiumMilligrams: null,
    sourceDataType: "User entered",
    sugarMilligrams: null,
    supportedMeasurements: servings,
  });
}

function insertSavedFood(sqlite: Sqlite, userId: number, sourceEntryId: number, name: string, key: string): number {
  const { id } = sqlite.prepare("INSERT INTO saved_foods (user_id, source_entry_id, name, snapshot, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .get(userId, sourceEntryId, name, savedFoodJson(name, key), createdAt) as { id: number };
  return id;
}

/** A database at 0032 with history that exercises every conversion rule. */
async function seedPreviousRelease() {
  const directory = await mkdtemp(path.join(tmpdir(), "food-event-migration-"));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, "application.sqlite");
  const migrationsFolder = await createMigrationFolder(path.join(directory, "previous"), { throughTag: "0032_remove_ai_photo_schema" });
  const previous = openApplicationDatabase({ databasePath, migrationsFolder });
  const sqlite = previous.getClient().$client;
  const owner = insertUser(sqlite, "migration.owner", "America/New_York");
  const unconfigured = insertUser(sqlite, "migration.unconfigured", null);

  const source = insertEntry(sqlite, { userId: owner, date: "2026-08-27", time: "12:00:00", key: "manual-tortilla-key", name: "Tortilla" });
  const tortilla = insertSavedFood(sqlite, owner, source, "Tortilla", "manual-tortilla-key");
  const copy = insertEntry(sqlite, { userId: owner, date: "2026-08-28", time: "12:00:00", key: `copy:${source}:legacy-nonce`, name: "Tortilla", savedFoodId: tortilla });
  const fold = insertEntry(sqlite, { userId: owner, date: "2026-11-01", time: "01:30:00", key: "repeated-hour", name: "Fold snack" });
  const gap = insertEntry(sqlite, { userId: owner, date: "2026-03-08", time: "02:30:00", key: "skipped-hour", name: "Gap snack" });
  const noZone = insertEntry(sqlite, { userId: unconfigured, date: "2026-08-27", time: "09:00:00", key: "no-preferences", name: "Unconfigured snack" });
  const notCopy = insertEntry(sqlite, { userId: owner, date: "2026-08-27", time: "13:00:00", key: "copy:abc:nonce", name: "Odd key" });
  const deleted = insertEntry(sqlite, { userId: owner, date: "2026-08-26", time: "12:00:00", key: "deleted-source", name: "Deleted soup" });
  const soup = insertSavedFood(sqlite, owner, deleted, "Deleted soup", "deleted-source");
  sqlite.prepare("DELETE FROM food_entries WHERE id = ?").run(deleted);

  const before = {
    entries: sqlite.prepare("SELECT * FROM food_entries ORDER BY id").all() as Array<Record<string, unknown>>,
    savedFoods: sqlite.prepare("SELECT * FROM saved_foods ORDER BY id").all() as Array<Record<string, unknown>>,
  };
  previous.close();
  return { before, databasePath, directory, ids: { copy, deleted, fold, gap, noZone, notCopy, source }, owner, soup, tortilla };
}

test("upgrading converts Food Entries to Food Events with UTC log dates, copy provenance, and favorites", async () => {
  const seeded = await seedPreviousRelease();
  const database = openApplicationDatabase({ databasePath: seeded.databasePath, migrationsFolder: path.resolve("drizzle") });
  try {
    const sqlite = database.getClient().$client;
    const events = sqlite.prepare("SELECT * FROM food_events ORDER BY id").all() as Array<Record<string, unknown>>;
    expect(events).toEqual(seeded.before.entries.map(({
      food_log_date: _date,
      local_event_time: _time,
      idempotency_key: _key,
      source_saved_food_id: sourceSavedFoodId,
      ...entry
    }) => ({
      ...entry,
      log_date: expect.stringMatching(/Z$/) as unknown,
      source_favorite_id: sourceSavedFoodId,
      copied_from_event_id: entry.id === seeded.ids.copy ? seeded.ids.source : null,
    })));
    const logDates = Object.fromEntries(events.map((event) => [String(event.id), String(event.log_date)]));
    expect(logDates).toEqual({
      [seeded.ids.source]: "2026-08-27T16:00:00.000Z",
      [seeded.ids.copy]: "2026-08-28T16:00:00.000Z",
      // A repeated hour is its first occurrence; a skipped one uses the offset before the gap.
      [seeded.ids.fold]: "2026-11-01T05:30:00.000Z",
      [seeded.ids.gap]: "2026-03-08T07:30:00.000Z",
      // Without preferences the wall-clock time reads as UTC.
      [seeded.ids.noZone]: "2026-08-27T09:00:00.000Z",
      [seeded.ids.notCopy]: "2026-08-27T17:00:00.000Z",
    });
    expect(sqlite.prepare("SELECT * FROM favorite_foods ORDER BY id").all()).toEqual(seeded.before.savedFoods.map(({ source_entry_id: sourceEntryId, ...saved }) => ({
      ...saved,
      source_event_id: sourceEntryId,
    })));
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name IN ('food_entries', 'saved_foods')").all()).toEqual([]);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    expect(database.getStatus()).toMatchObject({ migrationsCurrent: true, foreignKeysEnabled: true, writable: true });
  } finally {
    database.close();
  }
});

test("upgraded history keeps favorites, links, and IDs usable through the Food Event rules", async () => {
  const seeded = await seedPreviousRelease();
  const database = openApplicationDatabase({ databasePath: seeded.databasePath, migrationsFolder: path.resolve("drizzle") });
  try {
    const service = createFoodEventService(database.getClient(), () => new Date("2026-08-29T18:00:00.000Z"), new FoodCatalog([]));
    expect(service.read(seeded.owner, seeded.ids.source)).toMatchObject({ favoriteId: seeded.tortilla, copiedFromId: null });
    expect(service.read(seeded.owner, seeded.ids.copy)).toMatchObject({ favoriteId: seeded.tortilla, copiedFromId: seeded.ids.source });
    expect(service.read(seeded.owner, seeded.ids.notCopy).copiedFromId).toBeNull();

    // A favorite whose source event was deleted before the upgrade stays reusable.
    const reused = await service.save(seeded.owner, { method: "favorite", logDate: "2026-08-29T17:00:00.000Z", favoriteId: seeded.soup });
    expect(reused).toMatchObject({ name: "Deleted soup", favoriteId: seeded.soup, nutrients: { energyMilliKcal: 180_000 } });
    // The deleted event's ID is never handed out again, so no new event inherits its favorite.
    expect(reused.id).toBeGreaterThan(seeded.ids.deleted);
    const manual = await service.save(seeded.owner, {
      method: "manual", logDate: "2026-08-29T17:00:00.000Z", name: "New soup", quantity: "1", nutrition: { energyKcal: "90" }, saveAsFavorite: true,
    });
    expect(manual.favoriteId).toBeGreaterThan(seeded.soup);
    expect(service.findFavorites(seeded.owner, { query: "soup" }).map((favorite) => favorite.name)).toEqual(["Deleted soup", "New soup"]);
  } finally {
    database.close();
  }
});

test("a legacy copied URL opens the migrated entry without a notice", async () => {
  const seeded = await seedPreviousRelease();
  vi.stubEnv("DATABASE_PATH", seeded.databasePath);
  initializeApplicationDatabase();
  const request = new Request(`http://localhost/?date=2026-08-28&entry=${seeded.ids.copy}&notice=copied&copied=${seeded.ids.copy}`, {
    headers: { "X-Test-Food-Log-Now": "2026-08-29T18:00:00.000Z" },
  });

  const loaded = await loadFoodEventDialogs(
    { request, role: "member", userId: seeded.owner },
    { selectedDate: "2026-08-28", today: "2026-08-29", isFuture: false, timeZone: "America/New_York" },
  );

  expect(loaded).toMatchObject({ dialogs: { editor: { event: { id: seeded.ids.copy, name: "Tortilla" } } } });
  if (loaded instanceof Response) throw new Error("Expected Food Event dialogs");
  expect(loaded.dialogs).not.toHaveProperty("notice");
});

test("a second startup changes nothing, and a fresh database starts empty", async () => {
  const seeded = await seedPreviousRelease();
  const first = openApplicationDatabase({ databasePath: seeded.databasePath, migrationsFolder: path.resolve("drizzle") });
  const upgraded = first.getClient().$client.prepare("SELECT * FROM food_events ORDER BY id").all();
  first.close();
  const second = openApplicationDatabase({ databasePath: seeded.databasePath, migrationsFolder: path.resolve("drizzle") });
  expect(second.getClient().$client.prepare("SELECT * FROM food_events ORDER BY id").all()).toEqual(upgraded);
  second.close();

  const fresh = openApplicationDatabase({ databasePath: path.join(seeded.directory, "fresh.sqlite"), migrationsFolder: path.resolve("drizzle") });
  expect(fresh.getClient().$client.prepare("SELECT COUNT(*) AS count FROM food_events").get()).toEqual({ count: 0 });
  expect(fresh.getStatus().migrationsCurrent).toBe(true);
  fresh.close();
});

test("an unreadable legacy time rolls the whole conversion back, fails startup, and converts on a fixed retry", async () => {
  const seeded = await seedPreviousRelease();
  const legacy = openApplicationDatabase({ databasePath: seeded.databasePath, migrationsFolder: await createMigrationFolder(path.join(seeded.directory, "legacy"), { throughTag: "0032_remove_ai_photo_schema" }) });
  legacy.getClient().$client.prepare("UPDATE food_entries SET local_event_time = '25:00:00' WHERE id = ?").run(seeded.ids.gap);
  legacy.close();

  expect(() => openApplicationDatabase({ databasePath: seeded.databasePath, migrationsFolder: path.resolve("drizzle") }))
    .toThrow(`Food Event ${seeded.ids.gap} has an unreadable log date`);

  // The migration committed, but no row was converted.
  const inspect = openApplicationDatabase({ databasePath: path.join(seeded.directory, "inspect.sqlite"), migrationsFolder: path.resolve("drizzle") });
  inspect.getClient().run(sql.raw(`ATTACH DATABASE '${seeded.databasePath}' AS upgraded`));
  expect(inspect.getClient().$client.prepare("SELECT COUNT(*) AS count FROM upgraded.food_events WHERE log_date LIKE '%Z'").get()).toEqual({ count: 0 });
  inspect.getClient().$client.prepare("UPDATE upgraded.food_events SET log_date = '2026-03-08T12:00:00' WHERE id = ?").run(seeded.ids.gap);
  inspect.getClient().run(sql.raw("DETACH DATABASE upgraded"));
  inspect.close();

  const retried = openApplicationDatabase({ databasePath: seeded.databasePath, migrationsFolder: path.resolve("drizzle") });
  expect(retried.getClient().$client.prepare("SELECT COUNT(*) AS count FROM food_events WHERE log_date NOT LIKE '%Z'").get()).toEqual({ count: 0 });
  expect(retried.getClient().$client.prepare("SELECT log_date AS logDate FROM food_events WHERE id = ?").get(seeded.ids.gap)).toEqual({ logDate: "2026-03-08T16:00:00.000Z" });
  retried.close();
});
