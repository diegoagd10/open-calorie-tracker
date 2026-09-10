import type { CatalogProviderId } from "../catalog/food-catalog.server";
import path from "node:path";
import { z } from "zod";
import { getApplicationDatabase } from "../database/runtime.server";
import type { ApplicationDatabaseClient } from "../database/database.server";
import { CatalogManagement } from "./catalog-management.server";
import { OffSnapshotSourceTransport } from "./off-snapshot-source.server";
import { UsdaFoundationSourceTransport } from "./usda-foundation-update-source.server";

function configuration() {
  return z.object({
    CATALOG_DIRECTORY: z.string().trim().min(1).optional(),
    DATABASE_PATH: z.string().optional(),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    OFF_CATALOG_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(4 * 1024 ** 3),
    OFF_CATALOG_MAX_EXPANDED_BYTES: z.coerce.number().int().positive().default(32 * 1024 ** 3),
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

const current = new Map<CatalogProviderId, { database: ApplicationDatabaseClient; management: CatalogManagement }>();
export function getCatalogManagement(provider: CatalogProviderId = "usda-fdc") {
  const database = getApplicationDatabase().getClient();
  const existing = current.get(provider);
  if (existing?.database === database) return existing.management;
  const config = configuration();
  const management = new CatalogManagement(database, {
    provider, directory: catalogDirectory(), maxUploadBytes: provider === "open-food-facts" ? config.OFF_CATALOG_MAX_UPLOAD_BYTES : config.CATALOG_MAX_UPLOAD_BYTES, maxExpandedBytes: provider === "open-food-facts" ? config.OFF_CATALOG_MAX_EXPANDED_BYTES : config.CATALOG_MAX_EXPANDED_BYTES,
    workerPath: path.resolve(process.env.NODE_ENV === "production" || process.env.CATALOG_BUILT_WORKER === "1" ? "build/catalog/import-worker.js" : "app/catalog-management/import-worker.ts"),
    ...(provider === "open-food-facts" && (process.env.NODE_ENV !== "test" || process.env.CATALOG_BUILT_WORKER === "1") ? { offSourceTransport: new OffSnapshotSourceTransport() } : {}),
    ...(provider === "usda-fdc" && process.env.NODE_ENV !== "test" ? { sourceTransport: new UsdaFoundationSourceTransport() } : {}),
  });
  current.set(provider, { database, management });
  return management;
}
export async function shutdownCatalogManagement() { await Promise.all([...current.values()].map(value => value.management.shutdown())); current.clear(); }
