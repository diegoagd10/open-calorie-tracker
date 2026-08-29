import { randomBytes } from "node:crypto";

import type BetterSqlite3 from "better-sqlite3";

import { deriveCsrfToken, hashOpaqueToken, safelyEqual } from "./token.server";

const PRE_AUTHENTICATION_CSRF_SESSION_MS = 30 * 60 * 1_000;

type CsrfSessionRow = {
  expiresAt: string;
};

export type PreAuthenticationCsrfSession = {
  csrfToken: string;
  expiresAt: Date;
  token: string;
};

export class PreAuthenticationCsrfService {
  readonly #database: BetterSqlite3.Database;
  readonly #now: () => Date;

  constructor(
    database: BetterSqlite3.Database,
    now: () => Date = () => new Date(),
  ) {
    this.#database = database;
    this.#now = now;
  }

  issue(): PreAuthenticationCsrfSession {
    const now = this.#now();
    const expiresAt = new Date(
      now.getTime() + PRE_AUTHENTICATION_CSRF_SESSION_MS,
    );
    const token = randomBytes(32).toString("base64url");

    this.#database
      .prepare(
        "DELETE FROM pre_authentication_csrf_sessions WHERE expires_at <= ?",
      )
      .run(now.toISOString());
    this.#database
      .prepare(
        `INSERT INTO pre_authentication_csrf_sessions (
           token_hash, created_at, expires_at
         ) VALUES (?, ?, ?)`,
      )
      .run(hashOpaqueToken(token), now.toISOString(), expiresAt.toISOString());

    return {
      csrfToken: deriveCsrfToken(token, "pre-authentication"),
      expiresAt,
      token,
    };
  }

  resolve(token: string | undefined): PreAuthenticationCsrfSession | undefined {
    if (!token) return undefined;

    const tokenHash = hashOpaqueToken(token);
    const stored = this.#database
      .prepare<[string], CsrfSessionRow>(
        `SELECT expires_at AS expiresAt
         FROM pre_authentication_csrf_sessions
         WHERE token_hash = ?`,
      )
      .get(tokenHash);

    if (!stored) return undefined;

    const expiresAt = new Date(stored.expiresAt);
    if (expiresAt <= this.#now()) {
      this.#database
        .prepare(
          "DELETE FROM pre_authentication_csrf_sessions WHERE token_hash = ?",
        )
        .run(tokenHash);
      return undefined;
    }

    return {
      csrfToken: deriveCsrfToken(token, "pre-authentication"),
      expiresAt,
      token,
    };
  }

  revoke(token: string | undefined): void {
    if (!token) return;

    this.#database
      .prepare(
        "DELETE FROM pre_authentication_csrf_sessions WHERE token_hash = ?",
      )
      .run(hashOpaqueToken(token));
  }

  verify(token: string | undefined, candidate: string | undefined): boolean {
    const session = this.resolve(token);
    return Boolean(session && safelyEqual(session.csrfToken, candidate));
  }
}
