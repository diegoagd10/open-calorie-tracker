import { offArchive, offWithBasis } from "./support/off-archive";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getCatalogManagement, shutdownCatalogManagement } from "../app/catalog-management/runtime.server";
import { shutdownApplicationDatabase } from "../app/database/runtime.server";
import { Readable } from "node:stream";
import { foundationArchive } from "./support/foundation-archive";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  CatalogConfigurationError,
  CatalogCredentialsError,
  CatalogFoodNotFoundError,
  CatalogInvalidResponseError,
  CatalogNutritionUnavailableError,
  CatalogRateLimitError,
  CatalogUnavailableError,
  CatalogUnsafeMeasurementError,
  CatalogUnknownProviderError,
  CatalogUnsupportedCapabilityError,
  FoodCatalog,
  type BarcodeFoodCatalogProvider,
  type SearchFoodCatalogProvider,
} from "../app/catalog/food-catalog.server";
import {
  getFoodCatalog,
  getFoodCatalogProvider,
  setFoodCatalogForTests,
  setFoodCatalogProviderForTests,
} from "../app/catalog/runtime.server";
import {
  TestFoodCatalogProvider,
  TestOpenFoodFactsProvider,
} from "../app/catalog/test-fixture.server";
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
    [
      new CatalogNutritionUnavailableError(),
      "CatalogNutritionUnavailableError",
      "The catalog food has no usable nutrition per serving",
    ],
    [
      new CatalogUnknownProviderError(),
      "CatalogUnknownProviderError",
      "The food catalog provider is unavailable",
    ],
    [
      new CatalogUnsupportedCapabilityError(),
      "CatalogUnsupportedCapabilityError",
      "The food catalog provider does not support that operation",
    ],
  ] as const;

  for (const [error, name, message] of expected) {
    expect(error).toMatchObject({ message, name });
  }
});

test("catalog dispatches by registered provider and capability", async () => {
  const usda = new TestFoodCatalogProvider();
  const barcodeFood = await usda.getFood("1001");
  const openFoodFacts: BarcodeFoodCatalogProvider = {
    async getFood() {
      return { ...barcodeFood, provider: "open-food-facts" };
    },
    async lookupBarcode() {
      return { ...barcodeFood, provider: "open-food-facts" };
    },
  };
  const catalog = new FoodCatalog([
    { capability: "search", provider: "usda-fdc", service: usda },
    {
      capability: "barcode",
      provider: "open-food-facts",
      service: openFoodFacts,
    },
  ]);

  await expect(catalog.search("usda-fdc", "yogurt")).resolves.toHaveLength(1);
  await expect(
    catalog.lookupBarcode("open-food-facts", "034000470693"),
  ).resolves.toMatchObject({ provider: "open-food-facts" });
  await expect(catalog.getFood("open-food-facts", "0034000470693"))
    .resolves.toMatchObject({ provider: "open-food-facts" });
  await expect(catalog.search("open-food-facts", "yogurt")).rejects
    .toBeInstanceOf(CatalogUnsupportedCapabilityError);
  await expect(catalog.lookupBarcode("usda-fdc", "034000470693")).rejects
    .toBeInstanceOf(CatalogUnsupportedCapabilityError);
  await expect(catalog.getFood("unknown", "1")).rejects
    .toBeInstanceOf(CatalogUnknownProviderError);
});

