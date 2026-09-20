import { eq, sql } from "drizzle-orm";
import type { ApplicationDatabaseClient } from "./database.server";
import { sessions, users, webauthnCeremonies } from "./schema.server";

// Call inside the account mutation transaction, so async proofs cannot survive it.
export function invalidateAccountProofs(
  transaction: Parameters<
    Parameters<ApplicationDatabaseClient["transaction"]>[0]
  >[0],
  userId: number,
): void {
  transaction
    .update(users)
    .set({ authenticationVersion: sql`${users.authenticationVersion} + 1` })
    .where(eq(users.id, userId))
    .run();
  transaction
    .delete(webauthnCeremonies)
    .where(eq(webauthnCeremonies.userId, userId))
    .run();
}

export function revokeAccountAuthentication(
  transaction: Parameters<Parameters<ApplicationDatabaseClient["transaction"]>[0]>[0],
  userId: number,
): void {
  transaction.delete(sessions).where(eq(sessions.userId, userId)).run();
  invalidateAccountProofs(transaction, userId);
}
