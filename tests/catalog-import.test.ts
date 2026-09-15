import { gunzipSync } from "node:zlib";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { importOff } from "../app/catalog-management/off-import.server";
import { importFoundation } from "../app/catalog-management/foundation-import.server";
import { readOffGenerationFood } from "../app/database/off-generation.server";
import { readUsdaGenerationFood, searchUsdaGeneration } from "../app/database/usda-generation.server";
import { foundationArchive } from "./support/foundation-archive";
import { offArchive, offProduct, offWithBasis } from "./support/off-archive";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

test("the OFF importer publishes a retrievable source-backed product and complete report", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "catalog-import-")); directories.push(directory);
  const archivePath = path.join(directory, "products.gz");
  await writeFile(archivePath, offArchive([offWithBasis("100ml")]));
  const messages: unknown[] = [];
  await importOff({ directory, archivePath, generation: "off", maxExpandedBytes: 10 * 1024 * 1024 }, message => messages.push(structuredClone(message)));
  expect(messages).toEqual([
    { progress: { phase: "validating", processedRecords: 0, importedRecords: 0, usableNutritionRecords: 0, rejectedRecords: 0, exclusions: {} } },
    { progress: { phase: "importing", processedRecords: 0, importedRecords: 0, usableNutritionRecords: 0, rejectedRecords: 0, exclusions: {} } },
    { progress: { processedRecords: 1, importedRecords: 1, usableNutritionRecords: 1, rejectedRecords: 0, exclusions: {} } },
    { result: { archiveFormat: "csv", expandedBytes: gunzipSync(offArchive([offWithBasis("100ml")])).length, foodCount: 1, publicationDateRange: { earliest: "", latest: "" }, sourceDateRange: { earliest: "2025-01-01T00:00:00.000Z", latest: "2025-01-01T00:00:00.000Z" } } },
  ]);
  expect(readOffGenerationFood(directory, "off", offProduct.code)).toMatchObject({
    name: 'Oats\twith "bran"', brand: "Example", marketCountry: "United States", barcode: "0012345678905",
    provider: "open-food-facts", providerFoodId: "0012345678905", catalogGeneration: "off",
    authoritativeBaseQuantityMicrounits: 100_000_000, authoritativeBaseUnit: "ml", isSelectable: true,
    nutritionPerAuthoritativeBase: { energyMilliKcal: { amount: 400, fixedPointMultiplier: 1000 }, sodiumMilligrams: { amount: 10, fixedPointMultiplier: 1 }, sugarMilligrams: null },
  });
});

test("the Foundation importer makes foods searchable with preserved source nutrition and portions", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "catalog-import-")); directories.push(directory);
  const archivePath = path.join(directory, "foundation.zip");
  await writeFile(archivePath, await foundationArchive());
  const messages: unknown[] = [];
  await importFoundation({ directory, archivePath, generation: "usda", maxExpandedBytes: 10 * 1024 * 1024 }, message => messages.push(structuredClone(message)));
  expect(messages.at(-1)).toEqual({ result: { foodCount: 4, publicationDateRange: { earliest: "2019-04-01", latest: "2026-04-30" } } });
  expect(searchUsdaGeneration(directory, "usda", '"egg"*', () => 0).map(food => food.providerFoodId)).toEqual(["748967"]);
  expect(readUsdaGenerationFood(directory, "usda", "748967")).toMatchObject({
    name: "Eggs, Grade A, Large, egg whole", provider: "usda-fdc", providerFoodId: "748967", catalogGeneration: "usda",
    authoritativeBaseQuantityMicrounits: 100_000_000, authoritativeBaseUnit: "g", isSelectable: true,
    measurements: [
      { id: "g", label: "1 g", unit: "g", baseQuantityMicrounits: 1_000_000 },
      { id: "100g", label: "100 g", unit: "g", baseQuantityMicrounits: 100_000_000 },
      { id: "portion:193781", label: "1 egg, whole without shell (50.3 g)", unit: "g", baseQuantityMicrounits: 50_300_000 },
    ],
  });
  expect(readUsdaGenerationFood(directory, "usda", "319874")).toBeUndefined();
});
