import path from "node:path";
import { z } from "zod";
import { getApplicationDatabase } from "../database/runtime.server";
import type { ApplicationDatabaseClient } from "../database/database.server";
import { CatalogManagement } from "./catalog-management.server";
import { UsdaFoundationSourceTransport } from "./usda-foundation-update-source.server";

function configuration() {
  return z.object({
    CATALOG_DIRECTORY: z.string().trim().min(1).optional(),
    DATABASE_PATH: z.string().optional(),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    CATALOG_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(64 * 1024 * 1024),
    CATALOG_MAX_EXPANDED_BYTES: z.coerce.number().int().positive().default(256 * 1024 * 1024),
  }).parse(process.env);
}
export function catalogDirectory() {
  const config = configuration();
  return path.resolve(config.CATALOG_DIRECTORY ?? path.join(path.dirname(config.DATABASE_PATH ?? "data/open-calory-tracker.sqlite"), "catalogs"));
}

export function localCatalogImportBaseUrl() {
  return `http://127.0.0.1:${configuration().PORT}`;
}

let current: { database: ApplicationDatabaseClient; management: CatalogManagement } | undefined;
export function getCatalogManagement() {
  const database = getApplicationDatabase().getClient();
  if (current?.database === database) return current.management;
  const config = configuration();
  const management = new CatalogManagement(database, {
    directory: catalogDirectory(), maxUploadBytes: config.CATALOG_MAX_UPLOAD_BYTES, maxExpandedBytes: config.CATALOG_MAX_EXPANDED_BYTES,
    workerPath: path.resolve(process.env.NODE_ENV === "production" || process.env.CATALOG_BUILT_WORKER === "1" ? "build/catalog/import-worker.js" : "app/catalog-management/import-worker.ts"),
    ...(process.env.NODE_ENV !== "test" ? { sourceTransport: new UsdaFoundationSourceTransport() } : {}),
  });
  current = { database, management };
  return management;
}
export async function shutdownCatalogManagement() { await current?.management.shutdown(); current = undefined; }
