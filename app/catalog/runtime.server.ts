import { z } from "zod";

import packageJson from "../../package.json" with { type: "json" };
import type { ApplicationDatabaseClient } from "../database/database.server";
import { getApplicationDatabase } from "../database/runtime.server";
import {
  FoodCatalog,
  type SearchFoodCatalogProvider,
} from "./food-catalog.server";
import { TestFoodCatalogProvider } from "./test-fixture.server";
import { LocalUsdaAdapter } from "./local-usda.server";
import { OffContactRepository } from "./off-contact.repository.server";
import { OpenFoodFactsClient } from "./open-food-facts.server";
import { catalogDirectory, getCatalogManagement } from "../catalog-management/runtime.server";

function environmentSchema() {
  return z.object({
    FOOD_CATALOG_TEST_FIXTURE: z.enum(["0", "1"]).optional(),
  });
}

let foodCatalogProvider: SearchFoodCatalogProvider | undefined;
let foodCatalog: FoodCatalog | undefined;
let openFoodFacts: { database: ApplicationDatabaseClient; client: OpenFoodFactsClient } | undefined;

/** Resolves `fetch` per request, so a preloaded or test replacement of the global is honored. */
const globalFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

/** An Open Food Facts client over `database`, for callers that already hold a client. */
export function createOpenFoodFactsClient(
  database: ApplicationDatabaseClient,
  fetcher: typeof fetch = globalFetch,
): OpenFoodFactsClient {
  return new OpenFoodFactsClient(new OffContactRepository(database), fetcher, packageJson.version);
}

/** The Open Food Facts client of the current application database. */
export function getOpenFoodFactsClient(): OpenFoodFactsClient {
  const database = getApplicationDatabase().getClient();
  if (openFoodFacts?.database !== database) {
    openFoodFacts = { database, client: createOpenFoodFactsClient(database) };
  }
  return openFoodFacts.client;
}

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
  foodCatalog ??= new FoodCatalog(
    [
      {
        capability: "search",
        provider: "usda-fdc",
        service: getFoodCatalogProvider(),
      },
    ],
    // Resolved per lookup, so a reopened application database is honored.
    { lookup: (barcode) => getOpenFoodFactsClient().lookup(barcode) },
  );
  return foodCatalog;
}
