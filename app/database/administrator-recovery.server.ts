import { eq } from "drizzle-orm";

import type { ApplicationDatabaseClient } from "./database.server";
import { passwordCredentials, sessions, users } from "./schema.server";

export type AdministratorRecoveryPersistenceResult =
  | { error: "administrator-not-found"; ok: false }
  | { error: "administrator-invariant-violated"; ok: false }
  | { error: "administrator-credential-not-found"; ok: false }
  | { ok: true };

export function replaceSoleAdministratorCredential(
  database: ApplicationDatabaseClient,
  replacement: { passwordHash: string; updatedAt: string },
): AdministratorRecoveryPersistenceResult {
  return database.transaction(
    (transaction) => {
      const administrators = transaction
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, "admin"))
        .limit(2)
        .all();

      if (administrators.length === 0) {
        return { error: "administrator-not-found", ok: false };
      }
      if (administrators.length !== 1) {
        return { error: "administrator-invariant-violated", ok: false };
      }

      const administratorId = administrators[0].id;
      const credential = transaction
        .select({ userId: passwordCredentials.userId })
        .from(passwordCredentials)
        .where(eq(passwordCredentials.userId, administratorId))
        .get();
      if (!credential) {
        return { error: "administrator-credential-not-found", ok: false };
      }

      transaction
        .update(passwordCredentials)
        .set({
          passwordHash: replacement.passwordHash,
          updatedAt: replacement.updatedAt,
        })
        .where(eq(passwordCredentials.userId, administratorId))
        .run();
      transaction
        .update(users)
        .set({ passwordChangeRequired: true })
        .where(eq(users.id, administratorId))
        .run();
      transaction
        .delete(sessions)
        .where(eq(sessions.userId, administratorId))
        .run();

      return { ok: true };
    },
    { behavior: "immediate" },
  );
}
