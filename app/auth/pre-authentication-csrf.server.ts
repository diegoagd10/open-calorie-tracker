import { randomBytes } from "node:crypto";

import { eq, lte } from "drizzle-orm";

import type { ApplicationDatabaseClient } from "../database/database.server";
import { preAuthenticationCsrfSessions } from "../database/schema.server";
import { deriveCsrfToken, hashOpaqueToken, safelyEqual } from "./token.server";

const PRE_AUTHENTICATION_CSRF_SESSION_MS = 30 * 60 * 1_000;

export type PreAuthenticationCsrfSession = {
  csrfToken: string;
  expiresAt: Date;
  token: string;
};

export class PreAuthenticationCsrfService {
  readonly #database: ApplicationDatabaseClient;
  readonly #now: () => Date;

  constructor(
    database: ApplicationDatabaseClient,
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
      .delete(preAuthenticationCsrfSessions)
      .where(lte(preAuthenticationCsrfSessions.expiresAt, now.toISOString()))
      .run();
    this.#database
      .insert(preAuthenticationCsrfSessions)
      .values({
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        tokenHash: hashOpaqueToken(token),
      })
      .run();

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
      .select({ expiresAt: preAuthenticationCsrfSessions.expiresAt })
      .from(preAuthenticationCsrfSessions)
      .where(eq(preAuthenticationCsrfSessions.tokenHash, tokenHash))
      .get();

    if (!stored) return undefined;

    const expiresAt = new Date(stored.expiresAt);
    if (expiresAt <= this.#now()) {
      this.#database
        .delete(preAuthenticationCsrfSessions)
        .where(eq(preAuthenticationCsrfSessions.tokenHash, tokenHash))
        .run();
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
      .delete(preAuthenticationCsrfSessions)
      .where(
        eq(preAuthenticationCsrfSessions.tokenHash, hashOpaqueToken(token)),
      )
      .run();
  }

  verify(token: string | undefined, candidate: string | undefined): boolean {
    const session = this.resolve(token);
    return Boolean(session && safelyEqual(session.csrfToken, candidate));
  }
}
