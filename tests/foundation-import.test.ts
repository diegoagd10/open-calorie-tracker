import { afterEach, expect, test } from "vitest";
import { runArchive } from "./support/catalog-import";
import { foundationArchive } from "./support/foundation-archive";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(cleanup => cleanup())); });
const install = async (overrides: Record<string, string | null> = {}, maxExpandedBytes = 10 * 1024 * 1024) => runArchive("usda", await foundationArchive({
  "food.csv": "fdc_id,data_type,description,food_category_id,publication_date\n1,foundation_food,Crème,1,2024-01-02\n",
  "food_category.csv": "id,code,description\n1,0100,Test category\n",
  "foundation_food.csv": "fdc_id,NDB_number\n99,1\n",
  "food_nutrient.csv": "id,fdc_id,nutrient_id,amount\n1,1,1008,100\n2,1,2047,110\n3,1,2048,120\n4,1,1003,1.2e1\n5,1,1004,0\n6,1,1005,30\n7,1,1079,4\n8,1,1093,0.05\n9,1,2000,5.5\n",
  "nutrient.csv": "id,name,unit_name\n1008,Energy,KCAL\n2047,General,KCAL\n2048,Specific,KCAL\n1003,Protein, g \n1004,Fat,G\n1005,Carbs,G\n1079,Fiber,G\n1093,Sodium,G\n2000,Sugar,G\n",
  "food_portion.csv": "id,fdc_id,amount,measure_unit_id,gram_weight,modifier,portion_description\n1,1,0.5,1,12.3456786, chopped , heaped \n",
  "measure_unit.csv": "id,name\n1, cup \n2,undetermined\n",
  ...overrides,
}), cleanup => cleanups.push(cleanup), { maxExpandedBytes });

test("Foundation uses specific Atwater energy, normalized source names and exact units without a subtype whitelist", async () => {
  const imported = await install();
  expect(imported.final.result).toEqual({ foodCount: 1, publicationDateRange: { earliest: "2024-01-02", latest: "2024-01-02" } });
  expect(imported.read("1")).toEqual({
    barcode: null, brand: null, dataType: "Foundation", isSelectable: true, measurementSummary: "100 g", name: "Crème", originalName: "Crème",
    provider: "usda-fdc", providerFoodId: "1", providerPublishedDate: "2024-01-02", providerModifiedDate: null, catalogGeneration: imported.options.generation,
    authoritativeBaseQuantityMicrounits: 100_000_000, authoritativeBaseUnit: "g", marketCountry: null,
    measurements: [{ id: "g", label: "1 g", unit: "g", baseQuantityMicrounits: 1_000_000 }, { id: "100g", label: "100 g", unit: "g", baseQuantityMicrounits: 100_000_000 }, { id: "portion:1", label: "0.5 cup, chopped, heaped (12.345679 g)", unit: "g", baseQuantityMicrounits: 12_345_679 }],
    nutritionPerAuthoritativeBase: { energyMilliKcal: { amount: 120, fixedPointMultiplier: 1000 }, proteinMilligrams: { amount: 12, fixedPointMultiplier: 1000 }, fatMilligrams: { amount: 0, fixedPointMultiplier: 1000 }, carbohydrateMilligrams: { amount: 30, fixedPointMultiplier: 1000 }, fiberMilligrams: { amount: 4, fixedPointMultiplier: 1000 }, sodiumMilligrams: { amount: 0.05, fixedPointMultiplier: 1000 }, sugarMilligrams: { amount: 5.5, fixedPointMultiplier: 1000 } },
  });
  expect(imported.search('"creme"*').map(food => food.providerFoodId)).toEqual(["1"]);
  expect(imported.read("99")).toBeUndefined();
  expect(imported.messages.filter(message => message.progress?.phase).map(message => message.progress?.phase)).toEqual(["validating", "importing", "indexing", "indexing"]);
  expect(imported.messages.at(-2)?.progress).toEqual({ phase: "indexing", processedRecords: 10, importedRecords: 1, rejectedRecords: 0, exclusions: {} });
});

test.each([
  ["1,1,1008,100\n2,1,2047,110\n", 110],
  ["1,1,1008,100\n2,1,2048,-1\n", 100],
  ["1,1,1008,0\n", 0],
  ["1,1,1008,100\n2,1,2047,110\n3,1,2048,120\n4,1,2048,130\n", 110],
] as const)("Foundation energy precedence for source rows %#", async (rows, energy) => {
  const imported = await install({ "food_nutrient.csv": `id,fdc_id,nutrient_id,amount\n${rows}` });
  expect(imported.read("1")).toMatchObject({ isSelectable: true, nutritionPerAuthoritativeBase: { energyMilliKcal: { amount: energy, fixedPointMultiplier: 1000 }, proteinMilligrams: null, fatMilligrams: null, carbohydrateMilligrams: null, fiberMilligrams: null, sugarMilligrams: null, sodiumMilligrams: null } });
});

