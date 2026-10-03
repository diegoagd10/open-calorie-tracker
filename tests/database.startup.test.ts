import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getTableName } from "drizzle-orm";
import { getTableConfig, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { eq, sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { afterEach, expect, test } from "vitest";

import * as schema from "../app/database/schema.server";
import {
  assertDatabaseReady,
  isDatabaseReady,
  openApplicationDatabase,
  type ApplicationDatabaseClient,
  type DatabaseStatus,
} from "../app/database/database.server";
import { waterEvents } from "../app/water-event/water-event.schema.server";
import { createMigrationFolder } from "./support/migrations";

const temporaryDirectories: string[] = [];
/** Every reviewed migration, so these tests follow the journal instead of a fixed count. */
const migrationCount = readMigrationFiles({ migrationsFolder: path.resolve("drizzle") }).length;

function readRepresentativeData(client: ApplicationDatabaseClient) {
  return {
    foodEntries: client.all<Record<string, unknown>>(sql`SELECT * FROM food_entries ORDER BY id`)
      .map(({ source_saved_food_id: _sourceSavedFoodId, ...entry }) => entry),
    goalVersions: client.select().from(schema.goalVersions).all(),
    passwordCredentials: client.select().from(schema.passwordCredentials).all(),
    sessions: client.select().from(schema.sessions).all(),
    userPreferences: client.select().from(schema.userPreferences).all(),
    users: client.all<{
      createdAt: string;
      id: number;
      usernameNormalized: string;
    }>(sql`SELECT id, username_normalized AS usernameNormalized,
      created_at AS createdAt FROM users ORDER BY id`),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

test("startup applies the initial migration and configures writable SQLite storage", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-database-"));
  temporaryDirectories.push(directory);

  const database = openApplicationDatabase({
    databasePath: path.join(directory, "application.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });

  expect(database.getStatus()).toEqual({
    appliedMigrations: migrationCount,
    availableMigrations: migrationCount,
    busyTimeoutMs: 5_000,
    foreignKeysEnabled: true,
    journalMode: "wal",
    migrationsCurrent: true,
    schemaVersion: "20",
    writable: true,
  });

  database.close();
});

test("starting twice preserves the applied migration state", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-restart-"));
  temporaryDirectories.push(directory);
  const options = {
    databasePath: path.join(directory, "application.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  };

  const firstStartup = openApplicationDatabase(options);
  expect(firstStartup.getStatus().appliedMigrations).toBe(migrationCount);
  firstStartup.close();

  const replacementStartup = openApplicationDatabase(options);
  expect(replacementStartup.getStatus()).toMatchObject({
    appliedMigrations: migrationCount,
    schemaVersion: "20",
    writable: true,
  });
  replacementStartup.close();
});

test("OAuth removal migrates a database holding OAuth clients, grants, and tokens and keeps its accounts", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "oauth-removal-upgrade-"));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, "application.sqlite");
  const previousMigrations = await createMigrationFolder(path.join(directory, "previous-migrations"), {
    throughTag: "0027_api_keys",
  });
  const previous = openApplicationDatabase({ databasePath, migrationsFolder: previousMigrations });
  const client = previous.getClient();
  const owner = client.get<{ id: number }>(sql`
    INSERT INTO users (username_normalized, created_at)
    VALUES ('oauth.removal.owner', '2026-09-26T12:00:00.000Z') RETURNING id
  `);
  client.run(sql`INSERT INTO oauth_clients (id, owner_id, name, type, redirect_uris, created_at)
    VALUES ('existing-client', ${owner.id}, 'Existing client', 'public', '["https://existing.example/callback"]', '2026-09-26T12:00:00.000Z')`);
  const grant = client.get<{ id: number }>(sql`INSERT INTO oauth_grants (client_id, user_id, scope, created_at)
    VALUES ('existing-client', ${owner.id}, 'daily-log:read', '2026-09-26T12:00:00.000Z') RETURNING id`);
  client.run(sql`INSERT INTO oauth_authorization_codes (code_hash, grant_id, redirect_uri, code_challenge, expires_at, created_at)
    VALUES ('code', ${grant.id}, 'https://existing.example/callback', 'challenge', '2026-09-26T12:10:00.000Z', '2026-09-26T12:00:00.000Z')`);
  client.run(sql`INSERT INTO oauth_access_tokens (token_hash, grant_id, expires_at, created_at)
    VALUES ('access', ${grant.id}, '2026-09-26T13:00:00.000Z', '2026-09-26T12:00:00.000Z')`);
  client.run(sql`INSERT INTO oauth_refresh_tokens (token_hash, grant_id, created_at)
    VALUES ('refresh', ${grant.id}, '2026-09-26T12:00:00.000Z')`);
  previous.close();

  const upgraded = openApplicationDatabase({ databasePath, migrationsFolder: path.resolve("drizzle") });
  expect(upgraded.getClient().all(sql`SELECT name FROM sqlite_master WHERE name LIKE 'oauth%'`)).toEqual([]);
  expect(upgraded.getClient().get(sql`SELECT username_normalized AS username FROM users WHERE id = ${owner.id}`))
    .toEqual({ username: "oauth.removal.owner" });
  expect(upgraded.getStatus()).toMatchObject({ appliedMigrations: migrationCount, foreignKeysEnabled: true });
  upgraded.close();
});

test("the Water Event log-date migration converts each local time to UTC in the account's time zone and each amount to ounces", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "water-log-date-upgrade-"));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, "application.sqlite");
  const previousMigrations = await createMigrationFolder(path.join(directory, "previous-migrations"), {
    throughTag: "0028_remove_oauth",
  });
  const previous = openApplicationDatabase({ databasePath, migrationsFolder: previousMigrations });
  const owner = previous.getClient().get<{ id: number }>(sql`
    INSERT INTO users (username_normalized, created_at)
    VALUES ('water.upgrade.owner', '2026-09-26T12:00:00.000Z') RETURNING id
  `);
  previous.getClient().run(sql`INSERT INTO user_preferences (user_id, display_units, time_zone, created_at, updated_at)
    VALUES (${owner.id}, 'us', 'America/New_York', '2026-09-26T12:00:00.000Z', '2026-09-26T12:00:00.000Z')`);
  for (const [microliters, time] of [[236588, "09:00:00"], [709765, "10:30:00"], [1000, "11:00:00"], [5, "12:00:00"], [2000000, "23:59:00"]] as const) {
    previous.getClient().run(sql`INSERT INTO water_events
      (user_id, food_log_date, amount_microliters, preset_8_count, local_event_time, created_at, updated_at)
      VALUES (${owner.id}, '2026-09-26', ${microliters}, 0, ${time}, '2026-09-26T12:00:00.000Z', '2026-09-26T13:00:00.000Z')`);
  }
  previous.close();

  const upgraded = openApplicationDatabase({ databasePath, migrationsFolder: path.resolve("drizzle") });
  const client = upgraded.getClient();
  expect(client.select().from(waterEvents).all()).toEqual([
    ["2026-09-26T13:00:00.000Z", "8"],
    ["2026-09-26T14:30:00.000Z", "24"],
    ["2026-09-26T15:00:00.000Z", "0.034"],
    ["2026-09-26T16:00:00.000Z", "0.001"],
    ["2026-09-27T03:59:00.000Z", "67.628"],
  ].map(([logDate, ounces], index) => ({
    id: index + 1,
    userId: owner.id,
    logDate,
    ounces,
    createdAt: "2026-09-26T12:00:00.000Z",
    updatedAt: "2026-09-26T13:00:00.000Z",
  })));
  expect(() => client.run(sql`INSERT INTO water_events (user_id, log_date, ounces, created_at, updated_at)
    VALUES (${owner.id}, '2026-09-26T12:00:00.000Z', '0', '2026-09-26T12:00:00.000Z', '2026-09-26T12:00:00.000Z')`))
    .toThrow(expect.objectContaining({
      cause: expect.objectContaining({ code: "SQLITE_CONSTRAINT_CHECK" }) as unknown,
    }) as Error);
  upgraded.close();
});

