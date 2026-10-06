import type { FoodEvent } from "./food-event.model";

export type FoodEventValidationCode =
  | "invalid_input"
  | "invalid_quantity"
  | "invalid_nutrition"
  | "invalid_measurement"
  | "invalid_log_date"
  | "future_date"
  | "missing_setup"
  | "invalid_range"
  | "invalid_event_ids";

/** Input the Food Event rules reject; `message` is safe to show to the caller. */
export class FoodEventValidationError extends Error {
  constructor(public readonly code: FoodEventValidationCode, message: string) {
    super(message);
    this.name = "FoodEventValidationError";
  }
}

/** No Food Event (or favorite) with that ID is owned by the caller, whether missing or another account's. */
export class FoodEventNotFoundError extends Error {
  readonly code = "not_found" as const;

  constructor(message = "Food event not found.") {
    super(message);
    this.name = "FoodEventNotFoundError";
  }
}

/** The event changed after the caller read it; `current` is the version to review and retry from. */
export class FoodEventConflictError extends Error {
  readonly code = "edit_conflict" as const;

  constructor(public readonly current: FoodEvent) {
    super("This Food Event changed after you opened it. Review it and try again.");
    this.name = "FoodEventConflictError";
  }
}

export type FoodSourceCode =
  | "catalog_changed"
  | "nutrition_unavailable"
  | "food_not_found"
  | "source_unavailable"
  | "barcode_not_configured";

/** A catalog food could not be saved as reviewed; nothing was written. `message` is safe to show. */
export class FoodSourceError extends Error {
  constructor(public readonly code: FoodSourceCode, message: string) {
    super(message);
    this.name = "FoodSourceError";
  }
}