test.each(["NaN", "Infinity", "-1", "+1", "0x10", "9007199255", "1e999", "", " "])("Foundation protein %s remains missing", async amount => {
  const imported = await install({ "food_nutrient.csv": `id,fdc_id,nutrient_id,amount\n1,1,1008,100\n2,1,1003,${amount}\n` });
  expect(imported.read("1")!.nutritionPerAuthoritativeBase.proteinMilligrams).toBeNull();
  expect(imported.messages.at(-2)?.progress?.exclusions).toEqual(amount.trim() ? { invalid_nutrient: 1 } : {});
});

test.each([[" .25 ", 0.25], ["1.", 1], ["1e+02", 100], ["1e-02", 0.01]] as const)("Foundation accepts supported numeric notation %s", async (amount, expected) => {
  const imported = await install({ "food_nutrient.csv": `id,fdc_id,nutrient_id,amount\n1,1,1008,100\n2,1,1003,${amount}\n` });
  expect(imported.read("1")!.nutritionPerAuthoritativeBase.proteinMilligrams).toEqual({ amount: expected, fixedPointMultiplier: 1000 });
});

test("Foundation emits progress while skipping a large run of research records", async () => {
  const research = Array.from({ length: 1999 }, (_, index) => `${index + 2},sample_food,Research,1,2024-01-01\n`).join("");
  const imported = await install({ "food.csv": "fdc_id,data_type,description,food_category_id,publication_date\n1,foundation_food,Food,1,2024-01-01\n" + research });
  expect(imported.messages.filter(message => message.progress?.phase === "importing").map(message => message.progress?.processedRecords)).toEqual([0, 2000]);
  expect(imported.messages.at(-2)?.progress).toEqual({ phase: "indexing", processedRecords: 2009, importedRecords: 1, rejectedRecords: 1999, exclusions: { research_record: 1999 } });
});

test.each(["bad1", "1bad", "01"])("Foundation rejects malformed source identifier %s", async id => {
  const imported = await install({ "food.csv": `fdc_id,data_type,description,food_category_id,publication_date\n1,foundation_food,Food,1,2024-01-01\n${id},foundation_food,Invalid,1,2024-01-01\n` });
  expect(imported.final.result?.foodCount).toBe(1);
  expect(imported.messages.at(-2)?.progress?.exclusions).toEqual({ invalid_food_record: 1 });
});

test("invalid nutrient IDs, duplicates, missing definitions and unrelated foods do not supply nutrients", async () => {
  const imported = await install({
    "food_nutrient.csv": "id,fdc_id,nutrient_id,amount\n1,1,1008,100\n0,1,1003,12\n2,1,1004,1\n3,1,1004,2\n4,1,1093,30\n5,1,1005,1\n6,99,1008,999\n7,1,constructor,900\n",
    "nutrient.csv": "id,name,unit_name\n1008,Calories,KCAL\n1003,Protein,G\n1004,Fat,G\n1093,Sodium,MG\n",
  });
  expect(imported.read("1")!.nutritionPerAuthoritativeBase).toEqual({ energyMilliKcal: { amount: 100, fixedPointMultiplier: 1000 }, proteinMilligrams: null, fatMilligrams: null, carbohydrateMilligrams: null, fiberMilligrams: null, sugarMilligrams: null, sodiumMilligrams: { amount: 30, fixedPointMultiplier: 1 } });
  expect(imported.messages.at(-2)?.progress?.exclusions).toEqual({ invalid_nutrient: 2, duplicate_nutrient: 1 });
});

test("research records, invalid foods and invalid subtype IDs are counted, while calorie-free foods remain available", async () => {
  const imported = await install({
    "food.csv": "fdc_id,data_type,description,food_category_id,publication_date\n1,foundation_food, valid ,1,2025-01-01\n2,foundation_food,No calories,1,2020-01-01\n3,agricultural_acquisition,Research,1,2020-01-01\n4,market_acquisition,Research,1,2020-01-01\n5,sample_food,Research,1,2020-01-01\n6,sub_sample_food,Research,1,2020-01-01\n0,foundation_food,Invalid ID,1,2020-01-01\n7,foundation_food, ,1,2020-01-01\n8,foundation_food,Invalid date,1,2020-02-30\n9007199254740992,foundation_food,Unsafe ID,1,2020-01-01\n",
    "foundation_food.csv": "fdc_id,NDB_number\n0,1\n",
  });
  expect(imported.final.result).toEqual({ foodCount: 2, publicationDateRange: { earliest: "2020-01-01", latest: "2025-01-01" } });
  expect(imported.read("1")?.name).toBe("valid");
  expect(imported.read("2")).toMatchObject({ isSelectable: false, measurementSummary: "Calories unavailable" });
  expect(imported.messages.at(-2)?.progress).toMatchObject({ importedRecords: 2, rejectedRecords: 8 });
  expect(imported.messages.at(-2)?.progress?.exclusions).toEqual({ research_record: 4, invalid_food_record: 4, invalid_subtype_record: 1, food_without_calories: 1 });
});

