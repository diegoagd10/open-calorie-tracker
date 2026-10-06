import { randomUUID } from "node:crypto";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { toolError, type McpTool } from "../mcp/mcp-tool";
import type { CatalogFoodSummary, FindCatalogFoods, ReviewableFood } from "./catalog.model";
import { CatalogDiscoveryError, findCatalogFoods } from "./discovery.server";
import { getFoodCatalog } from "./runtime.server";

const nullableNumber = z.number().nullable();

const summaryOutputSchema = z.object({
  provider: z.string(),
  providerFoodId: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  dataType: z.string(),
  measurementSummary: z.string(),
  isSelectable: z.boolean(),
  publishedDate: z.string().nullable(),
});

const reviewableOutputSchema = {
  food: z.object({
    provider: z.string(),
    providerFoodId: z.string(),
    reviewVersion: z.string().describe("Send unchanged to log_food; a changed food must be reviewed again"),
    name: z.string(),
    brand: z.string().nullable(),
    barcode: z.string().nullable(),
    dataType: z.string(),
    isSelectable: z.boolean().describe("False when the food has no usable calories and cannot be logged"),
    unavailableReason: z.string().nullable(),
    nutritionBasis: z.object({ quantity: z.number(), unit: z.string() }).describe("The amount nutrition describes"),
    nutrition: z.object({
      energyKcal: nullableNumber,
      proteinG: nullableNumber,
      carbohydrateG: nullableNumber,
      fatG: nullableNumber,
      fiberG: nullableNumber,
      sugarG: nullableNumber,
      sodiumMg: nullableNumber,
    }).describe("Per nutritionBasis; null means unknown"),
    measurements: z.array(z.object({
      id: z.string(),
      label: z.string(),
      unit: z.string(),
      quantity: z.number().describe("Size of one measurement in the basis unit"),
    })),
  }),
};

function summaryLine(food: CatalogFoodSummary): string {
  const details = [food.brand, food.measurementSummary].filter(Boolean).join(" · ");
  return `- ${food.providerFoodId}: ${food.name}${details ? ` (${details})` : ""}${food.isSelectable ? "" : " — nutrition unavailable"}`;
}

function reviewText(food: ReviewableFood): string {
  const { nutrition, nutritionBasis } = food;
  const per = `${nutritionBasis.quantity} ${nutritionBasis.unit}`;
  const lines = [
    `${food.name}${food.brand ? ` (${food.brand})` : ""}, ${food.dataType}.`,
    food.isSelectable
      ? `Per ${per}: ${nutrition.energyKcal ?? "unknown"} kcal, protein ${nutrition.proteinG ?? "unknown"} g, carbohydrate ${nutrition.carbohydrateG ?? "unknown"} g, fat ${nutrition.fatG ?? "unknown"} g.`
      : "This food has no usable nutrition and cannot be logged.",
    `Measurements: ${food.measurements.map((measurement) => `${measurement.id} (${measurement.label})`).join(", ") || "none"}.`,
  ];
  if (food.isSelectable) {
    lines.push(`To log it, call log_food with method "${food.provider === "usda-fdc" ? "lookup" : "barcode"}", providerFoodId "${food.providerFoodId}", reviewVersion "${food.reviewVersion}", a measurementId, and a quantity.`);
  }
  return lines.join("\n");
}

/** Runs a discovery, returning invalid requests and provider refusals as tool errors. */
async function discover(find: FindCatalogFoods, present: (found: Awaited<ReturnType<typeof findCatalogFoods>>) => CallToolResult) {
  try {
    return present(await findCatalogFoods(getFoodCatalog(), find, randomUUID()));
  } catch (error) {
    if (error instanceof CatalogDiscoveryError) return toolError(error.message);
    throw error;
  }
}

function reviewed(found: Awaited<ReturnType<typeof findCatalogFoods>>): CallToolResult {
  const { food } = found as { food: ReviewableFood };
  return { structuredContent: { food }, content: [{ type: "text", text: reviewText(food) }] };
}

export const searchFoodsTool: McpTool = {
  scope: "catalog:read",
  register: (server) => server.registerTool("search_foods", {
    title: "Search foods",
    description: "Search the USDA food catalog by name. Open a result with get_food to see its nutrition and measurements before logging it.",
    inputSchema: { query: z.string().describe("Food name, 2 to 100 characters") },
    outputSchema: { results: z.array(summaryOutputSchema) },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, ({ query }) => discover({ provider: "usda-fdc", query }, (found) => {
    const { results } = found as { results: CatalogFoodSummary[] };
    return {
      structuredContent: { results },
      content: [{ type: "text", text: results.length ? results.map(summaryLine).join("\n") : "No foods found." }],
    };
  })),
};

export const getFoodTool: McpTool = {
  scope: "catalog:read",
  register: (server) => server.registerTool("get_food", {
    title: "Get food",
    description: "Review one USDA food from search_foods: its nutrition, measurements, and the reviewVersion log_food needs.",
    inputSchema: { providerFoodId: z.string().describe("The providerFoodId from search_foods") },
    outputSchema: reviewableOutputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, ({ providerFoodId }) => discover({ provider: "usda-fdc", providerFoodId }, reviewed)),
};

export const lookupBarcodeTool: McpTool = {
  scope: "catalog:read",
  register: (server) => server.registerTool("lookup_barcode", {
    title: "Look up barcode",
    description: "Look a packaged product up on Open Food Facts by its barcode: its label nutrition, measurements, and the reviewVersion log_food needs.",
    inputSchema: { barcode: z.string().describe("The 7, 8, 12, 13, or 14 digits printed below the barcode") },
    outputSchema: reviewableOutputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  }, ({ barcode }) => discover({ provider: "open-food-facts", barcode }, reviewed)),
};
