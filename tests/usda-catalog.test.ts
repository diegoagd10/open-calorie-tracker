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
          marketCountry: "United States",
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
          marketCountry: "United States",
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
      isSelectable: true,
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
      isSelectable: true,
      measurementSummary: "100 g",
      name: "Bread, whole-wheat",
      provider: "usda-fdc",
      providerFoodId: "200",
      providerPublishedDate: "2026-04-01",
    },
  ]);

  expect(fetchImplementation).toHaveBeenCalledOnce();
  const [url, request] = fetchImplementation.mock.calls[0];
  expect(String(url)).not.toContain("yogurt");
  expect(String(url)).toContain("api_key=registered-test-key");
  expect(JSON.parse(String(request?.body))).toEqual({
    dataType: ["Foundation", "Branded"],
    pageSize: 20,
    query: "yogurt",
  });
});

test("USDA detail applies Foundation energy precedence and keeps only safe measurements", async () => {
  const onDiagnostic = vi.fn();
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
        { amount: -0.2, nutrient: { id: 1005, unitName: "g" } },
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
          id: 9,
          measureUnit: { name: "malformed missing weight" },
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
    onDiagnostic,
  });

  await expect(provider.getFood("200")).resolves.toEqual({
    authoritativeBaseQuantityMicrounits: 100_000_000,
    authoritativeBaseUnit: "g",
    barcode: null,
    brand: null,
    dataType: "Foundation",
    isSelectable: true,
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
      energyMilliKcal: { amount: 250, fixedPointMultiplier: 1_000 },
      fatMilligrams: { amount: 1.5, fixedPointMultiplier: 1_000 },
      fiberMilligrams: { amount: 2.3, fixedPointMultiplier: 1_000 },
      proteinMilligrams: { amount: 0, fixedPointMultiplier: 1_000 },
      sodiumMilligrams: { amount: 120, fixedPointMultiplier: 1 },
      sugarMilligrams: { amount: 0, fixedPointMultiplier: 1_000 },
    },
    originalName: "Bread, whole-wheat",
    provider: "usda-fdc",
    providerFoodId: "200",
    providerModifiedDate: "2026-04-02",
    providerPublishedDate: "2026-04-01",
  });

  const [url, request] = fetchImplementation.mock.calls[0];
  expect(String(url)).toContain("/food/200?");
  expect(request?.method).toBe("GET");
  expect(onDiagnostic).toHaveBeenCalledWith({
    code: "negative_nutrient_amount",
    nutrientId: 1005,
    providerFoodId: "200",
  });
  expect(onDiagnostic).toHaveBeenCalledTimes(1);
});

test("USDA detail falls back to the abridged format for the Grade A egg white result", async () => {
  const fetchImplementation = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(
      jsonResponse({
        dataType: "Foundation",
        description: "Eggs, Grade A, Large, egg white",
        fdcId: 747997,
        foodNutrients: [
          { amount: 55, name: "Energy", number: "208", unitName: "KCAL" },
          { amount: 10.7, name: "Protein", number: "203", unitName: "G" },
          {
            amount: 0,
            name: "Total lipid (fat)",
            number: "204",
            unitName: "G",
          },
          {
            amount: 2.36,
            name: "Carbohydrate, by difference",
            number: "205",
            unitName: "G",
          },
          {
            amount: 0.1,
            name: "Sugars, added",
            number: "269.3",
            unitName: "G",
          },
        ],
        ndbNumber: 1123,
        publicationDate: "2019-12-16",
      }),
    );
  const provider = new UsdaFoodDataCentralAdapter({
    apiKey: "registered-test-key",
    baseUrl: "https://example.test/fdc/v1",
    fetchImplementation,
  });

  await expect(provider.getFood("747997")).resolves.toMatchObject({
    authoritativeBaseUnit: "g",
    dataType: "Foundation",
    measurements: [
      {
        baseQuantityMicrounits: 100_000_000,
        id: "base:g:100000000",
        label: "100 g",
        unit: "g",
      },
    ],
    name: "Eggs, Grade A, Large, egg white",
    nutritionPerAuthoritativeBase: {
      carbohydrateMilligrams: { amount: 2.36, fixedPointMultiplier: 1_000 },
      energyMilliKcal: { amount: 55, fixedPointMultiplier: 1_000 },
      fatMilligrams: { amount: 0, fixedPointMultiplier: 1_000 },
      proteinMilligrams: { amount: 10.7, fixedPointMultiplier: 1_000 },
    },
    providerFoodId: "747997",
    providerPublishedDate: "2019-12-16",
  });

  expect(fetchImplementation).toHaveBeenCalledTimes(2);
  expect(String(fetchImplementation.mock.calls[0]?.[0])).toContain(
    "/food/747997?",
  );
  expect(String(fetchImplementation.mock.calls[1]?.[0])).toContain(
    "/food/747997?format=abridged&",
  );
});

