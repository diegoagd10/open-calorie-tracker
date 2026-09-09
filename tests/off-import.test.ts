import { gzipSync, gunzipSync } from "node:zlib";
import { afterEach, expect, test, vi } from "vitest";
import { runArchive } from "./support/catalog-import";
import { offArchive, offProduct, offWithBasis } from "./support/off-archive";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(cleanups.splice(0).map(cleanup => cleanup())); });
const install = (archive: Buffer, maxExpandedBytes?: number) => runArchive("off", archive, cleanup => cleanups.push(cleanup), maxExpandedBytes === undefined ? {} : { maxExpandedBytes });
const prefix = "nutrition.input_sets.packaging.as_sold.100g.nutrients.";

test.each([
  ["ambiguous", offProduct, "ambiguous_nutrition_basis"],
  ["conflicting", { ...offWithBasis("100g"), ...offWithBasis("100ml") }, "conflicting_nutrition_bases"],
  ["missing calories", { ...offWithBasis("100g"), [`${prefix}energy-kcal.value`]: "" }, "calories_unavailable"],
  ["flagged", { ...offWithBasis("serving"), no_nutrition_data: "on" }, "nutrition_not_provided"],
] as const)("%s products cannot offer calculated nutrition or measures", async (_name, row, reason) => {
  const imported = await install(offArchive([row]));
  expect(imported.read(offProduct.code)).toMatchObject({ isSelectable: false, calculationUnavailableReason: reason, measurements: [], measurementSummary: "Nutrition basis unavailable", nutritionPerAuthoritativeBase: { energyMilliKcal: null, proteinMilligrams: null, carbohydrateMilligrams: null, fatMilligrams: null, fiberMilligrams: null, sugarMilligrams: null, sodiumMilligrams: null } });
  expect(imported.messages.at(-2)?.progress?.exclusions).toEqual({ [reason]: 1 });
});

test.each(["NaN", "Infinity", "-1", "1,2", " 2 ", "1e999", "9007199255", ""])("invalid OFF nutrient %s stays missing without discarding valid calories", async value => {
  const imported = await install(offArchive([{ ...offWithBasis("100g"), [`${prefix}proteins.value`]: value }]));
  expect(imported.read(offProduct.code)).toMatchObject({ isSelectable: true, nutritionPerAuthoritativeBase: { proteinMilligrams: null, energyMilliKcal: { amount: 400, fixedPointMultiplier: 1000 } } });
});

test.each([
  ["unknown unit", { [`${prefix}proteins.unit`]: "constructor" }],
  ["qualified value", { [`${prefix}proteins.modifier`]: "<" }],
] as const)("%s cannot become exact protein", async (_name, fields) => {
  const imported = await install(offArchive([{ ...offWithBasis("100g"), ...fields }]));
  expect(imported.read(offProduct.code)!.nutritionPerAuthoritativeBase.proteinMilligrams).toBeNull();
});

test.each(["energy-kj", "energy"])("explicit %s converts declared kJ and prefers usable kcal when both exist", async name => {
  const row = { ...offWithBasis("100g"), [`${prefix}energy-kcal.value`]: "", [`${prefix}${name}.value`]: "418.4", [`${prefix}${name}.unit`]: "kJ", [`${prefix}proteins.value`]: "1e2", [`${prefix}proteins.unit`]: "mg", [`${prefix}proteins.modifier`]: " " };
  const imported = await install(offArchive([row, { ...row, code: "1234567", [`${prefix}energy-kcal.value`]: "25" }]));
  expect(imported.read(offProduct.code)!.nutritionPerAuthoritativeBase.energyMilliKcal?.amount).toBeCloseTo(100, 10);
  expect(imported.read(offProduct.code)!.nutritionPerAuthoritativeBase.proteinMilligrams).toEqual({ amount: 100, fixedPointMultiplier: 1 });
  expect(imported.read("1234567")!.nutritionPerAuthoritativeBase.energyMilliKcal).toEqual({ amount: 25, fixedPointMultiplier: 1000 });
});

test.each([
  ["ml", "12"], ["g", "0"], ["g", "-1"], ["g", ""], ["g", "invalid"], ["g", "0.0000001"], ["g", "9007199255"],
])("serving %s/%s cannot invent a mass conversion", async (unit, quantity) => {
  const imported = await install(offArchive([{ ...offWithBasis("100g"), serving_quantity_unit: unit, serving_quantity: quantity }]));
  expect(imported.read(offProduct.code)!.measurements.map(value => value.id)).toEqual(["g", "100g"]);
});

