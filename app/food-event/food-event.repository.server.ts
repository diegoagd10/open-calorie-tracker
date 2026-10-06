import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";

import type { ApplicationDatabaseClient } from "../database/database.server";
import { readUserTimeZone } from "../database/user-preferences.server";
import { laterInstant } from "../shared/date-time";
import type { Favorite, FoodEvent, FoodEventRange, FoodSnapshot, VersionedId } from "./food-event.model";
import { favoriteFoods, foodEvents } from "./food-event.schema.server";
import {
  favoriteFromRow,
  favoriteSnapshotJson,
  foodEventFromRow,
  snapshotColumns,
  type FoodEventRow,
  type SnapshotColumns,
} from "./snapshot.server";

/** How a new event relates to My foods: create a favorite from it, reuse one, or neither. */
export type FavoritePolicy = "create" | "none" | { reuse: number };

/** One new event; the service chooses `favorite` from the method, never from the provider. */
export type InsertFoodEvent = {
  logDate: string;
  snapshot: FoodSnapshot;
  copiedFromId?: number;
  favorite: FavoritePolicy;
};

/** The snapshot columns an edit changes. */
export type UpdateFoodEvent = Partial<SnapshotColumns>;

export type DeleteOutcome =
  | { deleted: number }
  | { missing: number }
  | { stale: FoodEvent };

/** Rolls a batch delete back, carrying why. */
class AbortDelete extends Error {
  constructor(readonly outcome: DeleteOutcome) {
    super("Food Event deletion aborted");
  }
}

type Transaction = Parameters<Parameters<ApplicationDatabaseClient["transaction"]>[0]>[0];
type Reader = Pick<ApplicationDatabaseClient, "select">;

/** Events with the favorite each one is linked to; only manual foods can be favorites. */
function selectEvents(database: Reader) {
  return database
    .select({ event: foodEvents, sourceOf: favoriteFoods.id })
    .from(foodEvents)
    .leftJoin(favoriteFoods, and(
      eq(favoriteFoods.userId, foodEvents.userId),
      eq(favoriteFoods.sourceEventId, foodEvents.id),
    ));
}

function linkedEvent({ event, sourceOf }: { event: FoodEventRow; sourceOf: number | null }): FoodEvent {
  const favoriteId = event.provider === "manual" ? event.sourceFavoriteId ?? sourceOf : null;
  return foodEventFromRow(event, favoriteId);
}

function findEvent(database: Reader, userId: number, eventId: number): FoodEvent | null {
  const row = selectEvents(database)
    .where(and(eq(foodEvents.userId, userId), eq(foodEvents.id, eventId)))
    .get();
  return row ? linkedEvent(row) : null;
}

function findFavoriteRow(database: Reader, userId: number, favoriteId: number) {
  return database
    .select()
    .from(favoriteFoods)
    .where(and(eq(favoriteFoods.userId, userId), eq(favoriteFoods.id, favoriteId)))
    .get();
}

/** Inserts a favorite from `event` unless the event already has one, then returns the event's favorite. */
function createFavorite(transaction: Transaction, userId: number, event: FoodEvent, createdAt: string): Favorite {
  transaction
    .insert(favoriteFoods)
    .values({
      userId,
      sourceEventId: event.id,
      name: event.name,
      snapshot: favoriteSnapshotJson(event),
      createdAt,
    })
    .onConflictDoNothing()
    .run();
  const row = transaction
    .select()
    .from(favoriteFoods)
    .where(and(eq(favoriteFoods.userId, userId), eq(favoriteFoods.sourceEventId, event.id)))
    .get()!;
  return favoriteFromRow(row);
}

/** Owner-scoped persistence of Food Events and favorites; every query is limited to `userId`. */
export class FoodEventRepository {
  readonly #database: ApplicationDatabaseClient;
  readonly #now: () => Date;

  constructor(database: ApplicationDatabaseClient, now: () => Date) {
    this.#database = database;
    this.#now = now;
  }

