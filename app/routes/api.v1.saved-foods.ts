import { z } from "zod";
import type { Route } from "./+types/api.v1.saved-foods";
import {
  IdempotencyConflictError,
  InvalidFoodEntryInputError,
  type FoodEntryService,
} from "../food-entry/food-entry.server";
import { getFoodEntryService } from "../food-entry/runtime.server";
import { storedExternalIdempotencyKey } from "../food-log/idempotency-key";
import { apiError, authenticateApiKey, privateHeaders } from "./api-v1.server";

type SavedFood = ReturnType<FoodEntryService["searchSavedFoods"]>["savedFoods"][number];

const acceptedScopes = ["daily-log:read", "food-log:write"] as const;
const createScopes = ["food-log:write"] as const;
const MAX_QUERY_LENGTH = 200;
const optionalNutrient = z.number().nullable().optional();
/** The JSON body's shape; the Food Entry service checks names, precision, and bounds. */
const createBodySchema = z.strictObject({
  name: z.string(),
  energyKcal: z.number(),
  proteinGrams: optionalNutrient,
  carbohydrateGrams: optionalNutrient,
  fatGrams: optionalNutrient,
  fiberGrams: optionalNutrient,
  sugarGrams: optionalNutrient,
  sodiumMilligrams: optionalNutrient,
});

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

/** Creates a Saved Food for one serving from a JSON body, replaying a retried `Idempotency-Key`. */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return apiError("method_not_allowed", 405);
  const caller = authenticateApiKey(request, "saved-foods", createScopes);
  if (caller instanceof Response) return caller;
  const idempotencyKey = storedExternalIdempotencyKey("api", request.headers.get("Idempotency-Key"));
  if (!idempotencyKey) return apiError("invalid_idempotency_key", 400);
  const body = createBodySchema.safeParse(await request.json().catch(() => undefined));
  if (!body.success) return apiError("invalid_request", 400);
  try {
    const { savedFood, replayed } = getFoodEntryService().createSavedFood(caller.userId, { ...body.data, idempotencyKey });
    return Response.json({ version: "1" as const, savedFood: presentSavedFood(savedFood), replayed }, { status: replayed ? 200 : 201, headers: privateHeaders });
  } catch (error) {
    if (error instanceof InvalidFoodEntryInputError) return apiError("invalid_request", 400);
    if (error instanceof IdempotencyConflictError) return apiError("idempotency_conflict", 409);
    throw error;
  }
}
