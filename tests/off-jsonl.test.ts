import { readFileSync } from "node:fs";
import { afterEach, expect, test } from "vitest";
import { runArchive } from "./support/catalog-import";
import { offJsonlArchive } from "./support/off-archive";

const target = JSON.parse(readFileSync(new URL("./fixtures/off-native-serving.json", import.meta.url), "utf8")) as Record<string, unknown>;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
const install = (rows: unknown[]) => runArchive("off", offJsonlArchive(rows), cleanup => cleanups.push(cleanup));

test.each([[], null, 42, "not a product", true])("JSONL recognizes a rejected first non-object document %#", async first => {
  const imported = await install([first, target]);
  expect(imported.final).toMatchObject({ result: { archiveFormat: "jsonl", foodCount: 1 } });
  expect(imported.messages.at(-2)?.progress).toMatchObject({ processedRecords: 2, rejectedRecords: 1, exclusions: { invalid_product_document: 1 } });
});

test("native packaging serving is usable without legacy fields and ignores computed calories", async () => {
  const imported = await install([target]);
  expect(imported.final.result?.foodCount, JSON.stringify(imported.final)).toBe(1);
  expect(imported.read("0643843715887")).toMatchObject({
    name: "100% Whey Protein Powder", authoritativeBaseUnit: "g", isSelectable: true,
    measurements: [{ id: "serving", unit: "g", baseQuantityMicrounits: 41_000_000 }, { id: "g" }, { id: "100g" }],
    nutritionPerAuthoritativeBase: {
      energyMilliKcal: { amount: 150, fixedPointMultiplier: 1000 }, proteinMilligrams: { amount: 30, fixedPointMultiplier: 1000 },
      carbohydrateMilligrams: { amount: 4, fixedPointMultiplier: 1000 }, fatMilligrams: { amount: 2, fixedPointMultiplier: 1000 },
      fiberMilligrams: { amount: 1, fixedPointMultiplier: 1000 }, sugarMilligrams: { amount: 1, fixedPointMultiplier: 1000 },
      sodiumMilligrams: { amount: 0.17, fixedPointMultiplier: 1000 },
    },
  });
});

test("native nutriments cannot overwrite product identity or display fields", async () => {
  const imported = await install([{ code: "0012345678905", product_name: "Root name", brands: "Root brand", nutriments: { code: "0643843715887", product_name: "Wrong name", brands: "Wrong brand", "energy-kcal_serving": 100 } }]);
  expect(imported.read("0012345678905")).toMatchObject({ name: "Root name", brand: "Root brand", isSelectable: true });
  expect(imported.read("0643843715887")).toBeUndefined();
});

test("JSONL accepts UTF-8, CRLF, no final newline and legacy serving numbers without retaining images", async () => {
  const archive = offJsonlArchive([{ code: "0012345678905", product_name: "Crème 燕麦", countries_tags: ["en:france"], nutriments: { "energy-kcal_serving": "123.5", proteins_serving: 0, sodium_serving: "0.009" }, images: { huge: "x".repeat(70_000) } }], "");
  const imported = await runArchive("off", archive, cleanup => cleanups.push(cleanup));
  expect(imported.read("0012345678905")).toMatchObject({ name: "Crème 燕麦", authoritativeBaseUnit: "serving", isSelectable: true, nutritionPerAuthoritativeBase: { energyMilliKcal: { amount: 123.5 }, proteinMilligrams: { amount: 0 }, sodiumMilligrams: { amount: 0.009 }, fatMilligrams: null } });
  expect(imported.read("0012345678905")?.offSourceFields).not.toHaveProperty("images");
});

function nativeProduct(sets: unknown, extra = {}) {
  return { code: "1234567", product_name: "Native food", nutriments: { "energy-kcal_serving": 999 }, nutrition: { input_sets: sets }, ...extra };
}
const nativeSet = { source: "packaging", preparation: "as_sold", per: "serving", per_quantity: 41, per_unit: "g", nutrients: { "energy-kcal": { value: 150, unit: "kcal" }, proteins: { value: 30, unit: "g" } } };
function packagingSet(per: "100g" | "100ml" | "serving", perQuantity: number, perUnit: "g" | "ml", nutrients: Record<string, unknown>) {
  return { source: "packaging", preparation: "as_sold", per, per_quantity: perQuantity, per_unit: perUnit, nutrients };
}

