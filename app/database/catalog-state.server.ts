import type { CatalogProviderId } from "../catalog/food-catalog.server";
import { eq } from "drizzle-orm";
import type { ApplicationDatabaseClient } from "./database.server";
import { applicationMetadata } from "./schema.server";
import type { CatalogImportJob, CatalogState } from "../catalog-management/catalog-management.server";


export function readCatalogState(database: ApplicationDatabaseClient, provider: CatalogProviderId = "usda-fdc"): Omit<CatalogState, "busy"> {
  const row = database.select().from(applicationMetadata).where(eq(applicationMetadata.key, `catalog:${provider}`)).get();
  return row ? JSON.parse(row.value) as Omit<CatalogState, "busy"> : { installed: null, job: null };
}
export function saveCatalogState(database: ApplicationDatabaseClient, state: Omit<CatalogState, "busy">, provider: CatalogProviderId = "usda-fdc") {
  const row = { key: `catalog:${provider}`, value: JSON.stringify(state), updatedAt: new Date().toISOString() };
  database.insert(applicationMetadata).values(row).onConflictDoUpdate({ target: applicationMetadata.key, set: row }).run();
}
export function claimCatalogInstallation(database: ApplicationDatabaseClient, job: CatalogImportJob, provider: CatalogProviderId = "usda-fdc", allowReplacement = false): "installed" | "busy" | null {
  return database.transaction(() => {
    const state = readCatalogState(database, provider);
    if (state.installed && !allowReplacement) return "installed";
    if (state.retiring) return "busy";
    if (state.job && !["succeeded", "failed", "interrupted"].includes(state.job.phase)) return "busy";
    saveCatalogState(database, { installed: state.installed, job }, provider);
    return null;
  }, { behavior: "immediate" });
}
