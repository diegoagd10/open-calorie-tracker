import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";

import { afterEach, expect, test, vi } from "vitest";

import type { CatalogFood } from "../app/catalog/food-catalog.server";
import { TestOpenFoodFactsProvider } from "../app/catalog/test-fixture.server";
import {
  buildOffGeneration,
  readOffGenerationFood,
} from "../app/database/off-generation.server";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "off-generation-"));
  cleanups.push(() => rm(directory, { force: true, recursive: true }));
  return directory;
}

async function* asFoods(foods: CatalogFood[]) {
  yield* foods;
}

test("generation readers never create a missing immutable catalog", async () => {
  const directory = await temporaryDirectory();
  const databasePath = path.join(directory, "missing.sqlite");

  expect(() => readOffGenerationFood(directory, "missing", "123"))
    .toThrow();
  await expect(access(databasePath)).rejects.toThrow();
});

test("generation build persists de-duplicated barcode records without a search index", async () => {
  const directory = await temporaryDirectory();
  const fixture = new TestOpenFoodFactsProvider();
  const base = await fixture.getFood("0012345678905");
  const foods = Array.from({ length: 30 }, (_, index) => ({
    ...base,
    brand: "Indexed Brand",
    isSelectable: index !== 0,
    name: `Indexed cereal ${index}`,
    providerFoodId: String(index + 1).padStart(13, "0"),
  }));
  foods.push({ ...foods[0], name: "Ignored duplicate" });
  const duplicate = vi.fn();
  const stored = vi.fn();

  await expect(buildOffGeneration({
    directory,
    foods: asFoods(foods),
    generation: "built",
    maxBytes: 16 * 1024 * 1024,
    onDuplicate: duplicate,
    onStored: stored,
  })).resolves.toBe(30);
  expect(duplicate).toHaveBeenCalledTimes(1);
  expect(stored).toHaveBeenCalledTimes(30);
  expect(readOffGenerationFood(directory, "built", "0000000000001"))
    .toEqual(foods[0]);
  expect(readOffGenerationFood(directory, "built", "9999999999999"))
    .toBeUndefined();
  const database = new BetterSqlite3(path.join(directory, "built.sqlite"), {
    readonly: true,
  });
  expect(database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  ).all()).toEqual([{ name: "products" }]);
  expect(database.prepare("PRAGMA table_info(products)").all())
    .toMatchObject([{ name: "id" }, { name: "record" }]);
  database.close();
});
