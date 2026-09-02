import { and, eq } from "drizzle-orm";

import type { ApplicationDatabaseClient } from "./database.server";
import { users } from "./schema.server";

export function deleteMemberAccount(
  database: ApplicationDatabaseClient,
  usernameNormalized: string,
): boolean {
  return database.transaction(
    (transaction) => {
      const target = transaction
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.role, "member"),
            eq(users.usernameNormalized, usernameNormalized),
          ),
        )
        .get();
      if (!target) return false;

      return Boolean(
        transaction
          .delete(users)
          .where(and(eq(users.id, target.id), eq(users.role, "member")))
          .returning({ id: users.id })
          .get(),
      );
    },
    { behavior: "immediate" },
  );
}
