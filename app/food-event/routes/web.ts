import { data, redirect } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/web";
import { getApplicationMutationSession, readApplicationMutationForm } from "../../auth/http.server";
import { testRequestInstant } from "../../runtime.server";
import { zonedDateTimeToUtc } from "../../shared/date-time";
import { localDateAt, parseIsoLocalDate } from "../../shared/local-date";
import type { FoodEventActionData, NutrientField, SaveFoodEvent } from "../food-event.model";
import {
  FoodEventConflictError,
  FoodEventNotFoundError,
  FoodEventValidationError,
  FoodSourceError,
} from "../food-event.exceptions";
import { localDay, type FoodEventService } from "../food-event.server";
import { editorHref, foodLogHref } from "../links";
import { NUTRIENT_FIELDS } from "../nutrition";
import { getFoodEventService, requestInstant } from "../runtime.server";
import { foodEventErrorStatus } from "../transport.server";

const eventId = z.string().regex(/^[1-9]\d{0,15}$/).transform(Number);
const day = z.string().refine((value) => parseIsoLocalDate(value) !== undefined);
const text = z.string().default("");
const nutrientFields = Object.fromEntries(NUTRIENT_FIELDS.map(({ field }) => [field, text])) as Record<NutrientField, typeof text>;

/** An add from one of the four methods; the method decides which fields matter. */
const logSchema = z.discriminatedUnion("method", [
  z.object({
    intent: z.literal("log"),
    method: z.enum(["lookup", "barcode"]),
    date: day,
    providerFoodId: text,
    reviewVersion: text,
    measurementId: text,
    quantity: text,
  }),
  z.object({
    intent: z.literal("log"),
    method: z.literal("manual"),
    date: day,
    name: text,
    quantity: text,
    saveAsFavorite: z.literal("on").optional(),
    ...nutrientFields,
  }),
  z.object({ intent: z.literal("log"), method: z.literal("favorite"), date: day, favoriteId: eventId }),
]);

/** One dialog submission. `date` is the Food Log day the dialog belongs to. */
const commandSchema = z.discriminatedUnion("intent", [
  logSchema,
  z.object({
    intent: z.literal("update"),
    id: eventId,
    expectedUpdatedAt: text,
    date: day,
    name: text,
    quantity: text,
    measurementId: text,
    ...nutrientFields,
  }),
  z.object({ intent: z.literal("delete"), id: eventId, expectedUpdatedAt: text, date: day }),
  z.object({ intent: z.literal("copy"), id: eventId, date: day, destinationDate: day.optional() }),
  z.object({ intent: z.literal("add-favorite"), id: eventId, date: day }),
]);
type FoodCommand = z.output<typeof commandSchema>;

/** The submitted command, or a `400` response for a form the dialogs never send. */
function readCommand(form: FormData): FoodCommand {
  const entries = [...form.entries()];
  const unique = new Set(entries.map(([name]) => name)).size === entries.length;
  const command = commandSchema.safeParse(Object.fromEntries(entries.filter(([name]) => name !== "csrfToken")));
  if (!unique || !command.success) throw new Response("The Food Event request was invalid.", { status: 400 });
  return command.data;
}

/**
 * When food added to `date` was eaten: now when it is today, otherwise noon on that past day,
 * as Water Event dialogs default. A future day is refused.
 */
function webLogDate(date: string, now: Date, timeZone: string): string {
  const today = localDateAt(now, timeZone);
  if (date > today) throw new FoodEventValidationError("future_date", "Future Food Logs cannot be changed");
  return date === today ? now.toISOString() : zonedDateTimeToUtc(`${date}T12:00`, timeZone)!;
}

function nutrition(command: Record<NutrientField, string>, blank: "omit" | "clear") {
  const entered: Partial<Record<NutrientField, string | null>> = {};
  for (const { field } of NUTRIENT_FIELDS) {
    const value = command[field].trim();
    if (value) entered[field] = value;
    else if (blank === "clear") entered[field] = null;
  }
  return entered;
}

function saveInput(command: Extract<FoodCommand, { intent: "log" }>, logDate: string): SaveFoodEvent {
  switch (command.method) {
    case "lookup":
    case "barcode": {
      const { method, providerFoodId, reviewVersion, measurementId, quantity } = command;
      return { method, logDate, providerFoodId, reviewVersion, measurementId, quantity };
    }
    case "manual":
      return {
        method: "manual",
        logDate,
        name: command.name,
        quantity: command.quantity,
        nutrition: nutrition(command, "omit") as { energyKcal: string },
        saveAsFavorite: command.saveAsFavorite === "on",
      };
    case "favorite":
      return { method: "favorite", logDate, favoriteId: command.favoriteId };
  }
}

/** Applies the command and returns where the Food Log continues. */
async function runCommand(
  service: FoodEventService,
  request: Request,
  userId: number,
  timeZone: string,
  command: FoodCommand,
): Promise<Response> {
  const clock = requestInstant(request);
  switch (command.intent) {
    case "log": {
      const requestId = request.headers.get("x-open-calory-request-id") ?? undefined;
      const event = await service.save(userId, saveInput(command, webLogDate(command.date, clock, timeZone)), { requestId });
      return redirect(foodLogHref(localDay(event.logDate, timeZone)));
    }
    case "update":
      await service.save(userId, {
        id: command.id,
        expectedUpdatedAt: command.expectedUpdatedAt,
        changes: {
          name: command.name,
          quantity: command.quantity,
          measurementId: command.measurementId,
          nutrition: nutrition(command, "clear"),
        },
      });
      return redirect(foodLogHref(command.date));
    case "delete":
      service.delete(userId, [{ id: command.id, expectedUpdatedAt: command.expectedUpdatedAt }]);
      return redirect(foodLogHref(command.date, { notice: "deleted" }));
    case "copy": {
      const destination = command.destinationDate ?? localDateAt(clock, timeZone);
      const copied = service.copy(userId, {
        eventId: command.id,
        sourceDate: command.date,
        logDate: webLogDate(destination, clock, timeZone),
      });
      return redirect(foodLogHref(command.date, { notice: "copied", copied: String(copied.id) }));
    }
    case "add-favorite":
      service.addFavorite(userId, command.id);
      return redirect(`${editorHref(command.date, command.id)}&notice=food-saved`);
  }
}

function rejected(body: FoodEventActionData, status: number) {
  return data(body, { status });
}

/**
 * Saves, copies, deletes, or favorites the signed-in account holder's Food Events from the Food
 * Log dialogs, then returns to the Food Log. A refusal answers with its code and a safe message,
 * so the mounted dialog keeps what was typed; an edit conflict also returns the current event,
 * so the editor can reload it before a retry.
 */
export async function action({ request }: Route.ActionArgs) {
  const session = await getApplicationMutationSession(request);
  if (session instanceof Response) return session;
  const command = readCommand(await readApplicationMutationForm(request, session));
  const service = getFoodEventService(testRequestInstant(request));
  const timeZone = service.timeZone(session.user.id);
  if (!timeZone) throw new Response("Finish setup before logging food.", { status: 409 });
  try {
    return await runCommand(service, request, session.user.id, timeZone, command);
  } catch (error) {
    if (error instanceof FoodEventConflictError) {
      return rejected({ code: error.code, message: error.message, event: error.current }, foodEventErrorStatus(error));
    }
    if (
      error instanceof FoodEventValidationError ||
      error instanceof FoodSourceError ||
      error instanceof FoodEventNotFoundError
    ) {
      return rejected({ code: error.code, message: error.message }, foodEventErrorStatus(error));
    }
    throw error;
  }
}
