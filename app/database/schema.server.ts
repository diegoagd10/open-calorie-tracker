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
    createdAt: text("created_at").notNull(),
  },
  (table) => [
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
