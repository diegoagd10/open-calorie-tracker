import { expect, test } from "vitest";

import type {
  UsdaEvidence,
  UsdaPhotoAnalysisCatalog,
} from "../app/catalog/usda-evidence";
import {
  CatalogNotInstalledError,
  CatalogReimportRequiredError,
  CatalogUnavailableError,
} from "../app/catalog/food-catalog.server";
import { CredentialBundleUnreadableError } from "../app/credentials/encrypted-credential-bundles.server";
import {
  GeminiJevPhotoAnalysisAttemptSource,
  type PhotoAnalysisProviderClientFactory,
} from "../app/photo-analysis/attempts.server";
import {
  PhotoAnalysisAttemptConfigurationUnavailableError,
  type PhotoAnalysisAttemptConfiguration,
} from "../app/photo-analysis/configuration.server";
import type { PhotoAnalyzer } from "../app/photo-analysis/photo-analysis.server";

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

function evidence(generation: string): UsdaEvidence {
  return {
    food: {
      authoritativeBaseQuantityMicrounits: 100_000_000,
      authoritativeBaseUnit: "g",
      barcode: null,
      brand: null,
      catalogGeneration: generation,
      dataType: "Foundation",
      isSelectable: true,
      marketCountry: null,
      measurementSummary: "100 g",
      measurements: [{ id: "100g", label: "100 g", unit: "g", baseQuantityMicrounits: 100_000_000 }],
      name: "Eggs, whole, raw",
      nutritionPerAuthoritativeBase: {
        energyMilliKcal: { amount: 100, fixedPointMultiplier: 1_000 },
        proteinMilligrams: { amount: 10, fixedPointMultiplier: 1_000 },
        carbohydrateMilligrams: { amount: 2, fixedPointMultiplier: 1_000 },
        fatMilligrams: { amount: 5, fixedPointMultiplier: 1_000 },
        fiberMilligrams: null,
        sugarMilligrams: null,
        sodiumMilligrams: null,
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

function observation() {
  return {
    status: "food",
    name: "Egg plate",
    consumedFraction: 1,
    assumptions: [],
    components: [{
      id: "eggs",
      name: "Eggs",
      preparationEvidence: "Visible eggs",
      quantityDescription: "100 g",
      grams: 100,
      uncertainty: "Low",
      assumptions: [],
      includes: [],
      nutrition: {
        energyKcal: 120,
        proteinGrams: 10,
        carbohydrateGrams: 2,
        fatGrams: 5,
        fiberGrams: null,
        sugarGrams: null,
        sodiumMilligrams: null,
      },
    }],
  };
}

test("an active attempt retains copied credentials, configuration, and one catalog generation", async () => {
  let configuration: PhotoAnalysisAttemptConfiguration | undefined = {
    geminiKey: "gemini-key-generation-a",
    typeSafeKey: "typesafe-key-generation-a",
    geminiModel: "gemini-3.1-flash-lite",
    jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: 0.25,
    productConfidenceThreshold: 0.6,
  };
  let activeGeneration = "generation-a";
  let completedLeases = 0;
  const catalog: UsdaPhotoAnalysisCatalog = {
    photoAnalysisReadiness: async () => ({ state: "ready", generation: activeGeneration }),
    withPhotoAnalysisSnapshot: async (_signal, read) => {
      const generation = activeGeneration;
      try {
        await read({
          generation,
          categories: () => [{ id: "1", name: "Dairy and Egg Products" }],
          candidates: () => [{ fdcId: "100", description: "Eggs, whole, raw" }],
          evidence: () => evidence(generation),
        });
        throw new Error("catalog lease cleanup failed after capture");
      } finally {
        completedLeases++;
      }
    },
  };
  const providerKeys: string[] = [];
  const clients: PhotoAnalysisProviderClientFactory = {
    gemini: (key) => {
      providerKeys.push(key);
      return { analyzeMeal: async () => observation() };
    },
    jev: (key) => {
      providerKeys.push(key);
      return {
        choose: async (request) => {
          const product = "food_100" in request.questions.component_0.criteria;
          const choice = product ? "food_100" : "category_1";
          return {
            model: request.model,
            answers: {
              component_0: {
                type: "choice",
                choice,
                confidence: 0.9,
                probabilities: { [choice]: 0.9, none: 0.1 },
              },
            },
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      };
    },
  };
  const source = new GeminiJevPhotoAnalysisAttemptSource(
    {
      captureAttemptConfiguration: async () => {
        if (!configuration) throw new Error("credentials deleted");
        return configuration;
      },
    },
    catalog,
    clients,
  );

  const first = await source.capture(new AbortController().signal);
  configuration = undefined;
  activeGeneration = "generation-b";
  const firstOutcome = await first.analyzer.analyze(analyzerInput()) as {
    diagnostics: { catalogGeneration: string; geminiModel: string; categoryConfidenceThreshold: number };
    evidence: UsdaEvidence[];
  };

  expect(first.configuration).toEqual({
    catalogGeneration: "generation-a",
    geminiModel: "gemini-3.1-flash-lite",
    jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: 0.25,
    productConfidenceThreshold: 0.6,
  });
  expect(firstOutcome.diagnostics).toMatchObject({
    catalogGeneration: "generation-a",
    geminiModel: "gemini-3.1-flash-lite",
    categoryConfidenceThreshold: 0.25,
  });
  expect(firstOutcome.evidence[0].food.catalogGeneration).toBe("generation-a");
  expect(providerKeys).toEqual([
    "gemini-key-generation-a",
    "typesafe-key-generation-a",
  ]);
  expect(completedLeases).toBe(0);
  await expect(source.capture(new AbortController().signal)).rejects.toMatchObject({
    code: "unreadable-credentials",
  });
  first.release();
  first.release();
  await expect.poll(() => completedLeases).toBe(1);

  configuration = {
    geminiKey: "gemini-key-generation-b",
    typeSafeKey: "typesafe-key-generation-b",
    geminiModel: "gemini-3.5-flash",
    jevModel: "jev-1.14.0",
    categoryConfidenceThreshold: 0.7,
    productConfidenceThreshold: 0.8,
  };
  const second = await source.capture(new AbortController().signal);
  const secondOutcome = await second.analyzer.analyze(analyzerInput()) as {
    diagnostics: { catalogGeneration: string; geminiModel: string; jevModel: string };
    evidence: UsdaEvidence[];
  };
  expect(second.configuration).toMatchObject({
    catalogGeneration: "generation-b",
    geminiModel: "gemini-3.5-flash",
    jevModel: "jev-1.14.0",
    categoryConfidenceThreshold: 0.7,
    productConfidenceThreshold: 0.8,
  });
  expect(secondOutcome.diagnostics).toMatchObject({
    catalogGeneration: "generation-b",
    geminiModel: "gemini-3.5-flash",
    jevModel: "jev-1.14.0",
  });
  expect(secondOutcome.evidence[0].food.catalogGeneration).toBe("generation-b");
  expect(providerKeys).toEqual([
    "gemini-key-generation-a",
    "typesafe-key-generation-a",
    "gemini-key-generation-b",
    "typesafe-key-generation-b",
  ]);
  second.release();
  await expect.poll(() => completedLeases).toBe(2);

  configuration = undefined;
  await expect(source.capture(new AbortController().signal)).rejects.toMatchObject({
    code: "unreadable-credentials",
  });
});

test("attempt capture propagates cancellation and catalog acquisition failures", async () => {
  const configuration: PhotoAnalysisAttemptConfiguration = {
    geminiKey: "gemini-key-generation-a",
    typeSafeKey: "typesafe-key-generation-a",
    geminiModel: "gemini-3.1-flash-lite",
    jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: 0.25,
    productConfidenceThreshold: 0.6,
  };
  const neverReady = (failure: unknown): UsdaPhotoAnalysisCatalog => ({
    photoAnalysisReadiness: async () => ({ state: "not-installed" }),
    withPhotoAnalysisSnapshot: async () => { throw failure; },
  });
  const reader = { captureAttemptConfiguration: async () => configuration };

  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await expect(
    new GeminiJevPhotoAnalysisAttemptSource(
      reader,
      neverReady(new Error("unused")),
    ).capture(alreadyAborted.signal),
  ).rejects.toMatchObject({ name: "AbortError" });

  const abortedAfterConfiguration = new AbortController();
  await expect(
    new GeminiJevPhotoAnalysisAttemptSource(
      {
        captureAttemptConfiguration: async () => {
          abortedAfterConfiguration.abort();
          return configuration;
        },
      },
      neverReady(new Error("unused")),
    ).capture(abortedAfterConfiguration.signal),
  ).rejects.toMatchObject({ name: "AbortError" });

  await expect(
    new GeminiJevPhotoAnalysisAttemptSource(
      reader,
      neverReady(new Error("catalog failed")),
    ).capture(new AbortController().signal),
  ).rejects.toMatchObject({ code: "catalog-unavailable" });
  await expect(
    new GeminiJevPhotoAnalysisAttemptSource(
      reader,
      neverReady("catalog failed without an Error"),
    ).capture(new AbortController().signal),
  ).rejects.toMatchObject({ code: "catalog-unavailable" });
});

test.each([
  [new PhotoAnalysisAttemptConfigurationUnavailableError("missing-credentials"), "missing-credentials"],
  [new PhotoAnalysisAttemptConfigurationUnavailableError("unavailable-models"), "unavailable-models"],
])("attempt capture translates stale configuration into readiness errors", async (failure, code) => {
  const source = new GeminiJevPhotoAnalysisAttemptSource(
    { captureAttemptConfiguration: async () => { throw failure; } },
    {
      photoAnalysisReadiness: async () => ({ state: "ready", generation: "unused" }),
      withPhotoAnalysisSnapshot: async () => { throw new Error("unused"); },
    },
  );
  await expect(source.capture(new AbortController().signal)).rejects.toMatchObject({
    name: "PhotoAnalysisUnavailableError",
    code,
  });
});

test("attempt capture preserves cancellation and conceals unreadable credential storage", async () => {
  const catalog: UsdaPhotoAnalysisCatalog = {
    photoAnalysisReadiness: async () => ({ state: "not-installed" }),
    withPhotoAnalysisSnapshot: async () => { throw new Error("unused"); },
  };
  const unreadable = new GeminiJevPhotoAnalysisAttemptSource(
    {
      captureAttemptConfiguration: async () => {
        throw new CredentialBundleUnreadableError();
      },
    },
    catalog,
  );
  await expect(unreadable.capture(new AbortController().signal)).rejects.toMatchObject({
    code: "unreadable-credentials",
  });

  const controller = new AbortController();
  const canceled = new GeminiJevPhotoAnalysisAttemptSource(
    {
      captureAttemptConfiguration: async (signal) => {
        controller.abort();
        signal.throwIfAborted();
        throw new Error("unreachable");
      },
    },
    catalog,
  );
  await expect(canceled.capture(controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
});

test("catalog cancellation remains cancellation rather than a readiness failure", async () => {
  const configuration: PhotoAnalysisAttemptConfiguration = {
    geminiKey: "gemini-key-generation-a",
    typeSafeKey: "typesafe-key-generation-a",
    geminiModel: "gemini-3.1-flash-lite",
    jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: 0.25,
    productConfidenceThreshold: 0.6,
  };
  const source = new GeminiJevPhotoAnalysisAttemptSource(
    { captureAttemptConfiguration: async () => configuration },
    {
      photoAnalysisReadiness: async () => ({ state: "not-installed" }),
      withPhotoAnalysisSnapshot: async () => {
        throw new DOMException("Canceled", "AbortError");
      },
    },
  );
  await expect(source.capture(new AbortController().signal)).rejects.toMatchObject({
    name: "AbortError",
  });
});

test.each([
  [new CatalogNotInstalledError(), "catalog-not-installed"],
  [new CatalogReimportRequiredError(), "catalog-reimport-required"],
  [new CatalogUnavailableError(), "catalog-unavailable"],
])("attempt capture translates stale catalog state into readiness errors", async (failure, code) => {
  const configuration: PhotoAnalysisAttemptConfiguration = {
    geminiKey: "gemini-key-generation-a",
    typeSafeKey: "typesafe-key-generation-a",
    geminiModel: "gemini-3.1-flash-lite",
    jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: 0.25,
    productConfidenceThreshold: 0.6,
  };
  const source = new GeminiJevPhotoAnalysisAttemptSource(
    { captureAttemptConfiguration: async () => configuration },
    {
      photoAnalysisReadiness: async () => ({ state: "not-installed" }),
      withPhotoAnalysisSnapshot: async () => { throw failure; },
    },
  );
  await expect(source.capture(new AbortController().signal)).rejects.toEqual(
    expect.objectContaining({ code }),
  );
});
