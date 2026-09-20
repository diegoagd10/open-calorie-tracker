import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { sql } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";
import { CatalogManagement } from "../app/catalog-management/catalog-management.server";
import { LocalUsdaAdapter } from "../app/catalog/local-usda.server";
import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from "../app/database/database.server";
import { users, userPreferences } from "../app/database/schema.server";
import { FoodEntryService } from "../app/food-entry/food-entry.server";
import type {
  UsdaAnalysisReader,
  UsdaEvidence,
} from "../app/catalog/usda-evidence";
import { FoodLogService } from "../app/food-log/food-log.server";
import {
  PhotoAnalysisService,
  type PhotoAnalyzer,
} from "../app/photo-analysis/photo-analysis.server";
import type { PhotoAnalysisAttemptSource } from "../app/photo-analysis/attempts.server";
import {
  photoAnalysisDiagnosticsSchema,
  type PhotoAnalysisDiagnostics,
} from "../app/photo-analysis/provenance.server";
import { NoFoodDetectedError } from "../app/photo-analysis/result.server";
import { foundationArchive } from "./support/foundation-archive";
import { createMigrationFolder } from "./support/migrations";

const services: PhotoAnalysisService[] = [];
const catalogManagers: CatalogManagement[] = [];
const databases: ApplicationDatabase[] = [];
const directories: string[] = [];
afterEach(async () => {
  services.splice(0).forEach((service) => service.shutdown());
  await Promise.resolve();
  await Promise.all(catalogManagers.splice(0).map(manager => manager.shutdown()));
  databases.splice(0).forEach((db) => db.close());
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
const photo = {
  mimeType: "image/png",
  bytes: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFElEQVR4nGP4TyJgGNUwqmH4agAAr639H708R/EAAAAASUVORK5CYII=",
    "base64",
  ),
};
function estimate(energy = 250) {
  return {
    name: "Rice plate",
    consumedFraction: 1,
    assumptions: ["Estimated portion from photo"],
    components: [
      {
        id: "rice",
        name: "Cooked rice",
        quantity: 200,
        unit: "g",
        includes: [],
        source: { kind: "ai", reason: "No suitable USDA record" },
        nutrition: {
          energyKcal: energy,
          proteinGrams: 5,
          carbohydrateGrams: 50,
          fatGrams: 2,
        },
      },
    ],
  };
}
async function setup(
  analyzer: PhotoAnalyzer | PhotoAnalysisAttemptSource,
  options: {
    usda?: UsdaAnalysisReader;
    createUsda?: (context: {
      client: ReturnType<ApplicationDatabase["getClient"]>;
      directory: string;
    }) => Promise<UsdaAnalysisReader>;
    rounds?: number;
    deadlineMs?: number;
  } = {},
) {
  const dir = await mkdtemp(path.join(tmpdir(), "photo-analysis-"));
  directories.push(dir);
  const db = openApplicationDatabase({
    databasePath: path.join(dir, "db.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });
  databases.push(db);
  const client = db.getClient();
  const createdAt = "2026-09-05T03:59:00.000Z";
  const userId = client
    .insert(users)
    .values({ usernameNormalized: "photo.user", createdAt })
    .returning()
    .get().id;
  client
    .insert(userPreferences)
    .values({
      userId,
      timeZone: "America/New_York",
      displayUnits: "metric",
      createdAt,
      updatedAt: createdAt,
    })
    .run();
  const clock = { instant: new Date(createdAt) };
  const usda = options.createUsda
    ? await options.createUsda({ client, directory: dir })
    : options.usda;
  const service = new PhotoAnalysisService(client, analyzer, {
    now: () => clock.instant,
    usda,
    rounds: options.rounds,
    deadlineMs: options.deadlineMs,
  });
  services.push(service);
  const log = new FoodLogService(client, () => clock.instant);
  return { service, log, userId, clock, client };
}

test("photo analysis saves captured local Foundation evidence when USDA is replaced between search and detail", async () => {
  let management!: CatalogManagement;
  let searched!: () => void;
  let continueAnalysis!: () => void;
  const searchFinished = new Promise<void>(resolve => { searched = resolve; });
  const replacementFinished = new Promise<void>(resolve => { continueAnalysis = resolve; });
  let searchedEvidence: Awaited<ReturnType<UsdaAnalysisReader["searchEvidence"]>> = [];
  const network = vi.fn(() => { throw new Error("Food API access is forbidden"); });
  vi.stubGlobal("fetch", network);
  const { service, log, userId } = await setup(
    {
      analyze: async ({ usda }) => {
        searchedEvidence = await usda.search("broccoli", 1);
        searched();
        await replacementFinished;
        expect((await usda.search("broccoli", 1))[0]).toEqual(searchedEvidence[0]);
        const detail = await usda.detail("747447");
        expect(detail).toEqual(searchedEvidence[0]);
        return {
          ...estimate(),
          name: "Local broccoli plate",
          components: [{
            ...estimate().components[0],
            name: "Broccoli, raw",
            quantity: 100,
            source: { kind: "usda", fdcId: "747447" },
          }],
        };
      },
    },
    {
      createUsda: async ({ client, directory }) => {
        management = new CatalogManagement(client, {
          directory,
          workerPath: path.resolve("app/catalog-management/import-worker.ts"),
        });
        catalogManagers.push(management);
        await management.submitArchive({
          filename: "foundation.zip",
          stream: Readable.from(await foundationArchive()),
        });
        await vi.waitFor(() => expect(management.read().busy).toBe(false));
        return new LocalUsdaAdapter(management, directory);
      },
    },
  );
  const meal = await service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "captured-local-foundation",
  });
  await searchFinished;
  await management.submitArchive({
    filename: "replacement.zip",
    stream: Readable.from(await foundationArchive({
      "food.csv": "fdc_id,data_type,description,food_category_id,publication_date\n747447,foundation_food,Broccoli revised after review,11,2026-08-01\n",
      "food_nutrient.csv": "id,fdc_id,nutrient_id,amount\n1,747447,2048,999\n2,747447,1003,99\n3,747447,1004,88\n4,747447,1005,77\n",
    })),
  });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  continueAnalysis();

  await expect.poll(() => service.status(userId, meal.id).status).toBe("succeeded");
  expect(log.read(userId, "2026-09-04")?.entries).toMatchObject([{
    name: "Local broccoli plate",
    energyMilliKcal: 32_000,
    proteinMilligrams: 2_570,
    carbohydrateMilligrams: 6_270,
    fatMilligrams: 340,
    sugarMilligrams: null,
  }]);
  expect(searchedEvidence[0]).toMatchObject({
    food: { dataType: "Foundation", providerFoodId: "747447" },
    record: {
      description: "Broccoli, raw",
    },
  });
  expect(searchedEvidence[0].record.supportedPortions).toContainEqual({
    id: "portion:187633",
    label: "1 cup, chopped (76 g)",
    gramWeight: 76,
  });
  expect(service.view(userId, meal.id).result?.components[0].source).toEqual({
    kind: "usda",
    fdcId: "747447",
    dataType: "Foundation",
  });
  expect(network).not.toHaveBeenCalled();
});

test("a missing local preparation remains an explicit estimate without a fabricated FDC identity", async () => {
  let management!: CatalogManagement;
  const network = vi.fn(() => { throw new Error("Food API access is forbidden"); });
  vi.stubGlobal("fetch", network);
  const reason = "The installed Foundation catalog has raw tilapia but no suitable cooked preparation";
  const { service, userId } = await setup(
    {
      analyze: async ({ usda }) => {
        expect(await usda.search("tilapia cooked", 1)).toEqual([]);
        return {
          ...estimate(128),
          name: "Estimated cooked tilapia",
          components: [{
            ...estimate(128).components[0],
            name: "Cooked tilapia",
            source: { kind: "ai", reason },
          }],
        };
      },
    },
    {
      createUsda: async ({ client, directory }) => {
        management = new CatalogManagement(client, {
          directory,
          workerPath: path.resolve("app/catalog-management/import-worker.ts"),
        });
        catalogManagers.push(management);
        await management.submitArchive({
          filename: "raw-tilapia.zip",
          stream: Readable.from(await foundationArchive({
            "food.csv": "fdc_id,data_type,description,food_category_id,publication_date\n700,foundation_food,Fish tilapia raw,11,2026-01-01\n",
            "food_nutrient.csv": "id,fdc_id,nutrient_id,amount\n1,700,2048,96\n2,700,1003,20\n3,700,1004,2\n4,700,1005,0\n",
            "food_portion.csv": "id,fdc_id,amount,measure_unit_id,gram_weight,modifier,portion_description\n",
          })),
        });
        await vi.waitFor(() => expect(management.read().busy).toBe(false));
        return new LocalUsdaAdapter(management, directory);
      },
    },
  );
  const meal = await service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "missing-local-preparation",
  });

  await expect.poll(() => service.status(userId, meal.id).status).toBe("succeeded");
  expect(service.view(userId, meal.id).result?.components[0].source).toEqual({
    kind: "ai",
    reason,
  });
  expect(service.history(userId, meal.id)[0].evidence).toBe("[]");
  expect(network).not.toHaveBeenCalled();
});

