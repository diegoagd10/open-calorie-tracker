import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiKeyScope } from "../api-keys/presets";
import { parseIsoLocalDate } from "../food-log/date";
import { getFoodLogService } from "../food-log/runtime.server";
import { dailyLogSummarySchema, summarizeDailyLog } from "./daily-log-summary";
import { logWater } from "./log-water.server";
import { MISSING_SETUP_MESSAGE, toolError } from "./tool-result";

/** An MCP tool and the API key scopes, any one of which lets a caller see and call it. */
export type McpTool = {
  scopes: readonly ApiKeyScope[];
  register(server: McpServer, userId: number): ReturnType<McpServer["registerTool"]>;
};

const getDailyLog: McpTool = {
  scopes: ["daily-log:read"],
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

export const MCP_TOOLS: readonly McpTool[] = [getDailyLog, logWater];
