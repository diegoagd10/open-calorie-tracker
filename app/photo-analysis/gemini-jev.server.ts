import { z } from "zod";
import {
  CatalogNotInstalledError,
  CatalogReimportRequiredError,
  CatalogUnavailableError,
} from "../catalog/food-catalog.server.ts";
import type {
  UsdaEvidence,
  UsdaPhotoAnalysisCatalog,
  UsdaPhotoAnalysisSnapshot,
} from "../catalog/usda-evidence.ts";
import type { PhotoAnalyzer, PlatePhoto } from "./photo-analysis.server.ts";
import {
  PHOTO_ANALYSIS_FALLBACK_REASONS,
  type PhotoAnalysisFallbackReason,
  type PhotoAnalysisFallbackReasonCode,
} from "./provenance.server.ts";
import { validatePhotoResult, type PhotoResult } from "./result.server.ts";

export type GeminiMealRequest = {
  model: string;
  photo: PlatePhoto;
  instruction: string;
  context: Record<string, unknown>;
};

export type GeminiMealClient = {
  analyzeMeal: (request: GeminiMealRequest, signal: AbortSignal) => Promise<unknown>;
};

export type JevChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

export type JevChoiceRequest = {
  model: string;
  state: unknown;
  questions: Record<string, JevChoiceQuestion>;
};

export type JevChoiceClient = {
  choose: (request: JevChoiceRequest, signal: AbortSignal) => Promise<unknown>;
};

export type GeminiJevChoiceDiagnostic = {
  choice: { key: string; label: string };
  confidence: number;
  selectedProbability: number;
  topCandidates: { key: string; label: string; probability: number }[];
};

export type GeminiJevAnalysis = {
  result: PhotoResult;
  evidence: UsdaEvidence[];
  diagnostics: {
    catalogGeneration: string;
    geminiModel: string;
    jevModel: string;
    categoryConfidenceThreshold: number;
    productConfidenceThreshold: number;
    components: {
      componentId: string;
      category: GeminiJevChoiceDiagnostic;
      product: GeminiJevChoiceDiagnostic | null;
      fallbackReason: PhotoAnalysisFallbackReason | null;
    }[];
  };
};

const noFoodSchema = z.object({ status: z.literal("no_food") }).strict();
const amount = z.number().finite().nonnegative().max(999_999.999);
const observedNutritionSchema = z.object({
  energyKcal: amount,
  proteinGrams: amount,
  carbohydrateGrams: amount,
  fatGrams: amount,
  fiberGrams: amount.nullable(),
  sugarGrams: amount.nullable(),
  sodiumMilligrams: amount.nullable(),
}).strict();
const foodObservationSchema = z.object({
  status: z.literal("food"),
  name: z.string().trim().min(1).max(200),
  consumedFraction: z.number().positive().max(1),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(8),
  components: z.array(z.object({
    id: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/u),
    name: z.string().trim().min(1).max(200),
    preparationEvidence: z.string().trim().min(1).max(500),
    quantityDescription: z.string().trim().min(1).max(200),
    grams: z.number().positive().max(10_000).nullable(),
    uncertainty: z.string().trim().min(1).max(500),
    assumptions: z.array(z.string().trim().min(1).max(500)).max(1),
    includes: z.array(z.string().trim().min(1).max(100)).max(30),
    nutrition: observedNutritionSchema,
  }).strict()).min(1).max(8),
}).strict();
// Keep Gemini's provider schema shallow enough for low-latency models. The HTTP
// adapter decodes this bounded JSON string before this module validates the full shape.
const providerComponentSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", description: "Short unique visible-component identifier." },
    name: { type: "string" },
    preparationEvidence: { type: "string" },
    quantityDescription: { type: "string" },
    grams: {
      anyOf: [{ type: "number", minimum: 0.000_001, maximum: 10_000 }, { type: "null" }],
      description: "Estimated grams for the full visible component before consumedFraction is applied, or null when indefensible.",
    },
    uncertainty: { type: "string" },
    assumptions: { type: "array", items: { type: "string" }, maxItems: 1 },
    includes: { type: "array", items: { type: "string" }, maxItems: 30 },
    nutrition: {
      type: "string",
      description: "JSON object with energyKcal, proteinGrams, carbohydrateGrams, fatGrams, fiberGrams, sugarGrams, and sodiumMilligrams totals for the full stated quantity; the last three may be null.",
    },
  },
  required: [
    "id",
    "name",
    "preparationEvidence",
    "quantityDescription",
    "grams",
    "uncertainty",
    "assumptions",
    "includes",
    "nutrition",
  ],
} as const;
export const GEMINI_MEAL_RESPONSE_JSON_SCHEMA = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: { status: { type: "string", enum: ["no_food"] } },
      required: ["status"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["food"] },
        name: { type: "string", description: "Concise description of the visible meal." },
        consumedFraction: {
          type: "number",
          minimum: 0.000_001,
          maximum: 1,
          description: "Fraction of the full visible meal that was consumed. Component quantities and nutrition remain pre-fraction totals.",
        },
        assumptions: { type: "array", items: { type: "string" }, maxItems: 8 },
        components: { type: "array", items: providerComponentSchema, minItems: 1, maxItems: 8 },
      },
      required: ["status", "name", "consumedFraction", "assumptions", "components"],
    },
  ],
} as const;

