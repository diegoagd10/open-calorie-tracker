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

export function readSavedFoodBySource(
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
