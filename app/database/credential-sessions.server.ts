import { invalidateAccountProofs } from "./authentication-policy.server";
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

export type VerifiedCredentialSession = {
  credentialReplacement?: {
    passwordHash: string;
    updatedAt: string;
  };
  expectedPasswordHash: string;
  expectedAuthenticationVersion: number;
  session: typeof sessions.$inferInsert;
};

export function issueSessionForVerifiedCredential(
  database: ApplicationDatabaseClient,
  issuance: VerifiedCredentialSession,
): boolean {
  return database.transaction(
    (transaction) => {
      const credential = transaction
        .select({ passwordHash: passwordCredentials.passwordHash })
        .from(passwordCredentials)
        .where(eq(passwordCredentials.userId, issuance.session.userId))
        .get();
      if (credential?.passwordHash !== issuance.expectedPasswordHash) {
        return false;
      }

      const account = transaction
        .select()
        .from(users)
        .where(eq(users.id, issuance.session.userId))
        .get();
      if (
        !account ||
        account.accessState !== "active" ||
        account.keyLoginEnabled ||
        account.authenticationVersion !== issuance.expectedAuthenticationVersion
      )
        return false;
      if (issuance.credentialReplacement) {
        transaction
          .update(passwordCredentials)
          .set({
            passwordHash: issuance.credentialReplacement.passwordHash,
            updatedAt: issuance.credentialReplacement.updatedAt,
          })
          .where(eq(passwordCredentials.userId, issuance.session.userId))
          .run();
      }
      transaction.insert(sessions).values(issuance.session).run();
      return true;
    },
    { behavior: "immediate" },
  );
}

export type MemberPasswordReset = {
  nextPasswordHash: string;
  targetUsername: string;
  updatedAt: string;
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
  | "keyLoginEnabled"
  | "authenticationVersion"
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
      and(eq(sessions.tokenHash, tokenHash), eq(users.accessState, "active")),
    )
    .get();
}

export function findCredentialByUsername(
  database: ApplicationDatabaseClient,
  usernameNormalized: string,
): CredentialRecord | undefined {
  return database
    .select({
      keyLoginEnabled: users.keyLoginEnabled,
      authenticationVersion: users.authenticationVersion,
      accessState: users.accessState,
      id: users.id,
      passwordChangeRequired: users.passwordChangeRequired,
      passwordHash: passwordCredentials.passwordHash,
      role: users.role,
      usernameNormalized: users.usernameNormalized,
    })
    .from(users)
    .innerJoin(passwordCredentials, eq(passwordCredentials.userId, users.id))
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
    invalidateAccountProofs(transaction, replacement.userId);
    return true;
  });
}

export function resetMemberPasswordAndSessions(
  database: ApplicationDatabaseClient,
  reset: MemberPasswordReset,
): boolean {
  return database.transaction(
    (transaction) => {
      const target = transaction
        .select({ id: users.id })
        .from(users)
        .innerJoin(
          passwordCredentials,
          eq(passwordCredentials.userId, users.id),
        )
        .where(
          and(
            eq(users.role, "member"),
            eq(users.usernameNormalized, reset.targetUsername),
          ),
        )
        .get();
      if (!target) return false;

      transaction
        .update(passwordCredentials)
        .set({
          passwordHash: reset.nextPasswordHash,
          updatedAt: reset.updatedAt,
        })
        .where(eq(passwordCredentials.userId, target.id))
        .run();
      transaction
        .update(users)
        .set({ passwordChangeRequired: true })
        .where(eq(users.id, target.id))
        .run();
      transaction.delete(sessions).where(eq(sessions.userId, target.id)).run();
      invalidateAccountProofs(transaction, target.id);
      return true;
    },
    { behavior: "immediate" },
  );
}
