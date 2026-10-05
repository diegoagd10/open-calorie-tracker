import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { importFoundation } from "../app/catalog-management/foundation-import.server";
import { readUsdaGenerationFood, searchUsdaGeneration } from "../app/database/usda-generation.server";
import { foundationArchive } from "./support/foundation-archive";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

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
