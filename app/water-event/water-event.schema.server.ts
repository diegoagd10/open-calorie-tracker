import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { users } from "../database/schema.server";

export const waterEvents = sqliteTable(
  "water_events",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** Consumption date-time: UTC ISO for new rows, local `YYYY-MM-DDTHH:MM:SS` for migrated rows. */
    logDate: text("log_date").notNull(),
    /** Decimal fluid ounces, such as `12.5`. */
    ounces: text().notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("water_events_user_log_date_index").on(table.userId, table.logDate, table.id),
    check("water_events_positive_ounces_check", sql`CAST(${table.ounces} AS REAL) > 0`),
  ],
);
