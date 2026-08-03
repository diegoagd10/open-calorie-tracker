import type { NutrientKey, NutritionProfile } from "../domain/nutrition.js";

export interface FoodCandidate {
  token?: string;
  name: string;
  brand?: string | null;
  description?: string | null;
  quantityBasis: string;
  basisQuantity?: number;
  nutrients: Partial<Record<NutrientKey, number | null>>;
  source: string;
  sourceId?: string;
  warnings: string[];
  complete: boolean;
  requiresReview: true;
}

export interface FoodSearchAdapter {
  search(query: string): Promise<FoodCandidate[]>;
}

export interface BarcodeAdapter {
  lookup(barcode: string): Promise<FoodCandidate>;
}

export interface LabelCandidateAdapter {
  extract(input: { buffer: Buffer; mimeType: string; fileName: string }): Promise<FoodCandidate>;
}

export interface IngredientProposal {
  name: string;
  quantity: string;
  unit: string;
  confidence?: "high" | "medium" | "low";
  matches?: FoodCandidate[];
}

export interface FoodImageAnalysis {
  isFood: boolean;
  ingredients: IngredientProposal[];
  warnings: string[];
}

export interface AiFoodAdapter {
  analyze(input: { buffer: Buffer; mimeType: string; fileName: string }): Promise<FoodImageAnalysis>;
  proposeEdit(input: { instruction: string; ingredients: IngredientProposal[] }): Promise<{ message: string; ingredients: IngredientProposal[] }>;
}
