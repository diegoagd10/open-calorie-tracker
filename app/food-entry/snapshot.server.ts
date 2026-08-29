import { foodEntries } from "../database/schema.server";

type FoodEntryRow = typeof foodEntries.$inferSelect;

function scaleNutrient(
  value: number | null,
  measurementBaseQuantityMicrounits: number,
  quantityMicrounits: number,
  authoritativeBaseQuantityMicrounits: number,
): number | null {
  if (value === null) return null;
  const denominator = BigInt(authoritativeBaseQuantityMicrounits) * 1_000_000n;
  const numerator =
    BigInt(value) *
    BigInt(measurementBaseQuantityMicrounits) *
    BigInt(quantityMicrounits);
  const scaled = (numerator + denominator / 2n) / denominator;
  const result = Number(scaled);
  if (!Number.isSafeInteger(result))
    throw new Error("Food Entry exceeds storage limits");
  return result;
}

export function foodEntrySnapshot(row: FoodEntryRow) {
  const scale = (value: number | null) =>
    scaleNutrient(
      value,
      row.selectedMeasurementBaseQuantityMicrounits,
      row.quantityMicrounits,
      row.authoritativeBaseQuantityMicrounits,
    );

  return {
    barcode: row.barcode,
    brand: row.brand,
    carbohydrateMilligrams: scale(row.authoritativeCarbohydrateMilligrams),
    createdAt: row.createdAt,
    dataType: row.sourceDataType,
    energyMilliKcal: scale(row.authoritativeEnergyMilliKcal),
    fatMilligrams: scale(row.authoritativeFatMilligrams),
    fiberMilligrams: scale(row.authoritativeFiberMilligrams),
    foodLogDate: row.foodLogDate,
    id: row.id,
    localEventTime: row.localEventTime,
    marketCountry: row.marketCountry,
    name: row.originalName,
    proteinMilligrams: scale(row.authoritativeProteinMilligrams),
    provider: row.provider,
    providerFoodId: row.providerFoodId,
    providerModifiedDate: row.providerModifiedDate,
    providerPublishedDate: row.providerPublishedDate,
    quantityMicrounits: row.quantityMicrounits,
    selectedMeasurementId: row.selectedMeasurementId,
    selectedMeasurementLabel: row.selectedMeasurementLabel,
    selectedMeasurementUnit: row.selectedMeasurementUnit,
    sodiumMilligrams: scale(row.authoritativeSodiumMilligrams),
    sugarMilligrams: scale(row.authoritativeSugarMilligrams),
    updatedAt: row.updatedAt,
  };
}
