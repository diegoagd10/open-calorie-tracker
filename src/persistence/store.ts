import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../db/client.js";
import {
  addNutrition,
  formatNutritionValue,
  normalizeNutrition,
  NUTRIENT_DEFINITIONS,
  parseQuantity,
  scaleNutrition,
  type FoodProfile,
  type MealTag,
  type NutrientKey,
  type NutrientReferences,
  type NutrientValues,
  type NutritionProfile,
  type Quantity,
} from "../domain/nutrition.js";
import { isValidTimezone } from "../config.js";

const nutrientColumns = [
  "calories",
  "protein",
  "carbohydrates",
  "fat",
  "fiber",
  "added_sugar",
  "sugar",
  "saturated_fat",
  "sodium",
] as const;

type NutrientColumn = (typeof nutrientColumns)[number];

export interface FoodRecord extends FoodProfile {
  id: number;
  source: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MealIngredientRecord {
  id: number;
  foodId: number | null;
  name: string;
  quantity: Quantity;
  basisQuantity: number;
  nutrients: NutrientValues;
}

export interface MealRecord {
  id: number;
  name: string;
  description: string | null;
  favorite: boolean;
  ingredients: MealIngredientRecord[];
  nutrients: NutrientValues;
  missingNutrients: NutrientKey[];
  createdAt: string;
  updatedAt: string;
}

export interface EntryRecord {
  id: number;
  foodId: number | null;
  mealId: number | null;
  title: string;
  loggedAtUtc: string;
  localDate?: string;
  localTime?: string;
  mealTag: MealTag | null;
  quantity: Quantity;
  quantityBasis: string;
  baseQuantity: number;
  snapshot: NutrientValues;
  baseNutrition: NutrientValues;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFoodInput {
  name: string;
  brand?: string | null;
  description?: string | null;
  source?: string;
  quantityBasis: string;
  basisQuantity?: string | number;
  nutrients: NutritionProfile;
}

export interface EntryInput {
  foodId?: number;
  mealId?: number;
  profile?: FoodProfile;
  quantity: string | number;
  loggedAtUtc: string;
  mealTag?: MealTag | null;
}

export interface EntryUpdate {
  quantity?: string | number;
  loggedAtUtc?: string;
  mealTag?: MealTag | null;
  title?: string;
  profile?: FoodProfile;
}

export interface TargetRecord {
  id: number;
  kind: string;
  plan: string | null;
  calories: number | null;
  references: NutrientReferences;
  metadata: Record<string, unknown> | null;
  active: boolean;
}

export interface ImageRecord {
  id: number;
  managedName: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  foodId: number | null;
  mealId: number | null;
  createdAt: string;
}

function now(): string {
  return new Date().toISOString();
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined || value === "" ? null : Number(value);
}

function rowNutrition(row: Record<string, unknown>, prefix = ""): NutrientValues {
  return {
    calories: Number(row[`${prefix}calories`]),
    protein: nullableNumber(row[`${prefix}protein`]),
    carbohydrates: nullableNumber(row[`${prefix}carbohydrates`]),
    fat: nullableNumber(row[`${prefix}fat`]),
    fiber: nullableNumber(row[`${prefix}fiber`]),
    addedSugar: nullableNumber(row[`${prefix}added_sugar`]),
    sugar: nullableNumber(row[`${prefix}sugar`]),
    saturatedFat: nullableNumber(row[`${prefix}saturated_fat`]),
    sodium: nullableNumber(row[`${prefix}sodium`]),
  };
}

function nutritionAsProfile(nutrients: NutrientValues): NutritionProfile {
  if (nutrients.calories === null) throw new Error("Stored nutrition is missing required calories.");
  return { ...nutrients, calories: nutrients.calories };
}

function scaleProfile(profile: FoodProfile, quantity: number): NutrientValues {
  const basisQuantity = profile.basisQuantity ?? 1;
  if (!Number.isFinite(basisQuantity) || basisQuantity <= 0) throw new Error("Declared basis quantity must be greater than zero.");
  return scaleNutrition(profile.nutrients, quantity / basisQuantity);
}

function nutritionParams(nutrients: NutrientValues): Record<NutrientColumn, number | null> {
  return {
    calories: nutrients.calories,
    protein: nutrients.protein,
    carbohydrates: nutrients.carbohydrates,
    fat: nutrients.fat,
    fiber: nutrients.fiber,
    added_sugar: nutrients.addedSugar,
    sugar: nutrients.sugar,
    saturated_fat: nutrients.saturatedFat,
    sodium: nutrients.sodium,
  };
}

function jsonObject(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function validateTag(tag: MealTag | null | undefined): MealTag | null {
  if (tag === null || tag === undefined) return null;
  if (!["Breakfast", "Lunch", "Dinner", "Snack"].includes(tag)) throw new Error("Invalid meal tag.");
  return tag;
}

function localDateTime(utc: string, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utc));
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

export function utcFromLocal(date: string, time: string, timezone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error("Enter a valid local date and time.");
  const desired = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), Number(time.slice(0, 2)), Number(time.slice(3, 5)));
  let guess = desired;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = localDateTime(new Date(guess).toISOString(), timezone);
    const actualUtc = Date.UTC(Number(actual.date.slice(0, 4)), Number(actual.date.slice(5, 7)) - 1, Number(actual.date.slice(8, 10)), Number(actual.time.slice(0, 2)), Number(actual.time.slice(3, 5)));
    guess += desired - actualUtc;
  }
  return new Date(guess).toISOString();
}

