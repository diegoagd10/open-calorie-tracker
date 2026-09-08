import { eq } from "drizzle-orm";
import type { ApplicationDatabaseClient } from "./database.server";
import { userPreferences } from "./schema.server";

export function readUserTimeZone(database: Pick<ApplicationDatabaseClient, "select">, userId: number): string | undefined {
  return database.select({ timeZone: userPreferences.timeZone }).from(userPreferences).where(eq(userPreferences.userId, userId)).get()?.timeZone;
}
