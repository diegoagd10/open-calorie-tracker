import type { CatalogProviderId } from "../catalog/food-catalog.server";
import { desc, eq, like } from "drizzle-orm";
import type { ApplicationDatabaseClient } from "./database.server";
import { applicationMetadata } from "./schema.server";
import type { CatalogImportJob, CatalogOutcome, CatalogState, CatalogUpdateCheck } from "../catalog-management/catalog-management.server";


export function readCatalogState(database: ApplicationDatabaseClient, provider: CatalogProviderId = "usda-fdc"): Omit<CatalogState, "busy"> {
  const row = database.select().from(applicationMetadata).where(eq(applicationMetadata.key, `catalog:${provider}`)).get();
  return row ? JSON.parse(row.value) as Omit<CatalogState, "busy"> : { installed: null, job: null };
}
export function saveCatalogState(database: ApplicationDatabaseClient, state: Omit<CatalogState, "busy">, provider: CatalogProviderId = "usda-fdc") {
  const row = { key: `catalog:${provider}`, value: JSON.stringify(state), updatedAt: new Date().toISOString() };
  database.transaction(() => {
    database.insert(applicationMetadata).values(row).onConflictDoUpdate({ target: applicationMetadata.key, set: row }).run();
    saveTerminalOutcome(database, state, provider);
  }, { behavior: "immediate" });
}
export function readCatalogUpdateCheck(database: ApplicationDatabaseClient, provider: CatalogProviderId = "usda-fdc"): CatalogUpdateCheck | undefined {
  const row = database.select().from(applicationMetadata).where(eq(applicationMetadata.key, `catalog-update:${provider}`)).get();
  return row ? JSON.parse(row.value) as CatalogUpdateCheck : undefined;
}
export function saveCatalogUpdateCheck(database: ApplicationDatabaseClient, check: CatalogUpdateCheck, provider: CatalogProviderId = "usda-fdc") {
  const row = { key: `catalog-update:${provider}`, value: JSON.stringify(check), updatedAt: check.checkedAt };
  database.insert(applicationMetadata).values(row).onConflictDoUpdate({ target: applicationMetadata.key, set: row }).run();
}
export function claimCatalogInstallation(database: ApplicationDatabaseClient, job: CatalogImportJob, provider: CatalogProviderId = "usda-fdc"): "busy" | null {
  return database.transaction(() => {
    const state = readCatalogState(database, provider);
    if (state.retiring) return "busy";
    if (state.job && !["succeeded", "failed", "interrupted"].includes(state.job.phase)) return "busy";
    saveCatalogState(database, { installed: state.installed, job }, provider);
    return null;
  }, { behavior: "immediate" });
}

function isTerminalJob(job: CatalogImportJob | null): job is CatalogImportJob & { phase: CatalogOutcome["phase"] } {
  return job !== null && ["succeeded", "failed", "interrupted"].includes(job.phase);
}

function saveTerminalOutcome(database: ApplicationDatabaseClient, state: Omit<CatalogState, "busy">, provider: CatalogProviderId) {
  const job = state.job;
  if (!isTerminalJob(job)) return;
  if (job.phase === "succeeded" && state.installed?.generation !== job.id) return;
  const key = `catalog-outcome:${provider}:${job.id}`;
  const existing = database.select().from(applicationMetadata).where(eq(applicationMetadata.key, key)).get();
  // Redelivery keeps the original snapshot and shared acknowledgement. Recovery
  // updates this same job's outcome and makes the changed result unread again.
  if (existing && (JSON.parse(existing.value) as CatalogOutcome).phase === job.phase) return;
  const outcome: CatalogOutcome = { provider, jobId: job.id, filename: job.filename, phase: job.phase, completedAt: job.updatedAt, error: job.error, installed: state.installed, acknowledgedAt: null };
  const row = { key, value: JSON.stringify(outcome), updatedAt: outcome.completedAt };
  database.insert(applicationMetadata).values(row).onConflictDoUpdate({ target: applicationMetadata.key, set: row }).run();
}

export function readCatalogOutcomes(database: ApplicationDatabaseClient, provider: CatalogProviderId): CatalogOutcome[] {
  return database.select().from(applicationMetadata).where(like(applicationMetadata.key, `catalog-outcome:${provider}:%`)).orderBy(desc(applicationMetadata.updatedAt), applicationMetadata.key).all().map(row => JSON.parse(row.value) as CatalogOutcome);
}

export function acknowledgeCatalogOutcome(database: ApplicationDatabaseClient, provider: CatalogProviderId, jobId: string, completedAt: string): boolean {
  return database.transaction(() => {
    const key = `catalog-outcome:${provider}:${jobId}`;
    const row = database.select().from(applicationMetadata).where(eq(applicationMetadata.key, key)).get();
    if (!row) return false;
    const outcome = JSON.parse(row.value) as CatalogOutcome;
    if (outcome.completedAt !== completedAt) return false;
    if (!outcome.acknowledgedAt) {
      outcome.acknowledgedAt = new Date().toISOString();
      database.update(applicationMetadata).set({ value: JSON.stringify(outcome) }).where(eq(applicationMetadata.key, key)).run();
    }
    return true;
  }, { behavior: "immediate" });
}
