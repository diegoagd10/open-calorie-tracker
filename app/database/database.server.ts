import { mkdirSync } from "node:fs";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "./schema.server";

function createApplicationClient(sqlite: BetterSqlite3.Database) {
  return drizzle(sqlite, { schema });
}

export type ApplicationDatabaseClient = ReturnType<
  typeof createApplicationClient
>;

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
  getClient(): ApplicationDatabaseClient;
  getStatus(): DatabaseStatus;
};

export function isDatabaseReady(status: DatabaseStatus): boolean {
  return (
    status.appliedMigrations >= 8 &&
    status.busyTimeoutMs === 5_000 &&
    status.foreignKeysEnabled &&
    status.journalMode === "wal" &&
    status.schemaVersion === "7" &&
    status.writable
  );
}

type OpenApplicationDatabaseOptions = {
  databasePath: string;
  migrationsFolder: string;
};

function verifyWritableStorage(
  client: ApplicationDatabaseClient,
  sqlite: BetterSqlite3.Database,
): boolean {
  try {
    sqlite.exec("BEGIN IMMEDIATE");
    client
      .insert(schema.applicationMetadata)
      .values({
        key: "readiness_probe",
        updatedAt: "1970-01-01T00:00:00.000Z",
        value: "ok",
      })
      .onConflictDoUpdate({
        set: {
          updatedAt: "1970-01-01T00:00:00.000Z",
          value: "ok",
        },
        target: schema.applicationMetadata.key,
      })
      .run();
    sqlite.exec("ROLLBACK");
    return true;
  } catch {
    if (sqlite.inTransaction) {
      sqlite.exec("ROLLBACK");
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

    const client = createApplicationClient(sqlite);
    migrate(client, { migrationsFolder });

    return {
      close() {
        sqlite.close();
      },
      getClient() {
        return client;
      },
      getStatus() {
        const migration = client.get<{ count: number }>(
          sql`SELECT COUNT(*) AS count FROM __drizzle_migrations`,
        );
        const schemaVersion = client
          .select({ value: schema.applicationMetadata.value })
          .from(schema.applicationMetadata)
          .where(eq(schema.applicationMetadata.key, "schema_version"))
          .get();

        return {
          appliedMigrations: migration?.count ?? 0,
          busyTimeoutMs: sqlite.pragma("busy_timeout", {
            simple: true,
          }) as number,
          foreignKeysEnabled:
            sqlite.pragma("foreign_keys", { simple: true }) === 1,
          journalMode: sqlite.pragma("journal_mode", {
            simple: true,
          }) as string,
          schemaVersion: schemaVersion?.value ?? "unknown",
          writable: verifyWritableStorage(client, sqlite),
        };
      },
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
