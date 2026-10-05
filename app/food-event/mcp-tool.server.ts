import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { MISSING_SETUP_MESSAGE, toolError, type McpTool } from "../mcp/mcp-tool";
import { localDayRange } from "../shared/date-time";
import {
  FoodEventConflictError,
  FoodEventNotFoundError,
  FoodEventValidationError,
  FoodSourceError,
} from "./food-event.exceptions";
import type { FoodEvent, VersionedId } from "./food-event.model";
import { localDay, type FoodEventService } from "./food-event.server";
import { formatEnergy } from "./format";
import {
  presentFoodEvent,
  presentFoodEventDeletion,
  presentFoodEventList,
  saveFoodEventFromJson,
} from "./present.server";
import { getFoodEventService } from "./runtime.server";

const nullableInteger = z.number().int().nullable();

const foodEventOutputSchema = z.object({
  id: z.number().int().positive(),
  logDate: z.string(),
  createdAt: z.string(),
  updatedAt: z.string().describe("Send as expectedUpdatedAt to edit or delete this version"),
  name: z.string(),
  provider: z.string(),
  providerFoodId: z.string(),
  dataType: z.string(),
  selectedMeasurementId: z.string(),
  selectedMeasurementLabel: z.string(),
  quantity: z.string(),
  energyMilliKcal: nullableInteger,
  proteinMilligrams: nullableInteger,
  carbohydrateMilligrams: nullableInteger,
  fatMilligrams: nullableInteger,
  fiberMilligrams: nullableInteger,
  sugarMilligrams: nullableInteger,
  sodiumMilligrams: nullableInteger,
  favoriteId: z.number().int().nullable(),
  copiedFromId: z.number().int().nullable(),
});

const totalSchema = z.object({ known: z.number().int(), isIncomplete: z.boolean() });
const totalsSchema = z.object({
  energyMilliKcal: totalSchema,
  proteinMilligrams: totalSchema,
  carbohydrateMilligrams: totalSchema,
  fatMilligrams: totalSchema,
  fiberMilligrams: totalSchema,
  sugarMilligrams: totalSchema,
  sodiumMilligrams: totalSchema,
}).describe("Sums in milli-kcal and milligrams; isIncomplete means some foods do not know that nutrient");

const decimal = z.union([z.string(), z.number()]);
const nutritionInput = z.object({
  energyKcal: decimal.nullable().optional(),
  proteinGrams: decimal.nullable().optional(),
  carbohydrateGrams: decimal.nullable().optional(),
  fatGrams: decimal.nullable().optional(),
  fiberGrams: decimal.nullable().optional(),
  sugarGrams: decimal.nullable().optional(),
  sodiumMilligrams: decimal.nullable().optional(),
});

/**
 * Runs a handler for an account that has finished setup, returning the Food Event rules'
 * refusals as tool errors the agent can act on. Saves are asynchronous, so the handler is
 * awaited inside the `try`, or a rejected save would escape it.
 */
