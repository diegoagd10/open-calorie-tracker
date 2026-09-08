export const SUPPORTED_CATALOG_DATA_TYPES = [
  "Branded",
  "Survey (FNDDS)",
  "Foundation",
] as const;

export type CatalogDataType =
  | (typeof SUPPORTED_CATALOG_DATA_TYPES)[number]
  | "Open Food Facts";
export type CatalogProviderId = "open-food-facts" | "usda-fdc";

export type CatalogSearchResult = {
  catalogGeneration?: string;
  calculationUnavailableReason?: string;
  barcode: string | null;
  brand: string | null;
  dataType: CatalogDataType;
  isSelectable: boolean;
  measurementSummary: string;
  name: string;
  provider: CatalogProviderId;
  providerFoodId: string;
  providerPublishedDate: string | null;
};

export type CatalogSearchFilter = "all" | "basic" | "packaged";
export type CatalogSearchGroupFields = {
  results: CatalogSearchResult[];
  status: "available" | "not-installed" | "unavailable";
};
export type CatalogSearchGroup = CatalogSearchGroupFields & (
  | { kind: "basic"; provider: "usda-fdc" }
  | { kind: "packaged"; provider: "open-food-facts" }
);
export type CatalogSearchResponse = { groups: CatalogSearchGroup[] };

export type CatalogMeasurement = {
  baseQuantityMicrounits: number;
  id: string;
  label: string;
  unit: "g" | "ml" | "serving";
};

export type CatalogNutrientValue = {
  amount: number;
  fixedPointMultiplier: number;
};

export type CatalogNutrition = {
  carbohydrateMilligrams: CatalogNutrientValue | null;
  energyMilliKcal: CatalogNutrientValue | null;
  fatMilligrams: CatalogNutrientValue | null;
  fiberMilligrams: CatalogNutrientValue | null;
  proteinMilligrams: CatalogNutrientValue | null;
  sodiumMilligrams: CatalogNutrientValue | null;
  sugarMilligrams: CatalogNutrientValue | null;
};

export type FoodCatalogDiagnostic = {
  code: "negative_nutrient_amount";
  nutrientId: number;
  providerFoodId: string;
};

export type CatalogOperationContext = {
  requestId: string;
};

export type CatalogFood = CatalogSearchResult & {
  offSourceFields?: Record<string, string>;
  authoritativeBaseQuantityMicrounits: number;
  authoritativeBaseUnit: "g" | "ml" | "serving";
  marketCountry: string | null;
  measurements: CatalogMeasurement[];
  nutritionPerAuthoritativeBase: CatalogNutrition;
  originalName: string;
  providerModifiedDate: string | null;
};

export interface FoodCatalogProvider {
  getFood(
    providerFoodId: string,
    context?: CatalogOperationContext,
  ): Promise<CatalogFood>;
}

export interface SearchFoodCatalogProvider extends FoodCatalogProvider {
  search(
    query: string,
    context?: CatalogOperationContext,
  ): Promise<CatalogSearchResult[]>;
}

export interface BarcodeFoodCatalogProvider extends FoodCatalogProvider {
  lookupBarcode(
    barcode: string,
    context?: CatalogOperationContext,
  ): Promise<CatalogFood>;
}

export interface FoodCatalogReader {
  getFood(
    provider: string,
    providerFoodId: string,
    context?: CatalogOperationContext,
  ): Promise<CatalogFood>;
}

export class CatalogStaleReviewError extends Error {
  constructor() {
    super("The catalog changed after this food was reviewed. Open the food again before saving.");
    this.name = "CatalogStaleReviewError";
  }
}

export class CatalogConfigurationError extends Error {
  constructor() {
    super("The food catalog is not configured");
    this.name = "CatalogConfigurationError";
  }
}

export class CatalogCredentialsError extends Error {
  constructor() {
    super("The food catalog credentials were rejected");
    this.name = "CatalogCredentialsError";
  }
}

export class CatalogRateLimitError extends Error {
  constructor() {
    super("The food catalog rate limit was reached");
    this.name = "CatalogRateLimitError";
  }
}

export class CatalogUnavailableError extends Error {
  constructor() {
    super("The food catalog is unavailable");
    this.name = "CatalogUnavailableError";
  }
}

export class CatalogInvalidResponseError extends Error {
  constructor() {
    super("The food catalog returned an invalid response");
    this.name = "CatalogInvalidResponseError";
  }
}

export class CatalogFoodNotFoundError extends Error {
  constructor() {
    super("The selected catalog food is no longer available");
    this.name = "CatalogFoodNotFoundError";
  }
}

export class CatalogUnsafeMeasurementError extends Error {
  constructor() {
    super("The selected catalog measurement is unavailable");
    this.name = "CatalogUnsafeMeasurementError";
  }
}

export class CatalogNutritionUnavailableError extends Error {
  constructor() {
    super("The catalog food has no usable nutrition per serving");
    this.name = "CatalogNutritionUnavailableError";
  }
}

