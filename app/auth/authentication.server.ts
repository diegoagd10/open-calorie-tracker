import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { ApplicationDatabaseClient } from "../database/database.server";
import {
  passwordCredentials,
  sessions,
  users,
} from "../database/schema.server";
import {
  createDummyPasswordHash,
  hashPassword,
  verifyPassword,
} from "./password.server";
import { PersistentRateLimiter } from "./rate-limiter.server";
import { deriveCsrfToken, hashOpaqueToken, safelyEqual } from "./token.server";

const IDLE_SESSION_MS = 5 * 24 * 60 * 60 * 1_000;
const ABSOLUTE_SESSION_MS = 90 * 24 * 60 * 60 * 1_000;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1_000;
const PASSWORD_CHANGE_FAILURE_WINDOW_MS = 15 * 60 * 1_000;
const REGISTRATION_WINDOW_MS = 60 * 60 * 1_000;

type CredentialUser = Pick<
  typeof users.$inferSelect,
  "id" | "usernameNormalized"
> &
  Pick<typeof passwordCredentials.$inferSelect, "passwordHash">;

export type AuthenticatedSession = {
  absoluteExpiresAt: Date;
  csrfToken: string;
  token: string;
  user: {
    id: number;
    username: string;
  };
};

export type IssuedSession = AuthenticatedSession;

export type RegistrationResult =
  | { error: "duplicate-username"; ok: false }
  | { error: "rate-limited"; ok: false }
  | { ok: true; session: IssuedSession };

export type LoginResult =
  | { error: "invalid-credentials"; ok: false }
  | { error: "rate-limited"; ok: false }
  | { ok: true; session: IssuedSession };

export type PasswordChangeResult =
  | { error: "invalid-current-password"; ok: false }
  | { error: "invalid-session"; ok: false }
  | { error: "rate-limited"; ok: false }
  | { ok: true; session: IssuedSession };

function csrfTokenFor(sessionToken: string): string {
  return deriveCsrfToken(sessionToken, "authenticated-session");
}

