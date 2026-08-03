import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { schema } from "./schema.js";

export interface DatabaseConnection {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
  filePath: string;
}

export function openDatabase(dataDir: string): DatabaseConnection {
  fs.mkdirSync(dataDir, { recursive: true });
  const filePath = path.join(dataDir, "calories.sqlite");
  const sqlite = new Database(filePath);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  return { sqlite, db: drizzle(sqlite, { schema }), filePath };
}

export function closeDatabase(connection: DatabaseConnection): void {
  connection.sqlite.close();
}
