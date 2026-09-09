import { mkdtemp, readFile, rm, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { afterEach, expect, test, vi } from "vitest";
import { CatalogManagement, type CatalogManagementOptions } from "../app/catalog-management/catalog-management.server";
import { LocalUsdaAdapter } from "../app/catalog/local-usda.server";
import { TestFoodCatalogProvider, TestOpenFoodFactsProvider } from "../app/catalog/test-fixture.server";
import { FoodCatalog } from "../app/catalog/food-catalog.server";
import { openApplicationDatabase } from "../app/database/database.server";
import { users, userPreferences } from "../app/database/schema.server";
import { FoodEntryService } from "../app/food-entry/food-entry.server";
import { foundationArchive, storedZip } from "./support/foundation-archive";
import { basicFoodsArchive } from "./support/basic-foods-archive";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function setup(options: Partial<CatalogManagementOptions> = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "local-usda-"));
  const database = openApplicationDatabase({ databasePath: path.join(directory, "app.sqlite"), migrationsFolder: path.resolve("drizzle") });
  const management = new CatalogManagement(database.getClient(), { directory, workerPath: path.resolve("app/catalog-management/import-worker.ts"), ...options });
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

test("a USDA replacement keeps the active generation usable until the complete replacement activates", async () => {
  const { management, catalog, entries, userId } = await setup();
  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(await foundationArchive()) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  const original = await catalog.getFood("usda-fdc", "748967");

  const replacement = await foundationArchive({
    "food.csv": "fdc_id,data_type,description,publication_date\n748967,foundation_food,Replacement egg,2026-08-01\n",
    "foundation_food.csv": "fdc_id,NDB_number,footnote\n748967,01123,Replacement release\n",
    "food_nutrient.csv": "id,fdc_id,nutrient_id,amount\n1,748967,2048,200\n",
    "food_portion.csv": "id,fdc_id,amount,measure_unit_id,gram_weight,modifier,portion_description\n",
  });
  const upload = new PassThrough();
  const receiving = management.submitArchive({ filename: "foundation.zip", stream: upload });
  upload.write(replacement.subarray(0, 20));
  await vi.waitFor(() => expect(management.read().job?.phase).toBe("uploading"));

  expect((await catalog.getFood("usda-fdc", "748967")).name).toBe(original.name);
  const saved = await entries.log(userId, {
    provider: original.provider,
    providerFoodId: original.providerFoodId,
    catalogGeneration: original.catalogGeneration,
    foodLogDate: "2026-09-06",
    idempotencyKey: "logged-during-replacement",
    selectedMeasurementId: "100g",
    quantity: "1",
  });
  expect(saved).toMatchObject({ name: original.name, energyMilliKcal: 147_000 });

  upload.end(replacement.subarray(20));
  await receiving;
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect(management.read()).toMatchObject({
    installed: { filename: "foundation.zip", foodCount: 1 },
    job: { phase: "succeeded", error: null },
  });
  expect(await catalog.getFood("usda-fdc", "748967")).toMatchObject({
    name: "Replacement egg",
    catalogGeneration: management.read().installed?.generation,
    nutritionPerAuthoritativeBase: { energyMilliKcal: { amount: 200, fixedPointMultiplier: 1000 } },
  });
  expect(entries.read(userId, saved.id)).toEqual(saved);
  const updated = entries.update(userId, saved.id, {
    expectedUpdatedAt: saved.updatedAt,
    foodLogDate: saved.foodLogDate,
    name: saved.name,
    quantity: "2",
    selectedMeasurementId: saved.selectedMeasurementId,
  });
  const copied = entries.copyToToday(userId, saved.id, {
    foodLogDate: saved.foodLogDate,
    idempotencyKey: `copy:${saved.id}:after-replacement`,
  });
  expect(updated).toMatchObject({ name: original.name, energyMilliKcal: 294_000, providerFoodId: original.providerFoodId });
  expect(copied).toMatchObject({ name: original.name, energyMilliKcal: 294_000, authoritativeNutrition: saved.authoritativeNutrition });
});

test("validation, import and indexing leave old USDA search, detail and logging available", async () => {
  const { management, catalog, entries, userId, database, directory } = await setup();
  const archive = await foundationArchive();
  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(archive) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  const original = await catalog.getFood("usda-fdc", "748967");

  const workerPath = path.join(directory, "controlled-foundation-worker.mjs");
  const importerUrl = pathToFileURL(path.resolve("app/catalog-management/foundation-import.server.ts")).href;
  await writeFile(workerPath, `
import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { parentPort, workerData } from "node:worker_threads";
const publish = message => parentPort.postMessage(message);
for (const phase of ["validating", "importing", "indexing"]) {
  publish({ progress: { phase } });
  while (!existsSync(path.join(workerData.directory, phase + ".release"))) await wait(5);
}
const { importFoundation } = await import(${JSON.stringify(importerUrl)});
await importFoundation(workerData, publish);
`);
  const replacement = new CatalogManagement(database.getClient(), { directory, workerPath });
  cleanups.unshift(() => replacement.shutdown());
  await replacement.submitArchive({ filename: "foundation.zip", stream: Readable.from(archive) });

  let loggedDuringImport: ReturnType<FoodEntryService["read"]> | undefined;
  for (const phase of ["validating", "importing", "indexing"] as const) {
    await vi.waitFor(() => expect(replacement.read().job?.phase).toBe(phase));
    expect((await catalog.search("usda-fdc", "egg"))[0]).toMatchObject({ providerFoodId: original.providerFoodId, catalogGeneration: original.catalogGeneration });
    expect(await catalog.getFood("usda-fdc", original.providerFoodId)).toMatchObject({ name: original.name, catalogGeneration: original.catalogGeneration });
    if (phase === "importing") {
      loggedDuringImport = await entries.log(userId, {
        provider: original.provider,
        providerFoodId: original.providerFoodId,
        catalogGeneration: original.catalogGeneration,
        foodLogDate: "2026-09-06",
        idempotencyKey: "old-generation-during-import",
        selectedMeasurementId: "100g",
        quantity: "1",
      });
    }
    await writeFile(path.join(directory, `${phase}.release`), "continue");
  }
  expect(loggedDuringImport).toMatchObject({ name: original.name, energyMilliKcal: 147_000 });
  await vi.waitFor(() => expect(replacement.read().busy).toBe(false));
  expect(replacement.read().installed?.generation).not.toBe(original.catalogGeneration);
});

