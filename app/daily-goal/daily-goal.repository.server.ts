import { eq } from "drizzle-orm";

import type { ApplicationDatabaseClient } from "../database/database.server";
import type { DailyGoal, DailyGoalTargets } from "./daily-goal.model";
import { dailyGoals } from "./daily-goal.schema.server";

/** Owner-scoped reads and writes of the Daily Goal; every query is limited to `userId`. */
export class DailyGoalRepository {
  readonly #database: ApplicationDatabaseClient;
  readonly #now: () => Date;

  constructor(database: ApplicationDatabaseClient, now: () => Date) {
    this.#database = database;
    this.#now = now;
  }

  find(userId: number): DailyGoal | null {
    return this.#database.select().from(dailyGoals).where(eq(dailyGoals.userId, userId)).get() ?? null;
  }

  /** Inserts the account's goal, or replaces its targets and keeps its creation instant. */
  save(userId: number, targets: DailyGoalTargets): DailyGoal {
    const now = this.#now().toISOString();
    return this.#database
      .insert(dailyGoals)
      .values({ ...targets, userId, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: dailyGoals.userId, set: { ...targets, updatedAt: now } })
      .returning()
      .get();
  }
}
