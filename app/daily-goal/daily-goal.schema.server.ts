import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { users } from "../database/schema.server";

/** One Daily Goal per account; calories in milli-kcal, nutrients in mg, water in fl oz text. */
export const dailyGoals = sqliteTable(
  "daily_goals",
  {
    userId: integer("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    calorieTarget: integer("calorie_target_milli_kcal").notNull(),
    /** Decimal fluid ounces, such as `80` or `67.628`. */
    waterTarget: text("water_target_ounces").notNull(),
    proteinTarget: integer("protein_target_milligrams").notNull(),
    carbohydrateTarget: integer("carbohydrate_target_milligrams").notNull(),
    fatTarget: integer("fat_target_milligrams").notNull(),
    fiberTarget: integer("fiber_target_milligrams").notNull(),
    sugarMaximum: integer("sugar_maximum_milligrams").notNull(),
    sodiumMaximum: integer("sodium_maximum_milligrams").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "daily_goals_positive_values_check",
      sql`${table.calorieTarget} > 0
        AND CAST(${table.waterTarget} AS REAL) > 0
        AND ${table.proteinTarget} > 0
        AND ${table.carbohydrateTarget} > 0
        AND ${table.fatTarget} > 0
        AND ${table.fiberTarget} > 0
        AND ${table.sugarMaximum} > 0
        AND ${table.sodiumMaximum} > 0`,
    ),
  ],
);
