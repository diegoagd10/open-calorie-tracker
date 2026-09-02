import { randomBytes } from "node:crypto";

import { asc, eq } from "drizzle-orm";

import type { ApplicationDatabaseClient } from "../database/database.server";
import {
  issueSessionForVerifiedCredential,
  replacePasswordAndSessions,
} from "../database/credential-sessions.server";
import { createMemberAccount } from "../database/member-accounts.server";
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
import {
  logBootstrapFailed,
  logBootstrapRejected,
  logBootstrapSucceeded,
} from "./bootstrap-events.server";
import { logMemberProvisioned } from "./member-events.server";

const IDLE_SESSION_MS = 5 * 24 * 60 * 60 * 1_000;
const ABSOLUTE_SESSION_MS = 90 * 24 * 60 * 60 * 1_000;
function passwordChangeFailureWindowMs(): number {
  return 15 * 60 * 1_000;
}

function loginFailureWindowMs(): number {
  return 15 * 60 * 1_000;
}

function registrationWindowMs(): number {
  return 60 * 60 * 1_000;
}

export type CredentialUser = Pick<
  typeof users.$inferSelect,
  "id" | "passwordChangeRequired" | "role" | "usernameNormalized"
> &
  Pick<typeof passwordCredentials.$inferSelect, "passwordHash">;

export type UserRole = (typeof users.$inferSelect)["role"];
export type AccountAccessState = (typeof users.$inferSelect)["accessState"];

export type AuthenticatedSession = {
  absoluteExpiresAt: Date;
  csrfToken: string;
  token: string;
  user: {
    id: number;
    passwordChangeRequired: boolean;
    role: UserRole;
    username: string;
  };
};

export type ManageableMember = {
  accessState: AccountAccessState;
  createdAt: string;
  passwordChangeRequired: boolean;
  username: string;
};

export type ProvisionMemberResult =
  | { error: "duplicate-username"; ok: false }
  | { member: ManageableMember; ok: true };

export type IssuedSession = AuthenticatedSession;

export type RegistrationResult =
  | { error: "claimed-instance"; ok: false }
  | { error: "rate-limited"; ok: false }
  | { ok: true; session: IssuedSession };

export type LoginResult =
  | { error: "invalid-credentials"; ok: false }
  | { error: "rate-limited"; ok: false }
  | { ok: true; session: IssuedSession };

export type PasswordChangeResult =
  | { error: "invalid-current-password"; ok: false }
  | { error: "invalid-session"; ok: false }
  | { error: "password-reuse"; ok: false }
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

export class AuthenticationService {
  readonly #database: ApplicationDatabaseClient;
  readonly #now: () => Date;
  readonly #passwordVerifier: typeof verifyPassword;
  readonly #rateLimiter: PersistentRateLimiter;

  constructor(
    database: ApplicationDatabaseClient,
    now: () => Date = () => new Date(),
    passwordVerifier: typeof verifyPassword = verifyPassword,
  ) {
    this.#database = database;
    this.#now = now;
    this.#passwordVerifier = passwordVerifier;
    this.#rateLimiter = new PersistentRateLimiter(database, now);
  }

