import path from "node:path";
import BetterSqlite3 from "better-sqlite3";

export function catalogGenerationIsReadable(directory: string, generation: string): boolean {
  let database: BetterSqlite3.Database | undefined;
  try {
    database = new BetterSqlite3(path.join(directory, `${generation}.sqlite`), { readonly: true });
    if (database.pragma("quick_check", { simple: true }) !== "ok") return false;
    return database.prepare("SELECT record FROM foods LIMIT 1").get() !== undefined
      && database.prepare("SELECT rowid FROM names LIMIT 1").get() !== undefined;
  } catch {
    return false;
  } finally {
    database?.close();
  }
}
