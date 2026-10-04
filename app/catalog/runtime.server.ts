import { z } from "zod";

import {
  FoodCatalog,
  type SearchFoodCatalogProvider,
} from "./food-catalog.server";
import {
  TestFoodCatalogProvider,
  TestOpenFoodFactsProvider,
} from "./test-fixture.server";
import { LocalUsdaAdapter } from "./local-usda.server";
import { catalogDirectory, getCatalogManagement } from "../catalog-management/runtime.server";
import { LocalOpenFoodFactsAdapter } from "./local-off.server";

function environmentSchema() {
  return z.object({
    FOOD_CATALOG_TEST_FIXTURE: z.enum(["0", "1"]).optional(),
  });
}

let foodCatalogProvider: SearchFoodCatalogProvider | undefined;
let foodCatalog: FoodCatalog | undefined;

export function getFoodCatalogProvider(): SearchFoodCatalogProvider {
  if (foodCatalogProvider) return foodCatalogProvider;
  const environment = environmentSchema().parse(process.env);
  foodCatalogProvider =
    process.env.NODE_ENV === "test" &&
    environment.FOOD_CATALOG_TEST_FIXTURE === "1"
      ? new TestFoodCatalogProvider()
      : new LocalUsdaAdapter(getCatalogManagement(), catalogDirectory());
  return foodCatalogProvider;
}

export function setFoodCatalogProviderForTests(
  provider: SearchFoodCatalogProvider | undefined,
): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Catalog test doubles are available only in tests");
  }
  foodCatalogProvider = provider;
  foodCatalog = undefined;
}

export function setFoodCatalogForTests(catalog: FoodCatalog | undefined): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Catalog test doubles are available only in tests");
  }
  foodCatalog = catalog;
}

export function getFoodCatalog(): FoodCatalog {
  if (foodCatalog) return foodCatalog;
  const environment = environmentSchema().parse(process.env);
  const fixture =
    process.env.NODE_ENV === "test" &&
    environment.FOOD_CATALOG_TEST_FIXTURE === "1";
  const openFoodFacts = fixture
    ? new TestOpenFoodFactsProvider()
    : new LocalOpenFoodFactsAdapter(getCatalogManagement("open-food-facts"), catalogDirectory());
  foodCatalog = new FoodCatalog([
    {
      capability: "search",
      provider: "usda-fdc",
      service: getFoodCatalogProvider(),
    },
    {
      capability: "barcode",
      provider: "open-food-facts",
      service: openFoodFacts,
    },
  ]);
  return foodCatalog;
}