test("catalog rejects conflicting registrations and provider identity mismatches", async () => {
  const usda = new TestFoodCatalogProvider();
  const other: BarcodeFoodCatalogProvider = {
    getFood: usda.getFood.bind(usda),
    lookupBarcode: usda.getFood.bind(usda),
  };
  expect(
    () =>
      new FoodCatalog([
        { capability: "search", provider: "usda-fdc", service: usda },
        { capability: "barcode", provider: "usda-fdc", service: other },
      ]),
  ).toThrow(CatalogConfigurationError);

  const mismatchedSearch: SearchFoodCatalogProvider = {
    async getFood() {
      return { ...(await usda.getFood("1001")), provider: "open-food-facts" };
    },
    async search() {
      return [
        {
          ...(await usda.search("yogurt"))[0],
          provider: "open-food-facts",
        },
      ];
    },
  };
  const mismatchedBarcode: BarcodeFoodCatalogProvider = {
    async getFood() {
      return usda.getFood("1001");
    },
    async lookupBarcode() {
      return usda.getFood("1001");
    },
  };
  const catalog = new FoodCatalog([
    {
      capability: "search",
      provider: "usda-fdc",
      service: mismatchedSearch,
    },
    {
      capability: "barcode",
      provider: "open-food-facts",
      service: mismatchedBarcode,
    },
  ]);
  await expect(catalog.search("usda-fdc", "yogurt")).rejects.toBeInstanceOf(
    CatalogInvalidResponseError,
  );
  await expect(
    catalog.lookupBarcode("open-food-facts", "034000470693"),
  ).rejects.toBeInstanceOf(CatalogInvalidResponseError);
  await expect(
    catalog.getFood("open-food-facts", "0034000470693"),
  ).rejects.toBeInstanceOf(CatalogInvalidResponseError);
  await expect(catalog.search("missing", "yogurt")).rejects.toBeInstanceOf(
    CatalogUnknownProviderError,
  );
  await expect(
    catalog.lookupBarcode("missing", "034000470693"),
  ).rejects.toBeInstanceOf(CatalogUnknownProviderError);
});

test("catalog merges capabilities registered on the same service", async () => {
  const usda = new TestFoodCatalogProvider();
  const service = {
    getFood: usda.getFood.bind(usda),
    lookupBarcode: usda.getFood.bind(usda),
    search: usda.search.bind(usda),
  };
  const catalog = new FoodCatalog([
    { capability: "search", provider: "usda-fdc", service },
    { capability: "barcode", provider: "usda-fdc", service },
  ]);
  await expect(catalog.search("usda-fdc", "yogurt")).resolves.toHaveLength(1);
  await expect(catalog.lookupBarcode("usda-fdc", "1001")).resolves.toMatchObject({
    provider: "usda-fdc",
  });
});

test("the catalog registry can be installed only in tests", () => {
  const catalog = new FoodCatalog([]);
  setFoodCatalogForTests(catalog);
  expect(getFoodCatalog()).toBe(catalog);
  vi.stubEnv("NODE_ENV", "production");
  expect(() => setFoodCatalogForTests(undefined)).toThrow(
    "Catalog test doubles are available only in tests",
  );
});