  async register(
    usernameNormalized: string,
    password: string,
    clientIp: string,
  ): Promise<RegistrationResult> {
    try {
      if (
        !this.#rateLimiter.consume(
          "registration",
          clientIp,
          5,
          registrationWindowMs(),
        )
      ) {
        logBootstrapRejected("rate-limited");
        return { error: "rate-limited", ok: false };
      }

      const passwordHash = await hashPassword(password);
      const createdAt = this.#now().toISOString();
      const registered = this.#database.transaction(
        (transaction) => {
          const existingUser = transaction
            .select({ id: users.id })
            .from(users)
            .limit(1)
            .get();
          if (existingUser) return undefined;

          const user = transaction
            .insert(users)
            .values({ createdAt, role: "admin", usernameNormalized })
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

          const issued = prepareIssuedSession(this.#now(), {
            id: user.id,
            passwordChangeRequired: false,
            role: "admin",
            username: usernameNormalized,
          });
          transaction.insert(sessions).values(issued.persisted).run();
          return issued.session;
        },
        { behavior: "immediate" },
      );

      if (!registered) {
        logBootstrapRejected("claimed-instance");
        return { error: "claimed-instance", ok: false };
      }

      logBootstrapSucceeded(registered.user.id, registered.user.username);
      return { ok: true, session: registered };
    } catch (error) {
      logBootstrapFailed(error);
      throw error;
    }
  }

  isRegistrationOpen(): boolean {
    return this.#database.select({ id: users.id }).from(users).limit(1).get() ===
      undefined;
  }

  async provisionMember(
    usernameNormalized: string,
    initialPassword: string,
  ): Promise<ProvisionMemberResult> {
    const passwordHash = await hashPassword(initialPassword);
    const createdAt = this.#now().toISOString();
    const member = createMemberAccount(this.#database, {
      createdAt,
      passwordHash,
      usernameNormalized,
    });

    if (!member) return { error: "duplicate-username", ok: false };
    logMemberProvisioned(member.id, usernameNormalized);
    return {
      member: {
        accessState: "active",
        createdAt,
        passwordChangeRequired: true,
        username: usernameNormalized,
      },
      ok: true,
    };
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
        passwordChangeRequired: users.passwordChangeRequired,
        tokenHash: sessions.tokenHash,
        userId: sessions.userId,
        role: users.role,
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

    if (idleExpiresAt <= now) {
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
        passwordChangeRequired: session.passwordChangeRequired,
        role: session.role,
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
        passwordChangeFailureWindowMs(),
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
      verification.user!.id !== currentSession.user.id
    ) {
      return { error: "invalid-current-password", ok: false };
    }
    if (
      currentSession.user.passwordChangeRequired &&
      currentPassword === nextPassword
    ) {
      return { error: "password-reuse", ok: false };
    }

    const now = this.#now();
    const nextPasswordHash = await hashPassword(nextPassword);
    const nextSession = prepareIssuedSession(
      now,
      { ...currentSession.user, passwordChangeRequired: false },
      currentSession.absoluteExpiresAt,
    );
    const currentTokenHash = hashOpaqueToken(currentSession.token);

    const rotated = replacePasswordAndSessions(this.#database, {
      currentTokenHash,
      nextPasswordHash,
      nextSession: nextSession.persisted,
      updatedAt: now.toISOString(),
      userId: currentSession.user.id,
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
        loginFailureWindowMs(),
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

    const issued = prepareIssuedSession(this.#now(), {
        id: verification.user.id,
        passwordChangeRequired: verification.user.passwordChangeRequired,
        role: verification.user.role,
        username: verification.user.usernameNormalized,
    });
    const replacementPasswordHash = verification.needsRehash
      ? await hashPassword(password)
      : undefined;
    const sessionIssued = issueSessionForVerifiedCredential(this.#database, {
      ...(replacementPasswordHash
        ? {
            credentialReplacement: {
              passwordHash: replacementPasswordHash,
              updatedAt: this.#now().toISOString(),
            },
          }
        : {}),
      expectedPasswordHash: verification.user.passwordHash,
      session: issued.persisted,
    });
    if (!sessionIssued) return { error: "invalid-credentials", ok: false };

    this.#rateLimiter.clear("login-failure", rateLimitSubject);
    return { ok: true, session: issued.session };
  }

  revokeSession(token: string): void {
    this.#database
      .delete(sessions)
      .where(eq(sessions.tokenHash, hashOpaqueToken(token)))
      .run();
  }

  verifyCsrfToken(sessionToken: string, candidate: string | undefined): boolean {
    return safelyEqual(csrfTokenFor(sessionToken), candidate);
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
        passwordChangeRequired: users.passwordChangeRequired,
        role: users.role,
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
    const verification = await this.#passwordVerifier(password, credential);

    return {
      matches: Boolean(user) && verification.matches,
      needsRehash: verification.needsRehash,
      user,
    };
  }

  listManageableMembers(): ManageableMember[] {
    return this.#database
      .select({
        accessState: users.accessState,
        createdAt: users.createdAt,
        passwordChangeRequired: users.passwordChangeRequired,
        username: users.usernameNormalized,
      })
      .from(users)
      .where(eq(users.role, "member"))
      .orderBy(asc(users.usernameNormalized))
      .all();
  }
}
