import { randomUUID } from "node:crypto";

import type { CatalogMeasurement, CatalogNutrientValue, CatalogNutrition } from "../../catalog/food-catalog.server";
import type { CreateFoodEvent, FoodSnapshot, ScaledNutrients } from "../food-event.model";
import { FoodEventValidationError } from "../food-event.exceptions";
import { NUTRIENT_FIELDS, nutrientFromDecimal } from "../nutrition";

export type ManualFood = Extract<CreateFoodEvent, { method: "manual" }>;

const MANUAL_MEASUREMENT: CatalogMeasurement = {
  baseQuantityMicrounits: 1_000_000,
  id: "serving",
  label: "1 serving",
  unit: "serving",
};

/** A trimmed food name of 1 to 200 characters. */
export function validFoodName(name: unknown): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed || trimmed.length > 200) {
    throw new FoodEventValidationError("invalid_input", "Enter a food name of 1 to 200 characters.");
  }
  return trimmed;
}

/**
 * A manual food's authority per serving from a total for `quantityMicrounits` servings, kept
 * unrounded so later quantity changes scale exactly; null stays unknown.
 */
export function manualAuthoritativeNutrient(
  total: number | null,
  wholeMilligrams: boolean,
  quantityMicrounits: number,
): CatalogNutrientValue | null {
  if (total === null) return null;
  const fixedPointMultiplier = wholeMilligrams ? 1 : 1_000;
  return { amount: total / fixedPointMultiplier / (quantityMicrounits / 1_000_000), fixedPointMultiplier };
}

/** An entered nutrient: blank or missing is unknown; anything else must be a valid amount. */
function enteredNutrient(value: unknown, wholeMilligrams: boolean): number | null {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return null;
  const amount = typeof value === "string" ? nutrientFromDecimal(value, wholeMilligrams) : undefined;
  if (amount === undefined) {
    throw new FoodEventValidationError(
      "invalid_nutrition",
      "Enter nutrients as non-negative amounts: up to three decimals, or whole milligrams of sodium.",
    );
  }
  return amount;
}

/**
 * The snapshot of a food entered by hand. Its nutrition is the total for the entered quantity,
 * so three servings with 180 kcal store 180 kcal; calories are required and may be zero.
 */
export function manualSnapshot(input: ManualFood, quantityMicrounits: number): FoodSnapshot {
  const originalName = validFoodName(input.name);
  const entered = typeof input.nutrition === "object" && input.nutrition !== null ? input.nutrition : undefined;
  const nutrients = {} as ScaledNutrients;
  const nutrition = {} as CatalogNutrition;
  for (const { field, nutrient, wholeMilligrams } of NUTRIENT_FIELDS) {
    const total = enteredNutrient(entered?.[field], wholeMilligrams);
    if (field === "energyKcal" && total === null) {
      throw new FoodEventValidationError("invalid_nutrition", "Enter the calories for this quantity; zero is allowed.");
    }
    nutrients[nutrient] = total;
    nutrition[nutrient] = manualAuthoritativeNutrient(total, wholeMilligrams, quantityMicrounits);
  }
  return {
    source: {
      provider: "manual",
      providerFoodId: randomUUID(),
      dataType: "User entered",
      brand: null,
      barcode: null,
      marketCountry: null,
      publishedDate: null,
      modifiedDate: null,
    },
    originalName,
    editedName: null,
    authority: { unit: "serving", quantityMicrounits: 1_000_000, nutrition },
    measurements: [MANUAL_MEASUREMENT],
    measurement: MANUAL_MEASUREMENT,
    quantityMicrounits,
    nutrients,
  };
}