test("USDA detail ignores Foundation nutrient group rows without amounts", async () => {
  const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
    jsonResponse({
      dataType: "Foundation",
      description: "Avocado, Hass, peeled, raw",
      fdcId: 2710824,
      foodNutrients: [
        {
          nutrient: { id: 2045, unitName: "g" },
          type: "FoodNutrient",
        },
        {
          amount: 223.334,
          nutrient: { id: 2047, unitName: "kcal" },
          type: "FoodNutrient",
        },
        {
          amount: 1.81,
          nutrient: { id: 1003, unitName: "g" },
          type: "FoodNutrient",
        },
      ],
      foodPortions: [
        {
          amount: 1,
          gramWeight: 140,
          id: 312657,
          measureUnit: { abbreviation: "RACC", name: "RACC" },
        },
      ],
      publicationDate: "2024-10-31",
    }),
  );
  const provider = new UsdaFoodDataCentralAdapter({
    apiKey: "registered-test-key",
    baseUrl: "https://example.test/fdc/v1",
    fetchImplementation,
  });

  await expect(provider.getFood("2710824")).resolves.toMatchObject({
    dataType: "Foundation",
    measurements: [
      {
        baseQuantityMicrounits: 140_000_000,
        id: "portion:312657",
        label: "1 RACC (140 g)",
        unit: "g",
      },
      {
        baseQuantityMicrounits: 100_000_000,
        id: "base:g:100000000",
        label: "100 g",
        unit: "g",
      },
    ],
    name: "Avocado, Hass, peeled, raw",
    nutritionPerAuthoritativeBase: {
      energyMilliKcal: { amount: 223.334, fixedPointMultiplier: 1_000 },
      proteinMilligrams: { amount: 1.81, fixedPointMultiplier: 1_000 },
    },
    providerFoodId: "2710824",
  });
  expect(fetchImplementation).toHaveBeenCalledTimes(1);
});

test("USDA detail falls back after a transient full-detail failure and maps modern Foundation energy", async () => {
  const fetchImplementation = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(
      jsonResponse({
        dataType: "Foundation",
        description: "Avocado, Hass, peeled, raw",
        fdcId: 2710824,
        foodNutrients: [
          {
            amount: 223,
            name: "Energy (Atwater General Factors)",
            number: "957",
            unitName: "KCAL",
          },
          {
            amount: 206,
            name: "Energy (Atwater Specific Factors)",
            number: "958",
            unitName: "KCAL",
          },
          { amount: 1.81, name: "Protein", number: "203", unitName: "G" },
        ],
        publicationDate: "2024-10-31",
      }),
    );
  const provider = new UsdaFoodDataCentralAdapter({
    apiKey: "registered-test-key",
    baseUrl: "https://example.test/fdc/v1",
    fetchImplementation,
  });

  await expect(provider.getFood("2710824")).resolves.toMatchObject({
    name: "Avocado, Hass, peeled, raw",
    nutritionPerAuthoritativeBase: {
      energyMilliKcal: { amount: 206, fixedPointMultiplier: 1_000 },
      proteinMilligrams: { amount: 1.81, fixedPointMultiplier: 1_000 },
    },
    providerFoodId: "2710824",
  });
  expect(fetchImplementation).toHaveBeenCalledTimes(2);
  expect(String(fetchImplementation.mock.calls[1]?.[0])).toContain(
    "/food/2710824?format=abridged&",
  );
});

