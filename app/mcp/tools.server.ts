import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ApiKeyScope } from "../api-keys/presets";
import type { FoodEntryService } from "../food-entry/food-entry.server";
import { getFoodEntryService } from "../food-entry/runtime.server";
import { parseIsoLocalDate } from "../food-log/date";
import { getFoodLogService } from "../food-log/runtime.server";
import { dailyLogSummarySchema, summarizeDailyLog } from "./daily-log-summary";

/** An MCP tool and the API key scopes, any one of which lets a caller see and call it. */
export type McpTool = {
  scopes: readonly ApiKeyScope[];
  register(server: McpServer, userId: number): ReturnType<McpServer["registerTool"]>;
};

function toolError(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

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
    if (!foodLog) return toolError("This account has not finished setup, so it has no Food Log yet. Finish setup in Open Calorie Tracker first.");
    const { structured, text } = summarizeDailyLog(foodLog);
    return { structuredContent: structured, content: [{ type: "text", text }] };
  }),
};

type SavedFoodSearch = ReturnType<FoodEntryService["searchSavedFoods"]>;

const savedFoodSchema = z.object({
  id: z.number().int().describe("Saved Food id"),
  name: z.string(),
  energyKcal: z.number().nullable(),
  proteinG: z.number().nullable(),
  carbohydrateG: z.number().nullable(),
  fatG: z.number().nullable(),
  fiberG: z.number().nullable(),
  sugarG: z.number().nullable(),
  sodiumMg: z.number().nullable(),
});

function perThousand(canonical: number | null) {
  return canonical === null ? null : canonical / 1_000;
}

function presentSavedFood(food: SavedFoodSearch["savedFoods"][number]): z.infer<typeof savedFoodSchema> {
  return {
    id: food.id,
    name: food.name,
    energyKcal: perThousand(food.energyMilliKcal),
    proteinG: perThousand(food.proteinMilligrams),
    carbohydrateG: perThousand(food.carbohydrateMilligrams),
    fatG: perThousand(food.fatMilligrams),
    fiberG: perThousand(food.fiberMilligrams),
    sugarG: perThousand(food.sugarMilligrams),
    sodiumMg: food.sodiumMilligrams,
  };
}

function savedFoodSearchText(query: string, { savedFoods, truncated }: SavedFoodSearch): string {
  const matching = query.trim() ? ` matching "${query.trim()}"` : "";
  if (savedFoods.length === 0) return `No Saved Foods${matching}.`;
  const listed = savedFoods.map((food) => `${food.name} (id ${food.id}, ${perThousand(food.energyMilliKcal) ?? "unknown"} kcal per serving)`).join("; ");
  const more = truncated ? ` More match; showing the first ${savedFoods.length}, so refine the query.` : "";
  return `${savedFoods.length} Saved Foods${matching}: ${listed}.${more}`;
}

const searchSavedFoods: McpTool = {
  scopes: ["daily-log:read", "food-log:write"],
  register: (server, userId) => server.registerTool("search_saved_foods", {
    title: "Search Saved Foods",
    description: "Finds the account holder's Saved Foods (My foods) whose name contains the query, ignoring case, with each one's id and nutrition per one serving. Returns up to 25 sorted by name; truncated is true when more match. Logs nothing.",
    inputSchema: {
      query: z.string().max(200).optional().describe("Part of the name to look for. Empty or missing lists every Saved Food."),
    },
    outputSchema: {
      savedFoods: z.array(savedFoodSchema).describe("Matching Saved Foods with nutrition per one serving; null means the value is unknown"),
      truncated: z.boolean().describe("True when more Saved Foods match than were returned"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ query = "" }) => {
    const found = getFoodEntryService().searchSavedFoods(userId, query);
    return {
      structuredContent: { savedFoods: found.savedFoods.map(presentSavedFood), truncated: found.truncated },
      content: [{ type: "text", text: savedFoodSearchText(query, found) }],
    };
  }),
};

export const MCP_TOOLS: readonly McpTool[] = [getDailyLog, searchSavedFoods];
