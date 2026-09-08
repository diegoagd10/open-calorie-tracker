import { eq } from "drizzle-orm";
import type { ApplicationDatabaseClient } from "./database.server";
import { applicationMetadata } from "./schema.server";
import type { CatalogImportJob, CatalogState } from "../catalog-management/catalog-management.server";

const stateKey = "catalog:usda-fdc";
export function readCatalogState(database: ApplicationDatabaseClient): Omit<CatalogState, "busy"> {
  const row = database.select().from(applicationMetadata).where(eq(applicationMetadata.key, stateKey)).get();
  return row ? JSON.parse(row.value) as Omit<CatalogState, "busy"> : { installed: null, job: null };
}
export function saveCatalogState(database: ApplicationDatabaseClient, state: Omit<CatalogState, "busy">) {
  const row = { key: stateKey, value: JSON.stringify(state), updatedAt: new Date().toISOString() };
  database.insert(applicationMetadata).values(row).onConflictDoUpdate({ target: applicationMetadata.key, set: row }).run();
}
export function claimCatalogInstallation(database: ApplicationDatabaseClient, job: CatalogImportJob): "installed" | "busy" | null {
  return database.transaction(() => {
    const state = readCatalogState(database);
    if (state.installed) return "installed";
    if (state.job && !["succeeded", "failed", "interrupted"].includes(state.job.phase)) return "busy";
    saveCatalogState(database, { installed: null, job });
    return null;
  }, { behavior: "immediate" });
}
