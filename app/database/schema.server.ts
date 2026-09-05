import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const applicationMetadata = sqliteTable("application_metadata", {
  key: text().primaryKey(),
  value: text().notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const users = sqliteTable(
  "users",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    usernameNormalized: text("username_normalized").notNull(),
    role: text({ enum: ["admin", "member"] }).notNull().default("member"),
    accessState: text("access_state", { enum: ["active", "disabled"] })
      .notNull()
      .default("active"),
    passwordChangeRequired: integer("password_change_required", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check("users_role_check", sql`role IN ('admin', 'member')`),
    check(
      "users_access_state_check",
      sql`access_state IN ('active', 'disabled')`,
    ),
    uniqueIndex("users_single_admin_unique")
      .on(table.role)
      .where(sql`${table.role} = 'admin'`),
    uniqueIndex("users_username_normalized_unique").on(
      sql`${table.usernameNormalized} COLLATE NOCASE`,
    ),
  ],
);

export const passwordCredentials = sqliteTable("password_credentials", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    idleExpiresAt: text("idle_expires_at").notNull(),
    absoluteExpiresAt: text("absolute_expires_at").notNull(),
  },
  (table) => [index("sessions_user_id_index").on(table.userId)],
);

export const preAuthenticationCsrfSessions = sqliteTable(
  "pre_authentication_csrf_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
);

export const rateLimitCounters = sqliteTable(
  "rate_limit_counters",
  {
    scope: text().notNull(),
    subjectHash: text("subject_hash").notNull(),
    windowStartedAt: text("window_started_at").notNull(),
    attempts: integer().notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.scope, table.subjectHash] })],
);

export const userPreferences = sqliteTable(
  "user_preferences",
  {
    userId: integer("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    displayUnits: text("display_units").notNull(),
    timeZone: text("time_zone").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "user_preferences_display_units_check",
      sql`${table.displayUnits} IN ('us', 'metric')`,
    ),
  ],
);

export const goalVersions = sqliteTable(
  "goal_versions",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    effectiveDate: text("effective_date").notNull(),
    calorieTargetMilliKcal: integer("calorie_target_milli_kcal").notNull(),
    waterTargetMicroliters: integer("water_target_microliters").notNull(),
    proteinTargetMilligrams: integer("protein_target_milligrams").notNull(),
    carbohydrateTargetMilligrams: integer(
      "carbohydrate_target_milligrams",
    ).notNull(),
    fatTargetMilligrams: integer("fat_target_milligrams").notNull(),
    fiberTargetMilligrams: integer("fiber_target_milligrams").notNull(),
    sugarMaximumMilligrams: integer("sugar_maximum_milligrams").notNull(),
    sodiumMaximumMilligrams: integer("sodium_maximum_milligrams").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("goal_versions_user_effective_date_unique").on(
      table.userId,
      table.effectiveDate,
    ),
    index("goal_versions_user_effective_date_index").on(
      table.userId,
      table.effectiveDate,
    ),
    check(
      "goal_versions_positive_values_check",
      sql`${table.calorieTargetMilliKcal} > 0
        AND ${table.waterTargetMicroliters} > 0
        AND ${table.proteinTargetMilligrams} > 0
        AND ${table.carbohydrateTargetMilligrams} > 0
        AND ${table.fatTargetMilligrams} > 0
        AND ${table.fiberTargetMilligrams} > 0
        AND ${table.sugarMaximumMilligrams} > 0
        AND ${table.sodiumMaximumMilligrams} > 0`,
    ),
  ],
);

