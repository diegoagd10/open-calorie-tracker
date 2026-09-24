import { afterEach, expect, test, vi } from "vitest";
import {
  CatalogNotInstalledError,
  CatalogReimportRequiredError,
  CatalogUnavailableError,
} from "../app/catalog/food-catalog.server";
import type { UsdaEvidence, UsdaPhotoAnalysisCatalog } from "../app/catalog/usda-evidence";
import type { PhotoAnalyzer } from "../app/photo-analysis/photo-analysis.server";
import {
  GeminiJevPhotoAnalyzer,
  type GeminiMealClient,
  type JevChoiceClient,
  type JevChoiceRequest,
} from "../app/photo-analysis/gemini-jev.server";
import { photoAnalysisDiagnosticsSchema } from "../app/photo-analysis/provenance.server";
import { NoFoodDetectedError } from "../app/photo-analysis/result.server";

afterEach(() => { vi.useRealTimers(); });

function analyzerInput(): Parameters<PhotoAnalyzer["analyze"]>[0] {
  return {
    photo: { bytes: Buffer.from([137, 80, 78, 71]), mimeType: "image/png" },
    signal: new AbortController().signal,
    previousCorrections: [],
    evidence: [],
    usda: {
      search: async () => [],
      detail: async () => { throw new Error("unused legacy catalog seam"); },
    },
  };
}

function geminiMock(implementation?: GeminiMealClient["analyzeMeal"]) {
  return implementation === undefined
    ? vi.fn<GeminiMealClient["analyzeMeal"]>()
    : vi.fn<GeminiMealClient["analyzeMeal"]>(implementation);
}

function jevMock(implementation?: JevChoiceClient["choose"]) {
  return implementation === undefined
    ? vi.fn<JevChoiceClient["choose"]>()
    : vi.fn<JevChoiceClient["choose"]>(implementation);
}

test("a strict Gemini no-food observation performs no Jev work and uses the existing outcome", async () => {
  const gemini: GeminiMealClient = {
    analyzeMeal: geminiMock(async request => {
      expect(request.photo).toEqual(analyzerInput().photo);
      expect(request.context).toEqual({ previousCorrections: [], evidence: [] });
      expect(request.instruction).toContain("Do not infer hidden ingredients");
      expect(request.instruction).toContain("one component for each independently quantifiable visible food");
      expect(request.instruction).toContain("Mixed together is not inseparable when the individual foods remain visually distinguishable");
      expect(request.instruction).toContain("Each component name must represent one visible food identity");
      expect(request.instruction).toContain("Do not join multiple visible, separately quantifiable foods in one component name");
      expect(request.instruction).toContain("Cooking foods together is never, by itself, a reason to merge them");
      expect(request.instruction).toContain("If you can describe or estimate a visible constituent's amount, return it as its own component");
      expect(request.instruction).toContain("use a generic visible identity and explain the ambiguity");
      for (const hardcodedFood of ["egg", "potato", "refried beans"]) {
        expect(request.instruction.toLocaleLowerCase()).not.toContain(hardcodedFood);
      }
      expect(request.instruction).toContain("Never assume that a cooking fat was used");
      expect(request.instruction).toContain("full visible portion before consumedFraction is applied");
      expect(request.instruction).toContain("never values per 100 grams");
      return { status: "no_food" };
    }),
  };
  const jev: JevChoiceClient = { choose: jevMock() };
  const catalog: UsdaPhotoAnalysisCatalog = {
    photoAnalysisReadiness: vi.fn(async () => ({ state: "ready" as const, generation: "generation-one" })),
    withPhotoAnalysisSnapshot: async (_signal, read) => await read({
      generation: "generation-one",
      categories: () => [{ id: "1", name: "Dairy and Egg Products" }],
      candidates: () => [],
      evidence: () => { throw new Error("unused evidence"); },
    }),
  };
  const analyzer: PhotoAnalyzer = new GeminiJevPhotoAnalyzer(gemini, jev, catalog);

  await expect(analyzer.analyze(analyzerInput())).rejects.toBeInstanceOf(NoFoodDetectedError);
  expect(catalog.photoAnalysisReadiness).toHaveBeenCalledOnce();
  expect(gemini.analyzeMeal).toHaveBeenCalledOnce();
  expect(jev.choose).not.toHaveBeenCalled();
});

