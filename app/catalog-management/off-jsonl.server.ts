import type { CatalogNutrition } from "../catalog/food-catalog.server.ts";
import { offNutrition, requiredOffField } from "./off-nutrition.server.ts";

export function offObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function scalar(value: unknown): string | null {
  if (value === null) return "";
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}
function selectedText(key: string, value: unknown) {
  if (key !== "countries_tags" || !Array.isArray(value)) return scalar(value);
  return value.every(tag => typeof tag === "string") ? value.join(",") : null;
}
function legacyNutrientField(key: string) {
  return requiredOffField(key) && /_(?:serving|100g)$/.test(key);
}
// Project before persistence: image trees, revisions and computed aggregates are never retained.
export function offJsonRow(value: unknown): { row: Record<string, string>; rejection?: string } {
  const object = offObject(value);
  const row: Record<string, string> = {};
  if (!object) return { row, rejection: "invalid_product_document" };
  for (const [key, field] of Object.entries(object)) {
    if (!requiredOffField(key)) continue;
    const selected = selectedText(key, field);
    if (selected === null) return { row, rejection: key === "code" ? "invalid_identity" : "invalid_product_field" };
    row[key] = selected;
  }
  for (const [key, field] of Object.entries(offObject(object.nutriments) ?? {})) {
    if (legacyNutrientField(key)) row[key] = scalar(field) ?? "INVALID_SOURCE_TYPE";
  }
  return { row };
}

const names = ["energy-kcal", "energy-kj", "energy", "proteins", "carbohydrates", "fat", "fiber", "sugars", "sodium"];
const numeric = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function amount(value: unknown): number {
  return typeof value === "number" || typeof value === "string" && numeric.test(value) ? Number(value) : NaN;
}
type Authority = ReturnType<typeof offNutrition>;
type Candidate = { per: "100g" | "100ml" | "serving"; quantity: number; unit: "g" | "ml"; authority: Authority };
type Exclude = (reason: string) => void;
function unavailable(reason: string): Authority {
  return { ...offNutrition({}), calculationUnavailableReason: reason, isSelectable: false };
}
function retainedNutrientField(value: unknown) {
  return typeof value === "number" || typeof value === "string" && value.length <= 100;
}
function validNutrientAmount(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER / 1_000_000;
}
function usableNutrient(nutrient: Record<string, unknown>, name: string, exclude: Exclude): number | null {
  if (nutrient.value === undefined || nutrient.value === null) return null;
  const value = amount(nutrient.value);
  if (!validNutrientAmount(value)) { exclude("invalid_nutrient_value"); return null; }
  const units = name.startsWith("energy") ? ["kcal", "kJ"] : ["g", "mg"];
  if (!units.includes(String(nutrient.unit)) || nutrient.modifier !== undefined && nutrient.modifier !== "") { exclude("unsupported_nutrient_unit_or_modifier"); return null; }
  return value;
}
function nutrientProjection(nutrients: Record<string, unknown>, basis: string, exclude: Exclude) {
  const projection: Record<string, string> = {};
  const retained: Record<string, unknown> = {};
  for (const name of names) {
    const nutrient = offObject(nutrients[name]);
    if (!nutrient) { if (nutrients[name] !== undefined) exclude("invalid_nutrient_value"); continue; }
    retained[name] = Object.fromEntries(["value", "unit", "modifier"].filter(key => retainedNutrientField(nutrient[key])).map(key => [key, nutrient[key]]));
    const n = usableNutrient(nutrient, name, exclude);
    if (n === null) continue;
    const prefix = `nutrition.input_sets.packaging.as_sold.${basis}.nutrients.${name}.`;
    projection[prefix + "value"] = String(n);
    projection[prefix + "unit"] = String(nutrient.unit);
  }
  // A set lacking usable calories is still newer authority; never fall back to legacy fields.
  projection[`nutrition.input_sets.packaging.as_sold.${basis}.nutrients.energy-kcal.value`] ??= "";
  projection[`nutrition.input_sets.packaging.as_sold.${basis}.nutrients.energy-kcal.unit`] ??= "kcal";
  return { projection, retained };
}
function validReferenceQuantity(quantity: number) {
  const microunits = Math.round(quantity * 1_000_000);
  return Number.isFinite(quantity) && quantity > 0 && Number.isSafeInteger(microunits) && microunits > 0;
}
function validReferenceDimension(per: Candidate["per"], unit: Candidate["unit"], quantity: number) {
  if (per === "serving") return true;
  return quantity === 100 && unit === (per === "100g" ? "g" : "ml");
}
function reference(set: Record<string, unknown>): Pick<Candidate, "per" | "quantity" | "unit"> | null {
  const quantity = amount(set.per_quantity);
  const per = set.per;
  const unit = set.per_unit;
  if (!(per === "100g" || per === "100ml" || per === "serving") || !(unit === "g" || unit === "ml")) return null;
  if (!validReferenceQuantity(quantity) || !validReferenceDimension(per, unit, quantity)) return null;
  return { quantity, per, unit };
}
function readSet(value: unknown, row: Record<string, string>, exclude: Exclude): { candidate?: Candidate; retained?: unknown; invalid?: boolean } {
  const set = offObject(value);
  if (!set || set.source !== "packaging" || set.preparation !== "as_sold") { exclude("unsupported_nutrition_source_or_preparation"); return {}; }
  const ref = reference(set);
  const nutrients = offObject(set.nutrients);
  if (!ref || !nutrients) { exclude("invalid_nutrition_reference"); return { invalid: true }; }
  const { projection, retained } = nutrientProjection(nutrients, ref.per, exclude);
  const authority = offNutrition({ ...projection, no_nutrition_data: row.no_nutrition_data, serving_quantity: row.serving_quantity, serving_quantity_unit: row.serving_quantity_unit });
  return { candidate: { ...ref, authority }, retained: { source: "packaging", preparation: "as_sold", per: ref.per, per_quantity: ref.quantity, per_unit: ref.unit, nutrients: retained } };
}
function preferredCandidate(candidates: Candidate[]): Candidate {
  const usable = candidates.filter(candidate => candidate.authority.isSelectable);
  const serving = usable.filter(candidate => candidate.per === "serving");
  const completeness = (candidate: Candidate) => Object.values(candidate.authority.nutritionPerAuthoritativeBase).filter(value => value !== null).length;
  return (serving.length ? serving : usable).sort((a, b) => a.per.localeCompare(b.per) || completeness(b) - completeness(a) || JSON.stringify(a.authority.nutritionPerAuthoritativeBase).localeCompare(JSON.stringify(b.authority.nutritionPerAuthoritativeBase)))[0];
}
function incompatibleReferences(chosen: Candidate, other: Candidate) {
  if (other.unit !== chosen.unit) return true;
  return other.per === "serving" && chosen.per === "serving" && other.quantity !== chosen.quantity;
}
function overlappingNutrientsConflict(chosen: Candidate, other: Candidate) {
  const nutrition = chosen.authority.nutritionPerAuthoritativeBase;
  for (const field of Object.keys(nutrition) as (keyof CatalogNutrition)[]) {
    const a = nutrition[field];
    const b = other.authority.nutritionPerAuthoritativeBase[field];
    if (!a || !b) continue;
    const normalized = (candidate: Candidate, nutrient: typeof a) => Math.round(nutrient.amount * nutrient.fixedPointMultiplier * 100 / candidate.quantity);
    if (normalized(chosen, a) !== normalized(other, b)) return true;
  }
  return false;
}
function conflicting(chosen: Candidate, other: Candidate): boolean {
  if (other === chosen || !other.authority.isSelectable) return false;
  return incompatibleReferences(chosen, other) || overlappingNutrientsConflict(chosen, other);
}