test("deterministic barcode fixture exposes its detail capability directly", async () => {
  await expect(new TestOpenFoodFactsProvider().getFood("034000470693")).resolves
    .toEqual({
      authoritativeBaseQuantityMicrounits: 1_000_000,
      authoritativeBaseUnit: "serving",
      barcode: "0034000470693",
      brand: "Example Foods",
      dataType: "Open Food Facts",
      isSelectable: true,
      marketCountry: "United States",
      measurementSummary: "1 serving",
      measurements: [
        {
          baseQuantityMicrounits: 1_000_000,
          id: "serving",
          label: "1 serving",
          unit: "serving",
        },
      ],
      name: "Example cereal",
      nutritionPerAuthoritativeBase: {
        carbohydrateMilligrams: { amount: 24, fixedPointMultiplier: 1_000 },
        energyMilliKcal: { amount: 180, fixedPointMultiplier: 1_000 },
        fatMilligrams: { amount: 0, fixedPointMultiplier: 1_000 },
        fiberMilligrams: null,
        proteinMilligrams: null,
        sodiumMilligrams: null,
        sugarMilligrams: null,
      },
      originalName: "Example cereal",
      provider: "open-food-facts",
      providerFoodId: "0034000470693",
      providerModifiedDate: null,
      providerPublishedDate: null,
    });
  await expect(new TestOpenFoodFactsProvider().lookupBarcode("0000000000006"))
    .resolves.toMatchObject({
      barcode: "0000000000006",
      brand: null,
      name: "Unnamed product",
      originalName: "Unnamed product",
    });
  await expect(new TestOpenFoodFactsProvider().lookupBarcode("0034000470693"))
    .resolves.toMatchObject({
      barcode: "0034000470693",
      providerFoodId: "0034000470693",
    });
  await expect(new TestOpenFoodFactsProvider().lookupBarcode("1234567"))
    .resolves.toMatchObject({ barcode: "1234567", providerFoodId: "1234567" });
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
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "catalog-runtime-"));
    vi.stubEnv("DATABASE_PATH", path.join(directory, "application.sqlite"));
    vi.stubEnv("CATALOG_DIRECTORY", path.join(directory, "catalogs"));
  });
  afterEach(async () => {
    await shutdownCatalogManagement();
    shutdownApplicationDatabase();
    await rm(directory, { recursive: true, force: true });
  });
  test("installed OFF works with retired API configuration absent and never contacts the food API", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("FOOD_CATALOG_TEST_FIXTURE", "0");
    vi.stubEnv("OPEN_FOOD_FACTS_CONTACT_EMAIL", "");
    vi.stubEnv("OFF_CATALOG_MAX_UPLOAD_BYTES", "1000000");
    vi.stubEnv("OFF_CATALOG_MAX_EXPANDED_BYTES", "10000000");
    const network = vi.fn(() => { throw new Error("Food API access is forbidden"); });
    vi.stubGlobal("fetch", network);
    const management = getCatalogManagement("open-food-facts");
    await management.submitArchive({ filename: "products.gz", stream: Readable.from(offArchive([offWithBasis("100g")])) });
    await vi.waitFor(() => expect(management.read().busy).toBe(false));
    await expect(getFoodCatalog().lookupBarcode("open-food-facts", "0012345678905")).resolves.toMatchObject({ provider: "open-food-facts", authoritativeBaseUnit: "g", isSelectable: true });
    expect(network).not.toHaveBeenCalled();
  });

  test.each([undefined, "", "   "])(
    "absent catalog reports unavailable regardless of retired contact setting %j",
    async (OPEN_FOOD_FACTS_CONTACT_EMAIL) => {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("FDC_API_KEY", "runtime-catalog-key");
      vi.stubEnv("FDC_BASE_URL", "https://example.test/fdc/v1");
      vi.stubEnv("OPEN_FOOD_FACTS_BASE_URL", "https://example.test");
      vi.stubEnv("OPEN_FOOD_FACTS_CONTACT_EMAIL", OPEN_FOOD_FACTS_CONTACT_EMAIL);
      vi.stubEnv("FOOD_CATALOG_TEST_FIXTURE", "0");
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>().mockResolvedValue(
          new Response(JSON.stringify({ foods: [] }), { status: 200 }),
        ),
      );

      await expect(getFoodCatalog().search("usda-fdc", "bread"))
        .rejects.toBeInstanceOf(CatalogConfigurationError);
      await expect(
        getFoodCatalog().lookupBarcode("open-food-facts", "034000470693"),
      ).rejects.toBeInstanceOf(CatalogConfigurationError);
    },
  );

  test("installed USDA ignores former food API credentials and uses no network", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("FOOD_CATALOG_TEST_FIXTURE", "0");
    vi.stubEnv("FDC_API_KEY", "");
    vi.stubEnv("FDC_BASE_URL", "not-a-url");
    vi.stubEnv("FDC_TIMEOUT_MS", "not-a-timeout");
    const network = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", network);
    const management = getCatalogManagement();
    await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(await foundationArchive()) });
    await vi.waitFor(() => expect(management.read().busy).toBe(false));
    expect((await getFoodCatalog().search("usda-fdc", "broccoli")).map(food => food.providerFoodId)).toEqual(["747447", "321900"]);
    expect(network).not.toHaveBeenCalled();
  });

  test("an absent catalog remains a user-safe missing configuration", async () => {
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
    const replacement: SearchFoodCatalogProvider = {
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

  test("fixture flag outside test mode still selects the local adapter", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FOOD_CATALOG_TEST_FIXTURE", "1");
    await expect(getFoodCatalogProvider().search("bread")).rejects.toBeInstanceOf(
      CatalogConfigurationError,
    );
  });

  test("rejects malformed fixture switches", () => {
    vi.stubEnv("NODE_ENV", "test");
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
