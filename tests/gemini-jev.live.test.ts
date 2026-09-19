import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { expect, test } from "vitest";
import { z } from "zod";
import { CatalogManagement } from "../app/catalog-management/catalog-management.server";
import { LocalUsdaAdapter } from "../app/catalog/local-usda.server";
import { openApplicationDatabase } from "../app/database/database.server";
import { GeminiHttpMealClient, JevHttpChoiceClient } from "../app/photo-analysis/gemini-jev-clients.server";
import { GeminiJevPhotoAnalyzer } from "../app/photo-analysis/gemini-jev.server";

test.skipIf(process.env.PHOTO_GEMINI_JEV_LIVE !== "1")(
  "a credentialed Gemini/Jev request can use an installed Foundation generation",
  async () => {
    const geminiKey = z.string().min(8).parse(process.env.GEMINI_API_KEY);
    const typesafeKey = z.string().min(8).parse(process.env.TYPESAFE_API_KEY);
    const archivePath = path.resolve(z.string().min(1).parse(process.env.PHOTO_GEMINI_JEV_USDA_ARCHIVE));
    const photoPath = path.resolve(z.string().min(1).parse(process.env.PHOTO_GEMINI_JEV_FOOD_IMAGE));
    const mimeType = z.enum(["image/jpeg", "image/png", "image/webp"])
      .parse(process.env.PHOTO_GEMINI_JEV_FOOD_MIME_TYPE ?? "image/jpeg");
    const directory = await mkdtemp(path.join(tmpdir(), "gemini-jev-live-"));
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
        new JevHttpChoiceClient(typesafeKey),
        new LocalUsdaAdapter(management, catalogDirectory),
      );

      const analysis = await analyzer.analyzeWithDiagnostics({
        photo: { bytes: await readFile(photoPath), mimeType },
        signal: new AbortController().signal,
        previousCorrections: [],
        evidence: [],
        usda: {
          search: async () => [],
          detail: async () => { throw new Error("unused legacy catalog seam"); },
        },
      });

      expect(z.object({ components: z.array(z.unknown()).min(1) }).parse(analysis.result).components)
        .not.toHaveLength(0);
      expect(analysis.diagnostics.components.length).toBeGreaterThan(0);
    } finally {
      await management.shutdown();
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  180_000,
);
