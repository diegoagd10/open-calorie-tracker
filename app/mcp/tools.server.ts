import { z } from "zod";
import { parseIsoLocalDate } from "../shared/local-date";
import { MAXIMUM_RANGE_DAYS, parseFoodLogRange } from "../food-log/food-log.server";
import { getFoodLogService } from "../food-log/runtime.server";
import { getFoodTool, lookupBarcodeTool, searchFoodsTool } from "../catalog/mcp-tool.server";
import { deleteFoodTool, listFoodTool, logFoodTool } from "../food-event/mcp-tool.server";
import { deleteWaterTool, listWaterTool, logWaterTool } from "../water-event/mcp-tool.server";
import { dailyLogSummarySchema, dailyLogsSummarySchema, summarizeDailyLog, summarizeDailyLogs } from "./daily-log-summary";
import { MISSING_SETUP_MESSAGE, toolError, type McpTool } from "./mcp-tool";

export type { McpTool } from "./mcp-tool";

const getDailyLog: McpTool = {
  scope: "daily-log:read",
  register: (server, userId) => server.registerTool("get_daily_log", {
    title: "Get daily Food Log",
    description: "Summarizes the account holder's Food Log for one day: energy, macronutrients, sodium, and water consumed, with goals, remaining amounts, and the foods logged.",
    inputSchema: {
      date: z.string().optional().describe("Calendar date as YYYY-MM-DD. Defaults to today in the account's time zone."),
    },
    outputSchema: dailyLogSummarySchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ date }) => {
    if (date !== undefined && !parseIsoLocalDate(date)) return toolError(`Invalid date "${date}". Use a calendar date as YYYY-MM-DD.`);
    const foodLog = getFoodLogService().read(userId, date);
    if (!foodLog) return toolError(MISSING_SETUP_MESSAGE);
    const { structured, text } = summarizeDailyLog(foodLog);
    return { structuredContent: structured, content: [{ type: "text", text }] };
  }),
};

const getDailyLogs: McpTool = {
  scope: "daily-log:read",
  register: (server, userId) => server.registerTool("get_daily_logs", {
    title: "Get daily Food Logs for a date range",
    description: `Summarizes the account holder's Food Log for every date from startDate through endDate (at most ${MAXIMUM_RANGE_DAYS} dates): each day as get_daily_log shows it, each food with its local time, and the range's totals and daily averages over the dates that have records.`,
    inputSchema: {
      startDate: z.string().describe("First calendar date as YYYY-MM-DD, in the account's time zone."),
      endDate: z.string().describe(`Last calendar date as YYYY-MM-DD, inclusive; at most ${MAXIMUM_RANGE_DAYS} dates from startDate counting both.`),
    },
    outputSchema: dailyLogsSummarySchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ startDate, endDate }) => {
    const requested = parseFoodLogRange(startDate, endDate);
    if (!requested) {
      return toolError(`Invalid date range "${startDate}" to "${endDate}". Use calendar dates as YYYY-MM-DD, with startDate on or before endDate, covering at most ${MAXIMUM_RANGE_DAYS} dates.`);
    }
    const range = getFoodLogService().readRange(userId, requested.startDate, requested.endDate);
    if (!range) return toolError(MISSING_SETUP_MESSAGE);
    const { structured, text } = summarizeDailyLogs(range);
    return { structuredContent: structured, content: [{ type: "text", text }] };
  }),
};

export const MCP_TOOLS: readonly McpTool[] = [
  getDailyLog,
  getDailyLogs,
  logWaterTool,
  listWaterTool,
  deleteWaterTool,
  logFoodTool,
  listFoodTool,
  deleteFoodTool,
  searchFoodsTool,
  getFoodTool,
  lookupBarcodeTool,
];