type FoodObservation = z.infer<typeof foodObservationSchema>;
const choiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string().min(1).max(100),
  confidence: z.number().finite().min(0).max(1),
  probabilities: z.record(z.string().min(1).max(100), z.number().finite().min(0).max(1)),
}).strict();
const jevResponseSchema = z.object({
  model: z.string().min(1).max(100),
  answers: z.record(z.string().min(1).max(100), choiceAnswerSchema),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }).passthrough(),
}).passthrough();

type ChoiceAnswer = z.infer<typeof choiceAnswerSchema>;
export type GeminiJevAnalyzerConfig = {
  geminiModel?: string;
  jevModel?: string;
  categoryConfidenceThreshold?: number;
  productConfidenceThreshold?: number;
  deadlineMs?: number;
};
const configSchema = z.object({
  geminiModel: z.string().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/u).default("gemini-3.1-flash-lite"),
  jevModel: z.string().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/u).default("jev-1.13.0"),
  categoryConfidenceThreshold: z.number().min(0).max(1).default(0),
  productConfidenceThreshold: z.number().min(0).max(1).default(0),
  deadlineMs: z.number().int().positive().max(5_000).default(5_000),
}).strict();

const instruction = `Describe only food or drink visibly present in the supplied image. Separate independently visible foods, but keep an inseparable prepared food together. Do not infer hidden ingredients, fats, seasonings, fillings, brands, or recipe ingredients. Never choose or invent a USDA FDC identity. Return the required structured observation and complete fallback nutrition for every visible component. Encode each component's nutrition as a JSON object inside the required nutrition string. consumedFraction is the fraction of the full visible meal that was consumed. Every component's quantity, grams, and fallback nutrition must describe its full visible portion before consumedFraction is applied. Nutrition values are totals for that stated component quantity, never values per 100 grams; the application applies consumedFraction exactly once.`;

export class GeminiJevPhotoAnalyzer implements PhotoAnalyzer {
  private readonly config: z.infer<typeof configSchema>;
  constructor(
    private readonly gemini: GeminiMealClient,
    private readonly jev: JevChoiceClient,
    private readonly catalog: UsdaPhotoAnalysisCatalog,
    config: GeminiJevAnalyzerConfig = {},
  ) {
    this.config = configSchema.parse(config);
  }

  async analyze(input: Parameters<PhotoAnalyzer["analyze"]>[0]): Promise<unknown> {
    const analysis = await this.analyzeWithDiagnostics(input);
    return {
      kind: "photo-analysis-outcome",
      ...analysis,
    };
  }

  configurationSnapshot() {
    return {
      geminiModel: this.config.geminiModel,
      jevModel: this.config.jevModel,
      categoryConfidenceThreshold: this.config.categoryConfidenceThreshold,
      productConfidenceThreshold: this.config.productConfidenceThreshold,
    };
  }

  async analyzeWithDiagnostics(input: Parameters<PhotoAnalyzer["analyze"]>[0]): Promise<GeminiJevAnalysis> {
    const deadline = analysisDeadline(input.signal, this.config.deadlineMs);
    try {
      return await abortable(this.analyzeBeforeDeadline({ ...input, signal: deadline.signal }), deadline.signal);
    } finally {
      deadline.dispose();
    }
  }

