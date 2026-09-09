import { readOffGenerationFood, searchOffGeneration } from "../database/off-generation.server";
import type { CatalogManagement } from "../catalog-management/catalog-management.server";
import { isSupportedCommercialBarcode } from "./barcode";
import { CatalogNotInstalledError, CatalogFoodNotFoundError, CatalogStaleReviewError, CatalogUnavailableError, type BarcodeFoodCatalogProvider, type CatalogOperationContext, type SearchFoodCatalogProvider } from "./food-catalog.server";
import { offSearchRelevance } from "./off-search.server";
import { boundedSearchTokens, prefixSearchExpression } from "./search-normalization";

export class LocalOpenFoodFactsAdapter implements BarcodeFoodCatalogProvider, SearchFoodCatalogProvider {
  constructor(private readonly management: CatalogManagement, private readonly directory: string) {}
  async search(query: string) {
    const tokens = boundedSearchTokens(query);
    if (!tokens) return [];
    let results;
    try {
      results = await this.management.withActiveGeneration(generation => searchOffGeneration(this.directory, generation, prefixSearchExpression(tokens), food => offSearchRelevance(food, tokens)));
    } catch {
      throw new CatalogUnavailableError();
    }
    if (!results) throw new CatalogNotInstalledError();
    return results;
  }
  async lookupBarcode(barcode: string, context?: CatalogOperationContext) { return this.getFood(barcode, context); }
  async getFood(id: string, context?: CatalogOperationContext) {
    if (!isSupportedCommercialBarcode(id)) throw new CatalogFoodNotFoundError();
    const food = await this.management.withActiveGeneration(generation => {
      if (context?.reviewedCatalogGeneration !== undefined && context.reviewedCatalogGeneration !== generation) throw new CatalogStaleReviewError();
      return readOffGenerationFood(this.directory, generation, id);
    });
    if (food === undefined && !this.management.read().installed) throw new CatalogNotInstalledError();
    if (!food) throw new CatalogFoodNotFoundError();
    return food;
  }
}
