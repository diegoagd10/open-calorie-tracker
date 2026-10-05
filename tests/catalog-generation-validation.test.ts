import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, expect, test } from "vitest";
import { catalogGenerationIsReadable } from "../app/database/catalog-generation-validation.server";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

type TableState = "populated" | "empty" | "missing";
async function generation(options: { records?: TableState; search?: TableState } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "catalog-generation-validation-"));
  directories.push(directory);
  const id = "00000000-0000-4000-8000-000000000040";
  const database = new BetterSqlite3(path.join(directory, `${id}.sqlite`));
  const [records, search] = ["foods", "names"];
  const recordsState = options.records ?? "populated";
  const searchState = options.search ?? "populated";
  if (recordsState !== "missing") {
    database.exec(`CREATE TABLE ${records} (record TEXT)`);
    if (recordsState === "populated") database.prepare(`INSERT INTO ${records} (record) VALUES (?)`).run("record");
  }
  if (searchState !== "missing") {
    database.exec(`CREATE TABLE ${search} (value TEXT)`);
    if (searchState === "populated") database.prepare(`INSERT INTO ${search} (value) VALUES (?)`).run("search");
  }
  database.close();
  return { directory, id };
}

test("a complete generation is readable", async () => {
  const created = await generation();
  expect(catalogGenerationIsReadable(created.directory, created.id)).toBe(true);
});

test.each([
  { records: "missing" },
  { search: "missing" },
  { records: "empty" },
  { search: "empty" },
] as const)("an incomplete generation is rejected (%#)", async (options) => {
  const created = await generation(options);
  expect(catalogGenerationIsReadable(created.directory, created.id)).toBe(false);
});

test("a non-SQLite generation is rejected", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "catalog-generation-validation-"));
  directories.push(directory);
  const id = "00000000-0000-4000-8000-000000000041";
  await writeFile(path.join(directory, `${id}.sqlite`), "not a database");
  expect(catalogGenerationIsReadable(directory, id)).toBe(false);
});

test("checking a missing generation does not create a database", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "catalog-generation-validation-"));
  directories.push(directory);
  const id = "00000000-0000-4000-8000-000000000042";
  expect(catalogGenerationIsReadable(directory, id)).toBe(false);
  await expect(access(path.join(directory, `${id}.sqlite`))).rejects.toMatchObject({ code: "ENOENT" });
});
