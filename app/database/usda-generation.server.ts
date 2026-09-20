import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import type { CatalogFood } from "../catalog/food-catalog.server.ts";
import { foundationCatalogFoodSchema } from "./usda-foundation-schema.server.ts";

export type UsdaGenerationCategory = { id: string; name: string };
export type UsdaGenerationFood = { categoryId: string; food: CatalogFood };
export type UsdaGenerationBuild = {
  categories: Iterable<UsdaGenerationCategory>;
  foods: Iterable<UsdaGenerationFood>;
};
export type UsdaPhotoAnalysisGeneration = {
  categories(): UsdaGenerationCategory[];
  candidates(categoryId: string): CatalogFood[];
  food(fdcId: string): CatalogFood | undefined;
};

export const USDA_PHOTO_ANALYSIS_CAPABILITY = { name: "photo-analysis", version: 1 } as const;

function parseGenerationFood(record: string, expectedId: string, expectedGeneration: string): CatalogFood {
  const food = foundationCatalogFoodSchema.parse(JSON.parse(record));
  if (food.providerFoodId !== expectedId || food.catalogGeneration !== expectedGeneration) {
    throw new Error("USDA generation food identity is inconsistent.");
  }
  return food;
}

export function usdaGenerationRecordIsValid(record: string, expectedId: string, expectedGeneration: string): boolean {
  try {
    parseGenerationFood(record, expectedId, expectedGeneration);
    return true;
  } catch {
    return false;
  }
}

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
function hasCompleteCoreNutrition(food: CatalogFood): boolean {
  const nutrition = food.nutritionPerAuthoritativeBase;
  return nutrition.energyMilliKcal !== null
    && nutrition.proteinMilligrams !== null
    && nutrition.carbohydrateMilligrams !== null
    && nutrition.fatMilligrams !== null;
}

export async function withUsdaPhotoAnalysisGeneration<T>(
  directory: string,
  generation: string,
  read: (snapshot: UsdaPhotoAnalysisGeneration) => Promise<T> | T,
): Promise<T> {
  const database = new BetterSqlite3(path.join(directory, `${generation}.sqlite`), { readonly: true, fileMustExist: true });
  try {
    const capability = database.prepare("SELECT version FROM generation_capabilities WHERE name = ?").get(USDA_PHOTO_ANALYSIS_CAPABILITY.name) as { version: number } | undefined;
    if (capability?.version !== USDA_PHOTO_ANALYSIS_CAPABILITY.version) throw new Error("USDA generation does not support Photo Analysis.");
    const snapshot: UsdaPhotoAnalysisGeneration = {
      categories: () => (database.prepare("SELECT id, name FROM food_categories ORDER BY name COLLATE NOCASE, id").all() as UsdaGenerationCategory[]),
      candidates: categoryId => (database.prepare("SELECT id, record FROM foods WHERE category_id = ? ORDER BY json_extract(record, '$.originalName') COLLATE NOCASE, id").all(categoryId) as { id: string; record: string }[])
        .map(row => parseGenerationFood(row.record, row.id, generation))
        .filter(hasCompleteCoreNutrition),
      food: fdcId => {
        const row = database.prepare("SELECT record FROM foods WHERE id = ?").get(fdcId) as { record: string } | undefined;
        const food = row ? parseGenerationFood(row.record, fdcId, generation) : undefined;
        return food && hasCompleteCoreNutrition(food) ? food : undefined;
      },
    };
    return await read(snapshot);
  } finally {
    database.close();
  }
}

export function buildUsdaGeneration(
  directory: string,
  generation: string,
  source: UsdaGenerationBuild,
  indexing: () => void,
  aliasesFor: (name: string) => string[],
) {
  const database = new BetterSqlite3(path.join(directory, `${generation}.sqlite`));
  try {
    database.pragma("foreign_keys = ON");
    database.exec("CREATE TABLE generation_capabilities (name TEXT PRIMARY KEY, version INTEGER NOT NULL); CREATE TABLE food_categories (id TEXT PRIMARY KEY, name TEXT NOT NULL); CREATE TABLE foods (id TEXT PRIMARY KEY, published TEXT NOT NULL, category_id TEXT NOT NULL REFERENCES food_categories(id), record TEXT NOT NULL); CREATE VIRTUAL TABLE names USING fts5(name, aliases, tokenize = 'unicode61 remove_diacritics 2');");
    database.prepare("INSERT INTO generation_capabilities (name, version) VALUES (?, ?)").run(USDA_PHOTO_ANALYSIS_CAPABILITY.name, USDA_PHOTO_ANALYSIS_CAPABILITY.version);
    const insertCategory = database.prepare("INSERT INTO food_categories (id, name) VALUES (?, ?)");
    database.transaction(() => { for (const category of source.categories) insertCategory.run(category.id, category.name); })();
    const insert = database.prepare("INSERT INTO foods (id, published, category_id, record) VALUES (?, ?, ?, ?)");
    database.transaction(() => {
      for (const { categoryId, food } of source.foods) insert.run(food.providerFoodId, food.providerPublishedDate, categoryId, JSON.stringify(food));
    })();
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
