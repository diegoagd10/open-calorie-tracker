import type BetterSqlite3 from "better-sqlite3";
import { afterEach, expect, test, vi } from "vitest";
import { runArchive } from "./support/catalog-import";
import { foundationArchive } from "./support/foundation-archive";
import { offArchive, offWithBasis } from "./support/off-archive";

const driver = vi.hoisted(() => ({ connections: [] as BetterSqlite3.Database[], invalid: false }));
// Observe real SQLite handles and inject an integrity fault at the external driver boundary.
vi.mock("better-sqlite3", async original => {
  const actual = await original<{ default: typeof BetterSqlite3 }>();
  return { ...actual, default: class extends actual.default {
    constructor(...args: ConstructorParameters<typeof actual.default>) {
      super(...args);
      driver.connections.push(this);
    }
    override pragma(source: string, options?: BetterSqlite3.PragmaOptions): unknown {
      if (driver.invalid && (source === "quick_check" || source === "integrity_check")) return "corrupt page";
      return super.pragma(source, options);
    }
  } };
});
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  driver.invalid = false;
  for (const connection of driver.connections.splice(0)) if (connection.open) connection.close();
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
});

test.each(["off", "usda"] as const)("%s closes SQLite handles after import, lookup and missing lookup", async provider => {
  const imported = await runArchive(provider, provider === "off" ? offArchive([offWithBasis("serving")]) : await foundationArchive(), cleanup => cleanups.push(cleanup));
  expect(imported.final.result?.foodCount).toBeGreaterThan(0);
  expect(driver.connections.every(connection => !connection.open)).toBe(true);
  expect(imported.read(provider === "off" ? "0012345678905" : "748967")).toBeDefined();
  expect(driver.connections.every(connection => !connection.open)).toBe(true);
  expect(imported.read("99999999999999")).toBeUndefined();
  expect(driver.connections.every(connection => !connection.open)).toBe(true);

});

test("Foundation closes search handles on success and SQL failure", async () => {
  const imported = await runArchive("usda", await foundationArchive(), cleanup => cleanups.push(cleanup));
  expect(imported.search('"broccoli"*')).toHaveLength(2);
  expect(driver.connections.every(connection => !connection.open)).toBe(true);
  expect(() => imported.search('"unterminated')).toThrow();
  expect(driver.connections.every(connection => !connection.open)).toBe(true);
});

test.each([
  ["off", "OFF database validation failed. Nothing was installed."],
  ["usda", "Invalid or corrupt Foundation CSV ZIP, or insufficient disk space. Verify the download and retry."],
] as const)("%s rejects a failed integrity check and closes its generation", async (provider, error) => {
  driver.invalid = true;
  const imported = await runArchive(provider, provider === "off" ? offArchive([offWithBasis("serving")]) : await foundationArchive(), cleanup => cleanups.push(cleanup));
  expect(imported.final.error).toBe(error);
  expect(imported.final.progress?.processedRecords).toBeGreaterThan(0);
  expect(imported.final.progress?.exclusions).toBeDefined();
  expect(imported.messages.some(message => message.result)).toBe(false);
  expect(driver.connections.every(connection => !connection.open)).toBe(true);
});
