import { z } from "zod";

import packageJson from "../../package.json";
import { isProductionEnvironment } from "../runtime.server";
import { isSupportedCommercialBarcode } from "./barcode";
import {
  CatalogConfigurationError,
  CatalogFoodNotFoundError,
  CatalogInvalidResponseError,
  CatalogNutritionUnavailableError,
  CatalogRateLimitError,
  CatalogUnavailableError,
  type BarcodeFoodCatalogProvider,
  type CatalogFood,
  type CatalogNutrientValue,
  type CatalogNutrition,
} from "./food-catalog.server";

const DEFAULT_BASE_URL = "https://world.openfoodfacts.org";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_SIZE = 32;
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const REQUEST_FIELDS = [
  "code",
  "product_name",
  "brands",
  "countries",
  "last_modified_t",
  "nutriments",
] as const;

const barcodeSchema = z.string().refine(isSupportedCommercialBarcode);
const contactEmailSchema = z.string().email();
const productSchema = z.object({
  brands: z.unknown().optional(),
  code: barcodeSchema,
  countries: z.unknown().optional(),
  last_modified_t: z
    .number()
    .int()
    .nonnegative()
    .max(8_640_000_000_000)
    .optional(),
  nutriments: z.record(z.string(), z.unknown()),
  product_name: z.unknown().optional(),
});
const responseSchema = z.object({
  product: productSchema,
  status: z.enum(["success", "success_with_warnings"]),
});

type CachedFood = { expiresAt: number; food: CatalogFood };
const catalogErrorTypes = [
  CatalogFoodNotFoundError,
  CatalogInvalidResponseError,
  CatalogNutritionUnavailableError,
  CatalogRateLimitError,
  CatalogUnavailableError,
] as const;

export type OpenFoodFactsAdapterOptions = {
  baseUrl?: string;
  cacheSize?: number;
  cacheTtlMs?: number;
  contactEmail?: string;
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
};

function configuredValue<T>(value: T | undefined, fallback: T): T {
  return value ?? fallback;
}

function configuredNumber(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const configured = configuredValue(value, fallback);
  if (
    !Number.isInteger(configured) ||
    configured < minimum ||
    configured > maximum
  ) {
    throw new CatalogConfigurationError();
  }
  return configured;
}

function configuredContactEmail(value: string | undefined): string | undefined {
  const supplied = value?.trim();
  if (!supplied) return undefined;
  const parsed = contactEmailSchema.safeParse(supplied);
  if (!parsed.success) throw new CatalogConfigurationError();
  return parsed.data;
}

function configuredBaseUrl(value: string | undefined): string {
  const baseUrl = configuredValue(value, DEFAULT_BASE_URL).replace(/\/$/, "");
  const url = new URL(baseUrl);
  if (
    isProductionEnvironment() &&
    (url.protocol !== "https:" || url.hostname !== "world.openfoodfacts.org")
  ) {
    throw new CatalogConfigurationError();
  }
  return baseUrl;
}

function knownCatalogError(error: unknown): boolean {
  return catalogErrorTypes.some((ErrorType) => error instanceof ErrorType);
}

function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.normalize("NFC") : null;
}

function providerModifiedDate(timestamp: number | undefined): string | null {
  return timestamp === undefined
    ? null
    : new Date(timestamp * 1_000).toISOString();
}

function nutrient(
  nutriments: Record<string, unknown>,
  field: string,
  fixedPointMultiplier: number,
): CatalogNutrientValue | null {
  const amount = nutriments[field];
  if (typeof amount !== "number") return null;
  if (!Number.isFinite(amount)) return null;
  if (amount < 0) return null;
  return { amount, fixedPointMultiplier };
}

function nutrition(nutriments: Record<string, unknown>): CatalogNutrition {
  return {
    carbohydrateMilligrams: nutrient(
      nutriments,
      "carbohydrates_serving",
      1_000,
    ),
    energyMilliKcal: nutrient(nutriments, "energy-kcal_serving", 1_000),
    fatMilligrams: nutrient(nutriments, "fat_serving", 1_000),
    fiberMilligrams: nutrient(nutriments, "fiber_serving", 1_000),
    proteinMilligrams: nutrient(nutriments, "proteins_serving", 1_000),
    sodiumMilligrams: nutrient(nutriments, "sodium_serving", 1_000),
    sugarMilligrams: nutrient(nutriments, "sugars_serving", 1_000),
  };
}

