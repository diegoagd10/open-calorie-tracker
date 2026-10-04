import type { DailyGoalService, DailyGoalTargets } from "../daily-goal/index.server";
import type { ApplicationDatabaseClient } from "../database/database.server";
import { userPreferences } from "../database/schema.server";
import { readUserTimeZone } from "../database/user-preferences.server";
import { SetupCompleteError, SetupValidationError } from "./setup.exceptions";
import { canonicalTimeZone } from "./validation";

/** Onboarding: the account's time zone and its first Daily Goal, written together once. */
export class SetupService {
  readonly #database: ApplicationDatabaseClient;
  readonly #dailyGoals: DailyGoalService;
  readonly #now: () => Date;

  /** `now` stamps the preferences row's `created_at` and `updated_at` only. */
  constructor(database: ApplicationDatabaseClient, dailyGoals: DailyGoalService, now: () => Date) {
    this.#database = database;
    this.#dailyGoals = dailyGoals;
    this.#now = now;
  }

  /** Whether the account has both its time zone and its Daily Goal. */
  isComplete(userId: number): boolean {
    return readUserTimeZone(this.#database, userId) !== undefined && this.#dailyGoals.read(userId) !== null;
  }

  /**
   * Saves the time zone and the first Daily Goal in one transaction. Throws `SetupCompleteError`
   * for a repeat Setup, `SetupValidationError` for an invalid time zone, and
   * `DailyGoalValidationError` for an invalid goal, which also rolls back the time zone.
   */
  complete(userId: number, input: { timeZone: string; goal: DailyGoalTargets }): void {
    if (this.isComplete(userId)) throw new SetupCompleteError();
    const timeZone = canonicalTimeZone(input.timeZone);
    if (!timeZone) {
      throw new SetupValidationError("timeZone", "Enter a valid IANA time zone, such as America/New_York.");
    }
    const now = this.#now().toISOString();
    // better-sqlite3 runs the Daily Goal service's statements on this same connection, inside the transaction.
    this.#database.transaction((transaction) => {
      transaction.insert(userPreferences).values({ userId, timeZone, createdAt: now, updatedAt: now }).run();
      this.#dailyGoals.save(userId, input.goal);
    });
  }
}
