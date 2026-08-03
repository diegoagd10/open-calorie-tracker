import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timezone: text("timezone").notNull(),
  timezoneSource: text("timezone_source").notNull().default("bootstrap"),
  ...timestamps,
});

export const foods = sqliteTable("foods", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  brand: text("brand"),
  description: text("description"),
  source: text("source").notNull().default("manual"),
  quantityBasis: text("quantity_basis").notNull(),
  basisQuantity: real("basis_quantity").notNull().default(1),
  calories: real("calories").notNull(),
  protein: real("protein"),
  carbohydrates: real("carbohydrates"),
  fat: real("fat"),
  fiber: real("fiber"),
  addedSugar: real("added_sugar"),
  sugar: real("sugar"),
  saturatedFat: real("saturated_fat"),
  sodium: real("sodium"),
  ...timestamps,
}, (table) => ({
  nameIndex: index("foods_name_idx").on(table.name),
}));

export const meals = sqliteTable("meals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  ...timestamps,
}, (table) => ({
  nameIndex: index("meals_name_idx").on(table.name),
}));

export const mealIngredients = sqliteTable("meal_ingredients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  mealId: integer("meal_id").notNull().references(() => meals.id, { onDelete: "cascade" }),
  foodId: integer("food_id").references(() => foods.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  quantityValue: real("quantity_value").notNull(),
  quantityDisplay: text("quantity_display").notNull(),
  quantityUnit: text("quantity_unit").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  ...timestamps,
}, (table) => ({
  mealIndex: index("meal_ingredients_meal_idx").on(table.mealId),
}));

export const foodEntries = sqliteTable("food_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  foodId: integer("food_id").references(() => foods.id, { onDelete: "set null" }),
  mealId: integer("meal_id").references(() => meals.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  loggedAtUtc: text("logged_at_utc").notNull(),
  mealTag: text("meal_tag"),
  quantityValue: real("quantity_value").notNull(),
  quantityDisplay: text("quantity_display").notNull(),
  quantityUnit: text("quantity_unit").notNull(),
  quantityBasis: text("quantity_basis").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  calories: real("calories").notNull(),
  protein: real("protein"),
  carbohydrates: real("carbohydrates"),
  fat: real("fat"),
  fiber: real("fiber"),
  addedSugar: real("added_sugar"),
  sugar: real("sugar"),
  saturatedFat: real("saturated_fat"),
  sodium: real("sodium"),
  ...timestamps,
}, (table) => ({
  dateIndex: index("food_entries_logged_at_idx").on(table.loggedAtUtc),
}));

export const favorites = sqliteTable("favorites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  foodId: integer("food_id").references(() => foods.id, { onDelete: "set null" }),
  mealId: integer("meal_id").references(() => meals.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  foodUnique: uniqueIndex("favorites_food_unique").on(table.foodId),
  mealUnique: uniqueIndex("favorites_meal_unique").on(table.mealId),
}));

export const images = sqliteTable("images", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  managedName: text("managed_name").notNull().unique(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  foodId: integer("food_id").references(() => foods.id, { onDelete: "cascade" }),
  mealId: integer("meal_id").references(() => meals.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  foodIndex: index("images_food_idx").on(table.foodId),
  mealIndex: index("images_meal_idx").on(table.mealId),
}));

export const nutritionTargets = sqliteTable("nutrition_targets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  plan: text("plan"),
  calories: real("calories"),
  referencesJson: text("references_json").notNull(),
  metadataJson: text("metadata_json"),
  active: integer("active", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const schema = {
  users,
  foods,
  meals,
  mealIngredients,
  foodEntries,
  favorites,
  images,
  nutritionTargets,
};