test.each([
  [null, "invalid_nutrition_input_sets"],
  [[], "unsupported_nutrition_authority"],
  [[{ ...nativeSet, source: "estimate" }], "unsupported_nutrition_authority"],
  [[{ ...nativeSet, preparation: "prepared" }], "unsupported_nutrition_authority"],
  [[{ ...nativeSet, per_quantity: 0 }], "invalid_nutrition_reference"],
  [[{ ...nativeSet, per: "100g", per_quantity: 41 }], "invalid_nutrition_reference"],
  [[{ ...nativeSet, per_unit: "oz" }], "invalid_nutrition_reference"],
  [[{ ...nativeSet, nutrients: { "energy-kcal": { value_computed: 156, unit: "kcal" } } }], "calories_unavailable"],
  [[{ ...nativeSet, nutrients: { "energy-kcal": { value: 150, unit: "kcal", modifier: "~" } } }], "calories_unavailable"],
  [[nativeSet, { ...nativeSet, nutrients: { "energy-kcal": { value: 200, unit: "kcal" } } }], "conflicting_nutrition_bases"],
] as const)("newer invalid or conflicting authority cannot fall back to convenient legacy calories %#", async (sets, reason) => {
  const imported = await install([nativeProduct(sets)]);
  expect(imported.read("1234567")).toMatchObject({ isSelectable: false, calculationUnavailableReason: reason, measurements: [] });
});

test("native explicit mass and volume references provide matching source serving conversions", async () => {
  const imported = await install([
    nativeProduct([{ ...nativeSet, per: "100g", per_quantity: "100", nutrients: { "energy-kj": { value: "418.4", unit: "kJ" }, proteins: { value: 100, unit: "mg" }, fiber: { value: 0, unit: "g" } } }], { serving_quantity: 25, serving_quantity_unit: "g" }),
    nativeProduct([{ ...nativeSet, per: "100ml", per_quantity: 100, per_unit: "ml" }], { code: "1234568", serving_quantity: 50, serving_quantity_unit: "ml" }),
  ]);
  expect(imported.read("1234567")).toMatchObject({ authoritativeBaseUnit: "g", measurements: [{ id: "g" }, { id: "100g" }, { id: "serving", baseQuantityMicrounits: 25_000_000 }], nutritionPerAuthoritativeBase: { proteinMilligrams: { amount: 100, fixedPointMultiplier: 1 }, fiberMilligrams: { amount: 0 }, fatMilligrams: null } });
  expect(imported.read("1234567")?.nutritionPerAuthoritativeBase.energyMilliKcal?.amount).toBeCloseTo(100);
  expect(imported.read("1234568")).toMatchObject({ authoritativeBaseUnit: "ml", measurements: [{ id: "ml" }, { id: "100ml" }, { id: "serving", baseQuantityMicrounits: 50_000_000 }] });
});

test("native serving authority outranks contradictory per-100 alternatives", async () => {
  const nutrients = {
    "energy-kcal": { value: 160, unit: "kcal" }, proteins: { value: 30, unit: "g" },
    carbohydrates: { value: 4, unit: "g" }, fat: { value: 3, unit: "g" },
  };
  const imported = await install([nativeProduct([
    { ...nativeSet, per: "100g", per_quantity: 100, nutrients: { "energy-kcal": { value: 49.184, unit: "kcal" }, proteins: { value: 9.222, unit: "g" } } },
    { ...nativeSet, per: "100ml", per_quantity: 100, per_unit: "ml", nutrients },
    { ...nativeSet, per_quantity: 325, per_unit: "ml", nutrients },
  ], { code: "0643843716686", product_name: "Café Latte Protein Shake" })]);

  expect(imported.read("0643843716686")).toMatchObject({
    isSelectable: true, authoritativeBaseUnit: "ml", authoritativeBaseQuantityMicrounits: 325_000_000,
    measurements: [{ id: "serving", unit: "ml", baseQuantityMicrounits: 325_000_000 }, { id: "ml" }, { id: "100ml" }],
    nutritionPerAuthoritativeBase: {
      energyMilliKcal: { amount: 160 }, proteinMilligrams: { amount: 30 },
      carbohydrateMilligrams: { amount: 4 }, fatMilligrams: { amount: 3 },
    },
  });
});