test("USDA diagnostics use redacted structured request logs", async () => {
  const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const provider = new UsdaFoodDataCentralAdapter({
      apiKey: "diagnostic-secret-api-key",
      baseUrl: "https://example.test/fdc/v1",
      fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          dataType: "Foundation",
          description: "Private diagnostic food",
          fdcId: 987654,
          foodNutrients: [
            { amount: -1, nutrient: { id: 1003, unitName: "g" } },
          ],
          publicationDate: "2026-04-01",
        }),
      ),
    });

    await provider.getFood("987654", {
      requestId: "catalog-diagnostic-request",
    });

    expect(stderr).toHaveBeenCalledOnce();
    const diagnostic = JSON.parse(
      String(stderr.mock.calls[0]?.[0]),
    ) as unknown;
    expect(diagnostic).toMatchObject({
      code: "negative_nutrient_amount",
      event: "food_catalog_diagnostic",
      level: "warn",
      nutrientId: 1003,
      requestId: "catalog-diagnostic-request",
      timestamp: expect.any(String) as unknown,
    });
    expect(JSON.stringify(diagnostic)).not.toContain("diagnostic-secret-api-key");
    expect(diagnostic).not.toHaveProperty("providerFoodId");
  } finally {
    stderr.mockRestore();
  }
});

test("USDA detail preserves branded provenance and a provider-backed milliliter basis", async () => {
  const provider = new UsdaFoodDataCentralAdapter({
    apiKey: "registered-test-key",
    baseUrl: "https://example.test/fdc/v1",
    fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        brandOwner: "Example Drinks",
        dataType: "Branded",
        description: "  Sparkling water  ",
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
    name: "Sparkling water",
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
      energyMilliKcal: { amount: 0, fixedPointMultiplier: 1_000 },
      sodiumMilligrams: { amount: 0.01, fixedPointMultiplier: 1_000 },
    },
    originalName: "  Sparkling water  ",
    providerModifiedDate: "2023-06-23",
    providerPublishedDate: "2023-07-13",
  });
});

test("USDA search excludes branded foods outside the confirmed United States market", async () => {
  const provider = new UsdaFoodDataCentralAdapter({
    apiKey: "registered-test-key",
    baseUrl: "https://example.test/fdc/v1",
    fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        foods: [
          {
            dataType: "Branded",
            description: "United States product",
            fdcId: 401,
            marketCountry: "United States",
          },
          {
            dataType: "Branded",
            description: "New Zealand product",
            fdcId: 402,
            marketCountry: "New Zealand",
          },
          {
            dataType: "Foundation",
            description: "Generic food",
            fdcId: 403,
          },
        ],
      }),
    ),
  });

  await expect(provider.search("food")).resolves.toMatchObject([
    { name: "United States product", providerFoodId: "401" },
    { name: "Generic food", providerFoodId: "403" },
  ]);
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

test("an empty live evidence credential is a user-safe missing configuration", async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("FDC_API_KEY", "");
  vi.stubEnv("FOOD_CATALOG_TEST_FIXTURE", "0");
  setFoodCatalogProviderForTests(undefined);

  await expect(new UsdaFoodDataCentralAdapter({ apiKey: "" }).search("bread")).rejects.toBeInstanceOf(
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
    fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(
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

  const timedOut = new UsdaFoodDataCentralAdapter({
    apiKey: "registered-test-key",
    baseUrl: "https://example.test/fdc/v1",
    fetchImplementation: vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("provider request aborted", "AbortError"));
          });
        }),
    ),
    timeoutMs: 1,
  });
  await expect(timedOut.search("bread")).rejects.toBeInstanceOf(
    CatalogUnavailableError,
  );

  const aborted = new UsdaFoodDataCentralAdapter({
    apiKey: "registered-test-key",
    baseUrl: "https://example.test/fdc/v1",
    fetchImplementation: vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException("aborted", "AbortError")),
  });
  await expect(aborted.search("bread")).rejects.toBeInstanceOf(
    CatalogUnavailableError,
  );
});
