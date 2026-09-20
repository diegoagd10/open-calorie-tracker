import { operationalLog } from "../../server/operational-logging.js";
import { csrfTokenFor, prepareIssuedSession } from "./session.server";
import { KeyAuthenticationService } from "./key-authentication.server";
import { eq } from "drizzle-orm";

import type { ApplicationDatabaseClient } from "../database/database.server";
import {
  findActiveSessionByTokenHash,
  findCredentialByUsername,
  issueSessionForVerifiedCredential,
  replacePasswordAndSessions,
  resetMemberPasswordAndSessions,
  type CredentialRecord,
} from "../database/credential-sessions.server";
import {
  createMemberAccount,
  listMemberAccounts,
  type MemberAccountDirectoryEntry,
} from "../database/member-accounts.server";
import { transitionMemberAccess } from "../database/member-access.server";
import { deleteMemberAccount } from "../database/member-deletion.server";
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
import { hashOpaqueToken, safelyEqual } from "./token.server";
import {
  logBootstrapFailed,
  logBootstrapRejected,
  logBootstrapSucceeded,
} from "./bootstrap-events.server";
import {
  logMemberAccessChanged,
  logMemberDeleted,
  logMemberPasswordReset,
  logMemberProvisioned,
} from "./member-events.server";

const IDLE_SESSION_MS = 5 * 24 * 60 * 60 * 1_000;
function passwordChangeFailureWindowMs(): number {
  return 15 * 60 * 1_000;
}

function loginFailureWindowMs(): number {
  return 15 * 60 * 1_000;
}

function registrationWindowMs(): number {
  return 60 * 60 * 1_000;
}

export type CredentialUser = CredentialRecord;

export type UserRole = (typeof users.$inferSelect)["role"];
type AccountAccessState = (typeof users.$inferSelect)["accessState"];
type MemberAccessAction = "disable" | "reactivate";
type MemberAccessStaleError = "already-active" | "already-disabled";

const memberAccessTransitions = {
  disable: {
    expectedState: "active",
    nextState: "disabled",
    staleError: "already-disabled",
  },
  reactivate: {
    expectedState: "disabled",
    nextState: "active",
    staleError: "already-active",
  },
} as const satisfies Record<
  MemberAccessAction,
  {
    expectedState: AccountAccessState;
    nextState: AccountAccessState;
    staleError: MemberAccessStaleError;
  }
>;

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

export type ManageableMember = MemberAccountDirectoryEntry;

export type ProvisionMemberResult =
  | { error: "duplicate-username"; ok: false }
  | { member: Omit<ManageableMember, "id">; ok: true };

export type MemberAccessChangeResult =
  | {
      error:
        | "already-active"
        | "already-disabled"
        | "confirmation-mismatch"
        | "not-found";
      ok: false;
    }
  | { ok: true };

export type MemberPasswordResetResult =
  { error: "not-found"; ok: false } | { ok: true };

export type MemberDeletionResult =
  { error: "confirmation-mismatch" | "not-found"; ok: false } | { ok: true };

export type IssuedSession = AuthenticatedSession;

export type RegistrationResult =
  | { error: "claimed-instance"; ok: false }
  | { error: "rate-limited"; ok: false }
  | { ok: true; session: IssuedSession };

export type LoginResult =
  | { error: "account-disabled"; ok: false }
  | { error: "invalid-credentials"; ok: false }
  | { error: "rate-limited"; ok: false }
  | { ok: true; session: IssuedSession };

export type PasswordChangeResult =
  | { error: "key-proof-required"; ok: false }
  | { error: "invalid-current-password"; ok: false }
  | { error: "invalid-session"; ok: false }
  | { error: "password-reuse"; ok: false }
  | { error: "rate-limited"; ok: false }
  | { ok: true; session: IssuedSession };

export class AuthenticationService {
  readonly keys: KeyAuthenticationService;
  readonly #database: ApplicationDatabaseClient;
  readonly #now: () => Date;
  readonly #passwordVerifier: typeof verifyPassword;
  readonly #rateLimiter: PersistentRateLimiter;

