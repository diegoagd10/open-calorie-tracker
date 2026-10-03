import { z } from "zod";

import type { Route } from "./+types/api.v1.water-events";
import { apiError, authenticateApiRequest, privateHeaders } from "../../api-keys/rest.server";
import { getWaterEventService } from "../runtime.server";
import type { CreateWaterEvent } from "../water-event.model";
import {
  presentWaterEvent,
  presentWaterEventDeletion,
  presentWaterEventList,
} from "../water-event.utils";
import { WaterEventNotFoundError, WaterEventValidationError } from "../water-events.exceptions";

const REALM = "water-events";
const ALLOWED_METHODS = "GET, POST, DELETE";

const saveBodySchema = z.strictObject({
  id: z.unknown().optional(),
  logDate: z.unknown().optional(),
  ounces: z.unknown(),
});
const deleteBodySchema = z.strictObject({ eventIds: z.array(z.unknown()) });

async function readJson(request: Request): Promise<unknown> {
  try {
    return JSON.parse(await request.text()) as unknown;
  } catch {
    return undefined;
  }
}

/** The Water Event rules' refusals as REST errors; anything else is unexpected. */
function waterEventError(error: unknown): Response {
  if (error instanceof WaterEventValidationError) return apiError(error.code, 400);
  if (error instanceof WaterEventNotFoundError) return apiError(error.code, 404);
  throw error;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: privateHeaders });
}

export function headers() {
  return privateHeaders;
}

/** Lists the caller's Water Events consumed from `from` (inclusive) to `to` (exclusive). */
export function loader({ request }: Route.LoaderArgs) {
  const caller = authenticateApiRequest(request, REALM, "water-events:read");
  if (caller instanceof Response) return caller;
  const query = new URL(request.url).searchParams;
  const from = query.getAll("from");
  const to = query.getAll("to");
  if (from.length !== 1 || to.length !== 1) return apiError("invalid_range", 400);
  try {
    return json(presentWaterEventList(getWaterEventService().list(caller.userId, { from: from[0], to: to[0] })));
  } catch (error) {
    return waterEventError(error);
  }
}

async function save(request: Request, userId: number): Promise<Response> {
  const body = saveBodySchema.safeParse(await readJson(request));
  if (!body.success) return apiError("invalid_input", 400);
  const { id, logDate, ounces } = body.data;
  if (id !== undefined && logDate !== undefined) return apiError("invalid_input", 400);
  if (id !== undefined && typeof id !== "number") return apiError("invalid_input", 400);
  const input = {
    ...(id === undefined ? { logDate } : { id }),
    quantity: { ounces },
  } as CreateWaterEvent;
  try {
    const event = getWaterEventService().save(userId, input);
    return json(presentWaterEvent(event), id === undefined ? 201 : 200);
  } catch (error) {
    return waterEventError(error);
  }
}

async function remove(request: Request, userId: number): Promise<Response> {
  const body = deleteBodySchema.safeParse(await readJson(request));
  if (!body.success) return apiError("invalid_event_ids", 400);
  try {
    const deletedCount = getWaterEventService().delete(userId, body.data.eventIds as number[]);
    return json(presentWaterEventDeletion(deletedCount));
  } catch (error) {
    return waterEventError(error);
  }
}

/** Saves one Water Event (`POST`) or deletes owned Water Events by ID (`DELETE`). */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST" && request.method !== "DELETE") {
    return apiError("method_not_allowed", 405, { Allow: ALLOWED_METHODS });
  }
  const caller = authenticateApiRequest(request, REALM, "water-events:write");
  if (caller instanceof Response) return caller;
  return request.method === "POST" ? save(request, caller.userId) : remove(request, caller.userId);
}
