import { afterEach, describe, expect, test, vi } from "vitest";

import {
  CatalogConfigurationError,
  CatalogFoodNotFoundError,
  CatalogInvalidResponseError,
  CatalogNutritionUnavailableError,
  CatalogRateLimitError,
  CatalogUnavailableError,
} from "../app/catalog/food-catalog.server";
import { OpenFoodFactsAdapter } from "../app/catalog/open-food-facts.server";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function product(change: Record<string, unknown> = {}) {
  return {
    product: {
      brands: "Example Foods",
      code: "0034000470693",
      countries: "United States",
      nutriments: {
        carbohydrates_100g: 99,
        carbohydrates_serving: 24,
        "energy-kcal_100g": 999,
        "energy-kcal_serving": 180,
        fat_serving: 0,
        fiber_serving: 3,
        proteins_serving: 6,
        sodium_serving: 0.21,
        sugars_serving: 8,
      },
      product_name: "Example cereal",
      ...change,
    },
    status: "success",
  };
}

function adapter(
  fetchImplementation: typeof fetch,
  change: Partial<ConstructorParameters<typeof OpenFoodFactsAdapter>[0]> = {},
) {
  return new OpenFoodFactsAdapter({
    baseUrl: "https://example.test",
    contactEmail: "maintainer@example.test",
    fetchImplementation,
    timeoutMs: 100,
    ...change,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Open Food Facts barcode lookup", () => {
  test("detail lookup uses the canonical provider food ID", async () => {
    const provider = adapter(
      vi.fn<typeof fetch>().mockResolvedValue(response(product())),
    );
    await expect(provider.getFood("0034000470693")).resolves.toMatchObject({
      provider: "open-food-facts",
      providerFoodId: "0034000470693",
    });
  });

  test("requests only the v3 identity, provenance, and serving nutrition fields", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(product()));

    await expect(
      adapter(fetchImplementation).lookupBarcode("034000470693"),
    ).resolves.toEqual({
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
        fiberMilligrams: { amount: 3, fixedPointMultiplier: 1_000 },
        proteinMilligrams: { amount: 6, fixedPointMultiplier: 1_000 },
        sodiumMilligrams: { amount: 0.21, fixedPointMultiplier: 1_000 },
        sugarMilligrams: { amount: 8, fixedPointMultiplier: 1_000 },
      },
      originalName: "Example cereal",
      provider: "open-food-facts",
      providerFoodId: "0034000470693",
      providerModifiedDate: null,
      providerPublishedDate: null,
    });

    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [request, init] = fetchImplementation.mock.calls[0] ?? [];
    const url = new URL(String(request));
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://example.test/api/v3/product/034000470693",
    );
    expect(url.searchParams.get("fields")).toBe(
      "code,product_name,brands,countries,nutriments",
    );
    expect(init).toMatchObject({ method: "GET" });
    expect(new Headers(init?.headers).get("User-Agent")).toBe(
      "OpenCaloryTracker/0.1.0 (maintainer@example.test)",
    );
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
  });

  test("uses provider serving values without deriving from 100 g values", async () => {
    const provider = adapter(
      vi.fn<typeof fetch>().mockResolvedValue(response(product())),
    );

    await expect(provider.lookupBarcode("034000470693")).resolves.toMatchObject({
      nutritionPerAuthoritativeBase: {
        carbohydrateMilligrams: { amount: 24, fixedPointMultiplier: 1_000 },
        energyMilliKcal: { amount: 180, fixedPointMultiplier: 1_000 },
        fatMilligrams: { amount: 0, fixedPointMultiplier: 1_000 },
        fiberMilligrams: { amount: 3, fixedPointMultiplier: 1_000 },
        proteinMilligrams: { amount: 6, fixedPointMultiplier: 1_000 },
        sodiumMilligrams: { amount: 0.21, fixedPointMultiplier: 1_000 },
        sugarMilligrams: { amount: 8, fixedPointMultiplier: 1_000 },
      },
    });
  });

  test("keeps explicit zero and ignores absent, negative, non-finite, and malformed values", async () => {
    const provider = adapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        {
          json: async () =>
            product({
            nutriments: {
              carbohydrates_serving: -1,
              "energy-kcal_serving": null,
              fat_serving: 0,
              fiber_serving: "3",
              sodium_serving: Number.NaN,
              proteins_serving: Number.POSITIVE_INFINITY,
            },
            }),
          ok: true,
          status: 200,
        } as Response,
      ),
    );

    await expect(provider.lookupBarcode("034000470693")).resolves.toMatchObject({
      nutritionPerAuthoritativeBase: {
        carbohydrateMilligrams: null,
        energyMilliKcal: null,
        fatMilligrams: { amount: 0, fixedPointMultiplier: 1_000 },
        fiberMilligrams: null,
        proteinMilligrams: null,
        sodiumMilligrams: null,
        sugarMilligrams: null,
      },
    });
  });

  test("falls back to an unnamed product without inventing brand or description", async () => {
    const provider = adapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        response(product({ brands: "  ", product_name: " \n " })),
      ),
    );

    await expect(provider.lookupBarcode("034000470693")).resolves.toMatchObject({
      brand: null,
      name: "Unnamed product",
      originalName: "Unnamed product",
    });
  });

  test.each([
    "",
    "123",
    "a123456",
    "123456a",
    "1234567a",
    "1234567\n",
    "12345678901",
    "123456789012345",
  ])(
    "rejects invalid barcode %j before requesting the provider",
    async (barcode) => {
      const fetchImplementation = vi.fn<typeof fetch>();
      await expect(adapter(fetchImplementation).lookupBarcode(barcode))
        .rejects.toBeInstanceOf(CatalogFoodNotFoundError);
      expect(fetchImplementation).not.toHaveBeenCalled();
    },
  );

  test.each(["1234567", "00012345", "034000470693", "0034000470693", "10034000470690"])(
    "preserves supported barcode %s in the request until the provider returns its canonical code",
    async (barcode) => {
      const fetchImplementation = vi
        .fn<typeof fetch>()
        .mockResolvedValue(response(product()));
      await adapter(fetchImplementation).lookupBarcode(barcode);
      expect(String(fetchImplementation.mock.calls[0]?.[0])).toContain(
        `/api/v3/product/${barcode}?`,
      );
    },
  );

  test("rejects products with only per-100g nutrition", async () => {
    const provider = adapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        response(
          product({
            nutriments: {
              carbohydrates_100g: 24,
              "energy-kcal_100g": 180,
              fat_prepared_100g: 4,
              proteins_100g: 6,
            },
          }),
        ),
      ),
    );
    await expect(provider.lookupBarcode("034000470693")).rejects
      .toBeInstanceOf(CatalogNutritionUnavailableError);
  });

  test.each([
    "energy-kcal_serving",
    "proteins_serving",
    "carbohydrates_serving",
    "fat_serving",
  ])("accepts %s as the only required nutrition value", async (field) => {
    const provider = adapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        response(product({ nutriments: { [field]: 1 } })),
      ),
    );
    await expect(provider.lookupBarcode("034000470693")).resolves.toMatchObject({
      provider: "open-food-facts",
    });
  });

  test.each([
    [404, CatalogFoodNotFoundError],
    [429, CatalogRateLimitError],
    [500, CatalogUnavailableError],
    [503, CatalogUnavailableError],
  ] as const)("maps HTTP %s to %s", async (status, ErrorType) => {
    const provider = adapter(
      vi.fn<typeof fetch>().mockResolvedValue(response({}, status)),
    );
    await expect(provider.lookupBarcode("034000470693")).rejects
      .toBeInstanceOf(ErrorType);
  });

  test("maps network failures and timeouts to unavailable", async () => {
    await expect(
      adapter(vi.fn<typeof fetch>().mockRejectedValue(new Error("network")))
        .lookupBarcode("034000470693"),
    ).rejects.toBeInstanceOf(CatalogUnavailableError);

    vi.useFakeTimers();
    const provider = adapter(
      vi.fn<typeof fetch>().mockImplementation(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
    );
    const lookup = provider.lookupBarcode("034000470693");
    const timerAdvance = vi.advanceTimersByTimeAsync(100);
    await expect(lookup).rejects.toBeInstanceOf(CatalogUnavailableError);
    await timerAdvance;
  });

  test.each([
    "not json",
    JSON.stringify({ status: "success" }),
    JSON.stringify(product({ code: "another-code" })),
    JSON.stringify(product({ code: "a034000470693" })),
    JSON.stringify(product({ code: "0034000470693\n" })),
    JSON.stringify({ ...product(), status: "successful" }),
    JSON.stringify({ ...product(), status: "failure" }),
    JSON.stringify({ product: { code: "0034000470693", nutriments: null }, status: "success" }),
  ])("rejects malformed response %j", async (body) => {
    const provider = adapter(
      vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
    );
    await expect(provider.lookupBarcode("034000470693")).rejects
      .toBeInstanceOf(CatalogInvalidResponseError);
  });

  test("missing or blank contact leaves the provider unconfigured", async () => {
    for (const contactEmail of [undefined, "", "   "]) {
      const fetchImplementation = vi.fn<typeof fetch>();
      const provider = new OpenFoodFactsAdapter({
        baseUrl: "https://example.test",
        contactEmail,
        fetchImplementation,
      });
      await expect(provider.lookupBarcode("034000470693")).rejects
        .toBeInstanceOf(CatalogConfigurationError);
      expect(fetchImplementation).not.toHaveBeenCalled();
    }
  });

  test("rejects malformed contact email without sending it", () => {
    expect(
      () =>
        new OpenFoodFactsAdapter({
          baseUrl: "https://example.test",
          contactEmail: "not-an-email",
        }),
    ).toThrow(CatalogConfigurationError);
  });

  test("trims a valid contact email before building the identifying user agent", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(product()));
    await adapter(fetchImplementation, {
      contactEmail: "  maintainer@example.test  ",
    }).lookupBarcode("034000470693");
    expect(
      new Headers(fetchImplementation.mock.calls[0]?.[1]?.headers).get("User-Agent"),
    ).toBe("OpenCaloryTracker/0.1.0 (maintainer@example.test)");
  });

  test("validates every numeric option at both inclusive boundaries", () => {
    const defaults = {
      baseUrl: "https://example.test",
      contactEmail: "maintainer@example.test",
    };
    for (const options of [
      { cacheSize: 0 },
      { cacheSize: 1.5 },
      { cacheSize: 1_001 },
      { cacheTtlMs: 0 },
      { cacheTtlMs: 1.5 },
      { cacheTtlMs: 3_600_001 },
      { timeoutMs: 99 },
      { timeoutMs: 100.5 },
      { timeoutMs: 20_001 },
    ]) {
      expect(() => new OpenFoodFactsAdapter({ ...defaults, ...options })).toThrow(
        CatalogConfigurationError,
      );
    }
    for (const options of [
      { cacheSize: 1 },
      { cacheSize: 1_000 },
      { cacheTtlMs: 1 },
      { cacheTtlMs: 3_600_000 },
      { timeoutMs: 100 },
      { timeoutMs: 20_000 },
    ]) {
      expect(() => new OpenFoodFactsAdapter({ ...defaults, ...options })).not.toThrow();
    }
  });

  test("normalizes a trailing base slash and restricts production to the official HTTPS host", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(product()));
    await adapter(fetchImplementation, {
      baseUrl: "https://example.test/",
    }).lookupBarcode("034000470693");
    const requestUrl = new URL(String(fetchImplementation.mock.calls[0]?.[0]));
    expect(`${requestUrl.origin}${requestUrl.pathname}`).toBe(
      "https://example.test/api/v3/product/034000470693",
    );

    vi.stubEnv("NODE_ENV", "production");
    for (const baseUrl of [
      "http://world.openfoodfacts.org",
      "https://example.test",
      "https://world.openfoodfacts.org.example.test",
    ]) {
      expect(
        () =>
          new OpenFoodFactsAdapter({
            baseUrl,
            contactEmail: "maintainer@example.test",
          }),
      ).toThrow(CatalogConfigurationError);
    }
    expect(
      () =>
        new OpenFoodFactsAdapter({
          baseUrl: "https://world.openfoodfacts.org/",
          contactEmail: "maintainer@example.test",
      }),
    ).not.toThrow();

    const officialFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(product()));
    await new OpenFoodFactsAdapter({
      contactEmail: "maintainer@example.test",
      fetchImplementation: officialFetch,
    }).lookupBarcode("034000470693");
    expect(new URL(String(officialFetch.mock.calls[0]?.[0])).origin).toBe(
      "https://world.openfoodfacts.org",
    );
  });

  test("coalesces concurrent requests and caches a small bounded set", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(product()));
    const provider = adapter(fetchImplementation, { cacheSize: 2 });

    const [first, second] = await Promise.all([
      provider.lookupBarcode("034000470693"),
      provider.lookupBarcode("034000470693"),
    ]);
    expect(first).toEqual(second);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);

    await provider.lookupBarcode("034000470693");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);

    fetchImplementation
      .mockResolvedValueOnce(response(product({ code: "0000000123457" })))
      .mockResolvedValueOnce(response(product({ code: "0000000234568" })))
      .mockResolvedValueOnce(response(product()));
    await provider.lookupBarcode("0000000123457");
    await provider.lookupBarcode("0000000234568");
    await provider.lookupBarcode("034000470693");
    expect(fetchImplementation).toHaveBeenCalledTimes(4);
  });

  test("expires cache entries exactly at the TTL and refreshes recency on hits", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      const code = new URL(String(input)).pathname.split("/").at(-1)!;
      return response(product({ code }));
    });
    const provider = adapter(fetchImplementation, { cacheSize: 2, cacheTtlMs: 100 });

    await provider.lookupBarcode("0000000000001");
    await vi.advanceTimersByTimeAsync(99);
    await provider.lookupBarcode("0000000000001");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await provider.lookupBarcode("0000000000001");
    expect(fetchImplementation).toHaveBeenCalledTimes(2);

    await provider.lookupBarcode("0000000000002");
    await provider.lookupBarcode("0000000000001");
    await provider.lookupBarcode("0000000000003");
    await provider.lookupBarcode("0000000000002");
    expect(fetchImplementation).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("a failed request is neither cached nor retained as in-flight work", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(response(product()));
    const provider = adapter(fetchImplementation);
    await expect(provider.lookupBarcode("034000470693")).rejects.toBeInstanceOf(
      CatalogUnavailableError,
    );
    await expect(provider.lookupBarcode("034000470693")).resolves.toMatchObject({
      providerFoodId: "0034000470693",
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });
});
