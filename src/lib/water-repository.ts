import Database from "better-sqlite3";
import type { WaterDay } from "./domain";

export class WaterRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly userId: string,
  ) {}

  get(date: string): WaterDay {
    const row = this.database
      .prepare(
        `SELECT entry_date, total_fluid_oz, updated_at
         FROM water_days
         WHERE user_id = ? AND entry_date = ?`,
      )
      .get(this.userId, date) as Record<string, unknown> | undefined;

    return {
      date,
      totalFluidOz: row ? Number(row.total_fluid_oz) : 0,
      updatedAt: row ? String(row.updated_at) : "",
    };
  }

  add(date: string, amount: number): WaterDay {
    const timestamp = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO water_days (user_id, entry_date, total_fluid_oz, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, entry_date) DO UPDATE SET
           total_fluid_oz = water_days.total_fluid_oz + excluded.total_fluid_oz,
           updated_at = excluded.updated_at`,
      )
      .run(this.userId, date, amount, timestamp);
    return this.get(date);
  }

  set(date: string, totalFluidOz: number): WaterDay {
    const timestamp = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO water_days (user_id, entry_date, total_fluid_oz, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, entry_date) DO UPDATE SET
           total_fluid_oz = excluded.total_fluid_oz,
           updated_at = excluded.updated_at`,
      )
      .run(this.userId, date, totalFluidOz, timestamp);
    return this.get(date);
  }
}
