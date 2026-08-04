import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyMigrations } from "../src/db/migrations.js";
import { closeDatabase, openDatabase, type DatabaseConnection } from "../src/db/client.js";
import { Store, deleteAllOwnedData, writeExport } from "../src/persistence/store.js";
import { ImageStorage } from "../src/storage/images.js";

const connections: DatabaseConnection[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const connection of connections.splice(0)) closeDatabase(connection);
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

test("exports include structured records and retained images without rewriting snapshots", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "calories-owned-"));
  directories.push(directory);
  const connection = openDatabase(directory);
  connections.push(connection);
  applyMigrations(connection.sqlite);
  const store = new Store(connection);
  const food = store.createFood({ name: "Soup", quantityBasis: "bowl", nutrients: { calories: 300 } });
  const entry = store.addFoodEntry({ foodId: food.id, quantity: 1, loggedAtUtc: "2026-01-01T12:00:00.000Z" });
  const images = new ImageStorage(directory);
  const image = await images.save({ buffer: Buffer.from("image"), mimeType: "image/png", originalName: "soup.png" });
  store.addImageRecord({ ...image, foodId: food.id, mealId: null });
  const exportDirectory = await writeExport(directory, store);
  const records = JSON.parse(await fs.readFile(path.join(exportDirectory, "records.json"), "utf8")) as { foods: unknown[]; foodEntries: unknown[]; images: unknown[] };
  assert.equal(records.foods.length, 1);
  assert.equal(records.foodEntries.length, 1);
  assert.equal(records.images.length, 1);
  assert.equal((await fs.readFile(path.join(exportDirectory, "images", image.managedName))).toString(), "image");
  assert.throws(() => store.addImageRecord({ managedName: "../outside.png", originalName: "outside.png", mimeType: "image/png", byteSize: 1, foodId: food.id, mealId: null }), /managed image/i);
  store.sqlite.prepare("INSERT INTO images (managed_name, original_name, mime_type, byte_size, food_id, meal_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("../outside.png", "outside.png", "image/png", 1, food.id, null, new Date().toISOString());
  await assert.rejects(writeExport(directory, store), /managed image/i);

  store.deleteFood(food.id);
  assert.equal(store.getFoodEntry(entry.id)?.snapshot.nutrients.calories, 300);
  await fs.mkdir(path.join(directory, "images.delete-stale"), { recursive: true });
  await deleteAllOwnedData(directory, store);
  assert.equal(store.getFoodEntry(entry.id), null);
  assert.equal(store.getUser(), null);
  assert.deepEqual(await fs.readdir(path.join(directory, "exports")), []);
  await assert.rejects(fs.access(path.join(directory, "images.delete-stale")));
});

test("delete-all preserves an earlier recovery backup when the database delete fails", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "calories-owned-failure-"));
  directories.push(directory);
  const connection = openDatabase(directory);
  connections.push(connection);
  applyMigrations(connection.sqlite);
  const store = new Store(connection);
  await fs.mkdir(path.join(directory, "images"), { recursive: true });
  const staleBackup = path.join(directory, "images.delete-stale");
  await fs.mkdir(staleBackup, { recursive: true });
  await fs.writeFile(path.join(staleBackup, "recovery-marker"), "keep");
  store.deleteAllRecords = () => {
    throw new Error("database failure");
  };

  await assert.rejects(deleteAllOwnedData(directory, store), /database failure/);
  assert.equal(await fs.readFile(path.join(staleBackup, "recovery-marker"), "utf8"), "keep");
  await fs.access(path.join(directory, "images"));
});
