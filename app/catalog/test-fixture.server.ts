import {
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
      carbohydrateMilligrams: 3_530,
      energyMilliKcal: 59_000,
      fatMilligrams: 0,
      fiberMilligrams: null,
      proteinMilligrams: 10_590,
      sodiumMilligrams: 36,
      sugarMilligrams: 3_530,
    },
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
      case "none":
        return [];
      case "rate":
        throw new CatalogRateLimitError();
      case "unavailable":
        throw new CatalogUnavailableError();
      case "malformed":
        throw new CatalogInvalidResponseError();
      case "unsafe":
        return [
          {
            ...searchResult(yogurt()),
            measurementSummary: "Measurement unavailable",
            name: "Unsafe provider measurement",
            providerFoodId: "9999",
          },
        ];
      default:
        return [searchResult(yogurt())];
    }
  }

  async getFood(providerFoodId: string): Promise<CatalogFood> {
    if (providerFoodId === "9999") throw new CatalogUnsafeMeasurementError();
    if (providerFoodId !== "1001") throw new CatalogUnavailableError();
    return yogurt();
  }
}
