import { gzipSync } from "node:zlib";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { afterEach, expect, test, vi } from "vitest";
import { CatalogManagement } from "../app/catalog-management/catalog-management.server";
import { LocalOpenFoodFactsAdapter } from "../app/catalog/local-off.server";
import { FoodCatalog } from "../app/catalog/food-catalog.server";
import { openApplicationDatabase } from "../app/database/database.server";
import { users, userPreferences } from "../app/database/schema.server";
import { FoodEntryService } from "../app/food-entry/food-entry.server";
import { foundationArchive } from "./support/foundation-archive";
import { LocalUsdaAdapter } from "../app/catalog/local-usda.server";
import { offArchive, offProduct, offWithBasis, offJsonlArchive } from "./support/off-archive";

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

test("OFF barcode lookup finds Premier Protein's zero-prefixed EAN using its printed UPC", async () => {
  const { management, catalog } = await setup();
  await install(management, offArchive([{
    ...offProduct,
    code: "0643843715887",
    product_name: "Chocolate Milkshake",
    brands: "premier protein",
  }]));
  await expect(catalog.lookupBarcode("open-food-facts", "0643843715887"))
    .resolves.toMatchObject({ providerFoodId: "0643843715887", name: "Chocolate Milkshake" });
  await expect(catalog.lookupBarcode("open-food-facts", "643843715887"))
    .resolves.toMatchObject({ providerFoodId: "0643843715887", name: "Chocolate Milkshake" });
  await expect(catalog.getFood("open-food-facts", "643843715887"))
    .rejects.toThrow("no longer available");
});

test.each(["643843715887", "0643843715887", "00643843715887"])(
  "OFF barcode lookup recognizes equivalent representations when %s is stored",
  async code => {
    const { management, catalog } = await setup();
    await install(management, offArchive([{ ...offProduct, code }]));
    for (const barcode of ["643843715887", "0643843715887", "00643843715887"]) {
      await expect(catalog.lookupBarcode("open-food-facts", barcode))
        .resolves.toMatchObject({ providerFoodId: code, barcode: code });
    }
  },
);

test("OFF barcode equivalence preserves exact matches, significant digits, and legacy manual identifiers", async () => {
  const { management, catalog } = await setup();
  await install(management, offArchive([
    { ...offProduct, code: "643843715887", product_name: "Exact UPC" },
    { ...offProduct, code: "0643843715887", product_name: "Exact EAN" },
    { ...offProduct, code: "10643843715884", product_name: "Different packaging" },
    { ...offProduct, code: "034000470694", product_name: "Legacy invalid check digit" },
    { ...offProduct, code: "1234567", product_name: "Legacy short code" },
  ]));
  await expect(catalog.lookupBarcode("open-food-facts", "643843715887"))
    .resolves.toMatchObject({ name: "Exact UPC" });
  await expect(catalog.lookupBarcode("open-food-facts", "0643843715887"))
    .resolves.toMatchObject({ name: "Exact EAN" });
  await expect(catalog.lookupBarcode("open-food-facts", "10643843715884"))
    .resolves.toMatchObject({ name: "Different packaging" });
  for (const barcode of ["034000470694", "1234567"]) {
    await expect(catalog.lookupBarcode("open-food-facts", barcode))
      .resolves.toMatchObject({ barcode });
  }
  for (const barcode of ["0034000470694", "643843715884", "01234567"]) {
    await expect(catalog.lookupBarcode("open-food-facts", barcode))
      .rejects.toThrow("no longer available");
  }
});

test("an equivalent UPC review retains source identity for saving and rejects a stale generation", async () => {
  const { management, catalog, entries, userId } = await setup();
  await install(management, offArchive([offWithBasis("serving", "0643843715887")]));
  const food = await catalog.lookupBarcode("open-food-facts", "643843715887");
  const input = {
    provider: food.provider,
    providerFoodId: food.providerFoodId,
    catalogGeneration: food.catalogGeneration,
    foodLogDate: "2026-09-06",
    idempotencyKey: "equivalent-upc",
    selectedMeasurementId: "serving",
    quantity: "1",
  };
  await expect(entries.log(userId, input)).resolves.toMatchObject({
    providerFoodId: "0643843715887",
    barcode: "0643843715887",
  });
  await install(management, offArchive([offWithBasis("serving", "0643843715887")]));
  await expect(catalog.lookupBarcode("open-food-facts", "643843715887", {
    requestId: "stale-equivalent-upc",
    reviewedCatalogGeneration: food.catalogGeneration,
  })).rejects.toThrow("catalog changed");
});

