import { createHash } from "node:crypto";

import { z } from "zod";

import type { CatalogFood } from "../catalog/food-catalog.server";
import {
  BarcodeContactInvalidError,
  BarcodeLookupUnavailableError,
  BarcodeNotConfiguredError,
  BarcodeProductNotFoundError,
} from "./barcode.exceptions";
import { OFF_PRODUCT_FIELDS, offProductResponseSchema } from "./barcode.model";
import type { BarcodeRepository } from "./barcode.repository.server";
import { isSupportedCommercialBarcode, offNutrition } from "./barcode.utils";

const OFF_PRODUCT_URL = "https://world.openfoodfacts.org/api/v3.5/product/";
const LOOKUP_TIMEOUT_MS = 5_000;
const MAXIMUM_CONTACT_LENGTH = 200;

/** A printable-ASCII email without parentheses, so it cannot break the User-Agent comment. */
const contactSchema = z
  .string()
  .trim()
  .max(MAXIMUM_CONTACT_LENGTH)
  .regex(/^[\x20-\x27\x2a-\x7e]+$/)
  .pipe(z.email());

/** The fingerprint a reviewer and a later save compare: lowercase SHA-256 hex of the food. */
function fingerprint(food: Omit<CatalogFood, "catalogGeneration">): string {
  return createHash("sha256").update(JSON.stringify(food)).digest("hex");
}

/** Barcode lookup against the Open Food Facts product API, and the contact email it requires. */
export class BarcodeService {
  readonly #repository: BarcodeRepository;
  readonly #fetch: typeof fetch;
  readonly #version: string;

  constructor(repository: BarcodeRepository, fetcher: typeof fetch, version: string) {
    this.#repository = repository;
    this.#fetch = fetcher;
    this.#version = version;
  }

  contact(): string | undefined {
    return this.#repository.readContact();
  }

  isConfigured(): boolean {
    return this.contact() !== undefined;
  }

  /** Validates and stores the contact email, enabling lookup for everyone; returns the stored email. */
  saveContact(input: string): string {
    const parsed = contactSchema.safeParse(input);
    if (!parsed.success) throw new BarcodeContactInvalidError();
    this.#repository.saveContact(parsed.data, new Date());
    return parsed.data;
  }

  /** Clears the contact email, disabling lookup for everyone. */
  removeContact(): void {
    this.#repository.deleteContact();
  }

  /**
   * The current OFF product as a catalog food, sending the barcode once as entered. Its
   * `catalogGeneration` is a fingerprint of the food, so a later lookup reveals a changed product.
   */
  async lookup(barcode: string): Promise<CatalogFood> {
    if (!isSupportedCommercialBarcode(barcode)) throw new BarcodeProductNotFoundError();
    const contact = this.contact();
    if (contact === undefined) throw new BarcodeNotConfiguredError();
    const body = await this.#request(barcode, contact);
    const parsed = offProductResponseSchema.safeParse(body);
    if (!parsed.success) throw new BarcodeLookupUnavailableError();
    const food = offNutrition(parsed.data.product);
    if (!food) throw new BarcodeProductNotFoundError();
    return { ...food, catalogGeneration: fingerprint(food) };
  }

  async #request(barcode: string, contact: string): Promise<unknown> {
    const url = `${OFF_PRODUCT_URL}${barcode}?fields=${OFF_PRODUCT_FIELDS.join(",")}`;
    let response: Response;
    try {
      response = await this.#fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": `OpenCalorieTracker/${this.#version} (${contact})`,
        },
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      });
    } catch {
      throw new BarcodeLookupUnavailableError();
    }
    if (response.status === 404) throw new BarcodeProductNotFoundError();
    if (!response.ok) throw new BarcodeLookupUnavailableError();
    try {
      return await response.json();
    } catch {
      throw new BarcodeLookupUnavailableError();
    }
  }
}
