import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";

import * as schema from "../app/database/schema.server";
import {
  assertDatabaseReady,
  isDatabaseReady,
  openApplicationDatabase,
  type ApplicationDatabaseClient,
  type DatabaseStatus,
} from "../app/database/database.server";
import { createMigrationFolder } from "./support/deployment";

const temporaryDirectories: string[] = [];

function readRepresentativeData(client: ApplicationDatabaseClient) {
  return {
    foodEntries: client.select().from(schema.foodEntries).all(),
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
    waterEvents: client.select().from(schema.waterEvents).all(),
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
    appliedMigrations: 11,
    availableMigrations: 11,
    busyTimeoutMs: 5_000,
    foreignKeysEnabled: true,
    journalMode: "wal",
    migrationsCurrent: true,
    schemaVersion: "10",
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
  expect(firstStartup.getStatus().appliedMigrations).toBe(11);
  firstStartup.close();

  const replacementStartup = openApplicationDatabase(options);
  expect(replacementStartup.getStatus()).toMatchObject({
    appliedMigrations: 11,
    schemaVersion: "10",
    writable: true,
  });
  replacementStartup.close();
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
  client.insert(schema.foodEntries).values({
    authoritativeBaseQuantityMicrounits: 100_000_000,
    authoritativeBaseUnit: "g",
    authoritativeNutrition: JSON.stringify({ energyMilliKcal: 95_000 }),
    brand: "Migration Fixture",
    carbohydrateMilligrams: 25_000,
    createdAt: timestamp,
    energyMilliKcal: 95_000,
    fatMilligrams: 300,
    fiberMilligrams: 4_400,
    foodLogDate: "2026-08-30",
    idempotencyKey: "migration-food-entry",
    localEventTime: "10:00:00",
    originalName: "Representative apple",
    proteinMilligrams: 500,
    provider: "usda-fdc",
    providerFoodId: "171688",
    quantityMicrounits: 1_000_000,
    selectedMeasurementBaseQuantityMicrounits: 100_000_000,
    selectedMeasurementId: "gram",
    selectedMeasurementLabel: "100 g",
    selectedMeasurementUnit: "g",
    sodiumMilligrams: 1,
    sourceDataType: "Foundation",
    sugarMilligrams: 19_000,
    supportedMeasurements: "[]",
    updatedAt: timestamp,
    userId: user.id,
  }).run();
  client.insert(schema.waterEvents).values({
    amountMicroliters: 236_588,
    createdAt: timestamp,
    foodLogDate: "2026-08-30",
    localEventTime: "10:05:00",
    updatedAt: timestamp,
    userId: user.id,
  }).run();
  const representativeData = readRepresentativeData(client);
  previousRelease.close();

  const upgraded = openApplicationDatabase({
    databasePath,
    migrationsFolder: path.resolve("drizzle"),
  });

  expect(upgraded.getStatus()).toMatchObject({
    appliedMigrations: 11,
    availableMigrations: 11,
    migrationsCurrent: true,
    schemaVersion: "10",
    writable: true,
  });
  expect(isDatabaseReady(upgraded.getStatus())).toBe(true);
  expect(readRepresentativeData(upgraded.getClient())).toEqual(
    representativeData,
  );
  expect(
    upgraded
      .getClient()
      .select({ accessState: schema.users.accessState, role: schema.users.role })
      .from(schema.users)
      .get(),
  ).toEqual({ accessState: "active", role: "admin" });
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
    appliedMigrations: 11,
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
    appliedMigrations: 11,
    availableMigrations: 11,
    busyTimeoutMs: 5_000,
    foreignKeysEnabled: true,
    journalMode: "wal",
    migrationsCurrent: true,
    schemaVersion: "10",
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
    appliedMigrations: 10,
    availableMigrations: 11,
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
