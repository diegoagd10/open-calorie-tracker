export type WaterEventValidationCode =
  | "invalid_input"
  | "invalid_amount"
  | "invalid_log_date"
  | "invalid_range"
  | "invalid_event_ids";

/** Input the Water Event rules reject; `message` is safe to show to the caller. */
export class WaterEventValidationError extends Error {
  constructor(public readonly code: WaterEventValidationCode, message: string) {
    super(message);
    this.name = "WaterEventValidationError";
  }
}

/** No Water Event with that ID is owned by the caller, whether it is missing or another account's. */
export class WaterEventNotFoundError extends Error {
  readonly code = "not_found" as const;

  constructor() {
    super("Water event not found.");
    this.name = "WaterEventNotFoundError";
  }
}
