import path from "node:path";
import { z } from "zod";
import { getApplicationDatabase } from "../database/runtime.server";
import type { ApplicationDatabaseClient } from "../database/database.server";
import { UsdaFoodDataCentralAdapter } from "../catalog/usda.server";
import { PhotoAnalysisService } from "./photo-analysis.server";
import { PiPhotoAnalyzer, piCompletion } from "./pi.server";
import { TestPhotoAnalyzer } from "./test-fixture.server";

const environmentSchema = z.object({
  PHOTO_AI_PROVIDER: z.string().min(1).default("openai-codex"),
  PHOTO_AI_MODEL: z.string().min(1).default("gpt-5.6-luna"),
  PHOTO_AI_REASONING: z
    .enum(["minimal", "low", "medium", "high"])
    .default("low"),
  PHOTO_AI_AUTH_PATH: z
    .string()
    .min(1)
    .default(path.resolve("data/pi/auth.json")),
  PHOTO_AI_USDA_ROUNDS: z.coerce.number().int().min(1).max(5).default(3),
  FDC_API_KEY: z.string().optional(),
  FDC_BASE_URL: z.string().url().optional(),
  PHOTO_ANALYSIS_TEST_FIXTURE: z.enum(["0", "1"]).optional(),
  FOOD_LOG_TEST_NOW: z.string().optional(),
});
let current:
  | { db: ApplicationDatabaseClient; service: PhotoAnalysisService }
  | undefined;

export function getPhotoAnalysisService() {
  const db = getApplicationDatabase().getClient();
  if (current?.db === db) return current.service;
  const config = environmentSchema.parse(process.env);
  const test = process.env.NODE_ENV === "test";
  const service = new PhotoAnalysisService(
    db,
    test && config.PHOTO_ANALYSIS_TEST_FIXTURE === "1"
      ? new TestPhotoAnalyzer()
      : new PiPhotoAnalyzer(
          piCompletion({
            authPath: config.PHOTO_AI_AUTH_PATH,
            provider: config.PHOTO_AI_PROVIDER,
            model: config.PHOTO_AI_MODEL,
            reasoning: config.PHOTO_AI_REASONING,
          }),
        ),
    {
      now:
        test && config.FOOD_LOG_TEST_NOW
          ? () => new Date(config.FOOD_LOG_TEST_NOW!)
          : undefined,
      usda: new UsdaFoodDataCentralAdapter({
        apiKey: config.FDC_API_KEY,
        baseUrl: config.FDC_BASE_URL,
      }),
      rounds: config.PHOTO_AI_USDA_ROUNDS,
    },
  );
  current = { db, service };
  return service;
}

export function shutdownPhotoAnalysis() {
  current?.service.shutdown();
  current = undefined;
}
