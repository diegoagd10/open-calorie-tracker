import {
  FoodEventConflictError,
  FoodEventNotFoundError,
  FoodEventValidationError,
  type FoodSourceCode,
  FoodSourceError,
} from "./food-event.exceptions";

/** Status codes for refusals a provider caused. */
const SOURCE_STATUS: Record<FoodSourceCode, number> = {
  catalog_changed: 409,
  nutrition_unavailable: 422,
  food_not_found: 404,
  source_unavailable: 503,
  barcode_not_configured: 503,
};

/** The HTTP status every web and REST transport answers a Food Event refusal with. */
export function foodEventErrorStatus(
  error: FoodEventValidationError | FoodSourceError | FoodEventNotFoundError | FoodEventConflictError,
): number {
  if (error instanceof FoodSourceError) return SOURCE_STATUS[error.code];
  if (error instanceof FoodEventNotFoundError) return 404;
  if (error instanceof FoodEventConflictError) return 409;
  if (error.code === "future_date") return 422;
  if (error.code === "missing_setup") return 409;
  return 400;
}
