import { z } from "zod";
import type { Route } from "./+types/api.v1.food-entries";
import {
  AccountSetupRequiredError,
  FoodEntryUnavailableError,
  IdempotencyConflictError,
  InvalidFoodEntryInputError,
} from "../food-entry/food-entry.server";
import { FutureFoodLogDateError, InvalidFoodLogDateError } from "../food-log/food-log.server";
import { getFoodEntryService } from "../food-entry/runtime.server";
import { storedExternalIdempotencyKey } from "../food-log/idempotency-key";
import { apiError, authenticateApiKey, presentFood, privateHeaders } from "./api-v1.server";

/** Logs a Food Entry from one source's JSON body, or answers with that source's error. */
type FoodEntrySource = (userId: number, body: unknown, idempotencyKey: string) => Response;

const acceptedScopes = ["food-log:write"] as const;
/** The JSON body's shape; the Food Entry service checks dates, quantity precision, and bounds. */
const savedFoodBodySchema = z.strictObject({
  source: z.literal("saved-food"),
  foodLogDate: z.string(),
  savedFoodId: z.number().int(),
  quantity: z.number().optional(),
});

/** The errors every source shares, or `undefined` for one the source maps itself. */
function commonError(error: unknown) {
  if (error instanceof InvalidFoodEntryInputError) return apiError("invalid_request", 400);
  if (error instanceof InvalidFoodLogDateError) return apiError("invalid_date", 400);
  if (error instanceof FutureFoodLogDateError) return apiError("future_date", 400);
  if (error instanceof AccountSetupRequiredError) return apiError("missing_setup", 409);
  if (error instanceof IdempotencyConflictError) return apiError("idempotency_conflict", 409);
  return undefined;
}

function logSavedFood(userId: number, body: unknown, idempotencyKey: string) {
  const parsed = savedFoodBodySchema.safeParse(body);
  if (!parsed.success) return apiError("invalid_request", 400);
  const { foodLogDate, savedFoodId, quantity } = parsed.data;
  try {
    const { entry, replayed } = getFoodEntryService().logSavedFoodServings(userId, { savedFoodId, quantity, foodLogDate, idempotencyKey });
    return Response.json({ version: "1" as const, foodEntry: presentFood(entry), replayed }, { status: replayed ? 200 : 201, headers: privateHeaders });
  } catch (error) {
    if (error instanceof FoodEntryUnavailableError) return apiError("saved_food_not_found", 404);
    const response = commonError(error);
    if (response) return response;
    throw error;
  }
}

const sources: Readonly<Record<string, FoodEntrySource>> = { "saved-food": logSavedFood };

export function headers() {
  return privateHeaders;
}

export function loader() {
  return apiError("method_not_allowed", 405);
}

/** Logs one Food Entry from the body's `source`, replaying a retried `Idempotency-Key`. */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return apiError("method_not_allowed", 405);
  const caller = authenticateApiKey(request, "food-entries", acceptedScopes);
  if (caller instanceof Response) return caller;
  const idempotencyKey = storedExternalIdempotencyKey("api", request.headers.get("Idempotency-Key"));
  if (!idempotencyKey) return apiError("invalid_idempotency_key", 400);
  const body: unknown = await request.json().catch(() => undefined);
  const tagged = z.object({ source: z.string() }).safeParse(body);
  const logFoodEntry = tagged.success && Object.hasOwn(sources, tagged.data.source) ? sources[tagged.data.source] : undefined;
  if (!logFoodEntry) return apiError("invalid_request", 400);
  return logFoodEntry(caller.userId, body, idempotencyKey);
}
