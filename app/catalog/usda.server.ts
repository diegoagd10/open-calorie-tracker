import { z } from "zod";

import {
  CatalogConfigurationError,
  CatalogCredentialsError,
  CatalogFoodNotFoundError,
  CatalogInvalidResponseError,
  CatalogRateLimitError,
  CatalogUnavailableError,
  SUPPORTED_CATALOG_DATA_TYPES,
  type CatalogFood,
  type CatalogMeasurement,
  type CatalogNutrientValue,
  type CatalogNutrition,
  type CatalogDataType,
  type CatalogSearchResult,
  type FoodCatalogDiagnostic,
  type FoodCatalogProvider,
} from "./food-catalog.server";

const DEFAULT_BASE_URL = "https://api.nal.usda.gov/fdc/v1";
const DEFAULT_TIMEOUT_MS = 5_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const optionalProviderDateSchema = z.string().min(1).max(32).nullish();
const searchFoodSchema = z.object({
  brandName: z.string().max(300).nullish(),
  brandOwner: z.string().max(300).nullish(),
  dataType: z.string(),
  description: z.string().min(1).max(500),
  fdcId: z.number().int().positive(),
  gtinUpc: z.string().nullish(),
  householdServingFullText: z.string().max(300).nullish(),
  publicationDate: optionalProviderDateSchema,
  publishedDate: optionalProviderDateSchema,
  servingSize: z.number().nullish(),
  servingSizeUnit: z.string().nullish(),
});
const searchResponseSchema = z.object({
  foods: z.array(searchFoodSchema).max(100),
});
const foodNutrientSchema = z.object({
  amount: z.number().finite(),
  nutrient: z.object({
    id: z.number().int().positive(),
    unitName: z.string(),
  }),
});
const foodPortionSchema = z.object({
  amount: z.number().finite().nullish(),
  gramWeight: z.number().finite(),
  id: z.number().int().positive().nullish(),
  measureUnit: z
    .object({
      abbreviation: z.string().nullish(),
      name: z.string().nullish(),
    })
    .nullish(),
  modifier: z.string().nullish(),
  portionDescription: z.string().nullish(),
});
const detailFoodSchema = searchFoodSchema.extend({
  foodNutrients: z.array(foodNutrientSchema).max(5_000),
  foodPortions: z.array(z.unknown()).max(500).nullish(),
  marketCountry: z.string().max(200).nullish(),
  modifiedDate: optionalProviderDateSchema,
});
const querySchema = z.string().trim().min(2).max(100);
const providerFoodIdSchema = z.string().regex(/^[1-9]\d*$/);

type SearchFood = z.infer<typeof searchFoodSchema>;

function isSupportedDataType(value: string): value is CatalogDataType {
  return (SUPPORTED_CATALOG_DATA_TYPES as readonly string[]).includes(value);
}

function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.normalize("NFC") : null;
}

