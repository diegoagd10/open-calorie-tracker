import { readOffGenerationFood, searchOffGeneration } from "../database/off-generation.server";
import type { CatalogManagement } from "../catalog-management/catalog-management.server";
import { isSupportedCommercialBarcode } from "./barcode";
import { CatalogConfigurationError, CatalogFoodNotFoundError, type BarcodeFoodCatalogProvider, type SearchFoodCatalogProvider } from "./food-catalog.server";
import { offSearchRelevance } from "./off-search.server";
import { boundedSearchTokens, prefixSearchExpression } from "./search-normalization";

export class LocalOpenFoodFactsAdapter implements BarcodeFoodCatalogProvider, SearchFoodCatalogProvider {
  constructor(private readonly management: CatalogManagement, private readonly directory: string) {}
  async search(query: string) {
    const tokens = boundedSearchTokens(query);
    if (!tokens) return [];
    const installed = this.management.read().installed;
    if (!installed) throw new CatalogConfigurationError();
    return searchOffGeneration(this.directory, installed.generation, prefixSearchExpression(tokens), food => offSearchRelevance(food, tokens));
  }
  async lookupBarcode(barcode: string) { return this.getFood(barcode); }
  async getFood(id: string) {
    if (!isSupportedCommercialBarcode(id)) throw new CatalogFoodNotFoundError();
    const installed = this.management.read().installed;
    if (!installed) throw new CatalogConfigurationError();
    const food = readOffGenerationFood(this.directory, installed.generation, id);
    if (!food) throw new CatalogFoodNotFoundError();
    return food;
  }
}
