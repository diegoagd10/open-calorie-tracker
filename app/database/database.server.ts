import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";

const require = createRequire(import.meta.url);
const { drizzle } = require("drizzle-orm/better-sqlite3") as {
  drizzle(database: BetterSqlite3.Database): unknown;
};
const { migrate } = require("drizzle-orm/better-sqlite3/migrator") as {
  migrate(database: unknown, config: { migrationsFolder: string }): void;
};

export type DatabaseStatus = {
  appliedMigrations: number;
  busyTimeoutMs: number;
  foreignKeysEnabled: boolean;
  journalMode: string;
  schemaVersion: string;
  writable: boolean;
};

export type ApplicationDatabase = {
  close(): void;
  getConnection(): BetterSqlite3.Database;
  getStatus(): DatabaseStatus;
};

export function isDatabaseReady(status: DatabaseStatus): boolean {
  return (
    status.appliedMigrations >= 2 &&
    status.busyTimeoutMs === 5_000 &&
    status.foreignKeysEnabled &&
    status.journalMode === "wal" &&
    status.schemaVersion === "2" &&
    status.writable
  );
}

type OpenApplicationDatabaseOptions = {
  databasePath: string;
  migrationsFolder: string;
};

type CountRow = {
  count: number;
};

type ValueRow = {
  value: string;
};

function verifyWritableStorage(database: BetterSqlite3.Database): boolean {
  try {
    database.exec("BEGIN IMMEDIATE");
    database
      .prepare(
        `INSERT INTO application_metadata (key, value, updated_at)
         VALUES ('readiness_probe', 'ok', '1970-01-01T00:00:00.000Z')
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
      )
      .run();
    database.exec("ROLLBACK");
    return true;
  } catch {
    if (database.inTransaction) {
      database.exec("ROLLBACK");
    }
    return false;
  }
}

export function openApplicationDatabase({
  databasePath,
  migrationsFolder,
}: OpenApplicationDatabaseOptions): ApplicationDatabase {
  mkdirSync(path.dirname(databasePath), { recursive: true });

  const sqlite = new BetterSqlite3(databasePath);

  try {
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("busy_timeout = 5000");

    migrate(drizzle(sqlite), { migrationsFolder });

    return {
      close() {
        sqlite.close();
      },
      getConnection() {
        return sqlite;
      },
      getStatus() {
        const migration = sqlite
          .prepare<[], CountRow>(
            "SELECT COUNT(*) AS count FROM __drizzle_migrations",
          )
          .get();
        const schemaVersion = sqlite
          .prepare<[], ValueRow>(
            "SELECT value FROM application_metadata WHERE key = 'schema_version'",
          )
          .get();

        return {
          appliedMigrations: migration?.count ?? 0,
          busyTimeoutMs: sqlite.pragma("busy_timeout", { simple: true }) as number,
          foreignKeysEnabled:
            sqlite.pragma("foreign_keys", { simple: true }) === 1,
          journalMode: sqlite.pragma("journal_mode", { simple: true }) as string,
          schemaVersion: schemaVersion?.value ?? "unknown",
          writable: verifyWritableStorage(sqlite),
        };
      },
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
