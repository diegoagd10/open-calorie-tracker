import { desc, eq, like } from "drizzle-orm";
import type { ApplicationDatabaseClient } from "./database.server";
import { applicationMetadata } from "./schema.server";
import type { CatalogImportJob, CatalogOutcome, CatalogState, CatalogUpdateCheck } from "../catalog-management/catalog-management.server";

// The USDA keys keep their provider suffix from when Open Food Facts was also imported locally.
const STATE_KEY = "catalog:usda-fdc";
const UPDATE_CHECK_KEY = "catalog-update:usda-fdc";
const OUTCOME_KEY_PREFIX = "catalog-outcome:usda-fdc:";

export function readCatalogState(database: ApplicationDatabaseClient): Omit<CatalogState, "busy"> {
  const row = database.select().from(applicationMetadata).where(eq(applicationMetadata.key, STATE_KEY)).get();
  return row ? JSON.parse(row.value) as Omit<CatalogState, "busy"> : { installed: null, job: null };
}
export function saveCatalogState(database: ApplicationDatabaseClient, state: Omit<CatalogState, "busy">) {
  const row = { key: STATE_KEY, value: JSON.stringify(state), updatedAt: new Date().toISOString() };
  database.transaction(() => {
    database.insert(applicationMetadata).values(row).onConflictDoUpdate({ target: applicationMetadata.key, set: row }).run();
    saveTerminalOutcome(database, state);
  }, { behavior: "immediate" });
}
export function readCatalogUpdateCheck(database: ApplicationDatabaseClient): CatalogUpdateCheck | undefined {
  const row = database.select().from(applicationMetadata).where(eq(applicationMetadata.key, UPDATE_CHECK_KEY)).get();
  return row ? JSON.parse(row.value) as CatalogUpdateCheck : undefined;
}
export function saveCatalogUpdateCheck(database: ApplicationDatabaseClient, check: CatalogUpdateCheck) {
  const row = { key: UPDATE_CHECK_KEY, value: JSON.stringify(check), updatedAt: check.checkedAt };
  database.insert(applicationMetadata).values(row).onConflictDoUpdate({ target: applicationMetadata.key, set: row }).run();
}
export function claimCatalogInstallation(database: ApplicationDatabaseClient, job: CatalogImportJob): "busy" | null {
  return database.transaction(() => {
    const state = readCatalogState(database);
    if (state.retiring) return "busy";
    if (state.job && !["succeeded", "failed", "interrupted"].includes(state.job.phase)) return "busy";
    saveCatalogState(database, { installed: state.installed, job: { ...job, operation: state.installed ? "update" : "install" } });
    return null;
  }, { behavior: "immediate" });
}

function isTerminalJob(job: CatalogImportJob | null): job is CatalogImportJob & { phase: CatalogOutcome["phase"] } {
  return job !== null && ["succeeded", "failed", "interrupted"].includes(job.phase);
}

function saveTerminalOutcome(database: ApplicationDatabaseClient, state: Omit<CatalogState, "busy">) {
  const job = state.job;
  if (!isTerminalJob(job)) return;
  if (job.phase === "succeeded" && state.installed?.generation !== job.id) return;
  const key = `${OUTCOME_KEY_PREFIX}${job.id}`;
  const existing = database.select().from(applicationMetadata).where(eq(applicationMetadata.key, key)).get();
  // Redelivery keeps the original snapshot and shared acknowledgement. Recovery
  // updates this same job's outcome and makes the changed result unread again.
  if (existing && (JSON.parse(existing.value) as CatalogOutcome).phase === job.phase) return;
  const outcome: CatalogOutcome = { provider: "usda-fdc", jobId: job.id, filename: job.filename, phase: job.phase, completedAt: job.updatedAt, operation: job.operation, error: job.error, installed: state.installed, acknowledgedAt: null };
  const row = { key, value: JSON.stringify(outcome), updatedAt: outcome.completedAt };
  database.insert(applicationMetadata).values(row).onConflictDoUpdate({ target: applicationMetadata.key, set: row }).run();
}

export function readCatalogOutcomes(database: ApplicationDatabaseClient): CatalogOutcome[] {
  return database.select().from(applicationMetadata).where(like(applicationMetadata.key, `${OUTCOME_KEY_PREFIX}%`)).orderBy(desc(applicationMetadata.updatedAt), applicationMetadata.key).all().map(row => JSON.parse(row.value) as CatalogOutcome);
}

export function acknowledgeCatalogOutcome(database: ApplicationDatabaseClient, jobId: string, completedAt: string): boolean {
  return database.transaction(() => {
    const key = `${OUTCOME_KEY_PREFIX}${jobId}`;
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
