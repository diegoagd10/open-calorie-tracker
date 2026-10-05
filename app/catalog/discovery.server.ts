import { isSupportedCommercialBarcode } from "../barcode";
import type { CatalogFoodSummary, DisplayNutrition, FindCatalogFoods, ReviewableFood } from "./catalog.model";
import {
  CatalogFoodNotFoundError,
  CatalogInvalidDataError,
  CatalogNotInstalledError,
  CatalogUnavailableError,
  CatalogUnknownProviderError,
  CatalogUnsafeMeasurementError,
  type CatalogFood,
  type CatalogNutrientValue,
  type CatalogSearchResult,
  type FoodCatalog,
} from "./food-catalog.server";
import {
  BarcodeLookupUnavailableError,
  BarcodeNotConfiguredError,
  BarcodeProductNotFoundError,
} from "./open-food-facts.exceptions";

/** A discovery request or provider refusal, with the code and status every transport reports. */
export class CatalogDiscoveryError extends Error {
  constructor(
    public readonly code: "invalid_query" | "invalid_food_id" | "invalid_barcode" | "food_not_found" | "catalog_not_installed" | "source_unavailable" | "barcode_not_configured",
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CatalogDiscoveryError";
  }
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function display(value: CatalogNutrientValue | null, divisor: number): number | null {
  return value === null ? null : round((value.amount * value.fixedPointMultiplier) / divisor);
}

function displayNutrition(food: CatalogFood): DisplayNutrition {
  const nutrition = food.nutritionPerAuthoritativeBase;
  return {
    energyKcal: display(nutrition.energyMilliKcal, 1_000),
    proteinG: display(nutrition.proteinMilligrams, 1_000),
    carbohydrateG: display(nutrition.carbohydrateMilligrams, 1_000),
    fatG: display(nutrition.fatMilligrams, 1_000),
    fiberG: display(nutrition.fiberMilligrams, 1_000),
    sugarG: display(nutrition.sugarMilligrams, 1_000),
    sodiumMg: display(nutrition.sodiumMilligrams, 1),
  };
}

function presentCatalogSearchResult(result: CatalogSearchResult): CatalogFoodSummary {
  return {
    provider: result.provider,
    providerFoodId: result.providerFoodId,
    name: result.name,
    brand: result.brand,
    dataType: result.dataType,
    measurementSummary: result.measurementSummary,
    isSelectable: result.isSelectable,
    publishedDate: result.providerPublishedDate,
  };
}

function presentReviewableFood(food: CatalogFood): ReviewableFood {
  return {
    provider: food.provider,
    providerFoodId: food.providerFoodId,
    reviewVersion: food.catalogGeneration ?? "",
    name: food.name,
    brand: food.brand,
    barcode: food.barcode,
    dataType: food.dataType,
    isSelectable: food.isSelectable,
    unavailableReason: food.calculationUnavailableReason ?? null,
    nutritionBasis: { quantity: food.authoritativeBaseQuantityMicrounits / 1_000_000, unit: food.authoritativeBaseUnit },
    nutrition: displayNutrition(food),
    measurements: food.measurements
      .filter((measurement) => measurement.unit === food.authoritativeBaseUnit)
      .map((measurement) => ({
        id: measurement.id,
        label: measurement.label,
        unit: measurement.unit,
        quantity: measurement.baseQuantityMicrounits / 1_000_000,
      })),
  };
}

/** A catalog or Open Food Facts failure as a discovery error, or undefined when it is unexpected. */
function discoveryFailure(error: unknown): CatalogDiscoveryError | undefined {
  if (error instanceof CatalogFoodNotFoundError || error instanceof BarcodeProductNotFoundError || error instanceof CatalogUnsafeMeasurementError) {
    return new CatalogDiscoveryError("food_not_found", 404, "No usable food has that ID or barcode.");
  }
  if (error instanceof CatalogNotInstalledError) {
    return new CatalogDiscoveryError("catalog_not_installed", 503, "USDA Foundation is not installed. Ask your administrator to install it.");
  }
  if (error instanceof BarcodeNotConfiguredError) {
    return new CatalogDiscoveryError("barcode_not_configured", 503, "Barcode lookup isn't configured. Ask an administrator.");
  }
  if (error instanceof BarcodeLookupUnavailableError) {
    return new CatalogDiscoveryError("source_unavailable", 503, error.message);
  }
  if (error instanceof CatalogUnavailableError || error instanceof CatalogInvalidDataError || error instanceof CatalogUnknownProviderError) {
    return new CatalogDiscoveryError("source_unavailable", 503, "The food catalog is unavailable right now; try again later.");
  }
  return undefined;
}

/**
 * Searches USDA, reads one USDA food, or looks a barcode up on Open Food Facts. Invalid requests
 * and provider refusals become `CatalogDiscoveryError`s; anything else is unexpected.
 */
export async function findCatalogFoods(
  catalog: Pick<FoodCatalog, "search" | "getFood" | "lookupBarcode">,
  find: FindCatalogFoods,
  requestId: string,
): Promise<{ results: CatalogFoodSummary[] } | { food: ReviewableFood }> {
  try {
    if ("query" in find) {
      const query = typeof find.query === "string" ? find.query.trim() : "";
      if (query.length < 2 || query.length > 100) {
        throw new CatalogDiscoveryError("invalid_query", 400, "Search with 2 to 100 characters.");
      }
      return { results: (await catalog.search(query, { requestId })).map(presentCatalogSearchResult) };
    }
    if ("providerFoodId" in find) {
      if (typeof find.providerFoodId !== "string" || !/^[1-9]\d{0,15}$/.test(find.providerFoodId)) {
        throw new CatalogDiscoveryError("invalid_food_id", 400, "Send a USDA providerFoodId from search_foods.");
      }
      return { food: presentReviewableFood(await catalog.getFood("usda-fdc", find.providerFoodId, { requestId })) };
    }
    const barcode = typeof find.barcode === "string" ? find.barcode.trim() : "";
    if (!isSupportedCommercialBarcode(barcode)) {
      throw new CatalogDiscoveryError("invalid_barcode", 400, "Send a 7, 8, 12, 13, or 14 digit barcode.");
    }
    return { food: presentReviewableFood(await catalog.lookupBarcode(barcode)) };
  } catch (error) {
    throw discoveryFailure(error) ?? error;
  }
}
