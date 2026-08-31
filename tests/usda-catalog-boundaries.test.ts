import { afterEach, describe, expect, test, vi } from "vitest";

import {
  CatalogConfigurationError,
  CatalogCredentialsError,
  CatalogFoodNotFoundError,
  CatalogInvalidResponseError,
  CatalogRateLimitError,
  CatalogUnavailableError,
  type FoodCatalogDiagnostic,
} from "../app/catalog/food-catalog.server";
import { UsdaFoodDataCentralAdapter } from "../app/catalog/usda.server";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function searchProvider(foods: unknown[]) {
  return new UsdaFoodDataCentralAdapter({
    apiKey: "registered-test-key",
    baseUrl: "https://example.test/fdc/v1",
    fetchImplementation: vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ foods })),
  });
}

function foundationFood(change: Record<string, unknown> = {}) {
  return {
    dataType: "Foundation",
    description: "Boundary food",
    fdcId: 700,
    foodNutrients: [],
    ...change,
  };
}

function detailProvider(
  food: unknown,
  options: {
    onDiagnostic?: (diagnostic: FoodCatalogDiagnostic) => void;
  } = {},
) {
  return new UsdaFoodDataCentralAdapter({
    apiKey: "registered-test-key",
    baseUrl: "https://example.test/fdc/v1",
    fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(food)),
    ...options,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("USDA search boundaries", () => {
  test("normalizes Unicode text, numeric barcodes, serving aliases, and provider dates", async () => {
    const provider = searchProvider([
      {
        brandName: "  Cafe\u0301 Foods  ",
        dataType: "Branded",
        description: "  Cafe\u0301 yogurt  ",
        fdcId: 701,
        gtinUpc: " 0012345000012 ",
        householdServingFullText: "  one cup  ",
        marketCountry: " United States ",
        publicationDate: "12/3/2023",
        servingSize: 125,
        servingSizeUnit: " GRAMS ",
      },
      {
        dataType: "Foundation",
        description: "Leap-day food",
        fdcId: 702,
        publicationDate: "2024-02-29",
      },
      {
        dataType: "Foundation",
        description: "Early calendar food",
        fdcId: 703,
        publicationDate: "0100-01-02",
      },
    ]);

    await expect(provider.search("food")).resolves.toEqual([
      {
        barcode: "0012345000012",
        brand: "Café Foods",
        dataType: "Branded",
        isSelectable: true,
        measurementSummary: "one cup · 125 g",
        name: "Café yogurt",
        provider: "usda-fdc",
        providerFoodId: "701",
        providerPublishedDate: "2023-12-03",
      },
      {
        barcode: null,
        brand: null,
        dataType: "Foundation",
        isSelectable: true,
        measurementSummary: "100 g",
        name: "Leap-day food",
        provider: "usda-fdc",
        providerFoodId: "702",
        providerPublishedDate: "2024-02-29",
      },
      {
        barcode: null,
        brand: null,
        dataType: "Foundation",
        isSelectable: true,
        measurementSummary: "100 g",
        name: "Early calendar food",
        provider: "usda-fdc",
        providerFoodId: "703",
        providerPublishedDate: "0100-01-02",
      },
    ]);
  });

  test.each([
    "x2024-01-01",
    " 2024-01-01",
    "2024-01-01x",
    "2024-01-01 ",
    "2025-02-29",
    "2024-13-01",
    "2024-01-32",
    "0000-01-01",
    "x12/3/2023",
    "12/3/2023x",
    "13/3/2023",
    "12/32/2023",
    "12/3/0099",
  ])("rejects invalid provider date %s", async (publicationDate) => {
    await expect(
      searchProvider([
        {
          dataType: "Foundation",
          description: "Invalid date food",
          fdcId: 703,
          publicationDate,
        },
      ]).search("food"),
    ).rejects.toBeInstanceOf(CatalogInvalidResponseError);
  });

  test("rejects malformed barcodes without discarding otherwise valid foods", async () => {
    const foods = ["12A34", "1234 suffix", "prefix 1234"].map(
      (gtinUpc, index) => ({
        dataType: "Foundation",
        description: `Barcode ${index}`,
        fdcId: 710 + index,
        gtinUpc,
      }),
    );

    await expect(searchProvider(foods).search("food")).resolves.toMatchObject(
      foods.map((_food, index) => ({
        barcode: null,
        providerFoodId: String(710 + index),
      })),
    );
  });

  test.each([
    ["gram", "g"],
    ["grm", "g"],
    ["ml", "ml"],
    ["milliliter", "ml"],
    ["milliliters", "ml"],
    ["mlt", "ml"],
  ] as const)("normalizes serving unit %s to %s", async (servingSizeUnit, unit) => {
    await expect(
      searchProvider([
        {
          dataType: "Foundation",
          description: `${servingSizeUnit} food`,
          fdcId: 720,
          servingSize: 25,
          servingSizeUnit,
        },
      ]).search("food"),
    ).resolves.toMatchObject([{ measurementSummary: `25 ${unit}` }]);
  });

  test.each([
    { servingSize: 0, servingSizeUnit: "g" },
    { servingSize: -1, servingSizeUnit: "g" },
    { servingSize: 25, servingSizeUnit: "ounce" },
    { servingSize: null, servingSizeUnit: "g" },
    { servingSize: 25, servingSizeUnit: null },
  ])("falls back to a 100 g summary for %#", async (change) => {
    await expect(
      searchProvider([
        {
          dataType: "Foundation",
          description: "Fallback serving",
          fdcId: 721,
          ...change,
        },
      ]).search("food"),
    ).resolves.toMatchObject([{ measurementSummary: "100 g" }]);
  });

  test("deduplicates case-insensitively and retains the first equally-new revision", async () => {
    const provider = searchProvider([
      {
        brandName: "Example Brand",
        dataType: "Branded",
        description: "Case Food",
        fdcId: 730,
        gtinUpc: "0001112223334",
        marketCountry: "United States",
        publicationDate: "2025-01-01",
      },
      {
        brandName: "example brand",
        dataType: "Branded",
        description: "case food",
        fdcId: 731,
        gtinUpc: "0001112223334",
        marketCountry: "United States",
        publicationDate: "2026-01-01",
      },
      {
        brandName: "EXAMPLE BRAND",
        dataType: "Branded",
        description: "CASE FOOD",
        fdcId: 732,
        gtinUpc: "0001112223334",
        marketCountry: "United States",
        publicationDate: "2026-01-01",
      },
      {
        brandName: "Different Brand",
        dataType: "Branded",
        description: "Different barcode food",
        fdcId: 734,
        gtinUpc: "9998887776665",
        marketCountry: "United States",
        publicationDate: "2026-01-01",
      },
      {
        brandName: "Another Brand",
        dataType: "Branded",
        description: "case food",
        fdcId: 735,
        gtinUpc: "0001112223334",
        marketCountry: "United States",
        publicationDate: "2026-01-01",
      },
      {
        dataType: "Branded",
        description: "case food",
        fdcId: 736,
        gtinUpc: "0001112223334",
        marketCountry: "United States",
        publicationDate: "2026-01-01",
      },
      {
        dataType: "Branded",
        description: "CASE FOOD",
        fdcId: 737,
        gtinUpc: "0001112223334",
        marketCountry: "United States",
        publicationDate: "2027-01-01",
      },
      {
        brandName: "example brand",
        dataType: "Branded",
        description: "Different name",
        fdcId: 738,
        gtinUpc: "0001112223334",
        marketCountry: "United States",
        publicationDate: "2027-01-01",
      },
      {
        brandName: "example brand",
        dataType: "Branded",
        description: "case food",
        fdcId: 739,
        gtinUpc: "1112223334445",
        marketCountry: "United States",
        publicationDate: "2027-01-01",
      },
      {
        dataType: "Foundation",
        description: "No barcode identity",
        fdcId: 740,
      },
      {
        dataType: "Foundation",
        description: "Barcode identity",
        fdcId: 740,
        gtinUpc: "7407407407400",
      },
      {
        dataType: "Foundation",
        description: "Older provider revision",
        fdcId: 733,
        publicationDate: "2024-01-01",
      },
      {
        dataType: "Foundation",
        description: "Newer provider revision",
        fdcId: 733,
        publicationDate: "2025-01-01",
      },
    ]);

    await expect(provider.search("food")).resolves.toMatchObject([
      { providerFoodId: "731" },
      { providerFoodId: "734" },
      { providerFoodId: "735" },
      { providerFoodId: "737" },
      { providerFoodId: "738" },
      { providerFoodId: "739" },
      { name: "No barcode identity", providerFoodId: "740" },
      { name: "Barcode identity", providerFoodId: "740" },
      { name: "Newer provider revision", providerFoodId: "733" },
    ]);
  });

  test("rejects a provider description containing only whitespace", async () => {
    await expect(
      searchProvider([
        { dataType: "Foundation", description: "   ", fdcId: 735 },
      ]).search("food"),
    ).rejects.toBeInstanceOf(CatalogInvalidResponseError);
  });

  test("keeps branded and unbranded revisions distinct regardless of arrival order", async () => {
    const provider = searchProvider([
      {
        dataType: "Branded",
        description: "Shared name",
        fdcId: 741,
        gtinUpc: "7417417417410",
        marketCountry: "United States",
      },
      {
        brandName: "Later Brand",
        dataType: "Branded",
        description: "Shared name",
        fdcId: 742,
        gtinUpc: "7417417417410",
        marketCountry: "United States",
      },
    ]);

    await expect(provider.search("food")).resolves.toMatchObject([
      { brand: null, providerFoodId: "741" },
      { brand: "Later Brand", providerFoodId: "742" },
    ]);
  });

  test.each([" ", "a", "a".repeat(101)])(
    "rejects query outside the supported length: %s",
    async (query) => {
      const fetchImplementation = vi.fn<typeof fetch>();
      const provider = new UsdaFoodDataCentralAdapter({
        apiKey: "registered-test-key",
        baseUrl: "https://example.test/fdc/v1",
        fetchImplementation,
      });

      await expect(provider.search(query)).rejects.toBeInstanceOf(
        CatalogInvalidResponseError,
      );
      expect(fetchImplementation).not.toHaveBeenCalled();
    },
  );
});

describe("USDA detail normalization boundaries", () => {
  test("skips missing nutrient amounts, trims units, and diagnoses only negatives", async () => {
    const onDiagnostic = vi.fn();
    const provider = detailProvider(
      foundationFood({
        foodNutrients: [
          { amount: null, nutrient: { id: 2048, unitName: "kcal" } },
          { amount: 250, nutrient: { id: 2048, unitName: " kcal " } },
          { amount: 0, nutrient: { id: 1003, unitName: "g" } },
          { amount: -1, nutrient: { id: 1005, unitName: "g" } },
        ],
      }),
      { onDiagnostic },
    );

    await expect(provider.getFood("700")).resolves.toMatchObject({
      nutritionPerAuthoritativeBase: {
        carbohydrateMilligrams: null,
        energyMilliKcal: { amount: 250, fixedPointMultiplier: 1_000 },
        proteinMilligrams: { amount: 0, fixedPointMultiplier: 1_000 },
      },
    });
    expect(onDiagnostic).toHaveBeenCalledExactlyOnceWith({
      code: "negative_nutrient_amount",
      nutrientId: 1005,
      providerFoodId: "700",
    });
  });

  test("non-Foundation foods use label energy rather than Foundation factors", async () => {
    const provider = detailProvider({
      dataType: "Branded",
      description: "Branded energy food",
      fdcId: 700,
      foodNutrients: [
        { amount: 900, nutrient: { id: 2048, unitName: "kcal" } },
        { amount: 120, nutrient: { id: 1008, unitName: "kcal" } },
      ],
      marketCountry: "United States",
    });

    await expect(provider.getFood("700")).resolves.toMatchObject({
      nutritionPerAuthoritativeBase: {
        energyMilliKcal: { amount: 120, fixedPointMultiplier: 1_000 },
      },
    });
  });

  test("normalizes safe portions and rejects malformed or unsafe ones", async () => {
    const provider = detailProvider(
      foundationFood({
        foodPortions: [
          { amount: 0, gramWeight: 10, id: 1, portionDescription: " spoon " },
          {
            amount: -1,
            gramWeight: 20,
            id: 2,
            measureUnit: { name: "piece" },
          },
          {
            amount: 2,
            gramWeight: 30,
            id: 3,
            measureUnit: { abbreviation: "tbsp", name: "   " },
          },
          { amount: null, gramWeight: 40, id: 40, modifier: "slice" },
          { amount: 3, gramWeight: 50, id: null, modifier: "serving" },
          { amount: 1, gramWeight: 60, id: 6 },
          { amount: 1, gramWeight: 0, id: 7 },
          { amount: 1, gramWeight: -10, id: 8 },
          { amount: 1, gramWeight: Number.MAX_SAFE_INTEGER, id: 9 },
          "malformed portion",
        ],
      }),
    );

    await expect(provider.getFood("700")).resolves.toMatchObject({
      measurements: [
        { id: "portion:1", label: "1 spoon (10 g)" },
        { id: "portion:2", label: "1 piece (20 g)" },
        { id: "portion:3", label: "2 tbsp (30 g)" },
        { id: "portion:40", label: "1 slice (40 g)" },
        { id: "portion:4", label: "3 serving (50 g)" },
        { id: "portion:6", label: "1 portion (60 g)" },
        { id: "base:g:100000000", label: "100 g" },
      ],
    });
  });

  test.each([
    {
      change: { servingSize: 25, servingSizeUnit: "ml" },
      expectedUnit: "g",
    },
    {
      change: { servingSize: 0, servingSizeUnit: "g" },
      expectedUnit: "g",
    },
    {
      change: { servingSize: null, servingSizeUnit: "g" },
      expectedUnit: "g",
    },
    {
      change: { servingSize: Number.MAX_SAFE_INTEGER, servingSizeUnit: "g" },
      expectedUnit: "g",
    },
    {
      change: { servingSize: 0.000_000_1, servingSizeUnit: "g" },
      expectedUnit: "g",
    },
  ])("omits an unsafe detail serving for %#", async ({ change, expectedUnit }) => {
    const food = await detailProvider(foundationFood(change)).getFood("700");
    expect(food.authoritativeBaseUnit).toBe(expectedUnit);
    expect(food.measurements).toEqual([
      {
        baseQuantityMicrounits: 100_000_000,
        id: "base:g:100000000",
        label: "100 g",
        unit: "g",
      },
    ]);
  });

  test("a gram serving without a household label remains selectable", async () => {
    await expect(
      detailProvider(
        foundationFood({ servingSize: 25, servingSizeUnit: "g" }),
      ).getFood("700"),
    ).resolves.toMatchObject({
      measurements: [
        {
          id: "serving:g:25000000",
          label: "25 g",
          unit: "g",
        },
        { id: "base:g:100000000" },
      ],
    });
  });

  test("milliliter foods ignore gram-only provider portions", async () => {
    const provider = detailProvider({
      dataType: "Branded",
      description: "Liquid food",
      fdcId: 700,
      foodNutrients: [],
      foodPortions: [
        { amount: 1, gramWeight: 25, id: 1, modifier: "scoop" },
      ],
      marketCountry: "United States",
      servingSize: 50,
      servingSizeUnit: "ml",
    });

    const food = await provider.getFood("700");
    expect(food.authoritativeBaseUnit).toBe("ml");
    expect(food.measurements.map(({ id }) => id)).toEqual([
      "serving:ml:50000000",
      "base:ml:100000000",
    ]);
  });

  test("a branded gram serving keeps a gram authoritative base", async () => {
    const provider = detailProvider({
      dataType: "Branded",
      description: "Solid branded food",
      fdcId: 700,
      foodNutrients: [],
      marketCountry: "United States",
      servingSize: 25,
      servingSizeUnit: "g",
    });

    await expect(provider.getFood("700")).resolves.toMatchObject({
      authoritativeBaseUnit: "g",
      measurements: [
        { id: "serving:g:25000000", unit: "g" },
        { id: "base:g:100000000", unit: "g" },
      ],
    });
  });

  test("detail rejects branded foods outside the United States market", async () => {
    const provider = detailProvider({
      dataType: "Branded",
      description: "Foreign product",
      fdcId: 700,
      foodNutrients: [],
      marketCountry: "Canada",
    });

    await expect(provider.getFood("700")).rejects.toBeInstanceOf(
      CatalogInvalidResponseError,
    );
  });

  test.each(["x203", "203x"])(
    "rejects malformed abridged nutrient number %s",
    async (number) => {
      const fetchImplementation = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, { status: 404 }))
        .mockResolvedValueOnce(
          jsonResponse({
            dataType: "Foundation",
            description: "Abridged boundary food",
            fdcId: 700,
            foodNutrients: [{ amount: 1, number, unitName: "G" }],
          }),
        );
      const provider = new UsdaFoodDataCentralAdapter({
        apiKey: "key",
        baseUrl: "https://example.test/fdc/v1",
        fetchImplementation,
      });

      await expect(provider.getFood("700")).rejects.toBeInstanceOf(
        CatalogInvalidResponseError,
      );
    },
  );

  test("ignores an unknown multi-decimal abridged nutrient number", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse({
          dataType: "Foundation",
          description: "Abridged boundary food",
          fdcId: 700,
          foodNutrients: [{ amount: 1, number: "269.33", unitName: "G" }],
        }),
      );
    const provider = new UsdaFoodDataCentralAdapter({
      apiKey: "key",
      baseUrl: "https://example.test/fdc/v1",
      fetchImplementation,
    });

    await expect(provider.getFood("700")).resolves.toMatchObject({
      nutritionPerAuthoritativeBase: { sugarMilligrams: null },
    });
    expect(fetchImplementation.mock.calls[1]?.[1]).toMatchObject({
      method: "GET",
    });
  });
});

