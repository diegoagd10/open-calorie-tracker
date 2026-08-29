import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import type BetterSqlite3 from "better-sqlite3";

import {
  createDummyPasswordHash,
  hashPassword,
  verifyPassword,
} from "./password.server";

const IDLE_SESSION_MS = 5 * 24 * 60 * 60 * 1_000;
const ABSOLUTE_SESSION_MS = 90 * 24 * 60 * 60 * 1_000;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1_000;
const REGISTRATION_WINDOW_MS = 60 * 60 * 1_000;

type UserRow = {
  id: number;
  passwordHash: string;
  usernameNormalized: string;
};

type SessionRow = {
  absoluteExpiresAt: string;
  idleExpiresAt: string;
  tokenHash: string;
  userId: number;
  usernameNormalized: string;
};

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

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function csrfTokenFor(sessionToken: string): string {
  return createHmac("sha256", sessionToken)
    .update("open-calory-tracker:csrf:v1", "utf8")
    .digest("base64url");
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

export class AuthenticationService {
  readonly #database: BetterSqlite3.Database;
  readonly #now: () => Date;

  constructor(database: BetterSqlite3.Database, now: () => Date = () => new Date()) {
    this.#database = database;
    this.#now = now;
  }

  async register(
    usernameNormalized: string,
    password: string,
    clientIp: string,
  ): Promise<RegistrationResult> {
    if (
      !this.#consumeAttempt(
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
      const userId = this.#database.transaction(() => {
        const result = this.#database
          .prepare(
            `INSERT INTO users (username_normalized, created_at)
             VALUES (?, ?)`,
          )
          .run(usernameNormalized, createdAt);
        const nextUserId = Number(result.lastInsertRowid);

        this.#database
          .prepare(
            `INSERT INTO password_credentials (user_id, password_hash, updated_at)
             VALUES (?, ?, ?)`,
          )
          .run(nextUserId, passwordHash, createdAt);

        return nextUserId;
      })();

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

  async authenticate(token: string | undefined): Promise<AuthenticatedSession | undefined> {
    if (!token) {
      return undefined;
    }

    const tokenHash = hashSessionToken(token);
    const session = this.#database
      .prepare<[string], SessionRow>(
        `SELECT
           s.token_hash AS tokenHash,
           s.user_id AS userId,
           s.idle_expires_at AS idleExpiresAt,
           s.absolute_expires_at AS absoluteExpiresAt,
           u.username_normalized AS usernameNormalized
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`,
      )
      .get(tokenHash);

    if (!session) {
      return undefined;
    }

    const now = this.#now();
    const idleExpiresAt = new Date(session.idleExpiresAt);
    const absoluteExpiresAt = new Date(session.absoluteExpiresAt);

    if (idleExpiresAt <= now || absoluteExpiresAt <= now) {
      this.#database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
      return undefined;
    }

    const nextIdleExpiry = new Date(
      Math.min(now.getTime() + IDLE_SESSION_MS, absoluteExpiresAt.getTime()),
    );
    this.#database
      .prepare(
        `UPDATE sessions
         SET last_seen_at = ?, idle_expires_at = ?
         WHERE token_hash = ?`,
      )
      .run(now.toISOString(), nextIdleExpiry.toISOString(), tokenHash);

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

  async login(
    usernameNormalized: string,
    password: string,
    clientIp: string,
  ): Promise<LoginResult> {
    const rateLimitSubject = `${clientIp}\0${usernameNormalized}`;
    if (
      !this.#consumeAttempt(
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
        .prepare(
          `UPDATE password_credentials
           SET password_hash = ?, updated_at = ?
           WHERE user_id = ?`,
        )
        .run(
          replacement,
          this.#now().toISOString(),
          verification.user.id,
        );
    }

    this.#clearAttempts("login-failure", rateLimitSubject);

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
      .prepare("DELETE FROM sessions WHERE token_hash = ?")
      .run(hashSessionToken(token));
  }

  #clearAttempts(scope: string, subject: string): void {
    this.#database
      .prepare(
        "DELETE FROM rate_limit_counters WHERE scope = ? AND subject_hash = ?",
      )
      .run(scope, this.#hashRateLimitSubject(scope, subject));
  }

  #consumeAttempt(
    scope: string,
    subject: string,
    limit: number,
    windowMs: number,
  ): boolean {
    return this.#database.transaction(() => {
      const now = this.#now();
      const nowIso = now.toISOString();
      const subjectHash = this.#hashRateLimitSubject(scope, subject);

      this.#database
        .prepare("DELETE FROM rate_limit_counters WHERE expires_at <= ?")
        .run(nowIso);

      const current = this.#database
        .prepare<[string, string], { attempts: number }>(
          `SELECT attempts
           FROM rate_limit_counters
           WHERE scope = ? AND subject_hash = ?`,
        )
        .get(scope, subjectHash);

      if (current && current.attempts >= limit) {
        return false;
      }

      if (current) {
        this.#database
          .prepare(
            `UPDATE rate_limit_counters
             SET attempts = attempts + 1
             WHERE scope = ? AND subject_hash = ?`,
          )
          .run(scope, subjectHash);
      } else {
        this.#database
          .prepare(
            `INSERT INTO rate_limit_counters (
               scope, subject_hash, window_started_at, attempts, expires_at
             ) VALUES (?, ?, ?, 1, ?)`,
          )
          .run(
            scope,
            subjectHash,
            nowIso,
            new Date(now.getTime() + windowMs).toISOString(),
          );
      }

      return true;
    })();
  }

  #hashRateLimitSubject(scope: string, subject: string): string {
    return createHash("sha256")
      .update(`${scope}\0${subject}`, "utf8")
      .digest("hex");
  }

  verifyCsrfToken(sessionToken: string, candidate: string | undefined): boolean {
    if (!candidate) {
      return false;
    }

    const expected = Buffer.from(csrfTokenFor(sessionToken), "utf8");
    const provided = Buffer.from(candidate, "utf8");

    return (
      expected.length === provided.length && timingSafeEqual(expected, provided)
    );
  }

  #issueSession(userId: number, usernameNormalized: string): IssuedSession {
    const now = this.#now();
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashSessionToken(token);
    const idleExpiresAt = new Date(now.getTime() + IDLE_SESSION_MS);
    const absoluteExpiresAt = new Date(now.getTime() + ABSOLUTE_SESSION_MS);

    this.#database
      .prepare(
        `INSERT INTO sessions (
           token_hash, user_id, created_at, last_seen_at,
           idle_expires_at, absolute_expires_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        tokenHash,
        userId,
        now.toISOString(),
        now.toISOString(),
        idleExpiresAt.toISOString(),
        absoluteExpiresAt.toISOString(),
      );

    return {
      absoluteExpiresAt,
      csrfToken: csrfTokenFor(token),
      token,
      user: { id: userId, username: usernameNormalized },
    };
  }

  async verifyCredentials(
    usernameNormalized: string,
    password: string,
  ): Promise<{ matches: boolean; needsRehash: boolean; user?: UserRow }> {
    const user = this.#database
      .prepare<[string], UserRow>(
        `SELECT
           u.id,
           u.username_normalized AS usernameNormalized,
           c.password_hash AS passwordHash
         FROM users u
         JOIN password_credentials c ON c.user_id = u.id
         WHERE u.username_normalized = ? COLLATE NOCASE`,
      )
      .get(usernameNormalized);
    const credential = user?.passwordHash ?? createDummyPasswordHash();
    const verification = await verifyPassword(password, credential);

    return {
      matches: Boolean(user) && verification.matches,
      needsRehash: verification.needsRehash,
      user,
    };
  }
}