  private async analyzeBeforeDeadline(input: Parameters<PhotoAnalyzer["analyze"]>[0]): Promise<GeminiJevAnalysis> {
    input.signal.throwIfAborted();
    const context = geminiContext(input);
    const readiness = await this.catalog.photoAnalysisReadiness();
    input.signal.throwIfAborted();
    if (readiness.state === "not-installed") throw new CatalogNotInstalledError();
    if (readiness.state === "reimport-required") throw new CatalogReimportRequiredError();
    if (readiness.state === "unavailable") throw new CatalogUnavailableError();
    return await this.catalog.withPhotoAnalysisSnapshot(
      input.signal,
      async snapshot => await this.analyzeSnapshot(input, context, snapshot),
    );
  }

  private async analyzeSnapshot(
    input: Parameters<PhotoAnalyzer["analyze"]>[0],
    context: Record<string, unknown>,
    snapshot: UsdaPhotoAnalysisSnapshot,
  ): Promise<GeminiJevAnalysis> {
    input.signal.throwIfAborted();
    const observation = await this.gemini.analyzeMeal({
      model: this.config.geminiModel,
      photo: input.photo,
      instruction,
      context,
    }, input.signal);
    input.signal.throwIfAborted();
    if (noFoodSchema.safeParse(observation).success) {
      validatePhotoResult(observation, "gemini-jev-analysis", []);
    }
    const meal = foodObservationSchema.parse(observation);
    const state = matchingState(meal);
    const categoryRequest = buildCategoryRequest(meal, state, snapshot, this.config.jevModel);
    const categoryAnswers = await this.choices(categoryRequest, input.signal);
    const decisions = categoryDiagnostics(meal, categoryAnswers, categoryRequest.questions);
    const plan = planProductChoices(
      meal,
      categoryAnswers,
      snapshot,
      this.config.categoryConfidenceThreshold,
    );
    applyFallbackReasons(plan, decisions);
    input.recordDiagnostics?.(this.diagnostics(snapshot, decisions));
    const productAnswers = Object.keys(plan.questions).length === 0
      ? {}
      : await this.choices({ model: this.config.jevModel, state, questions: plan.questions }, input.signal);
    applyProductDecisions(plan, productAnswers, decisions, this.config.productConfidenceThreshold);
    input.recordDiagnostics?.(this.diagnostics(snapshot, decisions));
    const assembled = assembleComponents(meal, plan, productAnswers, decisions, snapshot);
    input.signal.throwIfAborted();
    const result = validatePhotoResult({
      name: meal.name,
      consumedFraction: meal.consumedFraction,
      assumptions: resultAssumptions(meal),
      components: assembled.components,
    }, "gemini-jev-analysis", assembled.evidence).result;
    return {
      result,
      evidence: assembled.evidence,
      diagnostics: this.diagnostics(snapshot, decisions),
    };
  }

  private diagnostics(
    snapshot: UsdaPhotoAnalysisSnapshot,
    components: GeminiJevAnalysis["diagnostics"]["components"],
  ): GeminiJevAnalysis["diagnostics"] {
    return {
      catalogGeneration: snapshot.generation,
      geminiModel: this.config.geminiModel,
      jevModel: this.config.jevModel,
      categoryConfidenceThreshold: this.config.categoryConfidenceThreshold,
      productConfidenceThreshold: this.config.productConfidenceThreshold,
      components,
    };
  }

  private async choices(request: JevChoiceRequest, signal: AbortSignal): Promise<Record<string, ChoiceAnswer>> {
    const response = jevResponseSchema.parse(await this.jev.choose(request, signal));
    signal.throwIfAborted();
    if (response.model !== request.model) throw new Error("Jev returned an unexpected model");
    const questionKeys = Object.keys(request.questions).sort();
    if (Object.keys(response.answers).sort().join("\0") !== questionKeys.join("\0")) {
      throw new Error("Jev omitted or invented an answer");
    }
    for (const key of questionKeys) validateAnswer(response.answers[key], request.questions[key]);
    return response.answers;
  }
}

type ProductPlan = {
  questions: JevChoiceRequest["questions"];
  candidates: Map<number, ReturnType<UsdaPhotoAnalysisSnapshot["candidates"]>>;
  fallbackReasons: Map<number, PhotoAnalysisFallbackReason>;
};

function buildCategoryRequest(
  meal: FoodObservation,
  state: ReturnType<typeof matchingState>,
  snapshot: UsdaPhotoAnalysisSnapshot,
  model: string,
): JevChoiceRequest {
  const categories = snapshot.categories();
  if (categories.length > 254) throw new CatalogUnavailableError();
  const criteria = {
    ...Object.fromEntries(categories.map(category => [`category_${category.id}`, category.name])),
    none: "No listed category adequately represents this visible food.",
  };
  return {
    model,
    state,
    questions: Object.fromEntries(meal.components.map((component, index) => [
      questionKey(index),
      {
        type: "choice" as const,
        instructions: `Choose the USDA Foundation category that best represents ${component.name}, or none when no category is adequate.`,
        criteria,
      },
    ])),
  };
}

