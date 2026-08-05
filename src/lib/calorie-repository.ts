import Database from "better-sqlite3";
import type { CalorieEntryInput } from "./calories";

export type CalorieEntry = CalorieEntryInput & {
  id: number;
  createdAt: string;
};

export class CalorieRepository {
  private readonly database: Database.Database;

  constructor(path: string) {
    this.database = new Database(path);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS calorie_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        calories INTEGER NOT NULL CHECK (calories > 0),
        entry_date TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  add(input: CalorieEntryInput): CalorieEntry {
    const result = this.database
      .prepare(
        `INSERT INTO calorie_entries (name, calories, entry_date)
         VALUES (@name, @calories, @date)`,
      )
      .run(input);

    return this.database
      .prepare(
        `SELECT id, name, calories, entry_date AS date, created_at AS createdAt
         FROM calorie_entries
         WHERE id = ?`,
      )
      .get(result.lastInsertRowid) as CalorieEntry;
  }

  listByDate(date: string): CalorieEntry[] {
    return this.database
      .prepare(
        `SELECT id, name, calories, entry_date AS date, created_at AS createdAt
         FROM calorie_entries
         WHERE entry_date = ?
         ORDER BY id DESC`,
      )
      .all(date) as CalorieEntry[];
  }

  close() {
    this.database.close();
  }
}
