import { z } from "zod";
import { parseIsoLocalDate } from "../food-log/date";
import { getFoodLogService } from "../food-log/runtime.server";
import { deleteWaterTool, listWaterTool, logWaterTool } from "../water-event/mcp-tool.server";
import { dailyLogSummarySchema, summarizeDailyLog } from "./daily-log-summary";
import { toolError, type McpTool } from "./mcp-tool";

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
    if (!foodLog) return toolError("This account has not finished setup, so it has no Food Log yet. Finish setup in Open Calorie Tracker first.");
    const { structured, text } = summarizeDailyLog(foodLog);
    return { structuredContent: structured, content: [{ type: "text", text }] };
  }),
};

export const MCP_TOOLS: readonly McpTool[] = [getDailyLog, logWaterTool, listWaterTool, deleteWaterTool];