test("a photo returns promptly, excludes pending nutrition, and auto-saves one entry on the captured date", async () => {
  let finish!: (value: unknown) => void;
  const { service, log, userId, clock } = await setup({
    analyze: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const started = await service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "initial-photo-1",
  });
  expect(started.status).toBe("active");
  expect(log.read(userId, "2026-09-04")?.entries).toHaveLength(0);
  clock.instant = new Date("2026-09-05T04:01:00.000Z");
  finish(estimate());
  await expect
    .poll(() => service.status(userId, started.id).status)
    .toBe("succeeded");
  expect(log.read(userId, "2026-09-04")?.entries).toMatchObject([
    {
      provider: "ai-photo",
      energyMilliKcal: 250000,
      proteinMilligrams: 5000,
      fiberMilligrams: null,
      localEventTime: "23:59:00",
    },
  ]);
  expect(log.read(userId, "2026-09-05")?.entries).toHaveLength(0);
});

test("successive AI corrections retain old totals while active and atomically replace the same entry", async () => {
  const completions: ((value: unknown) => void)[] = [];
  const contexts: unknown[] = [];
  const { service, log, userId } = await setup({
    analyze: (input) => {
      contexts.push(input);
      return new Promise((resolve) => completions.push(resolve));
    },
  });
  const meal = await service.start(userId, {
    photo,
    foodLogDate: "2026-09-03",
    idempotencyKey: "plate-correction",
  });
  completions.shift()!(estimate());
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("succeeded");
  const entryId = service.status(userId, meal.id).entryId!;
  for (const [index, correction] of [
    "It has butter",
    "Only half the rice",
  ].entries()) {
    await service.correct(userId, entryId, {
      correction,
      idempotencyKey: `correction-${index}`,
    });
    expect(log.read(userId, "2026-09-03")?.entries).toMatchObject([
      { id: entryId, energyMilliKcal: index === 0 ? 250000 : 350000 },
    ]);
    await expect(
      service.correct(userId, entryId, {
        correction: "Another change",
        idempotencyKey: "conflicting-request",
      }),
    ).rejects.toThrow();
    completions.shift()!(estimate(index === 0 ? 350 : 200));
    await expect
      .poll(() => service.status(userId, meal.id).status)
      .toBe("succeeded");
  }
  expect(log.read(userId, "2026-09-03")?.entries).toMatchObject([
    { id: entryId, energyMilliKcal: 200000, localEventTime: "12:00:00" },
  ]);
  expect(contexts.at(-1)).toMatchObject({
    correction: "Only half the rice",
    previousCorrections: ["It has butter"],
    currentResult: { name: "Rice plate" },
  });
  expect(service.history(userId, meal.id)).toHaveLength(3);
});

test("cancel and retry ignore late results, deduplicate requests, and preserve correction nutrition", async () => {
  const completions: ((value: unknown) => void)[] = [];
  const { service, log, userId } = await setup({
    analyze: () => new Promise((resolve) => completions.push(resolve)),
  });
  const input = {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "cancel-initial",
  };
  const meal = await service.start(userId, input);
  expect((await service.start(userId, input)).id).toBe(meal.id);
  service.cancel(userId, meal.id, meal.attemptId);
  const [retried, repeatedRetry] = await Promise.all([
    service.retry(userId, meal.id, {
      idempotencyKey: "explicit-retry",
      attemptId: meal.attemptId,
    }),
    service.retry(userId, meal.id, {
      idempotencyKey: "explicit-retry",
      attemptId: meal.attemptId,
    }),
  ]);
  expect(repeatedRetry.attemptId).toBe(retried.attemptId);
  completions[0](estimate(999));
  completions[1](estimate(200));
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("succeeded");
  const entryId = service.status(userId, meal.id).entryId!;
  const correction = await service.correct(userId, entryId, {
    correction: "Add butter",
    idempotencyKey: "cancel-correction",
  });
  service.cancel(userId, meal.id, correction.attemptId);
  completions[2](estimate(600));
  await Promise.resolve();
  expect(log.read(userId, "2026-09-04")?.entries).toMatchObject([
    { id: entryId, energyMilliKcal: 200000 },
  ]);
  expect(service.status(userId, meal.id).status).toBe("canceled");
  expect(() => service.status(userId + 1, meal.id)).toThrow();
  expect(() => service.photo(userId + 1, meal.id)).toThrow();
  service.delete(userId, meal.id);
  expect(() => service.photo(userId, meal.id)).toThrow();
  expect(() => service.history(userId, meal.id)).toThrow();
  expect(log.read(userId, "2026-09-04")?.entries).toHaveLength(0);
});

test("a bounded attempt times out and a new server marks lost work interrupted without rerunning it", async () => {
  const { client, userId } = await setup({ analyze: async () => estimate() });
  const analyzer: PhotoAnalyzer = { analyze: () => new Promise(() => {}) };
  const timed = new PhotoAnalysisService(client, analyzer, { deadlineMs: 20 });
  services.push(timed);
  const first = await timed.start(userId, {
    photo,
    foodLogDate: "2026-09-03",
    idempotencyKey: "deadline-photo",
  });
  await expect.poll(() => timed.status(userId, first.id).status).toBe("failed");
  expect(timed.status(userId, first.id).error).toContain("timed out");
  const running = await timed.start(userId, {
    photo,
    foodLogDate: "2026-09-03",
    idempotencyKey: "interrupted-photo",
  });
  timed.shutdown();
  const restarted = new PhotoAnalysisService(client, analyzer);
  expect(restarted.status(userId, running.id).status).toBe("interrupted");
  expect(restarted.photo(userId, running.id).bytes).toEqual(photo.bytes);
});

test("deadline and shutdown stop attempt capture without persisting half-captured work", async () => {
  let finishCapture!: (lease: Awaited<ReturnType<PhotoAnalysisAttemptSource["capture"]>>) => void;
  let releases = 0;
  const source: PhotoAnalysisAttemptSource = {
    capture: async () => await new Promise((resolve) => {
      finishCapture = resolve;
    }),
  };
  const { service, userId } = await setup(source, { deadlineMs: 20 });

  await expect(service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "capture-timeout",
  })).rejects.toThrow("Analysis timed out");
  expect(service.list(userId, "2026-09-04")).toEqual([]);
  finishCapture({
    analyzer: { analyze: async () => estimate() },
    configuration: null,
    release: () => { releases++; },
  });
  await expect.poll(() => releases).toBe(1);

  const shutdownCapture = service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "capture-shutdown",
  });
  service.shutdown();
  await expect(shutdownCapture).rejects.toThrow("Analysis stopped");
  finishCapture({
    analyzer: { analyze: async () => estimate() },
    configuration: null,
    release: () => { releases++; },
  });
  await expect.poll(() => releases).toBe(2);
  expect(service.list(userId, "2026-09-04")).toEqual([]);
});

