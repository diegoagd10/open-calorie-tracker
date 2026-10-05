import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { users } from "../database/schema.server";

function requiredUserId() {
  return integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" });
}

export const foodEvents = sqliteTable(
  "food_events",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    userId: requiredUserId(),
    /** Consumption instant as a UTC ISO date-time, such as `2026-09-30T18:45:00.000Z`. */
    logDate: text("log_date").notNull(),
    provider: text().notNull(),
    providerFoodId: text("provider_food_id").notNull(),
    /** The favorite this event was logged from or copied with; favorites outlive their events. */
    sourceFavoriteId: integer("source_favorite_id"),
    /** The event this one was copied from; the source may since have been deleted. */
    copiedFromEventId: integer("copied_from_event_id"),
    providerPublishedDate: text("provider_published_date"),
    providerModifiedDate: text("provider_modified_date"),
    sourceDataType: text("source_data_type").notNull(),
    originalName: text("original_name").notNull(),
    editedName: text("edited_name"),
    brand: text(),
    barcode: text(),
    marketCountry: text("market_country"),
    authoritativeBaseUnit: text("authoritative_base_unit").notNull(),
    authoritativeBaseQuantityMicrounits: integer("authoritative_base_quantity_microunits").notNull(),
    authoritativeNutrition: text("authoritative_nutrition")
      .notNull()
      .default(
        '{"carbohydrateMilligrams":null,"energyMilliKcal":null,"fatMilligrams":null,"fiberMilligrams":null,"proteinMilligrams":null,"sodiumMilligrams":null,"sugarMilligrams":null}',
      ),
    selectedMeasurementId: text("selected_measurement_id").notNull(),
    selectedMeasurementLabel: text("selected_measurement_label").notNull(),
    selectedMeasurementUnit: text("selected_measurement_unit").notNull(),
    selectedMeasurementBaseQuantityMicrounits: integer("selected_measurement_base_quantity_microunits").notNull(),
    supportedMeasurements: text("supported_measurements").notNull().default("[]"),
    quantityMicrounits: integer("quantity_microunits").notNull(),
    energyMilliKcal: integer("authoritative_energy_milli_kcal"),
    proteinMilligrams: integer("authoritative_protein_milligrams"),
    carbohydrateMilligrams: integer("authoritative_carbohydrate_milligrams"),
    fatMilligrams: integer("authoritative_fat_milligrams"),
    fiberMilligrams: integer("authoritative_fiber_milligrams"),
    sugarMilligrams: integer("authoritative_sugar_milligrams"),
    sodiumMilligrams: integer("authoritative_sodium_milligrams"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("food_events_user_log_date_index").on(table.userId, table.logDate, table.id),
    check(
      "food_events_provider_check",
      sql`${table.provider} IN ('usda-fdc', 'open-food-facts', 'manual')`,
    ),
    check(
      "food_events_data_type_check",
      sql`${table.sourceDataType} IN ('Branded', 'Survey (FNDDS)', 'Foundation', 'Open Food Facts', 'User entered')`,
    ),
    check(
      "food_events_units_check",
      sql`${table.authoritativeBaseUnit} IN ('g', 'ml', 'serving')
        AND ${table.selectedMeasurementUnit} IN ('g', 'ml', 'serving')`,
    ),
    check(
      "food_events_provider_semantics_check",
      sql`(${table.provider} = 'usda-fdc'
          AND ${table.sourceDataType} IN ('Branded', 'Survey (FNDDS)', 'Foundation')
          AND ${table.authoritativeBaseUnit} IN ('g', 'ml')
          AND ${table.selectedMeasurementUnit} IN ('g', 'ml'))
        OR (${table.provider} = 'open-food-facts'
          AND ${table.sourceDataType} = 'Open Food Facts'
          AND ${table.selectedMeasurementUnit} = ${table.authoritativeBaseUnit}
          AND ((${table.authoritativeBaseUnit} = 'serving' AND ${table.authoritativeBaseQuantityMicrounits} = 1000000)
            OR (${table.authoritativeBaseUnit} IN ('g', 'ml') AND ${table.authoritativeBaseQuantityMicrounits} > 0)))
        OR (${table.provider} = 'manual'
          AND ${table.sourceDataType} = 'User entered'
          AND ${table.authoritativeBaseUnit} = 'serving'
          AND ${table.selectedMeasurementUnit} = 'serving')`,
    ),
    check(
      "food_events_positive_quantities_check",
      sql`${table.authoritativeBaseQuantityMicrounits} > 0
        AND ${table.selectedMeasurementBaseQuantityMicrounits} > 0
        AND ${table.quantityMicrounits} > 0`,
    ),
  ],
);

/**
 * Manual foods saved for reuse. A favorite keeps its own snapshot and has no foreign key to
 * its source event, so it stays reusable after that event is edited or deleted.
 */
export const favoriteFoods = sqliteTable(
  "favorite_foods",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    userId: requiredUserId(),
    sourceEventId: integer("source_event_id").notNull(),
    name: text().notNull(),
    /** The legacy flat snapshot JSON, read and written only by `snapshot.server.ts`. */
    snapshot: text().notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("favorite_foods_user_source_unique").on(table.userId, table.sourceEventId),
    index("favorite_foods_user_name_index").on(table.userId, table.name),
  ],
);
