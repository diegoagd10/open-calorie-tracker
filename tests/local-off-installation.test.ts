import { gzipSync } from "node:zlib";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, expect, test, vi } from "vitest";
import { CatalogManagement } from "../app/catalog-management/catalog-management.server";
import { LocalOpenFoodFactsAdapter } from "../app/catalog/local-off.server";
import { FoodCatalog } from "../app/catalog/food-catalog.server";
import { openApplicationDatabase } from "../app/database/database.server";
import { users, userPreferences } from "../app/database/schema.server";
import { FoodEntryService } from "../app/food-entry/food-entry.server";
import { foundationArchive } from "./support/foundation-archive";
import { LocalUsdaAdapter } from "../app/catalog/local-usda.server";
import { offArchive, offProduct, offWithBasis } from "./support/off-archive";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.unstubAllGlobals(); });
async function setup(options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "local-off-"));
  const database = openApplicationDatabase({ databasePath: path.join(directory, "app.sqlite"), migrationsFolder: path.resolve("drizzle") });
  const management = new CatalogManagement(database.getClient(), { directory, provider: "open-food-facts", workerPath: path.resolve("app/catalog-management/import-worker.ts"), maxUploadBytes: 1024 * 1024, maxExpandedBytes: 10 * 1024 * 1024, ...options });
  cleanups.push(async () => { await management.shutdown(); database.close(); await rm(directory, { recursive: true, force: true }); });
  const catalog = new FoodCatalog([{ provider: "open-food-facts", capability: "barcode", service: new LocalOpenFoodFactsAdapter(management, directory) }]);
  const createdAt = "2026-01-01T00:00:00.000Z";
  const user = database.getClient().insert(users).values({ usernameNormalized: "off.member", createdAt }).returning().get();
  database.getClient().insert(userPreferences).values({ userId: user.id, timeZone: "UTC", displayUnits: "metric", createdAt, updatedAt: createdAt }).run();
  const entries = new FoodEntryService(database.getClient(), catalog, () => new Date("2026-09-07T12:00:00.000Z"));
  return { management, catalog, entries, userId: user.id, database, directory };
}
async function install(management: CatalogManagement, archive = offArchive()) {
  await management.submitArchive({ filename: "products.csv.gz", stream: Readable.from(archive) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false), { timeout: 10000 });
}

test("OFF installation preserves quoted names and leading zeros, retaining ambiguous products with a calculation reason", async () => {
  const { management, catalog, entries, userId } = await setup();
  const network = vi.fn(() => { throw new Error("Food API forbidden"); }); vi.stubGlobal("fetch", network);
  await install(management, offArchive([offProduct], ["bad\trow"]));
  expect(management.read()).toMatchObject({ installed: { foodCount: 1 }, job: { phase: "succeeded", exclusions: { row_width_mismatch: 1, ambiguous_nutrition_basis: 1 } } });
  const food = await catalog.lookupBarcode("open-food-facts", offProduct.code);
  expect(food).toMatchObject({ barcode: "0012345678905", name: 'Oats\twith "bran"', isSelectable: false, calculationUnavailableReason: "ambiguous_nutrition_basis", measurements: [], providerModifiedDate: "2025-01-01T00:00:00.000Z" });
  await expect(entries.log(userId, { provider: food.provider, providerFoodId: food.providerFoodId, catalogGeneration: food.catalogGeneration, foodLogDate: "2026-09-06", idempotencyKey: "ambiguous-product", selectedMeasurementId: "g", quantity: "30" })).rejects.toThrow();
  expect(network).not.toHaveBeenCalled();
});