function usdaFixture(): UsdaAnalysisReader {
  const evidence: UsdaEvidence = {
    food: {
      authoritativeBaseQuantityMicrounits: 100_000_000,
      authoritativeBaseUnit: "g",
      barcode: null,
      brand: null,
      dataType: "Foundation",
      isSelectable: true,
      marketCountry: null,
      measurements: [{ baseQuantityMicrounits: 100_000_000, id: "base:g:100000000", label: "100 g", unit: "g" }],
      measurementSummary: "100 g",
      name: "Rice, cooked",
      nutritionPerAuthoritativeBase: {
        carbohydrateMilligrams: { amount: 28, fixedPointMultiplier: 1_000 },
        energyMilliKcal: { amount: 130, fixedPointMultiplier: 1_000 },
        fatMilligrams: { amount: 0.3, fixedPointMultiplier: 1_000 },
        fiberMilligrams: null,
        proteinMilligrams: { amount: 2.7, fixedPointMultiplier: 1_000 },
        sodiumMilligrams: null,
        sugarMilligrams: { amount: 0, fixedPointMultiplier: 1_000 },
      },
      originalName: "Rice, cooked",
      provider: "usda-fdc",
      providerFoodId: "700",
      providerModifiedDate: null,
      providerPublishedDate: "2026-01-01",
      catalogGeneration: "foundation-generation-7",
    },
    record: { dataType: "Foundation", description: "Rice, cooked", fdcId: 700 },
  };
  return {
    async getEvidence() { return evidence; },
    async searchEvidence() { return [evidence]; },
  };
}

const categoryNoneReason = {
  code: "category-none",
  message: "No USDA category adequately matched the visible component.",
} as const;

function categoryFallbackOutcome(probability = 0.8) {
  return {
    kind: "photo-analysis-outcome" as const,
    result: {
      ...estimate(),
      components: [{
        ...estimate().components[0],
        source: { kind: "ai", reason: categoryNoneReason.message },
      }],
    },
    evidence: [],
    diagnostics: {
      catalogGeneration: "foundation-generation-7",
      geminiModel: "gemini-3.1-flash-lite",
      jevModel: "jev-1.13.0",
      categoryConfidenceThreshold: 0.35,
      productConfidenceThreshold: 0.7,
      components: [{
        componentId: "rice",
        category: {
          choice: {
            key: "none",
            label: "No listed category adequately represents this visible food.",
          },
          confidence: 0.9,
          selectedProbability: probability,
          topCandidates: [
            {
              key: "none",
              label: "No listed category adequately represents this visible food.",
              probability,
            },
            {
              key: "category_20",
              label: "Cereal Grains and Pasta",
              probability: 1 - probability,
            },
          ],
        },
        product: null,
        fallbackReason: categoryNoneReason,
      }],
    },
  };
}

test("a mixed result retains bounded matching provenance with its captured USDA evidence", async () => {
  const evidence = await usdaFixture().getEvidence("700", new AbortController().signal);
  const { service, userId } = await setup({
    analyze: async () => ({
      kind: "photo-analysis-outcome",
      result: {
        ...estimate(),
        name: "Rice and sauce",
        components: [
          {
            ...estimate().components[0],
            source: { kind: "usda", fdcId: "700" },
          },
          {
            ...estimate(80).components[0],
            id: "sauce",
            name: "House sauce",
            quantity: 1,
            unit: "serving",
            source: {
              kind: "ai",
              reason: "USDA record confidence was below the configured threshold.",
            },
          },
        ],
      },
      evidence: [evidence],
      diagnostics: {
        catalogGeneration: "foundation-generation-7",
        geminiModel: "gemini-3.1-flash-lite",
        jevModel: "jev-1.13.0",
        categoryConfidenceThreshold: 0.35,
        productConfidenceThreshold: 0.7,
        components: [
          {
            componentId: "rice",
            category: {
              choice: { key: "category_20", label: "Cereal Grains and Pasta" },
              confidence: 0.91,
              selectedProbability: 0.82,
              topCandidates: [
                { key: "category_20", label: "Cereal Grains and Pasta", probability: 0.82 },
                { key: "none", label: "No listed category adequately represents this visible food.", probability: 0.18 },
              ],
            },
            product: {
              choice: { key: "food_700", label: "Rice, cooked" },
              confidence: 0.94,
              selectedProbability: 0.9,
              topCandidates: [
                { key: "food_700", label: "Rice, cooked", probability: 0.9 },
                { key: "none", label: "No listed Foundation record adequately represents this visible food.", probability: 0.1 },
              ],
            },
            fallbackReason: null,
          },
          {
            componentId: "sauce",
            category: {
              choice: { key: "category_1", label: "Dairy and Egg Products" },
              confidence: 0.8,
              selectedProbability: 0.75,
              topCandidates: [
                { key: "category_1", label: "Dairy and Egg Products", probability: 0.75 },
                { key: "none", label: "No listed category adequately represents this visible food.", probability: 0.25 },
              ],
            },
            product: {
              choice: { key: "food_701", label: "Sauce candidate" },
              confidence: 0.6,
              selectedProbability: 0.58,
              topCandidates: [
                { key: "food_701", label: "Sauce candidate", probability: 0.58 },
                { key: "none", label: "No listed Foundation record adequately represents this visible food.", probability: 0.42 },
              ],
            },
            fallbackReason: {
              code: "product-low-confidence",
              message: "USDA record confidence was below the configured threshold.",
            },
          },
        ],
      },
    }),
  });

  const meal = await service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "mixed-provenance",
  });
  await expect.poll(() => service.status(userId, meal.id).status).toBe("succeeded");

  const attempt = service.history(userId, meal.id)[0] as unknown as {
    diagnostics: string;
    evidence: string;
  };
  expect(JSON.parse(attempt.diagnostics)).toMatchObject({
    catalogGeneration: "foundation-generation-7",
    geminiModel: "gemini-3.1-flash-lite",
    jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: 0.35,
    productConfidenceThreshold: 0.7,
    components: [
      {
        componentId: "rice",
        category: { choice: { key: "category_20", label: "Cereal Grains and Pasta" } },
        product: { choice: { key: "food_700", label: "Rice, cooked" } },
        fallbackReason: null,
      },
      {
        componentId: "sauce",
        fallbackReason: { code: "product-low-confidence" },
      },
    ],
  });
  expect(JSON.parse(attempt.evidence)).toEqual([evidence]);
  expect(service.view(userId, meal.id)).toMatchObject({
    provenanceState: "recorded",
    result: {
      components: [
        { source: { kind: "usda", dataType: "Foundation", fdcId: "700" } },
        { source: { kind: "ai", reason: "USDA record confidence was below the configured threshold." } },
      ],
    },
  });
});

test("a failed attempt retains its captured model and threshold configuration", async () => {
  const { service, userId } = await setup({
    configurationSnapshot: () => ({
      geminiModel: "gemini-3.1-flash-lite",
      jevModel: "jev-1.13.0",
      categoryConfidenceThreshold: 0.35,
      productConfidenceThreshold: 0.7,
    }),
    analyze: async () => {
      throw new Error("provider unavailable");
    },
  });

  const meal = await service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "failed-provenance",
  });
  await expect.poll(() => service.status(userId, meal.id).status).toBe("failed");

  const attempt = service.history(userId, meal.id)[0];
  expect(JSON.parse(attempt.diagnostics!)).toEqual({
    catalogGeneration: null,
    geminiModel: "gemini-3.1-flash-lite",
    jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: 0.35,
    productConfidenceThreshold: 0.7,
    components: [],
  });
});

