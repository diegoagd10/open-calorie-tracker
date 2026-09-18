import { eq } from "drizzle-orm";

import { revokeAccountAuthentication } from "./authentication-policy.server";
import type { ApplicationDatabaseClient } from "./database.server";
import { passwordCredentials, users } from "./schema.server";

export type AdministratorRecoveryError =
  | "administrator-not-found"
  | "administrator-invariant-violated"
  | "administrator-credential-not-found";

export type AdministratorRecoveryPersistenceResult =
  | { error: AdministratorRecoveryError; ok: false }
  | { ok: true };

function soleAdministratorWithPassword(
  transaction: Parameters<Parameters<ApplicationDatabaseClient["transaction"]>[0]>[0],
): { ok: true; administratorId: number } | { ok: false; error: AdministratorRecoveryError } {
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
  return { ok: true, administratorId };
}

export function disableSoleAdministratorKeyLogin(
  database: ApplicationDatabaseClient,
): AdministratorRecoveryPersistenceResult {
  return database.transaction(
    (transaction) => {
      const administrator = soleAdministratorWithPassword(transaction);
      if (!administrator.ok) return administrator;
      transaction.update(users).set({ keyLoginEnabled: false })
        .where(eq(users.id, administrator.administratorId)).run();
      revokeAccountAuthentication(transaction, administrator.administratorId);
      return { ok: true };
    },
    { behavior: "immediate" },
  );
}

export function replaceSoleAdministratorCredential(
  database: ApplicationDatabaseClient,
  replacement: { passwordHash: string; updatedAt: string },
): AdministratorRecoveryPersistenceResult {
  return database.transaction(
    (transaction) => {
      const administrator = soleAdministratorWithPassword(transaction);
      if (!administrator.ok) return administrator;
      const { administratorId } = administrator;

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
      revokeAccountAuthentication(transaction, administratorId);
      return { ok: true };
    },
    { behavior: "immediate" },
  );
}
