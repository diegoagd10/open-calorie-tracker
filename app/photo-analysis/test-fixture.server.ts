import type { PhotoAnalyzer } from "./photo-analysis.server";
import type { PhotoAnalysisReadiness } from "./readiness.server";
import { ProviderCredentialRejectedError, type PhotoAnalysisCredentialValidator } from "./credentials.server";
import type { PhotoAnalysisModelDiscovery } from "./configuration.server";
import { z } from "zod";

export const PHOTO_ANALYSIS_TEST_READINESS_KEY =
  "photo_analysis_test_readiness";
export const photoAnalysisTestReadinessCodeSchema = z.enum([
  "missing-credentials",
  "unreadable-credentials",
  "unavailable-models",
  "catalog-not-installed",
  "catalog-reimport-required",
  "catalog-unavailable",
]);

export class TestPhotoAnalysisReadiness {
  constructor(
    private readonly metadata: { read(key: string): string | undefined },
  ) {}

  async read(): Promise<PhotoAnalysisReadiness> {
    const stored = this.metadata.read(PHOTO_ANALYSIS_TEST_READINESS_KEY);
    if (!stored) return { state: "ready" };
    return {
      state: "unavailable",
      code: photoAnalysisTestReadinessCodeSchema.parse(stored),
    };
  }
}

const categoryNone = {
  code: "category-none" as const,
  message: "No USDA category adequately matched the visible component.",
};

function fixtureDiagnostics(
  componentId: string,
  options: {
    additionalAiComponentIds?: string[];
    catalogGeneration?: string;
    fdcId?: string;
    foodLabel?: string;
  } = {},
) {
  const category = {
    choice: options.fdcId
      ? { key: "category_11", label: "Vegetables and Vegetable Products" }
      : {
          key: "none",
          label: "No listed category adequately represents this visible food.",
        },
    confidence: 0.9,
    selectedProbability: 0.9,
    topCandidates: options.fdcId
      ? [
          {
            key: "category_11",
            label: "Vegetables and Vegetable Products",
            probability: 0.9,
          },
          {
            key: "none",
            label: "No listed category adequately represents this visible food.",
            probability: 0.1,
          },
        ]
      : [
          {
            key: "none",
            label: "No listed category adequately represents this visible food.",
            probability: 0.9,
          },
          {
            key: "category_20",
            label: "Cereal Grains and Pasta",
            probability: 0.1,
          },
        ],
  };
  const product = options.fdcId
    ? {
        choice: {
          key: `food_${options.fdcId}`,
          label: options.foodLabel ?? "Foundation food",
        },
        confidence: 0.9,
        selectedProbability: 0.9,
        topCandidates: [
          {
            key: `food_${options.fdcId}`,
            label: options.foodLabel ?? "Foundation food",
            probability: 0.9,
          },
          {
            key: "none",
            label: "No listed Foundation record adequately represents this visible food.",
            probability: 0.1,
          },
        ],
      }
    : null;
  return {
    catalogGeneration: options.catalogGeneration ?? "browser-foundation-fixture",
    geminiModel: "gemini-3.1-flash-lite",
    jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: 0,
    productConfidenceThreshold: 0,
    components: [
      {
        componentId,
        category,
        product,
        fallbackReason: options.fdcId ? null : categoryNone,
      },
      ...(options.additionalAiComponentIds ?? []).map((additionalId) => ({
        componentId: additionalId,
        category: {
          choice: {
            key: "none",
            label: "No listed category adequately represents this visible food.",
          },
          confidence: 0.9,
          selectedProbability: 0.9,
          topCandidates: [
            {
              key: "none",
              label: "No listed category adequately represents this visible food.",
              probability: 0.9,
            },
            {
              key: "category_20",
              label: "Cereal Grains and Pasta",
              probability: 0.1,
            },
          ],
        },
        product: null,
        fallbackReason: categoryNone,
      })),
    ],
  };
}

function fixtureOutcome(
  result: unknown,
  componentId: string,
  options: {
    additionalAiComponentIds?: string[];
    evidence?: Awaited<ReturnType<Parameters<PhotoAnalyzer["analyze"]>[0]["usda"]["detail"]>>[];
    catalogGeneration?: string;
    fdcId?: string;
    foodLabel?: string;
  } = {},
) {
  return {
    kind: "photo-analysis-outcome" as const,
    result,
    evidence: options.evidence ?? [],
    diagnostics: fixtureDiagnostics(componentId, options),
  };
}