function foodProfileFromRow(row: Record<string, unknown>, favorite = false): FoodRecord {
  return {
    id: Number(row.id),
    name: String(row.name),
    brand: row.brand === null ? null : String(row.brand ?? ""),
    description: row.description === null ? null : String(row.description ?? ""),
    quantityBasis: String(row.quantity_basis),
    basisQuantity: Number(row.basis_quantity),
    nutrients: nutritionAsProfile(rowNutrition(row)),
    source: String(row.source),
    favorite,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class Store {
  readonly sqlite: DatabaseConnection["sqlite"];

  constructor(private readonly connection: DatabaseConnection) {
    this.sqlite = connection.sqlite;
  }

  ensureUser(initialTimezone: string): { id: number; timezone: string } {
    const existing = this.sqlite.prepare("SELECT id, timezone FROM users ORDER BY id LIMIT 1").get() as { id: number; timezone: string } | undefined;
    if (existing) return existing;
    if (!isValidTimezone(initialTimezone)) throw new Error("Invalid timezone.");
    const timestamp = now();
    const result = this.sqlite.prepare("INSERT INTO users (timezone, created_at, updated_at) VALUES (?, ?, ?)").run(initialTimezone, timestamp, timestamp);
    return { id: Number(result.lastInsertRowid), timezone: initialTimezone };
  }

  getUser(): { id: number; timezone: string } | null {
    return (this.sqlite.prepare("SELECT id, timezone FROM users ORDER BY id LIMIT 1").get() as { id: number; timezone: string } | undefined) ?? null;
  }

  getTimezone(fallback = "UTC"): string {
    return this.getUser()?.timezone ?? fallback;
  }

  updateTimezone(timezone: string): void {
    if (!isValidTimezone(timezone)) throw new Error("Invalid timezone.");
    const user = this.ensureUser(timezone);
    this.sqlite.prepare("UPDATE users SET timezone = ?, updated_at = ? WHERE id = ?").run(timezone, now(), user.id);
  }

  createFood(input: CreateFoodInput): FoodRecord {
    const name = input.name.trim();
    const quantityBasis = input.quantityBasis.trim();
    if (!name) throw new Error("Food name is required.");
    if (!quantityBasis) throw new Error("A declared quantity basis is required.");
    const basisQuantity = parseQuantity(input.basisQuantity ?? 1, quantityBasis).value;
    const nutrients = normalizeNutrition(input.nutrients);
    const timestamp = now();
    const values = nutritionParams(nutrients);
    const result = this.sqlite.prepare(`
      INSERT INTO foods (name, brand, description, source, quantity_basis, basis_quantity, ${nutrientColumns.join(", ")}, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ${nutrientColumns.map(() => "?").join(", ")}, ?, ?)
    `).run(name, input.brand?.trim() || null, input.description?.trim() || null, input.source || "manual", quantityBasis, basisQuantity, ...nutrientColumns.map((column) => values[column]), timestamp, timestamp);
    return this.getFood(Number(result.lastInsertRowid)) as FoodRecord;
  }

  getFood(id: number): FoodRecord | null {
    const row = this.sqlite.prepare(`
      SELECT foods.*, EXISTS(SELECT 1 FROM favorites WHERE favorites.food_id = foods.id) AS is_favorite
      FROM foods WHERE foods.id = ?
    `).get(id) as (Record<string, unknown> & { is_favorite: number }) | undefined;
    return row ? foodProfileFromRow(row, Boolean(row.is_favorite)) : null;
  }

  listFoods(options: { search?: string; filter?: "all" | "favorites" | "foods" } = {}): FoodRecord[] {
    const conditions = ["1 = 1"];
    const params: unknown[] = [];
    if (options.search?.trim()) {
      conditions.push("(lower(foods.name) LIKE ? OR lower(COALESCE(foods.brand, '')) LIKE ?)");
      const query = `%${options.search.trim().toLowerCase()}%`;
      params.push(query, query);
    }
    if (options.filter === "favorites") conditions.push("EXISTS(SELECT 1 FROM favorites WHERE favorites.food_id = foods.id)");
    const rows = this.sqlite.prepare(`
      SELECT foods.*, EXISTS(SELECT 1 FROM favorites WHERE favorites.food_id = foods.id) AS is_favorite
      FROM foods WHERE ${conditions.join(" AND ")} ORDER BY foods.name COLLATE NOCASE
    `).all(...params) as (Record<string, unknown> & { is_favorite: number })[];
    return rows
      .filter((row) => options.filter !== "foods" || row.source !== "meal")
      .map((row) => foodProfileFromRow(row, Boolean(row.is_favorite)));
  }

  listRecentFoods(limit = 8): FoodRecord[] {
    const rows = this.sqlite.prepare(`
      SELECT foods.*, EXISTS(SELECT 1 FROM favorites WHERE favorites.food_id = foods.id) AS is_favorite,
        MAX(food_entries.logged_at_utc) AS last_logged
      FROM foods JOIN food_entries ON food_entries.food_id = foods.id
      GROUP BY foods.id ORDER BY last_logged DESC LIMIT ?
    `).all(limit) as (Record<string, unknown> & { is_favorite: number })[];
    return rows.map((row) => foodProfileFromRow(row, Boolean(row.is_favorite)));
  }

  updateFood(id: number, input: CreateFoodInput): FoodRecord {
    if (!this.getFood(id)) throw new Error("Food not found.");
    const nutrients = normalizeNutrition(input.nutrients);
    const basisQuantity = parseQuantity(input.basisQuantity ?? 1, input.quantityBasis).value;
    const values = nutritionParams(nutrients);
    this.sqlite.prepare(`
      UPDATE foods SET name = ?, brand = ?, description = ?, quantity_basis = ?, basis_quantity = ?, ${nutrientColumns.map((column) => `${column} = ?`).join(", ")}, updated_at = ? WHERE id = ?
    `).run(input.name.trim(), input.brand?.trim() || null, input.description?.trim() || null, input.quantityBasis.trim(), basisQuantity, ...nutrientColumns.map((column) => values[column]), now(), id);
    return this.getFood(id) as FoodRecord;
  }

  deleteFood(id: number): void {
    this.sqlite.prepare("DELETE FROM foods WHERE id = ?").run(id);
  }

  favoriteFood(id: number): FoodRecord {
    const food = this.getFood(id);
    if (!food) throw new Error("Food not found.");
    const timestamp = now();
    const result = this.sqlite.prepare(`
      INSERT INTO foods (name, brand, description, source, quantity_basis, basis_quantity, ${nutrientColumns.join(", ")}, created_at, updated_at)
      SELECT name, brand, description, 'favorite', quantity_basis, basis_quantity, ${nutrientColumns.join(", ")}, ?, ? FROM foods WHERE id = ?
    `).run(timestamp, timestamp, id);
    const copyId = Number(result.lastInsertRowid);
    this.sqlite.prepare("INSERT INTO favorites (food_id, created_at) VALUES (?, ?)").run(copyId, timestamp);
    return this.getFood(copyId) as FoodRecord;
  }

  unfavoriteFood(id: number): void {
    this.sqlite.prepare("DELETE FROM favorites WHERE food_id = ?").run(id);
  }

  saveEntryAsFavorite(entryId: number): FoodRecord {
    const entry = this.getEntry(entryId);
    if (!entry) throw new Error("Food entry not found.");
    const food = this.createFood({
      name: entry.title,
      source: "entry-favorite",
      quantityBasis: `${entry.quantity.display} ${entry.quantity.unit}`,
      basisQuantity: 1,
      nutrients: nutritionAsProfile(entry.snapshot),
    });
    this.sqlite.prepare("INSERT INTO favorites (food_id, created_at) VALUES (?, ?)").run(food.id, now());
    return this.getFood(food.id) as FoodRecord;
  }

  createMeal(name: string, description?: string | null): MealRecord {
    if (!name.trim()) throw new Error("Meal name is required.");
    const timestamp = now();
    const result = this.sqlite.prepare("INSERT INTO meals (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)").run(name.trim(), description?.trim() || null, timestamp, timestamp);
    return this.getMeal(Number(result.lastInsertRowid)) as MealRecord;
  }

  getMeal(id: number): MealRecord | null {
    const mealRow = this.sqlite.prepare(`
      SELECT meals.*, EXISTS(SELECT 1 FROM favorites WHERE favorites.meal_id = meals.id) AS is_favorite
      FROM meals WHERE meals.id = ?
    `).get(id) as (Record<string, unknown> & { is_favorite: number }) | undefined;
    if (!mealRow) return null;
    const rows = this.sqlite.prepare("SELECT * FROM meal_ingredients WHERE meal_id = ? ORDER BY id").all(id) as Record<string, unknown>[];
    const ingredients = rows.map((row) => ({
      id: Number(row.id),
      foodId: row.food_id === null ? null : Number(row.food_id),
      name: String(row.name),
      quantity: { value: Number(row.quantity_value), display: String(row.quantity_display), unit: String(row.quantity_unit) },
      basisQuantity: Number((JSON.parse(String(row.snapshot_json)) as { basisQuantity?: number }).basisQuantity ?? 1),
      nutrients: ((JSON.parse(String(row.snapshot_json)) as { nutrients?: NutrientValues }).nutrients ?? JSON.parse(String(row.snapshot_json))) as NutrientValues,
    }));
    const scaled = ingredients.map((ingredient) => scaleNutrition(nutritionAsProfile(ingredient.nutrients), ingredient.quantity.value / ingredient.basisQuantity));
    const missingNutrients = NUTRIENT_DEFINITIONS.filter(({ key }) => ingredients.some((ingredient) => ingredient.nutrients[key] === null)).map(({ key }) => key);
    return {
      id: Number(mealRow.id),
      name: String(mealRow.name),
      description: mealRow.description === null ? null : String(mealRow.description),
      favorite: Boolean(mealRow.is_favorite),
      ingredients,
      nutrients: addNutrition(scaled),
      missingNutrients,
      createdAt: String(mealRow.created_at),
      updatedAt: String(mealRow.updated_at),
    };
  }

  listMeals(options: { search?: string; favoritesOnly?: boolean } = {}): MealRecord[] {
    const conditions = ["1 = 1"];
    const params: unknown[] = [];
    if (options.search?.trim()) {
      conditions.push("lower(meals.name) LIKE ?");
      params.push(`%${options.search.trim().toLowerCase()}%`);
    }
    if (options.favoritesOnly) conditions.push("EXISTS(SELECT 1 FROM favorites WHERE favorites.meal_id = meals.id)");
    const rows = this.sqlite.prepare(`SELECT meals.id FROM meals WHERE ${conditions.join(" AND ")} ORDER BY meals.name COLLATE NOCASE`).all(...params) as { id: number }[];
    return rows.map((row) => this.getMeal(row.id) as MealRecord);
  }

  addMealIngredient(mealId: number, foodId: number, quantityInput: string | number, unit?: string): MealRecord {
    const meal = this.getMeal(mealId);
    const food = this.getFood(foodId);
    if (!meal || !food) throw new Error("Meal or Food not found.");
    const quantity = parseQuantity(quantityInput, unit || food.quantityBasis);
    const timestamp = now();
    this.sqlite.prepare(`
      INSERT INTO meal_ingredients (meal_id, food_id, name, quantity_value, quantity_display, quantity_unit, snapshot_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(mealId, foodId, food.name, quantity.value, quantity.display, quantity.unit, JSON.stringify({ nutrients: food.nutrients, basisQuantity: food.basisQuantity ?? 1 }), timestamp, timestamp);
    return this.getMeal(mealId) as MealRecord;
  }

  updateMealIngredient(ingredientId: number, quantityInput: string | number, unit?: string): MealRecord {
    const row = this.sqlite.prepare("SELECT * FROM meal_ingredients WHERE id = ?").get(ingredientId) as Record<string, unknown> | undefined;
    if (!row) throw new Error("Meal ingredient not found.");
    const quantity = parseQuantity(quantityInput, unit || String(row.quantity_unit));
    this.sqlite.prepare("UPDATE meal_ingredients SET quantity_value = ?, quantity_display = ?, quantity_unit = ?, updated_at = ? WHERE id = ?").run(quantity.value, quantity.display, quantity.unit, now(), ingredientId);
    return this.getMeal(Number(row.meal_id)) as MealRecord;
  }

  replaceMealIngredient(ingredientId: number, foodId: number, quantityInput: string | number, unit?: string): MealRecord {
    const row = this.sqlite.prepare("SELECT * FROM meal_ingredients WHERE id = ?").get(ingredientId) as Record<string, unknown> | undefined;
    const food = this.getFood(foodId);
    if (!row || !food) throw new Error("Meal ingredient or Food not found.");
    const quantity = parseQuantity(quantityInput, unit || food.quantityBasis);
    this.sqlite.prepare("UPDATE meal_ingredients SET food_id = ?, name = ?, quantity_value = ?, quantity_display = ?, quantity_unit = ?, snapshot_json = ?, updated_at = ? WHERE id = ?").run(food.id, food.name, quantity.value, quantity.display, quantity.unit, JSON.stringify({ nutrients: food.nutrients, basisQuantity: food.basisQuantity ?? 1 }), now(), ingredientId);
    return this.getMeal(Number(row.meal_id)) as MealRecord;
  }

  removeMealIngredient(ingredientId: number): void {
    this.sqlite.prepare("DELETE FROM meal_ingredients WHERE id = ?").run(ingredientId);
  }

  deleteMeal(id: number): void {
    this.sqlite.prepare("DELETE FROM meals WHERE id = ?").run(id);
  }

  favoriteMeal(id: number): void {
    if (!this.getMeal(id)) throw new Error("Meal not found.");
    this.sqlite.prepare("INSERT OR IGNORE INTO favorites (meal_id, created_at) VALUES (?, ?)").run(id, now());
  }

  unfavoriteMeal(id: number): void {
    this.sqlite.prepare("DELETE FROM favorites WHERE meal_id = ?").run(id);
  }

  private entryRecordFromRow(row: Record<string, unknown>, timezone?: string): EntryRecord {
      const parsed = jsonObject(String(row.snapshot_json)) ?? {};
      const baseNutrition = (parsed.base as NutrientValues | undefined) ?? rowNutrition(row);
    const baseQuantity = Number(parsed.baseQuantity ?? 1);
    const snapshot = rowNutrition(row);
    const quantity = { value: Number(row.quantity_value), display: String(row.quantity_display), unit: String(row.quantity_unit) };
    const local = timezone ? localDateTime(String(row.logged_at_utc), timezone) : undefined;
    return {
      id: Number(row.id),
      foodId: row.food_id === null ? null : Number(row.food_id),
      mealId: row.meal_id === null ? null : Number(row.meal_id),
      title: String(row.title),
      loggedAtUtc: String(row.logged_at_utc),
      localDate: local?.date,
      localTime: local?.time,
      mealTag: (row.meal_tag as MealTag | null) ?? null,
      quantity,
      quantityBasis: String(row.quantity_basis),
      baseQuantity,
      snapshot,
      baseNutrition,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private insertEntry(input: EntryInput, profile: FoodProfile, title: string, sourceId: { foodId?: number; mealId?: number }): EntryRecord {
    const quantity = parseQuantity(input.quantity, profile.quantityBasis);
    const baseNutrition = normalizeNutrition(profile.nutrients);
    const baseQuantity = profile.basisQuantity ?? 1;
    const snapshot = scaleProfile(profile, quantity.value);
    const timestamp = now();
    const values = nutritionParams(snapshot);
    const result = this.sqlite.prepare(`
      INSERT INTO food_entries (food_id, meal_id, title, logged_at_utc, meal_tag, quantity_value, quantity_display, quantity_unit, quantity_basis, snapshot_json, ${nutrientColumns.join(", ")}, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${nutrientColumns.map(() => "?").join(", ")}, ?, ?)
    `).run(sourceId.foodId ?? null, sourceId.mealId ?? null, title, new Date(input.loggedAtUtc).toISOString(), validateTag(input.mealTag), quantity.value, quantity.display, quantity.unit, profile.quantityBasis, JSON.stringify({ base: baseNutrition, baseQuantity, snapshot }), ...nutrientColumns.map((column) => values[column]), timestamp, timestamp);
    return this.getEntry(Number(result.lastInsertRowid)) as EntryRecord;
  }

  addFoodEntry(input: EntryInput): EntryRecord {
    let profile = input.profile;
    let title = profile?.name;
    if (input.foodId !== undefined) {
      const food = this.getFood(input.foodId);
      if (!food) throw new Error("Food not found.");
      profile = food;
      title = food.name;
    }
    if (!profile || !title) throw new Error("A Food or Food profile is required.");
    return this.insertEntry(input, profile, title, { foodId: input.foodId });
  }

  addMealEntry(input: EntryInput): EntryRecord {
    if (input.mealId === undefined) throw new Error("Meal is required.");
    const meal = this.getMeal(input.mealId);
    if (!meal) throw new Error("Meal not found.");
    return this.insertEntry(input, { name: meal.name, quantityBasis: "meal unit", nutrients: nutritionAsProfile(meal.nutrients) }, meal.name, { mealId: meal.id });
  }

  getEntry(id: number): EntryRecord | null {
    const row = this.sqlite.prepare("SELECT * FROM food_entries WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.entryRecordFromRow(row) : null;
  }

  listEntriesByDate(date: string, timezone: string): EntryRecord[] {
    const rows = this.sqlite.prepare("SELECT * FROM food_entries ORDER BY logged_at_utc DESC").all() as Record<string, unknown>[];
    return rows
      .map((row) => this.entryRecordFromRow(row, timezone))
      .filter((entry) => entry.localDate === date);
  }

  updateEntry(id: number, changes: EntryUpdate, timezone: string): EntryRecord {
    const existing = this.getEntry(id);
    if (!existing) throw new Error("Food entry not found.");
    let baseNutrition = existing.baseNutrition;
    let title = changes.title?.trim() || existing.title;
    let quantityBasis = existing.quantityBasis;
    let baseQuantity = existing.baseQuantity;
    let foodId = existing.foodId;
    let mealId = existing.mealId;
    if (changes.profile) {
      baseNutrition = normalizeNutrition(changes.profile.nutrients);
      title = changes.profile.name;
      quantityBasis = changes.profile.quantityBasis;
      baseQuantity = changes.profile.basisQuantity ?? 1;
      foodId = null;
      mealId = null;
    }
    const quantity = parseQuantity(changes.quantity ?? existing.quantity.value, quantityBasis);
    const snapshot = scaleNutrition(nutritionAsProfile(baseNutrition), quantity.value / baseQuantity);
    const loggedAtUtc = changes.loggedAtUtc ? new Date(changes.loggedAtUtc).toISOString() : existing.loggedAtUtc;
    const values = nutritionParams(snapshot);
    this.sqlite.prepare(`
      UPDATE food_entries SET food_id = ?, meal_id = ?, title = ?, logged_at_utc = ?, meal_tag = ?, quantity_value = ?, quantity_display = ?, quantity_unit = ?, quantity_basis = ?, snapshot_json = ?, ${nutrientColumns.map((column) => `${column} = ?`).join(", ")}, updated_at = ? WHERE id = ?
    `).run(foodId, mealId, title, loggedAtUtc, validateTag(changes.mealTag ?? existing.mealTag), quantity.value, quantity.display, quantity.unit, quantityBasis, JSON.stringify({ base: baseNutrition, baseQuantity, snapshot }), ...nutrientColumns.map((column) => values[column]), now(), id);
    return this.getEntry(id) as EntryRecord;
  }

  deleteEntry(id: number): EntryRecord | null {
    const entry = this.getEntry(id);
    if (!entry) return null;
    this.sqlite.prepare("DELETE FROM food_entries WHERE id = ?").run(id);
    return entry;
  }

  restoreEntry(entry: EntryRecord): EntryRecord {
    const values = nutritionParams(entry.snapshot);
    this.sqlite.prepare(`
      INSERT OR REPLACE INTO food_entries (id, food_id, meal_id, title, logged_at_utc, meal_tag, quantity_value, quantity_display, quantity_unit, quantity_basis, snapshot_json, ${nutrientColumns.join(", ")}, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${nutrientColumns.map(() => "?").join(", ")}, ?, ?)
    `).run(entry.id, entry.foodId, entry.mealId, entry.title, entry.loggedAtUtc, entry.mealTag, entry.quantity.value, entry.quantity.display, entry.quantity.unit, entry.quantityBasis, JSON.stringify({ base: entry.baseNutrition, baseQuantity: entry.baseQuantity, snapshot: entry.snapshot }), ...nutrientColumns.map((column) => values[column]), entry.createdAt, now());
    return this.getEntry(entry.id) as EntryRecord;
  }

  createTarget(input: { kind: string; plan?: string | null; calories?: number | null; references: NutrientReferences; metadata?: Record<string, unknown> | null; active?: boolean }): TargetRecord {
    const timestamp = now();
    const transaction = this.sqlite.transaction(() => {
      if (input.active) this.sqlite.prepare("UPDATE nutrition_targets SET active = 0, updated_at = ?").run(timestamp);
      const result = this.sqlite.prepare("INSERT INTO nutrition_targets (kind, plan, calories, references_json, metadata_json, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(input.kind, input.plan ?? null, input.calories ?? null, JSON.stringify(input.references), input.metadata ? JSON.stringify(input.metadata) : null, input.active ? 1 : 0, timestamp, timestamp);
      return Number(result.lastInsertRowid);
    });
    return this.getTarget(transaction()) as TargetRecord;
  }

  getTarget(id: number): TargetRecord | null {
    const row = this.sqlite.prepare("SELECT * FROM nutrition_targets WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: Number(row.id),
      kind: String(row.kind),
      plan: row.plan === null ? null : String(row.plan),
      calories: nullableNumber(row.calories),
      references: JSON.parse(String(row.references_json)) as NutrientReferences,
      metadata: jsonObject(row.metadata_json as string | null),
      active: Boolean(row.active),
    };
  }

  getActiveTarget(): TargetRecord | null {
    const row = this.sqlite.prepare("SELECT id FROM nutrition_targets WHERE active = 1 ORDER BY id DESC LIMIT 1").get() as { id: number } | undefined;
    return row ? this.getTarget(row.id) : null;
  }

  updateTarget(id: number, changes: { references?: NutrientReferences; active?: boolean }): TargetRecord {
    const target = this.getTarget(id);
    if (!target) throw new Error("Target not found.");
    const timestamp = now();
    const transaction = this.sqlite.transaction(() => {
      if (changes.active) this.sqlite.prepare("UPDATE nutrition_targets SET active = 0, updated_at = ?").run(timestamp);
      this.sqlite.prepare("UPDATE nutrition_targets SET references_json = ?, active = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(changes.references ?? target.references), changes.active ?? target.active ? 1 : 0, timestamp, id);
    });
    transaction();
    return this.getTarget(id) as TargetRecord;
  }

  addImageRecord(input: Omit<ImageRecord, "id" | "createdAt">): ImageRecord {
    const createdAt = now();
    const result = this.sqlite.prepare("INSERT INTO images (managed_name, original_name, mime_type, byte_size, food_id, meal_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(input.managedName, input.originalName, input.mimeType, input.byteSize, input.foodId ?? null, input.mealId ?? null, createdAt);
    return { ...input, id: Number(result.lastInsertRowid), createdAt };
  }

  getImage(id: number): ImageRecord | null {
    const row = this.sqlite.prepare("SELECT * FROM images WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? {
      id: Number(row.id),
      managedName: String(row.managed_name),
      originalName: String(row.original_name),
      mimeType: String(row.mime_type),
      byteSize: Number(row.byte_size),
      foodId: row.food_id === null ? null : Number(row.food_id),
      mealId: row.meal_id === null ? null : Number(row.meal_id),
      createdAt: String(row.created_at),
    } : null;
  }

  listImages(): ImageRecord[] {
    const rows = this.sqlite.prepare("SELECT * FROM images ORDER BY id").all() as Record<string, unknown>[];
    return rows.map((row) => this.getImage(Number(row.id)) as ImageRecord);
  }

  deleteImageRecord(id: number): ImageRecord | null {
    const image = this.getImage(id);
    if (!image) return null;
    this.sqlite.prepare("DELETE FROM images WHERE id = ?").run(id);
    return image;
  }

  exportRecords(): Record<string, unknown> {
    return {
      format: "calories-export-v1",
      exportedAt: now(),
      users: this.sqlite.prepare("SELECT * FROM users").all(),
      foods: this.sqlite.prepare("SELECT * FROM foods").all(),
      meals: this.sqlite.prepare("SELECT * FROM meals").all(),
      mealIngredients: this.sqlite.prepare("SELECT * FROM meal_ingredients").all(),
      foodEntries: this.sqlite.prepare("SELECT * FROM food_entries").all(),
      favorites: this.sqlite.prepare("SELECT * FROM favorites").all(),
      images: this.sqlite.prepare("SELECT * FROM images").all(),
      nutritionTargets: this.sqlite.prepare("SELECT * FROM nutrition_targets").all(),
    };
  }

  deleteAllRecords(): void {
    const transaction = this.sqlite.transaction(() => {
      this.sqlite.exec("DELETE FROM favorites; DELETE FROM meal_ingredients; DELETE FROM food_entries; DELETE FROM images; DELETE FROM nutrition_targets; DELETE FROM meals; DELETE FROM foods; DELETE FROM users;");
    });
    transaction();
  }

}

export async function writeExport(dataDir: string, store: Store): Promise<string> {
  const exportsDirectory = path.join(dataDir, "exports");
  await fsp.mkdir(exportsDirectory, { recursive: true });
  const exportDirectory = path.join(exportsDirectory, `calories-${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`);
  await fsp.mkdir(path.join(exportDirectory, "images"), { recursive: true });
  await fsp.writeFile(path.join(exportDirectory, "records.json"), JSON.stringify(store.exportRecords(), null, 2));
  for (const image of store.listImages()) {
    const source = path.join(dataDir, "images", image.managedName);
    if (fs.existsSync(source)) await fsp.copyFile(source, path.join(exportDirectory, "images", image.managedName));
  }
  return exportDirectory;
}

export async function clearOwnedFiles(dataDir: string): Promise<void> {
  await Promise.all([
    fsp.rm(path.join(dataDir, "images"), { recursive: true, force: true }),
    fsp.rm(path.join(dataDir, "exports"), { recursive: true, force: true }),
  ]);
  await fsp.mkdir(path.join(dataDir, "images"), { recursive: true });
  await fsp.mkdir(path.join(dataDir, "exports"), { recursive: true });
}

export async function deleteAllOwnedData(dataDir: string, store: Store): Promise<void> {
  const token = randomUUID();
  const directories = [path.join(dataDir, "images"), path.join(dataDir, "exports")];
  const staged: Array<{ original: string; backup: string }> = [];
  let recordsDeleted = false;
  try {
    await fsp.mkdir(dataDir, { recursive: true });
    for (const original of directories) {
      const backup = `${original}.delete-${token}`;
      if (fs.existsSync(original)) {
        await fsp.rename(original, backup);
        staged.push({ original, backup });
      }
      await fsp.mkdir(original, { recursive: true });
    }
    store.deleteAllRecords();
    recordsDeleted = true;
    await Promise.all(staged.map(({ backup }) => fsp.rm(backup, { recursive: true, force: true })));
  } catch (error) {
    if (!recordsDeleted) {
      await Promise.all(directories.map((original) => fsp.rm(original, { recursive: true, force: true })));
      await Promise.all(staged.map(({ original, backup }) => fsp.rename(backup, original).catch(() => undefined)));
    }
    throw error;
  }
}

export function nutrientsForDisplay(nutrients: Partial<NutrientValues>): Array<{ key: NutrientKey; label: string; value: string; unit: string; known: boolean }> {
  return NUTRIENT_DEFINITIONS.map((definition) => ({
    key: definition.key,
    label: definition.label,
    value: formatNutritionValue(definition.key, nutrients[definition.key]),
    unit: definition.unit,
    known: nutrients[definition.key] !== null && nutrients[definition.key] !== undefined,
  }));
}
