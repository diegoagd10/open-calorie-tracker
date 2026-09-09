import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import type { CatalogProviderId } from "../catalog/food-catalog.server";

export function catalogGenerationIsReadable(directory: string, generation: string, provider: CatalogProviderId): boolean {
  let database: BetterSqlite3.Database | undefined;
  try {
    database = new BetterSqlite3(path.join(directory, `${generation}.sqlite`), { readonly: true });
    const required = provider === "open-food-facts" ? ["products", "product_search"] : ["foods", "names"];
    if (database.pragma("quick_check", { simple: true }) !== "ok") return false;
    const [records, search] = required;
    return database.prepare(`SELECT 1 FROM ${records} LIMIT 1`).get() !== undefined
      && database.prepare(`SELECT rowid FROM ${search} LIMIT 1`).get() !== undefined;
  } catch {
    return false;
  } finally {
    database?.close();
  }
}
