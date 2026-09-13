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
  CatalogRegistrationConflictError,
  CatalogInvalidDataError,
  CatalogFoodNotFoundError,
  CatalogNotInstalledError,
  CatalogNutritionUnavailableError,
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
  ).toThrow(CatalogRegistrationConflictError);

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
    CatalogInvalidDataError,
  );
  await expect(
    catalog.lookupBarcode("open-food-facts", "034000470693"),
  ).rejects.toBeInstanceOf(CatalogInvalidDataError);
  await expect(
    catalog.getFood("open-food-facts", "0034000470693"),
  ).rejects.toBeInstanceOf(CatalogInvalidDataError);
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

test("catalog composes independent basic and packaged search with filters and stable provider identity", async () => {
  const basic = new TestFoodCatalogProvider();
  const basicFood = (await basic.search("egg"))[0];
  const packagedFood = {
    ...basicFood,
    brand: "Exact Brand",
    dataType: "Open Food Facts" as const,
    name: "Crunch cereal",
    provider: "open-food-facts" as const,
    providerFoodId: "0012345678902",
  };
  const packaged: SearchFoodCatalogProvider = {
    async getFood() {
      return { ...(await basic.getFood("1001")), ...packagedFood };
    },
    async search() {
      return [packagedFood];
    },
  };
  const catalog = new FoodCatalog([
    { capability: "search", provider: "usda-fdc", service: basic },
    { capability: "search", provider: "open-food-facts", service: packaged },
  ]);

  await expect(catalog.searchAll("exact brand", "all")).resolves.toMatchObject({
    groups: [
      { kind: "packaged", provider: "open-food-facts", results: [{ providerFoodId: "0012345678902" }], status: "available" },
      { kind: "basic", provider: "usda-fdc", status: "available" },
    ],
  });
  await expect(catalog.searchAll("egg", "basic")).resolves.toMatchObject({
    groups: [{ kind: "basic", provider: "usda-fdc" }],
  });
});

test("catalog search filters invoke only their selected source", async () => {
  const fixture = new TestFoodCatalogProvider();
  const basicSearch = vi.fn(fixture.search.bind(fixture));
  const packagedSearch = vi.fn(async () => [{
    ...(await fixture.search("egg"))[0],
    dataType: "Open Food Facts" as const,
    provider: "open-food-facts" as const,
    providerFoodId: "0012345678902",
  }]);
  const basic: SearchFoodCatalogProvider = {
    getFood: fixture.getFood.bind(fixture),
    search: basicSearch,
  };
  const packaged: SearchFoodCatalogProvider = {
    async getFood() {
      return { ...(await fixture.getFood("1001")), provider: "open-food-facts" };
    },
    search: packagedSearch,
  };
  const catalog = new FoodCatalog([
    { capability: "search", provider: "usda-fdc", service: basic },
    { capability: "search", provider: "open-food-facts", service: packaged },
  ]);
  const context = { requestId: "search-filter-test" };

  await expect(catalog.searchAll("egg", "basic", context)).resolves.toMatchObject({
    groups: [{ kind: "basic", provider: "usda-fdc", status: "available" }],
  });
  expect(basicSearch).toHaveBeenCalledWith("egg", context);
  expect(packagedSearch).not.toHaveBeenCalled();
  basicSearch.mockClear();

  await expect(catalog.searchAll("egg", "packaged", context)).resolves.toMatchObject({
    groups: [{ kind: "packaged", provider: "open-food-facts", status: "available" }],
  });
  expect(packagedSearch).toHaveBeenCalledWith("egg", context);
  expect(basicSearch).not.toHaveBeenCalled();
});

test("catalog puts only an exact normalized packaged name or brand before basic foods", async () => {
  const fixture = new TestFoodCatalogProvider();
  const basicFood = (await fixture.search("egg"))[0];
  const packagedFood = {
    ...basicFood,
    brand: null as string | null,
    dataType: "Open Food Facts" as const,
    name: "Crème brûlée",
    provider: "open-food-facts" as const,
    providerFoodId: "0012345678902",
  };
  const packaged: SearchFoodCatalogProvider = {
    async getFood() {
      return { ...(await fixture.getFood("1001")), ...packagedFood };
    },
    async search() {
      return [packagedFood];
    },
  };
  const catalog = new FoodCatalog([
    { capability: "search", provider: "usda-fdc", service: fixture },
    { capability: "search", provider: "open-food-facts", service: packaged },
  ]);

  expect((await catalog.searchAll("ordinary query")).groups.map(group => group.kind))
    .toEqual(["basic", "packaged"]);
  expect((await catalog.searchAll(" CREME BRULEE ")).groups.map(group => group.kind))
    .toEqual(["packaged", "basic"]);
  packagedFood.brand = "Mañana Foods";
  packagedFood.name = "Other food";
  expect((await catalog.searchAll("manana foods")).groups.map(group => group.kind))
    .toEqual(["packaged", "basic"]);
});

