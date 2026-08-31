import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import {
  configuredPath,
  getApplicationDatabase,
  initializeApplicationDatabase,
  shutdownApplicationDatabase,
} from "../app/database/runtime.server";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  shutdownApplicationDatabase();
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

test("database runtime trims configuration, caches one database, and closes it", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-runtime-"));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, "configured.sqlite");
  vi.stubEnv("DATABASE_PATH", `  ${databasePath}  `);
  vi.stubEnv("MIGRATIONS_PATH", `  ${path.resolve("drizzle")}  `);

  const initialized = initializeApplicationDatabase();
  expect(initializeApplicationDatabase()).toBe(initialized);
  expect(getApplicationDatabase()).toBe(initialized);
  expect(initialized.getStatus().migrationsCurrent).toBe(true);
  shutdownApplicationDatabase();
  expect(() => initialized.getClient().run("SELECT 1")).toThrow();
  expect(() => shutdownApplicationDatabase()).not.toThrow();
});

test("database runtime rejects blank configured paths", () => {
  expect(configuredPath(undefined)).toBeUndefined();
  expect(configuredPath("  configured.sqlite  ")).toBe("configured.sqlite");
  expect(() => configuredPath("   ")).toThrow(
    "Configured database paths cannot be blank",
  );
  vi.stubEnv("DATABASE_PATH", "   ");
  vi.stubEnv("MIGRATIONS_PATH", path.resolve("drizzle"));
  expect(() => initializeApplicationDatabase()).toThrow();
  vi.stubEnv("DATABASE_PATH", path.join(tmpdir(), "unused.sqlite"));
  vi.stubEnv("MIGRATIONS_PATH", "   ");
  expect(() => initializeApplicationDatabase()).toThrow();
});

test("getApplicationDatabase initializes when no database is cached", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-runtime-get-"));
  temporaryDirectories.push(directory);
  vi.stubEnv("DATABASE_PATH", path.join(directory, "lazy.sqlite"));
  vi.stubEnv("MIGRATIONS_PATH", path.resolve("drizzle"));
  expect(getApplicationDatabase().getStatus().migrationsCurrent).toBe(true);
});