function normalizeProduct(value: unknown): CatalogFood {
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) throw new CatalogInvalidResponseError();
  const product = parsed.data.product;
  const normalizedNutrition = nutrition(product.nutriments);
  if (
    normalizedNutrition.energyMilliKcal === null &&
    normalizedNutrition.proteinMilligrams === null &&
    normalizedNutrition.carbohydrateMilligrams === null &&
    normalizedNutrition.fatMilligrams === null
  ) {
    throw new CatalogNutritionUnavailableError();
  }
  const name = optionalText(product.product_name) ?? "Unnamed product";
  return {
    authoritativeBaseQuantityMicrounits: 1_000_000,
    authoritativeBaseUnit: "serving",
    barcode: product.code,
    brand: optionalText(product.brands),
    dataType: "Open Food Facts",
    isSelectable: true,
    marketCountry: optionalText(product.countries),
    measurements: [
      {
        baseQuantityMicrounits: 1_000_000,
        id: "serving",
        label: "1 serving",
        unit: "serving",
      },
    ],
    measurementSummary: "1 serving",
    name,
    nutritionPerAuthoritativeBase: normalizedNutrition,
    originalName: name,
    provider: "open-food-facts",
    providerFoodId: product.code,
    providerModifiedDate: providerModifiedDate(product.last_modified_t),
    providerPublishedDate: null,
  };
}

export class OpenFoodFactsAdapter implements BarcodeFoodCatalogProvider {
  readonly #baseUrl: string;
  readonly #cache = new Map<string, CachedFood>();
  readonly #cacheSize: number;
  readonly #cacheTtlMs: number;
  readonly #contactEmail: string | undefined;
  readonly #fetch: typeof fetch;
  readonly #inFlight = new Map<string, Promise<CatalogFood>>();
  readonly #timeoutMs: number;

  constructor(options: OpenFoodFactsAdapterOptions = {}) {
    this.#baseUrl = configuredBaseUrl(options.baseUrl);
    this.#cacheSize = configuredNumber(
      options.cacheSize,
      DEFAULT_CACHE_SIZE,
      1,
      1_000,
    );
    this.#cacheTtlMs = configuredNumber(
      options.cacheTtlMs,
      DEFAULT_CACHE_TTL_MS,
      1,
      60 * 60_000,
    );
    this.#contactEmail = configuredContactEmail(options.contactEmail);
    this.#fetch = configuredValue(options.fetchImplementation, fetch);
    this.#timeoutMs = configuredNumber(
      options.timeoutMs,
      DEFAULT_TIMEOUT_MS,
      100,
      20_000,
    );
  }

  async getFood(providerFoodId: string): Promise<CatalogFood> {
    return await this.#lookup(this.#requestedBarcode(providerFoodId));
  }

  async lookupBarcode(barcode: string): Promise<CatalogFood> {
    const requestedBarcode = this.#requestedBarcode(barcode);
    const cached = this.#cache.get(requestedBarcode);
    if (cached && cached.expiresAt > Date.now()) {
      this.#cache.delete(requestedBarcode);
      this.#cache.set(requestedBarcode, cached);
      return cached.food;
    }
    const existing = this.#inFlight.get(requestedBarcode);
    if (existing) return await existing;

    const request = this.#lookup(requestedBarcode).then((food) => {
      this.#cache.set(requestedBarcode, {
        expiresAt: Date.now() + this.#cacheTtlMs,
        food,
      });
      while (this.#cache.size > this.#cacheSize) {
        const oldest = this.#cache.keys().next().value;
        this.#cache.delete(oldest!);
      }
      return food;
    });
    this.#inFlight.set(requestedBarcode, request);
    try {
      return await request;
    } finally {
      this.#inFlight.delete(requestedBarcode);
    }
  }

  #requestedBarcode(barcode: string): string {
    const parsedBarcode = barcodeSchema.safeParse(barcode);
    if (!parsedBarcode.success) throw new CatalogFoodNotFoundError();
    if (!this.#contactEmail) throw new CatalogConfigurationError();
    return parsedBarcode.data;
  }

  async #lookup(barcode: string): Promise<CatalogFood> {
    const url = new URL(`${this.#baseUrl}/api/v3/product/${barcode}`);
    url.searchParams.set("fields", REQUEST_FIELDS.join(","));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const providerResponse = await this.#fetch(url, {
        headers: {
          "User-Agent": `OpenCaloryTracker/${packageJson.version} (${this.#contactEmail})`,
        },
        method: "GET",
        signal: controller.signal,
      });
      if (providerResponse.status === 404) throw new CatalogFoodNotFoundError();
      if (providerResponse.status === 429) throw new CatalogRateLimitError();
      if (!providerResponse.ok) throw new CatalogUnavailableError();
      return normalizeProduct(await providerResponse.json());
    } catch (error) {
      if (error instanceof SyntaxError) throw new CatalogInvalidResponseError();
      if (knownCatalogError(error)) throw error;
      throw new CatalogUnavailableError();
    } finally {
      clearTimeout(timeout);
    }
  }
}