test("OFF import trims identity and display text, orders source dates, and rejects invalid timestamps", async () => {
  const rows = [
    { ...offWithBasis("serving", " 1234567 "), product_name: "  spaced name  ", brands: "  ", countries: "  Spain  ", created_t: "-1", last_modified_t: "1704067200" },
    { ...offWithBasis("serving", "12345678"), product_name: "", created_t: "1e3", last_modified_t: "1735689600" },
    { ...offWithBasis("serving", "123456789012"), created_t: "99999999999", last_modified_t: "1577836800" },
    { ...offWithBasis("serving", "12345678901234"), created_t: "0", last_modified_t: "999999999999" },
    { ...offWithBasis("serving", "1234567890123"), last_modified_t: "1672531200" },
  ];
  const imported = await install(offArchive(rows));
  expect(imported.final.result?.sourceDateRange).toEqual({ earliest: "2020-01-01T00:00:00.000Z", latest: "2025-01-01T00:00:00.000Z" });
  expect(imported.read("1234567")).toMatchObject({ name: "spaced name", originalName: "spaced name", brand: null, marketCountry: "Spain", barcode: "1234567", providerPublishedDate: null });
  expect(imported.read("12345678")).toMatchObject({ name: "Unnamed product", providerPublishedDate: null });
  expect(imported.read("123456789012")).toMatchObject({ providerPublishedDate: null });
  expect(imported.read("12345678901234")).toMatchObject({ providerPublishedDate: "1970-01-01T00:00:00.000Z", providerModifiedDate: null });
  expect(imported.read("missing")).toBeUndefined();
});

test("OFF accepts a source timestamp exactly now but rejects a future timestamp", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1735689600000);
  const imported = await install(offArchive([{ ...offProduct, last_modified_t: "1735689600" }, { ...offProduct, code: "1234567", last_modified_t: "1735689601" }]));
  expect(imported.read(offProduct.code)?.providerModifiedDate).toBe("2025-01-01T00:00:00.000Z");
  expect(imported.read("1234567")?.providerModifiedDate).toBeNull();
});

test("OFF progress is emitted during a multi-batch import and its final record remains readable", async () => {
  const header = "code\tproduct_name\tenergy-kcal_100g\tproteins_100g\tfat_100g\tcarbohydrates_100g\n";
  const rows = Array.from({ length: 5001 }, (_, index) => `${1000000 + index}\tProduct ${index}\t100\t0\t0\t0\n`).join("");
  const imported = await install(gzipSync(header + rows));
  expect(imported.messages.filter(message => message.progress?.phase === "importing").map(message => message.progress?.processedRecords)).toEqual([0, 5000]);
  expect(imported.final.result?.foodCount).toBe(5001);
  expect(imported.messages.at(-2)?.progress?.processedRecords).toBe(5001);
  expect(imported.read("1005000")?.name).toBe("Product 5000");
});

test("OFF schema column and header limits accept their boundary and reject an excess", async () => {
  const required = ["code", "product_name", "energy-kcal_100g", "proteins_100g", "fat_100g", "carbohydrates_100g"];
  const columns = [...required, ...Array.from({ length: 994 }, (_, index) => `ignored${index}`)];
  const row = ["1234567", "Product", "100", "0", "0", "0", ...Array<string>(994).fill("")];
  expect((await install(gzipSync(columns.join("\t") + "\n" + row.join("\t") + "\n"))).final.result?.foodCount).toBe(1);
  expect((await install(gzipSync([...columns, "extra"].join("\t") + "\n"))).final.error).toContain("Incompatible OFF schema");
  const base = required.join("\t") + "\t";
  const padding = "x".repeat(256 * 1024 - Buffer.byteLength(base) - 1);
  expect((await install(gzipSync(base + padding + "\n1234567\tProduct\t100\t0\t0\t0\t\n"))).final.result?.foodCount).toBe(1);
  expect((await install(gzipSync(base + padding + "x\n"))).final.error).toContain("Incompatible OFF schema");
});

test("OFF rejects invalid identity even when another selected field is also oversized", async () => {
  const imported = await install(offArchive([offWithBasis("serving"), { ...offProduct, code: "", product_name: "x".repeat(501) }]));
  expect(imported.messages.at(-2)?.progress?.exclusions).toEqual({ invalid_identity: 1 });
});

test("empty explicit fields permit serving evidence, while unknown energy units remain unavailable", async () => {
  const fields = Object.fromEntries(Object.keys(offWithBasis("100g")).filter(key => key.startsWith("nutrition.")).map(key => [key, ""]));
  const imported = await install(offArchive([{ ...offProduct, ...fields, "energy-kcal_serving": "77" }, { ...offWithBasis("100g", "1234567"), [`${prefix}energy-kcal.unit`]: "g" }]));
  expect(imported.read(offProduct.code)).toMatchObject({ authoritativeBaseUnit: "serving", isSelectable: true, nutritionPerAuthoritativeBase: { energyMilliKcal: { amount: 77, fixedPointMultiplier: 1000 } } });
  expect(imported.read("1234567")).toMatchObject({ isSelectable: false, calculationUnavailableReason: "calories_unavailable" });
});