test("active attempts keep their captured configuration while later corrections recheck it", async () => {
  type Snapshot = {
    catalogGeneration: string;
    geminiModel: string;
    jevModel: string;
    categoryConfidenceThreshold: number;
    productConfidenceThreshold: number;
  };
  let available: Snapshot | undefined = {
    catalogGeneration: "generation-a",
    geminiModel: "gemini-a",
    jevModel: "jev-a",
    categoryConfidenceThreshold: 0.2,
    productConfidenceThreshold: 0.4,
  };
  const completions: ((value: unknown) => void)[] = [];
  const released: string[] = [];
  const attempts: PhotoAnalysisAttemptSource = {
    capture: async () => {
      if (!available) throw new Error("Photo Analysis is not configured");
      const captured = { ...available };
      return {
        configuration: captured,
        analyzer: {
          analyze: async () => await new Promise((resolve) => {
            completions.push(resolve);
          }),
        },
        release: () => released.push(captured.catalogGeneration),
      };
    },
  };
  const { service, userId } = await setup(attempts);

  const meal = await service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "captured-initial-attempt",
  });
  available = {
    catalogGeneration: "generation-b",
    geminiModel: "gemini-b",
    jevModel: "jev-b",
    categoryConfidenceThreshold: 0.7,
    productConfidenceThreshold: 0.8,
  };
  expect(JSON.parse(service.history(userId, meal.id)[0].diagnostics!)).toMatchObject({
    catalogGeneration: "generation-a",
    geminiModel: "gemini-a",
    jevModel: "jev-a",
    categoryConfidenceThreshold: 0.2,
    productConfidenceThreshold: 0.4,
  });
  completions.shift()!(estimate(250));
  await expect.poll(() => service.status(userId, meal.id).status).toBe("succeeded");

  const correction = await service.correct(
    userId,
    service.status(userId, meal.id).entryId!,
    {
      correction: "Use the corrected portion",
      idempotencyKey: "captured-correction-attempt",
    },
  );
  available = undefined;
  expect(JSON.parse(service.history(userId, meal.id).at(-1)!.diagnostics!)).toMatchObject({
    catalogGeneration: "generation-b",
    geminiModel: "gemini-b",
    jevModel: "jev-b",
    categoryConfidenceThreshold: 0.7,
    productConfidenceThreshold: 0.8,
  });
  completions.shift()!(estimate(300));
  await expect.poll(() => service.status(userId, meal.id).status).toBe("succeeded");
  expect(released).toEqual(["generation-a", "generation-b"]);

  available = {
    catalogGeneration: "generation-c",
    geminiModel: "gemini-c",
    jevModel: "jev-c",
    categoryConfidenceThreshold: 0.3,
    productConfidenceThreshold: 0.5,
  };
  const canceled = await service.correct(
    userId,
    correction.entryId!,
    {
      correction: "Retry this complete correction",
      idempotencyKey: "captured-canceled-correction",
    },
  );
  service.cancel(userId, meal.id, canceled.attemptId);
  available = {
    catalogGeneration: "generation-d",
    geminiModel: "gemini-d",
    jevModel: "jev-d",
    categoryConfidenceThreshold: 0.1,
    productConfidenceThreshold: 0.9,
  };
  const retried = await service.retry(userId, meal.id, {
    attemptId: canceled.attemptId,
    idempotencyKey: "captured-retry-attempt",
  });
  expect(JSON.parse(service.history(userId, meal.id).at(-1)!.diagnostics!)).toMatchObject({
    catalogGeneration: "generation-d",
    geminiModel: "gemini-d",
    jevModel: "jev-d",
    categoryConfidenceThreshold: 0.1,
    productConfidenceThreshold: 0.9,
  });
  completions.shift()!(estimate(999));
  completions.shift()!(estimate(350));
  await expect.poll(() => service.status(userId, meal.id).status).toBe("succeeded");
  await expect.poll(() => released).toEqual([
    "generation-a",
    "generation-b",
    "generation-c",
    "generation-d",
  ]);
  expect(retried.correction).toBe("Retry this complete correction");

  available = undefined;
  await expect(service.correct(
    userId,
    correction.entryId!,
    {
      correction: "Try after deletion",
      idempotencyKey: "unconfigured-correction-attempt",
    },
  )).rejects.toThrow("Photo Analysis is not configured");
  expect(service.history(userId, meal.id)).toHaveLength(4);
  expect(service.view(userId, meal.id)).toMatchObject({
    status: "succeeded",
    energyMilliKcal: 350000,
  });
});

test("a later provider failure retains matching decisions already completed by the attempt", async () => {
  const partial: PhotoAnalysisDiagnostics = categoryFallbackOutcome().diagnostics;
  partial.components[0] = {
    ...partial.components[0],
    category: {
      choice: { key: "category_20", label: "Cereal Grains and Pasta" },
      confidence: 0.88,
      selectedProbability: 0.76,
      topCandidates: [
        {
          key: "category_20",
          label: "Cereal Grains and Pasta",
          probability: 0.76,
        },
        {
          key: "none",
          label: "No listed category adequately represents this visible food.",
          probability: 0.24,
        },
      ],
    },
    product: null,
    fallbackReason: null,
  };
  const { service, userId } = await setup({
    configurationSnapshot: () => ({
      geminiModel: "gemini-3.1-flash-lite",
      jevModel: "jev-1.13.0",
      categoryConfidenceThreshold: 0.35,
      productConfidenceThreshold: 0.7,
    }),
    analyze: async (input) => {
      input.recordDiagnostics?.(partial);
      throw new Error("product provider unavailable");
    },
  });

  const meal = await service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "partial-matching-provenance",
  });
  await expect.poll(() => service.status(userId, meal.id).status).toBe("failed");

  expect(
    photoAnalysisDiagnosticsSchema.parse(
      JSON.parse(service.history(userId, meal.id)[0].diagnostics!),
    ).components[0],
  ).toMatchObject({
    componentId: "rice",
    category: {
      choice: { key: "category_20", label: "Cereal Grains and Pasta" },
      confidence: 0.88,
      selectedProbability: 0.76,
    },
    product: null,
    fallbackReason: null,
  });
});

test("corrections retain matching diagnostics beside every successful revision", async () => {
  let call = 0;
  const { service, userId } = await setup({
    analyze: async () => categoryFallbackOutcome(++call === 1 ? 0.8 : 0.65),
  });
  const meal = await service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "provenance-revision-one",
  });
  await expect.poll(() => service.status(userId, meal.id).status).toBe("succeeded");
  await service.correct(userId, service.status(userId, meal.id).entryId!, {
    correction: "The rice portion is smaller",
    idempotencyKey: "provenance-revision-two",
  });
  await expect.poll(() => service.status(userId, meal.id).status).toBe("succeeded");

  const history = service.history(userId, meal.id);
  expect(history).toHaveLength(2);
  expect(history.map((attempt) =>
    photoAnalysisDiagnosticsSchema.parse(
      JSON.parse(attempt.diagnostics!),
    ).components[0].category.selectedProbability,
  )).toEqual([0.8, 0.65]);
  expect(() => service.history(userId + 1, meal.id)).toThrow(
    "Photo meal unavailable",
  );
});

test("unbounded or sensitive diagnostic fields fail closed without being persisted", async () => {
  const outcome = categoryFallbackOutcome() as ReturnType<typeof categoryFallbackOutcome> & {
    diagnostics: ReturnType<typeof categoryFallbackOutcome>["diagnostics"] & {
      authorizationHeader?: string;
    };
  };
  outcome.diagnostics.authorizationHeader = "Bearer secret-provider-token";
  const { service, userId } = await setup({ analyze: async () => outcome });
  const meal = await service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "sensitive-provenance",
  });
  await expect.poll(() => service.status(userId, meal.id).status).toBe("failed");

  expect(JSON.stringify(service.history(userId, meal.id))).not.toContain(
    "secret-provider-token",
  );
});

test("matching provenance rejects more than five retained candidates", async () => {
  const outcome = categoryFallbackOutcome();
  outcome.diagnostics.components[0].category.topCandidates.push(
    ...Array.from({ length: 4 }, (_, index) => ({
      key: `category_${index + 30}`,
      label: `Extra category ${index + 1}`,
      probability: 0,
    })),
  );
  const { service, userId } = await setup({ analyze: async () => outcome });
  const meal = await service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "unbounded-candidate-provenance",
  });
  await expect.poll(() => service.status(userId, meal.id).status).toBe("failed");

  expect(service.history(userId, meal.id)[0].diagnostics).toBeNull();
});

