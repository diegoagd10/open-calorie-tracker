import { describe, expect, test } from "vitest";

import { UsdaFoodDataCentralAdapter } from "../app/catalog/usda.server";

const runLiveSpike = process.env.FDC_LIVE_SPIKE === "1";

describe.skipIf(!runLiveSpike)("registered USDA FoodData Central spike", () => {
  test("representative United States searches agree with details and expose usable measurements", async () => {
    const apiKey = process.env.FDC_API_KEY?.trim();
    expect(apiKey, "FDC_API_KEY is required for the live spike").toBeTruthy();
    expect(apiKey).not.toBe("DEMO_KEY");
    const provider = new UsdaFoodDataCentralAdapter({ apiKey });
    const queries = [
      "apple raw",
      "chicken breast roasted",
      "whole wheat bread",
      "black beans cooked",
      "olive oil",
      "plain Greek yogurt",
      "corn flakes cereal",
      "cheddar cheese",
      "restaurant taco",
      "yogur natural",
    ];
    const latencies: number[] = [];
    const observedTypes = new Set<string>();
    const observedBarcodes = new Set<string>();
    let foodsWithPortions = 0;
    let foodsWithEnergy = 0;

    for (const query of queries) {
      const startedAt = performance.now();
      const results = await provider.search(query);
      latencies.push(performance.now() - startedAt);
      expect(results.length).toBeGreaterThan(0);
      const selected = results[0]!;
      observedTypes.add(selected.dataType);
      for (const result of results) {
        if (result.barcode) observedBarcodes.add(result.barcode);
      }

      const detailStartedAt = performance.now();
      const detail = await provider.getFood(selected.providerFoodId);
      latencies.push(performance.now() - detailStartedAt);
      expect(detail.providerFoodId).toBe(selected.providerFoodId);
      expect(detail.name).toBe(selected.name);
      expect(detail.measurements.length).toBeGreaterThan(0);
      expect(
        detail.measurements.every(
          (measurement) =>
            Number.isSafeInteger(measurement.baseQuantityMicrounits) &&
            measurement.baseQuantityMicrounits > 0,
        ),
      ).toBe(true);
      if (detail.measurements.length > 1) foodsWithPortions += 1;
      if (detail.nutritionPerAuthoritativeBase.energyMilliKcal !== null) {
        foodsWithEnergy += 1;
      }
    }

    const noResultStartedAt = performance.now();
    const noResults = await provider.search("fdc-no-result-9f4f6d8c2b1a");
    latencies.push(performance.now() - noResultStartedAt);
    expect(noResults).toEqual([]);

    expect(observedTypes.has("Branded")).toBe(true);
    expect(
      observedTypes.has("Foundation") || observedTypes.has("Survey (FNDDS)"),
    ).toBe(true);
    expect(foodsWithPortions).toBeGreaterThan(0);
    expect(foodsWithEnergy).toBeGreaterThan(0);

    expect(observedBarcodes.size).toBeGreaterThanOrEqual(10);
    for (const barcode of [...observedBarcodes].slice(0, 10)) {
      const results = await provider.search(barcode);
      expect(results.some((result) => result.barcode === barcode)).toBe(true);
    }

    const sorted = [...latencies].sort((left, right) => left - right);
    const percentile = (ratio: number) =>
      Math.round(
        sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))]!,
      );
    console.info(
      JSON.stringify({
        event: "usda_live_spike_complete",
        observedBarcodeCount: observedBarcodes.size,
        observedTypes: [...observedTypes].sort(),
        p50Milliseconds: percentile(0.5),
        p95Milliseconds: percentile(0.95),
        requestCount: latencies.length,
      }),
    );
  }, 120_000);
});
