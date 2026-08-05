import Database from "better-sqlite3";
import type { WeightEntry } from "./domain";

function mapWeight(row: Record<string, unknown>): WeightEntry {
  return {
    date: String(row.entry_date),
    weightLb: Number(row.weight_lb),
    updatedAt: String(row.updated_at),
  };
}

export class WeightRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly userId: string,
  ) {}

  list(): WeightEntry[] {
    const rows = this.database
      .prepare(
        `SELECT entry_date, weight_lb, updated_at
         FROM weight_entries
         WHERE user_id = ?
         ORDER BY entry_date ASC`,
      )
      .all(this.userId) as Record<string, unknown>[];
    return rows.map(mapWeight);
  }

  findByDate(date: string): WeightEntry | null {
    const row = this.database
      .prepare(
        `SELECT entry_date, weight_lb, updated_at
         FROM weight_entries
         WHERE user_id = ? AND entry_date = ?`,
      )
      .get(this.userId, date) as Record<string, unknown> | undefined;
    return row ? mapWeight(row) : null;
  }

  upsert(date: string, weightLb: number): WeightEntry {
    const timestamp = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO weight_entries (user_id, entry_date, weight_lb, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, entry_date) DO UPDATE SET
           weight_lb = excluded.weight_lb,
           updated_at = excluded.updated_at`,
      )
      .run(this.userId, date, weightLb, timestamp);
    return this.findByDate(date) as WeightEntry;
  }
}
