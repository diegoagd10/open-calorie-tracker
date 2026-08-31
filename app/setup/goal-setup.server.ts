import { and, eq } from "drizzle-orm";

import type { ApplicationDatabaseClient } from "../database/database.server";
import { goalVersions, userPreferences } from "../database/schema.server";
import { localDateAt, type SetupSubmission } from "./validation";

export type CompleteSetupResult =
  | { effectiveDate: string; ok: true }
  | { error: "already-complete"; ok: false };

export class GoalSetupService {
  readonly #database: ApplicationDatabaseClient;
  readonly #now: () => Date;

  constructor(
    database: ApplicationDatabaseClient,
    now: () => Date = () => new Date(),
  ) {
    this.#database = database;
    this.#now = now;
  }

  isComplete(userId: number): boolean {
    return Boolean(
      this.#database
        .select({ userId: userPreferences.userId })
        .from(userPreferences)
        .innerJoin(
          goalVersions,
          and(
            eq(goalVersions.userId, userPreferences.userId),
            eq(goalVersions.userId, userId),
          ),
        )
        .where(eq(userPreferences.userId, userId))
        .limit(1)
        .get(),
    );
  }

  completeInitial(
    userId: number,
    setup: SetupSubmission,
  ): CompleteSetupResult {
    const now = this.#now();
    const createdAt = now.toISOString();
    const effectiveDate = localDateAt(now, setup.timeZone);

    try {
      this.#database.transaction((transaction) => {
        transaction
          .insert(userPreferences)
          .values({
            createdAt,
            displayUnits: setup.displayUnits,
            timeZone: setup.timeZone,
            updatedAt: createdAt,
            userId,
          })
          .run();
        transaction
          .insert(goalVersions)
          .values({
            calorieTargetMilliKcal: setup.calorieTargetMilliKcal,
            carbohydrateTargetMilligrams:
              setup.carbohydrateTargetMilligrams,
            createdAt,
            effectiveDate,
            fatTargetMilligrams: setup.fatTargetMilligrams,
            fiberTargetMilligrams: setup.fiberTargetMilligrams,
            proteinTargetMilligrams: setup.proteinTargetMilligrams,
            sodiumMaximumMilligrams: setup.sodiumMaximumMilligrams,
            sugarMaximumMilligrams: setup.sugarMaximumMilligrams,
            userId,
            waterTargetMicroliters: setup.waterTargetMicroliters,
          })
          .run();
      });

      return { effectiveDate, ok: true };
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["SQLITE_CONSTRAINT_PRIMARYKEY", "SQLITE_CONSTRAINT_UNIQUE"].includes(
          String(error.code),
        )
      ) {
        return { error: "already-complete", ok: false };
      }
      throw error;
    }
  }
}
