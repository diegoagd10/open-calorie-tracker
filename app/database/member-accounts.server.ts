import type { ApplicationDatabaseClient } from "./database.server";
import { passwordCredentials, users } from "./schema.server";

export type NewMemberAccount = {
  createdAt: string;
  passwordHash: string;
  usernameNormalized: string;
};

export function createMemberAccount(
  database: ApplicationDatabaseClient,
  account: NewMemberAccount,
): { id: number } | undefined {
  return database.transaction(
    (transaction) => {
      const user = transaction
        .insert(users)
        .values({
          accessState: "active",
          createdAt: account.createdAt,
          passwordChangeRequired: true,
          role: "member",
          usernameNormalized: account.usernameNormalized,
        })
        .onConflictDoNothing()
        .returning({ id: users.id })
        .get();
      if (!user) return undefined;

      transaction.insert(passwordCredentials).values({
        passwordHash: account.passwordHash,
        updatedAt: account.createdAt,
        userId: user.id,
      }).run();
      return user;
    },
    { behavior: "immediate" },
  );
}
