export type CatalogDataType =
  | "Branded"
  | "Survey (FNDDS)"
  | "Foundation"
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

export type CatalogOperationContext = {
  requestId: string;
  reviewedCatalogGeneration?: string;
};

export type CatalogFood = CatalogSearchResult & {
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

export class CatalogRegistrationConflictError extends Error {
  constructor() {
    super("The food catalog registration is invalid");
    this.name = "CatalogRegistrationConflictError";
  }
}

export class CatalogNotInstalledError extends Error {
  constructor() {
    super("The food catalog is not installed");
    this.name = "CatalogNotInstalledError";
  }
}

export class CatalogUnavailableError extends Error {
  constructor() {
    super("The food catalog is unavailable");
    this.name = "CatalogUnavailableError";
  }
}

export class CatalogInvalidDataError extends Error {
  constructor() {
    super("The food catalog contains invalid data");
    this.name = "CatalogInvalidDataError";
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

export type FoodCatalogRegistration = {
  capability: "search";
  provider: "usda-fdc";
  service: SearchFoodCatalogProvider;
};

export class FoodCatalog implements FoodCatalogReader {
  readonly #providers = new Map<CatalogProviderId, SearchFoodCatalogProvider>();

  constructor(registrations: FoodCatalogRegistration[]) {
    for (const registration of registrations) {
      const existing = this.#providers.get(registration.provider);
      if (existing && existing !== registration.service) {
        throw new CatalogRegistrationConflictError();
      }
      this.#providers.set(registration.provider, registration.service);
    }
  }

  async search(
    query: string,
    context?: CatalogOperationContext,
  ): Promise<CatalogSearchResult[]> {
    const service = this.#providers.get("usda-fdc");
    if (!service) throw new CatalogUnknownProviderError();
    const results = await service.search(query, context);
    if (results.some((result) => result.provider !== "usda-fdc")) {
      throw new CatalogInvalidDataError();
    }
    return results;
  }

  async getFood(
    provider: string,
    providerFoodId: string,
    context?: CatalogOperationContext,
  ): Promise<CatalogFood> {
    const service = this.#providers.get(provider as CatalogProviderId);
    if (!service) throw new CatalogUnknownProviderError();
    const food = await service.getFood(providerFoodId, context);
    if (food.provider !== provider) throw new CatalogInvalidDataError();
    return food;
  }
}