test("OFF installation preserves quoted names and leading zeros, retaining ambiguous products with a calculation reason", async () => {
  const { management, catalog, entries, userId } = await setup();
  const network = vi.fn(() => { throw new Error("Food API forbidden"); }); vi.stubGlobal("fetch", network);
  await install(management, offArchive([offProduct], ["bad\trow"]));
  expect(management.read()).toMatchObject({ installed: { foodCount: 1 }, job: { phase: "succeeded", importedRecords: 1, rejectedRecords: 1, exclusions: { row_width_mismatch: 1, ambiguous_nutrition_basis: 1 } } });
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

test("OFF replacement rejects a stale review and preserves the saved serving snapshot", async () => {
  const { management, catalog, entries, userId } = await setup();
  await install(management, offArchive([{ ...offWithBasis("100g"), product_name: "Original oats" }]));
  const reviewed = await catalog.getFood("open-food-facts", offProduct.code);
  const saved = await entries.log(userId, {
    provider: reviewed.provider,
    providerFoodId: reviewed.providerFoodId,
    catalogGeneration: reviewed.catalogGeneration,
    foodLogDate: "2026-09-06",
    idempotencyKey: "off-before-replacement",
    selectedMeasurementId: "100g",
    quantity: "1",
  });

  const replacementId = "0012345678906";
  await install(management, offArchive([{ ...offWithBasis("100g", replacementId), product_name: "Replacement oats" }]));

  await expect(entries.log(userId, {
    provider: reviewed.provider,
    providerFoodId: reviewed.providerFoodId,
    catalogGeneration: reviewed.catalogGeneration,
    foodLogDate: "2026-09-06",
    idempotencyKey: "stale-off-review",
    selectedMeasurementId: "100g",
    quantity: "1",
  })).rejects.toThrow("catalog changed");
  await expect(catalog.getFood("open-food-facts", replacementId)).resolves.toMatchObject({
    name: "Replacement oats",
    catalogGeneration: management.read().installed?.generation,
  });
  expect(entries.read(userId, saved.id)).toEqual(saved);
});

test("a public OFF read holds its generation until replacement handoff completes", async () => {
  const { management, catalog, directory } = await setup();
  await install(management, offArchive([{ ...offWithBasis("100g"), product_name: "Original oats" }]));
  const oldGeneration = management.read().installed!.generation;
  const lease = management.withActiveGeneration.bind(management);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let readerStarted = false;
  vi.spyOn(management, "withActiveGeneration").mockImplementation(read => lease(async generation => {
    if (generation === oldGeneration) {
      readerStarted = true;
      await held;
    }
    return read(generation);
  }));

  const oldRead = catalog.lookupBarcode("open-food-facts", offProduct.code);
  await vi.waitFor(() => expect(readerStarted).toBe(true));
  await management.submitArchive({
    filename: "replacement.csv.gz",
    stream: Readable.from(offArchive([{ ...offWithBasis("100g"), product_name: "Replacement oats" }])),
  });
  await vi.waitFor(() => {
    expect(management.read().installed?.generation).not.toBe(oldGeneration);
    expect(management.read().job?.phase).toBe("activating");
  });
  const newGeneration = management.read().installed!.generation;
  await expect(catalog.lookupBarcode("open-food-facts", offProduct.code)).resolves.toMatchObject({
    name: "Replacement oats",
    catalogGeneration: newGeneration,
  });
  await expect(stat(path.join(directory, `${oldGeneration}.sqlite`))).resolves.toBeDefined();

  release();
  await expect(oldRead).resolves.toMatchObject({ name: "Original oats", catalogGeneration: oldGeneration });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  await expect(stat(path.join(directory, `${oldGeneration}.sqlite`))).rejects.toMatchObject({ code: "ENOENT" });
});

test("OFF validation, import and indexing leave old product reads and USDA search available", async () => {
  const { management, database, directory } = await setup();
  const originalArchive = offArchive([{ ...offWithBasis("100g"), product_name: "Original oats" }]);
  await install(management, originalArchive);
  const originalGeneration = management.read().installed!.generation;
  const packaged = new LocalOpenFoodFactsAdapter(management, directory);
  const usda = new CatalogManagement(database.getClient(), { directory, workerPath: path.resolve("app/catalog-management/import-worker.ts") });
  cleanups.unshift(() => usda.shutdown());
  await usda.submitArchive({ filename: "foundation.zip", stream: Readable.from(await foundationArchive()) });
  await vi.waitFor(() => expect(usda.read().busy).toBe(false));
  const basic = new LocalUsdaAdapter(usda, directory);

  const workerPath = path.join(directory, "controlled-off-worker.mjs");
  const importerUrl = pathToFileURL(path.resolve("app/catalog-management/off-import.server.ts")).href;
  await writeFile(workerPath, `
import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { parentPort, workerData } from "node:worker_threads";
const publish = message => parentPort.postMessage(message);
for (const phase of ["validating", "importing", "indexing"]) {
  publish({ progress: { phase } });
  while (!existsSync(path.join(workerData.directory, "off-" + phase + ".release"))) await wait(5);
}
const { importOff } = await import(${JSON.stringify(importerUrl)});
await importOff(workerData, publish);
`);
  const replacement = new CatalogManagement(database.getClient(), {
    directory,
    provider: "open-food-facts",
    workerPath,
    maxUploadBytes: 1024 * 1024,
    maxExpandedBytes: 10 * 1024 * 1024,
  });
  cleanups.unshift(() => replacement.shutdown());
  await replacement.submitArchive({
    filename: "replacement.csv.gz",
    stream: Readable.from(offArchive([{ ...offWithBasis("100g"), product_name: "Replacement oats" }])),
  });

  for (const phase of ["validating", "importing", "indexing"] as const) {
    await vi.waitFor(() => expect(replacement.read().job?.phase).toBe(phase));
    await expect(packaged.lookupBarcode(offProduct.code)).resolves.toMatchObject({ name: "Original oats", catalogGeneration: originalGeneration });
    await expect(packaged.search("original oats")).resolves.toMatchObject([{ name: "Original oats", catalogGeneration: originalGeneration }]);
    await expect(basic.search("egg")).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ provider: "usda-fdc" })]));
    await writeFile(path.join(directory, `off-${phase}.release`), "continue");
  }

  await vi.waitFor(() => expect(replacement.read().busy).toBe(false));
  await expect(packaged.lookupBarcode(offProduct.code)).resolves.toMatchObject({
    name: "Replacement oats",
    catalogGeneration: replacement.read().installed?.generation,
  });
  expect(usda.read().job?.phase).toBe("succeeded");
});