function providerDate(value: string | null | undefined): string | null {
  if (!value) return null;
  if (ISO_DATE.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const instant = new Date(Date.UTC(year, month - 1, day));
    if (
      instant.getUTCFullYear() !== year ||
      instant.getUTCMonth() !== month - 1 ||
      instant.getUTCDate() !== day
    ) {
      throw new CatalogInvalidResponseError();
    }
    return value;
  }
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match) throw new CatalogInvalidResponseError();
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const instant = new Date(Date.UTC(year, month - 1, day));
  if (
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month - 1 ||
    instant.getUTCDate() !== day
  ) {
    throw new CatalogInvalidResponseError();
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function barcode(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && /^\d+$/.test(trimmed) ? trimmed : null;
}

function supportedUnit(value: string | null | undefined): "g" | "ml" | null {
  const normalized = value?.trim().toLowerCase();
  if (["g", "gram", "grams", "grm"].includes(normalized ?? "")) return "g";
  if (["ml", "milliliter", "milliliters", "mlt"].includes(normalized ?? ""))
    return "ml";
  return null;
}

function measurementSummary(food: SearchFood): string {
  const unit = supportedUnit(food.servingSizeUnit);
  const amount = food.servingSize;
  if (
    unit &&
    amount !== null &&
    amount !== undefined &&
    Number.isFinite(amount) &&
    amount > 0
  ) {
    const household = optionalText(food.householdServingFullText);
    return `${household ? `${household} · ` : ""}${amount} ${unit}`;
  }
  return "100 g";
}

function normalizeSearchFood(food: SearchFood): CatalogSearchResult | null {
  if (!isSupportedDataType(food.dataType)) return null;
  const name = food.description.trim();
  if (!name) throw new CatalogInvalidResponseError();

  return {
    barcode: barcode(food.gtinUpc),
    brand: optionalText(food.brandName) ?? optionalText(food.brandOwner),
    dataType: food.dataType,
    measurementSummary: measurementSummary(food),
    name: name.normalize("NFC"),
    provider: "usda-fdc",
    providerFoodId: String(food.fdcId),
    providerPublishedDate: providerDate(
      food.publicationDate ?? food.publishedDate,
    ),
  };
}

type FoodNutrient = z.infer<typeof foodNutrientSchema>;
type DetailFood = z.infer<typeof detailFoodSchema>;

function fixedPointValue(
  value: number,
  multiplier: number,
): CatalogNutrientValue | null {
  if (value < 0) return null;
  if (!Number.isSafeInteger(multiplier) || multiplier <= 0) {
    throw new CatalogInvalidResponseError();
  }
  return { amount: value, fixedPointMultiplier: multiplier };
}

function nutrientValue(
  nutrients: FoodNutrient[],
  ids: readonly number[],
  conversions: Readonly<Record<string, number>>,
  onDiagnostic: (diagnostic: FoodCatalogDiagnostic) => void,
  providerFoodId: string,
): CatalogNutrientValue | null {
  for (const id of ids) {
    const nutrient = nutrients.find(
      (candidate) => candidate.nutrient.id === id,
    );
    if (!nutrient) continue;
    const multiplier =
      conversions[nutrient.nutrient.unitName.trim().toUpperCase()];
    if (multiplier === undefined) throw new CatalogInvalidResponseError();
    if (nutrient.amount < 0) {
      onDiagnostic({
        code: "negative_nutrient_amount",
        nutrientId: id,
        providerFoodId,
      });
    }
    return fixedPointValue(nutrient.amount, multiplier);
  }
  return null;
}

function normalizeNutrition(
  food: DetailFood,
  onDiagnostic: (diagnostic: FoodCatalogDiagnostic) => void,
): CatalogNutrition {
  const energyIds =
    food.dataType === "Foundation" ? [2048, 2047, 1008] : [1008];
  const nutrient = (
    ids: readonly number[],
    conversions: Readonly<Record<string, number>>,
  ) =>
    nutrientValue(
      food.foodNutrients,
      ids,
      conversions,
      onDiagnostic,
      String(food.fdcId),
    );
  return {
    carbohydrateMilligrams: nutrient([1005], { G: 1_000 }),
    energyMilliKcal: nutrient(energyIds, { KCAL: 1_000 }),
    fatMilligrams: nutrient([1004], { G: 1_000 }),
    fiberMilligrams: nutrient([1079], { G: 1_000 }),
    proteinMilligrams: nutrient([1003], { G: 1_000 }),
    sodiumMilligrams: nutrient([1093], {
      G: 1_000,
      MG: 1,
    }),
    sugarMilligrams: nutrient([2000], { G: 1_000 }),
  };
}

function portionLabel(portion: z.infer<typeof foodPortionSchema>): string {
  const amount = portion.amount && portion.amount > 0 ? portion.amount : 1;
  const unit =
    optionalText(portion.portionDescription) ??
    optionalText(portion.measureUnit?.name) ??
    optionalText(portion.measureUnit?.abbreviation) ??
    optionalText(portion.modifier) ??
    "portion";
  return `${amount} ${unit} (${portion.gramWeight} g)`;
}

function normalizeMeasurements(food: DetailFood): CatalogMeasurement[] {
  const measurements = new Map<string, CatalogMeasurement>();
  const servingUnit = supportedUnit(food.servingSizeUnit);
  if (
    servingUnit === "g" &&
    food.servingSize !== null &&
    food.servingSize !== undefined &&
    Number.isFinite(food.servingSize) &&
    food.servingSize > 0
  ) {
    const baseQuantityMicrounits = Math.round(food.servingSize * 1_000_000);
    if (
      Number.isSafeInteger(baseQuantityMicrounits) &&
      baseQuantityMicrounits > 0
    ) {
      const household = optionalText(food.householdServingFullText);
      const label = `${household ? `${household} (` : ""}${food.servingSize} g${household ? ")" : ""}`;
      measurements.set(`serving:g:${baseQuantityMicrounits}`, {
        baseQuantityMicrounits,
        id: `serving:g:${baseQuantityMicrounits}`,
        label,
        unit: "g",
      });
    }
  }

  for (const [index, candidate] of (food.foodPortions ?? []).entries()) {
    const parsed = foodPortionSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const portion = parsed.data;
    if (!(portion.gramWeight > 0)) continue;
    const baseQuantityMicrounits = Math.round(portion.gramWeight * 1_000_000);
    if (
      !Number.isSafeInteger(baseQuantityMicrounits) ||
      baseQuantityMicrounits <= 0
    )
      continue;
    const id = `portion:${portion.id ?? index}`;
    measurements.set(id, {
      baseQuantityMicrounits,
      id,
      label: portionLabel(portion),
      unit: "g",
    });
  }

  const baseId = "base:g:100000000";
  measurements.set(baseId, {
    baseQuantityMicrounits: 100_000_000,
    id: baseId,
    label: "100 g",
    unit: "g",
  });
  return [...measurements.values()];
}

function normalizeDetailFood(
  food: DetailFood,
  onDiagnostic: (diagnostic: FoodCatalogDiagnostic) => void,
): CatalogFood {
  const searchResult = normalizeSearchFood(food);
  if (!searchResult) throw new CatalogInvalidResponseError();
  return {
    ...searchResult,
    authoritativeBaseQuantityMicrounits: 100_000_000,
    authoritativeBaseUnit: "g",
    marketCountry: optionalText(food.marketCountry),
    measurements: normalizeMeasurements(food),
    nutritionPerAuthoritativeBase: normalizeNutrition(food, onDiagnostic),
    providerModifiedDate: providerDate(food.modifiedDate),
  };
}

function newestDuplicateRevision(
  foods: CatalogSearchResult[],
): CatalogSearchResult[] {
  const revisions = new Map<string, CatalogSearchResult>();
  for (const food of foods) {
    const key = food.barcode
      ? [
          food.barcode,
          food.name.toLocaleLowerCase("en-US"),
          food.brand?.toLocaleLowerCase("en-US") ?? "",
        ].join("\u0000")
      : `fdc:${food.providerFoodId}`;
    const current = revisions.get(key);
    if (
      !current ||
      (food.providerPublishedDate ?? "") > (current.providerPublishedDate ?? "")
    ) {
      revisions.set(key, food);
    }
  }
  return [...revisions.values()];
}

type UsdaAdapterOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetchImplementation?: typeof fetch;
  onDiagnostic?: (diagnostic: FoodCatalogDiagnostic) => void;
  timeoutMs?: number;
};

export class UsdaFoodDataCentralAdapter implements FoodCatalogProvider {
  readonly #apiKey: string | undefined;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #onDiagnostic: (diagnostic: FoodCatalogDiagnostic) => void;
  readonly #timeoutMs: number;

  constructor(options: UsdaAdapterOptions = {}) {
    this.#apiKey = options.apiKey?.trim() || undefined;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#onDiagnostic =
      options.onDiagnostic ??
      ((diagnostic) => console.warn("food_catalog_diagnostic", diagnostic));
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const url = new URL(this.#baseUrl);
    if (
      process.env.NODE_ENV === "production" &&
      (url.protocol !== "https:" || url.hostname !== "api.nal.usda.gov")
    ) {
      throw new CatalogConfigurationError();
    }
  }

  async search(query: string): Promise<CatalogSearchResult[]> {
    const parsedQuery = querySchema.safeParse(query);
    if (!parsedQuery.success) throw new CatalogInvalidResponseError();
    const response = await this.#request("foods/search", {
      body: JSON.stringify({
        dataType: [...SUPPORTED_CATALOG_DATA_TYPES],
        pageSize: 20,
        query: parsedQuery.data,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    const parsed = searchResponseSchema.safeParse(response);
    if (!parsed.success) throw new CatalogInvalidResponseError();
    return newestDuplicateRevision(
      parsed.data.foods
        .map(normalizeSearchFood)
        .filter((food): food is CatalogSearchResult => food !== null),
    );
  }

  async getFood(providerFoodId: string): Promise<CatalogFood> {
    const parsedId = providerFoodIdSchema.safeParse(providerFoodId);
    if (!parsedId.success) throw new CatalogFoodNotFoundError();
    const response = await this.#request(`food/${parsedId.data}`, {
      method: "GET",
    });
    const parsed = detailFoodSchema.safeParse(response);
    if (!parsed.success || String(parsed.data.fdcId) !== parsedId.data) {
      throw new CatalogInvalidResponseError();
    }
    return normalizeDetailFood(parsed.data, this.#onDiagnostic);
  }

  async #request(path: string, init: RequestInit): Promise<unknown> {
    if (!this.#apiKey) throw new CatalogConfigurationError();
    const url = new URL(`${this.#baseUrl}/${path}`);
    url.searchParams.set("api_key", this.#apiKey);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);

    try {
      const response = await this.#fetch(url, {
        ...init,
        signal: controller.signal,
      });
      if (response.status === 403) throw new CatalogCredentialsError();
      if (response.status === 404) throw new CatalogFoodNotFoundError();
      if (response.status === 429) throw new CatalogRateLimitError();
      if (!response.ok) throw new CatalogUnavailableError();
      try {
        return await response.json();
      } catch {
        throw new CatalogInvalidResponseError();
      }
    } catch (error) {
      if (
        error instanceof CatalogCredentialsError ||
        error instanceof CatalogFoodNotFoundError ||
        error instanceof CatalogInvalidResponseError ||
        error instanceof CatalogRateLimitError ||
        error instanceof CatalogUnavailableError
      ) {
        throw error;
      }
      throw new CatalogUnavailableError();
    } finally {
      clearTimeout(timeout);
    }
  }
}