test.each([
  { expected: [], users: [] },
  {
    expected: [
      {
        accessState: "active",
        role: "admin",
        usernameNormalized: "only.user",
      },
    ],
    users: [{ createdAt: "2026-08-30T10:00:00.000Z", username: "only.user" }],
  },
  {
    expected: [
      {
        accessState: "active",
        role: "member",
        usernameNormalized: "newest.user",
      },
      {
        accessState: "active",
        role: "admin",
        usernameNormalized: "oldest.user",
      },
      {
        accessState: "active",
        role: "member",
        usernameNormalized: "same-time.user",
      },
    ],
    users: [
      { createdAt: "2026-08-30T12:00:00.000Z", username: "newest.user" },
      { createdAt: "2026-08-30T09:00:00.000Z", username: "oldest.user" },
      { createdAt: "2026-08-30T09:00:00.000Z", username: "same-time.user" },
    ],
  },
])("the role and access migrations handle legacy user set %#", async ({
  expected,
  users: legacyUsers,
}) => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-role-upgrade-"));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, "application.sqlite");
  const previousMigrations = await createMigrationFolder(
    path.join(directory, "previous-migrations"),
    { throughTag: "0008_production_deployment" },
  );
  const previousRelease = openApplicationDatabase({
    databasePath,
    migrationsFolder: previousMigrations,
  });
  for (const legacyUser of legacyUsers) {
    previousRelease.getClient().run(sql`
      INSERT INTO users (username_normalized, created_at)
      VALUES (${legacyUser.username}, ${legacyUser.createdAt})
    `);
  }
  previousRelease.close();

  const upgraded = openApplicationDatabase({
    databasePath,
    migrationsFolder: path.resolve("drizzle"),
  });
  expect(
    upgraded
      .getClient()
      .select({
        accessState: schema.users.accessState,
        role: schema.users.role,
        usernameNormalized: schema.users.usernameNormalized,
      })
      .from(schema.users)
      .orderBy(schema.users.id)
      .all(),
  ).toEqual(expected);
  upgraded.close();
});

