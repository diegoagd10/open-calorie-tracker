import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, expect, test, vi } from "vitest";
import { CatalogManagement } from "../app/catalog-management/catalog-management.server";
import { LocalUsdaAdapter } from "../app/catalog/local-usda.server";
import { TestFoodCatalogProvider, TestOpenFoodFactsProvider } from "../app/catalog/test-fixture.server";
import { FoodCatalog } from "../app/catalog/food-catalog.server";
import { openApplicationDatabase } from "../app/database/database.server";
import { users, userPreferences } from "../app/database/schema.server";
import { FoodEntryService } from "../app/food-entry/food-entry.server";
import { foundationArchive } from "./support/foundation-archive";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.unstubAllGlobals(); });
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), "local-usda-"));
  const database = openApplicationDatabase({ databasePath: path.join(directory, "app.sqlite"), migrationsFolder: path.resolve("drizzle") });
  const management = new CatalogManagement(database.getClient(), { directory, workerPath: path.resolve("app/catalog-management/import-worker.ts") });
  cleanups.push(async () => { await management.shutdown(); database.close(); await rm(directory, { recursive: true, force: true }); });
  const catalog = new FoodCatalog([{ provider: "usda-fdc", capability: "search", service: new LocalUsdaAdapter(management, directory) }]);
  const createdAt = "2026-01-01T00:00:00.000Z";
  const user = database.getClient().insert(users).values({ usernameNormalized: "local.member", createdAt }).returning().get();
  database.getClient().insert(userPreferences).values({ userId: user.id, timeZone: "UTC", displayUnits: "metric", createdAt, updatedAt: createdAt }).run();
  const entries = new FoodEntryService(database.getClient(), catalog, () => new Date("2026-09-07T12:00:00.000Z"));
  return { management, catalog, entries, userId: user.id, database, directory };
}

test("an installed real Foundation archive supports local search, source portions and saved nutrition", async () => {
  const { management, catalog, entries, userId } = await setup();
  const network = vi.fn(() => { throw new Error("Food API access is forbidden"); });
  vi.stubGlobal("fetch", network);
  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(await foundationArchive()) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false), { timeout: 10000 });
  expect(management.read().job).toMatchObject({ phase: "succeeded", error: null });
  expect(management.read()).toMatchObject({ installed: { foodCount: 4 }, job: { exclusions: { research_record: 1 } } });
  const results = await catalog.search("usda-fdc", "BROCC");
  expect(results.map(food => food.providerFoodId)).toEqual(["747447", "321900"]);
  const food = await catalog.getFood("usda-fdc", "747447");
  expect(food.catalogGeneration).toBe(management.read().installed?.generation);
  expect(food.measurements).toContainEqual({ id: "portion:187633", label: "1 cup, chopped (76 g)", unit: "g", baseQuantityMicrounits: 76_000_000 });
  const saved = await entries.log(userId, { provider: food.provider, providerFoodId: food.providerFoodId, catalogGeneration: food.catalogGeneration, foodLogDate: "2026-09-06", idempotencyKey: "imported-broccoli", selectedMeasurementId: "portion:187633", quantity: "2" });
  // USDA specific Atwater = 32 kcal/100g; two source cups = 152g.
  expect(saved).toMatchObject({ energyMilliKcal: 48_640, proteinMilligrams: 3_906, fatMilligrams: 517, carbohydrateMilligrams: 9_530, sodiumMilligrams: 55 });
  expect(network).not.toHaveBeenCalled();
});

