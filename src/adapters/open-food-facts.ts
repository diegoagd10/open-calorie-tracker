import { asProviderFailure, classifyHttpFailure, ProviderFailure } from "./errors.js";
import type { BarcodeAdapter, FoodCandidate, FoodSearchAdapter } from "./types.js";

type FetchLike = typeof fetch;

const fields = [
  "code",
  "product_name",
  "product_name_en",
  "brands",
  "ingredients_text",
  "ingredients_text_en",
  "serving_size",
  "nutrition_data_per",
  "nutriments",
].join(",");

const nutrientAliases: Record<string, { aliases: string[]; unit: "kcal" | "g" | "mg" }> = {
  calories: { aliases: ["energy-kcal", "energy"], unit: "kcal" },
  protein: { aliases: ["proteins", "protein"], unit: "g" },
  carbohydrates: { aliases: ["carbohydrates"], unit: "g" },
  fat: { aliases: ["fat"], unit: "g" },
  fiber: { aliases: ["fiber", "fibers"], unit: "g" },
  addedSugar: { aliases: ["added-sugars", "added_sugars"], unit: "g" },
  sugar: { aliases: ["sugars"], unit: "g" },
  saturatedFat: { aliases: ["saturated-fat"], unit: "g" },
  sodium: { aliases: ["sodium"], unit: "mg" },
};

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function convert(value: number, sourceUnit: string | undefined, targetUnit: "kcal" | "g" | "mg"): number {
  if (!sourceUnit || sourceUnit === targetUnit) return value;
  const source = sourceUnit.toLowerCase().replace("µ", "u");
  if (targetUnit === "mg" && source === "g") return value * 1000;
  if (targetUnit === "g" && source === "mg") return value / 1000;
  if (targetUnit === "mg" && source === "ug") return value / 1000;
  if (targetUnit === "g" && source === "ug") return value / 1_000_000;
  if (targetUnit === "kcal" && source === "kj") return value / 4.184;
  return value;
}

function nutrientValue(nutriments: Record<string, unknown>, aliases: string[], basis: "serving" | "100g", unit: "kcal" | "g" | "mg"): number | null {
  for (const alias of aliases) {
    const value = numeric(nutriments[`${alias}_${basis}`]);
    if (value !== null) return convert(value, String(nutriments[`${alias}_unit`] || ""), unit);
  }
  return null;
}

function hasBasisValues(nutriments: Record<string, unknown>, basis: "serving" | "100g"): boolean {
  return Object.values(nutrientAliases).some(({ aliases }) => aliases.some((alias) => numeric(nutriments[`${alias}_${basis}`]) !== null));
}

export function normalizeBarcode(value: string): string {
  const raw = String(value ?? "").trim();
  if (!raw || /[^0-9\s-]/.test(raw)) throw new ProviderFailure("invalid", "Enter an 8-14 digit UPC, EAN, or GTIN barcode.", { retryable: false, manualFallback: true });
  const barcode = raw.replace(/[\s-]/g, "");
  if (!/^\d{8,14}$/.test(barcode)) throw new ProviderFailure("invalid", "Enter an 8-14 digit UPC, EAN, or GTIN barcode.", { retryable: false, manualFallback: true });
  return barcode;
}

export function normalizeOpenFoodFactsProduct(product: Record<string, unknown>): FoodCandidate {
  const nutriments = (product.nutriments && typeof product.nutriments === "object" ? product.nutriments : {}) as Record<string, unknown>;
  const basis = product.nutrition_data_per === "serving" && hasBasisValues(nutriments, "serving") ? "serving" : "100 g";
  const basisKey = basis === "serving" ? "serving" : "100g";
  const nutrients: Record<string, number | null> = {};
  for (const [key, definition] of Object.entries(nutrientAliases)) nutrients[key] = nutrientValue(nutriments, definition.aliases, basisKey, definition.unit);
  const name = String(product.product_name || product.product_name_en || "").trim();
  const warnings: string[] = [];
  if (!name) warnings.push("The provider did not supply a product name.");
  if (nutrients.calories === null) warnings.push("Calories are missing and must be entered before confirmation.");
  for (const [key, value] of Object.entries(nutrients)) if (key !== "calories" && value === null) warnings.push(`${key} is unknown in this source record.`);
  return {
    name: name || "Unnamed food candidate",
    brand: product.brands ? String(product.brands) : null,
    description: product.ingredients_text || product.ingredients_text_en ? String(product.ingredients_text || product.ingredients_text_en) : null,
    quantityBasis: basis === "serving" ? (product.serving_size ? `serving (${String(product.serving_size)})` : "serving") : "100 g",
    basisQuantity: 1,
    nutrients,
    source: "Open Food Facts",
    sourceId: product.code ? String(product.code) : undefined,
    warnings,
    complete: Boolean(name && nutrients.calories !== null),
    requiresReview: true,
  };
}

export interface OpenFoodFactsOptions {
  fetchImpl?: FetchLike;
  baseUrl?: string;
  userAgent?: string;
}

export class OpenFoodFactsAdapter implements BarcodeAdapter, FoodSearchAdapter {
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly userAgent: string;

  constructor(options: OpenFoodFactsOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://world.openfoodfacts.org";
    this.userAgent = options.userAgent ?? "Calories/1.0 (self-hosted)";
  }

  async lookup(input: string): Promise<FoodCandidate> {
    const barcode = normalizeBarcode(input);
    try {
      const endpoint = new URL(`/api/v3/product/${barcode}`, this.baseUrl);
      endpoint.searchParams.set("product_type", "food");
      endpoint.searchParams.set("fields", fields);
      const response = await this.fetchImpl(endpoint, { headers: { Accept: "application/json", "User-Agent": this.userAgent } });
      if (!response.ok) throw classifyHttpFailure(response.status, "Open Food Facts");
      const data = await response.json() as { status?: number; product?: Record<string, unknown> };
      if (!data.product || data.status === 0) throw new ProviderFailure("not_found", "No product was found for that barcode.", { manualFallback: true });
      const candidate = normalizeOpenFoodFactsProduct(data.product);
      if (!candidate.name || !candidate.complete && candidate.nutrients.calories === undefined) throw new ProviderFailure("incomplete", "The product record is incomplete.", { retryable: false, manualFallback: true });
      return candidate;
    } catch (error) {
      throw asProviderFailure(error, "Open Food Facts");
    }
  }

  async search(query: string): Promise<FoodCandidate[]> {
    const normalized = query.trim();
    if (normalized.length < 2) throw new ProviderFailure("invalid", "Search needs at least two characters.", { retryable: false, manualFallback: false });
    try {
      const endpoint = new URL("/cgi/search.pl", this.baseUrl);
      endpoint.searchParams.set("search_terms", normalized);
      endpoint.searchParams.set("search_simple", "1");
      endpoint.searchParams.set("action", "process");
      endpoint.searchParams.set("json", "1");
      endpoint.searchParams.set("page_size", "20");
      endpoint.searchParams.set("fields", fields);
      const response = await this.fetchImpl(endpoint, { headers: { Accept: "application/json", "User-Agent": this.userAgent } });
      if (!response.ok) throw classifyHttpFailure(response.status, "Open Food Facts");
      const data = await response.json() as { products?: Record<string, unknown>[] };
      return (data.products ?? []).map(normalizeOpenFoodFactsProduct);
    } catch (error) {
      throw asProviderFailure(error, "Open Food Facts");
    }
  }
}