test("database sanity: Tabasco Habanero serving metadata selects the matching per-100 authority", async () => {
  const imported = await install([nativeProduct([
    packagingSet("100g", 100, "g", { "energy-kcal": { value: 88, unit: "kcal" }, proteins: { value: 1.3, unit: "g" } }),
    packagingSet("100ml", 100, "ml", { "energy-kcal": { value: 121, unit: "kcal" }, proteins: { value: 1.5, unit: "g" } }),
  ], { code: "0011210006508", product_name: "Tabasco Habanero Sauce", serving_quantity: 5, serving_quantity_unit: "ml" })]);

  expect(imported.read("0011210006508")).toMatchObject({
    isSelectable: true, authoritativeBaseUnit: "ml", authoritativeBaseQuantityMicrounits: 100_000_000,
    nutritionPerAuthoritativeBase: { energyMilliKcal: { amount: 121 }, proteinMilligrams: { amount: 1.5 } },
    measurements: [{ id: "ml" }, { id: "100ml" }, { id: "serving", baseQuantityMicrounits: 5_000_000 }],
  });
});

test("database sanity: sole-dimension and compatible-serving rules preserve real OFF measurements", async () => {
  const imported = await install([
    nativeProduct([
      packagingSet("100g", 100, "g", { "energy-kcal": { value: 539, unit: "kcal" }, proteins: { value: 6.3, unit: "g" } }),
    ], { code: "3017620422003", product_name: "Nutella", serving_quantity_unit: "g" }),
    nativeProduct([
      packagingSet("100g", 100, "g", { "energy-kcal": { value: 235, unit: "kcal" }, proteins: { value: 8.82, unit: "g" } }),
    ], { code: "0000236555909", product_name: "Bakers Best, White Bread", serving_quantity: 34, serving_quantity_unit: "g" }),
    nativeProduct([
      packagingSet("100g", 100, "g", { "energy-kcal": { value: 0, unit: "kcal" }, proteins: { value: 0, unit: "g" } }),
    ], { code: "0012000041709", product_name: "Green Tea Zero Sugar", serving_quantity: 500, serving_quantity_unit: "ml" }),
  ]);

  expect(imported.read("3017620422003")).toMatchObject({
    authoritativeBaseUnit: "g",
    isSelectable: true,
    measurements: [{ id: "g" }, { id: "100g" }],
    nutritionPerAuthoritativeBase: { energyMilliKcal: { amount: 539 } },
  });
  expect(imported.read("0000236555909")?.measurements).toContainEqual(expect.objectContaining({ id: "serving", unit: "g", baseQuantityMicrounits: 34_000_000 }));
  expect(imported.read("0012000041709")).toMatchObject({
    authoritativeBaseUnit: "g",
    isSelectable: true,
    measurements: [{ id: "g" }, { id: "100g" }],
  });
});

test("database sanity: Tabasco Pepper remains an unresolved mass-volume conflict", async () => {
  const nutrients = {
    "energy-kcal": { value: 16, unit: "kcal" },
    proteins: { value: 1, unit: "g" },
    carbohydrates: { value: 1.6, unit: "g" },
    fat: { value: 0.7, unit: "g" },
  };
  const imported = await install([nativeProduct([
    packagingSet("100g", 100, "g", nutrients),
    packagingSet("100ml", 100, "ml", nutrients),
  ], { code: "0011210000018", product_name: "16000085 Tabasco Pepper Sauce" })]);

  expect(imported.read("0011210000018")).toMatchObject({
    calculationUnavailableReason: "conflicting_nutrition_bases",
    isSelectable: false,
    measurements: [],
  });
});