export class TestPhotoAnalyzer implements PhotoAnalyzer {
  async analyze(input: Parameters<PhotoAnalyzer["analyze"]>[0]) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 1800);
      input.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new Error("Canceled"));
        },
        { once: true },
      );
    });
    if (input.correction === "fail this analysis")
      throw new Error("Fixture failure");
    if (input.photo.bytes.subarray(-7).toString() === "no-food")
      return { status: "no_food" };
    if (input.photo.bytes.toString("utf8").endsWith("local-usda")) {
      try {
        const candidates = await input.usda.search("broccoli raw", 1);
        const candidate = candidates[0];
        if (!candidate) throw new Error("No matching local evidence");
        const evidence = await input.usda.detail(candidate.food.providerFoodId);
        const result = {
          name: "Photo broccoli plate",
          consumedFraction: 1,
          assumptions: ["The photo contains 100 g of raw broccoli"],
          components: [{
            id: "broccoli",
            name: evidence.food.name,
            quantity: 100,
            unit: "g",
            includes: [],
            source: { kind: "usda", fdcId: evidence.food.providerFoodId },
            supplements: [
              { nutrient: "proteinGrams", amount: 2.5, reason: "Installed Foundation fixture omits protein" },
              { nutrient: "carbohydrateGrams", amount: 6, reason: "Installed Foundation fixture omits carbohydrate" },
              { nutrient: "fatGrams", amount: 0.3, reason: "Installed Foundation fixture omits fat" },
            ],
          }, {
            id: "seasoning",
            name: "Seasoning",
            quantity: 1,
            unit: "g",
            includes: [],
            source: { kind: "ai", reason: categoryNone.message },
            nutrition: {
              energyKcal: 0,
              proteinGrams: 0,
              carbohydrateGrams: 0,
              fatGrams: 0,
            },
          }],
        };
        return fixtureOutcome(result, "broccoli", {
          evidence: [evidence],
          catalogGeneration:
            evidence.food.catalogGeneration ?? "browser-foundation-fixture",
          fdcId: evidence.food.providerFoodId,
          foodLabel: evidence.food.name,
          additionalAiComponentIds: ["seasoning"],
        });
      } catch {
        const result = {
          name: "Estimated broccoli plate",
          consumedFraction: 1,
          assumptions: ["No suitable installed Foundation evidence was available"],
          components: [{
            id: "broccoli",
            name: "Broccoli",
            quantity: 100,
            unit: "g",
            includes: [],
            source: { kind: "ai", reason: categoryNone.message },
            nutrition: {
              energyKcal: 32,
              proteinGrams: 2.5,
              carbohydrateGrams: 6,
              fatGrams: 0.3,
            },
          }],
        };
        return fixtureOutcome(result, "broccoli");
      }
    }
    const result = {
      name: "Photo rice plate",
      consumedFraction: 1,
      assumptions: ["Rice portion estimated from the photo"],
      components: [
        {
          id: "rice",
          name: "Cooked rice",
          quantity: 200,
          unit: "g",
          includes: [],
          source: { kind: "ai", reason: categoryNone.message },
          nutrition: {
            energyKcal: input.correction ? 350 : 250,
            proteinGrams: 5,
            carbohydrateGrams: 50,
            fatGrams: 2,
          },
        },
      ],
    };
    return fixtureOutcome(result, "rice");
  }
}

export class TestPhotoAnalysisCredentialValidator implements PhotoAnalysisCredentialValidator {
  async validateGemini(key: string): Promise<void> {
    if (key.includes("invalid")) throw new ProviderCredentialRejectedError();
  }

  async validateTypeSafe(key: string): Promise<void> {
    if (key.includes("invalid")) throw new ProviderCredentialRejectedError();
  }
}

export class TestPhotoAnalysisModelDiscovery implements PhotoAnalysisModelDiscovery {
  async discoverGemini() {
    return [
      { id: "gemini-3.1-flash-lite", displayName: "Gemini 3.1 Flash-Lite", methods: ["generateContent"] },
      { id: "gemini-3.5-flash", displayName: "Gemini 3.5 Flash", methods: ["generateContent"] },
    ];
  }

  async discoverJev() {
    return [
      { id: "jev", effectiveId: "jev-1.13.0" },
      { id: "jev-1.14.0", effectiveId: "jev-1.14.0" },
    ];
  }
}