test("saving a review from a retired generation reports staleness even when the replacement removed that FDC ID", async () => {
  const { management, catalog, entries, userId } = await setup();
  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(await foundationArchive()) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  const reviewed = await catalog.getFood("usda-fdc", "748967");

  await management.submitArchive({ filename: "replacement.zip", stream: Readable.from(await foundationArchive({
    "food.csv": "fdc_id,data_type,description,publication_date\n747447,foundation_food,Broccoli replacement,2026-08-01\n",
    "foundation_food.csv": "fdc_id,NDB_number,footnote\n747447,11090,Replacement release\n",
    "food_nutrient.csv": "id,fdc_id,nutrient_id,amount\n1,747447,2048,40\n",
    "food_portion.csv": "id,fdc_id,amount,measure_unit_id,gram_weight,modifier,portion_description\n",
  })) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));

  await expect(entries.log(userId, {
    provider: reviewed.provider,
    providerFoodId: reviewed.providerFoodId,
    catalogGeneration: reviewed.catalogGeneration,
    foodLogDate: "2026-09-06",
    idempotencyKey: "removed-stale-review",
    selectedMeasurementId: "100g",
    quantity: "1",
  })).rejects.toThrow("catalog changed");
});

test("upload metadata rejects invalid names and sizes before claiming installation", async () => {
  const { management } = await setup({ maxUploadBytes: 1000 });
  for (const filename of ["", "foundation.csv", "x".repeat(252) + ".zip"]) {
    await expect(management.submitArchive({ filename, stream: Readable.from("unused") })).rejects.toThrow("Choose a USDA .zip archive.");
    expect(management.read()).toEqual({ installed: null, job: null, busy: false });
  }
  for (const size of [0, -1, 1.5, NaN, Infinity, 1001]) {
    await expect(management.submitArchive({ filename: "foundation.zip", size, stream: Readable.from("unused") })).rejects.toThrow("Archive exceeds the configured upload limit or is empty.");
    expect(management.read().job).toBeNull();
  }
});

test.each([
  ["", undefined, "Upload was empty or incomplete. Upload the archive again."],
  ["short", 10, "Upload was empty or incomplete. Upload the archive again."],
  ["x".repeat(1001), undefined, "Archive exceeds the configured upload limit."],
] as const)("failed streamed upload is durable and does not install: %j", async (body, size, error) => {
  const { management } = await setup({ maxUploadBytes: 1000 });
  await management.submitArchive({ filename: "foundation.ZIP", stream: Readable.from(body), size });
  expect(management.read()).toMatchObject({ installed: null, busy: false, job: { phase: "failed", error } });
});

test("worker startup failure remains a durable retryable installation error", async () => {
  const { management } = await setup({ workerPath: path.resolve("reports/absent-usda-worker.ts") });
  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(await foundationArchive()) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect(management.read()).toMatchObject({ installed: null, job: { phase: "failed", error: "USDA import worker failed. Check server storage and retry the upload." } });
});

test.each([
  ["food.csv", "", "Missing CSV header in food.csv."],
  ["food.csv", "fdc_id,data_type,description,publication_date,description\n", "Incompatible Foundation schema in food.csv."],
  ["food.csv", "fdc_id,data_type,description,publication_date\n1,foundation_food,One,2026-01-01\n1,foundation_food,Two,2026-01-01\n", "Duplicate FDC ID in food.csv."],
  ["food.csv", "fdc_id,data_type,description,publication_date\n1,survey_fndds_food,Wrong,2026-01-01\n", "Wrong USDA dataset. Only a Foundation CSV archive is supported."],
  ["nutrient.csv", "id,name,unit_name\n2048,Energy,KCAL\n2048,Energy,KCAL\n", "Duplicate definition in nutrient.csv."],
  ["measure_unit.csv", "id,name\n1,cup\n1,glass\n", "Duplicate definition in measure_unit.csv."],
  ["foundation_food.csv", "fdc_id\n", "Incompatible Foundation schema in foundation_food.csv."],
  ["food_nutrient.csv", "id,fdc_id,nutrient_id\n", "Incompatible Foundation schema in food_nutrient.csv."],
  ["nutrient.csv", "id,name\n", "Incompatible Foundation schema in nutrient.csv."],
  ["food_portion.csv", "id,fdc_id,amount,measure_unit_id,modifier,portion_description\n", "Incompatible Foundation schema in food_portion.csv."],
  ["measure_unit.csv", "id\n", "Incompatible Foundation schema in measure_unit.csv."],
] as const)("invalid source table %s fails explicitly without activating", async (table, contents, error) => {
  const { management } = await setup();
  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(await foundationArchive({ [table]: contents })) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect(management.read()).toMatchObject({ installed: null, job: { phase: "failed", error } });
});

