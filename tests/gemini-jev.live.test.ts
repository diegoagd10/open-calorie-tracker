import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { expect, test } from "vitest";
import { z } from "zod";
import { CatalogManagement } from "../app/catalog-management/catalog-management.server";
import { LocalUsdaAdapter } from "../app/catalog/local-usda.server";
import { openApplicationDatabase } from "../app/database/database.server";
import {
  GeminiHttpMealClient,
  JevHttpChoiceClient,
} from "../app/photo-analysis/gemini-jev-clients.server";
import { GeminiJevPhotoAnalyzer } from "../app/photo-analysis/gemini-jev.server";
import { RemotePhotoAnalysisModelDiscovery } from "../app/photo-analysis/model-discovery.server";
import { NoFoodDetectedError } from "../app/photo-analysis/result.server";

const mimeTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);

function analysisInput(photo: { bytes: Buffer; mimeType: z.infer<typeof mimeTypeSchema> }) {
  return {
    photo,
    signal: new AbortController().signal,
    previousCorrections: [],
    evidence: [],
    usda: {
      search: async () => [],
      detail: async () => {
        throw new Error("Unused legacy catalog seam");
      },
    },
  };
}

test.skipIf(process.env.PHOTO_ANALYSIS_LIVE !== "1")(
  "real Gemini and Jev pass the production food, non-food, model, provenance, and deadline smoke",
  async () => {
    const geminiKey = z.string().min(8).parse(process.env.GEMINI_API_KEY);
    const typeSafeKey = z.string().min(8).parse(process.env.TYPESAFE_API_KEY);
    const archivePath = path.resolve(
      z.string().min(1).parse(process.env.PHOTO_ANALYSIS_USDA_ARCHIVE),
    );
    const foodPath = path.resolve(
      z.string().min(1).parse(process.env.PHOTO_ANALYSIS_FOOD_IMAGE),
    );
    const nonFoodPath = path.resolve(
      z.string().min(1).parse(process.env.PHOTO_ANALYSIS_NON_FOOD_IMAGE),
    );
    const foodMimeType = mimeTypeSchema.parse(
      process.env.PHOTO_ANALYSIS_FOOD_MIME_TYPE ?? "image/jpeg",
    );
    const nonFoodMimeType = mimeTypeSchema.parse(
      process.env.PHOTO_ANALYSIS_NON_FOOD_MIME_TYPE ?? "image/jpeg",
    );
    const geminiModel = process.env.PHOTO_ANALYSIS_GEMINI_MODEL ?? "gemini-3.1-flash-lite";
    const jevModel = process.env.PHOTO_ANALYSIS_JEV_MODEL ?? "jev-1.13.0";
    const discovery = new RemotePhotoAnalysisModelDiscovery();
    const discoverySignal = AbortSignal.timeout(5_000);
    const [geminiModels, jevModels] = await Promise.all([
      discovery.discoverGemini(geminiKey, discoverySignal),
      discovery.discoverJev(typeSafeKey, discoverySignal),
    ]);
    expect(geminiModels.some(model => model.id === geminiModel)).toBe(true);
    expect(jevModels.some(model => model.effectiveId === jevModel)).toBe(true);

    const directory = await mkdtemp(path.join(tmpdir(), "photo-analysis-live-"));
    const database = openApplicationDatabase({
      databasePath: path.join(directory, "db.sqlite"),
      migrationsFolder: path.resolve("drizzle"),
    });
    const catalogDirectory = path.join(directory, "catalogs");
    const management = new CatalogManagement(database.getClient(), {
      directory: catalogDirectory,
      workerPath: path.resolve("app/catalog-management/import-worker.ts"),
    });

    try {
      await management.submitArchive({
        filename: path.basename(archivePath),
        stream: Readable.from(await readFile(archivePath)),
      });
      await expect.poll(() => management.read().busy, { timeout: 120_000 }).toBe(false);
      expect(management.read().job?.phase).toBe("succeeded");
      const analyzer = new GeminiJevPhotoAnalyzer(
        new GeminiHttpMealClient(geminiKey),
        new JevHttpChoiceClient(typeSafeKey),
        new LocalUsdaAdapter(management, catalogDirectory),
        { geminiModel, jevModel, deadlineMs: 10_000 },
      );

      const foodStarted = performance.now();
      const analysis = await analyzer.analyzeWithDiagnostics(analysisInput({
        bytes: await readFile(foodPath),
        mimeType: foodMimeType,
      }));
      expect(performance.now() - foodStarted).toBeLessThanOrEqual(5_500);
      expect(analysis.result.components.length).toBeGreaterThan(0);
      expect(analysis.diagnostics).toMatchObject({ geminiModel, jevModel });
      expect(analysis.diagnostics.components).toHaveLength(
        analysis.result.components.length,
      );
      const provenance = analysis.result.components.map((component, index) => {
        const diagnostic = analysis.diagnostics.components[index];
        return component.source.kind === "usda"
          ? {
              componentIdMatches: diagnostic.componentId === component.id,
              kind: "usda" as const,
              sourceValid: /^[1-9]\d*$/u.test(component.source.fdcId),
              diagnosticMatches:
                diagnostic.fallbackReason === null &&
                diagnostic.product?.choice.key === `food_${component.source.fdcId}`,
            }
          : {
              componentIdMatches: diagnostic.componentId === component.id,
              kind: "ai" as const,
              sourceValid: component.source.reason.length > 0,
              diagnosticMatches:
                diagnostic.fallbackReason?.message === component.source.reason,
            };
      });
      expect(provenance.every(item => item.componentIdMatches)).toBe(true);
      expect(provenance.every(item => item.sourceValid)).toBe(true);
      expect(provenance.every(item => item.diagnosticMatches)).toBe(true);

      const nonFoodStarted = performance.now();
      await expect(analyzer.analyze(analysisInput({
        bytes: await readFile(nonFoodPath),
        mimeType: nonFoodMimeType,
      }))).rejects.toBeInstanceOf(NoFoodDetectedError);
      expect(performance.now() - nonFoodStarted).toBeLessThanOrEqual(5_500);
    } finally {
      await management.shutdown();
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  180_000,
);
