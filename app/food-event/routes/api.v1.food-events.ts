import { z } from "zod";

import type { Route } from "./+types/api.v1.food-events";
import {
  apiError,
  authenticateApiRequest,
  BodyTooLargeError,
  privateHeaders,
  readJson,
} from "../../api-keys/rest.server";
import {
  FoodEventConflictError,
  FoodEventNotFoundError,
  FoodEventValidationError,
  FoodSourceError,
} from "../food-event.exceptions";
import type { VersionedId } from "../food-event.model";
import {
  presentFoodEvent,
  presentFoodEventDeletion,
  presentFoodEventList,
  saveFoodEventFromJson,
} from "../present.server";
import { getFoodEventService } from "../runtime.server";
import { foodEventErrorStatus } from "../transport.server";

const REALM = "food-events";
const ALLOWED_METHODS = "GET, POST, DELETE";

const deleteBodySchema = z.object({ events: z.array(z.unknown()) });

/** The Food Event rules' refusals as REST errors; a conflict also returns the current event. */
function foodEventError(error: unknown): Response {
  if (error instanceof FoodEventConflictError) {
    return Response.json(
      { error: error.code, event: presentFoodEvent(error.current) },
      { status: 409, headers: privateHeaders },
    );
  }
  if (
    error instanceof FoodEventValidationError ||
    error instanceof FoodSourceError ||
    error instanceof FoodEventNotFoundError
  ) {
    return apiError(error.code, foodEventErrorStatus(error));
  }
  throw error;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: privateHeaders });
}

export function headers() {
  return privateHeaders;
}

/** The authenticated caller with a finished setup, or the refusal to send. */
function authenticateConfigured(request: Request, scope: "food-events:read" | "food-events:write") {
  const caller = authenticateApiRequest(request, REALM, scope);
  if (caller instanceof Response) return caller;
  return getFoodEventService().timeZone(caller.userId) ? caller : apiError("missing_setup", 409);
}

/** Lists the caller's Food Events eaten from `from` (inclusive) to `to` (exclusive). */
export function loader({ request }: Route.LoaderArgs) {
  const caller = authenticateConfigured(request, "food-events:read");
  if (caller instanceof Response) return caller;
  const query = new URL(request.url).searchParams;
  const from = query.getAll("from");
  const to = query.getAll("to");
  if (from.length !== 1 || to.length !== 1) return apiError("invalid_range", 400);
  try {
    return json(presentFoodEventList(getFoodEventService().list(caller.userId, { from: from[0], to: to[0] })));
  } catch (error) {
    return foodEventError(error);
  }
}

async function save(request: Request, userId: number): Promise<Response> {
  const body = await readJson(request);
  if (typeof body !== "object" || body === null || Array.isArray(body)) return apiError("invalid_input", 400);
  const input = saveFoodEventFromJson(body);
  try {
    const event = await getFoodEventService().save(userId, input, {
      requestId: request.headers.get("x-open-calory-request-id") ?? undefined,
    });
    return json(presentFoodEvent(event), "id" in input ? 200 : 201);
  } catch (error) {
    return foodEventError(error);
  }
}

async function remove(request: Request, userId: number): Promise<Response> {
  const body = deleteBodySchema.safeParse(await readJson(request));
  if (!body.success) return apiError("invalid_event_ids", 400);
  try {
    const deletedCount = getFoodEventService().delete(userId, body.data.events as VersionedId[]);
    return json(presentFoodEventDeletion(deletedCount));
  } catch (error) {
    return foodEventError(error);
  }
}

/**
 * Creates or edits one Food Event (`POST`), or deletes owned Food Events at their expected
 * versions, all or none (`DELETE`).
 */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST" && request.method !== "DELETE") {
    return apiError("method_not_allowed", 405, { Allow: ALLOWED_METHODS });
  }
  const caller = authenticateConfigured(request, "food-events:write");
  if (caller instanceof Response) return caller;
  try {
    return await (request.method === "POST" ? save(request, caller.userId) : remove(request, caller.userId));
  } catch (error) {
    if (error instanceof BodyTooLargeError) return apiError("payload_too_large", 413);
    throw error;
  }
}
