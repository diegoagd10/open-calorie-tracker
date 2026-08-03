import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { fileURLToPath } from "node:url";

const thisDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultMigrationsDirectory = [
  path.resolve(thisDirectory, "../../drizzle"),
  path.resolve(thisDirectory, "../../../drizzle"),
].find((directory) => fs.existsSync(directory)) || path.resolve(thisDirectory, "../../drizzle");

export function applyMigrations(sqlite: Database.Database, migrationsDirectory = defaultMigrationsDirectory): void {
  sqlite.exec("CREATE TABLE IF NOT EXISTS __calories_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const files = fs.readdirSync(migrationsDirectory)
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort();
  const applied = new Set((sqlite.prepare("SELECT id FROM __calories_migrations").all() as { id: string }[]).map((row) => row.id));
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDirectory, file), "utf8");
    const apply = sqlite.transaction(() => {
      sqlite.exec(sql);
      sqlite.prepare("INSERT INTO __calories_migrations (id, applied_at) VALUES (?, ?)").run(file, new Date().toISOString());
    });
    apply();
  }
}
