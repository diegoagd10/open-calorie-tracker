import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import type { CatalogProviderId } from "../catalog/food-catalog.server";
import { USDA_PHOTO_ANALYSIS_CAPABILITY, usdaGenerationRecordIsValid } from "./usda-generation.server.ts";

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

export type UsdaPhotoAnalysisGenerationReadiness = "ready" | "reimport-required" | "unavailable";

export function usdaPhotoAnalysisGenerationReadiness(directory: string, generation: string): UsdaPhotoAnalysisGenerationReadiness {
  if (!catalogGenerationIsReadable(directory, generation, "usda-fdc")) return "unavailable";
  let database: BetterSqlite3.Database | undefined;
  try {
    database = new BetterSqlite3(path.join(directory, `${generation}.sqlite`), { readonly: true, fileMustExist: true });
    const capabilityTable = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'generation_capabilities'").get();
    if (!capabilityTable) return "reimport-required";
    const capability = database.prepare("SELECT version FROM generation_capabilities WHERE name = ?").get(USDA_PHOTO_ANALYSIS_CAPABILITY.name) as { version: unknown } | undefined;
    if (capability?.version !== USDA_PHOTO_ANALYSIS_CAPABILITY.version) return "reimport-required";
    const foodColumns = database.pragma("table_info(foods)") as { name: string }[];
    if (!foodColumns.some(column => column.name === "category_id")) return "unavailable";
    const categories = database.prepare("SELECT id, name FROM food_categories").all() as { id: unknown; name: unknown }[];
    if (categories.length === 0 || categories.some(category => typeof category.id !== "string" || !/^[1-9]\d*$/u.test(category.id) || typeof category.name !== "string" || !category.name.trim())) return "unavailable";
    const missingCategory = database.prepare("SELECT 1 FROM foods LEFT JOIN food_categories ON food_categories.id = foods.category_id WHERE food_categories.id IS NULL LIMIT 1").get();
    if (missingCategory) return "unavailable";
    const foods = database.prepare("SELECT id, record FROM foods").all() as { id: string; record: string }[];
    return foods.every(food => usdaGenerationRecordIsValid(food.record, food.id, generation)) ? "ready" : "unavailable";
  } catch {
    return "unavailable";
  } finally {
    database?.close();
  }
}
