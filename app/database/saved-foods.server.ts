import { and, asc, eq, sql } from "drizzle-orm";

import type { ApplicationDatabaseClient } from "./database.server";
import { foodEntries, savedFoods } from "./schema.server";

export type SavedFoodDatabase = Pick<ApplicationDatabaseClient, "insert" | "select">;

export function listSavedFoodRows(
  database: SavedFoodDatabase,
  userId: number,
  query: string,
) {
  const trimmed = query.trim();
  return database
    .select()
    .from(savedFoods)
    .where(
      trimmed
        ? and(
            eq(savedFoods.userId, userId),
            sql`instr(lower(${savedFoods.name}), lower(${trimmed})) > 0`,
          )
        : eq(savedFoods.userId, userId),
    )
    .orderBy(asc(savedFoods.name), asc(savedFoods.id))
    .all();
}

export function readSavedFoodRow(
  database: SavedFoodDatabase,
  userId: number,
  savedFoodId: number,
) {
  return database
    .select()
    .from(savedFoods)
    .where(and(eq(savedFoods.userId, userId), eq(savedFoods.id, savedFoodId)))
    .get();
}

function readSavedFoodBySource(
  database: SavedFoodDatabase,
  userId: number,
  sourceEntryId: number,
) {
  return database
    .select()
    .from(savedFoods)
    .where(
      and(
        eq(savedFoods.userId, userId),
        eq(savedFoods.sourceEntryId, sourceEntryId),
      ),
    )
    .get();
}

export function readSavedFoodForEntry(
  database: SavedFoodDatabase,
  userId: number,
  entryId: number,
) {
  const entry = database
    .select({ provider: foodEntries.provider, sourceSavedFoodId: foodEntries.sourceSavedFoodId })
    .from(foodEntries)
    .where(and(eq(foodEntries.userId, userId), eq(foodEntries.id, entryId)))
    .get();
  if (!entry || entry.provider !== "manual") return undefined;
  return (
    entry.sourceSavedFoodId === null
      ? undefined
      : readSavedFoodRow(database, userId, entry.sourceSavedFoodId)
  ) ?? readSavedFoodBySource(database, userId, entryId);
}

export function insertSavedFood(
  database: SavedFoodDatabase,
  userId: number,
  source: typeof foodEntries.$inferSelect,
  createdAt: string,
  snapshot: string,
) {
  database
    .insert(savedFoods)
    .values({
      createdAt,
      name: source.editedName ?? source.originalName,
      snapshot,
      sourceEntryId: source.id,
      userId,
    })
    .onConflictDoNothing()
    .run();
}

export function saveManualEntryRow(
  database: ApplicationDatabaseClient,
  userId: number,
  sourceEntryId: number,
  createdAt: string,
  serializeSnapshot: (source: typeof foodEntries.$inferSelect) => string,
) {
  return database.transaction((transaction) => {
    const source = transaction
      .select()
      .from(foodEntries)
      .where(
        and(
          eq(foodEntries.userId, userId),
          eq(foodEntries.id, sourceEntryId),
        ),
      )
      .get();
    if (!source || source.provider !== "manual") return undefined;
    if (source.sourceSavedFoodId !== null) {
      const linked = readSavedFoodRow(transaction, userId, source.sourceSavedFoodId);
      if (linked) return linked;
    }
    insertSavedFood(
      transaction,
      userId,
      source,
      createdAt,
      serializeSnapshot(source),
    );
    return readSavedFoodBySource(transaction, userId, sourceEntryId);
  });
}
