import { z } from "zod";
import { foundationCatalogFoodSchema } from "../database/usda-foundation-schema.server";
import type { CatalogFood } from "./food-catalog.server";

export type UsdaEvidence = {
  food: CatalogFood;
  record: Record<string, unknown>;
};

const identifier = z.string().min(1).max(100).regex(/^[A-Za-z0-9._:-]+$/u);
const label = z.string().trim().min(1).max(500);
const boundedNumber = z.number().finite().nonnegative().max(999_999_999);
const nullableText = z.string().max(500).nullable();

export const usdaEvidenceSchema = z
  .object({
    food: foundationCatalogFoodSchema,
    record: z
      .object({
        dataType: z.literal("Foundation").optional(),
        description: label,
        fdcId: z.number().int().positive(),
        nutrientsPer100g: z
          .object({
            carbohydrateGrams: boundedNumber.nullable(),
            energyKcal: boundedNumber.nullable(),
            fatGrams: boundedNumber.nullable(),
            fiberGrams: boundedNumber.nullable(),
            proteinGrams: boundedNumber.nullable(),
            sodiumMilligrams: boundedNumber.nullable(),
            sugarGrams: boundedNumber.nullable(),
          })
          .strict()
          .optional(),
        publicationDate: nullableText.optional(),
        supportedPortions: z
          .array(
            z
              .object({
                gramWeight: boundedNumber,
                id: identifier,
                label,
              })
              .strict(),
          )
          .max(100)
          .optional(),
      })
      .strict(),
  })
  .strict()
  .refine(
    ({ food, record }) => String(record.fdcId) === food.providerFoodId,
    "Captured USDA evidence must describe one FDC identity",
  );

export type UsdaPhotoAnalysisCategory = { id: string; name: string };
export type UsdaPhotoAnalysisCandidate = { fdcId: string; description: string };

export type UsdaPhotoAnalysisSnapshot = {
  readonly generation: string;
  categories: () => UsdaPhotoAnalysisCategory[];
  candidates: (categoryId: string) => UsdaPhotoAnalysisCandidate[];
  evidence: (fdcId: string) => UsdaEvidence;
};

export type UsdaPhotoAnalysisReadiness =
  | { state: "not-installed" }
  | { state: "reimport-required"; generation: string }
  | { state: "unavailable"; generation: string }
  | { state: "ready"; generation: string };

export type UsdaPhotoAnalysisCatalog = {
  photoAnalysisReadiness: () => Promise<UsdaPhotoAnalysisReadiness>;
  withPhotoAnalysisSnapshot: <T>(
    signal: AbortSignal,
    read: (snapshot: UsdaPhotoAnalysisSnapshot) => Promise<T> | T,
  ) => Promise<T>;
};

export type UsdaAnalysisReader = {
  searchEvidence(
    query: string,
    page: number,
    signal: AbortSignal,
  ): Promise<UsdaEvidence[]>;
  getEvidence(id: string, signal: AbortSignal): Promise<UsdaEvidence>;
};