test("OFF retains unsupported identifiers but rejects unusable rows and counts duplicates across batches", async () => {
  const rows = Array.from({ length: 501 }, (_, index) => offWithBasis("serving", String(1000000 + index)));
  const imported = await install(offArchive([...rows, { ...rows[0], product_name: "later duplicate" }, ...["abc", "123456", "123456789", "12345678901", "123456789012345"].map(code => offWithBasis("serving", code)), { ...offProduct, code: "" }, { ...offProduct, code: "   " }, { ...offProduct, code: "1".repeat(129) }, { ...offProduct, product_name: "a".repeat(501) }, { ...offProduct, brands: "a".repeat(501) }, { ...offProduct, countries: "a".repeat(2001) }], ["bad\trow"]));
  expect(imported.final.result?.foodCount).toBe(506);
  expect(imported.messages.at(-2)?.progress?.exclusions).toEqual({ duplicate_identity: 1, unsupported_barcode: 5, invalid_identity: 3, oversized_product_field: 3, row_width_mismatch: 1 });
  expect(imported.read("1000000")?.name).toBe(offProduct.product_name);
  expect(imported.read("1000500")?.isSelectable).toBe(true);
  expect(imported.read("abc")).toMatchObject({ isSelectable: false, calculationUnavailableReason: "unsupported_barcode" });
});

test.each([
  [Buffer.from("not gzip"), "Corrupt OFF GZIP or malformed TSV. Download the archive again."],
  [gzipSync(""), "Incompatible OFF schema. Upload the official tab-separated product CSV GZIP."],
  [gzipSync("code\tproduct_name\n123\tname\n"), "Incompatible OFF schema. Upload the official tab-separated product CSV GZIP."],
  [gzipSync("code\tcode\tproduct_name\tenergy-kcal_100g\tproteins_100g\tfat_100g\tcarbohydrates_100g\n"), "Incompatible OFF schema. Upload the official tab-separated product CSV GZIP."],
  [gzipSync("code\tproduct_name\tenergy-kcal_100g\tproteins_100g\tfat_100g\tcarbohydrates_100g\n"), "OFF archive contains no product records. Nothing was installed."],
  [offArchive().subarray(0, -8), "Corrupt OFF GZIP or malformed TSV. Download the archive again."],
] as const)("OFF returns a specific archive failure %#", async (archive, error) => {
  const imported = await install(archive);
  expect(imported.final).toMatchObject({ error });
  expect(imported.messages.some(message => message.result)).toBe(false);
});

test("a late OFF archive failure reports accepted and rejected staging rows", async () => {
  const rows = Array.from({ length: 500 }, (_, index) => offWithBasis("serving", String(1_000_000_000_000 + index)));
  const archive = offArchive([...rows, { ...offProduct, code: "" }, offWithBasis("serving", "0012345678906")]).subarray(0, -8);
  const imported = await install(archive);
  expect(imported.final).toMatchObject({
    progress: { processedRecords: 501, importedRecords: 500, rejectedRecords: 1, exclusions: { invalid_identity: 1 } },
    error: "Corrupt OFF GZIP or malformed TSV. Download the archive again.",
  });
});

test("OFF distinguishes expanded input and staged SQLite resource failures", async () => {
  const limit = await install(offArchive(), 10);
  expect(limit.final.error).toBe("OFF expanded data exceeds the configured resource limit.");
  const storage = await install(offArchive([offWithBasis("serving")]), 4096);
  expect(storage.final.error).toBe("Insufficient storage for OFF import. Free space or increase the resource limit and retry.");
});

test("daily OFF quotes are literal and configurable exports preserve embedded newlines", async () => {
  const daily = "code\turl\tcreator\tcreated_t\tcreated_datetime\tlast_modified_t\tlast_modified_datetime\tlast_modified_by\tlast_updated_t\tlast_updated_datetime\tproduct_name\tenergy-kcal_100g\tproteins_100g\tfat_100g\tcarbohydrates_100g\n1234567\t\t\t\t\t\t\t\t\t\tUnclosed \"quote\t100\t0\t0\t0\n1234568\t\t\t\t\t\t\t\t\t\tNext product\t100\t0\t0\t0\n";
  const imported = await install(gzipSync("\uFEFF" + daily));
  expect(imported.final.result?.foodCount).toBe(2);
  expect(imported.read("1234567")?.name).toBe('Unclosed "quote');
  expect(imported.read("1234568")?.name).toBe("Next product");
  const quoted = await install(offArchive([{ ...offWithBasis("serving"), product_name: 'First\nsecond\t"quoted"' }]));
  expect(quoted.read(offProduct.code)?.name).toBe('First\nsecond\t"quoted"');
});