test("upgrading a legacy photo revision keeps it readable with honest provenance state", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "photo-provenance-migration-"));
  directories.push(directory);
  const databasePath = path.join(directory, "application.sqlite");
  const previousMigrations = await createMigrationFolder(
    path.join(directory, "previous-migrations"),
    { throughTag: "0018_sloppy_bromley" },
  );
  const previous = openApplicationDatabase({
    databasePath,
    migrationsFolder: previousMigrations,
  });
  const client = previous.getClient();
  const userId = client.get<{ id: number }>(sql`
    INSERT INTO users (username_normalized, created_at)
    VALUES ('legacy.photo', '2026-09-01T12:00:00.000Z')
    RETURNING id
  `).id;
  client.run(sql`
    INSERT INTO user_preferences (
      user_id, display_units, time_zone, created_at, updated_at
    ) VALUES (
      ${userId}, 'metric', 'America/New_York',
      '2026-09-01T12:00:00.000Z', '2026-09-01T12:00:00.000Z'
    )
  `);
  const entryId = client.get<{ id: number }>(sql`
    INSERT INTO food_entries (
      user_id, food_log_date, local_event_time, provider, provider_food_id,
      source_data_type, original_name, authoritative_base_unit,
      authoritative_base_quantity_microunits, authoritative_nutrition,
      selected_measurement_id, selected_measurement_label,
      selected_measurement_unit, selected_measurement_base_quantity_microunits,
      supported_measurements, quantity_microunits,
      authoritative_energy_milli_kcal, authoritative_protein_milligrams,
      authoritative_carbohydrate_milligrams, authoritative_fat_milligrams,
      idempotency_key, created_at, updated_at
    ) VALUES (
      ${userId}, '2026-09-01', '12:00:00', 'ai-photo',
      'legacy-photo-meal', 'AI analysis', 'Rice plate', 'serving', 1000000,
      ${JSON.stringify({
        carbohydrateMilligrams: { amount: 50_000, fixedPointMultiplier: 1 },
        energyMilliKcal: { amount: 250_000, fixedPointMultiplier: 1 },
        fatMilligrams: { amount: 2_000, fixedPointMultiplier: 1 },
        fiberMilligrams: null,
        proteinMilligrams: { amount: 5_000, fixedPointMultiplier: 1 },
        sodiumMilligrams: null,
        sugarMilligrams: null,
      })},
      'plate', '1 analyzed plate', 'serving', 1000000,
      ${JSON.stringify([{
        baseQuantityMicrounits: 1_000_000,
        id: "plate",
        label: "1 analyzed plate",
        unit: "serving",
      }])},
      1000000, 250000, 5000, 50000, 2000, 'photo:legacy-photo-meal',
      '2026-09-01T12:00:00.000Z', '2026-09-01T12:00:01.000Z'
    ) RETURNING id
  `).id;
  client.run(sql`
    INSERT INTO photo_meals (
      id, user_id, entry_id, food_log_date, local_event_time,
      photo, mime_type, created_at
    ) VALUES (
      'legacy-photo-meal', ${userId}, ${entryId}, '2026-09-01', '12:00:00',
      ${photo.bytes}, 'image/png', '2026-09-01T12:00:00.000Z'
    )
  `);
  client.run(sql`
    INSERT INTO photo_attempts (
      id, meal_id, user_id, idempotency_key, status, stage, correction,
      evidence, result, error, started_at, finished_at
    ) VALUES (
      'legacy-photo-attempt', 'legacy-photo-meal', ${userId}, 'legacy-photo-key',
      'succeeded', 'Preparing result', NULL, '[]', ${JSON.stringify(estimate())},
      NULL, '2026-09-01T12:00:00.000Z', '2026-09-01T12:00:01.000Z'
    )
  `);
  previous.close();

  const upgraded = openApplicationDatabase({
    databasePath,
    migrationsFolder: path.resolve("drizzle"),
  });
  databases.push(upgraded);
  const service = new PhotoAnalysisService(upgraded.getClient(), {
    analyze: async () => estimate(300),
  });
  services.push(service);
  const entries = new FoodEntryService(
    upgraded.getClient(),
    { getFood: async () => { throw new Error("Legacy snapshot should be self-contained"); } },
    () => new Date("2026-09-05T12:00:00.000Z"),
  );

  expect(service.view(userId, "legacy-photo-meal")).toMatchObject({
    provenanceState: "legacy",
    result: { name: "Rice plate" },
    energyMilliKcal: 250000,
  });
  expect(service.history(userId, "legacy-photo-meal")[0].diagnostics).toBeNull();
  await service.correct(userId, entryId, {
    correction: "Use the corrected legacy portion",
    idempotencyKey: "legacy-photo-correction",
  });
  await expect.poll(
    () => service.status(userId, "legacy-photo-meal").status,
  ).toBe("succeeded");
  expect(service.status(userId, "legacy-photo-meal").entryId).toBe(entryId);
  expect(entries.read(userId, entryId).energyMilliKcal).toBe(300000);

  const corrected = entries.read(userId, entryId);
  const edited = entries.update(userId, entryId, {
    foodLogDate: corrected.foodLogDate,
    expectedUpdatedAt: corrected.updatedAt,
    quantity: "1",
    selectedMeasurementId: "plate",
    name: "Edited legacy plate",
  });
  expect(edited.name).toBe("Edited legacy plate");
  expect(entries.copyToToday(userId, entryId, {
    foodLogDate: edited.foodLogDate,
    idempotencyKey: `copy:${entryId}:legacy-photo`,
  })).toMatchObject({ name: "Edited legacy plate", energyMilliKcal: 300000 });

  service.delete(userId, "legacy-photo-meal");
  expect(() => service.view(userId, "legacy-photo-meal")).toThrow(
    "Photo meal unavailable",
  );
});

test("AI can revise USDA searches while authoritative records determine nutrition and the consumed fraction applies once", async () => {
  const { service, log, userId } = await setup(
    {
      analyze: async ({ usda }) => {
        await usda.search("rice raw", 1);
        await usda.search("rice cooked", 1);
        return {
          ...estimate(999),
          consumedFraction: 0.5,
          components: [
            {
              ...estimate().components[0],
              source: { kind: "usda", fdcId: "700" },
              nutrition: estimate(999).components[0].nutrition,
            },
          ],
        };
      },
    },
    { usda: usdaFixture() },
  );
  const meal = await service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "usda-backed-plate",
  });
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("succeeded");
  expect(log.read(userId, "2026-09-04")?.entries).toMatchObject([
    {
      energyMilliKcal: 130000,
      proteinMilligrams: 2700,
      carbohydrateMilligrams: 28000,
      fatMilligrams: 300,
      fiberMilligrams: null,
      sugarMilligrams: 0,
    },
  ]);
  expect(service.history(userId, meal.id)[0].evidence).toContain(
    "Rice, cooked",
  );
});

test.each([
  [
    "unretrieved USDA identifier",
    () => ({
      ...estimate(),
      components: [
        { ...estimate().components[0], source: { kind: "usda", fdcId: "999" } },
      ],
    }),
  ],
  [
    "invalid unit",
    () => ({
      ...estimate(),
      components: [{ ...estimate().components[0], unit: "cups" }],
    }),
  ],
  ["negative calories", () => estimate(-1)],
  ["storage overflow", () => estimate(1000000)],
  [
    "duplicate components",
    () => ({
      ...estimate(),
      components: [estimate().components[0], estimate().components[0]],
    }),
  ],
  [
    "dish plus its ingredient",
    () => ({
      ...estimate(),
      components: [
        {
          ...estimate().components[0],
          id: "dish",
          name: "Rice dish",
          includes: ["rice"],
        },
        estimate().components[0],
      ],
    }),
  ],
  ["no usable result", () => ({ completed: true })],
] as const)(
  "%s fails visibly without changing totals",
  async (_name, invalid) => {
    const { service, log, userId } = await setup({
      analyze: async () => invalid(),
    });
    const meal = await service.start(userId, {
      photo,
      foodLogDate: "2026-09-04",
      idempotencyKey: "invalid-result",
    });
    await expect
      .poll(() => service.status(userId, meal.id).status)
      .toBe("failed");
    expect(log.read(userId, "2026-09-04")?.entries).toHaveLength(0);
  },
);

test("invalid image data is rejected before accepting an analysis", async () => {
  const { service, userId } = await setup({ analyze: async () => estimate() });
  await expect(
    service.start(userId, {
      photo: {
        mimeType: "image/png",
        bytes: Buffer.from("this is not a photo"),
      },
      foodLogDate: "2026-09-04",
      idempotencyKey: "invalid-image",
    }),
  ).rejects.toThrow();
});

