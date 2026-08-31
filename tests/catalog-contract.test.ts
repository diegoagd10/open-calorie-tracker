import { afterEach, describe, expect, test, vi } from "vitest";

import {
  CatalogConfigurationError,
  CatalogCredentialsError,
  CatalogFoodNotFoundError,
  CatalogInvalidResponseError,
  CatalogRateLimitError,
  CatalogUnavailableError,
  CatalogUnsafeMeasurementError,
  type FoodCatalogProvider,
} from "../app/catalog/food-catalog.server";
import {
  getFoodCatalogProvider,
  setFoodCatalogProviderForTests,
} from "../app/catalog/runtime.server";
import { TestFoodCatalogProvider } from "../app/catalog/test-fixture.server";
import {
  applicationOrigin,
  isProductionEnvironment,
  isTestEnvironment,
} from "../app/runtime.server";

afterEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  setFoodCatalogProviderForTests(undefined);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("catalog errors expose stable safe names and messages", () => {
  const expected = [
    [
      new CatalogConfigurationError(),
      "CatalogConfigurationError",
      "The food catalog is not configured",
    ],
    [
      new CatalogCredentialsError(),
      "CatalogCredentialsError",
      "The food catalog credentials were rejected",
    ],
    [
      new CatalogRateLimitError(),
      "CatalogRateLimitError",
      "The food catalog rate limit was reached",
    ],
    [
      new CatalogUnavailableError(),
      "CatalogUnavailableError",
      "The food catalog is unavailable",
    ],
    [
      new CatalogInvalidResponseError(),
      "CatalogInvalidResponseError",
      "The food catalog returned an invalid response",
    ],
    [
      new CatalogFoodNotFoundError(),
      "CatalogFoodNotFoundError",
      "The selected catalog food is no longer available",
    ],
    [
      new CatalogUnsafeMeasurementError(),
      "CatalogUnsafeMeasurementError",
      "The selected catalog measurement is unavailable",
    ],
  ] as const;

  for (const [error, name, message] of expected) {
    expect(error).toMatchObject({ message, name });
  }
});

describe("deterministic catalog fixture", () => {
  const provider = new TestFoodCatalogProvider();

  test("returns the complete yogurt search and detail contract", async () => {
    await expect(provider.search("  YOGURT  ")).resolves.toEqual([
      {
        barcode: "0012345678905",
        brand: "Example Dairy Co.",
        dataType: "Branded",
        isSelectable: true,
        measurementSummary: "1 container · 170 g",
        name: "Plain nonfat Greek yogurt",
        provider: "usda-fdc",
        providerFoodId: "1001",
        providerPublishedDate: "2026-04-01",
      },
    ]);
    await expect(provider.getFood("1001")).resolves.toEqual({
      authoritativeBaseQuantityMicrounits: 100_000_000,
      authoritativeBaseUnit: "g",
      barcode: "0012345678905",
      brand: "Example Dairy Co.",
      dataType: "Branded",
      isSelectable: true,
      marketCountry: "United States",
      measurementSummary: "1 container · 170 g",
      measurements: [
        {
          baseQuantityMicrounits: 170_000_000,
          id: "serving:g:170000000",
          label: "1 container (170 g)",
          unit: "g",
        },
        {
          baseQuantityMicrounits: 100_000_000,
          id: "base:g:100000000",
          label: "100 g",
          unit: "g",
        },
      ],
      name: "Plain nonfat Greek yogurt",
      nutritionPerAuthoritativeBase: {
        carbohydrateMilligrams: { amount: 3.53, fixedPointMultiplier: 1_000 },
        energyMilliKcal: { amount: 59, fixedPointMultiplier: 1_000 },
        fatMilligrams: { amount: 0, fixedPointMultiplier: 1_000 },
        fiberMilligrams: null,
        proteinMilligrams: { amount: 10.59, fixedPointMultiplier: 1_000 },
        sodiumMilligrams: { amount: 36, fixedPointMultiplier: 1 },
        sugarMilligrams: { amount: 3.53, fixedPointMultiplier: 1_000 },
      },
      originalName: "Plain nonfat Greek yogurt",
      provider: "usda-fdc",
      providerFoodId: "1001",
      providerModifiedDate: "2026-04-02",
      providerPublishedDate: "2026-04-01",
    });
  });

  test("exposes every deterministic search outcome", async () => {
    await expect(provider.search("none")).resolves.toEqual([]);
    await expect(provider.search("unsafe")).resolves.toMatchObject([
      {
        isSelectable: false,
        measurementSummary: "Measurement unavailable",
        name: "Unsafe provider measurement",
        providerFoodId: "9999",
      },
    ]);
    await expect(provider.search("vanished")).resolves.toMatchObject([
      { name: "Vanished catalog food", providerFoodId: "4040" },
      { name: "Plain nonfat Greek yogurt", providerFoodId: "1001" },
    ]);
  });

  test.each([
    ["configuration", CatalogConfigurationError],
    [" CREDENTIALS ", CatalogCredentialsError],
    ["rate", CatalogRateLimitError],
    ["unavailable", CatalogUnavailableError],
    ["timeout", CatalogUnavailableError],
    ["malformed", CatalogInvalidResponseError],
  ] as const)("search %s throws %s", async (query, ErrorType) => {
    await expect(provider.search(query)).rejects.toBeInstanceOf(ErrorType);
  });

  test.each([
    ["4040", CatalogFoodNotFoundError],
    ["9999", CatalogUnsafeMeasurementError],
    ["7000", CatalogUnavailableError],
  ] as const)("detail %s throws %s", async (providerFoodId, ErrorType) => {
    await expect(provider.getFood(providerFoodId)).rejects.toBeInstanceOf(
      ErrorType,
    );
  });
});