test.each(["100g", "100ml", "serving"] as const)("explicit %s preserves every nutrient, identity field and supported measure", async per => {
  const prefix = `nutrition.input_sets.packaging.as_sold.${per}.nutrients.`;
  const row = { ...offWithBasis(per), [`${prefix}sugars.value`]: "2.5", [`${prefix}sugars.unit`]: "g", [`${prefix}fat.modifier`]: "", serving_quantity_unit: per === "100g" ? "g" : "ml", serving_quantity: "12.3456786", generic_name: "cereal", countries_tags: "en:united-states", product_quantity_unit: "g", unrelated_column: "must not persist" };
  const imported = await install(offArchive([row]));
  const food = imported.read(offProduct.code)!;
  expect(food.nutritionPerAuthoritativeBase).toEqual({
    energyMilliKcal: { amount: 400, fixedPointMultiplier: 1000 },
    proteinMilligrams: { amount: 10, fixedPointMultiplier: 1000 },
    carbohydrateMilligrams: { amount: 60, fixedPointMultiplier: 1000 },
    fatMilligrams: { amount: 12, fixedPointMultiplier: 1000 },
    fiberMilligrams: { amount: 0, fixedPointMultiplier: 1000 },
    sugarMilligrams: { amount: 2.5, fixedPointMultiplier: 1000 },
    sodiumMilligrams: { amount: 10, fixedPointMultiplier: 1 },
  });
  const unit = per === "100g" ? "g" : "ml";
  expect(food.measurements).toEqual(per === "serving" ? [{ id: "serving", label: "1 serving", unit: "serving", baseQuantityMicrounits: 1_000_000 }] : [
    { id: unit, label: `1 ${unit}`, unit, baseQuantityMicrounits: 1_000_000 },
    { id: per, label: `100 ${unit}`, unit, baseQuantityMicrounits: 100_000_000 },
    { id: "serving", label: `1 serving (12.3456786 ${unit})`, unit, baseQuantityMicrounits: 12_345_679 },
  ]);
  expect(food).toMatchObject({ originalName: offProduct.product_name, dataType: "Open Food Facts", providerPublishedDate: "2024-01-01T00:00:00.000Z", providerModifiedDate: "2025-01-01T00:00:00.000Z", measurementSummary: per === "serving" ? "1 serving" : `100 ${unit}` });
  const retained: Record<string, string> = { ...row }; delete retained.unrelated_column;
  expect(food.offSourceFields).toEqual(retained);
});

test.each([
  ["energy-kcal_serving", "123.5", 123.5],
  ["energy-kj_serving", "418.4", 100],
  ["energy_serving", "836.8", 200],
] as const)("legacy %s is a serving authority and preserves independent macro units", async (field, value, kcal) => {
  const imported = await install(offArchive([{ ...offProduct, [field]: value, proteins_serving: "1.2", carbohydrates_serving: "3.4", fat_serving: "5.6", fiber_serving: "0", sugars_serving: "7.8", sodium_serving: "0.009" }]));
  expect(imported.read(offProduct.code)).toMatchObject({ authoritativeBaseUnit: "serving", authoritativeBaseQuantityMicrounits: 1_000_000, nutritionPerAuthoritativeBase: {
    energyMilliKcal: { fixedPointMultiplier: 1000 }, proteinMilligrams: { amount: 1.2, fixedPointMultiplier: 1000 }, carbohydrateMilligrams: { amount: 3.4, fixedPointMultiplier: 1000 }, fatMilligrams: { amount: 5.6, fixedPointMultiplier: 1000 }, fiberMilligrams: { amount: 0, fixedPointMultiplier: 1000 }, sugarMilligrams: { amount: 7.8, fixedPointMultiplier: 1000 }, sodiumMilligrams: { amount: 0.009, fixedPointMultiplier: 1000 },
  } });
  expect(imported.read(offProduct.code)!.nutritionPerAuthoritativeBase.energyMilliKcal!.amount).toBeCloseTo(kcal, 10);
});

test("OFF accepts an archive exactly at the expanded-byte limit", async () => {
  const archive = offArchive([{ ...offWithBasis("serving"), unused: "x".repeat(50_000) }]);
  const imported = await install(archive, gunzipSync(archive).length);
  expect(imported.final.result?.foodCount).toBe(1);
});
