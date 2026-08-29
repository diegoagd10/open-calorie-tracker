import { afterEach, expect, test, vi } from "vitest";

import {
  CatalogConfigurationError,
  CatalogCredentialsError,
  CatalogFoodNotFoundError,
  CatalogInvalidResponseError,
  CatalogRateLimitError,
  CatalogUnavailableError,
} from "../app/catalog/food-catalog.server";
import { UsdaFoodDataCentralAdapter } from "../app/catalog/usda.server";
import {
  getFoodCatalogProvider,
  setFoodCatalogProviderForTests,
} from "../app/catalog/runtime.server";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  setFoodCatalogProviderForTests(undefined);
});

test("USDA search normalizes supported foods and keeps the newest duplicate revision", async () => {
  const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
    jsonResponse({
      foods: [
        {
          brandName: "Example Dairy",
          dataType: "Branded",
          description: "Plain nonfat Greek yogurt",
          fdcId: 100,
          gtinUpc: "0012345678905",
          householdServingFullText: "1 container",
          publicationDate: "2025-01-01",
          servingSize: 170,
          servingSizeUnit: "g",
        },
        {
          brandName: "Example Dairy",
          dataType: "Branded",
          description: "Plain nonfat Greek yogurt",
          fdcId: 101,
          gtinUpc: "0012345678905",
          householdServingFullText: "1 container",
          publishedDate: "2026-01-01",
          servingSize: 170,
          servingSizeUnit: "g",
        },
        {
          dataType: "Foundation",
          description: "Bread, whole-wheat",
          fdcId: 200,
          publicationDate: "2026-04-01",
        },
        {
          dataType: "SR Legacy",
          description: "Legacy bread",
          fdcId: 300,
        },
      ],
    }),
  );
  const provider = new UsdaFoodDataCentralAdapter({
    apiKey: "registered-test-key",
    baseUrl: "https://example.test/fdc/v1",
    fetchImplementation,
  });

  await expect(provider.search("  yogurt  ")).resolves.toEqual([
    {
      barcode: "0012345678905",
      brand: "Example Dairy",
      dataType: "Branded",
      measurementSummary: "1 container · 170 g",
      name: "Plain nonfat Greek yogurt",
      provider: "usda-fdc",
      providerFoodId: "101",
      providerPublishedDate: "2026-01-01",
    },
    {
      barcode: null,
      brand: null,
      dataType: "Foundation",
      measurementSummary: "100 g",
      name: "Bread, whole-wheat",
      provider: "usda-fdc",
      providerFoodId: "200",
      providerPublishedDate: "2026-04-01",
    },
  ]);

  expect(fetchImplementation).toHaveBeenCalledOnce();
  const [url, request] = fetchImplementation.mock.calls[0]!;
  expect(String(url)).not.toContain("yogurt");
  expect(String(url)).toContain("api_key=registered-test-key");
  expect(JSON.parse(String(request?.body))).toEqual({
    dataType: ["Branded", "Survey (FNDDS)", "Foundation"],
    pageSize: 20,
    query: "yogurt",
  });
});

test("USDA detail applies Foundation energy precedence and keeps only safe measurements", async () => {
  const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
    jsonResponse({
      dataType: "Foundation",
      description: "Bread, whole-wheat",
      fdcId: 200,
      foodNutrients: [
        { amount: 230, nutrient: { id: 1008, unitName: "kcal" } },
        { amount: 240, nutrient: { id: 2047, unitName: "kcal" } },
        { amount: 250, nutrient: { id: 2048, unitName: "kcal" } },
        { amount: 0, nutrient: { id: 1003, unitName: "g" } },
        { amount: 1.5, nutrient: { id: 1004, unitName: "g" } },
        { amount: 2.3, nutrient: { id: 1079, unitName: "g" } },
        { amount: 0, nutrient: { id: 2000, unitName: "g" } },
        { amount: 120, nutrient: { id: 1093, unitName: "mg" } },
      ],
      foodPortions: [
        {
          amount: 1,
          gramWeight: 32,
          id: 7,
          measureUnit: { name: "slice" },
        },
        {
          amount: 1,
          gramWeight: -4,
          id: 8,
          measureUnit: { name: "piece" },
        },
        {
          amount: 1,
          gramWeight: 32,
          id: 7,
          measureUnit: { name: "slice" },
        },
      ],
      marketCountry: "United States",
      modifiedDate: "2026-04-02",
      publicationDate: "2026-04-01",
    }),
  );
  const provider = new UsdaFoodDataCentralAdapter({
    apiKey: "registered-test-key",
    baseUrl: "https://example.test/fdc/v1",
    fetchImplementation,
  });

  await expect(provider.getFood("200")).resolves.toEqual({
    authoritativeBaseQuantityMicrounits: 100_000_000,
    authoritativeBaseUnit: "g",
    barcode: null,
    brand: null,
    dataType: "Foundation",
    marketCountry: "United States",
    measurementSummary: "100 g",
    measurements: [
      {
        baseQuantityMicrounits: 32_000_000,
        id: "portion:7",
        label: "1 slice (32 g)",
        unit: "g",
      },
      {
        baseQuantityMicrounits: 100_000_000,
        id: "base:g:100000000",
        label: "100 g",
        unit: "g",
      },
    ],
    name: "Bread, whole-wheat",
    nutritionPerAuthoritativeBase: {
      carbohydrateMilligrams: null,
      energyMilliKcal: 250_000,
      fatMilligrams: 1_500,
      fiberMilligrams: 2_300,
      proteinMilligrams: 0,
      sodiumMilligrams: 120,
      sugarMilligrams: 0,
    },
    provider: "usda-fdc",
    providerFoodId: "200",
    providerModifiedDate: "2026-04-02",
    providerPublishedDate: "2026-04-01",
  });

  const [url, request] = fetchImplementation.mock.calls[0]!;
  expect(String(url)).toContain("/food/200?");
  expect(request?.method).toBe("GET");
});

