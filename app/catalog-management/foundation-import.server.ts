import path from "node:path";
import { z } from "zod";
import type { ImportOptions, ImportMessage } from "./import-contract.ts";
import { buildLocalUsdaGeneration } from "../catalog/local-usda.server.ts";
import type { CatalogFood, CatalogMeasurement, CatalogNutrition, CatalogNutrientValue } from "../catalog/food-catalog.server.ts";
import type { UsdaGenerationCategory, UsdaGenerationFood } from "../database/usda-generation.server.ts";
import type { CatalogImportJob } from "./catalog-management.server.ts";
import { ArchiveError, foundationRows, unpackFoundation } from "./foundation-archive.server.ts";

export async function importFoundation(options: ImportOptions, publish: (message: ImportMessage) => void): Promise<void> {
  const staging = path.join(options.directory, `${options.generation}.staging`);
  const exclusions: Record<string, number> = {};
  let processedRecords = 0;
  let importedRecords = 0;
  let rejectedRecords = 0;
  function exclude(reason: string) { exclusions[reason] = (exclusions[reason] ?? 0) + 1; }
  function rejectFood(reason: string) { rejectedRecords++; exclude(reason); }
  function progress(phase: CatalogImportJob["phase"]) { publish({ progress: { phase, processedRecords, importedRecords, rejectedRecords, exclusions } }); }
  const supportedNutrients: Record<string, { field: keyof CatalogNutrition; units: Record<string, number> }> = {
    "1003": { field: "proteinMilligrams", units: { G: 1000 } },
    "1004": { field: "fatMilligrams", units: { G: 1000 } },
    "1005": { field: "carbohydrateMilligrams", units: { G: 1000 } },
    "1008": { field: "energyMilliKcal", units: { KCAL: 1000 } },
    "2047": { field: "energyMilliKcal", units: { KCAL: 1000 } },
    "2048": { field: "energyMilliKcal", units: { KCAL: 1000 } },
    "1079": { field: "fiberMilligrams", units: { G: 1000 } },
    "1093": { field: "sodiumMilligrams", units: { MG: 1, G: 1000 } },
    "2000": { field: "sugarMilligrams", units: { G: 1000 } },
  };
  const numericSchema = z.string().trim().regex(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/).transform(Number).pipe(z.number().nonnegative().max(Number.MAX_SAFE_INTEGER / 1_000_000));
  function numeric(value: string): number | undefined {
    const parsed = numericSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  }
  const idSchema = z.string().regex(/^[1-9]\d*$/).refine(value => Number.isSafeInteger(Number(value)));
  const foodSchema = z.object({ fdc_id: idSchema, description: z.string().trim().min(1).max(500), publication_date: z.iso.date() });
  const categorySchema = z.object({ id: idSchema, description: z.string().trim().min(1).max(500) });
  function validId(value: string) { return idSchema.safeParse(value).success; }
  function emptyNutrition(): CatalogNutrition {
    return { carbohydrateMilligrams: null, energyMilliKcal: null, fatMilligrams: null, fiberMilligrams: null, proteinMilligrams: null, sodiumMilligrams: null, sugarMilligrams: null };
  }
  const researchTypes = new Set(["agricultural_acquisition", "market_acquisition", "sample_food", "sub_sample_food"]);
  function selectableRecordType(dataType: string): boolean {
    if (researchTypes.has(dataType)) { rejectFood("research_record"); return false; }
    if (dataType !== "foundation_food") throw new ArchiveError("Wrong USDA dataset. Only a Foundation CSV archive is supported.");
    return true;
  }
  function foodRecord(row: Record<string, string>, categories: Map<string, UsdaGenerationCategory>): UsdaGenerationFood | null {
    const parsed = foodSchema.safeParse(row);
    if (!parsed.success) { rejectFood("invalid_food_record"); return null; }
    const food = parsed.data;
    if (!validId(row.food_category_id) || !categories.has(row.food_category_id)) {
      throw new ArchiveError("Foundation food has an invalid or missing category.");
    }
    return { categoryId: row.food_category_id, food: {
      barcode: null, brand: null, dataType: "Foundation", isSelectable: false, measurementSummary: "100 g", name: food.description.normalize("NFC"),
      provider: "usda-fdc", providerFoodId: food.fdc_id, providerPublishedDate: food.publication_date,
      authoritativeBaseQuantityMicrounits: 100_000_000, authoritativeBaseUnit: "g", marketCountry: null,
      measurements: [{ id: "g", label: "1 g", unit: "g", baseQuantityMicrounits: 1_000_000 }, { id: "100g", label: "100 g", unit: "g", baseQuantityMicrounits: 100_000_000 }],
      nutritionPerAuthoritativeBase: emptyNutrition(), originalName: food.description.normalize("NFC"), providerModifiedDate: null, catalogGeneration: options.generation,
    } };
  }
  function addFood(foods: Map<string, UsdaGenerationFood>, record: UsdaGenerationFood | null) {
    if (!record) return;
    if (foods.has(record.food.providerFoodId)) throw new ArchiveError("Duplicate FDC ID in food.csv.");
    if (foods.size >= 100_000) throw new ArchiveError("Foundation record limit exceeded.");
    foods.set(record.food.providerFoodId, record);
    importedRecords++;
  }
  function processedRecord() {
    processedRecords++;
    if (processedRecords % 2000 === 0) progress("importing");
  }
  async function validateSubtypeRecords() {
    for await (const row of foundationRows(staging, "foundation_food.csv")) {
      if (!validId(row.fdc_id)) exclude("invalid_subtype_record");
    }
  }
  async function readCategories() {
    const categories = new Map<string, UsdaGenerationCategory>();
    for await (const row of foundationRows(staging, "food_category.csv")) {
      const parsed = categorySchema.safeParse(row);
      if (!parsed.success) throw new ArchiveError("Invalid category in food_category.csv.");
      if (categories.has(parsed.data.id)) throw new ArchiveError("Duplicate category in food_category.csv.");
      categories.set(parsed.data.id, { id: parsed.data.id, name: parsed.data.description.normalize("NFC") });
    }
    if (categories.size === 0) throw new ArchiveError("Foundation archive contains no food categories.");
    return categories;
  }
  async function readFoods(categories: Map<string, UsdaGenerationCategory>) {
    const foods = new Map<string, UsdaGenerationFood>();
    for await (const row of foundationRows(staging, "food.csv")) {
      processedRecord();
      if (selectableRecordType(row.data_type)) addFood(foods, foodRecord(row, categories));
    }
    // Validate the subtype's schema without using its IDs as an inclusion whitelist.
    await validateSubtypeRecords();
    return foods;
  }
  async function readDefinitions(table: string, field: string) {
    const definitions = new Map<string, string>();
    for await (const row of foundationRows(staging, table)) {
      if (definitions.has(row.id)) throw new ArchiveError(`Duplicate definition in ${table}.`);
      definitions.set(row.id, row[field].trim());
    }
    return definitions;
  }
  function nutrientAmount(row: Record<string, string>, multiplier: number | undefined): CatalogNutrientValue | null {
    const amount = numeric(row.amount);
    if (amount === undefined || multiplier === undefined || !validId(row.id)) { exclude("invalid_nutrient"); return null; }
    return { amount, fixedPointMultiplier: multiplier };
  }
  function addNutrient(nutrients: Map<string, CatalogNutrientValue | null>, row: Record<string, string>, unit: string) {
    if (nutrients.has(row.nutrient_id)) { nutrients.set(row.nutrient_id, null); exclude("duplicate_nutrient"); return; }
    if (!row.amount.trim()) { nutrients.set(row.nutrient_id, null); return; }
    nutrients.set(row.nutrient_id, nutrientAmount(row, supportedNutrients[row.nutrient_id].units[unit]));
  }
  function foundationEnergy(nutrients: Map<string, CatalogNutrientValue | null>) {
    return ["2048", "2047", "1008"].map(id => nutrients.get(id)).find(value => value != null) ?? null;
  }
  function addFoodNutrient(values: Map<string, Map<string, CatalogNutrientValue | null>>, row: Record<string, string>, units: Map<string, string>) {
    const nutrients = values.get(row.fdc_id);
    if (nutrients && Object.hasOwn(supportedNutrients, row.nutrient_id)) addNutrient(nutrients, row, (units.get(row.nutrient_id) ?? "").toUpperCase());
  }
  function applyNutrition(food: CatalogFood, nutrients: Map<string, CatalogNutrientValue | null>) {
    for (const [nutrientId, mapping] of Object.entries(supportedNutrients).filter(([, value]) => value.field !== "energyMilliKcal")) {
      food.nutritionPerAuthoritativeBase[mapping.field] = nutrients.get(nutrientId) ?? null;
    }
    // Specific Atwater, general Atwater, then legacy calories, with unit validation above.
    const energy = foundationEnergy(nutrients);
    food.nutritionPerAuthoritativeBase.energyMilliKcal = energy;
    food.isSelectable = energy != null;
    if (!food.isSelectable) { food.measurementSummary = "Calories unavailable"; exclude("food_without_calories"); }
  }
  async function readNutrition(foods: Map<string, UsdaGenerationFood>) {
    const units = await readDefinitions("nutrient.csv", "unit_name");
    const values = new Map([...foods.keys()].map(id => [id, new Map<string, CatalogNutrientValue | null>()]));
    for await (const row of foundationRows(staging, "food_nutrient.csv")) {
      processedRecord();
      addFoodNutrient(values, row, units);
    }
    for (const [id, record] of foods) applyNutrition(record.food, values.get(id)!);
  }
  const portionSchema = z.object({
    id: idSchema, amount: numericSchema.pipe(z.number().positive()),
    gram_weight: numericSchema.pipe(z.number().positive()).transform(grams => Math.round(grams * 1_000_000)).pipe(z.number().int().positive()),
    unit: z.string().min(1).refine(value => value !== "undetermined"),
    modifier: z.string().trim(), portion_description: z.string().trim(),
  });
  function sourcePortion(row: Record<string, string>, unit: string | undefined): CatalogMeasurement | null {
    const parsed = portionSchema.safeParse({ ...row, unit });
    if (!parsed.success) return null;
    const portion = parsed.data;
    const qualifier = [portion.modifier, portion.portion_description].filter(Boolean).join(", ");
    const label = `${portion.amount} ${portion.unit}${qualifier ? `, ${qualifier}` : ""} (${portion.gram_weight / 1_000_000} g)`;
    if (label.length > 200) return null;
    return { id: `portion:${portion.id}`, label, unit: "g", baseQuantityMicrounits: portion.gram_weight };
  }
  function addPortion(food: CatalogFood, measurement: CatalogMeasurement | null) {
    if (!measurement || food.measurements.length >= 502) { exclude("invalid_portion"); return; }
    if (food.measurements.some(candidate => candidate.id === measurement.id)) { exclude("invalid_portion"); return; }
    food.measurements.push(measurement);
  }
  async function readPortions(foods: Map<string, UsdaGenerationFood>) {
    const units = await readDefinitions("measure_unit.csv", "name");
    for await (const row of foundationRows(staging, "food_portion.csv")) {
      const record = foods.get(row.fdc_id);
      if (record) addPortion(record.food, sourcePortion(row, units.get(row.measure_unit_id)));
    }
  }
  async function run() {
    progress("validating");
    await unpackFoundation(options.archivePath, staging, options.maxExpandedBytes);
    progress("importing");
    const categories = await readCategories();
    const foods = await readFoods(categories);
    await readNutrition(foods);
    await readPortions(foods);
    if (![...foods.values()].some(record => record.food.isSelectable)) throw new ArchiveError("Foundation archive contains no foods with usable calories. Nothing was installed.");
    buildLocalUsdaGeneration(options.directory, options.generation, { foods: foods.values(), categories: categories.values() }, () => progress("indexing"));
    const dates = [...foods.values()].map(record => record.food.providerPublishedDate!).sort();
    progress("indexing");
    publish({ result: { foodCount: foods.size, publicationDateRange: { earliest: dates[0], latest: dates[dates.length - 1] } } });
  }
  try { await run(); } catch (error) {
    publish({ progress: { processedRecords, importedRecords, rejectedRecords, exclusions }, error: error instanceof ArchiveError ? error.message : "Invalid or corrupt Foundation CSV ZIP, or insufficient disk space. Verify the download and retry." });
  }

}
