import { z } from "zod";

import type {
  CatalogMeasurement,
  CatalogNutrition,
} from "../catalog/food-catalog.server";
import { foodEntries } from "../database/schema.server";

export { scaleCatalogNutrient } from "./nutrition";

type FoodEntryRow = typeof foodEntries.$inferSelect;

const catalogNutrientValueSchema = z.object({
  amount: z.number().finite().nonnegative(),
  fixedPointMultiplier: z.number().int().positive(),
});
const catalogNutritionSchema = z.object({
  carbohydrateMilligrams: catalogNutrientValueSchema.nullable(),
  energyMilliKcal: catalogNutrientValueSchema.nullable(),
  fatMilligrams: catalogNutrientValueSchema.nullable(),
  fiberMilligrams: catalogNutrientValueSchema.nullable(),
  proteinMilligrams: catalogNutrientValueSchema.nullable(),
  sodiumMilligrams: catalogNutrientValueSchema.nullable(),
  sugarMilligrams: catalogNutrientValueSchema.nullable(),
});
const catalogMeasurementSchema = z.object({
  baseQuantityMicrounits: z.number().int().positive(),
  id: z.string().min(1).max(128),
  label: z.string().min(1).max(200),
  unit: z.enum(["g", "ml"]),
});
const catalogMeasurementsSchema = z.array(catalogMeasurementSchema).min(1);

export function serializeCatalogNutrition(value: CatalogNutrition): string {
  return JSON.stringify(catalogNutritionSchema.parse(value));
}

export function parseCatalogNutrition(value: string): CatalogNutrition {
  return catalogNutritionSchema.parse(JSON.parse(value));
}

export function serializeCatalogMeasurements(
  value: CatalogMeasurement[],
): string {
  return JSON.stringify(catalogMeasurementsSchema.parse(value));
}

function parseCatalogMeasurements(row: FoodEntryRow): CatalogMeasurement[] {
  const parsed = z
    .array(catalogMeasurementSchema)
    .safeParse(JSON.parse(row.supportedMeasurements));
  if (parsed.success && parsed.data.length) return parsed.data;

  const measurements: CatalogMeasurement[] = [
    {
      baseQuantityMicrounits: row.selectedMeasurementBaseQuantityMicrounits,
      id: row.selectedMeasurementId,
      label: row.selectedMeasurementLabel,
      unit: row.selectedMeasurementUnit as "g" | "ml",
    },
  ];
  const baseId = `base:${row.authoritativeBaseUnit}:${row.authoritativeBaseQuantityMicrounits}`;
  if (!measurements.some((measurement) => measurement.id === baseId)) {
    measurements.push({
      baseQuantityMicrounits: row.authoritativeBaseQuantityMicrounits,
      id: baseId,
      label: `${row.authoritativeBaseQuantityMicrounits / 1_000_000} ${row.authoritativeBaseUnit}`,
      unit: row.authoritativeBaseUnit as "g" | "ml",
    });
  }
  return measurements;
}

export function foodEntrySnapshot(row: FoodEntryRow) {
  return {
    authoritativeBaseQuantityMicrounits:
      row.authoritativeBaseQuantityMicrounits,
    authoritativeBaseUnit: row.authoritativeBaseUnit,
    authoritativeNutrition: parseCatalogNutrition(row.authoritativeNutrition),
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
    name: row.editedName ?? row.originalName,
    originalName: row.originalName,
    proteinMilligrams: row.proteinMilligrams,
    provider: row.provider,
    providerFoodId: row.providerFoodId,
    providerModifiedDate: row.providerModifiedDate,
    providerPublishedDate: row.providerPublishedDate,
    quantityMicrounits: row.quantityMicrounits,
    selectedMeasurementId: row.selectedMeasurementId,
    selectedMeasurementLabel: row.selectedMeasurementLabel,
    selectedMeasurementUnit: row.selectedMeasurementUnit,
    supportedMeasurements: parseCatalogMeasurements(row),
    sodiumMilligrams: row.sodiumMilligrams,
    sugarMilligrams: row.sugarMilligrams,
    updatedAt: row.updatedAt,
  };
}
