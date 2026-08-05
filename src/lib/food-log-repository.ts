import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { FoodLogEntry, FoodLogSnapshot } from "./domain";

function mapFoodLogEntry(row: Record<string, unknown>): FoodLogEntry {
  return {
    id: String(row.id),
    date: String(row.entry_date),
    productId: row.product_id ? String(row.product_id) : null,
    titleSnapshot: String(row.title_snapshot),
    servingDescriptionSnapshot: String(row.serving_description_snapshot),
    quantity: Number(row.quantity),
    caloriesPerServingCal: Number(row.calories_per_serving_cal),
    proteinPerServingG: Number(row.protein_per_serving_g),
    carbsPerServingG: Number(row.carbs_per_serving_g),
    fatPerServingG: Number(row.fat_per_serving_g),
    fiberPerServingG: Number(row.fiber_per_serving_g),
    sugarPerServingG: Number(row.sugar_per_serving_g),
    sodiumPerServingMg: Number(row.sodium_per_serving_mg),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const selectColumns = `
  SELECT
    id, entry_date, product_id, title_snapshot,
    serving_description_snapshot, quantity, calories_per_serving_cal,
    protein_per_serving_g, carbs_per_serving_g, fat_per_serving_g,
    fiber_per_serving_g, sugar_per_serving_g, sodium_per_serving_mg,
    created_at, updated_at
  FROM food_log_entries
`;

export type FoodLogCreateRecord = FoodLogSnapshot & {
  date: string;
  productId: string | null;
};

export class FoodLogRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly userId: string,
  ) {}

  create(record: FoodLogCreateRecord): FoodLogEntry {
    const id = randomUUID();
    const timestamp = new Date().toISOString();

    this.database
      .prepare(
        `INSERT INTO food_log_entries (
           id, user_id, entry_date, product_id, title_snapshot,
           serving_description_snapshot, quantity,
           calories_per_serving_cal, protein_per_serving_g,
           carbs_per_serving_g, fat_per_serving_g, fiber_per_serving_g,
           sugar_per_serving_g, sodium_per_serving_mg, created_at, updated_at
         ) VALUES (
           @id, @userId, @date, @productId, @titleSnapshot,
           @servingDescriptionSnapshot, @quantity,
           @caloriesPerServingCal, @proteinPerServingG,
           @carbsPerServingG, @fatPerServingG, @fiberPerServingG,
           @sugarPerServingG, @sodiumPerServingMg, @timestamp, @timestamp
         )`,
      )
      .run({
        id,
        userId: this.userId,
        date: record.date,
        productId: record.productId,
        titleSnapshot: record.titleSnapshot,
        servingDescriptionSnapshot: record.servingDescriptionSnapshot,
        quantity: record.quantity,
        caloriesPerServingCal: record.caloriesPerServingCal,
        proteinPerServingG: record.proteinPerServingG,
        carbsPerServingG: record.carbsPerServingG,
        fatPerServingG: record.fatPerServingG,
        fiberPerServingG: record.fiberPerServingG,
        sugarPerServingG: record.sugarPerServingG,
        sodiumPerServingMg: record.sodiumPerServingMg,
        timestamp,
      });

    return this.findById(id) as FoodLogEntry;
  }

  listByDate(date: string): FoodLogEntry[] {
    const rows = this.database
      .prepare(
        `${selectColumns}
         WHERE user_id = ? AND entry_date = ?
         ORDER BY created_at DESC, id DESC`,
      )
      .all(this.userId, date) as Record<string, unknown>[];
    return rows.map(mapFoodLogEntry);
  }

  findById(id: string): FoodLogEntry | null {
    const row = this.database
      .prepare(`${selectColumns} WHERE id = ? AND user_id = ?`)
      .get(id, this.userId) as Record<string, unknown> | undefined;
    return row ? mapFoodLogEntry(row) : null;
  }

  updateSnapshot(id: string, snapshot: FoodLogSnapshot): FoodLogEntry | null {
    const timestamp = new Date().toISOString();
    const result = this.database
      .prepare(
        `UPDATE food_log_entries
         SET title_snapshot = @titleSnapshot,
             serving_description_snapshot = @servingDescriptionSnapshot,
             quantity = @quantity,
             calories_per_serving_cal = @caloriesPerServingCal,
             protein_per_serving_g = @proteinPerServingG,
             carbs_per_serving_g = @carbsPerServingG,
             fat_per_serving_g = @fatPerServingG,
             fiber_per_serving_g = @fiberPerServingG,
             sugar_per_serving_g = @sugarPerServingG,
             sodium_per_serving_mg = @sodiumPerServingMg,
             updated_at = @timestamp
         WHERE id = @id AND user_id = @userId`,
      )
      .run({
        id,
        userId: this.userId,
        titleSnapshot: snapshot.titleSnapshot,
        servingDescriptionSnapshot: snapshot.servingDescriptionSnapshot,
        quantity: snapshot.quantity,
        caloriesPerServingCal: snapshot.caloriesPerServingCal,
        proteinPerServingG: snapshot.proteinPerServingG,
        carbsPerServingG: snapshot.carbsPerServingG,
        fatPerServingG: snapshot.fatPerServingG,
        fiberPerServingG: snapshot.fiberPerServingG,
        sugarPerServingG: snapshot.sugarPerServingG,
        sodiumPerServingMg: snapshot.sodiumPerServingMg,
        timestamp,
      });

    return result.changes === 0 ? null : this.findById(id);
  }

  delete(id: string): boolean {
    const result = this.database
      .prepare("DELETE FROM food_log_entries WHERE id = ? AND user_id = ?")
      .run(id, this.userId);
    return result.changes > 0;
  }
}
