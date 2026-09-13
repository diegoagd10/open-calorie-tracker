import { randomBytes } from "node:crypto";
import type {
  AuthenticatedSession,
  IssuedSession,
} from "./authentication.server";
import { sessions } from "../database/schema.server";
import { deriveCsrfToken, hashOpaqueToken } from "./token.server";
const IDLE_SESSION_MS = 5 * 24 * 60 * 60 * 1_000;
const ABSOLUTE_SESSION_MS = 90 * 24 * 60 * 60 * 1_000;
export function csrfTokenFor(sessionToken: string): string {
  return deriveCsrfToken(sessionToken, "authenticated-session");
}

export function prepareIssuedSession(
  now: Date,
  user: AuthenticatedSession["user"],
  absoluteExpiresAt = new Date(now.getTime() + ABSOLUTE_SESSION_MS),
): {
  persisted: typeof sessions.$inferInsert;
  session: IssuedSession;
} {
  const token = randomBytes(32).toString("base64url");
  const idleExpiresAt = new Date(
    Math.min(now.getTime() + IDLE_SESSION_MS, absoluteExpiresAt.getTime()),
  );

  return {
    persisted: {
      absoluteExpiresAt: absoluteExpiresAt.toISOString(),
      createdAt: now.toISOString(),
      idleExpiresAt: idleExpiresAt.toISOString(),
      lastSeenAt: now.toISOString(),
      tokenHash: hashOpaqueToken(token),
      userId: user.id,
    },
    session: {
      absoluteExpiresAt,
      csrfToken: csrfTokenFor(token),
      token,
      user,
    },
  };
}
