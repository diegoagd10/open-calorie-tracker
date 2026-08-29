import { createHash } from "node:crypto";

import { and, eq, lte } from "drizzle-orm";

import type { ApplicationDatabaseClient } from "../database/database.server";
import { rateLimitCounters } from "../database/schema.server";

export class PersistentRateLimiter {
  readonly #database: ApplicationDatabaseClient;
  readonly #now: () => Date;

  constructor(
    database: ApplicationDatabaseClient,
    now: () => Date = () => new Date(),
  ) {
    this.#database = database;
    this.#now = now;
  }

  clear(scope: string, subject: string): void {
    this.#database
      .delete(rateLimitCounters)
      .where(
        and(
          eq(rateLimitCounters.scope, scope),
          eq(rateLimitCounters.subjectHash, this.#hashSubject(scope, subject)),
        ),
      )
      .run();
  }

  consume(
    scope: string,
    subject: string,
    limit: number,
    windowMs: number,
  ): boolean {
    return this.#database.transaction((transaction) => {
      const now = this.#now();
      const nowIso = now.toISOString();
      const subjectHash = this.#hashSubject(scope, subject);

      transaction
        .delete(rateLimitCounters)
        .where(lte(rateLimitCounters.expiresAt, nowIso))
        .run();

      const current = transaction
        .select({ attempts: rateLimitCounters.attempts })
        .from(rateLimitCounters)
        .where(
          and(
            eq(rateLimitCounters.scope, scope),
            eq(rateLimitCounters.subjectHash, subjectHash),
          ),
        )
        .get();

      if (current && current.attempts >= limit) return false;

      if (current) {
        transaction
          .update(rateLimitCounters)
          .set({ attempts: current.attempts + 1 })
          .where(
            and(
              eq(rateLimitCounters.scope, scope),
              eq(rateLimitCounters.subjectHash, subjectHash),
            ),
          )
          .run();
      } else {
        transaction
          .insert(rateLimitCounters)
          .values({
            attempts: 1,
            expiresAt: new Date(now.getTime() + windowMs).toISOString(),
            scope,
            subjectHash,
            windowStartedAt: nowIso,
          })
          .run();
      }

      return true;
    });
  }

  #hashSubject(scope: string, subject: string): string {
    return createHash("sha256")
      .update(`${scope}\0${subject}`, "utf8")
      .digest("hex");
  }
}