test("processing blocks entry reads, edits, copies and deletion while other meals stay available", async () => {
  let finish!: (value: unknown) => void;
  const { service, client, userId } = await setup({
    analyze: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const entries = new FoodEntryService(
    client,
    {
      getFood: async () => {
        throw new Error("Unused catalog");
      },
    },
    () => new Date("2026-09-05T03:59:00.000Z"),
  );
  const other = entries.logManual(userId, {
    name: "Other meal",
    energyKcal: "100",
    quantity: "1",
    foodLogDate: "2026-09-03",
    idempotencyKey: "other-meal",
  });
  const meal = await service.start(userId, {
    photo,
    foodLogDate: "2026-09-03",
    idempotencyKey: "entry-lock-photo",
  });
  finish(estimate());
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("succeeded");
  const entryId = service.status(userId, meal.id).entryId!;
  const before = entries.read(userId, entryId);
  await service.correct(userId, entryId, {
    correction: "Butter",
    idempotencyKey: "lock-correction",
  });
  expect(() => entries.read(userId, entryId)).toThrow();
  expect(() =>
    entries.delete(userId, entryId, {
      foodLogDate: before.foodLogDate,
      expectedUpdatedAt: before.updatedAt,
    }),
  ).toThrow();
  expect(() =>
    entries.update(userId, entryId, {
      foodLogDate: before.foodLogDate,
      expectedUpdatedAt: before.updatedAt,
      quantity: "2",
      selectedMeasurementId: "plate",
      name: "Changed",
    }),
  ).toThrow();
  expect(() =>
    entries.copyToToday(userId, entryId, {
      foodLogDate: before.foodLogDate,
      idempotencyKey: `copy:${entryId}:locked-copy`,
    }),
  ).toThrow();
  expect(entries.read(userId, other.id).energyMilliKcal).toBe(100000);
});

test("USDA components can omit model arithmetic while the saved result still contains validated nutrition", async () => {
  const { service, userId } = await setup(
    {
      analyze: async ({ usda }) => {
        await usda.detail("700");
        return {
          ...estimate(),
          components: [
            {
              ...estimate().components[0],
              source: { kind: "usda", fdcId: "700" },
              nutrition: undefined,
            },
          ],
        };
      },
    },
    { usda: usdaFixture() },
  );
  const meal = await service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "derived-nutrition",
  });
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("succeeded");
  expect(
    service.view(userId, meal.id).result?.components[0].nutrition,
  ).toMatchObject({ energyKcal: 260, proteinGrams: 5.4, fiberGrams: null });
});

test("failed corrections never erase successful USDA context or become applied correction instructions", async () => {
  const contexts: Parameters<PhotoAnalyzer["analyze"]>[0][] = [];
  const { service, userId } = await setup(
    {
      analyze: async (input) => {
        contexts.push(input);
        if (!input.currentResult) await input.usda.detail("700");
        if (input.correction === "abandoned") throw new Error("Unavailable");
        return {
          ...estimate(),
          name: input.correction ?? "Original rice",
          components: [
            {
              ...estimate().components[0],
              source: { kind: "usda", fdcId: "700" },
            },
          ],
        };
      },
    },
    { usda: usdaFixture() },
  );
  const meal = await service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "retained-reference",
  });
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("succeeded");
  const entryId = service.status(userId, meal.id).entryId!;
  for (let i = 0; i < 4; i++) {
    await service.correct(userId, entryId, {
      correction: "abandoned",
      idempotencyKey: `failed-context-${i}`,
    });
    await expect
      .poll(() => service.status(userId, meal.id).status)
      .toBe("failed");
    expect(service.view(userId, meal.id)).toMatchObject({
      result: { name: "Original rice" },
      energyMilliKcal: 260000,
    });
  }
  await service.correct(userId, entryId, {
    correction: "Use the same weighed amount",
    idempotencyKey: "retained-reference-correction",
  });
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("succeeded");
  expect(contexts.at(-1)).toMatchObject({
    previousCorrections: [],
    currentResult: { name: "Original rice" },
    evidence: [{ food: { providerFoodId: "700" } }],
  });
  expect(service.view(userId, meal.id).result?.name).toBe(
    "Use the same weighed amount",
  );
});

test("photo views use the current Food Entry name after a manual edit", async () => {
  const { service, client, userId } = await setup({
    analyze: async () => estimate(),
  });
  const meal = await service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "renamed-photo-meal",
  });
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("succeeded");
  const entryId = service.status(userId, meal.id).entryId!;
  const entries = new FoodEntryService(
    client,
    {
      getFood: async () => {
        throw new Error("Unused");
      },
    },
    () => new Date("2026-09-05T03:59:00.000Z"),
  );
  const before = entries.read(userId, entryId);
  entries.update(userId, entryId, {
    foodLogDate: before.foodLogDate,
    expectedUpdatedAt: before.updatedAt,
    quantity: "1",
    selectedMeasurementId: "plate",
    name: "Dinner rice",
  });
  expect(service.view(userId, meal.id)).toMatchObject({
    name: "Dinner rice",
    result: { name: "Rice plate" },
  });
});

test("invalid dates, keys, ownership, and stale attempt actions cannot mutate meals", async () => {
  const { service, userId } = await setup({
    analyze: () => new Promise(() => {}),
  });
  const start = async (key: string, date = "2026-09-04") =>
    await service.start(userId, { photo, foodLogDate: date, idempotencyKey: key });
  for (const key of [
    "short",
    "a".repeat(129),
    "bad space key",
    "x;bad-request",
  ])
    await expect(start(key)).rejects.toThrow();
  for (const date of ["invalid", "2026-02-30", "2026-09-05"])
    await expect(start("invalid-date-request", date)).rejects.toThrow(
      "Invalid Food Log date",
    );
  expect(() => service.list(userId, "wrong")).toThrow("Invalid Food Log date");
  await expect(
    service.start(userId + 1, {
      photo,
      foodLogDate: "2026-09-04",
      idempotencyKey: "no-time-zone",
    }),
  ).rejects.toThrow("Invalid Food Log date");
  const meal = await start("guarded-photo");
  expect(service.view(userId, meal.id)).toMatchObject({
    status: "active",
    stage: "Analyzing photo",
    energyMilliKcal: null,
    result: null,
    name: null,
  });
  expect(service.list(userId, "2026-09-04").map((item) => item.id)).toEqual([
    meal.id,
  ]);
  expect(service.list(userId + 1, "2026-09-04")).toEqual([]);
  expect(service.list(userId, "2026-09-03")).toEqual([]);
  expect(() => service.cancel(userId, meal.id, "stale")).toThrow(
    "This attempt has changed",
  );
  expect(() => service.delete(userId, meal.id)).toThrow(
    "Cancel the active analysis before deleting it",
  );
  await expect(
    service.retry(userId, meal.id, {
      attemptId: meal.attemptId,
      idempotencyKey: "active-retry",
    }),
  ).rejects.toThrow("This attempt cannot be retried");
  service.cancel(userId, meal.id, meal.attemptId);
  expect(service.status(userId, meal.id).error).toBe(
    "Analysis canceled. Retry when ready.",
  );
  await expect(
    service.retry(userId, meal.id, {
      attemptId: "stale",
      idempotencyKey: "stale-retry",
    }),
  ).rejects.toThrow("This attempt cannot be retried");
  await expect(
    service.retry(userId, meal.id, {
      attemptId: meal.attemptId,
      idempotencyKey: "bad key",
    }),
  ).rejects.toThrow();
  const other = await start("other-owned-photo");
  await expect(
    service.retry(userId, meal.id, {
      attemptId: meal.attemptId,
      idempotencyKey: "other-owned-photo",
    }),
  ).rejects.toThrow("Request key belongs to another meal");
  service.cancel(userId, other.id, other.attemptId);
  service.cancel(userId, other.id, other.attemptId);
  service.delete(userId, other.id);
  expect(() => service.status(userId, other.id)).toThrow(
    "Photo meal unavailable",
  );
  expect(() => service.photo(userId, other.id)).toThrow(
    "Photo meal unavailable",
  );
});

