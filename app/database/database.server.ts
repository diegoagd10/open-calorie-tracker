import { mkdirSync } from "node:fs";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";

import * as schema from "./schema.server";

function createApplicationClient(sqlite: BetterSqlite3.Database) {
  return drizzle(sqlite, { schema });
}

export type ApplicationDatabaseClient = ReturnType<
  typeof createApplicationClient
>;

export type DatabaseStatus = {
  appliedMigrations: number;
  availableMigrations: number;
  busyTimeoutMs: number;
  foreignKeysEnabled: boolean;
  journalMode: string;
  migrationsCurrent: boolean;
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
    status.appliedMigrations === status.availableMigrations &&
    status.busyTimeoutMs === 5_000 &&
    status.foreignKeysEnabled &&
    status.journalMode === "wal" &&
    status.migrationsCurrent &&
    status.writable
  );
}

export type OpenApplicationDatabaseOptions = {
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
  const availableMigrations = readMigrationFiles({ migrationsFolder });

  const sqlite = new BetterSqlite3(databasePath);

  try {
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("busy_timeout = 5000");

    const client = createApplicationClient(sqlite);
    migrate(client, { migrationsFolder });

    const applicationDatabase: ApplicationDatabase = {
      close() {
        sqlite.close();
      },
      getClient() {
        return client;
      },
      getStatus() {
        const appliedMigrations = client.all<{
          createdAt: number;
          hash: string;
        }>(
          sql`SELECT hash, created_at AS createdAt
              FROM __drizzle_migrations
              ORDER BY created_at`,
        );
        const schemaVersion = client
          .select({ value: schema.applicationMetadata.value })
          .from(schema.applicationMetadata)
          .where(eq(schema.applicationMetadata.key, "schema_version"))
          .get();

        return {
          appliedMigrations: appliedMigrations.length,
          availableMigrations: availableMigrations.length,
          busyTimeoutMs: sqlite.pragma("busy_timeout", {
            simple: true,
          }) as number,
          foreignKeysEnabled:
            sqlite.pragma("foreign_keys", { simple: true }) === 1,
          journalMode: sqlite.pragma("journal_mode", {
            simple: true,
          }) as string,
          migrationsCurrent:
            appliedMigrations.length === availableMigrations.length &&
            appliedMigrations.every(
              (applied, index) =>
                applied.createdAt === availableMigrations[index]?.folderMillis &&
                applied.hash === availableMigrations[index]?.hash,
            ),
          schemaVersion: schemaVersion?.value ?? "unknown",
          writable: verifyWritableStorage(client, sqlite),
        };
      },
    };
    if (!isDatabaseReady(applicationDatabase.getStatus())) {
      throw new Error(
        "SQLite startup invariants failed after applying reviewed migrations",
      );
    }
    return applicationDatabase;
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
