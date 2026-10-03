import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { toolError, type McpTool } from "../mcp/mcp-tool";
import { getWaterEventService } from "./runtime.server";
import type { CreateWaterEvent } from "./water-event.model";
import {
  presentWaterEvent,
  presentWaterEventDeletion,
  presentWaterEventList,
} from "./water-event.utils";
import { WaterEventNotFoundError, WaterEventValidationError } from "./water-events.exceptions";

const waterEventOutputSchema = z.object({
  id: z.number().int().positive(),
  logDate: z.string(),
  ounces: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Runs a handler, returning the Water Event rules' refusals as tool errors the agent can act on. */
function withWaterEventErrors(handler: () => CallToolResult): CallToolResult {
  try {
    return handler();
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

function handleLogWater(userId: number, input: { id?: number; logDate?: string; ounces: string }): CallToolResult {
  if (input.id !== undefined && input.logDate !== undefined) {
    return toolError("To edit a Water Event, send its id and the new ounces only; the consumption time cannot change.");
  }
  const save: CreateWaterEvent = input.id === undefined
    ? { logDate: input.logDate ?? "", quantity: { ounces: input.ounces } }
    : { id: input.id, quantity: { ounces: input.ounces } };
  return withWaterEventErrors(() => {
    const service = getWaterEventService();
    const event = presentWaterEvent(service.save(userId, save));
    const day = service.daySummary(userId, event.logDate);
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
  return withWaterEventErrors(() => {
    const list = presentWaterEventList(getWaterEventService().list(userId, range));
    return {
      structuredContent: list,
      content: [{ type: "text", text: `${plural(list.events.length, "water event")}, ${list.totalOunces} fl oz in total.` }],
    };
  });
}

function handleDeleteWater(userId: number, eventIds: number[]): CallToolResult {
  return withWaterEventErrors(() => {
    const deletion = presentWaterEventDeletion(getWaterEventService().delete(userId, eventIds));
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
      "Omit id to create a new event; provide id to change only its amount.",
    inputSchema: {
      id: z.number().int().positive().optional().describe("Existing event ID; omit to create"),
      logDate: z.iso.datetime({ offset: true }).optional().describe("Consumption time; required when creating"),
      ounces: z.string().describe("Decimal fluid ounces from 0.001 to 500"),
    },
    outputSchema: {
      event: waterEventOutputSchema,
      day: z.object({ date: z.string(), totalOunces: z.string() }),
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
      totalOunces: z.string(),
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