test("a missing catalog, conflicting installation and stale review have explicit failures", async () => {
  const { management, catalog, entries, userId } = await setup();
  await expect(catalog.search("usda-fdc", "egg")).rejects.toThrow("not configured");
  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(await foundationArchive()) });
  await expect(management.submitArchive({ filename: "second.zip", stream: Readable.from("unused") })).rejects.toThrow("already running");
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  await expect(management.submitArchive({ filename: "second.zip", stream: Readable.from("unused") })).rejects.toThrow("replacement is not available");
  const input = { provider: "usda-fdc", providerFoodId: "748967", foodLogDate: "2026-09-06", idempotencyKey: "stale-review-123", selectedMeasurementId: "100g", quantity: "1" };
  await expect(entries.log(userId, input)).rejects.toThrow("catalog changed");
  await expect(entries.log(userId, { ...input, catalogGeneration: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow("catalog changed");
  const egg = await catalog.getFood("usda-fdc", "748967");
  expect((await entries.log(userId, { ...input, catalogGeneration: egg.catalogGeneration })).energyMilliKcal).toBe(147_000);
});

test.each([
  ["corrupt ZIP", null, "not a zip"],
  ["unsafe path", { "../escape.csv": "unsafe" }, null],
  ["missing table", { "nutrient.csv": null }, null],
  ["wrong schema", { "food.csv": "fdc_id,description\n1,Wrong\n" }, null],
  ["wrong dataset", { "food.csv": "fdc_id,data_type,description,publication_date\n1,branded_food,Wrong,2026-01-01\n" }, null],
  ["no usable foods", { "food_nutrient.csv": "id,fdc_id,nutrient_id,amount\n" }, null],
] as const)("%s leaves USDA uninstalled with a durable error and permits retry", async (_name, overrides, body) => {
  const { management, catalog } = await setup();
  await management.submitArchive({ filename: "bad.zip", stream: Readable.from(body ?? await foundationArchive(overrides ?? {})) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect(management.read()).toMatchObject({ installed: null, job: { phase: "failed" } });
  await expect(catalog.getFood("usda-fdc", "747447")).rejects.toThrow("not configured");
  await management.submitArchive({ filename: "retry.zip", stream: Readable.from(await foundationArchive()) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect(management.read().job?.phase).toBe("succeeded");
});

test("null, zero, invalid and unsupported nutrients survive a valid gram-only import", async () => {
  const { management, catalog, entries, userId } = await setup();
  const nutrient = "id,name,unit_name\n2048,Specific,KCAL\n2047,General,KCAL\n1008,Legacy,KCAL\n1003,Protein,G\n1004,Fat,G\n1005,Carbs,G\n1079,Fiber,G\n1093,Sodium,G\n2000,Sugar,G\n";
  const foodNutrients = "id,fdc_id,nutrient_id,amount\n1,748967,2048,NaN\n2,748967,2047,143\n3,748967,1008,148\n4,748967,1003,12.4\n5,748967,1004,-9\n6,748967,1005,Infinity\n7,748967,1079,0\n8,748967,1093,0.129\n9,748967,2000,\n10,748967,constructor,1\n11,748967,toString,1\n";
  await management.submitArchive({ filename: "units.zip", stream: Readable.from(await foundationArchive({ "nutrient.csv": nutrient, "food_nutrient.csv": foodNutrients, "food_portion.csv": "id,fdc_id,amount,measure_unit_id,gram_weight,modifier,portion_description\n1,748967,0,1000,100,,\n" })) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  const food = await catalog.getFood("usda-fdc", "748967");
  expect(food.measurements.map(value => value.id)).toEqual(["g", "100g"]);
  const saved = await entries.log(userId, { provider: food.provider, providerFoodId: food.providerFoodId, catalogGeneration: food.catalogGeneration, foodLogDate: "2026-09-06", idempotencyKey: "units-and-nulls", selectedMeasurementId: "100g", quantity: "2" });
  expect(saved).toMatchObject({ energyMilliKcal: 286_000, proteinMilligrams: 24_800, fatMilligrams: null, carbohydrateMilligrams: null, fiberMilligrams: 0, sodiumMilligrams: 258, sugarMilligrams: null });
  expect(management.read().job?.exclusions).toMatchObject({ invalid_nutrient: 3, invalid_portion: 1 });
});

test("a wrong calorie unit is rejected independently and a corrupt CRC never activates", async () => {
  const { management } = await setup();
  await management.submitArchive({ filename: "units.zip", stream: Readable.from(await foundationArchive({
    "nutrient.csv": "id,name,unit_name\n2048,Energy,MG\n",
    "food_nutrient.csv": "id,fdc_id,nutrient_id,amount\n1,748967,2048,147\n",
  })) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect(management.read()).toMatchObject({ installed: null, job: { phase: "failed", exclusions: { invalid_nutrient: 1 } } });
  const corrupt = await foundationArchive();
  const position = corrupt.indexOf(Buffer.from("Broccoli, raw"));
  corrupt[position] = 88;
  await management.submitArchive({ filename: "crc.zip", stream: Readable.from(corrupt) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect(management.read()).toMatchObject({ installed: null, job: { phase: "failed", error: "ZIP checksum failed. Download the archive again." } });
});


test("USDA and OFF history created before installation remains readable, editable and copyable without source lookup", async () => {
  const { management, entries, database, userId } = await setup();
  const formerCatalog = new FoodCatalog([
    { provider: "usda-fdc", capability: "search", service: new TestFoodCatalogProvider() },
    { provider: "open-food-facts", capability: "barcode", service: new TestOpenFoodFactsProvider() },
  ]);
  const formerEntries = new FoodEntryService(database.getClient(), formerCatalog, () => new Date("2026-09-07T12:00:00.000Z"));
  const oldUsda = await formerEntries.log(userId, { provider: "usda-fdc", providerFoodId: "1001", foodLogDate: "2026-09-06", idempotencyKey: "old-usda-snapshot", selectedMeasurementId: "base:g:100000000", quantity: "1" });
  const oldOff = await formerEntries.log(userId, { provider: "open-food-facts", providerFoodId: "0012345678905", foodLogDate: "2026-09-06", idempotencyKey: "old-off-snapshot", selectedMeasurementId: "serving", quantity: "1" });
  expect(entries.read(userId, oldUsda.id).energyMilliKcal).toBe(59_000);
  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(await foundationArchive()) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  // The current catalog has neither former source record nor an OFF registration.
  for (const old of [oldUsda, oldOff]) {
    expect(entries.read(userId, old.id)).toEqual(old);
    const updated = entries.update(userId, old.id, { expectedUpdatedAt: old.updatedAt, foodLogDate: old.foodLogDate, name: old.name, quantity: "2", selectedMeasurementId: old.selectedMeasurementId });
    const copied = entries.copyToToday(userId, old.id, { foodLogDate: old.foodLogDate, idempotencyKey: `copy:${old.id}:after-install` });
    expect(copied).toMatchObject({ energyMilliKcal: updated.energyMilliKcal, provider: old.provider, providerFoodId: old.providerFoodId, authoritativeNutrition: old.authoritativeNutrition });
  }
  expect(entries.read(userId, oldUsda.id).energyMilliKcal).toBe(118_000);
  expect(entries.read(userId, oldOff.id).energyMilliKcal).toBe(360_000);
});

test("shutdown records interrupted work and a fresh management instance can retry", async () => {
  const { management, database, directory } = await setup();
  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(await foundationArchive()) });
  await management.shutdown();
  expect(management.read()).toMatchObject({ installed: null, job: { phase: "interrupted" } });
  const restarted = new CatalogManagement(database.getClient(), { directory, workerPath: path.resolve("app/catalog-management/import-worker.ts") });
  await restarted.submitArchive({ filename: "retry.zip", stream: Readable.from(await foundationArchive()) });
  await vi.waitFor(() => expect(restarted.read().busy).toBe(false));
  expect(restarted.read().job?.phase).toBe("succeeded");
  await restarted.shutdown();
});
