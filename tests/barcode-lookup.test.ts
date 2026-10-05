import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import {
  BarcodeContactInvalidError,
  BarcodeLookupUnavailableError,
  BarcodeNotConfiguredError,
  BarcodeProductNotFoundError,
  createBarcodeService,
} from "../app/barcode/index.server";
import { openApplicationDatabase } from "../app/database/database.server";
import { version } from "../package.json";
import { fakeOffApi, offNativeServingProduct, type OffApiReply } from "./support/off-api";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

async function barcodeLookup(replies: Record<string, OffApiReply> = {}, contact: string | null = "family@example.com") {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-barcode-"));
  temporaryDirectories.push(directory);
  const database = openApplicationDatabase({
    databasePath: path.join(directory, "application.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });
  const api = fakeOffApi(replies);
  const service = createBarcodeService(database.getClient(), api.fetch);
  if (contact !== null) service.saveContact(contact);
  return { ...api, database, service };
}

function nativeProduct(sets: unknown, extra: Record<string, unknown> = {}) {
  return { code: "1234567", product_name: "Native food", nutrition: { input_sets: sets }, ...extra };
}
const nativeSet = {
  source: "packaging", preparation: "as_sold", per: "serving", per_quantity: 41, per_unit: "g",
  nutrients: { "energy-kcal": { value: 150, unit: "kcal" }, proteins: { value: 30, unit: "g" } },
};
function packagingSet(per: "100g" | "100ml" | "serving", perQuantity: number, perUnit: "g" | "ml", nutrients: Record<string, unknown>) {
  return { source: "packaging", preparation: "as_sold", per, per_quantity: perQuantity, per_unit: perUnit, nutrients };
}

test("a found product carries OFF's canonical code, label nutrition and a SHA-256 fingerprint", async () => {
  const { requests, service } = await barcodeLookup({ "643843715887": offNativeServingProduct });

  const food = await service.lookup("643843715887");

  expect(food).toMatchObject({
    provider: "open-food-facts", providerFoodId: "0643843715887", barcode: "0643843715887",
    dataType: "Open Food Facts", name: "100% Whey Protein Powder", brand: "Premier Protein",
    authoritativeBaseUnit: "g", isSelectable: true,
    measurements: [{ id: "serving", unit: "g", baseQuantityMicrounits: 41_000_000 }, { id: "g" }, { id: "100g" }],
    nutritionPerAuthoritativeBase: {
      energyMilliKcal: { amount: 150, fixedPointMultiplier: 1000 }, proteinMilligrams: { amount: 30, fixedPointMultiplier: 1000 },
      carbohydrateMilligrams: { amount: 4, fixedPointMultiplier: 1000 }, fatMilligrams: { amount: 2, fixedPointMultiplier: 1000 },
      fiberMilligrams: { amount: 1, fixedPointMultiplier: 1000 }, sugarMilligrams: { amount: 1, fixedPointMultiplier: 1000 },
      sodiumMilligrams: { amount: 0.17, fixedPointMultiplier: 1000 },
    },
  });
  expect(food.catalogGeneration).toMatch(/^[0-9a-f]{64}$/);
  expect(requests).toHaveLength(1);
  expect(requests[0].url.pathname).toBe("/api/v3.5/product/643843715887");
  expect(requests[0].url.searchParams.get("fields")?.split(",")).toEqual(expect.arrayContaining(["code", "nutrition", "serving_quantity"]));
  expect(requests[0].userAgent).toBe(`OpenCalorieTracker/${version} (family@example.com)`);
});

test("the fingerprint is stable for the same product and changes when the product changes", async () => {
  let calories = 150;
  const { service } = await barcodeLookup({
    "1234567": () => Response.json({ product: nativeProduct([{ ...nativeSet, nutrients: { "energy-kcal": { value: calories, unit: "kcal" } } }]) }),
  });
  const first = await service.lookup("1234567");
  expect((await service.lookup("1234567")).catalogGeneration).toBe(first.catalogGeneration);
  calories = 160;
  expect((await service.lookup("1234567")).catalogGeneration).not.toBe(first.catalogGeneration);
});

test("missing contact refuses lookup without any request", async () => {
  const { requests, service } = await barcodeLookup({ "1234567": nativeProduct([nativeSet]) }, null);
  expect(service.isConfigured()).toBe(false);
  await expect(service.lookup("1234567")).rejects.toBeInstanceOf(BarcodeNotConfiguredError);
  expect(requests).toHaveLength(0);
});

test.each(["123", "12345678901", "a1234567", "1234567 "])("unsupported barcode %j is not found without a request", async (barcode) => {
  const { requests, service } = await barcodeLookup();
  await expect(service.lookup(barcode)).rejects.toBeInstanceOf(BarcodeProductNotFoundError);
  expect(requests).toHaveLength(0);
});

test.each([
  ["404", Response.json({ status: "failure" }, { status: 404 }), BarcodeProductNotFoundError],
  ["no usable nutrition", nativeProduct([]), BarcodeProductNotFoundError],
  ["no input sets", { code: "1234567", product_name: "Legacy only", nutriments: { "energy-kcal_serving": 150 } }, BarcodeProductNotFoundError],
  ["unsupported canonical code", nativeProduct([nativeSet], { code: "123456" }), BarcodeProductNotFoundError],
  ["oversized name", nativeProduct([nativeSet], { product_name: "x".repeat(501) }), BarcodeProductNotFoundError],
  ["timeout", new DOMException("The operation timed out.", "TimeoutError"), BarcodeLookupUnavailableError],
  ["network failure", new TypeError("fetch failed"), BarcodeLookupUnavailableError],
  ["5xx", new Response("Bad gateway", { status: 502 }), BarcodeLookupUnavailableError],
  ["429", new Response("Slow down", { status: 429 }), BarcodeLookupUnavailableError],
  ["non-JSON body", new Response("<html>", { status: 200 }), BarcodeLookupUnavailableError],
  ["malformed reply", Response.json({ status: "success", product: { code: 1234567 } }), BarcodeLookupUnavailableError],
  ["missing product", Response.json({ status: "success" }), BarcodeLookupUnavailableError],
] as const)("%s maps to its barcode error", async (_name, reply, error) => {
  const { requests, service } = await barcodeLookup({ "1234567": reply });
  await expect(service.lookup("1234567")).rejects.toBeInstanceOf(error);
  expect(requests).toHaveLength(1);
});

test("each failed request is made once, without retries", async () => {
  const { requests, service } = await barcodeLookup({ "1234567": new Response("", { status: 503 }) });
  await expect(service.lookup("1234567")).rejects.toBeInstanceOf(BarcodeLookupUnavailableError);
  expect(requests).toHaveLength(1);
});

test("the contact email is trimmed, validated, replaced and cleared, and applies to the next request", async () => {
  const { requests, service } = await barcodeLookup({ "1234567": nativeProduct([nativeSet]) }, null);
  expect(service.saveContact("  family@example.com ")).toBe("family@example.com");
  expect(service.contact()).toBe("family@example.com");
  for (const invalid of ["", "not-an-email", "a(b)@example.com", "family@example.com\r\nX-Evil: 1", "fam\u0007ly@example.com", `${"a".repeat(190)}@example.com`, "ñandú@example.com"]) {
    expect(() => service.saveContact(invalid)).toThrow(BarcodeContactInvalidError);
  }
  expect(service.contact()).toBe("family@example.com");
  service.saveContact("parents@example.com");
  await service.lookup("1234567");
  expect(requests.at(-1)?.userAgent).toBe(`OpenCalorieTracker/${version} (parents@example.com)`);
  service.removeContact();
  expect(service.contact()).toBeUndefined();
  await expect(service.lookup("1234567")).rejects.toBeInstanceOf(BarcodeNotConfiguredError);
});

test("products report names, brand, country and source dates", async () => {
  const { service } = await barcodeLookup({
    "1234567": nativeProduct([nativeSet], { product_name: " ", product_name_en: "", product_name_es: "Comida", brands: " ", countries: "Mexico", created_t: 1_700_000_000, last_modified_t: 1_760_000_000 }),
    "1234568": nativeProduct([nativeSet], { code: "1234568", product_name: null, created_t: 99_999_999_999 }),
  });
  await expect(service.lookup("1234567")).resolves.toMatchObject({
    name: "Comida", originalName: "Comida", brand: null, marketCountry: "Mexico",
    providerPublishedDate: "2023-11-14T22:13:20.000Z", providerModifiedDate: "2025-10-09T08:53:20.000Z",
  });
  await expect(service.lookup("1234568")).resolves.toMatchObject({ name: "Unnamed product", providerPublishedDate: null, providerModifiedDate: null });
});

// Label nutrition rules. Each case is a v3.5 product reply, so they run through the same seam as a scan.

test.each([
  [null, "invalid_nutrition_input_sets"],
  [[], "unsupported_nutrition_authority"],
  [[{ ...nativeSet, source: "estimate" }], "unsupported_nutrition_authority"],
  [[{ ...nativeSet, preparation: "prepared" }], "unsupported_nutrition_authority"],
  [[{ ...nativeSet, per_quantity: 0 }], "invalid_nutrition_reference"],
  [[{ ...nativeSet, per: "100g", per_quantity: 41 }], "invalid_nutrition_reference"],
  [[{ ...nativeSet, per_unit: "oz" }], "invalid_nutrition_reference"],
  [[{ ...nativeSet, nutrients: null }], "invalid_nutrition_reference"],
  [[{ ...nativeSet, per_quantity: "0.0000001" }], "invalid_nutrition_reference"],
  [[{ ...nativeSet, per_quantity: "9007199255" }], "invalid_nutrition_reference"],
  [[{ ...nativeSet, per: "100ml", per_quantity: 100, per_unit: "g" }], "invalid_nutrition_reference"],
  [[{ ...nativeSet, nutrients: { "energy-kcal": { value_computed: 156, unit: "kcal" } } }], "calories_unavailable"],
  [[{ ...nativeSet, nutrients: { "energy-kcal": { value: 150, unit: "kcal", modifier: "~" } } }], "calories_unavailable"],
])("invalid or unusable authority %# is not found rather than falling back", async (sets, _reason) => {
  const { service } = await barcodeLookup({ "1234567": nativeProduct(sets) });
  await expect(service.lookup("1234567")).rejects.toBeInstanceOf(BarcodeProductNotFoundError);
});

test("a declared absence of nutrition blocks otherwise usable packaging", async () => {
  const { service } = await barcodeLookup({
    "1234567": nativeProduct([nativeSet], { no_nutrition_data: "on" }),
    "1234568": nativeProduct([nativeSet], { code: "1234568", no_nutrition_data: true }),
    "1234569": nativeProduct([nativeSet], { code: "1234569", no_nutrition_data: "" }),
  });
  await expect(service.lookup("1234567")).rejects.toBeInstanceOf(BarcodeProductNotFoundError);
  await expect(service.lookup("1234568")).rejects.toBeInstanceOf(BarcodeProductNotFoundError);
  await expect(service.lookup("1234569")).resolves.toMatchObject({ isSelectable: true });
});

test.each([
  [[nativeSet, { ...nativeSet, nutrients: { "energy-kcal": { value: 200, unit: "kcal" } } }]],
  [[nativeSet, { ...nativeSet, per_quantity: 50 }]],
  [[nativeSet, { ...nativeSet, per_unit: "ml" }]],
  [[packagingSet("100g", 100, "g", { "energy-kcal": { value: 16, unit: "kcal" } }), packagingSet("100ml", 100, "ml", { "energy-kcal": { value: 16, unit: "kcal" } })]],
])("conflicting nutrition bases %# are shown but not selectable", async (sets) => {
  const { service } = await barcodeLookup({ "1234567": nativeProduct(sets) });
  await expect(service.lookup("1234567")).resolves.toMatchObject({
    isSelectable: false, calculationUnavailableReason: "conflicting_nutrition_bases", measurements: [],
    measurementSummary: "Nutrition basis unavailable",
  });
});

test("explicit mass and volume references provide matching product serving conversions", async () => {
  const { service } = await barcodeLookup({
    "1234567": nativeProduct([{ ...nativeSet, per: "100g", per_quantity: "100", nutrients: { "energy-kj": { value: "418.4", unit: "kJ" }, proteins: { value: 100, unit: "mg" }, fiber: { value: 0, unit: "g" } } }], { serving_quantity: "25", serving_quantity_unit: "g" }),
    "1234568": nativeProduct([{ ...nativeSet, per: "100ml", per_quantity: 100, per_unit: "ml" }], { code: "1234568", serving_quantity: 50, serving_quantity_unit: "ml" }),
  });
  const mass = await service.lookup("1234567");
  expect(mass).toMatchObject({ authoritativeBaseUnit: "g", measurementSummary: "100 g", measurements: [{ id: "g" }, { id: "100g" }, { id: "serving", label: "1 serving (25 g)", baseQuantityMicrounits: 25_000_000 }], nutritionPerAuthoritativeBase: { proteinMilligrams: { amount: 100, fixedPointMultiplier: 1 }, fiberMilligrams: { amount: 0 }, fatMilligrams: null } });
  expect(mass.nutritionPerAuthoritativeBase.energyMilliKcal?.amount).toBeCloseTo(100);
  await expect(service.lookup("1234568")).resolves.toMatchObject({ authoritativeBaseUnit: "ml", measurements: [{ id: "ml" }, { id: "100ml" }, { id: "serving", baseQuantityMicrounits: 50_000_000 }] });
});

test("serving authority outranks contradictory per-100 alternatives", async () => {
  const nutrients = {
    "energy-kcal": { value: 160, unit: "kcal" }, proteins: { value: 30, unit: "g" },
    carbohydrates: { value: 4, unit: "g" }, fat: { value: 3, unit: "g" },
  };
  const { service } = await barcodeLookup({ "0643843716686": nativeProduct([
    { ...nativeSet, per: "100g", per_quantity: 100, nutrients: { "energy-kcal": { value: 49.184, unit: "kcal" }, proteins: { value: 9.222, unit: "g" } } },
    { ...nativeSet, per: "100ml", per_quantity: 100, per_unit: "ml", nutrients },
    { ...nativeSet, per_quantity: 325, per_unit: "ml", nutrients },
  ], { code: "0643843716686", product_name: "Café Latte Protein Shake" }) });

  await expect(service.lookup("0643843716686")).resolves.toMatchObject({
    isSelectable: true, authoritativeBaseUnit: "ml", authoritativeBaseQuantityMicrounits: 325_000_000,
    measurements: [{ id: "serving", unit: "ml", baseQuantityMicrounits: 325_000_000 }, { id: "ml" }, { id: "100ml" }],
    nutritionPerAuthoritativeBase: { energyMilliKcal: { amount: 160 }, proteinMilligrams: { amount: 30 }, carbohydrateMilligrams: { amount: 4 }, fatMilligrams: { amount: 3 } },
  });
});

test("product serving metadata selects the matching per-100 authority", async () => {
  const { service } = await barcodeLookup({ "0011210006508": nativeProduct([
    packagingSet("100g", 100, "g", { "energy-kcal": { value: 88, unit: "kcal" }, proteins: { value: 1.3, unit: "g" } }),
    packagingSet("100ml", 100, "ml", { "energy-kcal": { value: 121, unit: "kcal" }, proteins: { value: 1.5, unit: "g" } }),
  ], { code: "0011210006508", product_name: "Tabasco Habanero Sauce", serving_quantity: 5, serving_quantity_unit: "ml" }) });

  await expect(service.lookup("0011210006508")).resolves.toMatchObject({
    isSelectable: true, authoritativeBaseUnit: "ml", authoritativeBaseQuantityMicrounits: 100_000_000,
    nutritionPerAuthoritativeBase: { energyMilliKcal: { amount: 121 }, proteinMilligrams: { amount: 1.5 } },
    measurements: [{ id: "ml" }, { id: "100ml" }, { id: "serving", baseQuantityMicrounits: 5_000_000 }],
  });
});

test("sole-dimension and compatible-serving rules preserve real OFF measurements", async () => {
  const { service } = await barcodeLookup({
    "3017620422003": nativeProduct([packagingSet("100g", 100, "g", { "energy-kcal": { value: 539, unit: "kcal" } })], { code: "3017620422003", serving_quantity_unit: "g" }),
    "0000236555909": nativeProduct([packagingSet("100g", 100, "g", { "energy-kcal": { value: 235, unit: "kcal" } })], { code: "0000236555909", serving_quantity: 34, serving_quantity_unit: "g" }),
    "0012000041709": nativeProduct([packagingSet("100g", 100, "g", { "energy-kcal": { value: 0, unit: "kcal" } })], { code: "0012000041709", serving_quantity: 500, serving_quantity_unit: "ml" }),
  });
  await expect(service.lookup("3017620422003")).resolves.toMatchObject({ authoritativeBaseUnit: "g", measurements: [{ id: "g" }, { id: "100g" }] });
  expect((await service.lookup("0000236555909")).measurements).toContainEqual(expect.objectContaining({ id: "serving", unit: "g", baseQuantityMicrounits: 34_000_000 }));
  await expect(service.lookup("0012000041709")).resolves.toMatchObject({ authoritativeBaseUnit: "g", isSelectable: true, measurements: [{ id: "g" }, { id: "100g" }] });
});

test("an unusable serving falls back, while a usable serving still wins despite implausible values", async () => {
  const { service } = await barcodeLookup({
    "0009542009984": nativeProduct([
      packagingSet("100g", 100, "g", { "energy-kj": { value: 2480, unit: "kJ" }, proteins: { value: 10, unit: "g" } }),
      packagingSet("serving", 20, "g", {}),
    ], { code: "0009542009984", serving_quantity: 20, serving_quantity_unit: "g" }),
    "0009800800056": nativeProduct([
      packagingSet("100g", 100, "g", { "energy-kcal": { value: 500, unit: "kcal" } }),
      packagingSet("serving", 52, "g", { "energy-kcal": { value: 500, unit: "kcal" }, proteins: { value: 7.69231, unit: "g" } }),
    ], { code: "0009800800056", serving_quantity: 52, serving_quantity_unit: "g" }),
  });
  const fallback = await service.lookup("0009542009984");
  expect(fallback).toMatchObject({ authoritativeBaseUnit: "g", authoritativeBaseQuantityMicrounits: 100_000_000, isSelectable: true });
  expect(fallback.nutritionPerAuthoritativeBase.energyMilliKcal?.amount).toBeCloseTo(592.734, 3);
  expect(fallback.measurements).toContainEqual(expect.objectContaining({ id: "serving", baseQuantityMicrounits: 20_000_000 }));
  await expect(service.lookup("0009800800056")).resolves.toMatchObject({ authoritativeBaseUnit: "g", authoritativeBaseQuantityMicrounits: 52_000_000, nutritionPerAuthoritativeBase: { energyMilliKcal: { amount: 500 } } });
});

test("compatible equivalent-unit tables choose the more complete serving without merging", async () => {
  const { service } = await barcodeLookup({ "1234567": nativeProduct([
    { ...nativeSet, nutrients: { "energy-kcal": { value: 150, unit: "kcal" } } },
    { ...nativeSet, nutrients: { "energy-kcal": { value: 150, unit: "kcal" }, proteins: { value: 30000, unit: "mg" } } },
  ]) });
  await expect(service.lookup("1234567")).resolves.toMatchObject({ isSelectable: true, nutritionPerAuthoritativeBase: { proteinMilligrams: { amount: 30000, fixedPointMultiplier: 1 } }, measurements: [{ id: "serving", unit: "g", baseQuantityMicrounits: 41_000_000 }, { id: "g", baseQuantityMicrounits: 1_000_000 }, { id: "100g" }] });
});

test.each([-1, "-1", "NaN", "Infinity", " 2 ", "1e999", "9007199255", {}, [], null])("invalid macro %j stays unknown without disabling the product", async (value) => {
  const { service } = await barcodeLookup({ "1234567": nativeProduct([{ ...nativeSet, nutrients: { ...nativeSet.nutrients, proteins: { value, unit: "g" }, fiber: { value: 0, unit: "g" } } }]) });
  await expect(service.lookup("1234567")).resolves.toMatchObject({ isSelectable: true, nutritionPerAuthoritativeBase: { proteinMilligrams: null, fiberMilligrams: { amount: 0 } } });
});

test("unsupported nutrient units and modifiers stay unknown without disabling valid calories", async () => {
  const { service } = await barcodeLookup({ "1234567": nativeProduct([{ ...nativeSet, nutrients: { ...nativeSet.nutrients, proteins: { value: 30, unit: "oz" }, fiber: { value: 0, unit: "g", modifier: "<" }, sugars: "bad" } }]) });
  await expect(service.lookup("1234567")).resolves.toMatchObject({ isSelectable: true, nutritionPerAuthoritativeBase: { proteinMilligrams: null, fiberMilligrams: null, sugarMilligrams: null } });
});

test("per-100 energy declared without a calorie value is unusable, never estimated", async () => {
  const { service } = await barcodeLookup({ "1234567": nativeProduct([packagingSet("100g", 100, "g", { proteins: { value: 3, unit: "g" } })]) });
  await expect(service.lookup("1234567")).rejects.toBeInstanceOf(BarcodeProductNotFoundError);
});

test("tables that are not objects are skipped, and too many tables are refused", async () => {
  const { service } = await barcodeLookup({
    "1234567": nativeProduct([null, 42, nativeSet]),
    "1234568": nativeProduct(Array.from({ length: 101 }, () => nativeSet), { code: "1234568" }),
  });
  await expect(service.lookup("1234567")).resolves.toMatchObject({ isSelectable: true });
  await expect(service.lookup("1234568")).rejects.toBeInstanceOf(BarcodeProductNotFoundError);
});