test("USDA detail preserves branded provenance and provider-backed milliliter servings", async () => {
  const provider = new UsdaFoodDataCentralAdapter({
    apiKey: "registered-test-key",
    baseUrl: "https://example.test/fdc/v1",
    fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        brandOwner: "Example Drinks",
        dataType: "Branded",
        description: "Sparkling water",
        fdcId: 301,
        foodNutrients: [
          { amount: 0, nutrient: { id: 1008, unitName: "KCAL" } },
          { amount: 0.01, nutrient: { id: 1093, unitName: "G" } },
        ],
        gtinUpc: "00012345678905",
        householdServingFullText: "1 can",
        marketCountry: "United States",
        servingSize: 355,
        modifiedDate: "6/23/2023",
        publicationDate: "7/13/2023",
        servingSizeUnit: "MLT",
      }),
    ),
  });

  const food = await provider.getFood("301");
  expect(food).toMatchObject({
    authoritativeBaseUnit: "ml",
    barcode: "00012345678905",
    brand: "Example Drinks",
    measurements: [
      {
        baseQuantityMicrounits: 355_000_000,
        id: "serving:ml:355000000",
        label: "1 can (355 ml)",
        unit: "ml",
      },
      {
        baseQuantityMicrounits: 100_000_000,
        id: "base:ml:100000000",
        label: "100 ml",
        unit: "ml",
      },
    ],
    nutritionPerAuthoritativeBase: {
      energyMilliKcal: 0,
      sodiumMilligrams: 10,
    },
    providerModifiedDate: "2023-06-23",
    providerPublishedDate: "2023-07-13",
  });
});

test("USDA failures are typed without including credentials", async () => {
  await expect(
    new UsdaFoodDataCentralAdapter({
      baseUrl: "https://example.test/fdc/v1",
      fetchImplementation: vi.fn<typeof fetch>(),
    }).search("bread"),
  ).rejects.toBeInstanceOf(CatalogConfigurationError);

  for (const [status, errorType] of [
    [403, CatalogCredentialsError],
    [404, CatalogFoodNotFoundError],
    [429, CatalogRateLimitError],
    [500, CatalogUnavailableError],
  ] as const) {
    const provider = new UsdaFoodDataCentralAdapter({
      apiKey: "secret-value-that-must-not-leak",
      baseUrl: "https://example.test/fdc/v1",
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status })),
    });
    const promise =
      status === 404 ? provider.getFood("123") : provider.search("bread");
    await expect(promise).rejects.toBeInstanceOf(errorType);
    await expect(
      promise.catch((error: Error) => error.message),
    ).resolves.not.toContain("secret-value-that-must-not-leak");
  }
});

test("an empty deployment credential is a user-safe missing configuration", async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("FDC_API_KEY", "");
  vi.stubEnv("FOOD_CATALOG_TEST_FIXTURE", "0");
  setFoodCatalogProviderForTests(undefined);

  await expect(getFoodCatalogProvider().search("bread")).rejects.toBeInstanceOf(
    CatalogConfigurationError,
  );

});

test("USDA malformed JSON, schema drift, and contradictory nutrient units are invalid responses", async () => {
  const malformed = new UsdaFoodDataCentralAdapter({
    apiKey: "registered-test-key",
    baseUrl: "https://example.test/fdc/v1",
    fetchImplementation: vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not-json", { status: 200 })),
  });
  await expect(malformed.search("bread")).rejects.toBeInstanceOf(
    CatalogInvalidResponseError,
  );

  const drifted = new UsdaFoodDataCentralAdapter({
    apiKey: "registered-test-key",
    baseUrl: "https://example.test/fdc/v1",
    fetchImplementation: vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({
          foods: [{ dataType: "Branded", description: "Bread" }],
        }),
      ),
  });
  await expect(drifted.search("bread")).rejects.toBeInstanceOf(
    CatalogInvalidResponseError,
  );

  const wrongUnit = new UsdaFoodDataCentralAdapter({
    apiKey: "registered-test-key",
    baseUrl: "https://example.test/fdc/v1",
    fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        dataType: "Foundation",
        description: "Bread",
        fdcId: 44,
        foodNutrients: [{ amount: 10, nutrient: { id: 1003, unitName: "MG" } }],
      }),
    ),
  });
  await expect(wrongUnit.getFood("44")).rejects.toBeInstanceOf(
    CatalogInvalidResponseError,
  );

  const networkFailure = new UsdaFoodDataCentralAdapter({
    apiKey: "registered-test-key",
    baseUrl: "https://example.test/fdc/v1",
    fetchImplementation: vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("network details")),
  });
  await expect(networkFailure.search("bread")).rejects.toBeInstanceOf(
    CatalogUnavailableError,
  );
});
