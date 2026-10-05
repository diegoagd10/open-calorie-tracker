import { randomUUID } from "node:crypto";

import type { Route } from "./+types/api.v1.catalog";
import { apiError, authenticateApiRequest, privateHeaders } from "../../api-keys/rest.server";
import type { FindCatalogFoods } from "../catalog.model";
import { CatalogDiscoveryError, findCatalogFoods } from "../discovery.server";
import { getFoodCatalog } from "../runtime.server";

export function headers() {
  return privateHeaders;
}

/** Exactly one of `query`, `providerFoodId`, or `barcode`, or undefined for anything else. */
function readFind(url: URL): FindCatalogFoods | undefined {
  const sent = ["query", "providerFoodId", "barcode"].filter((name) => url.searchParams.has(name));
  if (sent.length !== 1 || url.searchParams.getAll(sent[0]).length !== 1) return undefined;
  const value = url.searchParams.get(sent[0])!;
  if (sent[0] === "query") return { provider: "usda-fdc", query: value };
  if (sent[0] === "providerFoodId") return { provider: "usda-fdc", providerFoodId: value };
  return { provider: "open-food-facts", barcode: value };
}

/**
 * Finds foods to log through the Food Events API: `?query=` searches USDA, `?providerFoodId=`
 * reviews one USDA food, and `?barcode=` looks a product up on Open Food Facts.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const caller = authenticateApiRequest(request, "catalog", "catalog:read");
  if (caller instanceof Response) return caller;
  const find = readFind(new URL(request.url));
  if (!find) return apiError("invalid_input", 400);
  try {
    const found = await findCatalogFoods(getFoodCatalog(), find, request.headers.get("x-open-calory-request-id") ?? randomUUID());
    return Response.json(found, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof CatalogDiscoveryError) return apiError(error.code, error.status);
    throw error;
  }
}

export function action() {
  return apiError("method_not_allowed", 405, { Allow: "GET" });
}