test("completed corrections deduplicate per meal, validate text and keys, and preserve manual current context", async () => {
  const contexts: Parameters<PhotoAnalyzer["analyze"]>[0][] = [];
  const { service, userId, client } = await setup({
    analyze: async (input) => {
      contexts.push(input);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return estimate(0);
    },
  });
  const meals = await Promise.all(
    ["dedup-photo-one", "dedup-photo-two"].map(async (idempotencyKey) =>
      await service.start(userId, { photo, foodLogDate: "2026-09-04", idempotencyKey }),
    ),
  );
  await expect
    .poll(() => service.status(userId, meals[1].id).status)
    .toBe("succeeded");
  const entryId = service.status(userId, meals[0].id).entryId!;
  expect(service.view(userId, meals[0].id).energyMilliKcal).toBe(0);
  await expect(
    service.retry(userId, meals[0].id, {
      attemptId: meals[0].attemptId,
      idempotencyKey: "completed-retry",
    }),
  ).rejects.toThrow("This attempt cannot be retried");
  for (const correction of [" ", "x".repeat(2001)])
    await expect(
      service.correct(userId, entryId, {
        correction,
        idempotencyKey: "invalid-correction",
      }),
    ).rejects.toThrow();
  await expect(
    service.correct(userId, entryId, {
      correction: "valid",
      idempotencyKey: "bad key",
    }),
  ).rejects.toThrow();
  await expect(
    service.correct(userId + 1, entryId, {
      correction: "valid",
      idempotencyKey: "foreign-correction",
    }),
  ).rejects.toThrow("Photo meal unavailable");
  await expect(
    service.correct(userId, entryId, {
      correction: "valid",
      idempotencyKey: "dedup-photo-two",
    }),
  ).rejects.toThrow("Request key belongs to another meal");
  const entries = new FoodEntryService(
    client,
    {
      getFood: async () => {
        throw new Error("Unused");
      },
    },
    () => new Date("2026-09-05T03:59:05.000Z"),
  );
  const before = entries.read(userId, entryId);
  const edited = entries.update(userId, entryId, {
    foodLogDate: before.foodLogDate,
    expectedUpdatedAt: before.updatedAt,
    quantity: "2",
    selectedMeasurementId: "plate",
    name: "Edited rice",
  });
  const correction = await service.correct(userId, entryId, {
    correction: "  Add butter  ",
    idempotencyKey: "trimmed-correction",
  });
  expect(correction.stage).toBe("Analyzing photo");
  expect(
    (await service.correct(userId, entryId, {
      correction: "Add butter",
      idempotencyKey: "trimmed-correction",
    })).attemptId,
  ).toBe(correction.attemptId);
  await expect(
    service.correct(userId, entryId, {
      correction: "extra",
      idempotencyKey: "competing-correction",
    }),
  ).rejects.toThrow("Analysis is already processing");
  await expect
    .poll(() => service.status(userId, meals[0].id).status)
    .toBe("succeeded");
  expect(contexts.at(-1)).toMatchObject({
    correction: "Add butter",
    currentEntry: { editedName: "Edited rice", quantityMicrounits: 2000000 },
  });
  expect(entries.read(userId, entryId).updatedAt > edited.updatedAt).toBe(true);
  expect(
    (await service.correct(userId, entryId, {
      correction: "Add butter",
      idempotencyKey: "trimmed-correction",
    })).attemptId,
  ).toBe(correction.attemptId);
});

test("supported photo signatures and size limits are enforced before acceptance", async () => {
  const { service, userId } = await setup({ analyze: async () => estimate() });
  const jpeg = Buffer.concat([
    Buffer.from([255, 216, 255]),
    Buffer.alloc(7),
    Buffer.from([255, 217]),
  ]);
  const webp = Buffer.from("RIFF\x04\x00\x00\x00WEBP");
  const maximum = Buffer.alloc(8388608);
  photo.bytes.copy(maximum);
  for (const [index, image] of [
    { mimeType: "image/jpeg", bytes: jpeg },
    { mimeType: "image/jpeg", bytes: Buffer.concat([jpeg, Buffer.alloc(64)]) },
    { mimeType: "image/webp", bytes: webp },
    { ...photo, bytes: maximum },
  ].entries()) {
    const meal = await service.start(userId, {
      photo: image,
      foodLogDate: "2026-09-04",
      idempotencyKey: `supported-image-${index}`,
    });
    expect(service.photo(userId, meal.id).mimeType).toBe(image.mimeType);
    expect(service.photo(userId, meal.id).bytes.equals(image.bytes)).toBe(true);
  }
  const invalid = [
    { ...photo, bytes: Buffer.alloc(11) },
    { ...photo, bytes: Buffer.alloc(8388609) },
    { mimeType: "image/gif", bytes: photo.bytes },
    {
      mimeType: "image/jpeg",
      bytes: Buffer.concat([Buffer.alloc(10), Buffer.from([255, 217])]),
    },
    {
      mimeType: "image/jpeg",
      bytes: Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(9)]),
    },
    { mimeType: "image/webp", bytes: Buffer.from("RIFFxxxxxxxx") },
    { mimeType: "image/webp", bytes: Buffer.from("xxxx1234WEBP") },
  ];
  for (const [index, image] of invalid.entries())
    await expect(
      service.start(userId, {
        photo: image,
        foodLogDate: "2026-09-04",
        idempotencyKey: `unsupported-image-${index}`,
      }),
    ).rejects.toThrow(
      index < 2
        ? "Choose a photo up to 8 MB"
        : "Choose a JPEG, PNG, or WebP photo",
    );
});

test("USDA budgets permit the configured final round and forbid additional searches and details", async () => {
  const { service, userId } = await setup(
    {
      analyze: async ({ usda }) => {
        for (let i = 0; i < 3; i++)
          expect(await usda.search("rice", 1)).toHaveLength(1);
        await expect(usda.search("rice", 1)).rejects.toThrow(
          "USDA unavailable or search limit reached",
        );
        for (let i = 0; i < 6; i++)
          expect((await usda.detail("700")).food.providerFoodId).toBe("700");
        await expect(usda.detail("700")).rejects.toThrow(
          "USDA detail limit reached or unavailable",
        );
        return estimate();
      },
    },
    { usda: usdaFixture() },
  );
  const meal = await service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "bounded-usda-tools",
  });
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("succeeded");
  expect(service.history(userId, meal.id)[0]).toMatchObject({
    stage: "Preparing result",
  });
  expect(
    JSON.parse(service.history(userId, meal.id)[0].evidence),
  ).toMatchObject([{ food: { providerFoodId: "700" } }]);
  const configured = new PhotoAnalysisService(
    databases.at(-1)!.getClient(),
    {
      analyze: async ({ usda }) => {
        expect(await usda.search("rice", 1)).toHaveLength(1);
        await expect(usda.search("rice", 1)).rejects.toThrow(
          "search limit reached",
        );
        return estimate();
      },
    },
    { usda: usdaFixture(), rounds: 1 },
  );
  services.push(configured);
  const limited = await configured.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "custom-tool-budget",
  });
  await expect
    .poll(() => configured.status(userId, limited.id).status)
    .toBe("succeeded");
});

test("cancellation aborts pending USDA work and rejects late evidence without revising the terminal state", async () => {
  const evidence = await usdaFixture().getEvidence(
    "700",
    new AbortController().signal,
  );
  let finish!: (items: (typeof evidence)[]) => void;
  let input!: Parameters<PhotoAnalyzer["analyze"]>[0];
  const { service, userId } = await setup(
    {
      analyze: async (context) => {
        input = context;
        await context.usda.search("rice", 1);
        return estimate();
      },
    },
    {
      usda: {
        searchEvidence: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
        getEvidence: async () => evidence,
      },
    },
  );
  const meal = await service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "cancel-usda-work",
  });
  expect(service.status(userId, meal.id).stage).toBe("Consulting USDA");
  service.cancel(userId, meal.id, meal.attemptId);
  finish([evidence]);
  await Promise.resolve();
  expect(input.signal.aborted).toBe(true);
  await expect(input.usda.search("rice", 1)).rejects.toThrow();
  await expect(input.usda.detail("700")).rejects.toThrow();
  expect(service.history(userId, meal.id)[0].evidence).toBe("[]");
  expect(service.status(userId, meal.id).status).toBe("canceled");
});