test("OFF search uses installed names, aliases, brands, accents, and prefixes", async () => {
  const { management, directory } = await setup();
  await install(management, offArchive([
    { ...offWithBasis("100g", "0012345678901"), product_name: "Crème brûlée", generic_name: "Dessert custard", brands: "Maison Test" },
    { ...offWithBasis("100g", "0012345678902"), product_name: "Crunch cereal", generic_name: "Breakfast flakes", brands: "Exact Brand" },
    { ...offWithBasis("100g", "0012345678903"), product_name: "Egg noodles", generic_name: "Pasta", brands: "Distractor Foods" },
  ]));
  const packaged = new LocalOpenFoodFactsAdapter(management, directory);

  await expect(packaged.search("  CREME  ")).resolves.toMatchObject([
    { name: "Crème brûlée", provider: "open-food-facts", providerFoodId: "0012345678901" },
  ]);
  await expect(packaged.search("cust")).resolves.toMatchObject([
    { name: "Crème brûlée" },
  ]);
  await expect(packaged.search("exact brand")).resolves.toMatchObject([
    { brand: "Exact Brand", name: "Crunch cereal" },
  ]);
  await expect(packaged.search("eggs")).resolves.toMatchObject([
    { name: "Egg noodles" },
  ]);
  await expect(packaged.search("a")).resolves.toEqual([]);
});

test("OFF search is bounded and treats query operators as ordinary words", async () => {
  const { management, directory } = await setup();
  const products = Array.from({ length: 30 }, (_, index) => ({
    ...offWithBasis("100g", String(1_000_000 + index)),
    product_name: `Egg snack ${index}`,
  }));
  products.push({ ...offWithBasis("100g", "0012345678901"), product_name: "NOT operator cereal" });
  await install(management, offArchive(products));
  const packaged = new LocalOpenFoodFactsAdapter(management, directory);

  await expect(packaged.search("egg")).resolves.toHaveLength(25);
  await expect(packaged.search("NOT operator")).resolves.toMatchObject([
    { name: "NOT operator cereal" },
  ]);
  await expect(packaged.search('" OR *')).resolves.toEqual([]);
});

test("source-backed mass nutrition scales to a logged and editable snapshot", async () => {
  const { management, catalog, entries, userId } = await setup();
  await install(management, offArchive([offWithBasis("100g")]));
  const food = await catalog.lookupBarcode("open-food-facts", offProduct.code);
  expect(food).toMatchObject({ isSelectable: true, authoritativeBaseUnit: "g", authoritativeBaseQuantityMicrounits: 100_000_000 });
  const saved = await entries.log(userId, { provider: food.provider, providerFoodId: food.providerFoodId, catalogGeneration: food.catalogGeneration, foodLogDate: "2026-09-06", idempotencyKey: "mass-off-product", selectedMeasurementId: "g", quantity: "25" });
  expect(saved).toMatchObject({ energyMilliKcal: 100_000, proteinMilligrams: 2500, carbohydrateMilligrams: 15000, fatMilligrams: 3000, fiberMilligrams: 0, sugarMilligrams: null, sodiumMilligrams: 3 });
  const updated = entries.update(userId, saved.id, { expectedUpdatedAt: saved.updatedAt, foodLogDate: saved.foodLogDate, name: saved.name, quantity: "50", selectedMeasurementId: "g" });
  expect(updated.energyMilliKcal).toBe(200_000);
});

test.each([
  ["100ml", "100ml", "2.5", "ml", 1_000_000, 25_000],
  ["serving", "serving", "0.5", "serving", 200_000, 5000],
] as const)("OFF %s authority scales without inferring density", async (per, measurement, quantity, unit, energy, protein) => {
  const { management, catalog, entries, userId } = await setup();
  await install(management, offArchive([offWithBasis(per)]));
  const food = await catalog.getFood("open-food-facts", offProduct.code);
  const input = { provider: food.provider, providerFoodId: food.providerFoodId, catalogGeneration: food.catalogGeneration, foodLogDate: "2026-09-06", idempotencyKey: `off-${per}-nutrition`, selectedMeasurementId: measurement, quantity };
  const saved = await entries.log(userId, input);
  expect(saved).toMatchObject({ authoritativeBaseUnit: unit, energyMilliKcal: energy, proteinMilligrams: protein, fiberMilligrams: 0, sugarMilligrams: null });
  await expect(entries.log(userId, { ...input, idempotencyKey: `wrong-off-${per}-units`, selectedMeasurementId: "g" })).rejects.toThrow("measurement is unavailable");
});

