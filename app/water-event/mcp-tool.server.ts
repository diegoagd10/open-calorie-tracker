import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { MISSING_SETUP_MESSAGE, toolError, type McpTool } from "../mcp/mcp-tool";
import { getWaterEventService } from "./runtime.server";
import type { WaterEventService } from "./water-event.server";
import type { CreateWaterEvent } from "./water-event.model";
import {
  ouncesFromJson,
  presentWaterEvent,
  presentWaterEventDeletion,
  presentWaterEventList,
} from "./water-event.utils";
import { WaterEventNotFoundError, WaterEventValidationError } from "./water-events.exceptions";

const waterEventOutputSchema = z.object({
  id: z.number().int().positive(),
  logDate: z.string(),
  ounces: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * Runs a handler for an account that has finished setup, returning the Water Event rules'
 * refusals as tool errors the agent can act on.
 */
function forAccount(userId: number, handler: (service: WaterEventService, timeZone: string) => CallToolResult): CallToolResult {
  const service = getWaterEventService();
  const timeZone = service.timeZone(userId);
  if (!timeZone) return toolError(MISSING_SETUP_MESSAGE);
  try {
    return handler(service, timeZone);
  } catch (error) {
    if (error instanceof WaterEventValidationError || error instanceof WaterEventNotFoundError) {
      return toolError(error.message);
    }
    throw error;
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Creates an event, or with `id` changes only its amount; a `logDate` sent with `id` is ignored. */
function handleLogWater(userId: number, input: { id?: number; logDate?: string; ounces: number }): CallToolResult {
  const quantity = { ounces: ouncesFromJson(input.ounces) };
  const save: CreateWaterEvent = input.id === undefined
    ? { logDate: input.logDate ?? "", quantity }
    : { id: input.id, quantity };
  return forAccount(userId, (service, timeZone) => {
    const event = presentWaterEvent(service.save(userId, save));
    const summary = service.daySummary(userId, event.logDate, timeZone);
    const day = { date: summary.date, totalOunces: Number(summary.totalOunces) };
    const lead = input.id === undefined
      ? `Logged ${event.ounces} fl oz of water consumed at ${event.logDate}.`
      : `Changed Water Event ${event.id} to ${event.ounces} fl oz.`;
    return {
      structuredContent: { event, day },
      content: [{ type: "text", text: `${lead} Water on ${day.date}: ${day.totalOunces} fl oz.` }],
    };
  });
}

function handleListWater(userId: number, range: { from: string; to: string }): CallToolResult {
  return forAccount(userId, (service) => {
    const list = presentWaterEventList(service.list(userId, range));
    return {
      structuredContent: list,
      content: [{ type: "text", text: `${plural(list.events.length, "water event")}, ${list.totalOunces} fl oz in total.` }],
    };
  });
}

function handleDeleteWater(userId: number, eventIds: number[]): CallToolResult {
  return forAccount(userId, (service) => {
    const deletion = presentWaterEventDeletion(service.delete(userId, eventIds));
    return {
      structuredContent: deletion,
      content: [{ type: "text", text: `Deleted ${plural(deletion.deletedCount, "water event")}.` }],
    };
  });
}

export const logWaterTool: McpTool = {
  scope: "water-events:write",
  register: (server, userId) => server.registerTool("log_water", {
    title: "Log water",
    description:
      "Record water consumed at a specified date and time in fluid ounces. " +
      "Omit id to create a new event; provide id to change only its amount (logDate is then ignored).",
    inputSchema: {
      id: z.number().int().positive().optional().describe("Existing event ID; omit to create"),
      logDate: z.iso.datetime({ offset: true }).optional().describe("Consumption time; required when creating"),
      ounces: z.number().describe("Fluid ounces from 0.001 to 500, with at most three decimals"),
    },
    outputSchema: {
      event: waterEventOutputSchema,
      day: z.object({ date: z.string(), totalOunces: z.number() }),
    },
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  }, (input) => handleLogWater(userId, input)),
};

export const listWaterTool: McpTool = {
  scope: "water-events:read",
  register: (server, userId) => server.registerTool("list_water", {
    title: "List water events",
    description: "List water consumed in a time range, newest first, with total fluid ounces.",
    inputSchema: {
      from: z.iso.datetime({ offset: true }).describe("Inclusive consumption time, with offset"),
      to: z.iso.datetime({ offset: true }).describe("Exclusive consumption time, with offset"),
    },
    outputSchema: {
      events: z.array(waterEventOutputSchema),
      totalOunces: z.number(),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, (input) => handleListWater(userId, input)),
};

export const deleteWaterTool: McpTool = {
  scope: "water-events:write",
  register: (server, userId) => server.registerTool("delete_water", {
    title: "Delete water events",
    description: "Delete the account holder's water events by ID and return the number removed.",
    inputSchema: {
      eventIds: z.array(z.number().int().positive()).describe("Event IDs to delete; use one ID for a single event"),
    },
    outputSchema: { deletedCount: z.number().int().nonnegative() },
    annotations: {
      readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false,
    },
  }, ({ eventIds }) => handleDeleteWater(userId, eventIds)),
};
