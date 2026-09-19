import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { UsdaAnalysisReader, UsdaEvidence } from "../catalog/usda-evidence";
import type { PhotoAnalyzer, PlatePhoto } from "./photo-analysis.server";
import { NoFoodDetectedError, validatePhotoResult, type PhotoResult } from "./result.server";

const credentialsSchema = z.object({
  geminiApiKey: z.string().min(8).max(512).regex(/^\S+$/),
  jevApiKey: z.string().min(8).max(512).regex(/^\S+$/),
});
const estimatedNutritionSchema = z.object({
  energyKcal: z.number().finite().nonnegative().max(100_000),
  proteinGrams: z.number().finite().nonnegative().max(10_000),
  carbohydrateGrams: z.number().finite().nonnegative().max(10_000),
  fatGrams: z.number().finite().nonnegative().max(10_000),
  fiberGrams: z.number().finite().nonnegative().max(10_000).nullable(),
  sugarGrams: z.number().finite().nonnegative().max(10_000).nullable(),
  sodiumMilligrams: z.number().finite().nonnegative().max(1_000_000).nullable(),
});
const observationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  preparation: z.string().trim().min(1).max(120).nullable(),
  quantity: z.number().positive().max(10_000),
  unit: z.enum(["g", "ml", "serving"]),
  quantityDescription: z.string().trim().min(1).max(120),
  searchQuery: z.string().trim().min(1).max(120),
  includes: z.array(z.string().trim().min(1).max(100)).max(20),
  nutrition: estimatedNutritionSchema,
});
const geminiObservationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  quantity: z.number().positive().max(10_000),
  unit: z.enum(["g", "ml", "serving"]),
  searchQuery: z.string().trim().min(1).max(120),
  energyKcal: z.number().finite().nonnegative().max(100_000),
  proteinGrams: z.number().finite().nonnegative().max(10_000),
  carbohydrateGrams: z.number().finite().nonnegative().max(10_000),
  fatGrams: z.number().finite().nonnegative().max(10_000),
});
const geminiOutputSchema = z.object({
  status: z.enum(["food", "no_food"]),
  mealName: z.string().trim().min(1).max(200).nullable(),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(30),
  foods: z.array(geminiObservationSchema).max(12),
}).superRefine((value, context) => {
  if (value.status === "food" && (value.foods.length === 0 || value.mealName === null)) context.addIssue({ code: "custom", message: "Food status requires a named meal" });
  if (value.status === "no_food" && value.foods.length > 0) context.addIssue({ code: "custom", message: "No-food status cannot include observations" });
}).transform(value => ({
  ...value,
  foods: value.foods.map(food => observationSchema.parse({
    name: food.name,
    preparation: null,
    quantity: food.quantity,
    unit: food.unit,
    quantityDescription: `${food.quantity} ${food.unit}`,
    searchQuery: food.searchQuery,
    includes: [],
    nutrition: {
      energyKcal: food.energyKcal,
      proteinGrams: food.proteinGrams,
      carbohydrateGrams: food.carbohydrateGrams,
      fatGrams: food.fatGrams,
      fiberGrams: null,
      sugarGrams: null,
      sodiumMilligrams: null,
    },
  })),
}));
const jevChoiceSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
});
const jevOutputSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), jevChoiceSchema),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }).optional(),
});

export type ProviderDemoStatus = { geminiConfigured: boolean; jevConfigured: boolean; ready: boolean };
export type ProductPreview = {
  name: string;
  assumptions: string[];
  totals: { energyKcal: number | null; proteinGrams: number | null; carbohydrateGrams: number | null; fatGrams: number | null; fiberGrams: number | null; sugarGrams: number | null; sodiumMilligrams: number | null };
  components: Array<{ name: string; quantity: number; unit: "g" | "ml" | "serving"; source: string; energyKcal: number; proteinGrams: number; carbohydrateGrams: number; fatGrams: number }>;
};
export type PipelineResult = {
  id: "pi" | "gemini" | "gemini-jev";
  label: string;
  model: string;
  elapsedMs: number;
  status: "succeeded" | "failed" | "no_food";
  error?: string;
  product?: ProductPreview;
  matches?: Array<{ observed: string; selected: string | null; confidence: number | null; source: "usda" | "gemini-estimate" }>;
};
export type ProviderComparisonResult = { totalElapsedMs: number; pipelines: PipelineResult[] };