test("legacy explicit serving nutrition and supported kilojoules preserve zero and null", async () => {
  const { management, catalog, entries, userId } = await setup();
  await install(management, offArchive([{ ...offProduct, "energy-kj_serving": "418.4", proteins_serving: "0", fat_serving: "NaN", sodium_serving: "0.1" }]));
  const food = await catalog.getFood("open-food-facts", offProduct.code);
  const saved = await entries.log(userId, { provider: food.provider, providerFoodId: food.providerFoodId, catalogGeneration: food.catalogGeneration, foodLogDate: "2026-09-06", idempotencyKey: "off-kilojoules-serving", selectedMeasurementId: "serving", quantity: "2" });
  expect(saved).toMatchObject({ energyMilliKcal: 200_000, proteinMilligrams: 0, fatMilligrams: null, sodiumMilligrams: 200 });
});

test("missing calories, unknown units, conflicting bases, and no-nutrition records cannot be logged", async () => {
  const { management, catalog } = await setup();
  const prefix = "nutrition.input_sets.packaging.as_sold.100g.nutrients.";
  const products: Record<string, string>[] = [
    { ...offWithBasis("100g", "0012345678901"), [`${prefix}energy-kcal.value`]: "" },
    { ...offWithBasis("100g", "0012345678902"), [`${prefix}energy-kcal.unit`]: "constructor" },
    { ...offWithBasis("100g"), ...offWithBasis("100ml", "0012345678903") },
    { ...offWithBasis("100g", "0012345678904"), no_nutrition_data: "on" },
  ];
  await install(management, offArchive(products));
  const foods = await Promise.all(products.map(product => catalog.lookupBarcode("open-food-facts", product.code)));
  expect(foods.map(food => [food.isSelectable, food.calculationUnavailableReason])).toEqual([[false, "calories_unavailable"], [false, "calories_unavailable"], [false, "conflicting_nutrition_bases"], [false, "nutrition_not_provided"]]);
  await expect(catalog.lookupBarcode("open-food-facts", "https://example.com")).rejects.toThrow("no longer available");
  await expect(catalog.lookupBarcode("open-food-facts", "9999999999999")).rejects.toThrow("no longer available");
});

test("OFF supports only an explicitly normalized serving in its authoritative dimension and rejects stale review", async () => {
  const { management, catalog, entries, userId } = await setup();
  await install(management, offArchive([{ ...offWithBasis("100ml"), serving_quantity_unit: "ml", serving_quantity: "250" }]));
  const food = await catalog.getFood("open-food-facts", offProduct.code);
  expect(food.measurements).toContainEqual({ id: "serving", label: "1 serving (250 ml)", unit: "ml", baseQuantityMicrounits: 250_000_000 });
  const input = { provider: food.provider, providerFoodId: food.providerFoodId, foodLogDate: "2026-09-06", idempotencyKey: "off-source-serving", selectedMeasurementId: "serving", quantity: "1" };
  await expect(entries.log(userId, input)).rejects.toThrow("catalog changed");
  expect((await entries.log(userId, { ...input, catalogGeneration: food.catalogGeneration })).energyMilliKcal).toBe(1_000_000);
});

