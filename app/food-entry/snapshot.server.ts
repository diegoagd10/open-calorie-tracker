import { foodEntries } from "../database/schema.server";
import type { CatalogNutrientValue } from "../catalog/food-catalog.server";

type FoodEntryRow = typeof foodEntries.$inferSelect;

function decimalFraction(value: number): {
  denominator: bigint;
  numerator: bigint;
} {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!match) throw new Error("Catalog nutrient is invalid");
  const fractionLength = match[2]?.length ?? 0;
  const exponent = Number(match[3] ?? "0") - fractionLength;
  const digits = BigInt(`${match[1]}${match[2] ?? ""}`);
  if (exponent >= 0) {
    return { denominator: 1n, numerator: digits * 10n ** BigInt(exponent) };
  }
  return { denominator: 10n ** BigInt(-exponent), numerator: digits };
}

export function scaleCatalogNutrient(
  value: CatalogNutrientValue | null,
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
  if (!Number.isSafeInteger(result))
    throw new Error("Food Entry exceeds storage limits");
  return result;
}

export function foodEntrySnapshot(row: FoodEntryRow) {
  return {
    barcode: row.barcode,
    brand: row.brand,
    carbohydrateMilligrams: row.carbohydrateMilligrams,
    createdAt: row.createdAt,
    dataType: row.sourceDataType,
    energyMilliKcal: row.energyMilliKcal,
    fatMilligrams: row.fatMilligrams,
    fiberMilligrams: row.fiberMilligrams,
    foodLogDate: row.foodLogDate,
    id: row.id,
    localEventTime: row.localEventTime,
    marketCountry: row.marketCountry,
    name: row.originalName,
    proteinMilligrams: row.proteinMilligrams,
    provider: row.provider,
    providerFoodId: row.providerFoodId,
    providerModifiedDate: row.providerModifiedDate,
    providerPublishedDate: row.providerPublishedDate,
    quantityMicrounits: row.quantityMicrounits,
    selectedMeasurementId: row.selectedMeasurementId,
    selectedMeasurementLabel: row.selectedMeasurementLabel,
    selectedMeasurementUnit: row.selectedMeasurementUnit,
    sodiumMilligrams: row.sodiumMilligrams,
    sugarMilligrams: row.sugarMilligrams,
    updatedAt: row.updatedAt,
  };
}
