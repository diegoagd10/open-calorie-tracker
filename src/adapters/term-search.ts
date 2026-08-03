import { asProviderFailure, classifyHttpFailure, ProviderFailure } from "./errors.js";
import type { FoodCandidate, FoodSearchAdapter } from "./types.js";

export interface TermSearchRecord {
  id?: string;
  name: string;
  brand?: string | null;
  quantityBasis: string;
  calories?: number | null;
  nutrients?: Record<string, number | null>;
}

export function normalizeTermCandidate(record: TermSearchRecord, source = "Term food provider"): FoodCandidate {
  const nutrients = { ...(record.nutrients ?? {}), calories: record.calories ?? record.nutrients?.calories ?? null };
  const warnings = Object.entries(nutrients).filter(([key, value]) => key !== "calories" && value === null).map(([key]) => `${key} is unknown in this source record.`);
  if (nutrients.calories === null) warnings.unshift("Calories are missing and must be entered before confirmation.");
  return {
    name: record.name.trim() || "Unnamed food candidate",
    brand: record.brand ?? null,
    quantityBasis: record.quantityBasis.trim() || "serving",
    basisQuantity: 1,
    nutrients,
    source,
    sourceId: record.id,
    warnings,
    complete: Boolean(record.name.trim() && nutrients.calories !== null),
    requiresReview: true,
  };
}

export class TermFoodSearchAdapter implements FoodSearchAdapter {
  constructor(private readonly options: { endpoint: string; fetchImpl?: typeof fetch; headers?: Record<string, string> }) {}

  async search(query: string): Promise<FoodCandidate[]> {
    const normalized = query.trim();
    if (normalized.length < 2) throw new ProviderFailure("invalid", "Search needs at least two characters.", { retryable: false, manualFallback: false });
    try {
      const url = new URL(this.options.endpoint);
      url.searchParams.set("q", normalized);
      const response = await (this.options.fetchImpl ?? fetch)(url, { headers: { Accept: "application/json", ...this.options.headers } });
      if (!response.ok) throw classifyHttpFailure(response.status, "Term food provider");
      const data = await response.json() as { results?: TermSearchRecord[] } | TermSearchRecord[];
      const records = Array.isArray(data) ? data : data.results ?? [];
      return records.map((record) => normalizeTermCandidate(record));
    } catch (error) {
      throw asProviderFailure(error, "Term food provider");
    }
  }
}