test("a slow failing OFF replacement does not prevent USDA replacement activation", async () => {
  const { management, database, directory } = await setup();
  await install(management, offArchive([{ ...offWithBasis("100g"), product_name: "Working oats" }]));
  const workingOff = management.read().installed!;
  const packaged = new LocalOpenFoodFactsAdapter(management, directory);
  const usda = new CatalogManagement(database.getClient(), { directory, workerPath: path.resolve("app/catalog-management/import-worker.ts") });
  cleanups.unshift(() => usda.shutdown());
  const foundation = await foundationArchive();
  await usda.submitArchive({ filename: "foundation.zip", stream: Readable.from(foundation) });
  await vi.waitFor(() => expect(usda.read().busy).toBe(false));
  const workingUsda = usda.read().installed!.generation;

  const workerPath = path.join(directory, "failing-off-worker.mjs");
  await writeFile(workerPath, `
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { parentPort, workerData } from "node:worker_threads";
writeFileSync(path.join(workerData.directory, workerData.generation + ".sqlite"), "incomplete");
parentPort.postMessage({ progress: { phase: "importing", processedRecords: 7 } });
while (!existsSync(path.join(workerData.directory, "fail-off.release"))) await wait(5);
parentPort.postMessage({ error: "OFF controlled validation failure" });
`);
  const failingOff = new CatalogManagement(database.getClient(), {
    directory,
    provider: "open-food-facts",
    workerPath,
    maxUploadBytes: 1024 * 1024,
    maxExpandedBytes: 10 * 1024 * 1024,
  });
  cleanups.unshift(() => failingOff.shutdown());
  await failingOff.submitArchive({ filename: "slow-replacement.gz", stream: Readable.from("controlled") });
  await vi.waitFor(() => expect(failingOff.read().job?.phase).toBe("importing"));

  await usda.submitArchive({ filename: "foundation-replacement.zip", stream: Readable.from(foundation) });
  await vi.waitFor(() => expect(usda.read().busy).toBe(false));
  expect(usda.read()).toMatchObject({ installed: { filename: "foundation-replacement.zip" }, job: { phase: "succeeded" } });
  expect(usda.read().installed?.generation).not.toBe(workingUsda);
  expect(failingOff.read()).toMatchObject({ installed: workingOff, busy: true, job: { phase: "importing" } });

  await writeFile(path.join(directory, "fail-off.release"), "continue");
  await vi.waitFor(() => expect(failingOff.read().busy).toBe(false));
  expect(failingOff.read()).toMatchObject({ installed: workingOff, job: { phase: "failed", error: "OFF controlled validation failure" } });
  await expect(packaged.lookupBarcode(offProduct.code)).resolves.toMatchObject({ name: "Working oats", catalogGeneration: workingOff.generation });
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
  const installed = retry.read().installed?.generation;
  await retry.submitArchive({ filename: "again.gz", stream: Readable.from(offArchive()) });
  await vi.waitFor(() => expect(retry.read().busy).toBe(false));
  expect(retry.read()).toMatchObject({ installed: { filename: "again.gz" }, job: { phase: "succeeded" } });
  expect(retry.read().installed?.generation).not.toBe(installed);
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


test("native JSONL serving saves declared totals and survives failed and successful generation replacement", async () => {
  const { management, catalog, entries, userId, directory } = await setup();
  const target = JSON.parse(await readFile("tests/fixtures/off-native-serving.json", "utf8")) as unknown;
  await install(management, offJsonlArchive([target]));
  const food = await catalog.lookupBarcode("open-food-facts", "643843715887");
  const input = { provider: food.provider, providerFoodId: food.providerFoodId, catalogGeneration: food.catalogGeneration, foodLogDate: "2026-09-06", idempotencyKey: "native-serving-save", selectedMeasurementId: "serving", quantity: "2" };
  const saved = await entries.log(userId, input);
  expect(saved).toMatchObject({ energyMilliKcal: 300_000, proteinMilligrams: 60_000, carbohydrateMilligrams: 8_000, fatMilligrams: 4_000, fiberMilligrams: 2_000, sugarMilligrams: 2_000, sodiumMilligrams: 340 });
  await expect(new LocalOpenFoodFactsAdapter(management, directory).search("premier protein")).resolves.toMatchObject([{ providerFoodId: food.providerFoodId }]);
  const installed = management.read().installed;
  expect(installed).toMatchObject({ archiveFormat: "jsonl" });
  await install(management, offJsonlArchive([target]).subarray(0, -8));
  expect(management.read()).toMatchObject({ installed, job: { phase: "failed" } });
  expect(entries.read(userId, saved.id)).toEqual(saved);
  await install(management, offArchive([offWithBasis("100g")]));
  await expect(entries.log(userId, { ...input, idempotencyKey: "stale-native-serving" })).rejects.toThrow("catalog changed");
  expect(entries.read(userId, saved.id)).toEqual(saved);
});
