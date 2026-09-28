import { and, count, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { getApplicationDatabase } from "./runtime.server";
import { apiKeys, users } from "./schema.server";

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

function ownedKey(ownerId: number, keyId: number) {
  return and(eq(apiKeys.ownerId, ownerId), eq(apiKeys.id, keyId));
}

const summaryColumns = {
  id: apiKeys.id,
  name: apiKeys.name,
  keyPrefix: apiKeys.keyPrefix,
  keyLastFour: apiKeys.keyLastFour,
  scopes: apiKeys.scopes,
  createdAt: apiKeys.createdAt,
  expiresAt: apiKeys.expiresAt,
  lastUsedAt: apiKeys.lastUsedAt,
};

export function listApiKeysForOwner(ownerId: number) {
  return getApplicationDatabase().getClient().select(summaryColumns).from(apiKeys)
    .where(eq(apiKeys.ownerId, ownerId))
    .orderBy(apiKeys.createdAt, apiKeys.id)
    .all();
}

export function findOwnedApiKey(ownerId: number, keyId: number) {
  return getApplicationDatabase().getClient().select(summaryColumns).from(apiKeys)
    .where(ownedKey(ownerId, keyId))
    .get();
}

export type ApiKeyChanges = { name: string; scopes: string[]; expiresAt: string | null };

/** Applies `changes` to the owner's key unless it is gone, expired at `now`, or another of their keys has the name. */
export function updateApiKey(ownerId: number, keyId: number, changes: ApiKeyChanges, now: string): "updated" | "missing" | "duplicate-name" {
  return getApplicationDatabase().getClient().transaction((transaction) => {
    const current = transaction.select({ id: apiKeys.id }).from(apiKeys)
      .where(and(ownedKey(ownerId, keyId), or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now)))).get();
    if (!current) return "missing";
    const sameName = transaction.select({ id: apiKeys.id }).from(apiKeys)
      .where(and(eq(apiKeys.ownerId, ownerId), ne(apiKeys.id, keyId), sql`${apiKeys.name} = ${changes.name} COLLATE NOCASE`)).get();
    if (sameName) return "duplicate-name";
    transaction.update(apiKeys).set({ ...changes, scopes: JSON.stringify(changes.scopes) }).where(ownedKey(ownerId, keyId)).run();
    return "updated";
  }, { behavior: "immediate" });
}

/** Hard-deletes the owner's key, returning whether it existed. */
export function deleteApiKey(ownerId: number, keyId: number): boolean {
  return getApplicationDatabase().getClient().delete(apiKeys)
    .where(ownedKey(ownerId, keyId))
    .run().changes > 0;
}

export function findOwnedApiKeySecret(ownerId: number, keyId: number) {
  return getApplicationDatabase().getClient().select({
    keyHash: apiKeys.keyHash,
    keyCiphertext: apiKeys.keyCiphertext,
    keyPrefix: apiKeys.keyPrefix,
    expiresAt: apiKeys.expiresAt,
  }).from(apiKeys)
    .where(ownedKey(ownerId, keyId))
    .get();
}

/** The key a bearer hash names, with what authentication needs to accept it. */
export function findApiKeyByHash(keyHash: string) {
  return getApplicationDatabase().getClient().select({
    id: apiKeys.id,
    ownerId: apiKeys.ownerId,
    keyPrefix: apiKeys.keyPrefix,
    scopes: apiKeys.scopes,
    expiresAt: apiKeys.expiresAt,
    accessState: users.accessState,
  }).from(apiKeys)
    .innerJoin(users, eq(apiKeys.ownerId, users.id))
    .where(eq(apiKeys.keyHash, keyHash))
    .get();
}

/** Records use at `usedAt`, writing only when the stored value differs. */
export function recordApiKeyUse(keyId: number, usedAt: string): void {
  getApplicationDatabase().getClient().update(apiKeys)
    .set({ lastUsedAt: usedAt })
    .where(and(eq(apiKeys.id, keyId), sql`${apiKeys.lastUsedAt} IS NOT ${usedAt}`))
    .run();
}