function servingAuthority(candidate: Candidate): Authority {
  if (candidate.per !== "serving") return candidate.authority;
  const quantity = Math.round(candidate.quantity * 1_000_000);
  const unit = candidate.unit;
  return {
    ...candidate.authority, authoritativeBaseUnit: unit, authoritativeBaseQuantityMicrounits: quantity,
    measurementSummary: `1 serving (${candidate.quantity} ${unit})`,
    measurements: [{ id: "serving", label: `1 serving (${candidate.quantity} ${unit})`, unit, baseQuantityMicrounits: quantity }, { id: unit, label: `1 ${unit}`, unit, baseQuantityMicrounits: 1_000_000 }, { id: `100${unit}`, label: `100 ${unit}`, unit, baseQuantityMicrounits: 100_000_000 }],
  };
}
export function offNativeNutrition(row: Record<string, string>, input: unknown, exclude: (reason: string) => void): ReturnType<typeof offNutrition> {
  if (!Array.isArray(input) || input.length > 100) return unavailable("invalid_nutrition_input_sets");
  const sets = input.map(value => readSet(value, row, exclude));
  row["nutrition.input_sets"] = JSON.stringify(sets.flatMap(set => set.retained ? [set.retained] : []));
  if (row.no_nutrition_data === "on") return unavailable("nutrition_not_provided");
  if (sets.some(set => set.invalid)) return unavailable("invalid_nutrition_reference");
  const candidates = sets.flatMap(set => set.candidate ? [set.candidate] : []);
  if (!candidates.length) return unavailable("unsupported_nutrition_authority");
  if (!candidates.some(candidate => candidate.authority.isSelectable)) return unavailable("calories_unavailable");
  const chosen = preferredCandidate(candidates);
  if (candidates.some(other => conflicting(chosen, other))) return unavailable("conflicting_nutrition_bases");
  return servingAuthority(chosen);
}


export async function* offJsonLines(chunks: AsyncIterable<Buffer>, maxBytes: number) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let parts: Buffer[] = [];
  let bytes = 0;
  function takeLine() {
    const text = decoder.decode(Buffer.concat(parts, bytes)).replace(/^\uFEFF/, "").trim();
    parts = []; bytes = 0;
    return text;
  }
  function append(part: Buffer) {
    bytes += part.length;
    if (bytes > maxBytes) throw new Error("OFF_DOCUMENT_LIMIT");
    parts.push(part);
  }
  for await (const chunk of chunks) {
    let start = 0;
    for (let end = chunk.indexOf(10); end >= 0; end = chunk.indexOf(10, start)) {
      append(chunk.subarray(start, end));
      const text = takeLine(); if (text) yield text;
      start = end + 1;
    }
    append(chunk.subarray(start));
  }
  if (bytes) { const text = takeLine(); if (text) yield text; }
}
