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

export const encryptedCredentialBundles = sqliteTable("encrypted_credential_bundles", {
  name: text().primaryKey(),
  envelope: text().notNull(),
  configuredAt: text("configured_at").notNull(),
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
    keyLoginEnabled: integer("key_login_enabled", { mode: "boolean" }).notNull().default(false),
    authenticationVersion: integer("authentication_version").notNull().default(0),
    webauthnUserHandle: text("webauthn_user_handle"),
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

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    ownerId: integer("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text().notNull(),
    keyHash: text("key_hash").notNull(),
    keyCiphertext: text("key_ciphertext").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyLastFour: text("key_last_four").notNull(),
    scopes: text().notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at"),
    lastUsedAt: text("last_used_at"),
  },
  (table) => [
    uniqueIndex("api_keys_key_hash_unique").on(table.keyHash),
    uniqueIndex("api_keys_owner_name_unique").on(table.ownerId, sql`${table.name} COLLATE NOCASE`),
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

export const userPreferences = sqliteTable("user_preferences", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  timeZone: text("time_zone").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Mode belongs to the account; credential identifiers are unique across all owners.
export const webauthnCredentials = sqliteTable("webauthn_credentials", {
  id: text().primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  publicKey: text("public_key").notNull(),
  counter: integer().notNull(),
  revision: integer().notNull().default(0),
  transports: text({ mode: "json" }).$type<string[]>().notNull(),
  name: text().notNull(),
  deviceType: text("device_type", { enum: ["singleDevice", "multiDevice"] }).notNull(),
  backedUp: integer("backed_up", { mode: "boolean" }).notNull(),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at").notNull(),
}, (table) => [index("webauthn_credentials_owner").on(table.userId)]);

export const webauthnCeremonies = sqliteTable("webauthn_ceremonies", {
  browserHash: text("browser_hash").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  purpose: text({ enum: ["register", "enable", "login", "add-proof", "register-add", "add", "register-retained", "retain", "disable", "re-enable", "remove-key", "remove-password", "password-change", "recover-member-key", "recover-member-password", "processing"] }).notNull(),
  challenge: text().notNull(),
  origin: text().notNull(),
  rpId: text("rp_id").notNull(),
  authenticationVersion: integer("authentication_version").notNull(),
  sessionHash: text("session_hash"),
  targetCredentialId: text("target_credential_id"),
  targetMember: text("target_member", { mode: "json" }).$type<{ id: number; username: string; authenticationVersion: number }>(),
  stagedCredential: text("staged_credential", { mode: "json" }).$type<typeof webauthnCredentials.$inferSelect>(),
  name: text().notNull(),
  expiresAt: text("expires_at").notNull(),
}, (table) => [index("webauthn_ceremonies_owner").on(table.userId)]);
