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

export type ActiveSessionRecord = Pick<
  typeof sessions.$inferSelect,
  "absoluteExpiresAt" | "idleExpiresAt" | "userId"
> &
  Pick<
    typeof users.$inferSelect,
    "passwordChangeRequired" | "role" | "usernameNormalized"
  >;

export type CredentialRecord = Pick<
  typeof users.$inferSelect,
  | "accessState"
  | "id"
  | "passwordChangeRequired"
  | "role"
  | "usernameNormalized"
> &
  Pick<typeof passwordCredentials.$inferSelect, "passwordHash">;

export function findActiveSessionByTokenHash(
  database: ApplicationDatabaseClient,
  tokenHash: string,
): ActiveSessionRecord | undefined {
  return database
    .select({
      absoluteExpiresAt: sessions.absoluteExpiresAt,
      idleExpiresAt: sessions.idleExpiresAt,
      passwordChangeRequired: users.passwordChangeRequired,
      role: users.role,
      userId: sessions.userId,
      usernameNormalized: users.usernameNormalized,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        eq(users.accessState, "active"),
      ),
    )
    .get();
}

export function findCredentialByUsername(
  database: ApplicationDatabaseClient,
  usernameNormalized: string,
): CredentialRecord | undefined {
  return database
    .select({
      accessState: users.accessState,
      id: users.id,
      passwordChangeRequired: users.passwordChangeRequired,
      passwordHash: passwordCredentials.passwordHash,
      role: users.role,
      usernameNormalized: users.usernameNormalized,
    })
    .from(users)
    .innerJoin(
      passwordCredentials,
      eq(passwordCredentials.userId, users.id),
    )
    .where(eq(users.usernameNormalized, usernameNormalized))
    .get();
}

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