describe("USDA adapter request boundaries", () => {
  test("trims credentials and a trailing base slash before making a search request", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ foods: [] }));
    const provider = new UsdaFoodDataCentralAdapter({
      apiKey: "  registered-test-key  ",
      baseUrl: "https://example.test/fdc/v1/",
      fetchImplementation,
    });

    await expect(provider.search("  bread  ")).resolves.toEqual([]);

    const [url, init] = fetchImplementation.mock.calls[0];
    expect(String(url)).toBe(
      "https://example.test/fdc/v1/foods/search?api_key=registered-test-key",
    );
    expect(init).toMatchObject({
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({ query: "bread" });
  });

  test("rejects whitespace-only credentials", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const provider = new UsdaFoodDataCentralAdapter({
      apiKey: "   ",
      baseUrl: "https://example.test/fdc/v1",
      fetchImplementation,
    });

    await expect(provider.search("bread")).rejects.toBeInstanceOf(
      CatalogConfigurationError,
    );
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  test.each([
    "http://api.nal.usda.gov/fdc/v1",
    "https://example.test/fdc/v1",
  ])("production rejects unsafe USDA base URL %s", (baseUrl) => {
    vi.stubEnv("NODE_ENV", "production");
    expect(
      () => new UsdaFoodDataCentralAdapter({ apiKey: "key", baseUrl }),
    ).toThrow(CatalogConfigurationError);
  });

  test("production accepts the canonical USDA HTTPS endpoint", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(
      () => new UsdaFoodDataCentralAdapter({ apiKey: "key" }),
    ).not.toThrow();
  });

  test.each(["0", "01", "123suffix", "prefix123", "1.5", "-1"])(
    "rejects invalid provider food ID %s before requesting it",
    async (providerFoodId) => {
      const fetchImplementation = vi.fn<typeof fetch>();
      const provider = new UsdaFoodDataCentralAdapter({
        apiKey: "key",
        baseUrl: "https://example.test/fdc/v1",
        fetchImplementation,
      });

      await expect(provider.getFood(providerFoodId)).rejects.toBeInstanceOf(
        CatalogFoodNotFoundError,
      );
      expect(fetchImplementation).not.toHaveBeenCalled();
    },
  );

  test("rejects a detail response for a different provider ID", async () => {
    const provider = new UsdaFoodDataCentralAdapter({
      apiKey: "key",
      baseUrl: "https://example.test/fdc/v1",
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(foundationFood({ fdcId: 701 }))),
    });

    await expect(provider.getFood("700")).rejects.toBeInstanceOf(
      CatalogInvalidResponseError,
    );
  });

  test.each([
    [403, CatalogCredentialsError],
    [429, CatalogRateLimitError],
  ] as const)("detail status %s does not fall back", async (status, ErrorType) => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status }));
    const provider = new UsdaFoodDataCentralAdapter({
      apiKey: "key",
      baseUrl: "https://example.test/fdc/v1",
      fetchImplementation,
    });

    await expect(provider.getFood("700")).rejects.toBeInstanceOf(ErrorType);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  test("an invalid JSON detail response does not fall back", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not-json"));
    const provider = new UsdaFoodDataCentralAdapter({
      apiKey: "key",
      baseUrl: "https://example.test/fdc/v1",
      fetchImplementation,
    });

    await expect(provider.getFood("700")).rejects.toBeInstanceOf(
      CatalogInvalidResponseError,
    );
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  test("successful requests clear their timeout", async () => {
    vi.useFakeTimers();
    const provider = new UsdaFoodDataCentralAdapter({
      apiKey: "key",
      baseUrl: "https://example.test/fdc/v1",
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ foods: [] })),
      timeoutMs: 10,
    });

    await expect(provider.search("bread")).resolves.toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("timed-out requests abort and clear their timeout", async () => {
    vi.useFakeTimers();
    const provider = new UsdaFoodDataCentralAdapter({
      apiKey: "key",
      baseUrl: "https://example.test/fdc/v1",
      fetchImplementation: vi.fn<typeof fetch>().mockImplementation(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("provider request aborted", "AbortError"));
            });
          }),
      ),
      timeoutMs: 10,
    });

    const result = provider.search("bread");
    await Promise.all([
      expect(result).rejects.toBeInstanceOf(CatalogUnavailableError),
      vi.advanceTimersByTimeAsync(10),
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