function foundationEvidence(): UsdaEvidence {
  return {
    food: {
      authoritativeBaseQuantityMicrounits: 100_000_000,
      authoritativeBaseUnit: "g",
      barcode: null,
      brand: null,
      catalogGeneration: "generation-one",
      dataType: "Foundation",
      isSelectable: true,
      marketCountry: null,
      measurementSummary: "100 g",
      measurements: [{ id: "100g", label: "100 g", unit: "g", baseQuantityMicrounits: 100_000_000 }],
      name: "Eggs, whole, raw",
      nutritionPerAuthoritativeBase: {
        energyMilliKcal: { amount: 100, fixedPointMultiplier: 1000 },
        proteinMilligrams: { amount: 10, fixedPointMultiplier: 1000 },
        carbohydrateMilligrams: { amount: 2, fixedPointMultiplier: 1000 },
        fatMilligrams: { amount: 5, fixedPointMultiplier: 1000 },
        fiberMilligrams: null,
        sugarMilligrams: { amount: 0, fixedPointMultiplier: 1000 },
        sodiumMilligrams: { amount: 120, fixedPointMultiplier: 1 },
      },
      originalName: "Eggs, whole, raw",
      provider: "usda-fdc",
      providerFoodId: "100",
      providerModifiedDate: null,
      providerPublishedDate: "2026-01-01",
    },
    record: { fdcId: 100, description: "Eggs, whole, raw" },
  };
}

function observedMeal() {
  return {
    status: "food",
    name: "Egg breakfast",
    consumedFraction: 0.5,
    assumptions: ["The full visible serving is represented before the consumed fraction."],
    components: [{
      id: "visible-eggs",
      name: "Scrambled eggs",
      preparationEvidence: "Visible soft curds consistent with scrambled eggs.",
      quantityDescription: "About two eggs",
      grams: 150,
      uncertainty: "Plate scale is approximate.",
      assumptions: ["No hidden cooking fat was added."],
      includes: [],
      nutrition: {
        energyKcal: 999,
        proteinGrams: 99,
        carbohydrateGrams: 99,
        fatGrams: 99,
        fiberGrams: null,
        sugarGrams: null,
        sodiumMilligrams: null,
      },
    }],
  };
}

test("a compound visible-food identity gets one bounded Gemini correction before matching", async () => {
  const compoundMeal = {
    ...observedMeal(),
    components: [{
      ...observedMeal().components[0],
      name: "visible base with visible pieces",
      quantityDescription: "one portion of the base with a separately estimated portion of pieces",
    }],
  };
  const gemini: GeminiMealClient = {
    analyzeMeal: geminiMock()
      .mockResolvedValueOnce(compoundMeal)
      .mockResolvedValueOnce(observedMeal()),
  };
  let stage = 0;
  const jev: JevChoiceClient = {
    choose: jevMock(async () => {
      stage++;
      return stage === 1
        ? choiceResponse("category_1", ["category_1", "none"])
        : choiceResponse("food_100", ["food_100", "none"]);
    }),
  };

  await expect(new GeminiJevPhotoAnalyzer(gemini, jev, readyCatalog()).analyze(analyzerInput()))
    .resolves.toMatchObject({ result: { components: [{ name: "Scrambled eggs" }] } });

  expect(gemini.analyzeMeal).toHaveBeenCalledTimes(2);
  const correction = vi.mocked(gemini.analyzeMeal).mock.calls[1][0];
  expect(correction.instruction).toContain("Correction required");
  expect(correction.instruction).toContain("one revised component per independently quantifiable visible food");
  expect(correction.context).toMatchObject({
    rejectedCompoundComponentIdentities: ["visible base with visible pieces"],
  });
});

function readyCatalog(overrides: Partial<{
  categories: () => { id: string; name: string }[];
  candidates: (categoryId: string) => { fdcId: string; description: string }[];
  evidence: (fdcId: string) => UsdaEvidence;
}> = {}): UsdaPhotoAnalysisCatalog {
  return {
    photoAnalysisReadiness: vi.fn(async () => ({ state: "ready" as const, generation: "generation-one" })),
    withPhotoAnalysisSnapshot: async (_signal, read) => await read({
      generation: "generation-one",
      categories: overrides.categories ?? (() => [{ id: "1", name: "Dairy and Egg Products" }]),
      candidates: overrides.candidates ?? (() => [{ fdcId: "100", description: "Eggs, whole, raw" }]),
      evidence: overrides.evidence ?? (() => foundationEvidence()),
    }),
  };
}

