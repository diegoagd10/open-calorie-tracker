import { z } from "zod";

import type { CatalogMeasurement, CatalogNutrition } from "../catalog/food-catalog.server";
import type { Favorite, FoodEvent, FoodProvider, FoodSnapshot } from "./food-event.model";
import type { favoriteFoods, foodEvents } from "./food-event.schema.server";

/** Stored JSON ↔ `FoodSnapshot`, for event rows and the legacy flat favorite payload. */

export type FoodEventRow = typeof foodEvents.$inferSelect;
export type FavoriteRow = typeof favoriteFoods.$inferSelect;

/** The snapshot columns of a Food Event row, which a favorite's JSON also holds. */
export type SnapshotColumns = Omit<
  FoodEventRow,
  "id" | "userId" | "logDate" | "sourceFavoriteId" | "copiedFromEventId" | "createdAt" | "updatedAt"
>;

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
  unit: z.enum(["g", "ml", "serving"]),
});

function serializeCatalogNutrition(value: CatalogNutrition): string {
  return JSON.stringify(catalogNutritionSchema.parse(value));
}

function parseCatalogNutrition(value: string): CatalogNutrition {
  return catalogNutritionSchema.parse(JSON.parse(value));
}

export function serializeCatalogMeasurements(value: CatalogMeasurement[]): string {
  return JSON.stringify(z.array(catalogMeasurementSchema).min(1).parse(value));
}

/** The stored measurements, or the selected and base measurements when none were stored. */
function parseCatalogMeasurements(row: SnapshotColumns): CatalogMeasurement[] {
  const parsed = z.array(catalogMeasurementSchema).safeParse(JSON.parse(row.supportedMeasurements));
  if (parsed.success && parsed.data.length) return parsed.data;

  const measurements: CatalogMeasurement[] = [selectedMeasurement(row)];
  const baseId = `base:${row.authoritativeBaseUnit}:${row.authoritativeBaseQuantityMicrounits}`;
  if (row.selectedMeasurementId !== baseId) {
    measurements.push({
      baseQuantityMicrounits: row.authoritativeBaseQuantityMicrounits,
      id: baseId,
      label: `${row.authoritativeBaseQuantityMicrounits / 1_000_000} ${row.authoritativeBaseUnit}`,
      unit: row.authoritativeBaseUnit as CatalogMeasurement["unit"],
    });
  }
  return measurements;
}

function selectedMeasurement(row: SnapshotColumns): CatalogMeasurement {
  return {
    baseQuantityMicrounits: row.selectedMeasurementBaseQuantityMicrounits,
    id: row.selectedMeasurementId,
    label: row.selectedMeasurementLabel,
    unit: row.selectedMeasurementUnit as CatalogMeasurement["unit"],
  };
}

export function snapshotFromColumns(row: SnapshotColumns): FoodSnapshot {
  return {
    source: {
      provider: row.provider as FoodProvider,
      providerFoodId: row.providerFoodId,
      dataType: row.sourceDataType,
      brand: row.brand,
      barcode: row.barcode,
      marketCountry: row.marketCountry,
      publishedDate: row.providerPublishedDate,
      modifiedDate: row.providerModifiedDate,
    },
    originalName: row.originalName,
    editedName: row.editedName,
    authority: {
      unit: row.authoritativeBaseUnit as CatalogMeasurement["unit"],
      quantityMicrounits: row.authoritativeBaseQuantityMicrounits,
      nutrition: parseCatalogNutrition(row.authoritativeNutrition),
    },
    measurements: parseCatalogMeasurements(row),
    measurement: selectedMeasurement(row),
    quantityMicrounits: row.quantityMicrounits,
    nutrients: {
      energyMilliKcal: row.energyMilliKcal,
      proteinMilligrams: row.proteinMilligrams,
      carbohydrateMilligrams: row.carbohydrateMilligrams,
      fatMilligrams: row.fatMilligrams,
      fiberMilligrams: row.fiberMilligrams,
      sugarMilligrams: row.sugarMilligrams,
      sodiumMilligrams: row.sodiumMilligrams,
    },
  };
}

/** The row columns for a snapshot, in the key order favorites have always been stored with. */
export function snapshotColumns(snapshot: FoodSnapshot): SnapshotColumns {
  return {
    authoritativeBaseQuantityMicrounits: snapshot.authority.quantityMicrounits,
    authoritativeBaseUnit: snapshot.authority.unit,
    authoritativeNutrition: serializeCatalogNutrition(snapshot.authority.nutrition),
    barcode: snapshot.source.barcode,
    brand: snapshot.source.brand,
    carbohydrateMilligrams: snapshot.nutrients.carbohydrateMilligrams,
    editedName: snapshot.editedName,
    energyMilliKcal: snapshot.nutrients.energyMilliKcal,
    fatMilligrams: snapshot.nutrients.fatMilligrams,
    fiberMilligrams: snapshot.nutrients.fiberMilligrams,
    marketCountry: snapshot.source.marketCountry,
    originalName: snapshot.originalName,
    proteinMilligrams: snapshot.nutrients.proteinMilligrams,
    provider: snapshot.source.provider,
    providerFoodId: snapshot.source.providerFoodId,
    providerModifiedDate: snapshot.source.modifiedDate,
    providerPublishedDate: snapshot.source.publishedDate,
    quantityMicrounits: snapshot.quantityMicrounits,
    selectedMeasurementBaseQuantityMicrounits: snapshot.measurement.baseQuantityMicrounits,
    selectedMeasurementId: snapshot.measurement.id,
    selectedMeasurementLabel: snapshot.measurement.label,
    selectedMeasurementUnit: snapshot.measurement.unit,
    sodiumMilligrams: snapshot.nutrients.sodiumMilligrams,
    sourceDataType: snapshot.source.dataType,
    sugarMilligrams: snapshot.nutrients.sugarMilligrams,
    supportedMeasurements: serializeCatalogMeasurements(snapshot.measurements),
  };
}

export function foodEventFromRow(row: FoodEventRow, favoriteId: number | null): FoodEvent {
  return {
    ...snapshotFromColumns(row),
    id: row.id,
    name: row.editedName ?? row.originalName,
    logDate: row.logDate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    favoriteId,
    copiedFromId: row.copiedFromEventId,
  };
}

/** A favorite's flat snapshot JSON, unchanged from the shape Saved Foods stored. */
export function favoriteSnapshotJson(snapshot: FoodSnapshot): string {
  return JSON.stringify(snapshotColumns(snapshot));
}

export function favoriteFromRow(row: FavoriteRow): Favorite {
  return {
    id: row.id,
    name: row.name,
    snapshot: snapshotFromColumns(JSON.parse(row.snapshot) as SnapshotColumns),
    sourceEventId: row.sourceEventId,
    createdAt: row.createdAt,
  };
}
