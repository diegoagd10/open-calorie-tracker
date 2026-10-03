import { and, desc, eq, gte, inArray, like, lt, not, or } from "drizzle-orm";

import type { ApplicationDatabaseClient } from "../database/database.server";
import { userPreferences } from "../database/schema.server";
import type { CreateWaterEvent, WaterEvent, WaterEventRange } from "./water-event.model";
import { waterEvents } from "./water-event.schema.server";
import { waterEventInstant } from "./water-event.utils";

const DAY_MS = 86_400_000;

function shiftedDate(instant: string, days: number): string {
  return new Date(new Date(instant).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Owner-scoped reads and writes of Water Events; every query is limited to `userId`. */
export class WaterEventRepository {
  readonly #database: ApplicationDatabaseClient;
  readonly #now: () => Date;

  constructor(database: ApplicationDatabaseClient, now: () => Date) {
    this.#database = database;
    this.#now = now;
  }

  findById(userId: number, eventId: number): WaterEvent | null {
    return this.#database
      .select()
      .from(waterEvents)
      .where(and(eq(waterEvents.userId, userId), eq(waterEvents.id, eventId)))
      .get() ?? null;
  }

  /** Inserts without `id`; with `id`, changes only that owned event's amount, or returns null when it is not owned. */
  save(userId: number, input: CreateWaterEvent): WaterEvent | null {
    const now = this.#now().toISOString();
    if (input.id === undefined) {
      return this.#database
        .insert(waterEvents)
        .values({ userId, logDate: input.logDate, ounces: input.quantity.ounces, createdAt: now, updatedAt: now })
        .returning()
        .get();
    }
    const existing = this.findById(userId, input.id);
    if (!existing) return null;
    return this.#database
      .update(waterEvents)
      .set({ ounces: input.quantity.ounces, updatedAt: laterInstant(now, existing.updatedAt) })
      .where(and(eq(waterEvents.userId, userId), eq(waterEvents.id, input.id)))
      .returning()
      .get() ?? null;
  }

  /** Removes the owned events among `eventIds` and returns how many were removed. */
  delete(userId: number, eventIds: readonly number[]): number {
    if (eventIds.length === 0) return 0;
    return this.#database
      .delete(waterEvents)
      .where(and(eq(waterEvents.userId, userId), inArray(waterEvents.id, [...eventIds])))
      .returning({ id: waterEvents.id })
      .all().length;
  }

  /**
   * Owned events consumed in the UTC range, newest first with `id` breaking ties. Legacy
   * rows without an offset are placed using the account's current time zone.
   */
  list(userId: number, range: WaterEventRange): WaterEvent[] {
    const timeZone = this.timeZone(userId) ?? "UTC";
    const rows = this.#database
      .select()
      .from(waterEvents)
      .where(and(
        eq(waterEvents.userId, userId),
        or(
          and(like(waterEvents.logDate, "%Z"), gte(waterEvents.logDate, range.from), lt(waterEvents.logDate, range.to)),
          and(
            not(like(waterEvents.logDate, "%Z")),
            gte(waterEvents.logDate, shiftedDate(range.from, -1)),
            lt(waterEvents.logDate, shiftedDate(range.to, 2)),
          ),
        ),
      ))
      .orderBy(desc(waterEvents.logDate), desc(waterEvents.id))
      .all();
    return rows
      .map((row) => ({ row, instant: waterEventInstant(row.logDate, timeZone) }))
      .filter(({ instant }) => instant >= range.from && instant < range.to)
      .sort((left, right) => right.instant.localeCompare(left.instant) || right.row.id - left.row.id)
      .map(({ row }) => row);
  }

  /** The account's time zone, or null before setup. */
  timeZone(userId: number): string | null {
    return this.#database
      .select({ timeZone: userPreferences.timeZone })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .get()?.timeZone ?? null;
  }
}

/** `now`, or one millisecond after `previous` when the clock has not moved past it. */
function laterInstant(now: string, previous: string): string {
  return now > previous ? now : new Date(new Date(previous).getTime() + 1).toISOString();
}
