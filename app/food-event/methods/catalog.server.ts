import { randomUUID } from "node:crypto";

import { isSupportedCommercialBarcode } from "../../barcode";
import {
  CatalogFoodNotFoundError,
  CatalogInvalidDataError,
  CatalogNotInstalledError,
  CatalogNutritionUnavailableError,
  CatalogStaleReviewError,
  CatalogUnavailableError,
  CatalogUnknownProviderError,
  CatalogUnsafeMeasurementError,
  type CatalogFood,
  type CatalogMeasurement,
  type FoodCatalog,
} from "../../catalog/food-catalog.server";
import {
  BarcodeLookupUnavailableError,
  BarcodeNotConfiguredError,
  BarcodeProductNotFoundError,
} from "../../catalog/open-food-facts.exceptions";
import type { CreateFoodEvent, FoodSnapshot } from "../food-event.model";
import {
  FoodEventValidationError,
  FoodSourceError,
  type FoodEventValidationCode,
  type FoodSourceCode,
} from "../food-event.exceptions";
import { scaleNutrients } from "../nutrition";

export type CatalogMethod = "lookup" | "barcode";
export type ReviewedFood = Extract<CreateFoodEvent, { method: CatalogMethod }>;

/** Lookup always reads USDA and barcode always reads Open Food Facts. */
const PROVIDERS = { lookup: "usda-fdc", barcode: "open-food-facts" } as const;

/** A catalog failure as the Add Food dialog and every transport explain it. */
export type CatalogFailure = {
  code: FoodSourceCode | Extract<FoodEventValidationCode, "invalid_measurement">;
  status: number;
  title: string;
  message: string;
  /** The sentence a failed save shows when it differs from the review screen's. */
  saveMessage?: string;
};

function usdaFailure(error: unknown): CatalogFailure | undefined {
  if (error instanceof CatalogStaleReviewError) {
    return { code: "catalog_changed", status: 409, title: "Review food again", message: error.message };
  }
  if (error instanceof CatalogNutritionUnavailableError) {
    return { code: "nutrition_unavailable", status: 422, title: "Nutrition unavailable", message: "This food has no usable calories in the installed catalog." };
  }
  if (error instanceof CatalogNotInstalledError) {
    return {
      code: "source_unavailable",
      status: 503,
      title: "USDA Foundation is not installed",
      message: "USDA Foundation is not installed. Ask your administrator to install it in Food Catalogs Settings. Your saved Food Entries remain available.",
    };
  }
  if (error instanceof CatalogFoodNotFoundError) {
    return {
      code: "food_not_found",
      status: 409,
      title: "Food no longer available",
      message: "USDA listed this food in search, but its details are no longer available. Choose another result.",
    };
  }
  if (error instanceof CatalogUnsafeMeasurementError) {
    return { code: "invalid_measurement", status: 422, title: "Measurement unavailable", message: "That food has no safe provider-backed measurement to log." };
  }
  if (error instanceof CatalogInvalidDataError) {
    return {
      code: "source_unavailable",
      status: 500,
      title: "USDA catalog data could not be used",
      message: "The installed USDA catalog contains food data that could not be used safely.",
    };
  }
  if (error instanceof CatalogUnavailableError) {
    return { code: "source_unavailable", status: 503, title: "USDA is unavailable", message: "USDA is unavailable right now. Your saved Food Entries are unaffected." };
  }
  if (error instanceof CatalogUnknownProviderError) {
    return { code: "source_unavailable", status: 503, title: "Catalog unavailable", message: "The selected Food Catalog provider is unavailable." };
  }
  return undefined;
}

function barcodeFailure(error: unknown): CatalogFailure | undefined {
  if (error instanceof BarcodeNotConfiguredError) {
    return {
      code: "barcode_not_configured",
      status: 503,
      title: "Barcode lookup isn't configured",
      message: "Barcode lookup isn't configured. Ask an administrator. USDA search and manual entry remain available.",
    };
  }
  if (error instanceof BarcodeProductNotFoundError) {
    return { code: "food_not_found", status: 404, title: "Product not found", message: "Product not found. Check the barcode, enter another code, or log it manually." };
  }
  if (error instanceof CatalogStaleReviewError) {
    return { code: "catalog_changed", status: 409, title: "Review product again", message: "The product changed on Open Food Facts. Review it again before saving." };
  }
  if (error instanceof CatalogNutritionUnavailableError) {
    return { code: "nutrition_unavailable", status: 422, title: "Nutrition unavailable", message: "This product has no usable nutrition with a supported calculation basis." };
  }
  if (error instanceof CatalogUnsafeMeasurementError) {
    return {
      code: "invalid_measurement",
      status: 422,
      title: "Measurement unavailable",
      message: "This product no longer has the selected supported measurement. Your Food Log was not changed.",
    };
  }
  if (error instanceof CatalogInvalidDataError) {
    return {
      code: "source_unavailable",
      status: 500,
      title: "Open Food Facts data could not be used",
      message: "Open Food Facts returned product data that could not be used safely.",
    };
  }
  if (error instanceof BarcodeLookupUnavailableError) {
    return {
      code: "source_unavailable",
      status: 503,
      title: "Open Food Facts isn't responding",
      message: "Try again or log it manually.",
      // A save has no title line, so it keeps the whole sentence.
      saveMessage: error.message,
    };
  }
  if (error instanceof CatalogUnknownProviderError) {
    return { code: "source_unavailable", status: 503, title: "Open Food Facts unavailable", message: "The selected Food Catalog provider is unavailable." };
  }
  return undefined;
}