export class CatalogUnknownProviderError extends Error {
  constructor() {
    super("The food catalog provider is unavailable");
    this.name = "CatalogUnknownProviderError";
  }
}

export class CatalogUnsupportedCapabilityError extends Error {
  constructor() {
    super("The food catalog provider does not support that operation");
    this.name = "CatalogUnsupportedCapabilityError";
  }
}

export type FoodCatalogRegistration =
  | {
      capability: "barcode";
      provider: CatalogProviderId;
      service: BarcodeFoodCatalogProvider;
    }
  | {
      capability: "search";
      provider: CatalogProviderId;
      service: SearchFoodCatalogProvider;
    };

type RegisteredProvider = {
  capabilities: Set<FoodCatalogRegistration["capability"]>;
  service: FoodCatalogProvider;
};

export class FoodCatalog implements FoodCatalogReader {
  readonly #providers = new Map<CatalogProviderId, RegisteredProvider>();

  constructor(registrations: FoodCatalogRegistration[]) {
    for (const registration of registrations) {
      const existing = this.#providers.get(registration.provider);
      if (existing) {
        if (existing.service !== registration.service) {
          throw new CatalogConfigurationError();
        }
        existing.capabilities.add(registration.capability);
      } else {
        this.#providers.set(registration.provider, {
          capabilities: new Set([registration.capability]),
          service: registration.service,
        });
      }
    }
  }

  async search(
    provider: string,
    query: string,
    context?: CatalogOperationContext,
  ): Promise<CatalogSearchResult[]> {
    const registered = this.#provider(provider, "search");
    const service = registered.service as SearchFoodCatalogProvider;
    const results = await service.search(query, context);
    if (results.some((result) => result.provider !== provider)) {
      throw new CatalogInvalidResponseError();
    }
    return results;
  }

  async searchAll(
    query: string,
    filter: CatalogSearchFilter = "all",
    context?: CatalogOperationContext,
  ): Promise<CatalogSearchResponse> {
    const sources = [
      { kind: "basic" as const, provider: "usda-fdc" as const },
      { kind: "packaged" as const, provider: "open-food-facts" as const },
    ].filter(source => filter === "all" || source.kind === filter);
    const groups = await Promise.all(sources.map(async source => {
      const registered = this.#providers.get(source.provider);
      if (!registered?.capabilities.has("search")) {
        return { ...source, results: [], status: "not-installed" as const };
      }
      try {
        const results = await (registered.service as SearchFoodCatalogProvider).search(query, context);
        if (results.some(result => result.provider !== source.provider)) throw new CatalogInvalidResponseError();
        return { ...source, results, status: "available" as const };
      } catch (error) {
        if (error instanceof CatalogConfigurationError) {
          return { ...source, results: [], status: "not-installed" as const };
        }
        if (
          error instanceof CatalogCredentialsError ||
          error instanceof CatalogInvalidResponseError ||
          error instanceof CatalogRateLimitError ||
          error instanceof CatalogUnavailableError
        ) {
          return { ...source, results: [], status: "unavailable" as const };
        }
        throw error;
      }
    }));
    const packaged = groups.find(group => group.kind === "packaged");
    const normalizedQuery = normalizedSearchWords(query).join(" ");
    const hasExactPackagedMatch = packaged?.results.some(result =>
      [result.name, result.brand]
        .filter((value): value is string => Boolean(value))
        .some(value => normalizedSearchWords(value).join(" ") === normalizedQuery),
    );
    if (hasExactPackagedMatch) groups.sort(group => group.kind === "packaged" ? -1 : 1);
    return { groups };
  }

  async lookupBarcode(
    provider: string,
    barcode: string,
    context?: CatalogOperationContext,
  ): Promise<CatalogFood> {
    const registered = this.#provider(provider, "barcode");
    const service = registered.service as BarcodeFoodCatalogProvider;
    return this.#validatedFood(
      provider,
      await service.lookupBarcode(barcode, context),
    );
  }

  async getFood(
    provider: string,
    providerFoodId: string,
    context?: CatalogOperationContext,
  ): Promise<CatalogFood> {
    const registered = this.#providers.get(provider as CatalogProviderId);
    if (!registered) throw new CatalogUnknownProviderError();
    return this.#validatedFood(
      provider,
      await registered.service.getFood(providerFoodId, context),
    );
  }

  #provider(
    provider: string,
    capability: FoodCatalogRegistration["capability"],
  ): RegisteredProvider {
    const registered = this.#providers.get(provider as CatalogProviderId);
    if (!registered) throw new CatalogUnknownProviderError();
    if (!registered.capabilities.has(capability)) {
      throw new CatalogUnsupportedCapabilityError();
    }
    return registered;
  }

  #validatedFood(provider: string, food: CatalogFood): CatalogFood {
    if (food.provider !== provider) throw new CatalogInvalidResponseError();
    return food;
  }
}
import { normalizedSearchWords } from "./search-normalization.ts";
