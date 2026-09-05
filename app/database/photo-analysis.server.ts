import { and, eq, sql } from "drizzle-orm";
import type { ApplicationDatabaseClient } from "./database.server";
import {
  foodEntries,
  photoAttempts,
  photoMeals,
  userPreferences,
} from "./schema.server";

export type PhotoMealRow = typeof photoMeals.$inferSelect;
export type PhotoAttemptRow = typeof photoAttempts.$inferSelect;
export type PhotoSnapshot = Omit<
  typeof foodEntries.$inferInsert,
  | "id"
  | "userId"
  | "foodLogDate"
  | "localEventTime"
  | "createdAt"
  | "updatedAt"
  | "idempotencyKey"
>;

export class PhotoAnalysisStore {
  constructor(private readonly db: ApplicationDatabaseClient) {}

  progress(
    attemptId: string,
    stage: PhotoAttemptRow["stage"],
    evidence: string,
  ) {
    this.db
      .update(photoAttempts)
      .set({ stage, evidence })
      .where(
        and(
          eq(photoAttempts.id, attemptId),
          eq(photoAttempts.status, "active"),
        ),
      )
      .run();
  }

  interrupt(at: string) {
    this.db
      .update(photoAttempts)
      .set({
        status: "interrupted",
        finishedAt: at,
        error: "Server restarted. Retry this analysis.",
      })
      .where(eq(photoAttempts.status, "active"))
      .run();
  }

  timeZone(userId: number) {
    return this.db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .get()?.timeZone;
  }

  list(userId: number, date: string) {
    return this.db
      .select({ id: photoMeals.id })
      .from(photoMeals)
      .where(
        and(eq(photoMeals.userId, userId), eq(photoMeals.foodLogDate, date)),
      )
      .all();
  }

  meal(userId: number, id: string) {
    return this.db
      .select()
      .from(photoMeals)
      .where(and(eq(photoMeals.userId, userId), eq(photoMeals.id, id)))
      .get();
  }

  history(mealId: string) {
    return this.db
      .select()
      .from(photoAttempts)
      .where(eq(photoAttempts.mealId, mealId))
      .orderBy(photoAttempts.startedAt, sql`rowid`)
      .all();
  }

  repeated(userId: number, key: string) {
    return this.db
      .select()
      .from(photoAttempts)
      .where(
        and(
          eq(photoAttempts.userId, userId),
          eq(photoAttempts.idempotencyKey, key),
        ),
      )
      .get();
  }

  start(
    meal: typeof photoMeals.$inferInsert,
    attempt: typeof photoAttempts.$inferInsert,
  ) {
    this.db.transaction((tx) => {
      tx.insert(photoMeals).values(meal).run();
      tx.insert(photoAttempts).values(attempt).run();
    });
  }

  entry(userId: number, entryId: number) {
    return this.db
      .select()
      .from(foodEntries)
      .where(and(eq(foodEntries.userId, userId), eq(foodEntries.id, entryId)))
      .get();
  }

  forEntry(userId: number, entryId: number) {
    return this.db
      .select()
      .from(photoMeals)
      .where(
        and(eq(photoMeals.userId, userId), eq(photoMeals.entryId, entryId)),
      )
      .get();
  }

  attempt(value: typeof photoAttempts.$inferInsert) {
    this.db.insert(photoAttempts).values(value).run();
  }

  complete(
    meal: PhotoMealRow,
    attemptId: string,
    snapshot: PhotoSnapshot,
    result: string,
    at: string,
  ) {
    this.db.transaction((tx) => {
      const active = tx
        .update(photoAttempts)
        .set({ status: "succeeded", finishedAt: at, result })
        .where(
          and(
            eq(photoAttempts.id, attemptId),
            eq(photoAttempts.status, "active"),
          ),
        )
        .returning()
        .get();
      if (!active) return;
      if (meal.entryId !== null) {
        tx.update(foodEntries)
          .set({ ...snapshot, editedName: null, updatedAt: at })
          .where(
            and(
              eq(foodEntries.id, meal.entryId),
              eq(foodEntries.userId, meal.userId),
            ),
          )
          .run();
        return;
      }
      const entry = tx
        .insert(foodEntries)
        .values({
          ...snapshot,
          userId: meal.userId,
          foodLogDate: meal.foodLogDate,
          localEventTime: meal.localEventTime,
          createdAt: meal.createdAt,
          updatedAt: at,
          idempotencyKey: `photo:${meal.id}`,
        })
        .returning()
        .get();
      tx.update(photoMeals)
        .set({ entryId: entry.id })
        .where(eq(photoMeals.id, meal.id))
        .run();
    });
  }

  delete(meal: PhotoMealRow) {
    this.db.transaction((tx) => {
      if (meal.entryId !== null)
        tx.delete(foodEntries)
          .where(
            and(
              eq(foodEntries.id, meal.entryId),
              eq(foodEntries.userId, meal.userId),
            ),
          )
          .run();
      tx.delete(photoMeals).where(eq(photoMeals.id, meal.id)).run();
    });
  }

  finish(
    attemptId: string,
    status: "failed" | "canceled" | "interrupted",
    error: string,
    at: string,
  ) {
    this.db
      .update(photoAttempts)
      .set({ status, error, finishedAt: at })
      .where(
        and(
          eq(photoAttempts.id, attemptId),
          eq(photoAttempts.status, "active"),
        ),
      )
      .run();
  }
}

export function isPhotoEntryProcessing(
  db: ApplicationDatabaseClient,
  userId: number,
  entryId: number,
) {
  return Boolean(
    db
      .select({ id: photoAttempts.id })
      .from(photoMeals)
      .innerJoin(photoAttempts, eq(photoMeals.id, photoAttempts.mealId))
      .where(
        and(
          eq(photoMeals.userId, userId),
          eq(photoMeals.entryId, entryId),
          eq(photoAttempts.status, "active"),
        ),
      )
      .get(),
  );
}
