import Database from "better-sqlite3";
import type { UserSettings } from "./domain";

export class SettingsRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly userId: string,
  ) {}

  get(): UserSettings | null {
    const row = this.database
      .prepare(
        `SELECT target_weight_lb, updated_at
         FROM user_settings
         WHERE user_id = ?`,
      )
      .get(this.userId) as Record<string, unknown> | undefined;

    if (!row) return null;
    return {
      targetWeightLb:
        row.target_weight_lb === null ? null : Number(row.target_weight_lb),
      updatedAt: String(row.updated_at),
    };
  }

  setTargetWeight(targetWeightLb: number | null): UserSettings {
    const timestamp = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO user_settings (user_id, target_weight_lb, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET
           target_weight_lb = excluded.target_weight_lb,
           updated_at = excluded.updated_at`,
      )
      .run(this.userId, targetWeightLb, timestamp);
    return this.get() as UserSettings;
  }
}
