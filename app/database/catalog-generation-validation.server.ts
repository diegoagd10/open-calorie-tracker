import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import type { CatalogProviderId } from "../catalog/food-catalog.server";

export function catalogGenerationIsReadable(directory: string, generation: string, provider: CatalogProviderId): boolean {
  let database: BetterSqlite3.Database | undefined;
  try {
    database = new BetterSqlite3(path.join(directory, `${generation}.sqlite`), { readonly: true });
    if (database.pragma("quick_check", { simple: true }) !== "ok") return false;
    const records = provider === "open-food-facts" ? "products" : "foods";
    if (database.prepare(`SELECT record FROM ${records} LIMIT 1`).get() === undefined) {
      return false;
    }
    return provider === "open-food-facts"
      || database.prepare("SELECT rowid FROM names LIMIT 1").get() !== undefined;
  } catch {
    return false;
  } finally {
    database?.close();
  }
}
