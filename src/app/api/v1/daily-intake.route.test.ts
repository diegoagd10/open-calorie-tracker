import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { currentLocalDate } from "@/lib/domain";

describe("Daily Intake API", () => {
  const path = join(tmpdir(), `daily-intake-api-${process.pid}.db`);
  let products: typeof import("./products/route");
  let productById: typeof import("./products/[id]/route");
  let foodLog: typeof import("./food-log/route");
  let targets: typeof import("./targets/route");
  let water: typeof import("./water/route");
  let weights: typeof import("./weights/route");

  beforeAll(async () => {
    rmSync(path, { force: true });
    process.env.DAILY_INTAKE_DB_PATH = path;
    vi.resetModules();
    products = await import("./products/route");
    productById = await import("./products/[id]/route");
    foodLog = await import("./food-log/route");
    targets = await import("./targets/route");
    water = await import("./water/route");
    weights = await import("./weights/route");
  });

  afterAll(() => {
    delete process.env.DAILY_INTAKE_DB_PATH;
    rmSync(path, { force: true });
  });

  it("creates products, snapshots food, and preserves history after edits", async () => {
    const date = currentLocalDate();
    const productResponse = await products.POST(
      new Request("http://localhost/api/v1/products", {
        method: "POST",
        body: JSON.stringify({
          name: "  Oats ",
          servingDescription: "1/2 cup",
          caloriesPerServingCal: 150,
          proteinPerServingG: 5,
          carbsPerServingG: 27,
          fatPerServingG: 3,
          fiberPerServingG: 4,
          sugarPerServingG: 1,
          sodiumPerServingMg: 0,
        }),
      }),
    );
    const product = await productResponse.json();
    expect(productResponse.status).toBe(201);

    const firstResponse = await foodLog.POST(
      new Request("http://localhost/api/v1/food-log", {
        method: "POST",
        body: JSON.stringify({ date, productId: product.id, quantity: 1.5 }),
      }),
    );
    expect(firstResponse.status).toBe(201);
    expect((await firstResponse.json()).caloriesPerServingCal).toBe(150);

    const updateResponse = await productById.PATCH(
      new Request(`http://localhost/api/v1/products/${product.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...product,
          caloriesPerServingCal: 120,
        }),
      }),
      { params: Promise.resolve({ id: product.id }) },
    );
    expect(updateResponse.status).toBe(200);

    const secondResponse = await foodLog.POST(
      new Request("http://localhost/api/v1/food-log", {
        method: "POST",
        body: JSON.stringify({ date, productId: product.id, quantity: 1 }),
      }),
    );
    expect((await secondResponse.json()).caloriesPerServingCal).toBe(120);

    const listResponse = await foodLog.GET(
      new Request(`http://localhost/api/v1/food-log?date=${date}`),
    );
    const list = await listResponse.json();
    expect(list.entries).toHaveLength(2);
    expect(list.entries[1].caloriesPerServingCal).toBe(150);

    const retireResponse = await productById.DELETE(
      new Request(`http://localhost/api/v1/products/${product.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: product.id }) },
    );
    expect(retireResponse.status).toBe(200);
    expect((await products.GET(new Request("http://localhost/api/v1/products"))).json()).resolves.toMatchObject({ products: [] });
  });

  it("stores effective targets, independent water, and same-date weights", async () => {
    const date = currentLocalDate();
    const targetResponse = await targets.POST(
      new Request("http://localhost/api/v1/targets", {
        method: "POST",
        body: JSON.stringify({
          calorieMaximumCal: 1600,
          proteinMinimumG: 140,
          carbsMaximumG: 200,
          fiberMaximumG: 30,
          sugarMaximumG: 40,
          sodiumMaximumMg: 2300,
          waterMinimumFlOz: 64,
        }),
      }),
    );
    expect(targetResponse.status).toBe(201);
    expect((await targetResponse.json()).target.effectiveDate).toBe(date);

    const waterResponse = await water.POST(
      new Request(`http://localhost/api/v1/water?date=${date}`, {
        method: "POST",
        body: JSON.stringify({ amount: 16 }),
      }),
    );
    expect((await waterResponse.json()).totalFluidOz).toBe(16);

    const weightResponse = await weights.PUT(
      new Request("http://localhost/api/v1/weights", {
        method: "PUT",
        body: JSON.stringify({ date, weightLb: 182.4 }),
      }),
    );
    expect(weightResponse.status).toBe(200);
    expect((await weights.GET()).json()).resolves.toMatchObject({ entries: [{ weightLb: 182.4 }] });
  });

  it("returns a validation response for malformed food quantities", async () => {
    const response = await foodLog.POST(
      new Request("http://localhost/api/v1/food-log", {
        method: "POST",
        body: JSON.stringify({ date: currentLocalDate(), productId: "missing", quantity: 0 }),
      }),
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
