import { z } from "zod";

import { FoodEventValidationError } from "./food-event.exceptions";
import type {
  FoodEvent,
  FoodEventList,
  NutrientField,
  NutritionTotals,
  SaveFoodEvent,
  VersionedId,
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

/** A JSON amount as decimal text; the rules decide whether it is a valid amount. */
const decimal = z.union([z.string(), z.number().finite().transform(String)]);

const nutrientAmount = decimal.nullable().optional();

/** Every entered nutrient field, each optional; null clears one in an edit. */
const nutritionSchema = z.object(Object.fromEntries(
  NUTRIENT_FIELDS.map(({ field }) => [field, nutrientAmount]),
) as Record<NutrientField, typeof nutrientAmount>);

/** A new manual food's totals; null means unknown, the same as leaving a nutrient out. */
const manualNutritionSchema = nutritionSchema.transform((nutrition) =>
  Object.fromEntries(Object.entries(nutrition).filter(([, amount]) => amount !== null && amount !== undefined)));

/** Absent text reaches the rules as empty, so they refuse it with their own code. */
const text = z.string().default("");

const createSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.enum(["lookup", "barcode"]),
    logDate: text,
    providerFoodId: text,
    reviewVersion: text,
    measurementId: text,
    quantity: decimal.default(""),
  }),
  z.object({
    method: z.literal("manual"),
    logDate: text,
    name: text,
    quantity: decimal.default(""),
    nutrition: manualNutritionSchema.default({}),
    saveAsFavorite: z.boolean().default(false),
  }),
  z.object({ method: z.literal("favorite"), logDate: text, favoriteId: z.number() }),
]);

const editSchema = z.object({
  id: z.number(),
  expectedUpdatedAt: text,
  changes: z.object({
    name: z.string().optional(),
    quantity: decimal.optional(),
    measurementId: z.string().optional(),
    nutrition: nutritionSchema.optional(),
  }).default({}),
});

/**
 * A REST body or MCP arguments as a save: with `id` an edit of the version read at
 * `expectedUpdatedAt`, otherwise a create by `method`. A body of the wrong shape, including an
 * unknown method, is refused here; the service then checks every value.
 */
export function saveFoodEventFromJson(value: unknown): SaveFoodEvent {
  const isEdit = typeof value === "object" && value !== null && "id" in value && value.id !== undefined;
  const parsed = (isEdit ? editSchema : createSchema).safeParse(value);
  if (!parsed.success) {
    throw new FoodEventValidationError(
      "invalid_input",
      "Send method as lookup, barcode, manual, or favorite with that method's fields, or id and expectedUpdatedAt with changes.",
    );
  }
  return parsed.data as SaveFoodEvent;
}

const versionedIdsSchema = z.array(z.object({ id: z.number(), expectedUpdatedAt: z.string() }));

/** A delete's events, each an `id` and `expectedUpdatedAt`; anything else is refused here. */
export function versionedIdsFromJson(value: unknown): VersionedId[] {
  const parsed = versionedIdsSchema.safeParse(value);
  if (!parsed.success) {
    throw new FoodEventValidationError("invalid_event_ids", "Send events as a list of objects with id and expectedUpdatedAt.");
  }
  return parsed.data;
}
