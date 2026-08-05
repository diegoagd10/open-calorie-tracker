import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { FoodProduct, ProductDraft } from "./domain";

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase("en-US");
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function mapProduct(row: Record<string, unknown>): FoodProduct {
  return {
    id: String(row.id),
    name: String(row.name),
    nameNormalized: String(row.name_normalized),
    measurementType: row.measurement_type as "serving",
    servingDescription: String(row.serving_description),
    caloriesPerServingCal: Number(row.calories_per_serving_cal),
    proteinPerServingG: Number(row.protein_per_serving_g),
    carbsPerServingG: Number(row.carbs_per_serving_g),
    fatPerServingG: Number(row.fat_per_serving_g),
    fiberPerServingG: Number(row.fiber_per_serving_g),
    sugarPerServingG: Number(row.sugar_per_serving_g),
    sodiumPerServingMg: Number(row.sodium_per_serving_mg),
    status: row.status as FoodProduct["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const selectColumns = `
  SELECT
    id, name, name_normalized, measurement_type, serving_description,
    calories_per_serving_cal, protein_per_serving_g, carbs_per_serving_g,
    fat_per_serving_g, fiber_per_serving_g, sugar_per_serving_g,
    sodium_per_serving_mg, status, created_at, updated_at
  FROM products
`;

export class ProductRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly userId: string,
  ) {}

  create(draft: ProductDraft): FoodProduct {
    const id = randomUUID();
    const timestamp = new Date().toISOString();

    this.database
      .prepare(
        `INSERT INTO products (
           id, user_id, name, name_normalized, measurement_type,
           serving_description, calories_per_serving_cal,
           protein_per_serving_g, carbs_per_serving_g, fat_per_serving_g,
           fiber_per_serving_g, sugar_per_serving_g, sodium_per_serving_mg,
           status, created_at, updated_at
         ) VALUES (
           @id, @userId, @name, @nameNormalized, @measurementType,
           @servingDescription, @caloriesPerServingCal,
           @proteinPerServingG, @carbsPerServingG, @fatPerServingG,
           @fiberPerServingG, @sugarPerServingG, @sodiumPerServingMg,
           'active', @timestamp, @timestamp
         )`,
      )
      .run({
        id,
        userId: this.userId,
        name: draft.name,
        nameNormalized: normalizeName(draft.name),
        measurementType: draft.measurementType,
        servingDescription: draft.servingDescription,
        caloriesPerServingCal: draft.caloriesPerServingCal,
        proteinPerServingG: draft.proteinPerServingG,
        carbsPerServingG: draft.carbsPerServingG,
        fatPerServingG: draft.fatPerServingG,
        fiberPerServingG: draft.fiberPerServingG,
        sugarPerServingG: draft.sugarPerServingG,
        sodiumPerServingMg: draft.sodiumPerServingMg,
        timestamp,
      });

    return this.findById(id) as FoodProduct;
  }

  listActive(query = ""): FoodProduct[] {
    const normalizedQuery = normalizeName(query);
    const rows = this.database
      .prepare(
        `${selectColumns}
         WHERE user_id = @userId
           AND status = 'active'
           AND name_normalized LIKE @query ESCAPE '\\'
         ORDER BY name_normalized ASC, id ASC
         LIMIT 100`,
      )
      .all({
        userId: this.userId,
        query: `%${escapeLike(normalizedQuery)}%`,
      }) as Record<string, unknown>[];

    return rows.map(mapProduct);
  }

  findById(id: string): FoodProduct | null {
    const row = this.database
      .prepare(`${selectColumns} WHERE id = ? AND user_id = ?`)
      .get(id, this.userId) as Record<string, unknown> | undefined;
    return row ? mapProduct(row) : null;
  }

  update(id: string, draft: ProductDraft): FoodProduct | null {
    const timestamp = new Date().toISOString();
    const result = this.database
      .prepare(
        `UPDATE products
         SET name = @name,
             name_normalized = @nameNormalized,
             measurement_type = @measurementType,
             serving_description = @servingDescription,
             calories_per_serving_cal = @caloriesPerServingCal,
             protein_per_serving_g = @proteinPerServingG,
             carbs_per_serving_g = @carbsPerServingG,
             fat_per_serving_g = @fatPerServingG,
             fiber_per_serving_g = @fiberPerServingG,
             sugar_per_serving_g = @sugarPerServingG,
             sodium_per_serving_mg = @sodiumPerServingMg,
             updated_at = @timestamp
         WHERE id = @id AND user_id = @userId AND status = 'active'`,
      )
      .run({
        id,
        userId: this.userId,
        name: draft.name,
        nameNormalized: normalizeName(draft.name),
        measurementType: draft.measurementType,
        servingDescription: draft.servingDescription,
        caloriesPerServingCal: draft.caloriesPerServingCal,
        proteinPerServingG: draft.proteinPerServingG,
        carbsPerServingG: draft.carbsPerServingG,
        fatPerServingG: draft.fatPerServingG,
        fiberPerServingG: draft.fiberPerServingG,
        sugarPerServingG: draft.sugarPerServingG,
        sodiumPerServingMg: draft.sodiumPerServingMg,
        timestamp,
      });

    return result.changes === 0 ? null : this.findById(id);
  }

  retire(id: string): boolean {
    const result = this.database
      .prepare(
        `UPDATE products
         SET status = 'retired', updated_at = ?
         WHERE id = ? AND user_id = ? AND status = 'active'`,
      )
      .run(new Date().toISOString(), id, this.userId);
    return result.changes > 0;
  }
}
