import { describe, expect, test } from "vitest";

import { UsdaFoodDataCentralAdapter } from "../app/catalog/usda.server";
import { scaleCatalogNutrient } from "../app/food-entry/snapshot.server";

const runLiveSpike = process.env.FDC_LIVE_SPIKE === "1";

function rawEnergy(
  value: unknown,
  dataType: string,
): { amount: number; fixedPointMultiplier: number; nutrientId: number } | null {
  if (!value || typeof value !== "object") return null;
  const nutrients = (value as { foodNutrients?: unknown }).foodNutrients;
  if (!Array.isArray(nutrients)) return null;
  const ids = dataType === "Foundation" ? [2048, 2047, 1008] : [1008];
  for (const nutrientId of ids) {
    const match = nutrients.find((candidate) => {
      if (!candidate || typeof candidate !== "object") return false;
      const nutrient = (candidate as { nutrient?: unknown }).nutrient;
      return (
        nutrient !== null &&
        typeof nutrient === "object" &&
        (nutrient as { id?: unknown }).id === nutrientId
      );
    }) as { amount?: unknown; nutrient?: { unitName?: unknown } } | undefined;
    if (!match) continue;
    expect(match.nutrient?.unitName?.toString().toUpperCase()).toBe("KCAL");
    expect(typeof match.amount).toBe("number");
    return {
      amount: match.amount as number,
      fixedPointMultiplier: 1_000,
      nutrientId,
    };
  }
  return null;
}

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
    const nutrientNames = [
      "carbohydrateMilligrams",
      "energyMilliKcal",
      "fatMilligrams",
      "fiberMilligrams",
      "proteinMilligrams",
      "sodiumMilligrams",
      "sugarMilligrams",
    ] as const;
    const nutrientNullCounts = Object.fromEntries(
      nutrientNames.map((name) => [name, 0]),
    ) as Record<(typeof nutrientNames)[number], number>;
    let foodsWithPortions = 0;
    let foodsWithEnergy = 0;
    let detailsChecked = 0;
    const energyComparisons: Array<{
      dataType: string;
      nutrientId: number;
      providerFoodId: string;
    }> = [];
    const representativeByType = new Map<
      string,
      Awaited<ReturnType<typeof provider.search>>[number]
    >();
    let gramWeightedPortion:
      | Awaited<ReturnType<typeof provider.getFood>>
      | undefined;

    for (const query of queries) {
      const startedAt = performance.now();
      const results = await provider.search(query);
      latencies.push(performance.now() - startedAt);
      expect(results.length).toBeGreaterThan(0);
      const selected = results[0]!;
      for (const result of results) {
        observedTypes.add(result.dataType);
        if (!representativeByType.has(result.dataType)) {
          representativeByType.set(result.dataType, result);
        }
        if (result.barcode) observedBarcodes.add(result.barcode);
      }

      const detailStartedAt = performance.now();
      const detail = await provider.getFood(selected.providerFoodId);
      latencies.push(performance.now() - detailStartedAt);
      expect(detail.providerFoodId).toBe(selected.providerFoodId);
      expect(detail.name).toBe(selected.name);
      expect(detail.measurements.length).toBeGreaterThan(0);
      detailsChecked += 1;
      for (const nutrientName of nutrientNames) {
        if (detail.nutritionPerAuthoritativeBase[nutrientName] === null) {
          nutrientNullCounts[nutrientName] += 1;
        }
      }
      expect(
        detail.measurements.every(
          (measurement) =>
            Number.isSafeInteger(measurement.baseQuantityMicrounits) &&
            measurement.baseQuantityMicrounits > 0,
        ),
      ).toBe(true);
      if (detail.measurements.length > 1) foodsWithPortions += 1;
      if (
        !gramWeightedPortion &&
        detail.measurements.some((measurement) =>
          measurement.id.startsWith("portion:"),
        )
      ) {
        gramWeightedPortion = detail;
      }
      if (detail.nutritionPerAuthoritativeBase.energyMilliKcal !== null) {
        foodsWithEnergy += 1;
      }
    }

    const noResultStartedAt = performance.now();
    const noResults = await provider.search("fdc-no-result-9f4f6d8c2b1a");
    latencies.push(performance.now() - noResultStartedAt);
    expect(noResults).toEqual([]);

    for (const dataType of [
      "Branded",
      "Foundation",
      "Survey (FNDDS)",
    ] as const) {
      const representative = representativeByType.get(dataType);
      expect(representative, `representative ${dataType} result`).toBeDefined();
      const detail = await provider.getFood(representative!.providerFoodId);
      const rawResponse = await fetch(
        `https://api.nal.usda.gov/fdc/v1/food/${detail.providerFoodId}?api_key=${encodeURIComponent(apiKey!)}`,
      );
      expect(rawResponse.ok).toBe(true);
      const providerEnergy = rawEnergy(await rawResponse.json(), dataType);
      expect(providerEnergy, `${dataType} energy`).not.toBeNull();
      expect(detail.nutritionPerAuthoritativeBase.energyMilliKcal).toEqual({
        amount: providerEnergy!.amount,
        fixedPointMultiplier: providerEnergy!.fixedPointMultiplier,
      });
      energyComparisons.push({
        dataType,
        nutrientId: providerEnergy!.nutrientId,
        providerFoodId: detail.providerFoodId,
      });
    }
    expect(foodsWithPortions).toBeGreaterThan(0);
    expect(foodsWithEnergy).toBeGreaterThan(0);

    expect(observedBarcodes.size).toBeGreaterThanOrEqual(10);
    const gtinProbeResults = [];
    for (const barcode of [...observedBarcodes].slice(0, 10)) {
      const results = await provider.search(barcode);
      const exact = results.find((result) => result.barcode === barcode);
      expect(exact).toBeDefined();
      const detail = await provider.getFood(exact!.providerFoodId);
      expect(detail.barcode).toBe(barcode);
      const rawSearchResponse = await fetch(
        `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey!)}`,
        {
          body: JSON.stringify({
            dataType: ["Branded", "Survey (FNDDS)", "Foundation"],
            pageSize: 20,
            query: barcode,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      expect(rawSearchResponse.ok).toBe(true);
      const rawSearchPayload = (await rawSearchResponse.json()) as {
        foods?: Array<{ gtinUpc?: unknown }>;
      };
      const rawDuplicateCount = (rawSearchPayload.foods ?? []).filter(
        (food) => food.gtinUpc === barcode,
      ).length;
      expect(rawDuplicateCount).toBeGreaterThan(0);
      gtinProbeResults.push({
        barcode,
        measurementSummary: exact!.measurementSummary,
        marketCountry: detail.marketCountry,
        measurementCount: detail.measurements.length,
        nutrientNulls: nutrientNames.filter(
          (name) => detail.nutritionPerAuthoritativeBase[name] === null,
        ),
        providerFoodId: detail.providerFoodId,
        rawDuplicateCount,
      });
    }

    expect(gramWeightedPortion).toBeDefined();
    const scalableFood = gramWeightedPortion!;
    const scalableMeasurement =
      scalableFood.measurements.find((measurement) =>
        measurement.id.startsWith("portion:"),
      ) ?? scalableFood.measurements[0]!;
    for (const quantity of [0.5, 1, 1.5, 2]) {
      for (const nutrientName of nutrientNames) {
        const scaled = scaleCatalogNutrient(
          scalableFood.nutritionPerAuthoritativeBase[nutrientName],
          scalableMeasurement.baseQuantityMicrounits,
          quantity * 1_000_000,
          scalableFood.authoritativeBaseQuantityMicrounits,
        );
        expect(scaled === null || Number.isSafeInteger(scaled)).toBe(true);
      }
    }

    const sorted = [...latencies].sort((left, right) => left - right);
    const percentile = (ratio: number) =>
      Math.round(
        sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))]!,
      );
    console.info(
      JSON.stringify({
        event: "usda_live_spike_complete",
        detailsChecked,
        energyComparisons,
        gtinProbeResults,
        nutrientNullCounts,
        observedBarcodeCount: observedBarcodes.size,
        observedTypes: [...observedTypes].sort(),
        p50Milliseconds: percentile(0.5),
        p95Milliseconds: percentile(0.95),
        requestCount: latencies.length,
      }),
    );
  }, 120_000);
});
