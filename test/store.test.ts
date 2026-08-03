import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyMigrations } from "../src/db/migrations.js";
import { closeDatabase, openDatabase, type DatabaseConnection } from "../src/db/client.js";
import { Store, utcFromLocal } from "../src/persistence/store.js";

const connections: DatabaseConnection[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const connection of connections.splice(0)) closeDatabase(connection);
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function createStore(): Promise<Store> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "calories-store-"));
  directories.push(directory);
  const connection = openDatabase(directory);
  connections.push(connection);
  applyMigrations(connection.sqlite);
  return new Store(connection);
}

test("manual Foods and Food entries retain nullable nutrients and immutable snapshots", async () => {
  const store = await createStore();
  store.ensureUser("America/New_York");
  const food = store.createFood({
    name: "Trail mix",
    quantityBasis: "serving",
    nutrients: { calories: 184, protein: 13, carbohydrates: 16.2, fat: 8.1, sodium: null },
  });
  const entry = store.addFoodEntry({
    foodId: food.id,
    quantity: "1/2",
    loggedAtUtc: "2026-01-02T00:30:00.000Z",
    mealTag: "Snack",
  });

  assert.equal(entry.quantity.display, "1/2");
  assert.equal(entry.snapshot.calories, 92);
  assert.equal(entry.snapshot.sodium, null);
  assert.equal(store.listEntriesByDate("2026-01-01", "America/New_York").length, 1);

  store.updateFood(food.id, { ...food, name: "Changed recipe", quantityBasis: "serving", nutrients: { ...food.nutrients, calories: 900 } });
  assert.equal(store.getEntry(entry.id)?.snapshot.calories, 92);

  const edited = store.updateEntry(entry.id, { quantity: "1 1/2", mealTag: "Dinner", loggedAtUtc: "2026-01-02T01:00:00.000Z" }, "America/New_York");
  assert.equal(edited.snapshot.calories, 276);
  assert.equal(edited.mealTag, "Dinner");
  assert.equal(store.getFood(food.id)?.name, "Changed recipe");
});

test("deleting and restoring a Food entry preserves its snapshot", async () => {
  const store = await createStore();
  const food = store.createFood({ name: "Apple", quantityBasis: "item", nutrients: { calories: 80 } });
  const entry = store.addFoodEntry({ foodId: food.id, quantity: 1, loggedAtUtc: "2026-01-01T12:00:00.000Z" });
  const deleted = store.deleteEntry(entry.id);
  assert.equal(deleted?.snapshot.calories, 80);
  assert.equal(store.getEntry(entry.id), null);
  store.restoreEntry(deleted!);
  assert.equal(store.getEntry(entry.id)?.snapshot.calories, 80);
});

test("saving a logged Food entry as a Favorite copies its exact historical snapshot", async () => {
  const store = await createStore();
  const food = store.createFood({ name: "Granola", quantityBasis: "serving", nutrients: { calories: 200, protein: 5 } });
  const entry = store.addFoodEntry({ foodId: food.id, quantity: "1/2", loggedAtUtc: "2026-01-01T12:00:00.000Z" });
  const favorite = store.saveEntryAsFavorite(entry.id);
  assert.equal(favorite.nutrients.calories, 100);
  assert.equal(favorite.quantityBasis, "1/2 serving");
  assert.equal(favorite.favorite, true);
});

test("Meals sum confirmed Food ingredients and log a scaled unit snapshot", async () => {
  const store = await createStore();
  const rice = store.createFood({ name: "Rice", quantityBasis: "cup", nutrients: { calories: 200, protein: 4 } });
  const beans = store.createFood({ name: "Beans", quantityBasis: "cup", nutrients: { calories: 240, protein: 16 } });
  const meal = store.createMeal("Rice and beans");
  store.addMealIngredient(meal.id, rice.id, "1/2", "cup");
  store.addMealIngredient(meal.id, beans.id, "1/4", "cup");
  const assembled = store.getMeal(meal.id)!;
  assert.equal(assembled.nutrients.calories, 160);
  assert.equal(assembled.ingredients[0].quantity.display, "1/2");

  const entry = store.addMealEntry({ mealId: meal.id, quantity: "1 1/2", loggedAtUtc: "2026-01-01T12:00:00.000Z" });
  assert.equal(entry.snapshot.calories, 240);

  store.replaceMealIngredient(assembled.ingredients[0].id, beans.id, "1/2", "cup");
  assert.equal(store.getMeal(meal.id)?.nutrients.calories, 180);
});

test("declared basis quantities scale raw-unit Foods correctly", async () => {
  const store = await createStore();
  const flour = store.createFood({ name: "Flour", quantityBasis: "g", basisQuantity: 100, nutrients: { calories: 364 } });
  const entry = store.addFoodEntry({ foodId: flour.id, quantity: 50, loggedAtUtc: "2026-01-01T12:00:00.000Z" });
  assert.equal(entry.snapshot.calories, 182);
  const edited = store.updateEntry(entry.id, { quantity: 25 }, "UTC");
  assert.equal(edited.snapshot.calories, 91);
});

test("local date conversion uses the configured timezone", () => {
  assert.equal(utcFromLocal("2026-01-01", "19:30", "America/New_York"), "2026-01-02T00:30:00.000Z");
});
