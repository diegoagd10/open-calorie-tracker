import { sql } from "drizzle-orm";
import {
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
