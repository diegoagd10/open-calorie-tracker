import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, expect, test } from "vitest";

import { openApplicationDatabase } from "../app/database/database.server";

const run = promisify(execFile);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

const offInstalled = "00000000-0000-4000-8000-0000000000a1";
const offRetiring = "00000000-0000-4000-8000-0000000000a2";
const offJob = "00000000-0000-4000-8000-0000000000a3";
const usdaInstalled = "00000000-0000-4000-8000-0000000000b1";
const usdaJob = "00000000-0000-4000-8000-0000000000b2";

/** A database and catalog directory as an installation that imported both catalogs leaves them. */
async function upgradedInstallation(options: { catalogDirectory?: "default" | "configured" } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-off-cleanup-"));
  directories.push(directory);
  const databasePath = path.join(directory, "application.sqlite");
  const catalogDirectory = options.catalogDirectory === "configured" ? path.join(directory, "elsewhere") : path.join(directory, "catalogs");
  openApplicationDatabase({ databasePath, migrationsFolder: path.resolve("drizzle") }).close();
  const database = new BetterSqlite3(databasePath);
  const insert = database.prepare("INSERT INTO application_metadata (key, value, updated_at) VALUES (?, ?, '2026-01-01T00:00:00.000Z')");
  const generation = (id: string) => ({ generation: id, filename: "archive", sha256: "sha", foodCount: 1, installedAt: "2026-01-01T00:00:00.000Z", publicationDateRange: { earliest: "", latest: "" } });
  insert.run("catalog:open-food-facts", JSON.stringify({ installed: generation(offInstalled), retiring: generation(offRetiring), job: { id: offJob, phase: "importing" } }));
  insert.run("catalog-update:open-food-facts", JSON.stringify({ status: "unchanged" }));
  insert.run(`catalog-outcome:open-food-facts:${offInstalled}`, JSON.stringify({ provider: "open-food-facts", jobId: offInstalled, installed: generation(offInstalled) }));
  insert.run("catalog:usda-fdc", JSON.stringify({ installed: generation(usdaInstalled), job: { id: usdaJob, phase: "importing" } }));
  insert.run("catalog-update:usda-fdc", JSON.stringify({ status: "unchanged" }));
  insert.run(`catalog-outcome:usda-fdc:${usdaInstalled}`, JSON.stringify({ provider: "usda-fdc", jobId: usdaInstalled }));
  insert.run("off:contact", "family@example.com");
  database.close();
  await mkdir(catalogDirectory, { recursive: true });
  await mkdir(path.join(catalogDirectory, `${offJob}.staging`));
  for (const name of [
    `${offInstalled}.sqlite`, `${offInstalled}.sqlite-journal`, `${offRetiring}.sqlite`, `${offJob}.gz`, `${offJob}.sqlite`,
    `${usdaInstalled}.sqlite`, `${usdaJob}.zip`, `${usdaJob}.sqlite`, ".local-import-token", "operator-note.txt",
  ]) await writeFile(path.join(catalogDirectory, name), "data");
  const environment = {
    ...process.env,
    DATABASE_PATH: databasePath,
    ...(options.catalogDirectory === "configured" ? { CATALOG_DIRECTORY: catalogDirectory } : {}),
  };
  return { catalogDirectory, databasePath, environment };
}

function metadataKeys(databasePath: string): string[] {
  const database = new BetterSqlite3(databasePath, { readonly: true });
  try {
    return (database.prepare("SELECT key FROM application_metadata WHERE key <> 'schema_version' ORDER BY key").all() as { key: string }[]).map((row) => row.key);
  } finally {
    database.close();
  }
}

function cleanup(environment: NodeJS.ProcessEnv, ...arguments_: string[]) {
  return run(process.execPath, ["scripts/remove-local-off-catalog.mjs", ...arguments_], { env: environment });
}

const usdaKeys = ["catalog-outcome:usda-fdc:" + usdaInstalled, "catalog-update:usda-fdc", "catalog:usda-fdc", "off:contact"];
const remainingFiles = [".local-import-token", `${usdaInstalled}.sqlite`, `${usdaJob}.sqlite`, `${usdaJob}.zip`, "operator-note.txt"];

test("a dry run prints the OFF keys and files it would delete and deletes nothing", async () => {
  const { catalogDirectory, databasePath, environment } = await upgradedInstallation();
  const keysBefore = metadataKeys(databasePath);
  const filesBefore = (await readdir(catalogDirectory)).sort();

  const { stdout } = await cleanup(environment);

  expect(stdout).toContain("Would delete");
  for (const expected of ["catalog:open-food-facts", "catalog-update:open-food-facts", `catalog-outcome:open-food-facts:${offInstalled}`, `${offInstalled}.sqlite`, `${offRetiring}.sqlite`, `${offJob}.gz`, `${offJob}.staging`]) {
    expect(stdout).toContain(expected);
  }
  expect(stdout).not.toMatch(/usda-fdc|b1\.sqlite|b2\./);
  expect(stdout).toContain("Run again with --yes");
  expect(metadataKeys(databasePath)).toEqual(keysBefore);
  expect((await readdir(catalogDirectory)).sort()).toEqual(filesBefore);
});

test.each(["default", "configured"] as const)("--yes removes only OFF keys and files from the %s catalog directory, and a second run is a no-op", async (catalogDirectoryOption) => {
  const { catalogDirectory, databasePath, environment } = await upgradedInstallation({ catalogDirectory: catalogDirectoryOption });

  const { stdout } = await cleanup(environment, "--yes");

  expect(stdout).toContain("Done.");
  expect(metadataKeys(databasePath)).toEqual(usdaKeys);
  expect((await readdir(catalogDirectory)).sort()).toEqual(remainingFiles);

  const again = await cleanup(environment, "--yes");
  expect(again.stdout).toContain("nothing to remove");
  expect(metadataKeys(databasePath)).toEqual(usdaKeys);
  expect((await readdir(catalogDirectory)).sort()).toEqual(remainingFiles);
});

test("state whose files are already gone still has its keys removed", async () => {
  const { catalogDirectory, databasePath, environment } = await upgradedInstallation();
  await rm(catalogDirectory, { force: true, recursive: true });

  const { stdout } = await cleanup(environment, "--yes");

  expect(stdout).not.toContain("file ");
  expect(metadataKeys(databasePath)).toEqual(usdaKeys);
});

test("a missing database is reported without being created, and unknown arguments are refused", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-off-cleanup-"));
  directories.push(directory);
  const databasePath = path.join(directory, "missing.sqlite");
  const environment = { ...process.env, DATABASE_PATH: databasePath };

  expect((await cleanup(environment, "--yes")).stdout).toContain("nothing to remove");
  expect(existsSync(databasePath)).toBe(false);
  await expect(cleanup(environment, "--force")).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("Unknown argument: --force") as unknown });
});
