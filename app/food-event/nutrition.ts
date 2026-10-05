import type { CatalogMeasurement } from "../catalog/food-catalog.server";
import type {
  AuthoritativeNutrition,
  Nutrient,
  NutrientField,
  NutritionTotals,
  ScaledNutrients,
} from "./food-event.model";

/** Fixed-point nutrition math shared by the server rules and the browser previews. */

export type AuthoritativeNutrientValue = {
  amount: number;
  fixedPointMultiplier: number;
};

function decimalFraction(value: number): {
  denominator: bigint;
  numerator: bigint;
} {
  const text = String(value).toLowerCase();
  const exponentMarker = text.indexOf("e");
  const coefficient =
    exponentMarker === -1 ? text : text.slice(0, exponentMarker);
  const scientificExponent =
    exponentMarker === -1 ? 0 : Number(text.slice(exponentMarker + 1));
  const decimalPoint = coefficient.indexOf(".");
  const fractionLength =
    decimalPoint === -1 ? 0 : coefficient.length - decimalPoint - 1;
  const digits = BigInt(
    decimalPoint === -1
      ? coefficient
      : coefficient.slice(0, decimalPoint) + coefficient.slice(decimalPoint + 1),
  );
  const exponent = scientificExponent - fractionLength;
  return {
    denominator: 10n ** BigInt(Math.max(-exponent, 0)),
    numerator: digits * 10n ** BigInt(Math.max(exponent, 0)),
  };
}

export function quantityMicrounitsFromDecimal(value: string): number | undefined {
  const match = /^(\d{1,2})(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!match) return undefined;
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(6, "0"));
  const result = whole * 1_000_000n + fraction;
  if (result <= 0n || result > 99_000_000n) return undefined;
  return Number(result);
}

export function scaleCatalogNutrient(
  value: AuthoritativeNutrientValue | null,
  measurementBaseQuantityMicrounits: number,
  quantityMicrounits: number,
  authoritativeBaseQuantityMicrounits: number,
): number | null {
  if (value === null) return null;
  if (
    !Number.isFinite(value.amount) ||
    value.amount < 0 ||
    !Number.isSafeInteger(value.fixedPointMultiplier) ||
    value.fixedPointMultiplier <= 0
  ) {
    throw new Error("Catalog nutrient is invalid");
  }
  const amount = decimalFraction(value.amount);
  const denominator =
    amount.denominator *
    BigInt(authoritativeBaseQuantityMicrounits) *
    1_000_000n;
  const numerator =
    amount.numerator *
    BigInt(value.fixedPointMultiplier) *
    BigInt(measurementBaseQuantityMicrounits) *
    BigInt(quantityMicrounits);
  const scaled = (numerator + denominator / 2n) / denominator;
  const result = Number(scaled);
  if (!Number.isSafeInteger(result)) {
    throw new Error("Food Event exceeds storage limits");
  }
  return result;
}

/** Each entered nutrient: its stored nutrient, its form label, and whether it is whole milligrams. */
export const NUTRIENT_FIELDS = [
  { field: "energyKcal", nutrient: "energyMilliKcal", label: "Calories (kcal)", wholeMilligrams: false },
  { field: "proteinGrams", nutrient: "proteinMilligrams", label: "Protein (g)", wholeMilligrams: false },
  { field: "carbohydrateGrams", nutrient: "carbohydrateMilligrams", label: "Carbohydrate (g)", wholeMilligrams: false },
  { field: "fatGrams", nutrient: "fatMilligrams", label: "Fat (g)", wholeMilligrams: false },
  { field: "fiberGrams", nutrient: "fiberMilligrams", label: "Fiber (g)", wholeMilligrams: false },
  { field: "sugarGrams", nutrient: "sugarMilligrams", label: "Sugar (g)", wholeMilligrams: false },
  { field: "sodiumMilligrams", nutrient: "sodiumMilligrams", label: "Sodium (mg)", wholeMilligrams: true },
] as const satisfies readonly { field: NutrientField; nutrient: Nutrient; label: string; wholeMilligrams: boolean }[];

const NUTRIENTS = NUTRIENT_FIELDS.map(({ nutrient }) => nutrient);

/**
 * The stored amount for entered decimal text: milli-units with up to three decimals, or whole
 * milligrams of sodium. Undefined when the text is not such an amount.
 */
export function nutrientFromDecimal(value: string, wholeMilligrams: boolean): number | undefined {
  const match = wholeMilligrams
    ? /^(\d{1,7})$/.exec(value.trim())
    : /^(\d{1,6})(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (!match) return undefined;
  if (wholeMilligrams) return Number(match[1]);
  return Number(BigInt(match[1]) * 1_000n + BigInt((match[2] ?? "").padEnd(3, "0")));
}

/** A stored amount as the decimal text a form shows, or empty text when it is unknown. */
export function nutrientToDecimal(value: number | null, wholeMilligrams = false): string {
  if (value === null) return "";
  if (wholeMilligrams) return String(value);
  const whole = Math.floor(value / 1_000);
  const fraction = String(value % 1_000).padStart(3, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/** Nutrients for `quantityMicrounits` of `measurement`, rounded once from the unrounded authority. */
export function scaleNutrients(
  authority: AuthoritativeNutrition,
  measurement: Pick<CatalogMeasurement, "baseQuantityMicrounits">,
  quantityMicrounits: number,
): ScaledNutrients {
  return Object.fromEntries(NUTRIENTS.map((nutrient) => [
    nutrient,
    scaleCatalogNutrient(
      authority.nutrition[nutrient],
      measurement.baseQuantityMicrounits,
      quantityMicrounits,
      authority.quantityMicrounits,
    ),
  ])) as ScaledNutrients;
}

/** Known sums per nutrient; a nutrient is incomplete when any item does not know it. */
export function nutritionTotals(items: readonly ScaledNutrients[]): NutritionTotals {
  return Object.fromEntries(NUTRIENTS.map((nutrient) => {
    let known = 0;
    let isIncomplete = false;
    for (const item of items) {
      const value = item[nutrient];
      if (value === null) isIncomplete = true;
      else known += value;
    }
    return [nutrient, { known, isIncomplete }];
  })) as NutritionTotals;
}
