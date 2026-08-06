import { afterEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CalorieRepository } from "./calorie-repository";
import { IntakeDatabase } from "./database";
import { FoodLogRepository } from "./food-log-repository";
import { IntakeService } from "./intake-service";
import { ProductRepository } from "./product-repository";
import { SettingsRepository } from "./settings-repository";
import { TargetRepository } from "./target-repository";
import { WaterRepository } from "./water-repository";
import { WeightRepository } from "./weight-repository";

function createService(database: IntakeDatabase) {
  const products = new ProductRepository(database.connection, database.userId);
  const foodLogs = new FoodLogRepository(database.connection, database.userId);
  const targets = new TargetRepository(database.connection, database.userId);
  const water = new WaterRepository(database.connection, database.userId);
  const weights = new WeightRepository(database.connection, database.userId);
  const settings = new SettingsRepository(database.connection, database.userId);
  return new IntakeService(products, foodLogs, database.userId, targets, water, weights, settings);
}

describe("Daily Intake repositories", () => {
  let database: IntakeDatabase | undefined;

  afterEach(() => database?.close());

  it("keeps food snapshots independent from product edits and retirement", () => {
    database = new IntakeDatabase(":memory:");
    const service = createService(database);
    const product = service.createProduct({
      name: "Oats",
      servingDescription: "1/2 cup",
      caloriesPerServingCal: 150,
      proteinPerServingG: 5,
      carbsPerServingG: 27,
      fatPerServingG: 3,
      fiberPerServingG: 4,
      sugarPerServingG: 1,
      sodiumPerServingMg: 0,
    });
    const first = service.createFoodLog({ date: "2026-08-04", productId: product.id, quantity: 1 });
    service.updateProduct(product.id, { ...product, name: "Oats revised", caloriesPerServingCal: 120 });
    const second = service.createFoodLog({ date: "2026-08-05", productId: product.id, quantity: 1 });

    expect(first.caloriesPerServingCal).toBe(150);
    expect(second.caloriesPerServingCal).toBe(120);
    service.retireProduct(product.id);
    expect(service.getFoodLogDay("2026-08-04").entries).toHaveLength(1);
    expect(() => service.createFoodLog({ date: "2026-08-05", productId: product.id, quantity: 1 })).toThrow("Food product");
  });

  it("upserts water and same-date weight values", () => {
    database = new IntakeDatabase(":memory:");
    const service = createService(database);
    expect(service.addWater("2026-08-05", 8).totalFluidOz).toBe(8);
    expect(service.addWater("2026-08-05", 16).totalFluidOz).toBe(24);
    expect(service.upsertWeight("2026-08-05", 182.4).weightLb).toBe(182.4);
    expect(service.upsertWeight("2026-08-05", 181.8).weightLb).toBe(181.8);
    expect(service.listWeights()).toHaveLength(1);
  });

  it("migrates legacy calorie entries into editable snapshots", () => {
    const path = join(tmpdir(), `daily-intake-migration-${process.pid}.db`);
    const legacy = new CalorieRepository(path);
    legacy.add({ name: "Legacy toast", calories: 180, date: "2026-08-04" });
    legacy.close();

    database = new IntakeDatabase(path);
    const service = createService(database);
    const entry = service.getFoodLogDay("2026-08-04").entries[0];
    expect(entry).toMatchObject({
      titleSnapshot: "Legacy toast",
      caloriesPerServingCal: 180,
      proteinPerServingG: 0,
    });
    service.updateFoodLog(entry.id, { titleSnapshot: "Legacy toast corrected" });
    expect(service.getFoodLogDay("2026-08-04").entries[0].titleSnapshot).toBe("Legacy toast corrected");
    database.close();
    database = undefined;
    rmSync(path, { force: true });
  });
});