test("database sanity: an unusable serving falls back, while a usable serving still wins despite implausible values", async () => {
  const imported = await install([
    nativeProduct([
      packagingSet("100g", 100, "g", { "energy-kj": { value: 2480, unit: "kJ" }, proteins: { value: 10, unit: "g" } }),
      packagingSet("serving", 20, "g", {}),
    ], { code: "0009542009984", product_name: "SUPREME DARK 90% COCOA", serving_quantity: 20, serving_quantity_unit: "g" }),
    nativeProduct([
      packagingSet("100g", 100, "g", { "energy-kcal": { value: 500, unit: "kcal" } }),
      packagingSet("serving", 52, "g", { "energy-kcal": { value: 500, unit: "kcal" }, proteins: { value: 7.69231, unit: "g" } }),
    ], { code: "0009800800056", product_name: "nutella & GO! with Breadsticks", serving_quantity: 52, serving_quantity_unit: "g" }),
  ]);

  const fallback = imported.read("0009542009984")!;
  expect(fallback).toMatchObject({
    authoritativeBaseUnit: "g",
    authoritativeBaseQuantityMicrounits: 100_000_000,
    isSelectable: true,
  });
  expect(fallback.nutritionPerAuthoritativeBase.energyMilliKcal?.amount).toBeCloseTo(592.734, 3);
  expect(fallback.measurements).toContainEqual(expect.objectContaining({ id: "serving", baseQuantityMicrounits: 20_000_000 }));
  const implausible = imported.read("0009800800056")!;
  expect(implausible).toMatchObject({
    authoritativeBaseUnit: "g",
    authoritativeBaseQuantityMicrounits: 52_000_000,
    isSelectable: true,
    nutritionPerAuthoritativeBase: { energyMilliKcal: { amount: 500 } },
  });
  expect(implausible.measurements[0]).toMatchObject({ id: "serving", baseQuantityMicrounits: 52_000_000 });
});

test("JSONL rejects countable malformed records and identities, but retains valid products and counters", async () => {
  const { gzipSync } = await import("node:zlib");
  const lines = [JSON.stringify(target), "{broken}", JSON.stringify({ product_name: "No identity" }), JSON.stringify({ code: { bad: true }, product_name: "Bad identity" }), JSON.stringify(target)];
  const imported = await runArchive("off", gzipSync(lines.join("\r\n")), cleanup => cleanups.push(cleanup));
  expect(imported.final.result?.foodCount).toBe(1);
  expect(imported.messages.at(-2)?.progress).toMatchObject({ processedRecords: 5, importedRecords: 1, rejectedRecords: 4, exclusions: { malformed_json: 1, invalid_identity: 2, duplicate_identity: 1 } });
});

test("oversized documents and late GZIP corruption never produce an activation result", async () => {
  const oversized = await runArchive("off", offJsonlArchive([target]), cleanup => cleanups.push(cleanup), { maxDocumentBytes: 10 });
  expect(oversized.final.error).toContain("individual-document limit");
  const corrupt = await runArchive("off", offJsonlArchive([target]).subarray(0, -8), cleanup => cleanups.push(cleanup));
  expect(corrupt.final.error).toContain("Corrupt OFF GZIP");
  expect(corrupt.messages.some(message => message.result)).toBe(false);
});

test("compatible equivalent-unit sets choose a complete serving without merging other authorities", async () => {
  const imported = await install([nativeProduct([
    { ...nativeSet, nutrients: { "energy-kcal": { value: 150, unit: "kcal" } } },
    { ...nativeSet, nutrients: { "energy-kcal": { value: 150, unit: "kcal" }, proteins: { value: 30000, unit: "mg" } } },
  ])]);
  expect(imported.read("1234567")).toMatchObject({ isSelectable: true, nutritionPerAuthoritativeBase: { proteinMilligrams: { amount: 30000, fixedPointMultiplier: 1 } }, measurements: [{ id: "serving", unit: "g", baseQuantityMicrounits: 41_000_000 }, { id: "g", baseQuantityMicrounits: 1_000_000 }, { id: "100g" }] });
});

test.each(["-1", "NaN", "Infinity", " 2 ", "1e999", "9007199255", {}, []])("native invalid macro %j is counted and stays unknown", async value => {
  const imported = await install([nativeProduct([{ ...nativeSet, nutrients: { ...nativeSet.nutrients, proteins: { value, unit: "g" }, fiber: { value: 0, unit: "g" } } }])]);
  expect(imported.read("1234567")).toMatchObject({ isSelectable: true, nutritionPerAuthoritativeBase: { proteinMilligrams: null, fiberMilligrams: { amount: 0 } } });
  expect(imported.messages.at(-2)?.progress?.exclusions).toMatchObject({ invalid_nutrient_value: 1 });
});

