export const SUPPORTED_CATALOG_DATA_TYPES = [
  "Branded",
  "Survey (FNDDS)",
  "Foundation",
] as const;

export type CatalogDataType = (typeof SUPPORTED_CATALOG_DATA_TYPES)[number];

export type CatalogSearchResult = {
  barcode: string | null;
  brand: string | null;
  dataType: CatalogDataType;
  isSelectable: boolean;
  measurementSummary: string;
  name: string;
  provider: "usda-fdc";
  providerFoodId: string;
  providerPublishedDate: string | null;
};

export type CatalogMeasurement = {
  baseQuantityMicrounits: number;
  id: string;
  label: string;
  unit: "g" | "ml";
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

export type CatalogFood = CatalogSearchResult & {
  authoritativeBaseQuantityMicrounits: number;
  authoritativeBaseUnit: "g" | "ml";
  marketCountry: string | null;
  measurements: CatalogMeasurement[];
  nutritionPerAuthoritativeBase: CatalogNutrition;
  originalName: string;
  providerModifiedDate: string | null;
};

export interface FoodCatalogProvider {
  getFood(providerFoodId: string): Promise<CatalogFood>;
  search(query: string): Promise<CatalogSearchResult[]>;
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