test("startup interrupts persisted active work, and late CPU-bound results cannot pass the deadline", async () => {
  const { service, userId, client } = await setup({
    analyze: () => new Promise(() => {}),
  });
  const meal = await service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "lost-on-restart",
  });
  const restarted = new PhotoAnalysisService(client, {
    analyze: async () => estimate(),
  });
  services.push(restarted);
  expect(restarted.status(userId, meal.id)).toMatchObject({
    status: "interrupted",
    error: "Server restarted. Retry this analysis.",
  });
  const slow = new PhotoAnalysisService(
    client,
    {
      analyze: async () => {
        vi.spyOn(performance, "now").mockReturnValueOnce(Infinity);
        return estimate();
      },
    },
    { deadlineMs: 5_000 },
  );
  services.push(slow);
  const late = await slow.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "cpu-bound-timeout",
  });
  await expect.poll(() => slow.status(userId, late.id).status).toBe("failed");
  expect(slow.view(userId, late.id)).toMatchObject({
    entryId: null,
    error: "Analysis timed out. Retry when ready.",
  });
  vi.restoreAllMocks();
});

test("a non-food photo remains visible as failed without creating a food entry", async () => {
  const { service, userId } = await setup({
    analyze: async () => {
      throw new NoFoodDetectedError();
    },
  });
  const meal = await service.start(userId, {
    photo, foodLogDate: "2026-09-04", idempotencyKey: "non-food-photo-test",
  });
  await expect.poll(() => service.status(userId, meal.id).status).toBe("failed");
  expect(service.view(userId, meal.id)).toMatchObject({
    entryId: null,
    error: "No food or drink detected. Try a clear photo of your meal.",
  });
  expect(service.photo(userId, meal.id).bytes).toEqual(photo.bytes);
});

test("missing USDA nutrients require explicit supplements and cannot be overridden", async () => {
  const evidence = await usdaFixture().getEvidence(
    "700",
    new AbortController().signal,
  );
  const required = [
    "energyKcal",
    "proteinGrams",
    "carbohydrateGrams",
    "fatGrams",
  ] as const;
  const keys = [
    "energyMilliKcal",
    "proteinMilligrams",
    "carbohydrateMilligrams",
    "fatMilligrams",
  ] as const;
  for (const [index, nutrient] of required.entries()) {
    const missing = structuredClone(evidence);
    missing.food.nutritionPerAuthoritativeBase[keys[index]] = null;
    const reader = {
      searchEvidence: async () => [missing],
      getEvidence: async () => missing,
    };
    for (const supplement of [false, true]) {
      const { service, userId, log } = await setup(
        {
          analyze: async ({ usda }) => {
            await usda.detail("700");
            return {
              ...estimate(),
              components: [
                {
                  ...estimate().components[0],
                  source: { kind: "usda", fdcId: "700" },
                  supplements: supplement
                    ? [
                        {
                          nutrient,
                          amount: 10,
                          reason: "Reference omits this nutrient",
                        },
                      ]
                    : [],
                },
              ],
            };
          },
        },
        { usda: reader },
      );
      const meal = await service.start(userId, {
        photo,
        foodLogDate: "2026-09-04",
        idempotencyKey: `nutrient-supplement-${index}-${supplement}`,
      });
      await expect
        .poll(() => service.status(userId, meal.id).status)
        .toBe(supplement ? "succeeded" : "failed");
      expect(log.read(userId, "2026-09-04")?.entries[0]?.[keys[index]]).toBe(
        supplement ? 10000 : undefined,
      );
    }
  }
  const { service, userId } = await setup(
    {
      analyze: async ({ usda }) => {
        await usda.detail("700");
        return {
          ...estimate(),
          components: [
            {
              ...estimate().components[0],
              source: { kind: "usda", fdcId: "700" },
              supplements: [
                { nutrient: "energyKcal", amount: 999, reason: "Override" },
              ],
            },
          ],
        };
      },
    },
    { usda: usdaFixture() },
  );
  const meal = await service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "forbidden-usda-override",
  });
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("failed");
});

test("mixed component totals retain unknown nutrients and reject duplicate names, invalid USDA units and aggregate overflow", async () => {
  const base = estimate().components[0];
  for (const [index, result, status] of [
    [
      {
        ...estimate(),
        components: [
          base,
          {
            ...base,
            id: "other",
            name: "Vegetable",
            nutrition: {
              ...base.nutrition,
              fiberGrams: 2,
              sugarGrams: 0,
              sodiumMilligrams: 50,
            },
          },
        ],
      },
      "succeeded",
    ],
    [
      {
        ...estimate(),
        components: [base, { ...base, id: "other", name: "COOKED RICE" }],
      },
      "failed",
    ],
    [{ ...estimate(), consumedFraction: 0.00000001 }, "failed"],
    [
      { ...estimate(), components: [{ ...base, nutrition: undefined }] },
      "failed",
    ],
    [
      {
        ...estimate(),
        components: [
          { ...base, unit: "ml", source: { kind: "usda", fdcId: "700" } },
        ],
      },
      "failed",
    ],
    [
      {
        ...estimate(),
        components: [
          { ...base, nutrition: { ...base.nutrition, energyKcal: 600000 } },
          {
            ...base,
            id: "second",
            name: "Second rice",
            nutrition: { ...base.nutrition, energyKcal: 600000 },
          },
        ],
      },
      "failed",
    ],
  ].map(([result, status], index) => [index, result, status] as const)) {
    const { service, userId, log } = await setup(
      {
        analyze: async ({ usda }) => {
          await usda.detail("700");
          return result;
        },
      },
      { usda: usdaFixture() },
    );
    const meal = await service.start(userId, {
      photo,
      foodLogDate: "2026-09-04",
      idempotencyKey: `mixed-validation-${index}`,
    });
    await expect
      .poll(() => service.status(userId, meal.id).status)
      .toBe(status);
    expect(log.read(userId, "2026-09-04")?.entries).toMatchObject(
      status === "succeeded"
        ? [
            {
              energyMilliKcal: 500000,
              proteinMilligrams: 10000,
              carbohydrateMilligrams: 100000,
              fatMilligrams: 4000,
              fiberMilligrams: null,
              sugarMilligrams: null,
              sodiumMilligrams: null,
            },
          ]
        : [],
    );
  }
});

test("USDA context overflow retains only the previously accepted evidence for an explicit fallback", async () => {
  const evidence = await usdaFixture().getEvidence(
    "700",
    new AbortController().signal,
  );
  const oversized = {
    ...evidence,
    food: { ...evidence.food, providerFoodId: "701" },
    record: { padding: "x".repeat(750000) },
  };
  const { service, userId } = await setup(
    {
      analyze: async ({ usda }) => {
        await usda.detail("700");
        await expect(usda.search("large result", 1)).rejects.toThrow(
          "USDA context limit reached",
        );
        return estimate();
      },
    },
    {
      usda: {
        getEvidence: async () => evidence,
        searchEvidence: async () => [oversized],
      },
    },
  );
  const meal = await service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "evidence-overflow",
  });
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("succeeded");
  expect(service.history(userId, meal.id)[0].evidence).toBe(
    JSON.stringify([evidence]),
  );
});

test("explicit retry can reuse complete evidence retrieved before an initial failure", async () => {
  let attempts = 0;
  const { service, userId } = await setup(
    {
      analyze: async ({ usda, evidence }) => {
        if (++attempts === 1) {
          await usda.detail("700");
          throw new Error("Provider interrupted");
        }
        expect(evidence.map((item) => item.food.providerFoodId)).toEqual([
          "700",
        ]);
        return {
          ...estimate(),
          components: [
            {
              ...estimate().components[0],
              source: { kind: "usda", fdcId: "700" },
            },
          ],
        };
      },
    },
    { usda: usdaFixture() },
  );
  const meal = await service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "retry-retained-evidence",
  });
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("failed");
  await service.retry(userId, meal.id, {
    attemptId: meal.attemptId,
    idempotencyKey: "retry-without-new-lookup",
  });
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("succeeded");
  expect(service.view(userId, meal.id).energyMilliKcal).toBe(260000);
});
