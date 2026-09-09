import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, expect, test } from "vitest";
import type { CatalogProviderId } from "../app/catalog/food-catalog.server";
import { catalogGenerationIsReadable } from "../app/database/catalog-generation-validation.server";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

type TableState = "populated" | "empty" | "missing";
async function generation(provider: CatalogProviderId, options: { records?: TableState; search?: TableState } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "catalog-generation-validation-"));
  directories.push(directory);
  const id = "00000000-0000-4000-8000-000000000040";
  const database = new BetterSqlite3(path.join(directory, `${id}.sqlite`));
  const [records, search] = provider === "open-food-facts" ? ["products", "product_search"] : ["foods", "names"];
  const recordsState = options.records ?? "populated";
  const searchState = options.search ?? "populated";
  if (recordsState !== "missing") {
    database.exec(`CREATE TABLE ${records} (value TEXT)`);
    if (recordsState === "populated") database.prepare(`INSERT INTO ${records} (value) VALUES (?)`).run("record");
  }
  if (searchState !== "missing") {
    database.exec(`CREATE TABLE ${search} (value TEXT)`);
    if (searchState === "populated") database.prepare(`INSERT INTO ${search} (value) VALUES (?)`).run("search");
  }
  database.close();
  return { directory, id };
}

test.each(["usda-fdc", "open-food-facts"] as const)("a complete %s generation is readable", async provider => {
  const created = await generation(provider);
  expect(catalogGenerationIsReadable(created.directory, created.id, provider)).toBe(true);
});

test.each([
  ["usda-fdc", { records: "missing" }],
  ["usda-fdc", { search: "missing" }],
  ["usda-fdc", { records: "empty" }],
  ["usda-fdc", { search: "empty" }],
  ["open-food-facts", { records: "missing" }],
  ["open-food-facts", { search: "missing" }],
  ["open-food-facts", { records: "empty" }],
  ["open-food-facts", { search: "empty" }],
] as const)("an incomplete %s generation is rejected (%#)", async (provider, options) => {
  const created = await generation(provider, options);
  expect(catalogGenerationIsReadable(created.directory, created.id, provider)).toBe(false);
});

test("a non-SQLite generation is rejected", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "catalog-generation-validation-"));
  directories.push(directory);
  const id = "00000000-0000-4000-8000-000000000041";
  await writeFile(path.join(directory, `${id}.sqlite`), "not a database");
  expect(catalogGenerationIsReadable(directory, id, "usda-fdc")).toBe(false);
});

test("checking a missing generation does not create a database", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "catalog-generation-validation-"));
  directories.push(directory);
  const id = "00000000-0000-4000-8000-000000000042";
  expect(catalogGenerationIsReadable(directory, id, "usda-fdc")).toBe(false);
  await expect(access(path.join(directory, `${id}.sqlite`))).rejects.toMatchObject({ code: "ENOENT" });
});
