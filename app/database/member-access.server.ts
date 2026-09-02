import { and, eq } from "drizzle-orm";

import type { ApplicationDatabaseClient } from "./database.server";
import { sessions, users } from "./schema.server";

export type MemberAccessTransitionResult =
  | "changed"
  | "not-found"
  | "wrong-state";

export function transitionMemberAccess(
  database: ApplicationDatabaseClient,
  usernameNormalized: string,
  expectedState: "active" | "disabled",
  nextState: "active" | "disabled",
): MemberAccessTransitionResult {
  return database.transaction(
    (transaction) => {
      const target = transaction
        .select({ accessState: users.accessState, id: users.id })
        .from(users)
        .where(
          and(
            eq(users.role, "member"),
            eq(users.usernameNormalized, usernameNormalized),
          ),
        )
        .get();
      if (!target) return "not-found";
      if (target.accessState !== expectedState) return "wrong-state";

      transaction
        .update(users)
        .set({ accessState: nextState })
        .where(
          and(eq(users.id, target.id), eq(users.accessState, expectedState)),
        )
        .run();
      if (nextState === "disabled") {
        transaction.delete(sessions).where(eq(sessions.userId, target.id)).run();
      }
      return "changed";
    },
    { behavior: "immediate" },
  );
}
