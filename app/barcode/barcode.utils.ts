import type {
  CatalogFood,
  CatalogMeasurement,
  CatalogNutrientValue,
  CatalogNutrition,
} from "../catalog/food-catalog.server";
import type { OffNutrient, OffNutritionInputSet, OffProduct } from "./barcode.model";

const supportedCommercialBarcodeLengths = new Set([7, 8, 12, 13, 14]);
const gtinLengths = new Set([8, 12, 13, 14]);

export function isSupportedCommercialBarcode(value: string): boolean {
  return !/\D/.test(value) && supportedCommercialBarcodeLengths.has(value.length);
}

function matchesGtinCheckDigit(value: string): boolean {
  if (!/^\d+$/.test(value) || !gtinLengths.has(value.length)) return false;

  const payload = value.slice(0, -1);
  let sum = 0;
  let weight = 3;
  for (let index = payload.length - 1; index >= 0; index -= 1) {
    sum += Number(payload[index]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  const expected = (10 - (sum % 10)) % 10;
  return expected === Number(value.at(-1));
}

function expandUpce(value: string): string | undefined {
  if (!/^\d{8}$/.test(value) || (value[0] !== "0" && value[0] !== "1")) {
    return undefined;
  }

  const [numberSystem, first, second, third, fourth, fifth, sixth, check] = value;
  if (sixth === "0" || sixth === "1" || sixth === "2") {
    return `${numberSystem}${first}${second}${sixth}00` +
      `00${third}${fourth}${fifth}${check}`;
  }
  if (sixth === "3") {
    return `${numberSystem}${first}${second}${third}00` +
      `000${fourth}${fifth}${check}`;
  }
  if (sixth === "4") {
    return `${numberSystem}${first}${second}${third}${fourth}0` +
      `0000${fifth}${check}`;
  }
  // For UPC-E values ending in 5–9, the EAN-8 and expanded UPC-A check
  // calculations are identical, so matchesGtinCheckDigit already handled them.
  return undefined;
}

export function hasValidGtinCheckDigit(value: string): boolean {
  if (matchesGtinCheckDigit(value)) return true;
  const expandedUpce = expandUpce(value);
  return expandedUpce !== undefined && matchesGtinCheckDigit(expandedUpce);
}

type OffFood = Omit<CatalogFood, "catalogGeneration">;
type OffNutritionAuthority = Pick<
  CatalogFood,
  | "authoritativeBaseQuantityMicrounits"
  | "authoritativeBaseUnit"
  | "calculationUnavailableReason"
  | "isSelectable"
  | "measurementSummary"
  | "measurements"
  | "nutritionPerAuthoritativeBase"
>;
type NutritionBasis = "100g" | "100ml" | "serving";
type ReferenceUnit = "g" | "ml";
type Candidate = {
  authority: OffNutritionAuthority;
  per: NutritionBasis;
  quantity: number;
  unit: ReferenceUnit;
};

const nutrientNames: Record<keyof CatalogNutrition, string> = {
  carbohydrateMilligrams: "carbohydrates",
  energyMilliKcal: "energy-kcal",
  fatMilligrams: "fat",
  fiberMilligrams: "fiber",
  proteinMilligrams: "proteins",
  sodiumMilligrams: "sodium",
  sugarMilligrams: "sugars",
};
const energyMultipliers: Record<string, number> = { kcal: 1000, kJ: 1000 / 4.184 };
const massMultipliers: Record<string, number> = { g: 1000, mg: 1 };
const decimalPattern = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const MAXIMUM_INPUT_SETS = 100;

/** A finite non-negative decimal small enough to scale to microunits, or null. */
function decimal(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (!decimalPattern.test(text)) return null;
  const number = Number(text);
  return number <= Number.MAX_SAFE_INTEGER / 1_000_000 ? number : null;
}

function amount(value: number | string | null | undefined): number {
  return typeof value === "number" || (typeof value === "string" && decimalPattern.test(value))
    ? Number(value)
    : NaN;
}

function emptyNutrition(): CatalogNutrition {
  return Object.fromEntries(Object.keys(nutrientNames).map((field) => [field, null])) as CatalogNutrition;
}

function unavailable(reason: string): OffNutritionAuthority {
  return {
    authoritativeBaseQuantityMicrounits: 1_000_000,
    authoritativeBaseUnit: "serving",
    calculationUnavailableReason: reason,
    isSelectable: false,
    measurementSummary: "Nutrition basis unavailable",
    measurements: [],
    nutritionPerAuthoritativeBase: emptyNutrition(),
  };
}

/** A declared nutrient as fixed-point milli-units, or null when its value, unit or modifier is unusable. */
function labelNutrient(nutrient: OffNutrient | null | undefined, energy: boolean): CatalogNutrientValue | null {
  if (!nutrient || nutrient.value === null || nutrient.value === undefined) return null;
  const value = decimal(nutrient.value);
  const multipliers = energy ? energyMultipliers : massMultipliers;
  if (value === null || !nutrient.unit || !Object.hasOwn(multipliers, nutrient.unit)) return null;
  if (nutrient.modifier !== undefined && nutrient.modifier !== "") return null;
  const multiplier = multipliers[nutrient.unit];
  return multiplier === 1000 / 4.184
    ? { amount: value / 4.184, fixedPointMultiplier: 1000 }
    : { amount: value, fixedPointMultiplier: multiplier };
}

function setNutrition(nutrients: Record<string, OffNutrient | null>): CatalogNutrition {
  const nutrition = emptyNutrition();
  for (const [field, name] of Object.entries(nutrientNames) as [keyof CatalogNutrition, string][]) {
    nutrition[field] = field === "energyMilliKcal"
      ? labelNutrient(nutrients["energy-kcal"], true)
        ?? labelNutrient(nutrients["energy-kj"], true)
        ?? labelNutrient(nutrients.energy, true)
      : labelNutrient(nutrients[name], false);
  }
  return nutrition;
}

function validReferenceQuantity(quantity: number): boolean {
  const microunits = Math.round(quantity * 1_000_000);
  return Number.isFinite(quantity) && quantity > 0 && Number.isSafeInteger(microunits) && microunits > 0;
}

function reference(set: OffNutritionInputSet): Pick<Candidate, "per" | "quantity" | "unit"> | null {
  const quantity = amount(set.per_quantity);
  const { per, per_unit: unit } = set;
  if (!(per === "100g" || per === "100ml" || per === "serving") || !(unit === "g" || unit === "ml")) return null;
  if (!validReferenceQuantity(quantity)) return null;
  if (per !== "serving" && (quantity !== 100 || unit !== (per === "100g" ? "g" : "ml"))) return null;
  return { per, quantity, unit };
}

/** The product's own serving size in the authority's unit, as a selectable measurement. */
function productServing(product: OffProduct, unit: ReferenceUnit): CatalogMeasurement | null {
  const serving = decimal(product.serving_quantity);
  const microunits = Math.round((serving ?? 0) * 1_000_000);
  if (product.serving_quantity_unit !== unit || !Number.isSafeInteger(microunits) || microunits <= 0) return null;
  return { id: "serving", label: `1 serving (${serving} ${unit})`, unit, baseQuantityMicrounits: microunits };
}

function setAuthority(product: OffProduct, per: NutritionBasis, nutrition: CatalogNutrition): OffNutritionAuthority {
  const unit = per === "100g" ? "g" : per === "100ml" ? "ml" : "serving";
  const base = {
    authoritativeBaseQuantityMicrounits: unit === "serving" ? 1_000_000 : 100_000_000,
    authoritativeBaseUnit: unit,
  } as const;
  if (nutrition.energyMilliKcal === null) {
    return { ...unavailable("calories_unavailable"), ...base };
  }
  const measurements: CatalogMeasurement[] = unit === "serving"
    ? [{ id: "serving", label: "1 serving", unit, baseQuantityMicrounits: 1_000_000 }]
    : [
        { id: unit, label: `1 ${unit}`, unit, baseQuantityMicrounits: 1_000_000 },
        { id: `100${unit}`, label: `100 ${unit}`, unit, baseQuantityMicrounits: 100_000_000 },
      ];
  const serving = unit === "serving" ? null : productServing(product, unit);
  if (serving) measurements.push(serving);
  return {
    ...base,
    calculationUnavailableReason: undefined,
    isSelectable: true,
    measurementSummary: `${base.authoritativeBaseQuantityMicrounits / 1_000_000} ${unit}`,
    measurements,
    nutritionPerAuthoritativeBase: nutrition,
  };
}

/** A packaging, as-sold table as a candidate authority; unsupported tables are skipped, malformed ones invalid. */
function readSet(product: OffProduct, set: OffNutritionInputSet | null): Candidate | "invalid" | null {
  if (!set || set.source !== "packaging" || set.preparation !== "as_sold") return null;
  const ref = reference(set);
  if (!ref || !set.nutrients) return "invalid";
  return { ...ref, authority: setAuthority(product, ref.per, setNutrition(set.nutrients)) };
}

function completeness(candidate: Candidate): number {
  return Object.values(candidate.authority.nutritionPerAuthoritativeBase).filter((value) => value !== null).length;
}

/** Per-100 before serving, then the most complete table, then a stable tie-break. */
function preferredCandidate(candidates: Candidate[]): Candidate {
  return [...candidates].sort((a, b) =>
    a.per.localeCompare(b.per)
    || completeness(b) - completeness(a)
    || JSON.stringify(a.authority.nutritionPerAuthoritativeBase)
      .localeCompare(JSON.stringify(b.authority.nutritionPerAuthoritativeBase)))[0];
}

/** Usable serving tables outrank per-100 ones; otherwise per-100 tables matching the product serving unit win. */
function authoritativeCandidates(product: OffProduct, candidates: Candidate[]): Candidate[] {
  const usable = candidates.filter((candidate) => candidate.authority.isSelectable);
  const serving = usable.filter((candidate) => candidate.per === "serving");
  if (serving.length) return serving;
  const unit = product.serving_quantity_unit;
  if (validReferenceQuantity(amount(product.serving_quantity)) && (unit === "g" || unit === "ml")) {
    const matching = usable.filter((candidate) => candidate.unit === unit);
    if (matching.length) return matching;
  }
  return usable;
}

function overlappingNutrientsConflict(chosen: Candidate, other: Candidate): boolean {
  const nutrition = chosen.authority.nutritionPerAuthoritativeBase;
  for (const field of Object.keys(nutrition) as (keyof CatalogNutrition)[]) {
    const a = nutrition[field];
    const b = other.authority.nutritionPerAuthoritativeBase[field];
    if (!a || !b) continue;
    const normalized = (candidate: Candidate, nutrient: CatalogNutrientValue) =>
      Math.round(nutrient.amount * nutrient.fixedPointMultiplier * 100 / candidate.quantity);
    if (normalized(chosen, a) !== normalized(other, b)) return true;
  }
  return false;
}

function conflicting(chosen: Candidate, other: Candidate): boolean {
  if (other === chosen || !other.authority.isSelectable) return false;
  if (other.unit !== chosen.unit) return true;
  if (other.per === "serving" && chosen.per === "serving" && other.quantity !== chosen.quantity) return true;
  return overlappingNutrientsConflict(chosen, other);
}

/** A serving table expressed in its own mass or volume, so g/ml amounts can be logged too. */
function servingAuthority(candidate: Candidate): OffNutritionAuthority {
  if (candidate.per !== "serving") return candidate.authority;
  const quantity = Math.round(candidate.quantity * 1_000_000);
  const { unit } = candidate;
  const label = `1 serving (${candidate.quantity} ${unit})`;
  return {
    ...candidate.authority,
    authoritativeBaseQuantityMicrounits: quantity,
    authoritativeBaseUnit: unit,
    measurementSummary: label,
    measurements: [
      { id: "serving", label, unit, baseQuantityMicrounits: quantity },
      { id: unit, label: `1 ${unit}`, unit, baseQuantityMicrounits: 1_000_000 },
      { id: `100${unit}`, label: `100 ${unit}`, unit, baseQuantityMicrounits: 100_000_000 },
    ],
  };
}

/**
 * The label nutrition authority: only packaging, as-sold tables count; estimates, prepared values and
 * computed fields never do, and disagreeing tables make the product unselectable.
 */
function labelNutrition(product: OffProduct): OffNutritionAuthority {
  const input = product.nutrition?.input_sets;
  if (!Array.isArray(input) || input.length > MAXIMUM_INPUT_SETS) return unavailable("invalid_nutrition_input_sets");
  const sets = input.map((set) => readSet(product, set));
  if (product.no_nutrition_data === "on" || product.no_nutrition_data === true) return unavailable("nutrition_not_provided");
  if (sets.includes("invalid")) return unavailable("invalid_nutrition_reference");
  const candidates = sets.filter((set): set is Candidate => set !== null && set !== "invalid");
  if (!candidates.length) return unavailable("unsupported_nutrition_authority");
  if (!candidates.some((candidate) => candidate.authority.isSelectable)) return unavailable("calories_unavailable");
  const authoritative = authoritativeCandidates(product, candidates);
  const chosen = preferredCandidate(authoritative);
  if (authoritative.some((other) => conflicting(chosen, other))) return unavailable("conflicting_nutrition_bases");
  return servingAuthority(chosen);
}

function text(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

/** An ISO instant from Unix seconds, or null when OFF sent nothing plausible. */
function sourceDate(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds < 0 || seconds > 99_999_999_999) return null;
  const timestamp = seconds * 1000;
  return timestamp <= Date.now() ? new Date(timestamp).toISOString() : null;
}

/**
 * The catalog food for an OFF product, or null when it must be treated as not found: an unsupported
 * code, oversized text, or nutrition that is neither selectable nor only conflicting.
 */
export function offNutrition(product: OffProduct): OffFood | null {
  const code = product.code.trim();
  const name = text(product.product_name) ?? text(product.product_name_en) ?? text(product.product_name_es) ?? "Unnamed product";
  const brand = text(product.brands);
  const marketCountry = text(product.countries);
  if (name.length > 500 || (brand?.length ?? 0) > 500 || (marketCountry?.length ?? 0) > 2000) return null;
  const nutrition = labelNutrition(product);
  const reason = isSupportedCommercialBarcode(code) ? nutrition.calculationUnavailableReason : "unsupported_barcode";
  if (reason !== undefined && reason !== "conflicting_nutrition_bases") return null;
  return {
    ...nutrition,
    barcode: code,
    brand,
    calculationUnavailableReason: reason,
    dataType: "Open Food Facts",
    isSelectable: reason === undefined,
    marketCountry,
    name,
    originalName: name,
    provider: "open-food-facts",
    providerFoodId: code,
    providerModifiedDate: sourceDate(product.last_modified_t),
    providerPublishedDate: sourceDate(product.created_t),
  };
}