function prepareIssuedSession(
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

function isUniqueConstraint(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

export class AuthenticationService {
  readonly #database: ApplicationDatabaseClient;
  readonly #now: () => Date;
  readonly #rateLimiter: PersistentRateLimiter;

  constructor(
    database: ApplicationDatabaseClient,
    now: () => Date = () => new Date(),
  ) {
    this.#database = database;
    this.#now = now;
    this.#rateLimiter = new PersistentRateLimiter(database, now);
  }

  async register(
    usernameNormalized: string,
    password: string,
    clientIp: string,
  ): Promise<RegistrationResult> {
    if (
      !this.#rateLimiter.consume(
        "registration",
        clientIp,
        5,
        REGISTRATION_WINDOW_MS,
      )
    ) {
      return { error: "rate-limited", ok: false };
    }

    const passwordHash = await hashPassword(password);
    const createdAt = this.#now().toISOString();

    try {
      const userId = this.#database.transaction((transaction) => {
        const user = transaction
          .insert(users)
          .values({ createdAt, usernameNormalized })
          .returning({ id: users.id })
          .get();

        transaction
          .insert(passwordCredentials)
          .values({
            passwordHash,
            updatedAt: createdAt,
            userId: user.id,
          })
          .run();

        return user.id;
      });

      return {
        ok: true,
        session: this.#issueSession(userId, usernameNormalized),
      };
    } catch (error) {
      if (isUniqueConstraint(error)) {
        return { error: "duplicate-username", ok: false };
      }

      throw error;
    }
  }

  async authenticate(
    token: string | undefined,
  ): Promise<AuthenticatedSession | undefined> {
    if (!token) {
      return undefined;
    }

    const tokenHash = hashOpaqueToken(token);
    const session = this.#database
      .select({
        absoluteExpiresAt: sessions.absoluteExpiresAt,
        idleExpiresAt: sessions.idleExpiresAt,
        tokenHash: sessions.tokenHash,
        userId: sessions.userId,
        usernameNormalized: users.usernameNormalized,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, tokenHash))
      .get();

    if (!session) {
      return undefined;
    }

    const now = this.#now();
    const idleExpiresAt = new Date(session.idleExpiresAt);
    const absoluteExpiresAt = new Date(session.absoluteExpiresAt);

    if (idleExpiresAt <= now || absoluteExpiresAt <= now) {
      this.#database
        .delete(sessions)
        .where(eq(sessions.tokenHash, tokenHash))
        .run();
      return undefined;
    }

    const nextIdleExpiry = new Date(
      Math.min(now.getTime() + IDLE_SESSION_MS, absoluteExpiresAt.getTime()),
    );
    this.#database
      .update(sessions)
      .set({
        idleExpiresAt: nextIdleExpiry.toISOString(),
        lastSeenAt: now.toISOString(),
      })
      .where(eq(sessions.tokenHash, tokenHash))
      .run();

    return {
      absoluteExpiresAt,
      csrfToken: csrfTokenFor(token),
      token,
      user: {
        id: session.userId,
        username: session.usernameNormalized,
      },
    };
  }

  async changePassword(
    currentSession: AuthenticatedSession,
    currentPassword: string,
    nextPassword: string,
  ): Promise<PasswordChangeResult> {
    const rateLimitSubject = String(currentSession.user.id);
    if (
      !this.#rateLimiter.consume(
        "password-change-failure",
        rateLimitSubject,
        5,
        PASSWORD_CHANGE_FAILURE_WINDOW_MS,
      )
    ) {
      return { error: "rate-limited", ok: false };
    }

    const verification = await this.verifyCredentials(
      currentSession.user.username,
      currentPassword,
    );
    if (
      !verification.matches ||
      verification.user?.id !== currentSession.user.id
    ) {
      return { error: "invalid-current-password", ok: false };
    }

    const now = this.#now();
    const nextPasswordHash = await hashPassword(nextPassword);
    const nextSession = prepareIssuedSession(
      now,
      currentSession.user,
      currentSession.absoluteExpiresAt,
    );
    const currentTokenHash = hashOpaqueToken(currentSession.token);

    const rotated = this.#database.transaction((transaction) => {
      const persistedCurrentSession = transaction
        .select({ tokenHash: sessions.tokenHash })
        .from(sessions)
        .where(
          and(
            eq(sessions.tokenHash, currentTokenHash),
            eq(sessions.userId, currentSession.user.id),
          ),
        )
        .get();
      if (!persistedCurrentSession) return false;

      transaction
        .update(passwordCredentials)
        .set({
          passwordHash: nextPasswordHash,
          updatedAt: now.toISOString(),
        })
        .where(eq(passwordCredentials.userId, currentSession.user.id))
        .run();
      transaction
        .delete(sessions)
        .where(eq(sessions.userId, currentSession.user.id))
        .run();
      transaction
        .insert(sessions)
        .values(nextSession.persisted)
        .run();
      return true;
    });

    if (!rotated) {
      return { error: "invalid-session", ok: false };
    }

    this.#rateLimiter.clear("password-change-failure", rateLimitSubject);
    return { ok: true, session: nextSession.session };
  }

  async login(
    usernameNormalized: string,
    password: string,
    clientIp: string,
  ): Promise<LoginResult> {
    const rateLimitSubject = `${clientIp}\0${usernameNormalized}`;
    if (
      !this.#rateLimiter.consume(
        "login-failure",
        rateLimitSubject,
        10,
        LOGIN_FAILURE_WINDOW_MS,
      )
    ) {
      return { error: "rate-limited", ok: false };
    }

    const verification = await this.verifyCredentials(
      usernameNormalized,
      password,
    );

    if (!verification.matches || !verification.user) {
      return { error: "invalid-credentials", ok: false };
    }

    if (verification.needsRehash) {
      const replacement = await hashPassword(password);
      this.#database
        .update(passwordCredentials)
        .set({
          passwordHash: replacement,
          updatedAt: this.#now().toISOString(),
        })
        .where(eq(passwordCredentials.userId, verification.user.id))
        .run();
    }

    this.#rateLimiter.clear("login-failure", rateLimitSubject);

    return {
      ok: true,
      session: this.#issueSession(
        verification.user.id,
        verification.user.usernameNormalized,
      ),
    };
  }

  revokeSession(token: string): void {
    this.#database
      .delete(sessions)
      .where(eq(sessions.tokenHash, hashOpaqueToken(token)))
      .run();
  }

  verifyCsrfToken(sessionToken: string, candidate: string | undefined): boolean {
    if (!candidate) {
      return false;
    }

    return safelyEqual(csrfTokenFor(sessionToken), candidate);
  }

  #issueSession(userId: number, usernameNormalized: string): IssuedSession {
    const issued = prepareIssuedSession(this.#now(), {
      id: userId,
      username: usernameNormalized,
    });
    this.#database
      .insert(sessions)
      .values(issued.persisted)
      .run();
    return issued.session;
  }

  async verifyCredentials(
    usernameNormalized: string,
    password: string,
  ): Promise<{
    matches: boolean;
    needsRehash: boolean;
    user?: CredentialUser;
  }> {
    const user = this.#database
      .select({
        id: users.id,
        passwordHash: passwordCredentials.passwordHash,
        usernameNormalized: users.usernameNormalized,
      })
      .from(users)
      .innerJoin(
        passwordCredentials,
        eq(passwordCredentials.userId, users.id),
      )
      .where(eq(users.usernameNormalized, usernameNormalized))
      .get();
    const credential = user?.passwordHash ?? createDummyPasswordHash();
    const verification = await verifyPassword(password, credential);

    return {
      matches: Boolean(user) && verification.matches,
      needsRehash: verification.needsRehash,
      user,
    };
  }
}