test("the production migration preserves every representative field from the prior schema", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-upgrade-"));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, "application.sqlite");
  const previousMigrations = await createMigrationFolder(
    path.join(directory, "previous-migrations"),
    { throughTag: "0007_stormy_star_brand" },
  );
  const previousRelease = openApplicationDatabase({
    databasePath,
    migrationsFolder: previousMigrations,
  });
  const client = previousRelease.getClient();
  const timestamp = "2026-08-30T10:00:00.000Z";

  const user = client.get<{ id: number }>(sql`
    INSERT INTO users (username_normalized, created_at)
    VALUES ('migration.owner', ${timestamp})
    RETURNING id
  `);
  client.insert(schema.passwordCredentials).values({
    passwordHash: "argon2id:representative-hash",
    updatedAt: timestamp,
    userId: user.id,
  }).run();
  client.insert(schema.sessions).values({
    absoluteExpiresAt: "2026-11-28T10:00:00.000Z",
    createdAt: timestamp,
    idleExpiresAt: "2026-09-04T10:00:00.000Z",
    lastSeenAt: timestamp,
    tokenHash: "representative-session-hash",
    userId: user.id,
  }).run();
  client.insert(schema.userPreferences).values({
    createdAt: timestamp,
    displayUnits: "us",
    timeZone: "America/New_York",
    updatedAt: timestamp,
    userId: user.id,
  }).run();
  client.insert(schema.goalVersions).values({
    calorieTargetMilliKcal: 2_000_000,
    carbohydrateTargetMilligrams: 250_000,
    createdAt: timestamp,
    effectiveDate: "2026-08-30",
    fatTargetMilligrams: 70_000,
    fiberTargetMilligrams: 30_000,
    proteinTargetMilligrams: 120_000,
    sodiumMaximumMilligrams: 2_300,
    sugarMaximumMilligrams: 50_000,
    userId: user.id,
    waterTargetMicroliters: 2_000_000,
  }).run();
  client.run(sql`
    INSERT INTO food_entries (
      user_id, food_log_date, local_event_time, provider, provider_food_id,
      source_data_type, original_name, brand, authoritative_base_unit,
      authoritative_base_quantity_microunits, authoritative_nutrition,
      selected_measurement_id, selected_measurement_label,
      selected_measurement_unit, selected_measurement_base_quantity_microunits,
      supported_measurements, quantity_microunits,
      authoritative_energy_milli_kcal, authoritative_protein_milligrams,
      authoritative_carbohydrate_milligrams, authoritative_fat_milligrams,
      authoritative_fiber_milligrams, authoritative_sugar_milligrams,
      authoritative_sodium_milligrams, idempotency_key, created_at, updated_at
    ) VALUES (
      ${user.id}, '2026-08-30', '10:00:00', 'usda-fdc', '171688',
      'Foundation', 'Representative apple', 'Migration Fixture', 'g',
      100000000, ${JSON.stringify({ energyMilliKcal: 95_000 })},
      'gram', '100 g', 'g', 100000000, '[]', 1000000,
      95000, 500, 25000, 300, 4400, 19000, 1,
      'migration-food-entry', ${timestamp}, ${timestamp}
    )
  `);
  client.run(sql`INSERT INTO water_events
    (user_id, food_log_date, amount_microliters, local_event_time, created_at, updated_at)
    VALUES (${user.id}, '2026-08-30', 236588, '10:05:00', ${timestamp}, ${timestamp})`);
  const representativeData = readRepresentativeData(client);
  previousRelease.close();

  const upgraded = openApplicationDatabase({
    databasePath,
    migrationsFolder: path.resolve("drizzle"),
  });

  expect(upgraded.getStatus()).toMatchObject({
    appliedMigrations: migrationCount,
    availableMigrations: migrationCount,
    migrationsCurrent: true,
    schemaVersion: "20",
    writable: true,
  });
  expect(isDatabaseReady(upgraded.getStatus())).toBe(true);
  expect(readRepresentativeData(upgraded.getClient())).toEqual(
    representativeData,
  );
  expect(upgraded.getClient().select().from(waterEvents).get()).toMatchObject({
    logDate: "2026-08-30T14:05:00.000Z",
    ounces: "8",
  });
  expect(
    upgraded
      .getClient()
      .select({ accessState: schema.users.accessState, role: schema.users.role })
      .from(schema.users)
      .get(),
  ).toEqual({ accessState: "active", role: "admin" });
  upgraded.close();
});