function choiceResponse(choice: string, criteria: string[], overrides: Record<string, unknown> = {}) {
  const probabilities = Object.fromEntries(criteria.map(key => [key, key === choice ? 0.9 : 0.1 / (criteria.length - 1)]));
  return {
    model: "jev-1.13.0",
    answers: {
      component_0: { type: "choice", choice, confidence: 0.9, probabilities, ...overrides },
    },
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

test("one leased generation supplies both Jev stages and authoritative USDA nutrition", async () => {
  const evidence = foundationEvidence();
  const gemini: GeminiMealClient = { analyzeMeal: geminiMock(async () => observedMeal()) };
  const calls: JevChoiceRequest[] = [];
  const jev: JevChoiceClient = {
    choose: jevMock(async request => {
      calls.push(request);
      const choice = calls.length === 1 ? "category_1" : "food_100";
      return {
        model: "jev-1.13.0",
        answers: {
          component_0: {
            type: "choice",
            choice,
            confidence: 0.9,
            probabilities: { [choice]: 0.9, none: 0.1 },
          },
        },
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    }),
  };
  const catalog: UsdaPhotoAnalysisCatalog = {
    photoAnalysisReadiness: async () => ({ state: "ready", generation: "generation-one" }),
    withPhotoAnalysisSnapshot: async (_signal, read) => await read({
      generation: "generation-one",
      categories: () => [{ id: "1", name: "Dairy and Egg Products" }],
      candidates: (categoryId: string) => categoryId === "1" ? [{ fdcId: "100", description: "Eggs, whole, raw" }] : [],
      evidence: (fdcId: string) => {
        expect(fdcId).toBe("100");
        return evidence;
      },
    }),
  };
  const analyzer: PhotoAnalyzer = new GeminiJevPhotoAnalyzer(gemini, jev, catalog, {
    geminiModel: "gemini-3.1-flash-lite",
    jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: 0,
    productConfidenceThreshold: 0,
  });

  const outcome = await analyzer.analyze(analyzerInput()) as {
    result: unknown;
  };

  expect(outcome.result).toMatchObject({
    name: "Egg breakfast",
    consumedFraction: 0.5,
    assumptions: [
      "The full visible serving is represented before the consumed fraction.",
      "Scrambled eggs: Visible soft curds consistent with scrambled eggs.",
      "Scrambled eggs: About two eggs",
      "Scrambled eggs: Plate scale is approximate.",
      "Scrambled eggs: No hidden cooking fat was added.",
    ],
    components: [{
      id: "visible-eggs",
      quantity: 150,
      unit: "g",
      source: { kind: "usda", fdcId: "100", dataType: "Foundation" },
      nutrition: {
        energyKcal: 150,
        proteinGrams: 15,
        carbohydrateGrams: 3,
        fatGrams: 7.5,
        fiberGrams: null,
        sugarGrams: 0,
        sodiumMilligrams: 180,
      },
    }],
  });
  expect(jev.choose).toHaveBeenCalledTimes(2);
  expect(calls[0]).toMatchObject({
    model: "jev-1.13.0",
    questions: { component_0: { type: "choice", criteria: {
      category_1: "Dairy and Egg Products",
      none: "No listed category adequately represents this visible food.",
    } } },
  });
  expect(calls[1]).toMatchObject({
    questions: { component_0: {
      criteria: {
        food_100: "Eggs, whole, raw",
        none: "No listed record has the same base food identity as this visible component.",
      },
    } },
  });
  expect(calls[1].questions.component_0.instructions).toContain(
    "Do not choose none merely because raw and cooked preparation differ",
  );
  expect(JSON.stringify(calls)).not.toContain(analyzerInput().photo.bytes.toString("base64"));
});

test("the analyzer exposes bounded validated matching decisions for later persistence", async () => {
  let stage = 0;
  const gemini: GeminiMealClient = { analyzeMeal: geminiMock(async () => observedMeal()) };
  const jev: JevChoiceClient = {
    choose: jevMock(async () => {
      stage++;
      return stage === 1
        ? choiceResponse("category_1", ["category_1", "none"], {
            probabilities: { category_1: 0.5, none: 0.5 },
          })
        : choiceResponse("food_100", ["food_100", "none"]);
    }),
  };
  const analyzer = new GeminiJevPhotoAnalyzer(gemini, jev, readyCatalog());

  const analysis = await analyzer.analyzeWithDiagnostics(analyzerInput());

  expect(analysis.diagnostics).toEqual({
    catalogGeneration: "generation-one",
    geminiModel: "gemini-3.1-flash-lite",
    jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: 0,
    productConfidenceThreshold: 0,
    components: [{
      componentId: "visible-eggs",
      category: {
        choice: { key: "category_1", label: "Dairy and Egg Products" },
        confidence: 0.9,
        selectedProbability: 0.5,
        topCandidates: analysis.diagnostics.components[0].category.topCandidates,
      },
      product: {
        choice: { key: "food_100", label: "Eggs, whole, raw" },
        confidence: 0.9,
        selectedProbability: 0.9,
        topCandidates: analysis.diagnostics.components[0].product?.topCandidates,
      },
      fallbackReason: null,
    }],
  });
  expect(analysis.diagnostics.components[0].category.topCandidates).toContainEqual(
    { key: "category_1", label: "Dairy and Egg Products", probability: 0.5 },
  );
  expect(analysis.diagnostics.components[0].product?.topCandidates).toContainEqual(
    { key: "food_100", label: "Eggs, whole, raw", probability: 0.9 },
  );
  expect(analysis.evidence).toHaveLength(1);
  expect(JSON.stringify(analysis.diagnostics)).not.toContain(analyzerInput().photo.bytes.toString("base64"));
});

test("bounded tied candidates always retain the selected choice", async () => {
  const categories = Array.from({ length: 6 }, (_, index) => ({
    id: String(index + 1),
    name: `Category ${index + 1}`,
  }));
  const categoryKeys = [...categories.map(({ id }) => `category_${id}`), "none"];
  const tiedProbability = 1 / categoryKeys.length;
  let stage = 0;
  const analyzer = new GeminiJevPhotoAnalyzer(
    { analyzeMeal: geminiMock(async () => observedMeal()) },
    {
      choose: jevMock(async () => {
        stage++;
        return stage === 1
          ? choiceResponse("category_6", categoryKeys, {
              probabilities: Object.fromEntries(
                categoryKeys.map((key) => [key, tiedProbability]),
              ),
            })
          : choiceResponse("food_100", ["food_100", "none"]);
      }),
    },
    readyCatalog({
      categories: () => categories,
      candidates: (categoryId) =>
        categoryId === "6"
          ? [{ fdcId: "100", description: "Eggs, whole, raw" }]
          : [],
    }),
  );

  const analysis = await analyzer.analyzeWithDiagnostics(analyzerInput());

  expect(analysis.diagnostics.components[0].category.topCandidates).toHaveLength(5);
  expect(analysis.diagnostics.components[0].category.topCandidates).toContainEqual({
    key: "category_6",
    label: "Category 6",
    probability: tiedProbability,
  });
});

test("Jev probability rounding does not reject an otherwise valid choice", async () => {
  let stage = 0;
  const analyzer = new GeminiJevPhotoAnalyzer(
    { analyzeMeal: geminiMock(async () => observedMeal()) },
    {
      choose: jevMock(async () => {
        stage++;
        return stage === 1
          ? choiceResponse("category_1", ["category_1", "none"], {
              probabilities: { category_1: 0.89, none: 0.1 },
            })
          : choiceResponse("food_100", ["food_100", "none"]);
      }),
    },
    readyCatalog(),
  );

  await expect(analyzer.analyze(analyzerInput())).resolves.toMatchObject({
    result: { components: [{ source: { kind: "usda", fdcId: "100" } }] },
  });
});

test("none, low confidence, missing grams, and a valid match produce one complete mixed meal", async () => {
  const evidence = foundationEvidence();
  const base = observedMeal().components[0];
  const components = [
    { ...base, id: "category-none", name: "Category none" },
    { ...base, id: "category-low", name: "Category low" },
    { ...base, id: "missing-grams", name: "Missing grams", grams: null },
    { ...base, id: "product-none", name: "Product none" },
    { ...base, id: "product-low", name: "Product low" },
    { ...base, id: "usda-match", name: "Closest base match" },
  ];
  const gemini: GeminiMealClient = {
    analyzeMeal: async () => ({ ...observedMeal(), name: "Mixed meal", consumedFraction: 1, components }),
  };
  let stage = 0;
  const requestQuestionKeys: string[][] = [];
  const jev: JevChoiceClient = {
    choose: jevMock(async request => {
      stage++;
      requestQuestionKeys.push(Object.keys(request.questions));
      if (stage === 1) {
        return {
          model: "jev-1.13.0",
          answers: Object.fromEntries(components.map((_component, index) => {
            const none = index === 0;
            const confidence = index === 1 ? 0.2 : 0.9;
            return [`component_${index}`, {
              type: "choice",
              choice: none ? "none" : "category_1",
              confidence,
              probabilities: none ? { category_1: 0.1, none: 0.9 } : { category_1: 0.9, none: 0.1 },
            }];
          })),
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      }
      return {
        model: "jev-1.13.0",
        answers: {
          component_3: { type: "choice", choice: "none", confidence: 0.9, probabilities: { food_100: 0.1, none: 0.9 } },
          component_4: { type: "choice", choice: "food_100", confidence: 0.2, probabilities: { food_100: 0.9, none: 0.1 } },
          component_5: { type: "choice", choice: "food_100", confidence: 0.9, probabilities: { food_100: 0.9, none: 0.1 } },
        },
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    }),
  };
  const catalog: UsdaPhotoAnalysisCatalog = {
    photoAnalysisReadiness: async () => ({ state: "ready", generation: "generation-one" }),
    withPhotoAnalysisSnapshot: async (_signal, read) => await read({
      generation: "generation-one",
      categories: () => [{ id: "1", name: "Dairy and Egg Products" }],
      candidates: () => [{ fdcId: "100", description: "Eggs, whole, raw" }],
      evidence: () => evidence,
    }),
  };
  const analyzer = new GeminiJevPhotoAnalyzer(gemini, jev, catalog, {
    categoryConfidenceThreshold: 0.5,
    productConfidenceThreshold: 0.5,
  });

  const analysis = await analyzer.analyzeWithDiagnostics(analyzerInput());
  const result = analysis.result as typeof analysis.result & {
    components: { source: { kind: string; reason?: string }; nutrition: Record<string, number | null> }[];
  };

  expect(requestQuestionKeys).toEqual([
    ["component_0", "component_1", "component_2", "component_3", "component_4", "component_5"],
    ["component_3", "component_4", "component_5"],
  ]);
  expect(analysis.diagnostics.components.slice(0, 5).map(component => component.fallbackReason?.code)).toEqual([
    "category-none",
    "category-low-confidence",
    "missing-grams",
    "product-none",
    "product-low-confidence",
  ]);
  expect(result.components).toHaveLength(6);
  expect(result.components.slice(0, 5).map(component => component.source)).toEqual([
    { kind: "ai", reason: "No USDA category adequately matched the visible component." },
    { kind: "ai", reason: "USDA category confidence was below the configured threshold." },
    { kind: "ai", reason: "Gemini could not provide a defensible gram estimate." },
    { kind: "ai", reason: "No USDA record adequately matched the visible component." },
    { kind: "ai", reason: "USDA record confidence was below the configured threshold." },
  ]);
  expect(result.components[0].nutrition).toEqual(components[0].nutrition);
  expect(result.components[0].nutrition.fiberGrams).toBeNull();
  expect(result.components[5]).toMatchObject({
    source: { kind: "usda", fdcId: "100" },
    nutrition: { energyKcal: 150, fiberGrams: null, sugarGrams: 0 },
  });
});

test.each([
  [{ state: "not-installed" }, CatalogNotInstalledError],
  [{ state: "reimport-required", generation: "generation-one" }, CatalogReimportRequiredError],
  [{ state: "unavailable", generation: "generation-one" }, CatalogUnavailableError],
] as const)("catalog readiness $0.state fails before provider dispatch", async (readiness, ExpectedError) => {
  let snapshotCalled = false;
  const gemini: GeminiMealClient = { analyzeMeal: geminiMock() };
  const jev: JevChoiceClient = { choose: jevMock() };
  const catalog: UsdaPhotoAnalysisCatalog = {
    photoAnalysisReadiness: vi.fn(async () => readiness),
    withPhotoAnalysisSnapshot: async () => {
      snapshotCalled = true;
      throw new Error("snapshot must not be acquired");
    },
  };

  await expect(new GeminiJevPhotoAnalyzer(gemini, jev, catalog).analyze(analyzerInput()))
    .rejects.toBeInstanceOf(ExpectedError);
  expect(snapshotCalled).toBe(false);
  expect(gemini.analyzeMeal).not.toHaveBeenCalled();
  expect(jev.choose).not.toHaveBeenCalled();
});

test.each([
  ["an invented FDC identity", () => ({ ...observedMeal(), fdcId: "999" })],
  ["more than eight components", () => ({ ...observedMeal(), components: Array.from({ length: 9 }, (_, index) => ({ ...observedMeal().components[0], id: `food-${index}` })) })],
  ["incomplete fallback nutrition", () => {
    const meal = observedMeal();
    const { proteinGrams: _missing, ...nutrition } = meal.components[0].nutrition;
    return { ...meal, components: [{ ...meal.components[0], nutrition }] };
  }],
  ["too many component assumptions", () => {
    const meal = observedMeal();
    return { ...meal, components: [{ ...meal.components[0], assumptions: ["First", "Second"] }] };
  }],
] as const)("malformed Gemini output with %s fails the whole analysis", async (_case, response) => {
  const gemini: GeminiMealClient = { analyzeMeal: geminiMock(async () => response()) };
  const jev: JevChoiceClient = { choose: jevMock() };

  await expect(new GeminiJevPhotoAnalyzer(gemini, jev, readyCatalog()).analyze(analyzerInput())).rejects.toThrow();
  expect(gemini.analyzeMeal).toHaveBeenCalledOnce();
  expect(jev.choose).not.toHaveBeenCalled();
});

test.each([
  ["unexpected model", () => ({ ...choiceResponse("category_1", ["category_1", "none"]), model: "jev-invented" })],
  ["omitted answer", () => ({ ...choiceResponse("category_1", ["category_1", "none"]), answers: {} })],
  ["invented answer", () => {
    const response = choiceResponse("category_1", ["category_1", "none"]);
    return { ...response, answers: { ...response.answers, component_7: response.answers.component_0 } };
  }],
  ["cross-category choice", () => choiceResponse("category_2", ["category_1", "none"], { probabilities: { category_1: 0.1, category_2: 0.8, none: 0.1 } })],
  ["omitted probability", () => choiceResponse("category_1", ["category_1", "none"], { probabilities: { category_1: 1 } })],
  ["materially incomplete probability distribution", () => choiceResponse("category_1", ["category_1", "none"], { probabilities: { category_1: 0.6, none: 0.1 } })],
  ["invalid probability winner", () => choiceResponse("category_1", ["category_1", "none"], { probabilities: { category_1: 0.4, none: 0.6 } })],
  ["oversized confidence", () => choiceResponse("category_1", ["category_1", "none"], { confidence: 2 })],
] as const)("Jev output with an %s cannot become USDA evidence", async (_case, response) => {
  const gemini: GeminiMealClient = { analyzeMeal: geminiMock(async () => observedMeal()) };
  const jev: JevChoiceClient = { choose: jevMock(async () => response()) };
  const evidence = vi.fn(() => foundationEvidence());

  await expect(new GeminiJevPhotoAnalyzer(gemini, jev, readyCatalog({ evidence })).analyze(analyzerInput())).rejects.toThrow();
  expect(jev.choose).toHaveBeenCalledOnce();
  expect(evidence).not.toHaveBeenCalled();
});

test("a candidate removed after the exact Jev request cannot become evidence", async () => {
  const candidates = [{ fdcId: "100", description: "Eggs, whole, raw" }];
  let stage = 0;
  const jev: JevChoiceClient = {
    choose: jevMock(async () => {
      stage++;
      if (stage === 1) return choiceResponse("category_1", ["category_1", "none"]);
      candidates.length = 0;
      return choiceResponse("food_100", ["food_100", "none"]);
    }),
  };
  const evidence = vi.fn(() => foundationEvidence());
  const catalog = readyCatalog({ candidates: () => candidates, evidence });

  await expect(new GeminiJevPhotoAnalyzer(
    { analyzeMeal: geminiMock(async () => observedMeal()) },
    jev,
    catalog,
  ).analyze(analyzerInput())).rejects.toThrow("Jev selected an unavailable USDA record");
  expect(evidence).not.toHaveBeenCalled();
});

test("an oversized candidate category becomes an explicit Gemini estimate", async () => {
  const gemini: GeminiMealClient = { analyzeMeal: geminiMock(async () => observedMeal()) };
  const jev: JevChoiceClient = {
    choose: jevMock(async () => choiceResponse("category_1", ["category_1", "none"])),
  };
  const evidence = vi.fn(() => foundationEvidence());
  const catalog = readyCatalog({
    candidates: () => Array.from({ length: 255 }, (_, index) => ({ fdcId: String(index + 1), description: `Candidate ${index + 1}` })),
    evidence,
  });

  const outcome = await new GeminiJevPhotoAnalyzer(gemini, jev, catalog).analyze(analyzerInput()) as {
    result: { components: { source: unknown }[] };
  };

  expect(outcome.result.components[0].source).toEqual({
    kind: "ai",
    reason: "No adequate USDA candidate was available in the selected category.",
  });
  expect(jev.choose).toHaveBeenCalledOnce();
  expect(evidence).not.toHaveBeenCalled();
});

test.each(["gemini", "jev"] as const)("a %s provider failure fails the whole analysis without retry", async provider => {
  const providerError = new Error("provider unavailable");
  const gemini: GeminiMealClient = {
    analyzeMeal: geminiMock(async () => {
      if (provider === "gemini") throw providerError;
      return observedMeal();
    }),
  };
  const jev: JevChoiceClient = {
    choose: jevMock(async () => { throw providerError; }),
  };

  await expect(new GeminiJevPhotoAnalyzer(gemini, jev, readyCatalog()).analyze(analyzerInput())).rejects.toBe(providerError);
  expect(gemini.analyzeMeal).toHaveBeenCalledOnce();
  expect(jev.choose).toHaveBeenCalledTimes(provider === "jev" ? 1 : 0);
});

test("a product-stage failure reports the completed category decision", async () => {
  const providerError = new Error("provider unavailable");
  let stage = 0;
  const jev: JevChoiceClient = {
    choose: jevMock(async () => {
      stage++;
      if (stage === 1) {
        return choiceResponse("category_1", ["category_1", "none"]);
      }
      throw providerError;
    }),
  };
  const recordDiagnostics = vi.fn<(diagnostics: unknown) => void>();
  const input = { ...analyzerInput(), recordDiagnostics };

  await expect(new GeminiJevPhotoAnalyzer(
    { analyzeMeal: geminiMock(async () => observedMeal()) },
    jev,
    readyCatalog(),
  ).analyze(input)).rejects.toBe(providerError);

  expect(recordDiagnostics.mock.calls).toHaveLength(1);
  const recorded = photoAnalysisDiagnosticsSchema.parse(
    recordDiagnostics.mock.calls[0][0],
  );
  expect(recorded.catalogGeneration).toBe("generation-one");
  expect(recorded.components).toHaveLength(1);
  expect(recorded.components[0]).toMatchObject({
    componentId: "visible-eggs",
    product: null,
    fallbackReason: null,
  });
  expect(recorded.components[0].category.choice).toEqual({
    key: "category_1",
    label: "Dairy and Egg Products",
  });
});

test("the ten-second default cancels ignored provider work without retrying", async () => {
  vi.useFakeTimers();
  let providerSignal: AbortSignal | undefined;
  let catalogSignal: AbortSignal | undefined;
  const gemini: GeminiMealClient = {
    analyzeMeal: geminiMock(async (_request, signal) => {
      providerSignal = signal;
      await new Promise(resolve => setTimeout(resolve, 11_000));
      return { status: "no_food" };
    }),
  };
  const jev: JevChoiceClient = { choose: jevMock() };
  const catalog: UsdaPhotoAnalysisCatalog = {
    photoAnalysisReadiness: async () => ({ state: "ready", generation: "generation-one" }),
    withPhotoAnalysisSnapshot: async (signal, read) => {
      catalogSignal = signal;
      return await read({
        generation: "generation-one",
        categories: () => [],
        candidates: () => [],
        evidence: () => { throw new Error("unused evidence"); },
      });
    },
  };
  const analyzer: PhotoAnalyzer = new GeminiJevPhotoAnalyzer(gemini, jev, catalog);

  const pending = analyzer.analyze(analyzerInput());
  const rejection = pending.then(() => null, (error: unknown) => error);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(providerSignal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(5_000);

  await expect(rejection).resolves.toMatchObject({ message: "Photo analysis timed out" });
  expect(providerSignal).toBe(catalogSignal);
  expect(providerSignal?.aborted).toBe(true);
  expect(gemini.analyzeMeal).toHaveBeenCalledOnce();
  expect(jev.choose).not.toHaveBeenCalled();
});

test("oversized application context is rejected before provider dispatch", async () => {
  const gemini: GeminiMealClient = { analyzeMeal: geminiMock(async () => ({ status: "no_food" })) };
  const jev: JevChoiceClient = { choose: jevMock() };
  const catalog: UsdaPhotoAnalysisCatalog = {
    photoAnalysisReadiness: async () => ({ state: "ready", generation: "generation-one" }),
    withPhotoAnalysisSnapshot: async (_signal, read) => await read({
      generation: "generation-one",
      categories: () => [],
      candidates: () => [],
      evidence: () => { throw new Error("unused evidence"); },
    }),
  };
  const analyzer: PhotoAnalyzer = new GeminiJevPhotoAnalyzer(gemini, jev, catalog);

  await expect(analyzer.analyze({
    ...analyzerInput(),
    correction: "x".repeat(2_001),
    currentResult: { padding: "x".repeat(100_001) },
  })).rejects.toThrow("Gemini context is invalid or too large");
  expect(gemini.analyzeMeal).not.toHaveBeenCalled();
  expect(jev.choose).not.toHaveBeenCalled();
});

test("bounded correction and current-state context reaches Gemini intact", async () => {
  let capturedContext: Record<string, unknown> | undefined;
  const gemini: GeminiMealClient = {
    analyzeMeal: geminiMock(async request => {
      capturedContext = request.context;
      return { status: "no_food" };
    }),
  };
  const analyzer = new GeminiJevPhotoAnalyzer(gemini, { choose: jevMock() }, readyCatalog());
  const input = {
    ...analyzerInput(),
    correction: "The portion was smaller.",
    previousCorrections: ["There were two eggs."],
    currentResult: { name: "Earlier result" },
    currentEntry: { id: 42 },
  };

  await expect(analyzer.analyze(input)).rejects.toBeInstanceOf(NoFoodDetectedError);
  expect(capturedContext).toEqual({
    correction: "The portion was smaller.",
    previousCorrections: ["There were two eggs."],
    currentResult: { name: "Earlier result" },
    currentEntry: { id: 42 },
    evidence: [],
  });
});

test("serialized current state is bounded independently of correction validation", async () => {
  const gemini: GeminiMealClient = { analyzeMeal: geminiMock() };
  const analyzer = new GeminiJevPhotoAnalyzer(gemini, { choose: jevMock() }, readyCatalog());

  await expect(analyzer.analyze({
    ...analyzerInput(),
    currentResult: { padding: "x".repeat(100_001) },
  })).rejects.toThrow("Gemini context is invalid or too large");
  expect(gemini.analyzeMeal).not.toHaveBeenCalled();
});

test("an oversized category set fails before Jev dispatch", async () => {
  const gemini: GeminiMealClient = { analyzeMeal: geminiMock(async () => observedMeal()) };
  const jev: JevChoiceClient = { choose: jevMock() };
  const catalog = readyCatalog({
    categories: () => Array.from({ length: 255 }, (_, index) => ({ id: String(index + 1), name: `Category ${index + 1}` })),
  });

  await expect(new GeminiJevPhotoAnalyzer(gemini, jev, catalog).analyze(analyzerInput()))
    .rejects.toBeInstanceOf(CatalogUnavailableError);
  expect(jev.choose).not.toHaveBeenCalled();
});

test("a non-Error caller abort becomes a bounded cancellation error", async () => {
  const parent = new AbortController();
  const gemini: GeminiMealClient = {
    analyzeMeal: geminiMock(async () => await new Promise<never>(() => {})),
  };
  const analyzer = new GeminiJevPhotoAnalyzer(gemini, { choose: jevMock() }, readyCatalog());
  const pending = analyzer.analyze({ ...analyzerInput(), signal: parent.signal });
  parent.abort("caller canceled");

  await expect(pending).rejects.toThrow("Photo analysis canceled");
});

test("an already-aborted parent without a reason receives the default cancellation error", async () => {
  const parent = {
    aborted: true,
    reason: undefined,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as AbortSignal;
  const gemini: GeminiMealClient = { analyzeMeal: geminiMock() };
  const analyzer = new GeminiJevPhotoAnalyzer(gemini, { choose: jevMock() }, readyCatalog());

  await expect(analyzer.analyze({ ...analyzerInput(), signal: parent }))
    .rejects.toThrow("Photo analysis canceled");
  expect(gemini.analyzeMeal).not.toHaveBeenCalled();
});

test("late readiness completion cannot dispatch provider work after the deadline", async () => {
  vi.useFakeTimers();
  let snapshotCalled = false;
  const gemini: GeminiMealClient = { analyzeMeal: geminiMock(async () => ({ status: "no_food" })) };
  const jev: JevChoiceClient = { choose: jevMock() };
  const catalog: UsdaPhotoAnalysisCatalog = {
    photoAnalysisReadiness: async () => {
      await new Promise(resolve => setTimeout(resolve, 11_000));
      return { state: "ready", generation: "generation-one" };
    },
    withPhotoAnalysisSnapshot: async () => {
      snapshotCalled = true;
      throw new Error("snapshot must not be acquired");
    },
  };
  const analyzer: PhotoAnalyzer = new GeminiJevPhotoAnalyzer(gemini, jev, catalog);

  const pending = analyzer.analyze(analyzerInput());
  const rejection = pending.then(() => null, (error: unknown) => error);
  await vi.advanceTimersByTimeAsync(10_000);
  await expect(rejection).resolves.toMatchObject({ message: "Photo analysis timed out" });
  await vi.advanceTimersByTimeAsync(1_000);

  expect(snapshotCalled).toBe(false);
  expect(gemini.analyzeMeal).not.toHaveBeenCalled();
  expect(jev.choose).not.toHaveBeenCalled();
});
