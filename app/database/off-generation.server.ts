import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import type { CatalogFood } from "../catalog/food-catalog.server.ts";

export function readOffGenerationFood(directory: string, generation: string, id: string): CatalogFood | undefined {
  // Stryker disable next-line BooleanLiteral: either immutable-open option independently prevents a missing catalog from being created; their joint contract is tested.
  const database = new BetterSqlite3(path.join(directory, `${generation}.sqlite`), { readonly: true, fileMustExist: true });
  try {
    const row = database.prepare("SELECT record FROM products WHERE id = ?").get(id) as { record: string } | undefined;
    return row ? JSON.parse(row.record) as CatalogFood : undefined;
  } finally { database.close(); }
}

export function searchOffGeneration(directory: string, generation: string, expression: string, relevance: (food: CatalogFood) => number | null): CatalogFood[] {
  // Stryker disable next-line BooleanLiteral: either immutable-open option independently prevents a missing catalog from being created; their joint contract is tested.
  const database = new BetterSqlite3(path.join(directory, `${generation}.sqlite`), { readonly: true, fileMustExist: true });
  try {
    database.function("food_relevance", record => relevance(JSON.parse(record as string) as CatalogFood));
    const rows = database.prepare(`
      SELECT products.record, food_relevance(products.record) AS relevance
      FROM product_search JOIN products ON products.rowid = product_search.rowid
      WHERE product_search MATCH ? AND relevance IS NOT NULL
      ORDER BY relevance, json_extract(products.record, '$.isSelectable') DESC,
        rank, products.id ASC LIMIT 25
    `).all(expression) as { record: string }[];
    return rows.map(row => JSON.parse(row.record) as CatalogFood);
  } finally { database.close(); }
}

// Bounded transactions and SQLite cache; the export is never accumulated in memory.
export async function buildOffGeneration(directory: string, generation: string, foods: AsyncIterable<CatalogFood>, maxBytes: number, duplicate: () => void, indexing: () => void, aliasesFor: (food: CatalogFood) => string[]) {
  const database = new BetterSqlite3(path.join(directory, `${generation}.sqlite`));
  let count = 0;
  try {
    database.pragma("cache_size = -8192");
    database.pragma(`max_page_count = ${Math.max(1, Math.floor(maxBytes / 4096))}`);
    database.exec("CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT NOT NULL, aliases TEXT NOT NULL, brands TEXT NOT NULL, record TEXT NOT NULL); CREATE VIRTUAL TABLE product_search USING fts5(name, aliases, brands, tokenize = 'unicode61 remove_diacritics 2');");
    const insert = database.prepare("INSERT OR IGNORE INTO products (id, name, aliases, brands, record) VALUES (?, ?, ?, ?, ?)");
    const batch: CatalogFood[] = [];
    const flush = database.transaction(() => {
      for (const food of batch) {
        const result = insert.run(food.providerFoodId, food.name, aliasesFor(food).join(" "), food.brand ?? "", JSON.stringify(food));
        if (result.changes) count++; else duplicate();
      }
    });
    for await (const food of foods) {
      batch.push(food);
      if (batch.length === 500) { flush(); batch.length = 0; }
    }
    flush();
    indexing();
    database.transaction(() => {
      database.exec("INSERT INTO product_search (rowid, name, aliases, brands) SELECT rowid, name, aliases, brands FROM products");
      database.exec("INSERT INTO product_search(product_search) VALUES ('optimize'); INSERT INTO product_search(product_search) VALUES ('integrity-check');");
    })();
    validateGeneration(database, count);
    return count;
  } finally { database.close(); }
}

function validateGeneration(database: BetterSqlite3.Database, count: number) {
  if (!count) throw new Error("OFF_EMPTY");
  if (database.pragma("quick_check", { simple: true }) !== "ok") throw new Error("OFF_DATABASE_INVALID");
}
