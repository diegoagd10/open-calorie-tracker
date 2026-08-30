import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";

import * as schema from "../app/database/schema.server";
import {
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
    users: client.select().from(schema.users).all(),
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
    appliedMigrations: 9,
    availableMigrations: 9,
    busyTimeoutMs: 5_000,
    foreignKeysEnabled: true,
    journalMode: "wal",
    migrationsCurrent: true,
    schemaVersion: "8",
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
  expect(firstStartup.getStatus().appliedMigrations).toBe(9);
  firstStartup.close();

  const replacementStartup = openApplicationDatabase(options);
  expect(replacementStartup.getStatus()).toMatchObject({
    appliedMigrations: 9,
    schemaVersion: "8",
    writable: true,
  });
  replacementStartup.close();
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

  const user = client
    .insert(schema.users)
    .values({ createdAt: timestamp, usernameNormalized: "migration.owner" })
    .returning({ id: schema.users.id })
    .get();
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
    appliedMigrations: 9,
    availableMigrations: 9,
    migrationsCurrent: true,
    schemaVersion: "8",
    writable: true,
  });
  expect(isDatabaseReady(upgraded.getStatus())).toBe(true);
  expect(readRepresentativeData(upgraded.getClient())).toEqual(
    representativeData,
  );
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
        tag: "0009_failed_deployment",
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
    appliedMigrations: 9,
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
    appliedMigrations: 9,
    availableMigrations: 9,
    busyTimeoutMs: 5_000,
    foreignKeysEnabled: true,
    journalMode: "wal",
    migrationsCurrent: true,
    schemaVersion: "8",
    writable: true,
  };

  expect(isDatabaseReady(readyStatus)).toBe(true);

  for (const unavailableStatus of [
    { ...readyStatus, appliedMigrations: 0 },
    { ...readyStatus, migrationsCurrent: false },
    { ...readyStatus, busyTimeoutMs: 0 },
    { ...readyStatus, foreignKeysEnabled: false },
    { ...readyStatus, journalMode: "delete" },
    { ...readyStatus, writable: false },
  ]) {
    expect(isDatabaseReady(unavailableStatus)).toBe(false);
  }
});
