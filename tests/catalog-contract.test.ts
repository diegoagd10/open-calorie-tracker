import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getCatalogManagement, shutdownCatalogManagement } from "../app/catalog-management/runtime.server";
import { shutdownApplicationDatabase } from "../app/database/runtime.server";
import { Readable } from "node:stream";
import { foundationArchive } from "./support/foundation-archive";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  CatalogRegistrationConflictError,
  CatalogInvalidDataError,
  CatalogFoodNotFoundError,
  CatalogNotInstalledError,
  CatalogNutritionUnavailableError,
  CatalogUnavailableError,
  CatalogUnsafeMeasurementError,
  CatalogUnknownProviderError,
  FoodCatalog,
  type SearchFoodCatalogProvider,
} from "../app/catalog/food-catalog.server";
import {
  getFoodCatalog,
  getFoodCatalogProvider,
  setFoodCatalogForTests,
  setFoodCatalogProviderForTests,
} from "../app/catalog/runtime.server";
import { TEST_CATALOG_GENERATION, TestFoodCatalogProvider } from "../app/catalog/test-fixture.server";
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
      new CatalogNotInstalledError(),
      "CatalogNotInstalledError",
      "The food catalog is not installed",
    ],
    [
      new CatalogUnavailableError(),
      "CatalogUnavailableError",
      "The food catalog is unavailable",
    ],
    [
      new CatalogInvalidDataError(),
      "CatalogInvalidDataError",
      "The food catalog contains invalid data",
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
  ] as const;

  for (const [error, name, message] of expected) {
    expect(error).toMatchObject({ message, name });
  }
});

test("catalog dispatches to the registered USDA provider only", async () => {
  const usda = new TestFoodCatalogProvider();
  const catalog = new FoodCatalog([
    { capability: "search", provider: "usda-fdc", service: usda },
  ]);

  await expect(catalog.search("yogurt")).resolves.toHaveLength(1);
  await expect(catalog.getFood("usda-fdc", "1001")).resolves.toMatchObject({ provider: "usda-fdc" });
  // Open Food Facts is looked up live by barcode, which this catalog was not given.
  await expect(catalog.getFood("open-food-facts", "0034000470693")).rejects
    .toBeInstanceOf(CatalogUnknownProviderError);
  await expect(catalog.lookupBarcode("0034000470693")).rejects
    .toBeInstanceOf(CatalogUnknownProviderError);
  await expect(new FoodCatalog([]).search("yogurt")).rejects
    .toBeInstanceOf(CatalogUnknownProviderError);
});

test("catalog looks Open Food Facts products up live by barcode through either read", async () => {
  const usda = new TestFoodCatalogProvider();
  const product = { ...(await usda.getFood("1001")), provider: "open-food-facts" as const, providerFoodId: "0034000470693" };
  const lookups: string[] = [];
  const catalog = new FoodCatalog([], {
    async lookup(barcode) {
      lookups.push(barcode);
      return barcode === "0034000470693" ? product : { ...product, provider: "usda-fdc" };
    },
  });

  await expect(catalog.lookupBarcode("0034000470693")).resolves.toEqual(product);
  await expect(catalog.getFood("open-food-facts", "0034000470693")).resolves.toEqual(product);
  await expect(catalog.lookupBarcode("12345670")).rejects.toBeInstanceOf(CatalogInvalidDataError);
  expect(lookups).toEqual(["0034000470693", "0034000470693", "12345670"]);
});

test("catalog rejects conflicting registrations and provider identity mismatches", async () => {
  const usda = new TestFoodCatalogProvider();
  const service = { getFood: usda.getFood.bind(usda), search: usda.search.bind(usda) };
  expect(
    () =>
      new FoodCatalog([
        { capability: "search", provider: "usda-fdc", service: usda },
        { capability: "search", provider: "usda-fdc", service },
      ]),
  ).toThrow(CatalogRegistrationConflictError);
  expect(
    () =>
      new FoodCatalog([
        { capability: "search", provider: "usda-fdc", service },
        { capability: "search", provider: "usda-fdc", service },
      ]),
  ).not.toThrow();

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
  const catalog = new FoodCatalog([
    {
      capability: "search",
      provider: "usda-fdc",
      service: mismatchedSearch,
    },
  ]);
  await expect(catalog.search("yogurt")).rejects.toBeInstanceOf(
    CatalogInvalidDataError,
  );
  await expect(
    catalog.getFood("usda-fdc", "1001"),
  ).rejects.toBeInstanceOf(CatalogInvalidDataError);
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
      catalogGeneration: TEST_CATALOG_GENERATION,
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
    ["not-installed", CatalogNotInstalledError],
    ["unavailable", CatalogUnavailableError],
    ["malformed", CatalogInvalidDataError],
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
  test("absent catalogs report not installed without attempting a food lookup request", async () => {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("FOOD_CATALOG_TEST_FIXTURE", "0");
      const network = vi.fn(() => { throw new Error("Food lookup network is forbidden"); });
      vi.stubGlobal("fetch", network);

      await expect(getFoodCatalog().search("bread"))
        .rejects.toBeInstanceOf(CatalogNotInstalledError);
      await expect(getFoodCatalog().getFood("usda-fdc", "1001"))
        .rejects.toBeInstanceOf(CatalogNotInstalledError);
      expect(network).not.toHaveBeenCalled();
  });

  test("installed USDA uses no food lookup network", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("FOOD_CATALOG_TEST_FIXTURE", "0");
    const network = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", network);
    const management = getCatalogManagement();
    await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(await foundationArchive()) });
    await vi.waitFor(() => expect(management.read().busy).toBe(false));
    expect((await getFoodCatalog().search("broccoli")).map(food => food.providerFoodId)).toEqual(["747447", "321900"]);
    expect(network).not.toHaveBeenCalled();
  });

  test("an absent catalog remains a user-safe not-installed state", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("FOOD_CATALOG_TEST_FIXTURE", "0");
    const provider = getFoodCatalogProvider();
    await expect(provider.search("bread")).rejects.toBeInstanceOf(
      CatalogNotInstalledError,
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
      CatalogNotInstalledError,
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