export const foodEntries = sqliteTable(
  "food_entries",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    foodLogDate: text("food_log_date").notNull(),
    localEventTime: text("local_event_time").notNull(),
    provider: text().notNull(),
    providerFoodId: text("provider_food_id").notNull(),
    providerPublishedDate: text("provider_published_date"),
    providerModifiedDate: text("provider_modified_date"),
    sourceDataType: text("source_data_type").notNull(),
    originalName: text("original_name").notNull(),
    editedName: text("edited_name"),
    brand: text(),
    barcode: text(),
    marketCountry: text("market_country"),
    authoritativeBaseUnit: text("authoritative_base_unit").notNull(),
    authoritativeBaseQuantityMicrounits: integer(
      "authoritative_base_quantity_microunits",
    ).notNull(),
    authoritativeNutrition: text("authoritative_nutrition")
      .notNull()
      .default(
        '{"carbohydrateMilligrams":null,"energyMilliKcal":null,"fatMilligrams":null,"fiberMilligrams":null,"proteinMilligrams":null,"sodiumMilligrams":null,"sugarMilligrams":null}',
      ),
    selectedMeasurementId: text("selected_measurement_id").notNull(),
    selectedMeasurementLabel: text("selected_measurement_label").notNull(),
    selectedMeasurementUnit: text("selected_measurement_unit").notNull(),
    selectedMeasurementBaseQuantityMicrounits: integer(
      "selected_measurement_base_quantity_microunits",
    ).notNull(),
    supportedMeasurements: text("supported_measurements")
      .notNull()
      .default("[]"),
    quantityMicrounits: integer("quantity_microunits").notNull(),
    energyMilliKcal: integer("authoritative_energy_milli_kcal"),
    proteinMilligrams: integer("authoritative_protein_milligrams"),
    carbohydrateMilligrams: integer("authoritative_carbohydrate_milligrams"),
    fatMilligrams: integer("authoritative_fat_milligrams"),
    fiberMilligrams: integer("authoritative_fiber_milligrams"),
    sugarMilligrams: integer("authoritative_sugar_milligrams"),
    sodiumMilligrams: integer("authoritative_sodium_milligrams"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("food_entries_user_idempotency_unique").on(
      table.userId,
      table.idempotencyKey,
    ),
    index("food_entries_user_date_order_index").on(
      table.userId,
      table.foodLogDate,
      table.localEventTime,
      table.createdAt,
      table.id,
    ),
    check(
      "food_entries_provider_check",
      sql`${table.provider} IN ('usda-fdc', 'open-food-facts', 'manual')`,
    ),
    check(
      "food_entries_data_type_check",
      sql`${table.sourceDataType} IN ('Branded', 'Survey (FNDDS)', 'Foundation', 'Open Food Facts', 'User entered')`,
    ),
    check(
      "food_entries_units_check",
      sql`${table.authoritativeBaseUnit} IN ('g', 'ml', 'serving')
        AND ${table.selectedMeasurementUnit} IN ('g', 'ml', 'serving')`,
    ),
    check(
      "food_entries_provider_semantics_check",
      sql`(${table.provider} = 'usda-fdc'
          AND ${table.sourceDataType} IN ('Branded', 'Survey (FNDDS)', 'Foundation')
          AND ${table.authoritativeBaseUnit} IN ('g', 'ml')
          AND ${table.selectedMeasurementUnit} IN ('g', 'ml'))
        OR (${table.provider} = 'open-food-facts'
          AND ${table.sourceDataType} = 'Open Food Facts'
          AND ${table.authoritativeBaseUnit} = 'serving'
          AND ${table.selectedMeasurementUnit} = 'serving')
        OR (${table.provider} = 'manual'
          AND ${table.sourceDataType} = 'User entered'
          AND ${table.authoritativeBaseUnit} = 'serving'
          AND ${table.selectedMeasurementUnit} = 'serving')`,
    ),
    check(
      "food_entries_positive_quantities_check",
      sql`${table.authoritativeBaseQuantityMicrounits} > 0
        AND ${table.selectedMeasurementBaseQuantityMicrounits} > 0
        AND ${table.quantityMicrounits} > 0`,
    ),
  ],
);

export const waterEvents = sqliteTable(
  "water_events",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    foodLogDate: text("food_log_date").notNull(),
    amountMicroliters: integer("amount_microliters").notNull(),
    localEventTime: text("local_event_time").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("water_events_user_date_order_index").on(
      table.userId,
      table.foodLogDate,
      table.localEventTime,
      table.createdAt,
      table.id,
    ),
    check(
      "water_events_positive_amount_check",
      sql`${table.amountMicroliters} > 0`,
    ),
  ],
);
