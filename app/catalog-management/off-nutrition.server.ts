import { z } from "zod";
import type { CatalogMeasurement, CatalogNutrition, CatalogNutrientValue } from "../catalog/food-catalog.server.ts";

const nutrientNames: Record<keyof CatalogNutrition, string> = {
  energyMilliKcal: "energy-kcal", proteinMilligrams: "proteins", carbohydrateMilligrams: "carbohydrates",
  fatMilligrams: "fat", fiberMilligrams: "fiber", sugarMilligrams: "sugars", sodiumMilligrams: "sodium",
};
const bases = ["100g", "100ml", "serving"] as const;
const root = "nutrition.input_sets.packaging.as_sold.";
const identityFields = new Set(["code", "product_name", "product_name_en", "product_name_es", "generic_name", "generic_name_en", "generic_name_es", "abbreviated_product_name", "abbreviated_product_name_en", "abbreviated_product_name_es", "brands", "countries", "countries_tags", "quantity", "product_quantity", "product_quantity_unit", "serving_size", "serving_quantity", "serving_quantity_unit", "created_t", "last_modified_t", "no_nutrition_data"]);
const nutrientFields = new Set([...Object.values(nutrientNames), "energy", "energy-kj"].flatMap(name => [`${name}_100g`, `${name}_serving`, ...bases.flatMap(per => ["value", "unit", "modifier"].map(field => `${root}${per}.nutrients.${name}.${field}`))]));
export function requiredOffField(field: string) { return identityFields.has(field) || nutrientFields.has(field); }
const numericSchema = z.string().regex(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/).transform(Number).pipe(z.number().nonnegative().max(Number.MAX_SAFE_INTEGER / 1_000_000));
function sourceNumber(value: string | undefined): number | null {
  const parsed = numericSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
const nutrientSchema = z.object({ amount: numericSchema, multiplier: z.number().positive(), modifier: z.literal("") });
function nutrient(amount: string | undefined, multiplier: number | undefined, modifier = ""): CatalogNutrientValue | null {
  if (!amount) return null;
  const parsed = nutrientSchema.safeParse({ amount, multiplier, modifier: modifier.trim() });
  if (!parsed.success) return null;
  return fixedPointNutrient(parsed.data);
}
function fixedPointNutrient(value: { amount: number; multiplier: number }): CatalogNutrientValue {
  if (value.multiplier === 1000 / 4.184) return { amount: value.amount / 4.184, fixedPointMultiplier: 1000 };
  return { amount: value.amount, fixedPointMultiplier: value.multiplier };
}
function inputNutrition(row: Record<string, string>, per: string): CatalogNutrition {
  const prefix = `${root}${per}.nutrients.`;
  const read = (name: string, energy: boolean) => {
    const units: Record<string, number> = energy ? { kcal: 1000, kJ: 1000 / 4.184 } : { g: 1000, mg: 1 };
    const unit = row[`${prefix}${name}.unit`];
    return nutrient(row[`${prefix}${name}.value`], Object.hasOwn(units, unit) ? units[unit] : undefined, row[`${prefix}${name}.modifier`]);
  };
  return Object.fromEntries(Object.entries(nutrientNames).map(([field, name]) => [field, field === "energyMilliKcal" ? read(name, true) ?? read("energy-kj", true) ?? read("energy", true) : read(name, false)])) as CatalogNutrition;
}
function legacyNutrition(row: Record<string, string>, suffix: string): CatalogNutrition {
  const result = Object.fromEntries(Object.entries(nutrientNames).map(([field, name]) => [field, nutrient(row[`${name}_${suffix}`], 1000)])) as CatalogNutrition;
  result.energyMilliKcal ??= nutrient(row[`energy-kj_${suffix}`], 1000 / 4.184) ?? nutrient(row[`energy_${suffix}`], 1000 / 4.184);
  return result;
}
function resolveBasis(row: Record<string, string>) {
  // Never combine different input sets or use the legacy _100g suffix as a unit.
  const explicit = bases.filter(per => Object.keys(row).some(key => key.startsWith(`${root}${per}.`) && row[key] !== ""));
  if (explicit.length > 1) return { per: null, nutrition: legacyNutrition(row, "100g"), conflict: true };
  if (explicit.length === 1) return { per: explicit[0], nutrition: inputNutrition(row, explicit[0]), conflict: false };
  const serving = legacyNutrition(row, "serving");
  return { per: serving.energyMilliKcal === null ? null : "serving", nutrition: serving, conflict: false };
}
function unavailableReason(basis: ReturnType<typeof resolveBasis>) {
  if (basis.conflict) return "conflicting_nutrition_bases";
  if (!basis.per) return "ambiguous_nutrition_basis";
  if (basis.nutrition.energyMilliKcal === null) return "calories_unavailable";
  return undefined;
}
function measurementsFor(row: Record<string, string>, unit: CatalogMeasurement["unit"]): CatalogMeasurement[] {
  if (unit === "serving") return [{ id: "serving", label: "1 serving", unit, baseQuantityMicrounits: 1_000_000 }];
  const measurements: CatalogMeasurement[] = [{ id: unit, label: `1 ${unit}`, unit, baseQuantityMicrounits: 1_000_000 }, { id: `100${unit}`, label: `100 ${unit}`, unit, baseQuantityMicrounits: 100_000_000 }];
  const serving = sourceServing(row, unit);
  if (serving) measurements.push(serving);
  return measurements;
}
function sourceServing(row: Record<string, string>, unit: "g" | "ml"): CatalogMeasurement | null {
  const serving = sourceNumber(row.serving_quantity);
  const parsed = z.object({ unit: z.literal(unit), quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).safeParse({ unit: row.serving_quantity_unit, quantity: Math.round((serving ?? 0) * 1_000_000) });
  if (!parsed.success) return null;
  return { id: "serving", label: `1 serving (${serving} ${unit})`, unit, baseQuantityMicrounits: parsed.data.quantity };
}
function authority(per: string | null) {
  const unit: CatalogMeasurement["unit"] = per === "100g" ? "g" : per === "100ml" ? "ml" : "serving";
  return { authoritativeBaseUnit: unit, authoritativeBaseQuantityMicrounits: unit === "serving" ? 1_000_000 : 100_000_000 };
}
function isNutrientValue(key: string, value: string) {
  return nutrientFields.has(key) && value !== "" && (key.endsWith("_100g") || key.endsWith("_serving") || key.endsWith(".value"));
}
function unsupportedNutrient(row: Record<string, string>, key: string) {
  const prefix = key.slice(0, -5);
  const units = key.includes(".energy") ? ["kcal", "kJ"] : ["g", "mg"];
  return !units.includes(row[prefix + "unit"]) || (row[prefix + "modifier"] ?? "").trim() !== "";
}
function countInvalidNutrients(row: Record<string, string>, exclude: (reason: string) => void) {
  for (const [key, value] of Object.entries(row)) {
    if (!isNutrientValue(key, value)) continue;
    if (sourceNumber(value) === null) exclude("invalid_nutrient_value");
    if (key.endsWith(".value") && unsupportedNutrient(row, key)) exclude("unsupported_nutrient_unit_or_modifier");
  }
}
export function offNutrition(row: Record<string, string>, exclude?: (reason: string) => void) {
  if (exclude) countInvalidNutrients(row, exclude);
  const basis = resolveBasis(row);
  const base = authority(basis.per);
  const reason = row.no_nutrition_data === "on" ? "nutrition_not_provided" : unavailableReason(basis);
  const calculation = reason ? {
    nutritionPerAuthoritativeBase: Object.fromEntries(Object.keys(nutrientNames).map(key => [key, null])) as CatalogNutrition,
    measurements: [], measurementSummary: "Nutrition basis unavailable",
  } : {
    nutritionPerAuthoritativeBase: basis.nutrition, measurements: measurementsFor(row, base.authoritativeBaseUnit),
    measurementSummary: `${base.authoritativeBaseQuantityMicrounits / 1_000_000} ${base.authoritativeBaseUnit}`,
  };
  return { ...base, ...calculation, calculationUnavailableReason: reason, isSelectable: reason === undefined };
}
