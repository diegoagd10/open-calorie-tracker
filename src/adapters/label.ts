import { asProviderFailure, ProviderFailure } from "./errors.js";
import type { FoodCandidate, LabelCandidateAdapter } from "./types.js";
import OpenAI from "openai";

export const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function validateImageInput(input: { buffer: Buffer; mimeType: string; fileName?: string }, maxBytes = 10 * 1024 * 1024): void {
  if (!ALLOWED_IMAGE_TYPES.has(input.mimeType)) throw new ProviderFailure("invalid", "Use a JPEG, PNG, WebP, or GIF image.", { retryable: false, manualFallback: true });
  if (!input.buffer.length || input.buffer.length > maxBytes) throw new ProviderFailure("invalid", "The image is empty or too large.", { retryable: false, manualFallback: true });
  if (input.fileName?.includes("..")) throw new ProviderFailure("invalid", "The image name is not valid.", { retryable: false, manualFallback: true });
}

export function normalizeLabelCandidate(value: Partial<FoodCandidate> & { name?: string; nutrients?: Record<string, number | null> }): FoodCandidate {
  const nutrients = value.nutrients ?? {};
  const warnings = [...(value.warnings ?? [])];
  if (nutrients.calories === null || nutrients.calories === undefined) warnings.push("Calories are missing and must be entered before confirmation.");
  const name = value.name?.trim() || "Food Label candidate";
  return {
    name,
    brand: value.brand ?? null,
    description: value.description ?? null,
    quantityBasis: value.quantityBasis?.trim() || "serving",
    basisQuantity: value.basisQuantity ?? 1,
    nutrients,
    source: value.source || "Food Label",
    sourceId: value.sourceId,
    warnings: [...new Set(warnings)],
    complete: Boolean(nutrients.calories !== null && nutrients.calories !== undefined),
    requiresReview: true,
  };
}

export class ConfiguredLabelAdapter implements LabelCandidateAdapter {
  constructor(private readonly extractLabel: (input: { buffer: Buffer; mimeType: string; fileName: string }) => Promise<Partial<FoodCandidate> & { nutrients?: Record<string, number | null> }>) {}

  async extract(input: { buffer: Buffer; mimeType: string; fileName: string }): Promise<FoodCandidate> {
    validateImageInput(input);
    try {
      return normalizeLabelCandidate(await this.extractLabel(input));
    } catch (error) {
      throw asProviderFailure(error, "Food Label provider");
    }
  }
}

export class OpenAiLabelAdapter implements LabelCandidateAdapter {
  private readonly client: OpenAI;

  constructor(private readonly options: { apiKey: string; model?: string }) {
    this.client = new OpenAI({ apiKey: options.apiKey });
  }

  async extract(input: { buffer: Buffer; mimeType: string; fileName: string }): Promise<FoodCandidate> {
    validateImageInput(input);
    try {
      const response = await this.client.responses.create({
        model: this.options.model || "gpt-5.6-terra",
        input: `Read only visible values from this nutrition label image. Return JSON with name, brand, quantityBasis, and nutrients using calories, protein, carbohydrates, fat, fiber, addedSugar, sugar, saturatedFat, and sodium. Use null for missing or unreadable values. Do not infer values. Image: data:${input.mimeType};base64,${input.buffer.toString("base64")}`,
        text: { format: { type: "json_object" } },
      });
      if (response.status !== "completed" || !response.output_text) throw new Error("Food Label provider returned an incomplete response.");
      const parsed = JSON.parse(response.output_text) as Partial<FoodCandidate> & { nutrients?: Record<string, number | null> };
      return normalizeLabelCandidate({ ...parsed, source: "Food Label / AI extraction" });
    } catch (error) {
      throw asProviderFailure(error, "Food Label provider");
    }
  }
}
