/** Barcode lookup is off until an administrator sets the Open Food Facts contact email. */
export class BarcodeNotConfiguredError extends Error {
  constructor() {
    super("Barcode lookup isn't configured.");
    this.name = "BarcodeNotConfiguredError";
  }
}

/** The barcode is unsupported, unknown to Open Food Facts, or has no usable label nutrition. */
export class BarcodeProductNotFoundError extends Error {
  constructor() {
    super("Product not found.");
    this.name = "BarcodeProductNotFoundError";
  }
}

/** Open Food Facts timed out, failed, rate limited the request, or replied with an unexpected shape. */
export class BarcodeLookupUnavailableError extends Error {
  constructor() {
    super("Open Food Facts isn't responding; try again or log it manually.");
    this.name = "BarcodeLookupUnavailableError";
  }
}

/** A contact email the barcode rules reject; `message` is safe to show to the administrator. */
export class BarcodeContactInvalidError extends Error {
  constructor() {
    super("Enter a valid email address.");
    this.name = "BarcodeContactInvalidError";
  }
}
