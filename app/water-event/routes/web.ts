import { redirect } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/web";
import { getApplicationMutationSession, readApplicationMutationForm } from "../../auth/http.server";
import { isTestEnvironment } from "../../runtime.server";
import { zonedDateTimeToUtc } from "../../shared/date-time";
import { getWaterEventService } from "../runtime.server";
import type { WaterEventService } from "../water-event.server";
import { WaterEventNotFoundError, WaterEventValidationError } from "../water-events.exceptions";

const eventId = z.string().regex(/^[1-9]\d{0,15}$/).transform(Number);
const returnDate = z.string().refine((value) => zonedDateTimeToUtc(`${value}T00:00`, "UTC") !== null);

/** One dialog submission: save (create without `id`, edit with it) or delete one event. */
const commandSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("delete"), eventIds: eventId, returnDate }),
  z.object({
    intent: z.literal("save"),
    id: eventId.optional(),
    localLogDate: z.string().default(""),
    ounces: z.string().default(""),
    returnDate,
  }),
]);
type WaterCommand = z.output<typeof commandSchema>;

function foodLogHref(date: string, parameters: Record<string, string> = {}): string {
  return `/?${new URLSearchParams({ date, ...parameters })}`;
}

/** The submitted command, or a `400` response for a form the dialog never sends. */
function readCommand(form: FormData): WaterCommand {
  const fields = [...form.entries()].filter(([name]) => name !== "csrfToken");
  const unique = new Set(fields.map(([name]) => name)).size === fields.length;
  const command = commandSchema.safeParse(Object.fromEntries(fields));
  if (!unique || !command.success) throw new Response("The Water Event request was invalid.", { status: 400 });
  return command.data;
}

/** Applies the command and returns where the Food Log continues. */
function runCommand(service: WaterEventService, userId: number, timeZone: string, command: WaterCommand): Response {
  if (command.intent === "delete") {
    service.delete(userId, [command.eventIds]);
    return redirect(foodLogHref(command.returnDate, { notice: "water-deleted" }));
  }
  const quantity = { ounces: command.ounces };
  if (command.id !== undefined) {
    service.save(userId, { id: command.id, quantity });
    return redirect(foodLogHref(command.returnDate, { notice: "water-updated" }));
  }
  const logDate = zonedDateTimeToUtc(command.localLogDate, timeZone);
  if (!logDate) throw new WaterEventValidationError("invalid_log_date", "Enter when the water was consumed.");
  service.save(userId, { logDate, quantity });
  return redirect(foodLogHref(command.localLogDate.slice(0, 10)));
}

/** The instant a browser test pins with `X-Test-Food-Log-Now`, as the Food Log does. */
function testRequestInstant(request: Request): Date | undefined {
  const requested = isTestEnvironment() ? request.headers.get("X-Test-Food-Log-Now") : null;
  if (!requested) return undefined;
  const instant = new Date(requested);
  if (Number.isNaN(instant.getTime())) throw new Response("Test Food Log instant is invalid.", { status: 400 });
  return instant;
}

/**
 * Saves or deletes the signed-in account holder's Water Event from the Food Log dialog, then
 * returns to the event's Food Log day. A rejected amount or time reopens the dialog with its error.
 */
export async function action({ request }: Route.ActionArgs) {
  const session = await getApplicationMutationSession(request);
  if (session instanceof Response) return session;
  const command = readCommand(await readApplicationMutationForm(request, session));
  const service = getWaterEventService(testRequestInstant(request));
  const timeZone = service.timeZone(session.user.id);
  if (!timeZone) throw new Response("Finish setup before logging water.", { status: 409 });
  try {
    return runCommand(service, session.user.id, timeZone, command);
  } catch (error) {
    if (error instanceof WaterEventValidationError) {
      const water = command.intent === "save" && command.id !== undefined ? String(command.id) : "new";
      return redirect(foodLogHref(command.returnDate, { water, waterError: error.code }));
    }
    if (error instanceof WaterEventNotFoundError) throw new Response(error.message, { status: 404 });
    throw error;
  }
}