function categoryDiagnostics(
  meal: FoodObservation,
  answers: Record<string, ChoiceAnswer>,
  questions: JevChoiceRequest["questions"],
): GeminiJevAnalysis["diagnostics"]["components"] {
  return meal.components.map((component, index) => ({
    componentId: component.id,
    category: choiceDiagnostic(answers[questionKey(index)], questions[questionKey(index)]),
    product: null,
    fallbackReason: null,
  }));
}

function planProductChoices(
  meal: FoodObservation,
  answers: Record<string, ChoiceAnswer>,
  snapshot: UsdaPhotoAnalysisSnapshot,
  confidenceThreshold: number,
): ProductPlan {
  const plan: ProductPlan = { questions: {}, candidates: new Map(), fallbackReasons: new Map() };
  for (const [index, component] of meal.components.entries()) {
    const answer = answers[questionKey(index)];
    if (answer.choice === "none") {
      plan.fallbackReasons.set(index, fallbackReason("category-none"));
      continue;
    }
    if (answer.confidence < confidenceThreshold) {
      plan.fallbackReasons.set(index, fallbackReason("category-low-confidence"));
      continue;
    }
    if (component.grams === null) {
      plan.fallbackReasons.set(index, fallbackReason("missing-grams"));
      continue;
    }
    const options = snapshot.candidates(answer.choice.replace(/^category_/u, ""));
    if (options.length === 0 || options.length > 254) {
      plan.fallbackReasons.set(index, fallbackReason("inadequate-candidates"));
      continue;
    }
    plan.candidates.set(index, options);
    plan.questions[questionKey(index)] = {
      type: "choice",
      instructions: `Choose the closest defensible USDA Foundation record for ${component.name}, or none when no record is adequate.`,
      criteria: {
        ...Object.fromEntries(options.map(candidate => [`food_${candidate.fdcId}`, candidate.description])),
        none: "No listed Foundation record adequately represents this visible food.",
      },
    };
  }
  return plan;
}

function applyProductDecisions(
  plan: ProductPlan,
  answers: Record<string, ChoiceAnswer>,
  decisions: GeminiJevAnalysis["diagnostics"]["components"],
  confidenceThreshold: number,
) {
  for (const index of plan.candidates.keys()) {
    const answer = answers[questionKey(index)];
    decisions[index].product = choiceDiagnostic(answer, plan.questions[questionKey(index)]);
    if (answer.choice === "none") {
      const reason = fallbackReason("product-none");
      plan.fallbackReasons.set(index, reason);
      decisions[index].fallbackReason = reason;
    } else if (answer.confidence < confidenceThreshold) {
      const reason = fallbackReason("product-low-confidence");
      plan.fallbackReasons.set(index, reason);
      decisions[index].fallbackReason = reason;
    }
  }
}

function applyFallbackReasons(
  plan: ProductPlan,
  decisions: GeminiJevAnalysis["diagnostics"]["components"],
) {
  for (const [index, reason] of plan.fallbackReasons) {
    decisions[index].fallbackReason = reason;
  }
}

function assembleComponents(
  meal: FoodObservation,
  plan: ProductPlan,
  answers: Record<string, ChoiceAnswer>,
  decisions: GeminiJevAnalysis["diagnostics"]["components"],
  snapshot: UsdaPhotoAnalysisSnapshot,
) {
  const evidence = new Map<string, UsdaEvidence>();
  const components = meal.components.map((component, index) => {
    const reason = plan.fallbackReasons.get(index);
    decisions[index].fallbackReason = reason ?? null;
    if (reason) return fallbackComponent(component, reason.message);
    const fdcId = answers[questionKey(index)].choice.replace(/^food_/u, "");
    if (!plan.candidates.get(index)?.some(candidate => candidate.fdcId === fdcId)) {
      throw new Error("Jev selected an unavailable USDA record");
    }
    evidence.set(fdcId, snapshot.evidence(fdcId));
    return {
      id: component.id,
      name: component.name,
      quantity: component.grams!,
      unit: "g" as const,
      includes: component.includes,
      source: { kind: "usda" as const, fdcId },
    };
  });
  return { components, evidence: [...evidence.values()] };
}

