import { and, eq } from "drizzle-orm";
import type { ApplicationDatabaseClient } from "./database.server";
import { goalVersions, userPreferences } from "./schema.server";

export function isAccountSetupComplete(
  database: ApplicationDatabaseClient,
  userId: number,
): boolean {
  return Boolean(
    database
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
