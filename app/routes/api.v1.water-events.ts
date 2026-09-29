import { z } from "zod";
import type { Route } from "./+types/api.v1.water-events";
import { externalIdempotencyKey } from "../api-keys/idempotency-key";
import { apiError, authenticateApiRequest, privateHeaders } from "../api-keys/rest.server";
import { FutureFoodLogDateError, InvalidFoodLogDateError } from "../food-log/food-log.server";
import { presentWaterEvent } from "../water-event/presentation";
import { getWaterEventService } from "../water-event/runtime.server";
import {
  InvalidWaterEventInputError,
  WaterEventIdempotencyConflictError,
  WaterEventSetupRequiredError,
} from "../water-event/water-event.server";

const acceptedScopes = ["water-log:write"] as const;
const containerCount = z.number().int().nonnegative().default(0);
const bodySchema = z.object({
  foodLogDate: z.string(),
  glasses: containerCount,
  bottles: containerCount,
  large: containerCount,
});

/** Each refusal the Water Event service can raise, as its REST status and code. */
const serviceErrors = [
  [InvalidFoodLogDateError, 400, "invalid_date"],
  [FutureFoodLogDateError, 400, "future_date"],
  [InvalidWaterEventInputError, 400, "invalid_request"],
  [WaterEventIdempotencyConflictError, 409, "idempotency_conflict"],
  [WaterEventSetupRequiredError, 409, "missing_setup"],
] as const;

async function readBody(request: Request) {
  try {
    return bodySchema.safeParse(JSON.parse(await request.text()));
  } catch {
    return undefined;
  }
}

export function headers() {
  return privateHeaders;
}

export function loader() {
  return apiError("method_not_allowed", 405, { Allow: "POST" });
}

/** Logs one Water Event from container counts, once per `Idempotency-Key`. */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return loader();
  const caller = authenticateApiRequest(request, "water-events", acceptedScopes);
  if (caller instanceof Response) return caller;
  const idempotencyKey = externalIdempotencyKey("api", request.headers.get("Idempotency-Key"));
  if (!idempotencyKey) return apiError("invalid_idempotency_key", 400);
  const body = await readBody(request);
  if (!body?.success) return apiError("invalid_request", 400);

  const { foodLogDate, glasses, bottles, large } = body.data;
  try {
    const { event, replayed } = getWaterEventService().createIdempotently(
      caller.userId,
      { counts: { "8": glasses, "16": bottles, "24": large }, foodLogDate },
      idempotencyKey,
    );
    return Response.json({ ...presentWaterEvent(event), replayed }, { status: replayed ? 200 : 201, headers: privateHeaders });
  } catch (error) {
    const known = serviceErrors.find(([type]) => error instanceof type);
    if (!known) throw error;
    return apiError(known[2], known[1]);
  }
}