/** How a catalog or Open Food Facts error reads for `method`, or undefined for an unexpected error. */
export function catalogFailure(error: unknown, method: CatalogMethod): CatalogFailure | undefined {
  return method === "barcode" ? barcodeFailure(error) : usdaFailure(error);
}

function invalid(code: FoodEventValidationCode, message: string): FoodEventValidationError {
  return new FoodEventValidationError(code, message);
}

/** Rejects identities and review versions the method's provider could never have returned. */
function requireReviewedIdentity(input: ReviewedFood): void {
  const validId = input.method === "lookup"
    ? /^[1-9]\d{0,15}$/.test(input.providerFoodId)
    : isSupportedCommercialBarcode(input.providerFoodId);
  const validVersion = input.method === "lookup"
    ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.reviewVersion)
    : /^[0-9a-f]{64}$/.test(input.reviewVersion);
  if (!validId || !validVersion || typeof input.measurementId !== "string" || !input.measurementId || input.measurementId.length > 128) {
    throw invalid("invalid_input", "Send the providerFoodId, reviewVersion, and measurementId of a food reviewed from the catalog.");
  }
}

/** The reviewed measurement, which must share the authority's unit; OFF products also need a safe authority. */
function reviewedMeasurement(food: CatalogFood, input: ReviewedFood): CatalogMeasurement {
  if (food.providerFoodId !== input.providerFoodId || (input.method === "barcode" && food.barcode !== input.providerFoodId)) {
    throw new CatalogInvalidDataError();
  }
  const measurement = food.measurements.find((candidate) => candidate.id === input.measurementId);
  if (!measurement || measurement.unit !== food.authoritativeBaseUnit) throw new CatalogUnsafeMeasurementError();
  if (input.method === "barcode") {
    const serving = food.authoritativeBaseUnit === "serving";
    const safe = food.dataType === "Open Food Facts" && (serving
      ? food.authoritativeBaseQuantityMicrounits === 1_000_000 && measurement.id === "serving" && measurement.baseQuantityMicrounits === 1_000_000
      : Boolean(food.catalogGeneration) && Number.isSafeInteger(food.authoritativeBaseQuantityMicrounits) && food.authoritativeBaseQuantityMicrounits > 0
        && Number.isSafeInteger(measurement.baseQuantityMicrounits) && measurement.baseQuantityMicrounits > 0);
    if (!safe) throw new CatalogUnsafeMeasurementError();
  }
  return measurement;
}

/** The snapshot a catalog food records: its source, unrounded authority, and nutrients for this amount. */
function catalogSnapshot(food: CatalogFood, measurement: CatalogMeasurement, quantityMicrounits: number): FoodSnapshot {
  const authority = {
    unit: food.authoritativeBaseUnit,
    quantityMicrounits: food.authoritativeBaseQuantityMicrounits,
    nutrition: food.nutritionPerAuthoritativeBase,
  };
  return {
    source: {
      provider: food.provider,
      providerFoodId: food.providerFoodId,
      dataType: food.dataType,
      brand: food.brand,
      barcode: food.barcode,
      marketCountry: food.marketCountry,
      publishedDate: food.providerPublishedDate,
      modifiedDate: food.providerModifiedDate,
    },
    originalName: food.originalName,
    editedName: null,
    authority,
    measurements: food.measurements.filter((candidate) => candidate.unit === food.authoritativeBaseUnit),
    measurement,
    quantityMicrounits,
    nutrients: scaleNutrients(authority, measurement, quantityMicrounits),
  };
}

/**
 * Reads the reviewed food again from its provider and snapshots it, refusing a food whose
 * catalog generation or product fingerprint changed since the review. Provider failures become
 * Food Event errors, worded for the method.
 */
export async function resolveCatalogFood(
  catalog: Pick<FoodCatalog, "getFood">,
  input: ReviewedFood,
  quantityMicrounits: number,
  requestId: string | undefined,
): Promise<FoodSnapshot> {
  requireReviewedIdentity(input);
  try {
    const food = await catalog.getFood(PROVIDERS[input.method], input.providerFoodId, {
      requestId: requestId ?? randomUUID(),
      reviewedCatalogGeneration: input.reviewVersion,
    });
    if (food.catalogGeneration !== input.reviewVersion) throw new CatalogStaleReviewError();
    if (!food.isSelectable) throw new CatalogNutritionUnavailableError();
    return catalogSnapshot(food, reviewedMeasurement(food, input), quantityMicrounits);
  } catch (error) {
    const failure = catalogFailure(error, input.method);
    if (!failure) throw error;
    const message = failure.saveMessage ?? failure.message;
    if (failure.code === "invalid_measurement") throw invalid("invalid_measurement", message);
    throw new FoodSourceError(failure.code, message);
  }
}
