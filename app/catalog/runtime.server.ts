import { z } from "zod";

import {
  FoodCatalog,
  type SearchFoodCatalogProvider,
} from "./food-catalog.server";
import {
  TestFoodCatalogProvider,
  TestOpenFoodFactsProvider,
} from "./test-fixture.server";
import { UsdaFoodDataCentralAdapter } from "./usda.server";
import { OpenFoodFactsAdapter } from "./open-food-facts.server";

function environmentSchema() {
  return z.object({
    FDC_API_KEY: z.string().optional(),
    FDC_BASE_URL: z.string().url().optional(),
    FDC_TIMEOUT_MS: z.coerce.number().int().min(100).max(20_000).optional(),
    FOOD_CATALOG_TEST_FIXTURE: z.enum(["0", "1"]).optional(),
    OPEN_FOOD_FACTS_BASE_URL: z.string().url().optional(),
    OPEN_FOOD_FACTS_CONTACT_EMAIL: z.string().optional(),
    OPEN_FOOD_FACTS_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(20_000)
      .optional(),
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
      : new UsdaFoodDataCentralAdapter({
          apiKey: environment.FDC_API_KEY,
          baseUrl: environment.FDC_BASE_URL,
          timeoutMs: environment.FDC_TIMEOUT_MS,
        });
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
  foodCatalog = new FoodCatalog([
    {
      capability: "search",
      provider: "usda-fdc",
      service: getFoodCatalogProvider(),
    },
    {
      capability: "barcode",
      provider: "open-food-facts",
      service: fixture
        ? new TestOpenFoodFactsProvider()
        : new OpenFoodFactsAdapter({
            baseUrl: environment.OPEN_FOOD_FACTS_BASE_URL,
            contactEmail: environment.OPEN_FOOD_FACTS_CONTACT_EMAIL,
            timeoutMs: environment.OPEN_FOOD_FACTS_TIMEOUT_MS,
          }),
    },
  ]);
  return foodCatalog;
}