  findById(userId: number, eventId: number): FoodEvent | null {
    return findEvent(this.#database, userId, eventId);
  }

  /** Owned events consumed in the UTC range `[from, to)`, newest first; ties by save time, then `id`. */
  list(userId: number, range: FoodEventRange): FoodEvent[] {
    return selectEvents(this.#database)
      .where(and(
        eq(foodEvents.userId, userId),
        gte(foodEvents.logDate, range.from),
        lt(foodEvents.logDate, range.to),
      ))
      .orderBy(desc(foodEvents.logDate), desc(foodEvents.createdAt), desc(foodEvents.id))
      .all()
      .map(linkedEvent);
  }

  /**
   * Inserts one event and applies its favorite policy in one transaction. `recheck` runs first
   * inside that transaction with the account's time zone, so account and time rules are decided
   * after any provider work, against what is committed.
   */
  insert(userId: number, command: InsertFoodEvent, recheck: (timeZone: string | null) => void): FoodEvent {
    return this.#database.transaction((transaction) => {
      recheck(this.#timeZone(transaction, userId));
      const createdAt = this.#now().toISOString();
      const row = transaction
        .insert(foodEvents)
        .values({
          ...snapshotColumns(command.snapshot),
          userId,
          logDate: command.logDate,
          sourceFavoriteId: typeof command.favorite === "object" ? command.favorite.reuse : null,
          copiedFromEventId: command.copiedFromId ?? null,
          createdAt,
          updatedAt: createdAt,
        })
        .returning()
        .get();
      const event = linkedEvent({ event: row, sourceOf: null });
      if (command.favorite !== "create") return event;
      return { ...event, favoriteId: createFavorite(transaction, userId, event, createdAt).id };
    });
  }

  /** Applies `columns` to the owned event only while it is still at `expectedUpdatedAt`; null otherwise. */
  update(userId: number, version: VersionedId, columns: UpdateFoodEvent): FoodEvent | null {
    const updated = this.#database
      .update(foodEvents)
      .set({ ...columns, updatedAt: laterInstant(this.#now().toISOString(), version.expectedUpdatedAt) })
      .where(and(
        eq(foodEvents.userId, userId),
        eq(foodEvents.id, version.id),
        eq(foodEvents.updatedAt, version.expectedUpdatedAt),
      ))
      .returning({ id: foodEvents.id })
      .get();
    return updated ? this.findById(userId, updated.id) : null;
  }

  /** Deletes every item, or nothing when any one is missing or no longer at its expected version. */
  delete(userId: number, items: readonly VersionedId[]): DeleteOutcome {
    try {
      return this.#database.transaction((transaction) => {
        for (const item of items) {
          const current = findEvent(transaction, userId, item.id);
          if (!current) throw new AbortDelete({ missing: item.id });
          const deleted = transaction
            .delete(foodEvents)
            .where(and(
              eq(foodEvents.userId, userId),
              eq(foodEvents.id, item.id),
              eq(foodEvents.updatedAt, item.expectedUpdatedAt),
            ))
            .returning({ id: foodEvents.id })
            .get();
          if (!deleted) throw new AbortDelete({ stale: current });
        }
        return { deleted: items.length };
      });
    } catch (error) {
      if (error instanceof AbortDelete) return error.outcome;
      throw error;
    }
  }

  /** Owned favorites whose name contains `query`, ignoring case, by name. */
  findFavorites(userId: number, query: string): Favorite[] {
    const trimmed = query.trim();
    return this.#database
      .select()
      .from(favoriteFoods)
      .where(trimmed
        ? and(eq(favoriteFoods.userId, userId), sql`instr(lower(${favoriteFoods.name}), lower(${trimmed})) > 0`)
        : eq(favoriteFoods.userId, userId))
      .orderBy(asc(favoriteFoods.name), asc(favoriteFoods.id))
      .all()
      .map(favoriteFromRow);
  }

  findFavorite(userId: number, favoriteId: number): Favorite | null {
    const row = findFavoriteRow(this.#database, userId, favoriteId);
    return row ? favoriteFromRow(row) : null;
  }

  /**
   * The owned manual event's favorite, created once from its current snapshot when it has none.
   * Null when the event is not owned; `"not_manual"` when it cannot be a favorite.
   */
  addFavorite(userId: number, eventId: number): Favorite | "not_manual" | null {
    return this.#database.transaction((transaction) => {
      const event = findEvent(transaction, userId, eventId);
      if (!event) return null;
      if (event.source.provider !== "manual") return "not_manual";
      const linked = event.favoriteId === null ? undefined : findFavoriteRow(transaction, userId, event.favoriteId);
      if (linked) return favoriteFromRow(linked);
      return createFavorite(transaction, userId, event, this.#now().toISOString());
    });
  }

  /** The account's time zone, or null before setup. */
  timeZone(userId: number): string | null {
    return this.#timeZone(this.#database, userId);
  }

  #timeZone(database: Reader, userId: number): string | null {
    return readUserTimeZone(database, userId) ?? null;
  }
}
