import { data, redirect } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/web";
import { getApplicationMutationSession, readApplicationMutationForm } from "../../auth/http.server";
import { testRequestInstant } from "../../runtime.server";
import { zonedDateTimeToUtc } from "../../shared/date-time";
import { getWaterEventService } from "../runtime.server";
import type { WaterEventService } from "../water-event.server";
import { waterEventLocalDateTime } from "../water-event.utils";
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
  const entries = [...form.entries()];
  const unique = new Set(entries.map(([name]) => name)).size === entries.length;
  const command = commandSchema.safeParse(Object.fromEntries(entries.filter(([name]) => name !== "csrfToken")));
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
    const event = service.save(userId, { id: command.id, quantity });
    return redirect(foodLogHref(localDay(event.logDate, timeZone), { notice: "water-updated" }));
  }
  const logDate = zonedDateTimeToUtc(command.localLogDate, timeZone);
  if (!logDate) throw new WaterEventValidationError("invalid_log_date", "The consumption time is not a valid local time.");
  const event = service.save(userId, { logDate, quantity });
  return redirect(foodLogHref(localDay(event.logDate, timeZone)));
}

/** The account's Food Log day for a saved event; a skipped wall-clock time can move it past the submitted date. */
function localDay(logDate: string, timeZone: string): string {
  return waterEventLocalDateTime(logDate, timeZone).slice(0, 10);
}

/**
 * Saves or deletes the signed-in account holder's Water Event from the Food Log dialog, then
 * returns to the event's Food Log day. A rejected amount or time answers `400` with its code,
 * so the dialog stays open with what was typed.
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
    if (error instanceof WaterEventValidationError) return data({ error: error.code }, { status: 400 });
    if (error instanceof WaterEventNotFoundError) throw new Response(error.message, { status: 404 });
    throw error;
  }
}
