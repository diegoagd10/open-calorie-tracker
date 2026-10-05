import type {
  FoodEvent,
  FoodEventList,
  NutrientField,
  NutritionTotals,
  SaveFoodEvent,
} from "./food-event.model";
import { NUTRIENT_FIELDS } from "./nutrition";

/**
 * JSON in and out for the REST API, MCP tools, and the daily log, so every transport shows a
 * Food Event, and reads one, the same way. Amounts stay exact integers: milli-kilocalories,
 * milligrams, and micro-units of quantity.
 */

export function presentFoodEvent(event: FoodEvent) {
  return {
    id: event.id,
    logDate: event.logDate,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    name: event.name,
    originalName: event.originalName,
    provider: event.source.provider,
    providerFoodId: event.source.providerFoodId,
    dataType: event.source.dataType,
    providerPublishedDate: event.source.publishedDate,
    providerModifiedDate: event.source.modifiedDate,
    brand: event.source.brand,
    barcode: event.source.barcode,
    marketCountry: event.source.marketCountry,
    authoritativeBaseUnit: event.authority.unit,
    authoritativeBaseQuantityMicrounits: event.authority.quantityMicrounits,
    authoritativeNutrition: event.authority.nutrition,
    selectedMeasurementId: event.measurement.id,
    selectedMeasurementLabel: event.measurement.label,
    selectedMeasurementUnit: event.measurement.unit,
    supportedMeasurements: event.measurements,
    quantityMicrounits: event.quantityMicrounits,
    /** The same amount as decimal text, as edits accept it. */
    quantity: String(event.quantityMicrounits / 1_000_000),
    ...event.nutrients,
    favoriteId: event.favoriteId,
    copiedFromId: event.copiedFromId,
  };
}

export function presentNutritionTotals(totals: NutritionTotals) {
  return Object.fromEntries(Object.entries(totals).map(([nutrient, { known, isIncomplete }]) => [
    nutrient,
    { known, isIncomplete },
  ])) as NutritionTotals;
}

export function presentFoodEventList(list: FoodEventList) {
  return {
    events: list.events.map(presentFoodEvent),
    totals: presentNutritionTotals(list.totals),
    days: Object.fromEntries(Object.entries(list.days).map(([day, { eventCount, totals }]) => [
      day,
      { eventCount, totals: presentNutritionTotals(totals) },
    ])),
  };
}

export function presentFoodEventDeletion(deletedCount: number) {
  return { deletedCount };
}

/** Decimal text from a JSON number or string; anything else becomes text the rules reject. */
function decimalText(value: unknown): string {
  if (typeof value === "string") return value;
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function optionalDecimalText(value: unknown): string | undefined {
  return value === undefined ? undefined : decimalText(value);
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Entered nutrients by field: omitted stays omitted, and null stays null when `allowNull`. */
function nutritionFromJson(value: unknown, allowNull: boolean): Partial<Record<NutrientField, string | null>> {
  const entered = record(value);
  const nutrition: Partial<Record<NutrientField, string | null>> = {};
  for (const { field } of NUTRIENT_FIELDS) {
    const amount = entered[field];
    if (amount === undefined || (amount === null && !allowNull)) continue;
    nutrition[field] = amount === null ? null : decimalText(amount);
  }
  return nutrition;
}

/**
 * A REST body or MCP arguments as a save. With `id` it is an edit of the version read at
 * `expectedUpdatedAt`; without it, a create by `method`. The service validates every value.
 */
export function saveFoodEventFromJson(value: unknown): SaveFoodEvent {
  const body = record(value);
  if (body.id !== undefined) {
    const changes = record(body.changes);
    return {
      id: body.id as number,
      expectedUpdatedAt: body.expectedUpdatedAt as string,
      changes: {
        name: changes.name as string | undefined,
        quantity: optionalDecimalText(changes.quantity),
        measurementId: changes.measurementId as string | undefined,
        nutrition: changes.nutrition === undefined ? undefined : nutritionFromJson(changes.nutrition, true),
      },
    };
  }
  const logDate = body.logDate as string;
  switch (body.method) {
    case "lookup":
    case "barcode":
      return {
        method: body.method,
        logDate,
        providerFoodId: body.providerFoodId as string,
        reviewVersion: body.reviewVersion as string,
        measurementId: body.measurementId as string,
        quantity: decimalText(body.quantity),
      };
    case "manual":
      return {
        method: "manual",
        logDate,
        name: body.name as string,
        quantity: decimalText(body.quantity),
        nutrition: nutritionFromJson(body.nutrition, false) as { energyKcal: string },
        saveAsFavorite: body.saveAsFavorite === true,
      };
    default:
      return { method: body.method as "favorite", logDate, favoriteId: body.favoriteId as number };
  }
}

