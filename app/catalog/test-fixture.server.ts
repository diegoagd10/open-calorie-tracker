import {
  CatalogConfigurationError,
  CatalogCredentialsError,
  CatalogFoodNotFoundError,
  CatalogInvalidResponseError,
  CatalogRateLimitError,
  CatalogUnavailableError,
  CatalogUnsafeMeasurementError,
  type CatalogFood,
  type CatalogSearchResult,
  type FoodCatalogProvider,
} from "./food-catalog.server";

function yogurt(): CatalogFood {
  return {
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
  };
}

function searchResult(food: CatalogFood): CatalogSearchResult {
  return {
    barcode: food.barcode,
    brand: food.brand,
    dataType: food.dataType,
    isSelectable: food.isSelectable,
    measurementSummary: food.measurementSummary,
    name: food.name,
    provider: food.provider,
    providerFoodId: food.providerFoodId,
    providerPublishedDate: food.providerPublishedDate,
  };
}

export class TestFoodCatalogProvider implements FoodCatalogProvider {
  async search(query: string): Promise<CatalogSearchResult[]> {
    switch (query.trim().toLowerCase()) {
      case "configuration":
        throw new CatalogConfigurationError();
      case "credentials":
        throw new CatalogCredentialsError();
      case "none":
        return [];
      case "rate":
        throw new CatalogRateLimitError();
      case "unavailable":
      case "timeout":
        throw new CatalogUnavailableError();
      case "malformed":
        throw new CatalogInvalidResponseError();
      case "unsafe":
        return [
          {
            ...searchResult(yogurt()),
            isSelectable: false,
            measurementSummary: "Measurement unavailable",
            name: "Unsafe provider measurement",
            providerFoodId: "9999",
          },
        ];
      case "vanished":
        return [
          {
            ...searchResult(yogurt()),
            name: "Vanished catalog food",
            providerFoodId: "4040",
          },
        ];
      default:
        return [searchResult(yogurt())];
    }
  }

  async getFood(providerFoodId: string): Promise<CatalogFood> {
    if (providerFoodId === "4040") throw new CatalogFoodNotFoundError();
    if (providerFoodId === "9999") throw new CatalogUnsafeMeasurementError();
    if (providerFoodId !== "1001") throw new CatalogUnavailableError();
    return yogurt();
  }
}
