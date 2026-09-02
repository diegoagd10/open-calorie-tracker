import { and, eq } from "drizzle-orm";

import type { ApplicationDatabaseClient } from "./database.server";
import { passwordCredentials, sessions, users } from "./schema.server";

export type PasswordAndSessionReplacement = {
  currentTokenHash: string;
  nextPasswordHash: string;
  nextSession: typeof sessions.$inferInsert;
  updatedAt: string;
  userId: number;
};

export function replacePasswordAndSessions(
  database: ApplicationDatabaseClient,
  replacement: PasswordAndSessionReplacement,
): boolean {
  return database.transaction((transaction) => {
    const currentSession = transaction
      .select({ tokenHash: sessions.tokenHash })
      .from(sessions)
      .where(
        and(
          eq(sessions.tokenHash, replacement.currentTokenHash),
          eq(sessions.userId, replacement.userId),
        ),
      )
      .get();
    if (!currentSession) return false;

    transaction
      .update(passwordCredentials)
      .set({
        passwordHash: replacement.nextPasswordHash,
        updatedAt: replacement.updatedAt,
      })
      .where(eq(passwordCredentials.userId, replacement.userId))
      .run();
    transaction
      .update(users)
      .set({ passwordChangeRequired: false })
      .where(eq(users.id, replacement.userId))
      .run();
    transaction
      .delete(sessions)
      .where(eq(sessions.userId, replacement.userId))
      .run();
    transaction.insert(sessions).values(replacement.nextSession).run();
    return true;
  });
}