test("native unsupported nutrient units and modifiers are counted without disabling valid calories", async () => {
  const imported = await install([nativeProduct([{ ...nativeSet, nutrients: { ...nativeSet.nutrients, proteins: { value: 30, unit: "oz" }, fiber: { value: 0, unit: "g", modifier: "<" } } }])]);
  expect(imported.read("1234567")).toMatchObject({ isSelectable: true, nutritionPerAuthoritativeBase: { proteinMilligrams: null, fiberMilligrams: null } });
  expect(imported.messages.at(-2)?.progress?.exclusions).toMatchObject({ unsupported_nutrient_unit_or_modifier: 2 });
});

test("native no-nutrition declarations block otherwise usable packaging and legacy authority", async () => {
  const imported = await install([nativeProduct([nativeSet], { no_nutrition_data: "on" })]);
  expect(imported.read("1234567")).toMatchObject({ isSelectable: false, calculationUnavailableReason: "nutrition_not_provided" });
});

test("JSONL rejects invalid selected text and native country tags while preserving null and unrelated fields", async () => {
  const imported = await install([
    nativeProduct([nativeSet], { code: "1234567", brands: null, images: {} }),
    nativeProduct([nativeSet], { code: "1234568", countries_tags: [123] }),
    nativeProduct([nativeSet], { code: "1234569", brands: {} }),
    nativeProduct([nativeSet], { code: "1234570", product_name: "x".repeat(501) }),
    { code: "1234571", product_name: "Invalid legacy macro", nutriments: { "energy-kcal_serving": 150, proteins_serving: {} } },
    nativeProduct([nativeSet], { code: "1234572", countries_tags: [] }),
  ]);
  expect(imported.final.result?.foodCount).toBe(3);
  expect(imported.read("1234567")?.brand).toBeNull();
  expect(imported.messages.at(-2)?.progress).toMatchObject({ rejectedRecords: 3, exclusions: { invalid_product_field: 2, oversized_product_field: 1, invalid_nutrient_value: 1 } });
});

test("JSONL counts non-object records, rejects archives with no valid products, and validates native references", async () => {
  const imported = await install([nativeProduct([nativeSet]), null, [], 123, nativeProduct([{ ...nativeSet, per_quantity: "0.0000001" }], { code: "1234568" }), nativeProduct([{ ...nativeSet, per_quantity: "9007199255" }], { code: "1234569" }), nativeProduct([{ ...nativeSet, nutrients: null }], { code: "1234570" })]);
  expect(imported.messages.at(-2)?.progress?.rejectedRecords).toBe(3);
  for (const id of ["1234568", "1234569", "1234570"]) expect(imported.read(id)?.calculationUnavailableReason).toBe("invalid_nutrition_reference");
  const empty = await install([{ code: "" }]);
  expect(empty.final.error).toContain("no product records");
});

test("JSONL preserves UTF-8 across decompressor chunks and counts progress for thousands of products", async () => {
  const beforeName = JSON.stringify({ code: "1000000", ignored: "", product_name: "" }).slice(0, -2);
  const padding = "x".repeat(16 * 1024 - 1 - Buffer.byteLength(beforeName));
  const rows = Array.from({ length: 5001 }, (_, index) => ({ code: String(1000000 + index), ignored: index === 0 ? padding : "", product_name: index === 0 ? "燕麦" : `Product ${index}`, nutriments: { "energy-kcal_serving": 50 } }));
  expect(Buffer.from(JSON.stringify(rows[0])).indexOf(Buffer.from("燕"))).toBe(16 * 1024 - 1);
  const imported = await install(rows);
  expect(imported.final.result?.foodCount).toBe(5001);
  expect(imported.messages.some(message => message.progress?.processedRecords === 5000)).toBe(true);
  expect(imported.read("1000000")?.name).toBe("燕麦");
});

test("equally preferred incompatible serving quantities and different dimensions conflict", async () => {
  const imported = await install([
    nativeProduct([nativeSet, { ...nativeSet, per_quantity: 50 }]),
    nativeProduct([nativeSet, { ...nativeSet, per_unit: "ml" }], { code: "1234568" }),
    nativeProduct([{ ...nativeSet, per: "100ml", per_quantity: 100, per_unit: "g" }], { code: "1234569" }),
  ]);
  expect(imported.read("1234567")?.calculationUnavailableReason).toBe("conflicting_nutrition_bases");
  expect(imported.read("1234568")?.calculationUnavailableReason).toBe("conflicting_nutrition_bases");
  expect(imported.read("1234569")?.calculationUnavailableReason).toBe("invalid_nutrition_reference");
});
