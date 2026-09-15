import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import type { CatalogFood } from "../catalog/food-catalog.server.ts";

export function readOffGenerationFood(directory: string, generation: string, id: string): CatalogFood | undefined {
  const database = new BetterSqlite3(path.join(directory, `${generation}.sqlite`), { readonly: true, fileMustExist: true });
  try {
    const row = database.prepare("SELECT record FROM products WHERE id = ?").get(id) as { record: string } | undefined;
    return row ? JSON.parse(row.record) as CatalogFood : undefined;
  } finally { database.close(); }
}

export type BuildOffGenerationOptions = {
  directory: string;
  foods: AsyncIterable<CatalogFood>;
  generation: string;
  maxBytes: number;
  onDuplicate: () => void;
  onStored: (food: CatalogFood) => void;
};

// Bounded transactions and SQLite cache; the export is never accumulated in memory.
export async function buildOffGeneration({
  directory,
  foods,
  generation,
  maxBytes,
  onDuplicate,
  onStored,
}: BuildOffGenerationOptions) {
  const database = new BetterSqlite3(path.join(directory, `${generation}.sqlite`));
  let count = 0;
  try {
    database.pragma("cache_size = -8192");
    database.pragma(`max_page_count = ${Math.max(1, Math.floor(maxBytes / 4096))}`);
    database.exec("CREATE TABLE products (id TEXT PRIMARY KEY, record TEXT NOT NULL)");
    const insert = database.prepare("INSERT OR IGNORE INTO products (id, record) VALUES (?, ?)");
    const batch: CatalogFood[] = [];
    const flush = database.transaction(() => {
      for (const food of batch) {
        const result = insert.run(food.providerFoodId, JSON.stringify(food));
        if (result.changes) { count++; onStored(food); } else onDuplicate();
      }
    });
    for await (const food of foods) {
      batch.push(food);
      if (batch.length === 500) { flush(); batch.length = 0; }
    }
    flush();
    validateGeneration(database, count);
    return count;
  } finally { database.close(); }
}

function validateGeneration(database: BetterSqlite3.Database, count: number) {
  if (!count) throw new Error("OFF_EMPTY");
  if (database.pragma("quick_check", { simple: true }) !== "ok") throw new Error("OFF_DATABASE_INVALID");
}
