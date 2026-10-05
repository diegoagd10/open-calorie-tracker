// Removes the local Open Food Facts catalog left behind by releases that imported it:
// its application metadata rows and the generation, journal, staging and upload files
// those rows still reference. USDA state and files are never touched.
//
//   node scripts/remove-local-off-catalog.mjs         # print what would be deleted
//   node scripts/remove-local-off-catalog.mjs --yes   # delete it
//
// It reads DATABASE_PATH and CATALOG_DIRECTORY like the application, imports no application
// code, and is safe to run any number of times, before or after upgrading.
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import BetterSqlite3 from "better-sqlite3";

const OFF_KEYS = "key IN ('catalog:open-food-facts', 'catalog-update:open-food-facts') OR key LIKE 'catalog-outcome:open-food-facts:%'";
const USDA_STATE_KEY = "catalog:usda-fdc";
const GENERATION_FILES = [".sqlite", ".sqlite-journal"];
const JOB_FILES = [".gz", ".staging", ".sqlite", ".sqlite-journal"];

function configuredPath(value) {
  if (value === undefined) return undefined;
  const candidate = value.trim();
  if (candidate === "") throw new Error("Configured database paths cannot be blank");
  return candidate;
}

function locations(environment) {
  const databasePath = configuredPath(environment.DATABASE_PATH) ?? path.resolve("data", "open-calory-tracker.sqlite");
  const catalogDirectory = path.resolve(
    environment.CATALOG_DIRECTORY?.trim() ||
      path.join(path.dirname(environment.DATABASE_PATH ?? "data/open-calory-tracker.sqlite"), "catalogs"),
  );
  return { catalogDirectory, databasePath };
}

function parsed(value) {
  try {
    const result = JSON.parse(value);
    return result !== null && typeof result === "object" ? result : {};
  } catch {
    return {};
  }
}

/** Generation and job ids a stored catalog state or outcome references, with the files each owns. */
function referencedFiles(value) {
  const state = parsed(value);
  const files = [];
  for (const generation of [state.installed?.generation, state.retiring?.generation]) {
    if (typeof generation === "string") files.push(...GENERATION_FILES.map((suffix) => generation + suffix));
  }
  if (typeof state.job?.id === "string") files.push(...JOB_FILES.map((suffix) => state.job.id + suffix));
  return files;
}

/** A file name inside the catalog directory, never a path that escapes it. */
function isPlainName(name) {
  return name === path.basename(name) && !name.startsWith(".");
}

export function removeLocalOffCatalog({ arguments_ = [], environment = process.env, write = (line) => console.log(line) } = {}) {
  const unknown = arguments_.filter((argument) => argument !== "--yes");
  if (unknown.length) throw new Error(`Unknown argument: ${unknown[0]}. Usage: node scripts/remove-local-off-catalog.mjs [--yes]`);
  const confirmed = arguments_.includes("--yes");
  const { catalogDirectory, databasePath } = locations(environment);

  if (!existsSync(databasePath)) {
    write(`No application database at ${databasePath}; nothing to remove.`);
    return { deletedFiles: [], deletedKeys: [] };
  }
  const database = new BetterSqlite3(databasePath, { fileMustExist: true });
  try {
    database.pragma("busy_timeout = 5000");
    const rows = database.prepare(`SELECT key, value FROM application_metadata WHERE ${OFF_KEYS} ORDER BY key`).all();
    const usda = database.prepare("SELECT value FROM application_metadata WHERE key = ?").get(USDA_STATE_KEY);
    const protectedFiles = new Set(usda ? referencedFiles(usda.value) : []);
    const files = [...new Set(rows.flatMap((row) => referencedFiles(row.value)))]
      .filter((name) => isPlainName(name) && !protectedFiles.has(name))
      .filter((name) => existsSync(path.join(catalogDirectory, name)))
      .sort();
    const keys = rows.map((row) => row.key);

    if (!keys.length && !files.length) {
      write("No local Open Food Facts catalog state or files were found; nothing to remove.");
      return { deletedFiles: [], deletedKeys: [] };
    }
    write(`${confirmed ? "Deleting" : "Would delete"} from ${databasePath}:`);
    for (const key of keys) write(`  metadata ${key}`);
    if (files.length) write(`${confirmed ? "Deleting" : "Would delete"} from ${catalogDirectory}:`);
    for (const name of files) write(`  file ${name}`);
    if (!confirmed) {
      write("Nothing was deleted. Run again with --yes to delete these.");
      return { deletedFiles: [], deletedKeys: [] };
    }

    // Files first: if one cannot be removed, the metadata still names it for the next run.
    for (const name of files) rmSync(path.join(catalogDirectory, name), { force: true, recursive: true });
    database.prepare(`DELETE FROM application_metadata WHERE ${OFF_KEYS}`).run();
    write("Done. The local Open Food Facts catalog was removed; USDA was not touched.");
    return { deletedFiles: files, deletedKeys: keys };
  } finally {
    database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    removeLocalOffCatalog({ arguments_: process.argv.slice(2) });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