export type ProviderPipelineFetch = typeof fetch;
type Credentials = z.infer<typeof credentialsSchema>;
type Extraction = z.infer<typeof geminiOutputSchema>;
type Observation = z.infer<typeof observationSchema>;
type Shortlist = { observation: Observation; candidates: UsdaEvidence[] };
type JevChoice = z.infer<typeof jevChoiceSchema>;
const GEMINI_MODEL = "gemini-3.1-flash-lite";
const JEV_MODEL = "jev-1.13.0";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const JEV_URL = "https://api.typesafe.ai/v1/systemone";

function validatePhoto(photo: PlatePhoto) {
  if (photo.bytes.length < 12 || photo.bytes.length > 8 * 1024 * 1024) throw new Error("Choose a photo up to 8 MB");
  const valid = photo.mimeType === "image/png"
    ? photo.bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : photo.mimeType === "image/jpeg"
      ? photo.bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) && photo.bytes.includes(Buffer.from([255, 217]))
      : photo.mimeType === "image/webp"
        ? photo.bytes.toString("ascii", 0, 4) === "RIFF" && photo.bytes.toString("ascii", 8, 12) === "WEBP"
        : false;
  if (!valid) throw new Error("Choose a JPEG, PNG, or WebP photo");
}
function responseError(provider: string, response: Response): Error {
  if (response.status === 401 || response.status === 403) return new Error(`${provider} rejected its API key. Save a valid key and try again.`);
  if (response.status === 429) return new Error(`${provider} rate limit reached. Try again shortly.`);
  return new Error(`${provider} request failed (${response.status}).`);
}
function candidateDescription(candidate: UsdaEvidence): string {
  const food = candidate.food;
  return [food.name, food.dataType, food.measurementSummary].filter(Boolean).join(" — ");
}
function milliseconds(startedAt: number) { return Math.max(1, Math.round(performance.now() - startedAt)); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Experiment failed."; }
function productPreview(value: unknown, id: string, evidence: UsdaEvidence[]): ProductPreview {
  const { result, snapshot } = validatePhotoResult(value, id, evidence);
  const nutrient = (value: number | null, divisor: number) => value === null ? null : value / divisor;
  return {
    name: result.name,
    assumptions: result.assumptions,
    totals: {
      energyKcal: nutrient(snapshot.energyMilliKcal ?? null, 1_000), proteinGrams: nutrient(snapshot.proteinMilligrams ?? null, 1_000), carbohydrateGrams: nutrient(snapshot.carbohydrateMilligrams ?? null, 1_000), fatGrams: nutrient(snapshot.fatMilligrams ?? null, 1_000),
      fiberGrams: nutrient(snapshot.fiberMilligrams ?? null, 1_000), sugarGrams: nutrient(snapshot.sugarMilligrams ?? null, 1_000), sodiumMilligrams: snapshot.sodiumMilligrams ?? null,
    },
    components: result.components.map(component => ({
      name: component.name, quantity: component.quantity, unit: component.unit,
      source: component.source.kind === "usda" ? `USDA ${component.source.fdcId}` : "Model estimate",
      energyKcal: component.nutrition.energyKcal, proteinGrams: component.nutrition.proteinGrams, carbohydrateGrams: component.nutrition.carbohydrateGrams, fatGrams: component.nutrition.fatGrams,
    })),
  };
}
function geminiValue(extraction: Extraction): PhotoResult {
  return {
    name: extraction.mealName!, consumedFraction: 1, assumptions: extraction.assumptions,
    components: extraction.foods.map((food, index) => ({ id: `food-${index + 1}`, name: food.name, quantity: food.quantity, unit: food.unit, includes: food.includes, source: { kind: "ai" as const, reason: "Gemini visual estimate" }, supplements: [], nutrition: food.nutrition })),
  };
}
function supplementsForMissingNutrition(observation: Observation, evidence: UsdaEvidence) {
  const nutrition = evidence.food.nutritionPerAuthoritativeBase;
  const fields = [["energyMilliKcal", "energyKcal"], ["proteinMilligrams", "proteinGrams"], ["carbohydrateMilligrams", "carbohydrateGrams"], ["fatMilligrams", "fatGrams"], ["fiberMilligrams", "fiberGrams"], ["sugarMilligrams", "sugarGrams"], ["sodiumMilligrams", "sodiumMilligrams"]] as const;
  return fields.flatMap(([catalogField, resultField]) => {
    const amount = observation.nutrition[resultField];
    return nutrition[catalogField] === null && amount !== null ? [{ nutrient: resultField, amount, reason: "Gemini estimate because the selected USDA record lacks this nutrient" }] : [];
  });
}

function selectedEvidence(
  shortlist: Shortlist,
  answer: JevChoice | undefined,
): UsdaEvidence | undefined {
  if (!answer?.choice.startsWith("candidate_")) return undefined;
  const index = Number(answer.choice.slice("candidate_".length));
  if (!Number.isInteger(index)) return undefined;
  const selected = shortlist.candidates[index];
  return selected?.food.authoritativeBaseUnit === shortlist.observation.unit
    ? selected
    : undefined;
}

function componentFromJevChoice(
  shortlist: Shortlist,
  index: number,
  answer: JevChoice | undefined,
  evidence: UsdaEvidence[],
  matches: NonNullable<PipelineResult["matches"]>,
): PhotoResult["components"][number] {
  const selected = selectedEvidence(shortlist, answer);
  if (selected) evidence.push(selected);
  matches.push({
    observed: shortlist.observation.name,
    selected: selected?.food.name ?? null,
    confidence: answer?.confidence ?? null,
    source: selected ? "usda" : "gemini-estimate",
  });
  const common = {
    id: `food-${index + 1}`,
    name: shortlist.observation.name,
    quantity: shortlist.observation.quantity,
    unit: shortlist.observation.unit,
    includes: shortlist.observation.includes,
    nutrition: shortlist.observation.nutrition,
  };
  if (!selected) {
    return {
      ...common,
      source: {
        kind: "ai",
        reason: shortlist.candidates.length
          ? "Jev found no usable USDA match"
          : "No local USDA candidate",
      },
      supplements: [],
    };
  }
  return {
    ...common,
    source: { kind: "usda", fdcId: selected.food.providerFoodId },
    supplements: supplementsForMissingNutrition(shortlist.observation, selected),
  };
}

export class ProviderPipelineDemo {
  readonly #credentialsPath: string;
  readonly #fetch: ProviderPipelineFetch;
  readonly #pi: PhotoAnalyzer;
  readonly #usda: UsdaAnalysisReader;
  constructor(credentialsPath: string, usda: UsdaAnalysisReader, network: ProviderPipelineFetch = fetch, pi?: PhotoAnalyzer) {
    this.#credentialsPath = credentialsPath;
    this.#fetch = network;
    this.#pi = pi ?? { analyze: async () => { throw new Error("Pi comparison is unavailable"); } };
    this.#usda = usda;
  }
  async status(): Promise<ProviderDemoStatus> {
    try { const credentials = await this.#readCredentials(); return { geminiConfigured: Boolean(credentials.geminiApiKey), jevConfigured: Boolean(credentials.jevApiKey), ready: true }; }
    catch { return { geminiConfigured: false, jevConfigured: false, ready: false }; }
  }
  async save(input: { geminiApiKey?: string; jevApiKey?: string }): Promise<void> {
    let existing: Partial<Credentials> = {};
    try { existing = await this.#readCredentials(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const credentials = credentialsSchema.parse({ geminiApiKey: input.geminiApiKey?.trim() || existing.geminiApiKey, jevApiKey: input.jevApiKey?.trim() || existing.jevApiKey });
    const directory = path.dirname(this.#credentialsPath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.#credentialsPath}.${randomBytes(8).toString("hex")}.tmp`;
    try { await writeFile(temporary, `${JSON.stringify(credentials)}\n`, { mode: 0o600, flag: "wx" }); await rename(temporary, this.#credentialsPath); await chmod(this.#credentialsPath, 0o600); }
    finally { await rm(temporary, { force: true }); }
  }
  async remove(): Promise<void> { await rm(this.#credentialsPath, { force: true }); }

  async compare(photo: PlatePhoto): Promise<ProviderComparisonResult> {
    validatePhoto(photo);
    const credentials = await this.#readCredentials().catch((error: unknown) => { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Save the Gemini and Jev keys before running the comparison."); throw error; });
    const comparisonStarted = performance.now();
    const piStarted = performance.now();
    const geminiStarted = performance.now();
    const piPromise = this.#runPi(photo, piStarted);
    let extraction: Extraction;
    let geminiFailure: PipelineResult | undefined;
    try { extraction = await this.#extract(photo, credentials.geminiApiKey, AbortSignal.timeout(30_000)); }
    catch (error) { geminiFailure = { id: "gemini", label: "Gemini", model: GEMINI_MODEL, elapsedMs: milliseconds(geminiStarted), status: "failed", error: errorMessage(error) }; extraction = { status: "no_food", mealName: null, assumptions: [], foods: [] }; }
    if (geminiFailure) {
      const pi = await piPromise;
      return { totalElapsedMs: milliseconds(comparisonStarted), pipelines: [pi, geminiFailure, { ...geminiFailure, id: "gemini-jev", label: "Gemini + Jev", model: `${GEMINI_MODEL} + ${JEV_MODEL}` }] };
    }
    if (extraction.status === "no_food") {
      const pi = await piPromise;
      const noFood: PipelineResult = { id: "gemini", label: "Gemini", model: GEMINI_MODEL, elapsedMs: milliseconds(geminiStarted), status: "no_food" };
      return { totalElapsedMs: milliseconds(comparisonStarted), pipelines: [pi, noFood, { ...noFood, id: "gemini-jev", label: "Gemini + Jev", model: `${GEMINI_MODEL} + ${JEV_MODEL}` }] };
    }
    const gemini = this.#geminiResult(extraction, geminiStarted);
    const [pi, geminiJev] = await Promise.all([piPromise, this.#geminiJevResult(extraction, credentials.jevApiKey, geminiStarted)]);
    return { totalElapsedMs: milliseconds(comparisonStarted), pipelines: [pi, gemini, geminiJev] };
  }
  async #runPi(photo: PlatePhoto, startedAt: number): Promise<PipelineResult> {
    const evidence = new Map<string, UsdaEvidence>(); let searches = 0; let details = 0; const signal = AbortSignal.timeout(20_000);
    try {
      const value = await this.#pi.analyze({ photo, signal, previousCorrections: [], evidence: [], usda: {
        search: async (query, page) => { if (++searches > 3) throw new Error("USDA search limit reached"); const found = await this.#usda.searchEvidence(query, page, signal); found.forEach(item => evidence.set(item.food.providerFoodId, item)); return found; },
        detail: async id => { if (++details > 6) throw new Error("USDA detail limit reached"); const captured = evidence.get(id); if (captured) return captured; const item = await this.#usda.getEvidence(id, signal); evidence.set(item.food.providerFoodId, item); return item; },
      } });
      return { id: "pi", label: "Current Pi", model: "Configured Pi photo model", elapsedMs: milliseconds(startedAt), status: "succeeded", product: productPreview(value, "benchmark-pi", [...evidence.values()]) };
    } catch (error) { return { id: "pi", label: "Current Pi", model: "Configured Pi photo model", elapsedMs: milliseconds(startedAt), status: error instanceof NoFoodDetectedError ? "no_food" : "failed", ...(error instanceof NoFoodDetectedError ? {} : { error: errorMessage(error) }) }; }
  }
  #geminiResult(extraction: Extraction, startedAt: number): PipelineResult {
    try { return { id: "gemini", label: "Gemini", model: GEMINI_MODEL, elapsedMs: milliseconds(startedAt), status: "succeeded", product: productPreview(geminiValue(extraction), "benchmark-gemini", []) }; }
    catch (error) { return { id: "gemini", label: "Gemini", model: GEMINI_MODEL, elapsedMs: milliseconds(startedAt), status: "failed", error: errorMessage(error) }; }
  }
  async #geminiJevResult(extraction: Extraction, apiKey: string, startedAt: number): Promise<PipelineResult> {
    try {
      const signal = AbortSignal.timeout(20_000);
      const shortlists = await Promise.all(extraction.foods.map(async observation => ({ observation, candidates: await this.#usda.searchEvidence(observation.searchQuery, 1, signal) })));
      const matchable = shortlists.filter(item => item.candidates.length > 0);
      const answers = matchable.length ? await this.#match(matchable, apiKey, signal) : null;
      const evidence: UsdaEvidence[] = []; const matches: NonNullable<PipelineResult["matches"]> = [];
      const components: PhotoResult["components"] = shortlists.map((item, index) => {
        const matchableIndex = matchable.indexOf(item);
        const answer = matchableIndex >= 0
          ? answers?.answers[`food_${matchableIndex}`]
          : undefined;
        return componentFromJevChoice(item, index, answer, evidence, matches);
      });
      const value: PhotoResult = { name: extraction.mealName!, consumedFraction: 1, assumptions: extraction.assumptions, components };
      return { id: "gemini-jev", label: "Gemini + Jev", model: `${GEMINI_MODEL} + ${answers?.model ?? JEV_MODEL}`, elapsedMs: milliseconds(startedAt), status: "succeeded", product: productPreview(value, "benchmark-gemini-jev", evidence), matches };
    } catch (error) { return { id: "gemini-jev", label: "Gemini + Jev", model: `${GEMINI_MODEL} + ${JEV_MODEL}`, elapsedMs: milliseconds(startedAt), status: "failed", error: errorMessage(error) }; }
  }
  async #readCredentials(): Promise<Credentials> { return credentialsSchema.parse(JSON.parse(await readFile(this.#credentialsPath, "utf8"))); }
  async #extract(photo: PlatePhoto, apiKey: string, signal: AbortSignal) {
    const response = await this.#fetch(GEMINI_URL, { method: "POST", signal, headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify({
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: photo.mimeType, data: photo.bytes.toString("base64") } }, { text: "Create a conservative meal draft from this photo. List only distinct visible foods and avoid double-counting a prepared dish and its ingredients. Estimate the consumed quantity using g, ml, or serving. The four nutrition numbers must describe that entire component quantity. Keep visually uncertain facts in assumptions. Write each searchQuery in concise English for USDA Foundation search. Return no_food for images without recognizable food or drink." }] }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: { type: "object", additionalProperties: false, required: ["status", "mealName", "assumptions", "foods"], properties: {
        status: { type: "string", enum: ["food", "no_food"] }, mealName: { type: ["string", "null"] }, assumptions: { type: "array", maxItems: 30, items: { type: "string" } },
        foods: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["name", "quantity", "unit", "searchQuery", "energyKcal", "proteinGrams", "carbohydrateGrams", "fatGrams"], properties: {
          name: { type: "string" }, quantity: { type: "number", minimum: 0.000001 }, unit: { type: "string", enum: ["g", "ml", "serving"] }, searchQuery: { type: "string" }, energyKcal: { type: "number", minimum: 0 }, proteinGrams: { type: "number", minimum: 0 }, carbohydrateGrams: { type: "number", minimum: 0 }, fatGrams: { type: "number", minimum: 0 },
        } } },
      } } },
    }) });
    if (!response.ok) throw responseError("Gemini", response);
    const payload = z.object({ candidates: z.array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }) })).min(1) }).parse(await response.json());
    const text = payload.candidates[0]?.content.parts.map(part => part.text ?? "").join("") ?? "";
    return geminiOutputSchema.parse(JSON.parse(text));
  }
  async #match(shortlists: Shortlist[], apiKey: string, signal: AbortSignal) {
    const questions = Object.fromEntries(shortlists.map((item, foodIndex) => {
      const criteria: Record<string, string> = { none: "No listed candidate adequately matches the described food and preparation" };
      item.candidates.forEach((candidate, candidateIndex) => { criteria[`candidate_${candidateIndex}`] = candidateDescription(candidate); });
      return [`food_${foodIndex}`, { type: "choice", instructions: `Which USDA candidate best matches food ${foodIndex + 1}, including preparation? Choose none when no candidate is defensible.`, criteria }] as const;
    }));
    const response = await this.#fetch(JEV_URL, { method: "POST", signal, headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: JEV_MODEL, state: shortlists.map((item, foodIndex) => ({ food: foodIndex + 1, observation: item.observation, candidates: item.candidates.map((candidate, candidateIndex) => ({ id: `candidate_${candidateIndex}`, description: candidateDescription(candidate) })) })), questions }) });
    if (!response.ok) throw responseError("Jev", response);
    return jevOutputSchema.parse(await response.json());
  }
}
