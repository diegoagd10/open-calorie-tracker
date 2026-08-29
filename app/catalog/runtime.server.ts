import { z } from "zod";

import type { FoodCatalogProvider } from "./food-catalog.server";
import { TestFoodCatalogProvider } from "./test-fixture.server";
import { UsdaFoodDataCentralAdapter } from "./usda.server";

const environmentSchema = z.object({
  FDC_API_KEY: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().min(1).optional(),
  ),
  FDC_BASE_URL: z.string().url().optional(),
  FDC_TIMEOUT_MS: z.coerce.number().int().min(100).max(20_000).optional(),
  FOOD_CATALOG_TEST_FIXTURE: z.enum(["0", "1"]).optional(),
});

let foodCatalogProvider: FoodCatalogProvider | undefined;

export function getFoodCatalogProvider(): FoodCatalogProvider {
  if (foodCatalogProvider) return foodCatalogProvider;
  const environment = environmentSchema.parse(process.env);
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
  provider: FoodCatalogProvider | undefined,
): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Catalog test doubles are available only in tests");
  }
  foodCatalogProvider = provider;
}