test.each([
  { name: "link.csv", body: "target", mode: 0xa000 },
  { name: "device.csv", body: "", mode: 0x2000 },
  { name: "secret.csv", body: "ciphertext", encrypted: true },
  { name: "bad\u001fname.csv", body: "text" },
])("unsafe ZIP entries report the archive failure: %j", async entry => {
  const { management } = await setup();
  await management.submitArchive({ filename: "unsafe.zip", stream: Readable.from(storedZip([entry])) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect(management.read()).toMatchObject({ installed: null, job: { phase: "failed", error: "ZIP contains unsafe paths, links or encrypted content." } });
});

test("duplicate paths, duplicate tables and split source directories have distinct failures", async () => {
  const { management } = await setup();
  const nutrient = await readFile("tests/fixtures/usda-foundation/nutrient.csv", "utf8");
  for (const [archive, error] of [
    [storedZip([{ name: "note.txt", body: "one" }, { name: "note.txt", body: "two" }]), "ZIP contains duplicate file paths."],
    [await foundationArchive({ "nested/nutrient.csv": nutrient }), "Duplicate Foundation table."],
    [await foundationArchive({ "nutrient.csv": null, "nested/nutrient.csv": nutrient }), "Foundation tables must occur in a single archive directory."],
    [await foundationArchive({ "nutrient.csv": null }), "Missing Foundation table: nutrient.csv. Choose the Foundation CSV ZIP with supporting data."],
  ] as const) {
    await management.submitArchive({ filename: "structure.zip", stream: Readable.from(archive) });
    await vi.waitFor(() => expect(management.read().busy).toBe(false));
    expect(management.read()).toMatchObject({ installed: null, job: { phase: "failed", error } });
  }
});

test("an archive accepts BOMs, blank rows, harmless extra files and explicit directory entries", async () => {
  const { management, catalog } = await setup();
  const food = await readFile("tests/fixtures/usda-foundation/food.csv", "utf8");
  await management.submitArchive({ filename: "compatible.zip", stream: Readable.from(await foundationArchive({
    "food.csv": "\uFEFF" + food + "\n\n", "read me.txt": "Source notes", "other/": "",
  })) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect(management.read().job?.phase).toBe("succeeded");
  expect((await catalog.search("usda-fdc", "egg"))[0].providerFoodId).toBe("748967");
});

test("expanded-size and entry-count limits reject an archive before activation", async () => {
  const { management } = await setup({ maxExpandedBytes: 100 });
  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(await foundationArchive()) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect(management.read().job?.error).toBe("Expanded archive exceeds the configured import limit.");
  const extra = Object.fromEntries(Array.from({ length: 201 }, (_, index) => [`note-${index}.txt`, ""]));
  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(await foundationArchive(extra)) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect(management.read()).toMatchObject({ installed: null, job: { phase: "failed", error: "ZIP contains too many files for a Foundation archive." } });
});

test("an archive at both size and entry-count limits remains installable", async () => {
  const folder = "tests/fixtures/usda-foundation";
  const tables = (await readdir(folder)).filter(name => name.endsWith(".csv"));
  const expandedBytes = (await Promise.all(tables.map(name => readFile(path.join(folder, name))))).reduce((sum, contents) => sum + contents.length, 0);
  const { management } = await setup({ maxExpandedBytes: expandedBytes });
  const extras = Object.fromEntries(Array.from({ length: 200 - tables.length }, (_, index) => [`note-${index}.txt`, ""]));
  await management.submitArchive({ filename: "boundary.zip", stream: Readable.from(await foundationArchive(extras)) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect(management.read()).toMatchObject({ installed: { foodCount: 4 }, job: { phase: "succeeded" } });
});

test.each(["food.csv", "food_nutrient.csv", "nutrient.csv", "food_portion.csv", "measure_unit.csv"])("empty %s still validates all required columns", async table => {
  const { management } = await setup();
  await management.submitArchive({ filename: "schema.zip", stream: Readable.from(await foundationArchive({ [table]: "unrecognized_column\n" })) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect(management.read()).toMatchObject({ installed: null, job: { phase: "failed", error: `Incompatible Foundation schema in ${table}.` } });
});

test("directories named like source tables are ignored and ordinary Unix file modes are accepted", async () => {
  const { management } = await setup();
  const folder = "tests/fixtures/usda-foundation";
  const files = await Promise.all((await readdir(folder)).filter(name => name.endsWith(".csv")).map(async name => ({ name: `source/${name}`, body: await readFile(path.join(folder, name), "utf8"), mode: 0x8000 })));
  const archive = storedZip([{ name: "source/", body: "", mode: 0x4000 }, { name: "food.csv/", body: "", mode: 0x4000 }, ...files]);
  await management.submitArchive({ filename: "modes.zip", stream: Readable.from(archive) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect(management.read()).toMatchObject({ installed: { foodCount: 4 }, job: { phase: "succeeded" } });
});

test.each([".", "sub/.", ".."])('unsafe directory-like member "%s" is rejected', async name => {
  const { management } = await setup();
  await management.submitArchive({ filename: "unsafe.zip", stream: Readable.from(storedZip([{ name, body: "" }])) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect(management.read()).toMatchObject({ installed: null, job: { phase: "failed" } });
});

test.each([
  ["2048", "KCAL", 120], ["2047", "KCAL", 130], ["1008", "KCAL", 140],
] as const)("USDA calorie field %s is independently usable without invented macros", async (id, unit, energy) => {
  const { management, catalog } = await setup();
  await management.submitArchive({ filename: "energy.zip", stream: Readable.from(await foundationArchive({
    "nutrient.csv": `id,name,unit_name\n${id},Energy,${unit}\n`,
    "food_nutrient.csv": `id,fdc_id,nutrient_id,amount\n1,748967,${id},${energy}\n`,
  })) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  const food = await catalog.getFood("usda-fdc", "748967");
  expect(food).toMatchObject({ isSelectable: true, nutritionPerAuthoritativeBase: { energyMilliKcal: { amount: energy, fixedPointMultiplier: 1000 }, proteinMilligrams: null, carbohydrateMilligrams: null } });
});

test("invalid values, duplicate nutrients and unsupported portions stay unknown and are counted", async () => {
  const { management, catalog } = await setup();
  await management.submitArchive({ filename: "quality.zip", stream: Readable.from(await foundationArchive({
    "nutrient.csv": "id,name,unit_name\n2048,Energy,KCAL\n1003,Protein,G\n1004,Fat,MG\n1005,Carbs,G\n1079,Fiber,G\n2000,Sugar,G\n1093,Sodium,MG\n",
    "food_nutrient.csv": "id,fdc_id,nutrient_id,amount\n1,748967,2048,0\n2,748967,1003,12\n3,748967,1003,13\n4,748967,1004,1\n5,748967,1005,1e100\n6,748967,1079,abc\n7,748967,2000,\n8,748967,1093,129\n",
    "food_portion.csv": "id,fdc_id,amount,measure_unit_id,gram_weight,modifier,portion_description\n1,748967,1,1,50,large,whole egg\n2,748967,1,999,50,,\n3,748967,1,1,-1,,\n1,748967,2,1,100,,\n",
    "measure_unit.csv": "id,name\n1,egg\n",
  })) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  const food = await catalog.getFood("usda-fdc", "748967");
  expect(food).toMatchObject({ isSelectable: true, nutritionPerAuthoritativeBase: { energyMilliKcal: { amount: 0, fixedPointMultiplier: 1000 }, proteinMilligrams: null, fatMilligrams: null, carbohydrateMilligrams: null, fiberMilligrams: null, sugarMilligrams: null, sodiumMilligrams: { amount: 129, fixedPointMultiplier: 1 } } });
  expect(food.measurements).toEqual([
    { id: "g", label: "1 g", unit: "g", baseQuantityMicrounits: 1_000_000 },
    { id: "100g", label: "100 g", unit: "g", baseQuantityMicrounits: 100_000_000 },
    { id: "portion:1", label: "1 egg, large, whole egg (50 g)", unit: "g", baseQuantityMicrounits: 50_000_000 },
  ]);
  expect(management.read().job?.exclusions).toMatchObject({ duplicate_nutrient: 1, invalid_nutrient: 3, invalid_portion: 3, food_without_calories: 3 });
});

test("a missing catalog, conflicting replacement, deliberate reimport and stale review have explicit outcomes", async () => {
  const { management, catalog, entries, userId } = await setup();
  await expect(catalog.search("usda-fdc", "egg")).rejects.toThrow("not configured");
  for (const id of ["0", "x748967", "748967x"]) await expect(catalog.getFood("usda-fdc", id)).rejects.toThrow("no longer available");
  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(await foundationArchive()) });
  await expect(management.submitArchive({ filename: "second.zip", stream: Readable.from("unused") })).rejects.toThrow("already running");
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  const firstGeneration = management.read().installed?.generation;
  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(await foundationArchive()) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect(management.read().installed?.generation).not.toBe(firstGeneration);
  const input = { provider: "usda-fdc", providerFoodId: "748967", foodLogDate: "2026-09-06", idempotencyKey: "stale-review-123", selectedMeasurementId: "100g", quantity: "1" };
  await expect(entries.log(userId, input)).rejects.toThrow("catalog changed");
  await expect(entries.log(userId, { ...input, catalogGeneration: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow("catalog changed");
  const egg = await catalog.getFood("usda-fdc", "748967");
  expect((await entries.log(userId, { ...input, catalogGeneration: egg.catalogGeneration })).energyMilliKcal).toBe(147_000);
});

test("local USDA search normalizes Unicode, bounds terms, and keeps punctuation out of FTS syntax", async () => {
  const { management, catalog } = await setup();
  for (const query of ["", " ", "a", " a ", "?!", "x".repeat(101)]) expect(await catalog.search("usda-fdc", query)).toEqual([]);
  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(await foundationArchive()) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect((await catalog.search("usda-fdc", "ｅｇｇ")).map(food => food.providerFoodId)).toEqual(["748967"]);
  expect((await catalog.search("usda-fdc", "EG")).map(food => food.providerFoodId)).toEqual(["748967"]);
  expect((await catalog.search("usda-fdc", "egg" + " ".repeat(97))).map(food => food.providerFoodId)).toEqual(["748967"]);
  expect((await catalog.search("usda-fdc", "egg-Grade/A,Large.whole")).map(food => food.providerFoodId)).toEqual(["748967"]);
  expect((await catalog.search("usda-fdc", "egg egg egg egg egg egg egg egg nonexistent")).map(food => food.providerFoodId)).toEqual([]);
  expect(await catalog.search("usda-fdc", "egg OR broccoli")).toEqual([]);
  expect(await catalog.search("usda-fdc", "egg 999999")).toEqual([]);
  for (const id of ["0", "bad1", "1bad", "0748967", "9999999"]) await expect(catalog.getFood("usda-fdc", id)).rejects.toThrow("no longer available");
});

test("Spanish egg aliases find the original USDA egg record without confusing eggplant", async () => {
  const { management, catalog } = await setup();
  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(await foundationArchive()) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  const results = await catalog.search("usda-fdc", "HUÉVOS");
  expect(results[0]).toMatchObject({ providerFoodId: "748967", name: "Eggs, Grade A, Large, egg whole", isSelectable: true });
  expect(await catalog.getFood("usda-fdc", results[0].providerFoodId)).toMatchObject({ originalName: "Eggs, Grade A, Large, egg whole", providerPublishedDate: "2019-12-16" });
  expect((await catalog.search("usda-fdc", "Eggs, Grade A, Large, egg whole"))[0]?.providerFoodId).toBe("748967");
  expect((await catalog.search("usda-fdc", "eggs grade A"))[0]?.providerFoodId).toBe("748967");
});

test("basic-food names, aliases and prefixes rank useful foods above noisy partial matches", async () => {
  const { management, catalog } = await setup();
  await management.submitArchive({ filename: "basics.zip", stream: Readable.from(await basicFoodsArchive()) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  for (const [query, expectedName] of [
    ["tilapia", /^Fish, tilapia,/], ["TILÁP", /^Fish, tilapia,/],
    ["egg", /^Eggs,/], ["eggs", /^Eggs,/], ["huevo", /^Eggs,/], ["HUÉVOS", /^Eggs,/], ["hue", /^Eggs,/],
    ["broccoli", /^Broccoli,/], ["BROCC", /^Broccoli,/], ["brócoli", /^Broccoli,/],
    ["carrot", /^Carrots,/], ["carrots", /^Carrots,/], ["zanahorias", /^Carrots,/],
    ["spinach", /^Spinach$/], ["espinacas", /^Spinach/],
    ["tomato", /^Tomatoes,/], ["tomates", /^Tomatoes,/], ["lechuga", /^Lettuce,/], ["calabacín", /^Squash, summer, green, zucchini,/],
    ["epinard", /^Épinard,/],
  ] as const) {
    const results = await catalog.search("usda-fdc", query);
    expect(results[0]?.name, query).toMatch(expectedName);
    expect(results[0]?.isSelectable, query).toBe(true);
    expect(results.length).toBeLessThanOrEqual(25);
  }
  const eggs = await catalog.search("usda-fdc", "huevos");
  expect(eggs.map(food => food.name)).not.toContain("Eggplant, raw");
  expect(eggs.map(food => food.name)).not.toContain("Egg substitute, liquid");
  expect(eggs.filter(food => food.name === "Eggs, whole, raw")[0].providerFoodId).toBe("998");
  expect(await catalog.search("usda-fdc", "huevos")).toEqual(eggs);
});

test("exact names and aliases outrank repeated-keyword partial matches", async () => {
  const { management, catalog } = await setup();
  await management.submitArchive({ filename: "ranking.zip", stream: Readable.from(await foundationArchive({
    "food.csv": 'fdc_id,data_type,description,publication_date\n1,foundation_food,Spinach,2019-01-01\n2,foundation_food,"Spinach, spinach, spinach, spinach, raw",2026-01-01\n3,foundation_food,Spinach spinach spinach spinach soup,2026-01-01\n4,foundation_food,Spinach rawhide spinach rawhide spinach rawhide,2026-01-01\n5,foundation_food,Spinach raw,2010-01-01\n',
    "food_nutrient.csv": "id,fdc_id,nutrient_id,amount\n1,1,2048,23\n2,2,2048,23\n3,3,2048,100\n4,4,2048,100\n5,5,2048,23\n",
  })) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  const names = (await catalog.search("usda-fdc", "spinach")).map(food => food.providerFoodId);
  expect(names).toEqual(expect.arrayContaining(["1", "2", "3"]));
  expect(names[0]).toBe("1");
  expect(names.indexOf("2")).toBeLessThan(names.indexOf("3"));
  const prefixes = (await catalog.search("usda-fdc", "spin")).map(food => food.providerFoodId);
  expect(prefixes).toEqual(expect.arrayContaining(["2", "3"]));
  expect(prefixes.indexOf("2")).toBeLessThan(prefixes.indexOf("3"));
  const words = (await catalog.search("usda-fdc", "spinach raw")).map(food => food.providerFoodId);
  expect(words).toEqual(expect.arrayContaining(["2", "4", "5"]));
  expect(words[0]).toBe("5");
  expect(words.indexOf("2")).toBeLessThan(words.indexOf("4"));
  expect(words).toContain("4");
});

test("new and restored name-only generations resolve the same basic-food aliases without rewriting source data", async () => {
  const names = ["Egg, raw", "Eggs, raw", "Fish, tilapia, raw", "Tilapia, raw", "Broccoli, raw", "Carrot, raw", "Carrots, raw", "Spinach, raw", "Tomato, raw", "Tomatoes, raw", "Lettuce, raw", "Zucchini, raw", "Squash, summer, zucchini, raw", "Squash, summer, green, zucchini, raw", "Squash, winter, zucchini", "Peas, summer, zucchini", "Eggplant, raw", "Eggs, Grade AAA, whole", "Eggs, Grade A, whole"];
  const archive = await foundationArchive({
    "food.csv": "fdc_id,data_type,description,publication_date\n" + names.map((name, index) => `${index + 1},foundation_food,"${name}",2026-01-01`).join("\n") + "\n",
    "food_nutrient.csv": "id,fdc_id,nutrient_id,amount\n" + names.map((_, index) => `${index + 1},${index + 1},2048,100`).join("\n") + "\n",
  });
  for (const workerPath of ["app/catalog-management/import-worker.ts", "tests/support/restored-usda-worker.mjs"]) {
    const { management, catalog, directory } = await setup({ workerPath: path.resolve(workerPath) });
    await management.submitArchive({ filename: "compatible.zip", stream: Readable.from(archive) });
    await vi.waitFor(() => expect(management.read().busy).toBe(false));
    const filename = path.join(directory, `${management.read().installed!.generation}.sqlite`);
    const before = await readFile(filename);
    for (const [aliases, ids] of [
      [["egg", "eggs", "huevo", "huevos", "hue"], ["1", "2", "18", "19"]],
      [["tilapia", "tilapias", "tilap"], ["3", "4"]],
      [["broccoli", "brócoli", "bróc"], ["5"]],
      [["carrot", "carrots", "zanahoria", "zanahorias", "zana"], ["6", "7"]],
      [["spinach", "espinaca", "espinacas", "esp"], ["8"]],
      [["tomato", "tomatoes", "tomate", "tomates", "toma"], ["9", "10"]],
      [["lettuce", "lettuces", "lechuga", "lechugas", "lech"], ["11"]],
      [["zucchini", "zucchinis", "calabacín", "calabacines", "calab"], ["12", "13", "14"]],
    ]) {
      for (const query of aliases) {
        const results = (await catalog.search("usda-fdc", query)).map(food => food.providerFoodId);
        expect(results, query).toEqual(expect.arrayContaining(ids));
      }
    }
    for (const query of ["calabacín", "calabacines", "calab"]) expect(await catalog.search("usda-fdc", query), query).toHaveLength(3);
    for (const query of ["huevo", "huevos"]) expect(await catalog.search("usda-fdc", query), query).toHaveLength(4);
    expect((await catalog.search("usda-fdc", "eggs grade A")).map(food => food.providerFoodId)).toEqual(["19"]);
    expect(await catalog.search("usda-fdc", "calabacín winter")).toEqual([]);
    expect(await catalog.search("usda-fdc", "huevos plant")).toEqual([]);
    expect(await readFile(filename)).toEqual(before);
  }
});

test("a completed installation persists archive provenance and removes temporary source files", async () => {
  const archive = await foundationArchive();
  const { management, directory } = await setup({ maxUploadBytes: archive.length });
  const filename = "f".repeat(251) + ".ZIP";
  const started = Date.now();
  await management.submitArchive({ filename, stream: Readable.from(archive), size: archive.length });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  const state = management.read();
  expect(state.installed).toMatchObject({ filename, sha256: createHash("sha256").update(archive).digest("hex"), foodCount: 4, publicationDateRange: { earliest: "2019-04-01", latest: "2026-04-30" } });
  expect(state.job).toMatchObject({ filename, receivedBytes: archive.length, phase: "succeeded", processedRecords: 318 });
  expect(Date.parse(state.installed!.installedAt)).toBeGreaterThanOrEqual(started);
  expect(Date.parse(state.job!.updatedAt)).toBeGreaterThanOrEqual(Date.parse(state.job!.startedAt));
  expect((await readdir(directory)).filter(name => name.startsWith(state.job!.id))).toEqual([`${state.job!.id}.sqlite`]);
  expect((await stat(path.join(directory, `${state.job!.id}.sqlite`))).mode & 0o777).toBe(0o444);
});

test("source portions preserve trimmed labels, reject undetermined units, and bound label and option counts", async () => {
  const { management, catalog } = await setup();
  const rows = [
    "1,748967,1,1,50, large , whole egg ",
    "2,748967,1,1,0.1234567,,",
    "3,748967,1,2,50,,",
    `4,748967,1,1,50,${"x".repeat(186)},`,
    `5,748967,1,1,50,${"x".repeat(187)},`,
    "6,999999999,1,1,50,,",
    ...Array.from({ length: 498 }, (_, index) => `${100 + index},748967,1,1,50,,`),
  ];
  await management.submitArchive({ filename: "portions.zip", stream: Readable.from(await foundationArchive({
    "food_portion.csv": "id,fdc_id,amount,measure_unit_id,gram_weight,modifier,portion_description\n" + rows.join("\n") + "\n",
    "measure_unit.csv": "id,name\n1, egg \n2,undetermined\n",
  })) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  const food = await catalog.getFood("usda-fdc", "748967");
  expect(food.measurements).toHaveLength(502);
  expect(food.measurements.slice(2, 5)).toEqual([
    { id: "portion:1", label: "1 egg, large, whole egg (50 g)", unit: "g", baseQuantityMicrounits: 50_000_000 },
    { id: "portion:2", label: "1 egg (0.123457 g)", unit: "g", baseQuantityMicrounits: 123457 },
    { id: "portion:4", label: `1 egg, ${"x".repeat(186)} (50 g)`, unit: "g", baseQuantityMicrounits: 50_000_000 },
  ]);
  expect(food.measurements.map(measurement => measurement.id)).not.toContain("portion:5");
  expect(food.measurements.at(-1)?.id).toBe("portion:596");
  expect(management.read().job?.exclusions.invalid_portion).toBe(3);
});

test("the Foundation record bound rejects an oversized dataset without installing a partial generation", async () => {
  const { management } = await setup();
  const rows = Array.from({ length: 100001 }, (_, index) => `${index + 1},foundation_food,Food,2026-01-01`).join("\n");
  await management.submitArchive({ filename: "too-many.zip", stream: Readable.from(await foundationArchive({ "food.csv": "fdc_id,data_type,description,publication_date\n" + rows + "\n" })) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false), { timeout: 10000 });
  expect(management.read()).toMatchObject({ installed: null, job: { phase: "failed", error: "Foundation record limit exceeded.", processedRecords: 100001 } });
});

test("shutdown cancels an incomplete upload and removes its private temporary file", async () => {
  const { management, directory } = await setup();
  const input = new Readable({ read() {} });
  const upload = management.submitArchive({ filename: "/download/partial.zip", stream: input });
  input.push(Buffer.from("partial bytes"));
  await vi.waitFor(() => expect(management.read().job?.receivedBytes).toBe(13));
  const job = management.read().job!;
  expect(job).toMatchObject({ filename: "partial.zip", phase: "uploading", processedRecords: 0, error: null });
  expect((await stat(path.join(directory, `${job.id}.zip`))).mode & 0o777).toBe(0o600);
  await management.shutdown();
  await upload;
  expect(input.destroyed).toBe(true);
  expect(management.read()).toMatchObject({ installed: null, busy: false, job: { phase: "failed", error: "USDA upload failed. Check available disk space and upload the archive again." } });
  expect((await readdir(directory)).filter(name => name.startsWith(job.id))).toEqual([]);
});

test("upload progress reports bytes while throttling durable writes to more than 250 milliseconds", async () => {
  const { management } = await setup();
  let now = 1000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const input = new Readable({ read() {} });
  const upload = management.submitArchive({ filename: "progress.zip", stream: input });
  input.push(Buffer.from("a"));
  await vi.waitFor(() => expect(management.read().job?.receivedBytes).toBe(1));
  for (const [time, chunk, expectedBytes] of [[1250, "bb", 1], [1251, "ccc", 6], [1300, "dddd", 6]] as const) {
    now = time; input.push(Buffer.from(chunk));
    await vi.waitFor(() => expect(input.readableLength).toBe(0));
    expect(management.read().job?.receivedBytes).toBe(expectedBytes);
  }
  input.push(null); await upload;
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect(management.read().job?.receivedBytes).toBe(10);
});

test("restart marks an abandoned operation interrupted and removes its incomplete generation", async () => {
  const { management, database, directory } = await setup();
  const input = new Readable({ read() {} });
  const upload = management.submitArchive({ filename: "abandoned.zip", stream: input });
  input.push(Buffer.from("partial"));
  await vi.waitFor(() => expect(management.read().job?.receivedBytes).toBe(7));
  const id = management.read().job!.id;
  await writeFile(path.join(directory, `${id}.sqlite`), "unfinished generation");
  await writeFile(path.join(directory, `${id}.sqlite-journal`), "unfinished journal");
  await mkdir(path.join(directory, `${id}.staging`));
  await writeFile(path.join(directory, `${id}.staging`, "food.csv"), "partial source");
  const restarted = new CatalogManagement(database.getClient(), { directory, workerPath: path.resolve("app/catalog-management/import-worker.ts") });
  expect(restarted.read()).toMatchObject({ installed: null, busy: false, job: { phase: "interrupted", error: "USDA installation was interrupted by a server restart. Upload the archive again." } });
  await vi.waitFor(async () => expect((await readdir(directory)).filter(name => name.startsWith(id))).toEqual([]));
  await management.shutdown(); await upload; await restarted.shutdown();
});

test.each([
  ["process.exit(0)", "USDA import stopped before completion. Upload the archive again."],
  ["parentPort.postMessage({result:{foodCount:1,publicationDateRange:{earliest:'2026-01-01',latest:'2026-01-01'}}})", "USDA activation failed. Check server storage and retry the upload."],
  ["parentPort.postMessage({result:{foodCount:1}}); process.exitCode=1", "USDA import stopped before completion. Upload the archive again."],
])("an incomplete worker outcome remains retryable and never activates: %s", async (behavior, error) => {
  const workerDirectory = await mkdtemp(path.join(tmpdir(), "usda-worker-failure-"));
  cleanups.push(() => rm(workerDirectory, { recursive: true, force: true }));
  const workerPath = path.join(workerDirectory, "worker.mjs");
  await writeFile(workerPath, `import {parentPort} from 'node:worker_threads'; ${behavior}`);
  const { management, directory } = await setup({ workerPath });
  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(await foundationArchive()) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect(management.read()).toMatchObject({ installed: null, job: { phase: "failed", error } });
  expect((await readdir(directory)).filter(name => name.startsWith(management.read().job!.id))).toEqual([]);
});

test("local lookup accepts bounded queries and rejects invalid or absent source identities", async () => {
  const { management, catalog } = await setup();
  await management.submitArchive({ filename: "basics.zip", stream: Readable.from(await basicFoodsArchive()) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  for (const query of ["eg", "egg " + " ".repeat(96), "egg egg egg egg egg egg egg egg"]) expect((await catalog.search("usda-fdc", query)).length).toBeGreaterThan(0);
  for (const query of ["egg " + " ".repeat(97), "egg egg egg egg egg egg egg egg egg", "a a a", "a ", "  "]) expect(await catalog.search("usda-fdc", query)).toEqual([]);
  for (const id of ["0", "01", "-1", "x748967", "748967x", "1.5", "1e3", "0x10", "999999999"])
    await expect(catalog.getFood("usda-fdc", id)).rejects.toThrow("no longer available");
});

test("numeric source syntax is explicit and invalid identity rows never become selectable", async () => {
  const { management, catalog } = await setup();
  const original = await readFile("tests/fixtures/usda-foundation/food.csv", "utf8");
  const invalid = ["1e3", "0x10", " 12", "12 ", "9007199254740993"].map(id => `"${id}",foundation_food,Invalid identity,1,2026-01-01`).join("\n");
  await management.submitArchive({ filename: "numbers.zip", stream: Readable.from(await foundationArchive({
    "food.csv": original + invalid + '\n1,foundation_food," ",1,2026-01-01\n2,foundation_food,Bad date,1,not-a-date\n3,market_acquisition,Research,1,2026-01-01\n4,agricultural_acquisition,Research,1,2026-01-01\n5,sub_sample_food,Research,1,2026-01-01\n',
    "foundation_food.csv": "fdc_id,NDB_number\n748967,1234\ninvalid,5678\n",
    "nutrient.csv": "id,name,unit_name\n2048,Energy,KCAL\n1003,Protein, g \n1004,Fat,G\n1005,Carbs,G\n1079,Fiber,G\n2000,Sugar,G\n1093,Sodium,MG\n",
    "food_nutrient.csv": "id,fdc_id,nutrient_id,amount\n1,748967,2048, 1.20e+2 \n2,748967,1003,.25\n3,748967,1004,1e-2\n4,748967,1005,3E1\n5,748967,1079,1e+01\n6,748967,2000,0.0\n7,748967,1093,0x10\n",
  })) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect(management.read()).toMatchObject({ installed: { foodCount: 4, publicationDateRange: { earliest: "2019-04-01", latest: "2026-04-30" } }, job: { exclusions: { invalid_food_record: 7, invalid_subtype_record: 1, research_record: 4, invalid_nutrient: 1 } } });
  const food = await catalog.getFood("usda-fdc", "748967");
  expect(food.nutritionPerAuthoritativeBase).toEqual({
    energyMilliKcal: { amount: 120, fixedPointMultiplier: 1000 }, proteinMilligrams: { amount: 0.25, fixedPointMultiplier: 1000 },
    fatMilligrams: { amount: 0.01, fixedPointMultiplier: 1000 }, carbohydrateMilligrams: { amount: 30, fixedPointMultiplier: 1000 },
    fiberMilligrams: { amount: 10, fixedPointMultiplier: 1000 }, sugarMilligrams: { amount: 0, fixedPointMultiplier: 1000 }, sodiumMilligrams: null,
  });
  expect(food).toMatchObject({ provider: "usda-fdc", dataType: "Foundation", name: "Eggs, Grade A, Large, egg whole", originalName: "Eggs, Grade A, Large, egg whole", providerPublishedDate: "2019-12-16", authoritativeBaseUnit: "g", authoritativeBaseQuantityMicrounits: 100_000_000, measurementSummary: "100 g" });
});

test("import normalizes source descriptions, orders release dates, and counts missing and unsafe nutrient values", async () => {
  const { management, catalog } = await setup();
  await management.submitArchive({ filename: "quality.zip", stream: Readable.from(await foundationArchive({
    "food.csv": 'fdc_id,data_type,description,publication_date\n1,foundation_food,Too much energy,2026-01-01\n2,foundation_food,"  E\u0301pinard, raw  ",2019-01-01\n3,foundation_food,Food,2022-01-01\n',
    "foundation_food.csv": "fdc_id,NDB_number\n1,123\n2,456\ninvalid,789\n",
    "food_nutrient.csv": "id,fdc_id,nutrient_id,amount\n1,1,2048,1e10\n2,2,2048,23\n3,3,2048,100\n4,2,1003,   \n5,2,1003,12\n6,2,1004,1\n",
    "nutrient.csv": "id,name,unit_name\n2048,Energy,KCAL\n1003,Protein,G\n",
  })) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect(management.read()).toMatchObject({ installed: { publicationDateRange: { earliest: "2019-01-01", latest: "2026-01-01" } }, job: { exclusions: { invalid_nutrient: 2, duplicate_nutrient: 1, invalid_subtype_record: 1, food_without_calories: 1 } } });
  const food = await catalog.getFood("usda-fdc", "2");
  expect(food).toMatchObject({ name: "Épinard, raw", originalName: "Épinard, raw", nutritionPerAuthoritativeBase: { proteinMilligrams: null, fatMilligrams: null } });
});

test("literal punctuation and operators cannot broaden or break bounded local search", async () => {
  const { management, catalog } = await setup();
  await management.submitArchive({ filename: "basics.zip", stream: Readable.from(await basicFoodsArchive()) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  for (const query of ["", "a", "*", "\"", "---", "OR", "egg OR spinach", "NOT eggs", "NEAR(eggs spinach)", "name:egg", "egg ".repeat(9), "e".repeat(101)]) {
    expect(await catalog.search("usda-fdc", query), query).toEqual([]);
  }
  expect(await catalog.search("usda-fdc", '"huevos"*')).toEqual(await catalog.search("usda-fdc", "huevos"));
  expect((await catalog.search("usda-fdc", "huevos, cooked")).map(food => food.name)).toEqual(["Eggs, whole, cooked, scrambled"]);
  expect(await catalog.search("usda-fdc", "huevoss")).toEqual([]);
  expect((await catalog.search("usda-fdc", "eggplant"))[0].name).toBe("Eggplant, raw");
});

test("preparations remain distinct and gram-only results retain unknown nutrients through logging", async () => {
  const { management, catalog, entries, userId } = await setup();
  await management.submitArchive({ filename: "basics.zip", stream: Readable.from(await basicFoodsArchive()) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect((await catalog.search("usda-fdc", "tilapia")).map(food => food.name)).toEqual(expect.arrayContaining(["Fish, tilapia, raw", "Fish, tilapia, cooked, dry heat"]));
  expect((await catalog.search("usda-fdc", "broccoli")).slice(0, 4).map(food => food.name)).toEqual(expect.arrayContaining(["Broccoli, raw", "Broccoli, frozen, chopped, unprepared"]));
  const eggs = await catalog.search("usda-fdc", "huevos");
  expect(eggs.find(food => food.providerFoodId === "999")).toMatchObject({ isSelectable: false, measurementSummary: "Calories unavailable" });
  const cooked = eggs.find(food => food.providerFoodId === "102")!;
  const food = await catalog.getFood(cooked.provider, cooked.providerFoodId);
  expect(food.measurements.map(measurement => measurement.id)).toEqual(["g", "100g"]);
  const input = { provider: food.provider, providerFoodId: food.providerFoodId, catalogGeneration: food.catalogGeneration, foodLogDate: "2026-09-06", idempotencyKey: "cooked-egg-alias", selectedMeasurementId: "100g", quantity: "1.5" };
  const saved = await entries.log(userId, input);
  expect(saved).toMatchObject({ name: "Eggs, whole, cooked, scrambled", providerFoodId: "102", energyMilliKcal: 270_000, proteinMilligrams: null, fatMilligrams: null, carbohydrateMilligrams: null });
  await expect(entries.log(userId, { ...input, providerFoodId: "999", idempotencyKey: "missing-calories" })).rejects.toThrow("no usable nutrition");
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
  expect(management.read()).toMatchObject({ installed: null, job: { phase: "failed", error: "Foundation archive contains no foods with usable calories. Nothing was installed.", exclusions: { invalid_nutrient: 1 } } });
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
  expect(management.read()).toMatchObject({ installed: null, job: { phase: "interrupted", error: "USDA installation was interrupted by server shutdown. Upload the archive again." } });
  const restarted = new CatalogManagement(database.getClient(), { directory, workerPath: path.resolve("app/catalog-management/import-worker.ts") });
  await restarted.submitArchive({ filename: "retry.zip", stream: Readable.from(await foundationArchive()) });
  await vi.waitFor(() => expect(restarted.read().busy).toBe(false));
  expect(restarted.read().job?.phase).toBe("succeeded");
  const completed = restarted.read();
  const reopened = new CatalogManagement(database.getClient(), { directory, workerPath: path.resolve("app/catalog-management/import-worker.ts") });
  expect(reopened.read()).toEqual(completed);
  await reopened.shutdown();
  await restarted.shutdown();
});
