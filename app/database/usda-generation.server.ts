import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import type { CatalogFood } from "../catalog/food-catalog.server.ts";

function withGeneration<T>(directory: string, generation: string, read: (database: BetterSqlite3.Database) => T): T {
  const database = new BetterSqlite3(path.join(directory, `${generation}.sqlite`), { readonly: true, fileMustExist: true });
  try { return read(database); } finally { database.close(); }
}
export function searchUsdaGeneration(directory: string, generation: string, expression: string, relevance: (name: string) => number | null): CatalogFood[] {
  return withGeneration(directory, generation, database => {
    // Derive relevance from unchanged records, also supporting older name-only generations.
    database.function("food_relevance", record => relevance((JSON.parse(record as string) as CatalogFood).name));
    const rows = database.prepare(`
      SELECT foods.record, food_relevance(foods.record) AS relevance
      FROM names JOIN foods ON foods.rowid = names.rowid
      WHERE names MATCH ? AND relevance IS NOT NULL
      ORDER BY relevance, json_extract(foods.record, '$.isSelectable') DESC,
        rank, foods.published DESC, foods.id DESC LIMIT 25
    `).all(expression) as { record: string }[];
    return rows.map(row => JSON.parse(row.record) as CatalogFood);
  });
}
export function readUsdaGenerationFood(directory: string, generation: string, id: string): CatalogFood | undefined {
  return withGeneration(directory, generation, database => {
    const row = database.prepare("SELECT record FROM foods WHERE id = ?").get(id) as { record: string } | undefined;
    return row ? JSON.parse(row.record) as CatalogFood : undefined;
  });
}
// Called only by the import worker, before the management module activates this file.
export function buildUsdaGeneration(directory: string, generation: string, foods: Iterable<CatalogFood>, indexing: () => void, aliasesFor: (name: string) => string[]) {
  const database = new BetterSqlite3(path.join(directory, `${generation}.sqlite`));
  try {
    database.exec("CREATE TABLE foods (id TEXT PRIMARY KEY, published TEXT NOT NULL, record TEXT NOT NULL); CREATE VIRTUAL TABLE names USING fts5(name, aliases, tokenize = 'unicode61 remove_diacritics 2');");
    const insert = database.prepare("INSERT INTO foods (id, published, record) VALUES (?, ?, ?)");
    database.transaction(() => { for (const food of foods) insert.run(food.providerFoodId, food.providerPublishedDate, JSON.stringify(food)); })();
    indexing();
    const index = database.prepare("INSERT INTO names (rowid, name, aliases) VALUES (?, ?, ?)");
    database.transaction(() => {
      for (const row of database.prepare("SELECT rowid, record FROM foods").all() as { rowid: number; record: string }[]) {
        const { name } = JSON.parse(row.record) as CatalogFood;
        index.run(row.rowid, name, aliasesFor(name).join(" "));
      }
      database.exec("INSERT INTO names(names) VALUES ('optimize'); INSERT INTO names(names) VALUES ('integrity-check');");
    })();
    if (database.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("USDA database validation failed.");
  } finally { database.close(); }
}
