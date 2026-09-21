import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { openApplicationDatabase } from "../app/database/database.server";
import { userPreferences, photoMeals } from "../app/database/schema.server";
import { FoodCatalog } from "../app/catalog/food-catalog.server";
import { TestFoodCatalogProvider, TestOpenFoodFactsProvider } from "../app/catalog/test-fixture.server";
import { FoodEntryService } from "../app/food-entry/food-entry.server";
import { createMigrationFolder } from "./support/migrations";

test.each(["0014_breezy_eternals", "0015_outstanding_stature", "0016_first_key"])("migrating a populated application from %s preserves USDA/OFF snapshots, supported measures, edits and copies", async throughTag => {
  const directory = await mkdtemp(path.join(tmpdir(), "off-migration-"));
  const oldMigrations = await createMigrationFolder(path.join(directory, "migrations"), { throughTag });
  const databasePath = path.join(directory, "app.sqlite");
  let database = openApplicationDatabase({ databasePath, migrationsFolder: oldMigrations });
  try {
    const createdAt = "2026-01-01T00:00:00.000Z";
    const user = database.getClient().$client.prepare("INSERT INTO users (username_normalized, created_at) VALUES (?, ?) RETURNING id").get("old.off.member", createdAt) as { id: number };
    database.getClient().insert(userPreferences).values({ userId: user.id, timeZone: "UTC", displayUnits: "metric", createdAt, updatedAt: createdAt }).run();
    const catalog = new FoodCatalog([{ provider: "usda-fdc", capability: "search", service: new TestFoodCatalogProvider() }, { provider: "open-food-facts", capability: "barcode", service: new TestOpenFoodFactsProvider() }]);
    const oldEntries = new FoodEntryService(database.getClient(), catalog);
    const history = await Promise.all([
      oldEntries.log(user.id, { provider: "usda-fdc", providerFoodId: "1001", foodLogDate: "2026-09-06", idempotencyKey: "historical-usda", selectedMeasurementId: "base:g:100000000", quantity: "1" }),
      oldEntries.log(user.id, { provider: "open-food-facts", providerFoodId: "0012345678905", foodLogDate: "2026-09-06", idempotencyKey: "historical-off", selectedMeasurementId: "serving", quantity: "1" }),
    ]);
    database.getClient().insert(photoMeals).values({ id: "historical-photo", userId: user.id, entryId: history[0].id, foodLogDate: "2026-09-06", localEventTime: createdAt, photo: Buffer.alloc(12), mimeType: "image/png", createdAt }).run();
    const photos = database.getClient().select().from(photoMeals).all();
    database.close();
    database = openApplicationDatabase({ databasePath, migrationsFolder: path.resolve("drizzle") });
    const entries = new FoodEntryService(database.getClient(), new FoodCatalog([]), () => new Date("2026-09-08T12:00:00Z"));
    expect(database.getClient().select().from(photoMeals).all()).toEqual(photos);
    expect(history.map(old => entries.read(user.id, old.id))).toEqual(history);
    const updated = history.map(old => entries.update(user.id, old.id, { expectedUpdatedAt: old.updatedAt, foodLogDate: old.foodLogDate, name: `Edited ${old.name}`, quantity: "2", selectedMeasurementId: old.selectedMeasurementId }));
    expect(updated.map(entry => entry.energyMilliKcal)).toEqual([118000, 360000]);
    const copies = updated.map(entry => entries.copyToToday(user.id, entry.id, { foodLogDate: entry.foodLogDate, idempotencyKey: `copy:${entry.id}:migration-test` }));
    expect(copies.map(entry => [entry.authoritativeNutrition, entry.supportedMeasurements, entry.name, entry.energyMilliKcal])).toEqual(updated.map(entry => [entry.authoritativeNutrition, entry.supportedMeasurements, entry.name, entry.energyMilliKcal]));
    expect(database.getStatus()).toMatchObject({ schemaVersion: "20", foreignKeysEnabled: true });
  } finally { database.close(); await rm(directory, { recursive: true, force: true }); }
});