test("catalog reports absent and capability-only sources as not installed", async () => {
  const fixture = new TestOpenFoodFactsProvider();
  const catalog = new FoodCatalog([
    { capability: "barcode", provider: "open-food-facts", service: fixture },
  ]);

  await expect(catalog.searchAll("cereal")).resolves.toEqual({
    groups: [
      { kind: "basic", provider: "usda-fdc", results: [], status: "not-installed" },
      { kind: "packaged", provider: "open-food-facts", results: [], status: "not-installed" },
    ],
  });
});

test("catalog contains invalid provider results without hiding the healthy source", async () => {
  const fixture = new TestFoodCatalogProvider();
  const packaged: SearchFoodCatalogProvider = {
    async getFood() {
      return { ...(await fixture.getFood("1001")), provider: "open-food-facts" };
    },
    async search() {
      return [{ ...(await fixture.search("egg"))[0], provider: "usda-fdc" }];
    },
  };
  const catalog = new FoodCatalog([
    { capability: "search", provider: "usda-fdc", service: fixture },
    { capability: "search", provider: "open-food-facts", service: packaged },
  ]);

  await expect(catalog.searchAll("egg")).resolves.toMatchObject({
    groups: [
      { kind: "basic", results: [{ provider: "usda-fdc" }], status: "available" },
      { kind: "packaged", results: [], status: "unavailable" },
    ],
  });
});

test.each([
  CatalogInvalidDataError,
  CatalogUnavailableError,
])("catalog contains %s from one search source", async ErrorType => {
  const failing: SearchFoodCatalogProvider = {
    async getFood() { throw new ErrorType(); },
    async search() { throw new ErrorType(); },
  };
  const catalog = new FoodCatalog([
    { capability: "search", provider: "open-food-facts", service: failing },
  ]);

  await expect(catalog.searchAll("egg", "packaged")).resolves.toEqual({
    groups: [{
      kind: "packaged",
      provider: "open-food-facts",
      results: [],
      status: "unavailable",
    }],
  });
});

test("catalog does not swallow unexpected search failures", async () => {
  const failure = new Error("unexpected defect");
  const failing: SearchFoodCatalogProvider = {
    async getFood() { throw failure; },
    async search() { throw failure; },
  };
  const catalog = new FoodCatalog([
    { capability: "search", provider: "open-food-facts", service: failing },
  ]);

  await expect(catalog.searchAll("egg", "packaged")).rejects.toBe(failure);
});

test("catalog search keeps one provider available when the other is not installed", async () => {
  const basic = new TestFoodCatalogProvider();
  const missingPackaged: SearchFoodCatalogProvider = {
    async getFood() { throw new CatalogNotInstalledError(); },
    async search() { throw new CatalogNotInstalledError(); },
  };
  const catalog = new FoodCatalog([
    { capability: "search", provider: "usda-fdc", service: basic },
    { capability: "search", provider: "open-food-facts", service: missingPackaged },
  ]);

  await expect(catalog.searchAll("egg", "all")).resolves.toMatchObject({
    groups: [
      { kind: "basic", provider: "usda-fdc", results: [{ provider: "usda-fdc" }], status: "available" },
      { kind: "packaged", provider: "open-food-facts", results: [], status: "not-installed" },
    ],
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
  test("installed OFF uses no food lookup network", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("FOOD_CATALOG_TEST_FIXTURE", "0");
    vi.stubEnv("OFF_CATALOG_MAX_UPLOAD_BYTES", "1000000");
    vi.stubEnv("OFF_CATALOG_MAX_EXPANDED_BYTES", "10000000"); vi.stubEnv("OFF_CATALOG_MAX_DATABASE_BYTES", "10000000");
    const network = vi.fn(() => { throw new Error("Food API access is forbidden"); });
    vi.stubGlobal("fetch", network);
    const management = getCatalogManagement("open-food-facts");
    await management.submitArchive({ filename: "products.gz", stream: Readable.from(offArchive([offWithBasis("100g")])) });
    await vi.waitFor(() => expect(management.read().busy).toBe(false));
    await expect(getFoodCatalog().lookupBarcode("open-food-facts", "0012345678905")).resolves.toMatchObject({ provider: "open-food-facts", authoritativeBaseUnit: "g", isSelectable: true });
    expect(network).not.toHaveBeenCalled();
  });

  test("absent catalogs report not installed without attempting a food lookup request", async () => {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("FOOD_CATALOG_TEST_FIXTURE", "0");
      const network = vi.fn(() => { throw new Error("Food lookup network is forbidden"); });
      vi.stubGlobal("fetch", network);

      await expect(getFoodCatalog().search("usda-fdc", "bread"))
        .rejects.toBeInstanceOf(CatalogNotInstalledError);
      await expect(
        getFoodCatalog().lookupBarcode("open-food-facts", "034000470693"),
      ).rejects.toBeInstanceOf(CatalogNotInstalledError);
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
    expect((await getFoodCatalog().search("usda-fdc", "broccoli")).map(food => food.providerFoodId)).toEqual(["747447", "321900"]);
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
