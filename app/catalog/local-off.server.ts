import { readOffGenerationFood } from "../database/off-generation.server";
import type { CatalogManagement } from "../catalog-management/catalog-management.server";
import { isSupportedCommercialBarcode } from "./barcode";
import { CatalogConfigurationError, CatalogFoodNotFoundError, type BarcodeFoodCatalogProvider } from "./food-catalog.server";

export class LocalOpenFoodFactsAdapter implements BarcodeFoodCatalogProvider {
  constructor(private readonly management: CatalogManagement, private readonly directory: string) {}
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