describe("catalog runtime selection", () => {
  test("trims a configured credential before passing it to the live provider", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("FDC_API_KEY", "  runtime-catalog-key  ");
    vi.stubEnv("FDC_BASE_URL", "https://example.test/fdc/v1");
    vi.stubEnv("FDC_TIMEOUT_MS", "100");
    vi.stubEnv("FOOD_CATALOG_TEST_FIXTURE", "0");
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ foods: [] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchImplementation);

    await expect(getFoodCatalogProvider().search("bread")).resolves.toEqual([]);

    expect(String(fetchImplementation.mock.calls[0]?.[0])).toBe(
      "https://example.test/fdc/v1/foods/search?api_key=runtime-catalog-key",
    );
  });

  test("whitespace credentials remain a user-safe missing configuration", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("FDC_API_KEY", "   ");
    vi.stubEnv("FOOD_CATALOG_TEST_FIXTURE", "0");
    const provider = getFoodCatalogProvider();
    await expect(provider.search("bread")).rejects.toBeInstanceOf(
      CatalogConfigurationError,
    );
  });

  test("fixture is selected only by the explicit test flag", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("FOOD_CATALOG_TEST_FIXTURE", "1");
    const provider = getFoodCatalogProvider();
    expect(provider).toBeInstanceOf(TestFoodCatalogProvider);
    await expect(provider.search("yogurt")).resolves.toHaveLength(1);
  });

  test("the provider instance is cached and can be replaced in tests", () => {
    vi.stubEnv("NODE_ENV", "test");
    const replacement: FoodCatalogProvider = {
      async getFood() {
        throw new Error("unused");
      },
      async search() {
        return [];
      },
    };
    setFoodCatalogProviderForTests(replacement);
    expect(getFoodCatalogProvider()).toBe(replacement);
    expect(getFoodCatalogProvider()).toBe(replacement);
  });

  test("fixture flag outside test mode still selects the live adapter", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FOOD_CATALOG_TEST_FIXTURE", "1");
    await expect(getFoodCatalogProvider().search("bread")).rejects.toBeInstanceOf(
      CatalogConfigurationError,
    );
  });

  test.each(["99", "20001", "100.5", "not-a-timeout"])(
    "rejects invalid catalog timeout %s",
    (FDC_TIMEOUT_MS) => {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("FDC_TIMEOUT_MS", FDC_TIMEOUT_MS);
      expect(() => getFoodCatalogProvider()).toThrow();
    },
  );

  test("rejects malformed base URLs and fixture switches", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("FDC_BASE_URL", "not-a-url");
    expect(() => getFoodCatalogProvider()).toThrow();
    setFoodCatalogProviderForTests(undefined);
    vi.stubEnv("FDC_BASE_URL", "https://example.test/fdc/v1");
    vi.stubEnv("FOOD_CATALOG_TEST_FIXTURE", "yes");
    expect(() => getFoodCatalogProvider()).toThrow();
  });

  test("doubles cannot be installed outside tests", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => setFoodCatalogProviderForTests(undefined)).toThrow(
      "Catalog test doubles are available only in tests",
    );
  });
});

describe("application runtime environment", () => {
  test("application origin uses the configured URL without path details", () => {
    vi.stubEnv("APPLICATION_URL", "https://calories.example.test/path?q=1");
    expect(applicationOrigin()).toBe("https://calories.example.test");
  });

  test.each([
    [undefined, "http://localhost:3000"],
    ["4173", "http://localhost:4173"],
  ])("application origin falls back from port %s", (PORT, expected) => {
    vi.stubEnv("APPLICATION_URL", undefined);
    vi.stubEnv("PORT", PORT);
    expect(applicationOrigin()).toBe(expected);
  });

  test.each([
    ["production", true, false],
    ["test", false, true],
    ["development", false, false],
  ])("recognizes %s mode", (NODE_ENV, production, testMode) => {
    vi.stubEnv("NODE_ENV", NODE_ENV);
    expect(isProductionEnvironment()).toBe(production);
    expect(isTestEnvironment()).toBe(testMode);
  });
});