  constructor(
    database: ApplicationDatabaseClient,
    now: () => Date = () => new Date(),
    passwordVerifier: typeof verifyPassword = verifyPassword,
  ) {
    this.keys = new KeyAuthenticationService(database, now);
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
    return (
      this.#database.select({ id: users.id }).from(users).limit(1).get() ===
      undefined
    );
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
    const session = findActiveSessionByTokenHash(this.#database, tokenHash);

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
    const account = findCredentialByUsername(this.#database, currentSession.user.username);
    if (account?.keyLoginEnabled)
      return { error: "key-proof-required", ok: false };
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
      verification.user!.passwordChangeRequired &&
      currentPassword === nextPassword
    ) {
      return { error: "password-reuse", ok: false };
    }

    const nextPasswordHash = await hashPassword(nextPassword);
    const now = this.#now();
    const nextSession = prepareIssuedSession(
      now,
      { ...currentSession.user, passwordChangeRequired: false },
      currentSession.absoluteExpiresAt,
    );
    const currentTokenHash = hashOpaqueToken(currentSession.token);

    const rotated = replacePasswordAndSessions(this.#database, {
      currentTokenHash,
      expectedPasswordHash: verification.user!.passwordHash,
      expectedAuthenticationVersion: verification.user!.authenticationVersion,
      nextPasswordHash,
      nextSession: nextSession.persisted,
      updatedAt: now.toISOString(),
      userId: currentSession.user.id,
    }, () => this.#rateLimiter.clear("password-change-failure", rateLimitSubject));

    if (!rotated) {
      return { error: "invalid-session", ok: false };
    }

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
    if (verification.user.accessState !== "active") {
      this.#rateLimiter.clear("login-failure", rateLimitSubject);
      return { error: "account-disabled", ok: false };
    }

    if (verification.user.keyLoginEnabled) {
      operationalLog("info", "password_login_policy", {
        outcome: "rejected",
        userId: verification.user.id,
      });
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
      expectedAuthenticationVersion: verification.user.authenticationVersion,
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

  verifyCsrfToken(
    sessionToken: string,
    candidate: string | undefined,
  ): boolean {
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
    const user = findCredentialByUsername(this.#database, usernameNormalized);
    const credential = user?.passwordHash ?? createDummyPasswordHash();
    const verification = await this.#passwordVerifier(password, credential);

    return {
      matches: Boolean(user) && verification.matches,
      needsRehash: verification.needsRehash,
      user,
    };
  }

  async disableMemberAccess(
    actor: AuthenticatedSession["user"],
    targetUsername: string,
    confirmationUsername: string,
  ): Promise<MemberAccessChangeResult> {
    if (confirmationUsername !== targetUsername) {
      logMemberAccessChanged(
        "disable",
        actor,
        targetUsername,
        "confirmation-mismatch",
      );
      return { error: "confirmation-mismatch", ok: false };
    }
    return this.#changeMemberAccess(actor, targetUsername, "disable");
  }

  async reactivateMemberAccess(
    actor: AuthenticatedSession["user"],
    targetUsername: string,
  ): Promise<MemberAccessChangeResult> {
    return this.#changeMemberAccess(actor, targetUsername, "reactivate");
  }

  async resetMemberPassword(
    actor: AuthenticatedSession["user"],
    targetUsername: string,
    temporaryPassword: string,
  ): Promise<MemberPasswordResetResult> {
    const nextPasswordHash = await hashPassword(temporaryPassword);
    try {
      const changed = resetMemberPasswordAndSessions(this.#database, {
        nextPasswordHash,
        targetUsername,
        updatedAt: this.#now().toISOString(),
      });
      if (!changed) {
        logMemberPasswordReset(actor, targetUsername, "not-found");
        return { error: "not-found", ok: false };
      }

      logMemberPasswordReset(actor, targetUsername, "succeeded");
      return { ok: true };
    } catch (error) {
      logMemberPasswordReset(actor, targetUsername, "failed");
      throw error;
    }
  }

  async deleteMember(
    actor: AuthenticatedSession["user"],
    target: Pick<ManageableMember, "id" | "username">,
    confirmationUsername: string,
  ): Promise<MemberDeletionResult> {
    if (actor.role !== "admin") {
      logMemberDeleted(actor, target.username, "not-found");
      return { error: "not-found", ok: false };
    }
    if (confirmationUsername !== target.username) {
      logMemberDeleted(actor, target.username, "confirmation-mismatch");
      return { error: "confirmation-mismatch", ok: false };
    }

    try {
      if (
        !deleteMemberAccount(this.#database, {
          id: target.id,
          usernameNormalized: target.username,
        })
      ) {
        logMemberDeleted(actor, target.username, "not-found");
        return { error: "not-found", ok: false };
      }
      logMemberDeleted(actor, target.username, "succeeded");
      return { ok: true };
    } catch (error) {
      logMemberDeleted(actor, target.username, "failed");
      throw error;
    }
  }

  #changeMemberAccess(
    actor: AuthenticatedSession["user"],
    targetUsername: string,
    action: MemberAccessAction,
  ): MemberAccessChangeResult {
    try {
      const transition = memberAccessTransitions[action];
      const result = transitionMemberAccess(
        this.#database,
        targetUsername,
        transition.expectedState,
        transition.nextState,
      );
      if (result === "changed") {
        logMemberAccessChanged(action, actor, targetUsername, "succeeded");
        return { ok: true };
      }

      const error =
        result === "not-found" ? "not-found" : transition.staleError;
      logMemberAccessChanged(action, actor, targetUsername, error);
      return { error, ok: false };
    } catch (error) {
      logMemberAccessChanged(action, actor, targetUsername, "failed");
      throw error;
    }
  }

  listManageableMembers(): ManageableMember[] {
    return listMemberAccounts(this.#database);
  }
}
