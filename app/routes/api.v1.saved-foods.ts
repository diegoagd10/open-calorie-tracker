import type { Route } from "./+types/api.v1.saved-foods";
import type { FoodEntryService } from "../food-entry/food-entry.server";
import { getFoodEntryService } from "../food-entry/runtime.server";
import { apiError, authenticateApiKey, privateHeaders } from "./api-v1.server";

type SavedFood = ReturnType<FoodEntryService["searchSavedFoods"]>["savedFoods"][number];

const acceptedScopes = ["daily-log:read", "food-log:write"] as const;
const MAX_QUERY_LENGTH = 200;

/** A Saved Food with one serving's nutrition in the canonical `/api/v1` shape. */
function presentSavedFood(food: SavedFood) {
  return {
    id: food.id,
    name: food.name,
    energyMilliKcal: food.energyMilliKcal,
    proteinMilligrams: food.proteinMilligrams,
    carbohydrateMilligrams: food.carbohydrateMilligrams,
    fatMilligrams: food.fatMilligrams,
    fiberMilligrams: food.fiberMilligrams,
    sugarMilligrams: food.sugarMilligrams,
    sodiumMilligrams: food.sodiumMilligrams,
  };
}

export function headers() {
  return privateHeaders;
}

export function loader({ request }: Route.LoaderArgs) {
  const caller = authenticateApiKey(request, "saved-foods", acceptedScopes);
  if (caller instanceof Response) return caller;
  const queries = new URL(request.url).searchParams.getAll("query");
  if (queries.length > 1 || (queries[0]?.length ?? 0) > MAX_QUERY_LENGTH) return apiError("invalid_request", 400);
  const { savedFoods, truncated } = getFoodEntryService().searchSavedFoods(caller.userId, queries[0]);
  return Response.json({ version: "1" as const, savedFoods: savedFoods.map(presentSavedFood), truncated }, { headers: privateHeaders });
}

export function action() {
  return apiError("method_not_allowed", 405);
}