test("Foundation rejects invalid, duplicate and excessive portions but retains source qualifiers", async () => {
  const portions = [
    "1,1,1,1,50,,", "1,1,1,1,100,,", "2,1,0,1,50,,", "3,1,1,1,0,,", "4,1,1,2,50,,", "5,1,1,99,50,,", "6,1,1,1,0.0000001,,", "0,1,1,1,50,,", `7,1,1,1,50,${"a".repeat(201)},`, "8,99,1,1,50,,",
    ...Array.from({ length: 500 }, (_, index) => `${index + 10},1,1,1,50,,description`),
  ];
  const imported = await install({ "food_portion.csv": "id,fdc_id,amount,measure_unit_id,gram_weight,modifier,portion_description\n" + portions.join("\n") + "\n" });
  const measures = imported.read("1")!.measurements;
  expect(measures).toHaveLength(502);
  expect(measures[2]).toEqual({ id: "portion:1", label: "1 cup (50 g)", unit: "g", baseQuantityMicrounits: 50_000_000 });
  expect(measures.at(-1)).toEqual({ id: "portion:508", label: "1 cup, description (50 g)", unit: "g", baseQuantityMicrounits: 50_000_000 });
  expect(imported.messages.at(-2)?.progress?.exclusions).toEqual({ invalid_portion: 9 });
});

test.each([
  [{ "food.csv": "fdc_id,data_type,description,food_category_id,publication_date\n1,foundation_food,One,1,2024-01-01\n1,foundation_food,Duplicate,1,2024-01-01\n" }, "Duplicate FDC ID in food.csv."],
  [{ "food.csv": "fdc_id,data_type,description,food_category_id,publication_date\n1,branded_food,Wrong,1,2024-01-01\n" }, "Wrong USDA dataset. Only a Foundation CSV archive is supported."],
  [{ "nutrient.csv": "id,name,unit_name\n1008,Calories,KCAL\n1008,Again,KCAL\n" }, "Duplicate definition in nutrient.csv."],
  [{ "measure_unit.csv": "id,name\n1,cup\n1,again\n" }, "Duplicate definition in measure_unit.csv."],
  [{ "food_nutrient.csv": "id,fdc_id,nutrient_id,amount\n" }, "Foundation archive contains no foods with usable calories. Nothing was installed."],
  [{ "nutrient.csv": null }, "Missing Foundation table: nutrient.csv. Choose the Foundation CSV ZIP with supporting data."],
  [{ "food.csv": "" }, "Missing CSV header in food.csv."],
  [{ "food.csv": "fdc_id,fdc_id,description,food_category_id,publication_date\n" }, "Incompatible Foundation schema in food.csv."],
  [{ "food.csv": "fdc_id,description,food_category_id,publication_date\n" }, "Incompatible Foundation schema in food.csv."],
] as const)("Foundation rejects invalid source structure %#", async (overrides, error) => {
  const imported = await install(overrides);
  expect(imported.final.error).toBe(error);
  expect(typeof imported.final.progress?.processedRecords).toBe("number");
  expect(imported.final.progress?.exclusions).toBeDefined();
  expect(imported.messages.some(message => message.result)).toBe(false);
});

test("Foundation installs without food_category.csv and ignores food category references", async () => {
  const imported = await install({
    "food.csv": "fdc_id,data_type,description,food_category_id,publication_date\n1,foundation_food,Food,2,2024-01-01\n",
    "food_category.csv": null,
  });
  expect(imported.final.error).toBeUndefined();
  expect(imported.final.result?.foodCount).toBe(1);
  expect(imported.read("1")?.name).toBe("Food");
});

test("Foundation archive bounds, ignored members and checksum failures are enforced", async () => {
  expect((await install({}, 100)).final.error).toBe("Expanded archive exceeds the configured import limit.");
  const extra = await install({ "irrelevant.txt": "Ignored file\n" });
  expect(extra.final.result?.foodCount).toBe(1);
  const archive = await foundationArchive();
  archive[archive.indexOf(Buffer.from("Broccoli, raw"))] = 88;
  const corrupt = await runArchive("usda", archive, cleanup => cleanups.push(cleanup));
  expect(corrupt.final.error).toBe("ZIP checksum failed. Download the archive again.");
});