function fallbackReason(
  code: PhotoAnalysisFallbackReasonCode,
): PhotoAnalysisFallbackReason {
  return PHOTO_ANALYSIS_FALLBACK_REASONS[code];
}

function geminiContext(input: Parameters<PhotoAnalyzer["analyze"]>[0]): Record<string, unknown> {
  try {
    z.object({
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      bytes: z.instanceof(Buffer).refine(value => value.length > 0 && value.length <= 10_000_000),
      correction: z.string().trim().min(1).max(2_000).optional(),
      previousCorrections: z.array(z.string().trim().min(1).max(2_000)).max(10),
    }).parse({ ...input.photo, correction: input.correction, previousCorrections: input.previousCorrections });
    const context = {
      ...(input.correction === undefined ? {} : { correction: input.correction }),
      previousCorrections: input.previousCorrections,
      ...(input.currentResult === undefined ? {} : { currentResult: input.currentResult }),
      ...(input.currentEntry === undefined ? {} : { currentEntry: input.currentEntry }),
      evidence: input.evidence,
    };
    const serialized = JSON.stringify(context);
    if (serialized.length > 100_000) throw new Error("oversized");
    return context;
  } catch {
    throw new Error("Gemini context is invalid or too large");
  }
}

function analysisDeadline(parent: AbortSignal, milliseconds: number) {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(parent.reason ?? new Error("Photo analysis canceled"));
  if (parent.aborted) forwardAbort();
  else parent.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Photo analysis timed out")), milliseconds);
  timer.unref();
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", forwardAbort);
    },
  };
}

async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) void work.catch(() => undefined);
  signal.throwIfAborted();
  return await new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason instanceof Error ? signal.reason : new Error("Photo analysis canceled"));
    signal.addEventListener("abort", aborted, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

function questionKey(index: number) {
  return `component_${index}`;
}

function matchingState(meal: FoodObservation) {
  return {
    meal: meal.name,
    components: meal.components.map(({ id, name, preparationEvidence, quantityDescription, grams, uncertainty, assumptions }) => ({
      id,
      name,
      preparationEvidence,
      quantityDescription,
      grams,
      uncertainty,
      assumptions,
    })),
  };
}

function resultAssumptions(meal: FoodObservation) {
  return [
    ...meal.assumptions,
    ...meal.components.flatMap(component => [
      `${component.name}: ${component.preparationEvidence}`,
      `${component.name}: ${component.quantityDescription}`,
      `${component.name}: ${component.uncertainty}`,
      ...component.assumptions.map(assumption => `${component.name}: ${assumption}`),
    ]),
  ];
}

function fallbackComponent(component: FoodObservation["components"][number], reason: string) {
  return {
    id: component.id,
    name: component.name,
    quantity: 1,
    unit: "serving" as const,
    includes: component.includes,
    source: { kind: "ai" as const, reason },
    nutrition: component.nutrition,
  };
}

function choiceDiagnostic(answer: ChoiceAnswer, question: JevChoiceQuestion): GeminiJevChoiceDiagnostic {
  const candidates = Object.entries(answer.probabilities)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, probability]) => ({ key, label: question.criteria[key], probability }));
  const selected = candidates.find(({ key }) => key === answer.choice)!;
  const topCandidates = [
    selected,
    ...candidates.filter(({ key }) => key !== answer.choice).slice(0, 4),
  ].sort(
    (left, right) =>
      right.probability - left.probability || left.key.localeCompare(right.key),
  );
  return {
    choice: { key: answer.choice, label: question.criteria[answer.choice] },
    confidence: answer.confidence,
    selectedProbability: answer.probabilities[answer.choice],
    topCandidates,
  };
}

function validateAnswer(answer: ChoiceAnswer, question: JevChoiceQuestion) {
  const criteria = Object.keys(question.criteria).sort();
  const probabilities = Object.keys(answer.probabilities).sort();
  if (criteria.join("\0") !== probabilities.join("\0") || !criteria.includes(answer.choice)) {
    throw new Error("Jev returned choices outside the supplied criteria");
  }
  const values = Object.values(answer.probabilities);
  const total = values.reduce((sum, probability) => sum + probability, 0);
  if (Math.abs(total - 1) > 0.001 || answer.probabilities[answer.choice] !== Math.max(...values)) {
    throw new Error("Jev returned an invalid probability distribution");
  }
}
