import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import type { CatalogFood } from "../app/catalog/food-catalog.server";
import { TestOpenFoodFactsProvider } from "../app/catalog/test-fixture.server";
import {
  buildOffGeneration,
  readOffGenerationFood,
  searchOffGeneration,
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
  expect(() => searchOffGeneration(directory, "missing", '"food"*', () => 0))
    .toThrow();
  await expect(access(databasePath)).rejects.toThrow();
});

test("generation build persists aliases, indexes once, de-duplicates, and caps ranked results", async () => {
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
  const indexing = vi.fn();
  const aliasesFor = vi.fn((food: CatalogFood) => [
    `Hidden alias ${food.providerFoodId}`,
  ]);

  await expect(buildOffGeneration({
    aliasesFor,
    directory,
    foods: asFoods(foods),
    generation: "built",
    maxBytes: 16 * 1024 * 1024,
    onDuplicate: duplicate,
    onIndexing: indexing,
  })).resolves.toBe(30);
  expect(duplicate).toHaveBeenCalledTimes(1);
  expect(indexing).toHaveBeenCalledTimes(1);
  expect(aliasesFor).toHaveBeenCalledTimes(31);
  expect(readOffGenerationFood(directory, "built", "0000000000001"))
    .toEqual(foods[0]);
  expect(readOffGenerationFood(directory, "built", "9999999999999"))
    .toBeUndefined();

  const relevance = vi.fn((food: CatalogFood) =>
    food.providerFoodId === "0000000000002" ? null : 7
  );
  const results = searchOffGeneration(
    directory,
    "built",
    '"indexed"*',
    relevance,
  );
  expect(results).toHaveLength(25);
  expect(results.map(food => food.providerFoodId)).not.toContain("0000000000002");
  expect(results[0]).toMatchObject({
    isSelectable: true,
    providerFoodId: "0000000000003",
  });
  expect(results.at(-1)?.isSelectable).toBe(true);
  expect(relevance).toHaveBeenCalled();

  expect(searchOffGeneration(
    directory,
    "built",
    'aliases:"hidden alias 0000000000005"',
    () => 0,
  )).toMatchObject([{ providerFoodId: "0000000000005" }]);
  expect(searchOffGeneration(
    directory,
    "built",
    'brands:"indexed brand"',
    () => 0,
  )).toHaveLength(25);
});