async function forAccount(
  userId: number,
  handler: (service: FoodEventService, timeZone: string) => CallToolResult | Promise<CallToolResult>,
): Promise<CallToolResult> {
  const service = getFoodEventService();
  const timeZone = service.timeZone(userId);
  if (!timeZone) return toolError(MISSING_SETUP_MESSAGE);
  try {
    return await handler(service, timeZone);
  } catch (error) {
    if (error instanceof FoodEventConflictError) {
      return toolError(`${error.message} Its current updatedAt is ${error.current.updatedAt}.`);
    }
    if (
      error instanceof FoodEventValidationError ||
      error instanceof FoodSourceError ||
      error instanceof FoodEventNotFoundError
    ) {
      return toolError(error.message);
    }
    throw error;
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function kcal(event: FoodEvent): string {
  return event.nutrients.energyMilliKcal === null ? "unknown kcal" : `${formatEnergy(event.nutrients.energyMilliKcal)} kcal`;
}

/** Creates an event by `method`, or with `id` edits the version read at `expectedUpdatedAt`. */
async function handleLogFood(userId: number, input: Record<string, unknown>): Promise<CallToolResult> {
  return forAccount(userId, async (service, timeZone) => {
    const editing = input.id !== undefined;
    const event = await service.save(userId, saveFoodEventFromJson(input));
    const date = localDay(event.logDate, timeZone);
    const totals = service.list(userId, localDayRange(date, timeZone)).totals.energyMilliKcal;
    const day = { date, energyMilliKcal: totals };
    const lead = editing
      ? `Changed Food Event ${event.id}: ${event.name}, ${event.measurement.label} × ${event.quantityMicrounits / 1_000_000}, ${kcal(event)}.`
      : `Logged ${event.name}, ${event.measurement.label} × ${event.quantityMicrounits / 1_000_000}, ${kcal(event)}, eaten at ${event.logDate}.`;
    return {
      structuredContent: { event: presentFoodEvent(event), day },
      content: [{
        type: "text",
        text: `${lead} Food on ${date}: ${formatEnergy(totals.known)} kcal${totals.isIncomplete ? " known" : ""}.`,
      }],
    };
  });
}

function handleListFood(userId: number, range: { from: string; to: string }): Promise<CallToolResult> {
  return forAccount(userId, (service) => {
    const list = presentFoodEventList(service.list(userId, range));
    const energy = list.totals.energyMilliKcal;
    return {
      structuredContent: list,
      content: [{
        type: "text",
        text: `${plural(list.events.length, "food event")}, ${formatEnergy(energy.known)} kcal${energy.isIncomplete ? " known" : ""} in total.`,
      }],
    };
  });
}

function handleDeleteFood(userId: number, events: VersionedId[]): Promise<CallToolResult> {
  return forAccount(userId, (service) => {
    const deletion = presentFoodEventDeletion(service.delete(userId, events));
    return {
      structuredContent: deletion,
      content: [{ type: "text", text: `Deleted ${plural(deletion.deletedCount, "food event")}.` }],
    };
  });
}

export const logFoodTool: McpTool = {
  scope: "food-events:write",
  register: (server, userId) => server.registerTool("log_food", {
    title: "Log food",
    description:
      "Record food eaten at a specified time. Omit id to create: send method \"lookup\" with a USDA food from get_food, " +
      "\"barcode\" with a product from lookup_barcode (both with providerFoodId, reviewVersion, measurementId, and quantity), " +
      "\"manual\" with a name, quantity, and nutrition totals for that quantity, or \"favorite\" with a favoriteId from a " +
      "logged food. Send id and expectedUpdatedAt with changes to edit an event; its time stays the same.",
    inputSchema: {
      id: z.number().int().positive().optional().describe("Existing event ID; send to edit it"),
      expectedUpdatedAt: z.string().optional().describe("The updatedAt of the version you read; required with id"),
      changes: z.object({
        name: z.string().optional(),
        quantity: decimal.optional(),
        measurementId: z.string().optional(),
        nutrition: nutritionInput.optional().describe("Totals for the quantity; omit a nutrient to keep it, null to clear it"),
      }).optional().describe("With id: the fields to change"),
      method: z.enum(["lookup", "barcode", "manual", "favorite"]).optional().describe("How the food was found; required when creating"),
      logDate: z.iso.datetime({ offset: true }).optional().describe("When the food was eaten; required when creating"),
      providerFoodId: z.string().optional(),
      reviewVersion: z.string().optional(),
      measurementId: z.string().optional(),
      quantity: decimal.optional().describe("Greater than 0, at most 99, with up to six decimals"),
      name: z.string().optional(),
      nutrition: nutritionInput.optional().describe("Manual foods: totals for the quantity eaten; energyKcal is required"),
      saveAsFavorite: z.boolean().optional().describe("Manual foods: also save it for reuse"),
      favoriteId: z.number().int().positive().optional(),
    },
    outputSchema: {
      event: foodEventOutputSchema,
      day: z.object({ date: z.string(), energyMilliKcal: totalSchema }),
    },
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
  }, (input) => handleLogFood(userId, input)),
};

export const listFoodTool: McpTool = {
  scope: "food-events:read",
  register: (server, userId) => server.registerTool("list_food", {
    title: "List food events",
    description: "List food eaten in a time range, newest first, with nutrition totals and per-day totals in the account's time zone.",
    inputSchema: {
      from: z.iso.datetime({ offset: true }).describe("Inclusive consumption time, with offset"),
      to: z.iso.datetime({ offset: true }).describe("Exclusive consumption time, with offset"),
    },
    outputSchema: {
      events: z.array(foodEventOutputSchema),
      totals: totalsSchema,
      days: z.record(z.string(), z.object({ eventCount: z.number().int(), totals: totalsSchema })),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, (input) => handleListFood(userId, input)),
};

export const deleteFoodTool: McpTool = {
  scope: "food-events:write",
  register: (server, userId) => server.registerTool("delete_food", {
    title: "Delete food events",
    description:
      "Delete the account holder's food events, each at the version you read. Nothing is deleted when any one is missing " +
      "or has changed since.",
    inputSchema: {
      events: z.array(z.object({
        id: z.number().int().positive(),
        expectedUpdatedAt: z.string().describe("The event's updatedAt as you read it"),
      })).max(100).describe("Up to 100 events"),
    },
    outputSchema: { deletedCount: z.number().int().nonnegative() },
    annotations: {
      readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false,
    },
  }, ({ events }) => handleDeleteFood(userId, events)),
};
