import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";

import {
  isDatabaseReady,
  openApplicationDatabase,
  type DatabaseStatus,
} from "../app/database/database.server";

const temporaryDirectories: string[] = [];

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
    appliedMigrations: 6,
    busyTimeoutMs: 5_000,
    foreignKeysEnabled: true,
    journalMode: "wal",
    schemaVersion: "6",
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
  expect(firstStartup.getStatus().appliedMigrations).toBe(6);
  firstStartup.close();

  const replacementStartup = openApplicationDatabase(options);
  expect(replacementStartup.getStatus()).toMatchObject({
    appliedMigrations: 6,
    schemaVersion: "6",
    writable: true,
  });
  replacementStartup.close();
});

test("readiness requires every database invariant", () => {
  const readyStatus: DatabaseStatus = {
    appliedMigrations: 6,
    busyTimeoutMs: 5_000,
    foreignKeysEnabled: true,
    journalMode: "wal",
    schemaVersion: "6",
    writable: true,
  };

  expect(isDatabaseReady(readyStatus)).toBe(true);

  for (const unavailableStatus of [
    { ...readyStatus, appliedMigrations: 0 },
    { ...readyStatus, busyTimeoutMs: 0 },
    { ...readyStatus, foreignKeysEnabled: false },
    { ...readyStatus, journalMode: "delete" },
    { ...readyStatus, schemaVersion: "unknown" },
    { ...readyStatus, writable: false },
  ]) {
    expect(isDatabaseReady(unavailableStatus)).toBe(false);
  }
});
