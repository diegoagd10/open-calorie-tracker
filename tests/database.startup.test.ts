import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
import { dailyGoals } from "../app/daily-goal/daily-goal.schema.server";
import { waterEvents } from "../app/water-event/water-event.schema.server";
import { createMigrationFolder } from "./support/migrations";

const temporaryDirectories: string[] = [];
/** Every reviewed migration, so these tests follow the journal instead of a fixed count. */
const migrationCount = readMigrationFiles({ migrationsFolder: path.resolve("drizzle") }).length;

function readRepresentativeData(client: ApplicationDatabaseClient) {
  return {
    foodEntries: client.all<Record<string, unknown>>(sql`SELECT * FROM food_entries ORDER BY id`)
      .map(({ source_saved_food_id: _sourceSavedFoodId, ...entry }) => entry),
    passwordCredentials: client.select().from(schema.passwordCredentials).all(),
    sessions: client.select().from(schema.sessions).all(),
    userPreferences: client.all(sql`SELECT user_id, time_zone, created_at, updated_at FROM user_preferences`),
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

test("the Daily Goal migration keeps each account's goal active today in fluid ounces and drops display units", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "daily-goal-upgrade-"));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, "application.sqlite");
  const previousMigrations = await createMigrationFolder(path.join(directory, "previous-migrations"), {
    throughTag: "0029_water_event_log_date",
  });
  const previous = openApplicationDatabase({ databasePath, migrationsFolder: previousMigrations });
  const client = previous.getClient();
  const createdAt = "2026-09-26T12:00:00.000Z";
  const insertAccount = (username: string, displayUnits: "us" | "metric") => {
    const { id } = client.get<{ id: number }>(sql`INSERT INTO users (username_normalized, created_at)
      VALUES (${username}, ${createdAt}) RETURNING id`);
    client.run(sql`INSERT INTO user_preferences (user_id, display_units, time_zone, created_at, updated_at)
      VALUES (${id}, ${displayUnits}, 'America/New_York', ${createdAt}, ${createdAt})`);
    return id;
  };
  const insertVersion = (userId: number, effectiveDate: string, calories: number, microliters: number) => {
    client.run(sql`INSERT INTO goal_versions (
      user_id, effective_date, calorie_target_milli_kcal, water_target_microliters, protein_target_milligrams,
      carbohydrate_target_milligrams, fat_target_milligrams, fiber_target_milligrams, sugar_maximum_milligrams,
      sodium_maximum_milligrams, created_at
    ) VALUES (${userId}, ${effectiveDate}, ${calories}, ${microliters}, 120000, 230000, 70000, 25000, 50000, 2300,
      ${`${effectiveDate}T00:00:00.000Z`})`);
  };
  const scheduled = insertAccount("scheduled.us", "us");
  insertVersion(scheduled, "2000-01-01", 2_500_000, 1_000_000);
  insertVersion(scheduled, "2001-01-01", 1_900_000, 2_365_882);
  insertVersion(scheduled, "2999-01-01", 1_500_000, 3_000_000);
  const futureOnly = insertAccount("future.metric", "metric");
  insertVersion(futureOnly, "2999-01-01", 1_700_000, 1_000_000);
  insertVersion(futureOnly, "2998-01-01", 1_800_000, 2_000_000);
  const largeWater = insertAccount("large.metric", "metric");
  insertVersion(largeWater, "2001-01-01", 2_000_000, 15_000_000);
  const tinyWater = insertAccount("tiny.metric", "metric");
  insertVersion(tinyWater, "2001-01-01", 2_000_000, 5);
  const notSetUp = client.get<{ id: number }>(sql`INSERT INTO users (username_normalized, created_at)
    VALUES ('not.set.up', ${createdAt}) RETURNING id`).id;
  previous.close();

  const upgraded = openApplicationDatabase({ databasePath, migrationsFolder: path.resolve("drizzle") });
  const goals = upgraded.getClient().all<Record<string, unknown>>(sql`SELECT user_id AS userId,
    calorie_target_milli_kcal AS calories, water_target_ounces AS water, created_at AS createdAt,
    updated_at AS updatedAt FROM daily_goals ORDER BY user_id`);
  expect(goals).toEqual([
    { userId: scheduled, calories: 1_900_000, water: "80", createdAt: "2001-01-01T00:00:00.000Z", updatedAt: "2001-01-01T00:00:00.000Z" },
    { userId: futureOnly, calories: 1_800_000, water: "67.628", createdAt: "2998-01-01T00:00:00.000Z", updatedAt: "2998-01-01T00:00:00.000Z" },
    { userId: largeWater, calories: 2_000_000, water: "500", createdAt: "2001-01-01T00:00:00.000Z", updatedAt: "2001-01-01T00:00:00.000Z" },
    { userId: tinyWater, calories: 2_000_000, water: "0.001", createdAt: "2001-01-01T00:00:00.000Z", updatedAt: "2001-01-01T00:00:00.000Z" },
  ]);
  expect(goals.map((goal) => goal.userId)).not.toContain(notSetUp);
  expect(upgraded.getClient().all(sql`SELECT name FROM sqlite_master WHERE name = 'goal_versions'`)).toEqual([]);
  expect(upgraded.getClient().all<{ name: string }>(sql`PRAGMA table_info(user_preferences)`).map((column) => column.name))
    .toEqual(["user_id", "time_zone", "created_at", "updated_at"]);
  expect(upgraded.getClient().all(sql`SELECT user_id AS userId, time_zone AS timeZone FROM user_preferences ORDER BY user_id`))
    .toEqual([scheduled, futureOnly, largeWater, tinyWater].map((userId) => ({ userId, timeZone: "America/New_York" })));
  expect(upgraded.getStatus()).toMatchObject({ appliedMigrations: migrationCount, foreignKeysEnabled: true });
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
  client.run(sql`INSERT INTO user_preferences (user_id, display_units, time_zone, created_at, updated_at)
    VALUES (${user.id}, 'us', 'America/New_York', ${timestamp}, ${timestamp})`);
  client.run(sql`INSERT INTO goal_versions (
    user_id, effective_date, calorie_target_milli_kcal, water_target_microliters, protein_target_milligrams,
    carbohydrate_target_milligrams, fat_target_milligrams, fiber_target_milligrams, sugar_maximum_milligrams,
    sodium_maximum_milligrams, created_at
  ) VALUES (${user.id}, '2026-08-30', 2000000, 2000000, 120000, 250000, 70000, 30000, 50000, 2300, ${timestamp})`);
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
  expect(upgraded.getClient().select().from(dailyGoals).all()).toEqual([{
    userId: user.id,
    calorieTarget: 2_000_000,
    waterTarget: "67.628",
    proteinTarget: 120_000,
    carbohydrateTarget: 250_000,
    fatTarget: 70_000,
    fiberTarget: 30_000,
    sugarMaximum: 50_000,
    sodiumMaximum: 2_300,
    createdAt: timestamp,
    updatedAt: timestamp,
  }]);
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

