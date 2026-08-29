import { createHash } from "node:crypto";

import type BetterSqlite3 from "better-sqlite3";

export class PersistentRateLimiter {
  readonly #database: BetterSqlite3.Database;
  readonly #now: () => Date;

  constructor(
    database: BetterSqlite3.Database,
    now: () => Date = () => new Date(),
  ) {
    this.#database = database;
    this.#now = now;
  }

  clear(scope: string, subject: string): void {
    this.#database
      .prepare(
        "DELETE FROM rate_limit_counters WHERE scope = ? AND subject_hash = ?",
      )
      .run(scope, this.#hashSubject(scope, subject));
  }

  consume(
    scope: string,
    subject: string,
    limit: number,
    windowMs: number,
  ): boolean {
    return this.#database.transaction(() => {
      const now = this.#now();
      const nowIso = now.toISOString();
      const subjectHash = this.#hashSubject(scope, subject);

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

      if (current && current.attempts >= limit) return false;

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

  #hashSubject(scope: string, subject: string): string {
    return createHash("sha256")
      .update(`${scope}\0${subject}`, "utf8")
      .digest("hex");
  }
}
