import { and, eq } from "drizzle-orm";

import type { ApplicationDatabaseClient } from "./database.server";
import { users } from "./schema.server";

export function deleteMemberAccount(
  database: ApplicationDatabaseClient,
  target: { id: number; usernameNormalized: string },
): boolean {
  return database.transaction(
    (transaction) => {
      return Boolean(
        transaction
          .delete(users)
          .where(
            and(
              eq(users.id, target.id),
              eq(users.role, "member"),
              eq(users.usernameNormalized, target.usernameNormalized),
            ),
          )
          .returning({ id: users.id })
          .get(),
      );
    },
    { behavior: "immediate" },
  );
}
