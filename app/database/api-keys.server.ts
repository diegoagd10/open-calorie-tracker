import { and, count, eq, sql } from "drizzle-orm";
import { getApplicationDatabase } from "./runtime.server";
import { apiKeys } from "./schema.server";

export type NewApiKeyRow = {
  name: string;
  keyHash: string;
  keyCiphertext: string;
  keyPrefix: string;
  keyLastFour: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
};

/** Inserts a key unless the owner already has `limit` keys or one with the same name. */
export function insertApiKey(ownerId: number, row: NewApiKeyRow, limit: number): "created" | "limit" | "duplicate-name" {
  return getApplicationDatabase().getClient().transaction((transaction) => {
    const owned = transaction.select({ total: count() }).from(apiKeys).where(eq(apiKeys.ownerId, ownerId)).get()?.total ?? 0;
    if (owned >= limit) return "limit";
    const sameName = transaction.select({ id: apiKeys.id }).from(apiKeys)
      .where(and(eq(apiKeys.ownerId, ownerId), sql`${apiKeys.name} = ${row.name} COLLATE NOCASE`)).get();
    if (sameName) return "duplicate-name";
    transaction.insert(apiKeys).values({ ...row, ownerId, scopes: JSON.stringify(row.scopes) }).run();
    return "created";
  }, { behavior: "immediate" });
}

export function listApiKeysForOwner(ownerId: number) {
  return getApplicationDatabase().getClient().select({
    id: apiKeys.id,
    name: apiKeys.name,
    keyPrefix: apiKeys.keyPrefix,
    keyLastFour: apiKeys.keyLastFour,
    scopes: apiKeys.scopes,
    createdAt: apiKeys.createdAt,
    expiresAt: apiKeys.expiresAt,
    lastUsedAt: apiKeys.lastUsedAt,
  }).from(apiKeys)
    .where(eq(apiKeys.ownerId, ownerId))
    .orderBy(apiKeys.createdAt, apiKeys.id)
    .all();
}

export function findOwnedApiKeySecret(ownerId: number, keyId: number) {
  return getApplicationDatabase().getClient().select({
    keyHash: apiKeys.keyHash,
    keyCiphertext: apiKeys.keyCiphertext,
    keyPrefix: apiKeys.keyPrefix,
  }).from(apiKeys)
    .where(and(eq(apiKeys.ownerId, ownerId), eq(apiKeys.id, keyId)))
    .get();
}