test("the password-onboarding migration leaves existing credentials unrestricted", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-password-onboarding-upgrade-"));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, "application.sqlite");
  const previousMigrations = await createMigrationFolder(
    path.join(directory, "previous-migrations"),
    { throughTag: "0010_happy_silver_samurai" },
  );
  const previousRelease = openApplicationDatabase({
    databasePath,
    migrationsFolder: previousMigrations,
  });
  previousRelease.getClient().run(sql`
    INSERT INTO users (username_normalized, role, created_at)
    VALUES ('existing.member', 'member', '2026-09-01T12:00:00.000Z')
  `);
  previousRelease.getClient().run(sql`
    INSERT INTO password_credentials (user_id, password_hash, updated_at)
    SELECT id, 'argon2id:existing-credential', '2026-09-01T12:00:00.000Z'
    FROM users WHERE username_normalized = 'existing.member'
  `);
  previousRelease.close();

  const upgraded = openApplicationDatabase({
    databasePath,
    migrationsFolder: path.resolve("drizzle"),
  });
  expect(
    upgraded.getClient().get<{
      passwordChangeRequired: number;
      passwordHash: string;
    }>(sql`
      SELECT u.password_change_required AS passwordChangeRequired,
        p.password_hash AS passwordHash
      FROM users u
      INNER JOIN password_credentials p ON p.user_id = u.id
      WHERE u.username_normalized = 'existing.member'
    `),
  ).toEqual({
    passwordChangeRequired: 0,
    passwordHash: "argon2id:existing-credential",
  });
  expect(upgraded.getStatus().schemaVersion).toBe("20");
  upgraded.close();
});

