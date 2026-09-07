import { readUsdaGenerationFood, searchUsdaGeneration } from "../database/usda-generation.server";
import type { CatalogManagement } from "../catalog-management/catalog-management.server";
import { CatalogConfigurationError, CatalogFoodNotFoundError, type CatalogFood, type CatalogSearchResult, type SearchFoodCatalogProvider } from "./food-catalog.server";

export class LocalUsdaAdapter implements SearchFoodCatalogProvider {
  readonly #management: CatalogManagement;
  readonly #directory: string;
  constructor(management: CatalogManagement, directory: string) { this.#management = management; this.#directory = directory; }
  async search(query: string): Promise<CatalogSearchResult[]> {
    const tokens = query.normalize("NFKC").match(/[\p{L}\p{N}]+/gu)?.slice(0, 8) ?? [];
    if (query.length > 100 || query.trim().length < 2 || tokens.length === 0) return [];
    const expression = tokens.map(token => `"${token}"*`).join(" AND ");
    return searchUsdaGeneration(this.#directory, this.#generation(), expression);
  }
  async getFood(providerFoodId: string): Promise<CatalogFood> {
    if (!/^[1-9]\d*$/.test(providerFoodId)) throw new CatalogFoodNotFoundError();
    const food = readUsdaGenerationFood(this.#directory, this.#generation(), providerFoodId);
    if (!food) throw new CatalogFoodNotFoundError();
    return food;
  }

  #generation(): string {
    const installed = this.#management.read().installed;
    if (!installed) throw new CatalogConfigurationError();
    return installed.generation;
  }
}
