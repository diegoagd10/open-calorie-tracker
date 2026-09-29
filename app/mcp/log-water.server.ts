import { z } from "zod";
import { EXTERNAL_IDEMPOTENCY_KEY, externalIdempotencyKey } from "../api-keys/idempotency-key";
import { FutureFoodLogDateError, InvalidFoodLogDateError } from "../food-log/food-log.server";
import { getFoodLogService } from "../food-log/runtime.server";
import { getWaterEventService } from "../water-event/runtime.server";
import {
  InvalidWaterEventInputError,
  WaterEventIdempotencyConflictError,
  WaterEventSetupRequiredError,
} from "../water-event/water-event.server";
import { amountLine, dailyLogSummarySchema, summarizeDailyLog, waterInDisplayUnits } from "./daily-log-summary";
import { MISSING_SETUP_MESSAGE, toolError } from "./tool-result";
import type { McpTool } from "./tools.server";

const IDEMPOTENCY_KEY_MESSAGE = "idempotencyKey is required: 8 to 124 characters from A-Z, a-z, 0-9, and . _ : -, new for each distinct drink.";

const containerCount = (container: string) => z.number()
  .int({ error: "Fractions are not accepted: count whole containers only." })
  .min(0, { error: "Container counts cannot be negative." })
  .optional()
  .describe(`Number of ${container}. Omitted means 0.`);

const outputSchema = {
  waterEvent: z.object({
    id: z.number().int(),
    date: z.string().describe("The Food Log date (YYYY-MM-DD)"),
    time: z.string().describe("Local time (HH:MM)"),
    amountMl: z.number(),
    amount: z.number().describe("The amount in the account's display units"),
    unit: z.enum(["ml", "fl oz"]),
    containers: z.object({ glasses: z.number().int(), bottles: z.number().int(), large: z.number().int() }),
  }),
  replayed: z.boolean().describe("True when this idempotencyKey was already used, so the original Water Event is returned and nothing new was logged"),
  dailyLog: z.object(dailyLogSummarySchema).describe("The day summary for the Water Event's date, as get_daily_log returns it"),
};

/** Each refusal the Water Event service can raise, as a message the agent can act on. */
function serviceErrorMessage(error: unknown, date: string | undefined): string | undefined {
  if (error instanceof InvalidFoodLogDateError) return `Invalid date "${date}". Use a calendar date as YYYY-MM-DD.`;
  if (error instanceof FutureFoodLogDateError) return `${date} is in the future. Log water only for today or an earlier day.`;
  if (error instanceof InvalidWaterEventInputError) return "Log at least one container, and at most 500 fl oz in total.";
  if (error instanceof WaterEventIdempotencyConflictError) {
    return "This idempotencyKey was already used for different water. Use a new idempotencyKey for each distinct drink; to retry, send the same counts and date.";
  }
  if (error instanceof WaterEventSetupRequiredError) return MISSING_SETUP_MESSAGE;
  return undefined;
}

/** "2 glasses and 1 bottle", naming only the containers logged. */
function describeContainers(containers: { glasses: number; bottles: number; large: number }): string {
  const parts = ([
    [containers.glasses, "glass", "glasses"],
    [containers.bottles, "bottle", "bottles"],
    [containers.large, "large", "large"],
  ] as const).filter(([count]) => count > 0).map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);
  return parts.length < 3 ? parts.join(" and ") : `${parts[0]}, ${parts[1]}, and ${parts[2]}`;
}

export const logWater: McpTool = {
  scopes: ["water-log:write"],
  register: (server, userId) => server.registerTool("log_water", {
    title: "Log water to the Food Log",
    description: "Records one Water Event in the account holder's Food Log from the containers they drank, the same ones the web app offers: Glass (8 fl oz), Bottle (16 fl oz), and Large (24 fl oz). Counts are whole containers; fractions are not accepted. Logs for today by default, or any past day. Send a new idempotencyKey for each distinct drink, and the same key only to retry a call whose result you did not receive. Returns the Water Event and the day summary.",
    inputSchema: {
      glasses: containerCount("glasses (8 fl oz each)"),
      bottles: containerCount("bottles (16 fl oz each)"),
      large: containerCount("large containers (24 fl oz each)"),
      date: z.string().optional().describe("Calendar date as YYYY-MM-DD, today or earlier. Defaults to today in the account's time zone."),
      idempotencyKey: z.string({ error: IDEMPOTENCY_KEY_MESSAGE })
        .regex(EXTERNAL_IDEMPOTENCY_KEY, { error: IDEMPOTENCY_KEY_MESSAGE })
        .describe("A new unique key for each distinct drink, 8 to 124 characters from A-Z, a-z, 0-9, and . _ : -. Reuse it only to retry the same call."),
    },
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, ({ glasses = 0, bottles = 0, large = 0, date, idempotencyKey }) => {
    const storedKey = externalIdempotencyKey("mcp", idempotencyKey);
    if (!storedKey) return toolError(IDEMPOTENCY_KEY_MESSAGE);
    let created;
    try {
      created = getWaterEventService().createIdempotently(
        userId,
        { counts: { "8": glasses, "16": bottles, "24": large }, foodLogDate: date },
        storedKey,
      );
    } catch (error) {
      const message = serviceErrorMessage(error, date);
      if (message === undefined) throw error;
      return toolError(message);
    }
    const { event, replayed } = created;
    const foodLog = getFoodLogService().read(userId, event.foodLogDate);
    if (!foodLog) return toolError(MISSING_SETUP_MESSAGE);
    const dailyLog = summarizeDailyLog(foodLog).structured;
    const { unit, amount } = waterInDisplayUnits(event.amountMicroliters, foodLog.displayUnits);
    const waterEvent = {
      id: event.id,
      date: event.foodLogDate,
      time: event.localEventTime.slice(0, 5),
      amountMl: Math.round(event.amountMicroliters / 1_000),
      amount,
      unit,
      containers: { glasses: event.preset8Count, bottles: event.preset16Count, large: event.preset24Count },
    };
    const logged = `${describeContainers(waterEvent.containers)} (${amount} ${unit}) on ${event.foodLogDate}`;
    const lead = replayed ? `Already logged ${logged}; this idempotencyKey was used before, so nothing new was logged.` : `Logged ${logged}.`;
    const day = event.foodLogDate === dailyLog.today ? "Water today" : `Water on ${event.foodLogDate}`;
    return {
      structuredContent: { waterEvent, replayed, dailyLog },
      content: [{ type: "text", text: `${lead} ${amountLine(day, dailyLog.water)}.` }],
    };
  }),
};
