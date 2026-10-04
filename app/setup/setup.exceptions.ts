/** A Setup field the rules reject; `message` is safe to show to the account holder. */
export class SetupValidationError extends Error {
  constructor(public readonly field: "timeZone", message: string) {
    super(message);
    this.name = "SetupValidationError";
  }
}

/** The account already finished Setup; its time zone and first Daily Goal are written once. */
export class SetupCompleteError extends Error {
  constructor() {
    super("Setup is already complete.");
    this.name = "SetupCompleteError";
  }
}
