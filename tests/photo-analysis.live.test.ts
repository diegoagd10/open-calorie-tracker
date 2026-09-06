import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { z } from "zod";
import { openApplicationDatabase } from "../app/database/database.server";
import { users, userPreferences } from "../app/database/schema.server";
import { UsdaFoodDataCentralAdapter } from "../app/catalog/usda.server";
import { PhotoAnalysisService } from "../app/photo-analysis/photo-analysis.server";
import { PiPhotoAnalyzer, piCompletion } from "../app/photo-analysis/pi.server";

const mealSchema = z.object({
  name: z.string(),
  photoPath: z.string(),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  energyKcal: z.number().positive().optional(),
  proteinGrams: z.number().nonnegative().optional(),
  carbohydrateGrams: z.number().nonnegative().optional(),
  fatGrams: z.number().nonnegative().optional(),
  corrections: z.array(z.string()).default([]),
});

test.skipIf(process.env.PHOTO_ANALYSIS_LIVE !== "1")(
  "weighed-meal pilot reports actual accuracy, latency, failures, corrections, and provider usage",
  async () => {
    const datasetPath = z
      .string()
      .min(1)
      .parse(process.env.PHOTO_PILOT_DATASET);
    const authPath = z.string().min(1).parse(process.env.PHOTO_AI_AUTH_PATH);
    const meals = z
      .array(mealSchema)
      .min(1)
      .parse(JSON.parse(await readFile(datasetPath, "utf8")));
    const directory = await mkdtemp(path.join(tmpdir(), "photo-pilot-"));
    const database = openApplicationDatabase({
      databasePath: path.join(directory, "db.sqlite"),
      migrationsFolder: path.resolve("drizzle"),
    });
    const client = database.getClient();
    const instant = new Date().toISOString();
    const userId = client
      .insert(users)
      .values({ usernameNormalized: "pilot", createdAt: instant })
      .returning()
      .get().id;
    client
      .insert(userPreferences)
      .values({
        userId,
        timeZone: "UTC",
        displayUnits: "metric",
        createdAt: instant,
        updatedAt: instant,
      })
      .run();
    const usage: unknown[] = [];
    const complete = piCompletion({
      authPath,
      provider: process.env.PHOTO_AI_PROVIDER ?? "openai-codex",
      model: process.env.PHOTO_AI_MODEL ?? "gpt-5.6-luna",
      reasoning: "low",
    });
    const service = new PhotoAnalysisService(
      client,
      new PiPhotoAnalyzer(async (context, signal) => {
        const requestStarted = performance.now();
        const result = await complete(context, signal);
        usage.push({
          ...result.usage,
          elapsedMs: Math.round(performance.now() - requestStarted),
          stopReason: result.stopReason,
          toolNames: result.content
            .filter((part) => part.type === "toolCall")
            .map((part) => part.name),
          outputCharacters: result.content
            .filter((part) => part.type === "text")
            .reduce((sum, part) => sum + part.text.length, 0),
          error: result.errorMessage
            ?.replace(/[A-Za-z0-9_./+=-]{40,}/g, "<REDACTED>")
            .slice(0, 400),
        });
        return result;
      }),
      {
        usda: new UsdaFoodDataCentralAdapter({
          apiKey: process.env.FDC_API_KEY,
        }),
      },
    );
    const results: Record<string, unknown>[] = [];
    try {
      for (const [index, meal] of meals.entries()) {
        const start = Date.now();
        const initial = service.start(userId, {
          photo: {
            bytes: await readFile(
              path.resolve(path.dirname(datasetPath), meal.photoPath),
            ),
            mimeType: meal.mimeType,
          },
          foodLogDate: new Date().toISOString().slice(0, 10),
          idempotencyKey: `pilot-meal-${index}`,
        });
        await expect
          .poll(() => service.status(userId, initial.id).status, {
            timeout: 23000,
          })
          .not.toBe("active");
        const first = service.view(userId, initial.id);
        const initialLatencyMs = Date.now() - start;
        const attempts: unknown[] = [{ ...first, result: undefined }];
        for (const [
          correctionIndex,
          correction,
        ] of meal.corrections.entries()) {
          if (first.entryId === null) break;
          service.correct(userId, first.entryId, {
            correction,
            idempotencyKey: `pilot-${index}-correction-${correctionIndex}`,
          });
          await expect
            .poll(() => service.status(userId, initial.id).status, {
              timeout: 23000,
            })
            .not.toBe("active");
          attempts.push({
            ...service.view(userId, initial.id),
            result: undefined,
          });
        }
        const result = first.result;
        const macroErrorGrams =
          result &&
          meal.proteinGrams !== undefined &&
          meal.carbohydrateGrams !== undefined &&
          meal.fatGrams !== undefined
            ? Object.fromEntries(
                (
                  ["proteinGrams", "carbohydrateGrams", "fatGrams"] as const
                ).map((key) => [
                  key,
                  result.components.reduce(
                    (sum, component) => sum + component.nutrition[key],
                    0,
                  ) *
                    result.consumedFraction -
                    meal[key]!,
                ]),
              )
            : null;
        results.push({
          name: meal.name,
          initialLatencyMs,
          initialStatus: first.status,
          initialCalorieErrorPercent:
            first.energyMilliKcal === null || meal.energyKcal === undefined
              ? null
              : (Math.abs(first.energyMilliKcal / 1000 - meal.energyKcal) /
                  meal.energyKcal) *
                100,
          macroErrorGrams,
          correctionCount: attempts.length - 1,
          attempts,
        });
      }
      const below20 = results.filter(
        (result) =>
          typeof result.initialCalorieErrorPercent === "number" &&
          result.initialCalorieErrorPercent < 20,
      ).length;
      const withinDeadline = results.filter(
        (result) =>
          result.initialStatus === "succeeded" &&
          Number(result.initialLatencyMs) <= 20000,
      ).length;
      await writeFile(
        process.env.PHOTO_PILOT_REPORT ??
          path.resolve("photo-pilot-report.json"),
        JSON.stringify(
          {
            sampleSize: meals.length,
            below20Percent: below20,
            measuredSampleSize: meals.filter(
              (meal) => meal.energyKcal !== undefined,
            ).length,
            majorityGoalMet: meals.some((meal) => meal.energyKcal !== undefined)
              ? below20 >
                meals.filter((meal) => meal.energyKcal !== undefined).length / 2
              : null,
            usableWithin20Seconds: withinDeadline,
            results,
            usage,
          },
          null,
          2,
        ),
      );
    } finally {
      service.shutdown();
      await Promise.resolve();
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  600000,
);
