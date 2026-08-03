import OpenAI from "openai";
import { asProviderFailure } from "./errors.js";
import { validateImageInput } from "./label.js";
import type { AiFoodAdapter, FoodImageAnalysis, IngredientProposal } from "./types.js";

const mimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export class OpenAiFoodAdapter implements AiFoodAdapter {
  private readonly client: OpenAI;

  constructor(private readonly options: { apiKey: string; model?: string }) {
    this.client = new OpenAI({ apiKey: options.apiKey });
  }

  async analyze(input: { buffer: Buffer; mimeType: string; fileName: string }): Promise<FoodImageAnalysis> {
    validateImageInput(input);
    if (!mimeTypes.has(input.mimeType)) throw new Error("Unsupported image type.");
    try {
      const response = await this.client.responses.create({
        model: this.options.model || "gpt-5.6-terra",
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: "Identify only visible or confidently identifiable food ingredients. Return JSON with isFood, ingredients (name, quantity, unit, confidence), and warnings. Never invent hidden ingredients." },
            { type: "input_image", image_url: `data:${input.mimeType};base64,${input.buffer.toString("base64")}`, detail: "high" },
          ],
        }],
        text: { format: { type: "json_object" } },
      });
      if (response.status !== "completed" || !response.output_text) throw new Error("AI returned an incomplete response.");
      const parsed = JSON.parse(response.output_text) as { isFood?: boolean; ingredients?: IngredientProposal[]; warnings?: string[] };
      return { isFood: Boolean(parsed.isFood), ingredients: parsed.ingredients ?? [], warnings: parsed.warnings ?? [] };
    } catch (error) {
      throw asProviderFailure(error, "AI food analysis");
    }
  }

  async proposeEdit(input: { instruction: string; ingredients: IngredientProposal[] }): Promise<{ message: string; ingredients: IngredientProposal[] }> {
    if (!input.instruction.trim()) throw new Error("An edit instruction is required.");
    try {
      const response = await this.client.responses.create({
        model: this.options.model || "gpt-5.6-terra",
        input: `Propose an edit to this food ingredient list. Do not apply it. Instruction: ${input.instruction}\nIngredients: ${JSON.stringify(input.ingredients)}`,
        text: { format: { type: "json_object" } },
      });
      if (response.status !== "completed" || !response.output_text) throw new Error("AI returned an incomplete proposal.");
      const parsed = JSON.parse(response.output_text) as { message?: string; ingredients?: IngredientProposal[] };
      return { message: parsed.message || "Review the proposed changes before confirming.", ingredients: parsed.ingredients ?? input.ingredients };
    } catch (error) {
      throw asProviderFailure(error, "AI edit provider");
    }
  }
}
