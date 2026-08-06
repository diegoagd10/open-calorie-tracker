import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { DailyTargetVersion } from "./domain";

export type TargetVersionInput = Omit<
  DailyTargetVersion,
  "id" | "createdAt" | "updatedAt"
>;

function mapTarget(row: Record<string, unknown>): DailyTargetVersion {
  return {
    id: String(row.id),
    effectiveDate: String(row.effective_date),
    calorieMaximumCal: Number(row.calorie_maximum_cal),
    proteinMinimumG: Number(row.protein_minimum_g),
    carbsMaximumG: Number(row.carbs_maximum_g),
    fiberMaximumG: Number(row.fiber_maximum_g),
    sugarMaximumG: Number(row.sugar_maximum_g),
    sodiumMaximumMg: Number(row.sodium_maximum_mg),
    waterMinimumFlOz: Number(row.water_minimum_fl_oz),
    fatRule: row.fat_rule as "calorie-30-percent",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class TargetRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly userId: string,
  ) {}

  create(input: TargetVersionInput): DailyTargetVersion {
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    const sequence = this.database
      .prepare(
        "SELECT COALESCE(MAX(created_sequence), 0) + 1 AS next FROM daily_target_versions",
      )
      .get() as { next: number };

    this.database
      .prepare(
        `INSERT INTO daily_target_versions (
           id, user_id, effective_date, calorie_maximum_cal,
           protein_minimum_g, carbs_maximum_g, fiber_maximum_g,
           sugar_maximum_g, sodium_maximum_mg, water_minimum_fl_oz,
           fat_rule, created_sequence, created_at, updated_at
         ) VALUES (
           @id, @userId, @effectiveDate, @calorieMaximumCal,
           @proteinMinimumG, @carbsMaximumG, @fiberMaximumG,
           @sugarMaximumG, @sodiumMaximumMg, @waterMinimumFlOz,
           @fatRule, @createdSequence, @timestamp, @timestamp
         )`,
      )
      .run({
        id,
        userId: this.userId,
        effectiveDate: input.effectiveDate,
        calorieMaximumCal: input.calorieMaximumCal,
        proteinMinimumG: input.proteinMinimumG,
        carbsMaximumG: input.carbsMaximumG,
        fiberMaximumG: input.fiberMaximumG,
        sugarMaximumG: input.sugarMaximumG,
        sodiumMaximumMg: input.sodiumMaximumMg,
        waterMinimumFlOz: input.waterMinimumFlOz,
        fatRule: input.fatRule,
        createdSequence: sequence.next,
        timestamp,
      });

    return this.findById(id) as DailyTargetVersion;
  }

  findById(id: string): DailyTargetVersion | null {
    const row = this.database
      .prepare(
        `SELECT id, effective_date, calorie_maximum_cal, protein_minimum_g,
                carbs_maximum_g, fiber_maximum_g, sugar_maximum_g,
                sodium_maximum_mg, water_minimum_fl_oz, fat_rule,
                created_at, updated_at
         FROM daily_target_versions
         WHERE id = ? AND user_id = ?`,
      )
      .get(id, this.userId) as Record<string, unknown> | undefined;
    return row ? mapTarget(row) : null;
  }

  list(): DailyTargetVersion[] {
    const rows = this.database
      .prepare(
        `SELECT id, effective_date, calorie_maximum_cal, protein_minimum_g,
                carbs_maximum_g, fiber_maximum_g, sugar_maximum_g,
                sodium_maximum_mg, water_minimum_fl_oz, fat_rule,
                created_at, updated_at
         FROM daily_target_versions
         WHERE user_id = ?
         ORDER BY effective_date ASC, created_sequence ASC`,
      )
      .all(this.userId) as Record<string, unknown>[];
    return rows.map(mapTarget);
  }

  findEffective(date: string): DailyTargetVersion | null {
    const row = this.database
      .prepare(
        `SELECT id, effective_date, calorie_maximum_cal, protein_minimum_g,
                carbs_maximum_g, fiber_maximum_g, sugar_maximum_g,
                sodium_maximum_mg, water_minimum_fl_oz, fat_rule,
                created_at, updated_at
         FROM daily_target_versions
         WHERE user_id = ? AND effective_date <= ?
         ORDER BY effective_date DESC, created_sequence DESC
         LIMIT 1`,
      )
      .get(this.userId, date) as Record<string, unknown> | undefined;
    return row ? mapTarget(row) : null;
  }

  hasAny(): boolean {
    const row = this.database
      .prepare("SELECT 1 AS found FROM daily_target_versions WHERE user_id = ? LIMIT 1")
      .get(this.userId) as { found: number } | undefined;
    return Boolean(row);
  }
}
