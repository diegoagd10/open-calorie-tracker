import { z } from "zod";
import { parseIsoLocalDate } from "../shared/local-date";
import { getFoodLogService } from "../food-log/runtime.server";
import { getFoodTool, lookupBarcodeTool, searchFoodsTool } from "../catalog/mcp-tool.server";
import { deleteFoodTool, listFoodTool, logFoodTool } from "../food-event/mcp-tool.server";
import { deleteWaterTool, listWaterTool, logWaterTool } from "../water-event/mcp-tool.server";
import { dailyLogSummarySchema, summarizeDailyLog } from "./daily-log-summary";
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

export const MCP_TOOLS: readonly McpTool[] = [
  getDailyLog,
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
