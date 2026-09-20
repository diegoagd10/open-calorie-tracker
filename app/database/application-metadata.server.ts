import { eq } from "drizzle-orm";

import type { ApplicationDatabaseClient } from "./database.server";
import { applicationMetadata } from "./schema.server";

export function createDatabaseApplicationMetadata(database: ApplicationDatabaseClient) {
  return {
    read(key: string): string | undefined {
      return database
      .select({ value: applicationMetadata.value })
      .from(applicationMetadata)
      .where(eq(applicationMetadata.key, key))
      .get()?.value;
    },

    replace(key: string, value: string, updatedAt: string): void {
      database
      .insert(applicationMetadata)
      .values({ key, value, updatedAt })
      .onConflictDoUpdate({
        target: applicationMetadata.key,
        set: { value, updatedAt },
      })
      .run();
    },
  };
}