test("a failed migration rolls back and prevents application startup", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-failed-upgrade-"));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, "application.sqlite");
  const currentMigrations = path.resolve("drizzle");
  const current = openApplicationDatabase({
    databasePath,
    migrationsFolder: currentMigrations,
  });
  current.close();

  const migrationsFolder = await createMigrationFolder(
    path.join(directory, "failed-migrations"),
    {
      extraMigration: {
        sql: `CREATE TABLE deployment_migration_probe (value text NOT NULL);
--> statement-breakpoint
INSERT INTO users (username_normalized, created_at)
VALUES ('must-not-survive', '2026-08-30T12:00:00.000Z');
--> statement-breakpoint
THIS IS NOT VALID SQL;\n`,
        tag: "0011_failed_deployment",
      },
    },
  );

  expect(() =>
    openApplicationDatabase({ databasePath, migrationsFolder }),
  ).toThrow();

  const recovered = openApplicationDatabase({
    databasePath,
    migrationsFolder: currentMigrations,
  });
  expect(
    recovered
      .getClient()
      .all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE name = 'deployment_migration_probe'`,
      ),
  ).toEqual([]);
  expect(recovered.getClient().select().from(schema.users).all()).toEqual([]);
  expect(recovered.getStatus()).toMatchObject({
    appliedMigrations: migrationCount,
    migrationsCurrent: true,
  });
  recovered.close();
});

test("read-only application storage prevents startup", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-read-only-"));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, "application.sqlite");
  const migrationsFolder = path.resolve("drizzle");
  const writable = openApplicationDatabase({ databasePath, migrationsFolder });
  writable.close();
  await chmod(databasePath, 0o444);
  await chmod(directory, 0o555);

  expect(() =>
    openApplicationDatabase({ databasePath, migrationsFolder }),
  ).toThrow();

  await chmod(directory, 0o755);
  await chmod(databasePath, 0o644);
});

test("readiness requires every database invariant", () => {
  const readyStatus: DatabaseStatus = {
    appliedMigrations: migrationCount,
    availableMigrations: migrationCount,
    busyTimeoutMs: 5_000,
    foreignKeysEnabled: true,
    journalMode: "wal",
    migrationsCurrent: true,
    schemaVersion: "20",
    writable: true,
  };

  expect(isDatabaseReady(readyStatus)).toBe(true);
  expect(() => assertDatabaseReady(readyStatus)).not.toThrow();

  for (const unavailableStatus of [
    { ...readyStatus, appliedMigrations: 0 },
    { ...readyStatus, migrationsCurrent: false },
    { ...readyStatus, busyTimeoutMs: 0 },
    { ...readyStatus, foreignKeysEnabled: false },
    { ...readyStatus, journalMode: "delete" },
    { ...readyStatus, writable: false },
  ]) {
    expect(isDatabaseReady(unavailableStatus)).toBe(false);
    expect(() => assertDatabaseReady(unavailableStatus)).toThrow(
      "SQLite startup invariants failed after applying reviewed migrations",
    );
  }
});

test("status detects tampered migration history, metadata, and pragmas", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-status-tamper-"));
  temporaryDirectories.push(directory);
  const database = openApplicationDatabase({
    databasePath: path.join(directory, "application.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });
  const client = database.getClient();
  const latest = client.get<{ createdAt: number; hash: string }>(sql`
    SELECT created_at AS createdAt, hash
    FROM __drizzle_migrations
    ORDER BY created_at DESC
    LIMIT 1
  `);

  client.run(sql`UPDATE __drizzle_migrations SET hash = 'tampered'
    WHERE created_at = ${latest.createdAt}`);
  expect(database.getStatus().migrationsCurrent).toBe(false);
  client.run(sql`UPDATE __drizzle_migrations SET hash = ${latest.hash}
    WHERE created_at = ${latest.createdAt}`);
  client.run(sql`UPDATE __drizzle_migrations SET created_at = ${latest.createdAt + 1}
    WHERE created_at = ${latest.createdAt}`);
  expect(database.getStatus().migrationsCurrent).toBe(false);
  client.run(sql`UPDATE __drizzle_migrations SET created_at = ${latest.createdAt}
    WHERE created_at = ${latest.createdAt + 1}`);
  client.run(sql`DELETE FROM __drizzle_migrations
    WHERE created_at = (SELECT MAX(created_at) FROM __drizzle_migrations)`);
  expect(database.getStatus()).toMatchObject({
    appliedMigrations: migrationCount - 1,
    availableMigrations: migrationCount,
    migrationsCurrent: false,
  });
  client.delete(schema.applicationMetadata)
    .where(eq(schema.applicationMetadata.key, "schema_version"))
    .run();
  expect(database.getStatus().schemaVersion).toBe("unknown");
  client.run(sql.raw("PRAGMA foreign_keys = OFF"));
  expect(database.getStatus().foreignKeysEnabled).toBe(false);
  database.close();
  expect(() => client.run(sql`SELECT 1`)).toThrow();
});

test("photo schema declarations match migrated columns, ownership cascades, indexes and lifecycle checks", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "photo-schema-parity-")); temporaryDirectories.push(directory);
  const database = openApplicationDatabase({ databasePath: path.join(directory, "db.sqlite"), migrationsFolder: path.resolve("drizzle") });
  const client = database.getClient();
  const dialect = new SQLiteSyncDialect();
  const normalize = (text: string) => text.replace(/["`]/g, "").replace(/\s+/g, " ");
  for (const table of [schema.photoMeals, schema.photoAttempts]) {
    const config = getTableConfig(table);
    const columns = client.all<{ name: string; type: string; notnull: number }>(sql.raw(`PRAGMA table_info(${config.name})`));
    expect(config.columns.map(column => ({ name: column.name, type: column.getSQLType().toUpperCase(), notnull: Number(column.notNull) }))).toEqual(columns.map(({ name, type, notnull }) => ({ name, type, notnull })));
    const actualFks = client.all<{ from: string; table: string; to: string; on_delete: string }>(sql.raw(`PRAGMA foreign_key_list(${config.name})`));
    const declaredFks = config.foreignKeys.map(foreignKey => {
      const reference = foreignKey.reference();
      return { from: reference.columns[0].name, table: getTableName(reference.foreignTable), to: reference.foreignColumns[0].name, on_delete: foreignKey.onDelete?.toUpperCase() };
    });
    expect(declaredFks.sort((a,b) => a.from.localeCompare(b.from))).toEqual(actualFks.map(({ from, table, to, on_delete }) => ({ from, table, to, on_delete })).sort((a,b) => a.from.localeCompare(b.from)));
    const ddl = client.get<{ sql: string }>(sql`SELECT sql FROM sqlite_master WHERE name = ${config.name}`).sql;
    expect(config.checks).toHaveLength(2);
    for (const check of config.checks) {
      expect(normalize(ddl)).toContain(`CONSTRAINT ${check.name} CHECK(${normalize(dialect.sqlToQuery(check.value).sql)})`);
    }
    expect([...config.indexes.map(index => index.config.name), ...config.columns.filter(column => column.isUnique).map(column => column.uniqueName)].sort()).toEqual(client.all<{ name: string; origin: string }>(sql.raw(`PRAGMA index_list(${config.name})`)).filter(index => index.origin === "c").map(index => index.name).sort());
    for (const index of config.indexes) {
      const actual = client.get<{ sql: string }>(sql`SELECT sql FROM sqlite_master WHERE name = ${index.config.name}`);
      expect(actual).toBeDefined();
      expect(normalize(actual.sql)).toContain(index.config.name);
      expect(client.all<{ name: string }>(sql.raw(`PRAGMA index_info(${index.config.name})`)).map(item => item.name)).toEqual(index.config.columns.map(column => "name" in column ? column.name : undefined));
    }
  }
  expect(schema.photoAttempts.status.enumValues).toEqual(["active", "succeeded", "failed", "canceled", "interrupted"]);
  expect(schema.photoAttempts.stage.enumValues).toEqual(["Analyzing photo", "Consulting USDA", "Preparing result"]);
  expect(schema.photoMeals.entryId.isUnique).toBe(true);
  expect(schema.photoAttempts.evidence.default).toBe("[]");
  const active = getTableConfig(schema.photoAttempts).indexes.find(index => index.config.name === "photo_attempts_one_active")!;
  expect(active.config.unique).toBe(true);
  expect(normalize(dialect.sqlToQuery(active.config.where!).sql)).toBe("photo_attempts.status = 'active'");
  expect(schema.photoMeals.photo.mapFromDriverValue(Buffer.from("photo"))).toEqual(Buffer.from("photo"));
  database.close();
});