test.each([
  ["corrupt GZIP", Buffer.from("bad gzip"), "Corrupt OFF GZIP"],
  ["truncated GZIP", offArchive().subarray(0, -8), "Corrupt OFF GZIP"],
  ["incompatible schema", offArchive([{ code: "123", name: "Wrong columns" }]), "Incompatible OFF schema"],
  ["empty products", offArchive([offProduct]).subarray(0, 0), "empty or incomplete"],
] as const)("%s fails independently while USDA and saved Food Entries remain usable", async (_label, archive, message) => {
  const { management, database, directory, userId } = await setup();
  const usda = new CatalogManagement(database.getClient(), { directory, workerPath: path.resolve("app/catalog-management/import-worker.ts") });
  cleanups.unshift(() => usda.shutdown());
  const basic = new LocalUsdaAdapter(usda, directory);
  const entries = new FoodEntryService(database.getClient(), new FoodCatalog([{ provider: "usda-fdc", capability: "search", service: basic }]));
  await usda.submitArchive({ filename: "foundation.zip", stream: Readable.from(await foundationArchive()) });
  await vi.waitFor(() => expect(usda.read().busy).toBe(false));
  const food = await basic.getFood("748967");
  const saved = await entries.log(userId, { provider: food.provider, providerFoodId: food.providerFoodId, catalogGeneration: food.catalogGeneration, foodLogDate: "2026-09-06", idempotencyKey: "usda-before-off-import", selectedMeasurementId: "100g", quantity: "1" });
  const before = usda.read();
  await install(management, archive);
  expect(management.read()).toMatchObject({ installed: null, job: { phase: "failed" } });
  expect(management.read().job?.error).toContain(message);
  expect(usda.read()).toEqual(before);
  expect(await basic.getFood("748967")).toEqual(food);
  expect(entries.read(userId, saved.id)).toEqual(saved);
  await install(management);
  expect(management.read().job?.phase).toBe("succeeded");
});

test("resource limits reject uploads and expanded archives with actionable failures", async () => {
  const { management } = await setup({ maxUploadBytes: 10000, maxExpandedBytes: 200 });
  await expect(management.submitArchive({ filename: "oversized.gz", stream: Readable.from("unused"), size: 10001 })).rejects.toThrow("upload limit");
  await install(management);
  expect(management.read().job?.error).toContain("resource limit");
});

test("storage preflight, conflicts and shutdown preserve independent OFF job state", async () => {
  const { management, database, directory } = await setup({ maxExpandedBytes: Number.MAX_SAFE_INTEGER / 4 });
  await install(management);
  expect(management.read().job?.error).toContain("disk space");
  const retry = new CatalogManagement(database.getClient(), { provider: "open-food-facts", directory, workerPath: path.resolve("app/catalog-management/import-worker.ts"), maxUploadBytes: 10000, maxExpandedBytes: 1000000 });
  cleanups.unshift(() => retry.shutdown());
  await retry.submitArchive({ filename: "off.gz", stream: Readable.from(offArchive()) });
  await expect(retry.submitArchive({ filename: "again.gz", stream: Readable.from(offArchive()) })).rejects.toThrow("already running");
  await retry.shutdown();
  expect(retry.read().job?.phase).toBe("interrupted");
  await install(retry);
  expect(retry.read().job?.phase).toBe("succeeded");
  await expect(retry.submitArchive({ filename: "again.gz", stream: Readable.from(offArchive()) })).rejects.toThrow("replacement is not available");
});


test("the official daily export treats unescaped quotes as literal text, without consuming subsequent rows", async () => {
  const { management, catalog } = await setup();
  const source: Record<string, string> = { code: offProduct.code, url: "", creator: "", created_t: "", created_datetime: "", last_modified_t: "", last_modified_datetime: "", last_modified_by: "", last_updated_t: "", last_updated_datetime: "" };
  Object.assign(source, offProduct, { product_name: '"Oats with bran' });
  const header = Object.keys(source);
  const line = (row: typeof source) => header.map(key => row[key]).join("\t");
  await install(management, gzipSync([header.join("\t"), line(source), line({ ...source, code: "0012345678906", product_name: 'Cereal "quoted"' })].join("\n") + "\n"));
  expect(management.read().installed?.foodCount).toBe(2);
  expect((await catalog.lookupBarcode("open-food-facts", offProduct.code)).name).toBe('"Oats with bran');
  expect((await catalog.lookupBarcode("open-food-facts", "0012345678906")).name).toBe('Cereal "quoted"');
});
