import { z } from "zod";
import {
  usdaEvidenceSchema,
  type UsdaEvidence,
} from "../catalog/usda-evidence";
import type { PhotoResult } from "./result.server";

const MAX_DIAGNOSTICS_BYTES = 32_768;
const identifier = z.string().min(1).max(100).regex(/^[A-Za-z0-9._:-]+$/u);
const label = z.string().trim().min(1).max(500);
const probability = z.number().finite().min(0).max(1);

export const PHOTO_ANALYSIS_FALLBACK_REASONS = {
  "category-none": {
    code: "category-none",
    message: "No USDA category adequately matched the visible component.",
  },
  "category-low-confidence": {
    code: "category-low-confidence",
    message: "USDA category confidence was below the configured threshold.",
  },
  "missing-grams": {
    code: "missing-grams",
    message: "Gemini could not provide a defensible gram estimate.",
  },
  "inadequate-candidates": {
    code: "inadequate-candidates",
    message: "No adequate USDA candidate was available in the selected category.",
  },
  "product-none": {
    code: "product-none",
    message: "No USDA record adequately matched the visible component.",
  },
  "product-low-confidence": {
    code: "product-low-confidence",
    message: "USDA record confidence was below the configured threshold.",
  },
} as const;
export type PhotoAnalysisFallbackReasonCode =
  keyof typeof PHOTO_ANALYSIS_FALLBACK_REASONS;
export type PhotoAnalysisFallbackReason =
  (typeof PHOTO_ANALYSIS_FALLBACK_REASONS)[PhotoAnalysisFallbackReasonCode];

const fallbackReasonSchema = z
  .object({
    code: z.enum(Object.keys(PHOTO_ANALYSIS_FALLBACK_REASONS) as [
      PhotoAnalysisFallbackReasonCode,
      ...PhotoAnalysisFallbackReasonCode[],
    ]),
    message: label,
  })
  .strict()
  .refine(
    ({ code, message }) =>
      PHOTO_ANALYSIS_FALLBACK_REASONS[code].message === message,
    "Fallback reason must use the canonical explanation",
  );

const candidateSchema = z
  .object({ key: identifier, label, probability })
  .strict();

const choiceSchema = z
  .object({
    choice: z.object({ key: identifier, label }).strict(),
    confidence: probability,
    selectedProbability: probability,
    topCandidates: z.array(candidateSchema).min(1).max(5),
  })
  .strict()
  .superRefine((value, context) => {
    const keys = value.topCandidates.map((candidate) => candidate.key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: "custom", message: "Candidate keys must be unique" });
    }
    const selected = value.topCandidates.find(
      (candidate) => candidate.key === value.choice.key,
    );
    if (
      !selected ||
      selected.label !== value.choice.label ||
      selected.probability !== value.selectedProbability
    ) {
      context.addIssue({
        code: "custom",
        message: "The selected choice must be retained in the bounded candidates",
      });
    }
  });

export const photoAnalysisDiagnosticsSchema = z
  .object({
    catalogGeneration: identifier.nullable(),
    geminiModel: identifier,
    jevModel: identifier,
    categoryConfidenceThreshold: probability,
    productConfidenceThreshold: probability,
    components: z
      .array(
        z
          .object({
            componentId: identifier,
            category: choiceSchema,
            product: choiceSchema.nullable(),
            fallbackReason: fallbackReasonSchema.nullable(),
          })
          .strict(),
      )
      .max(8),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.components.map((component) => component.componentId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: "Component diagnostics must be unique" });
    }
  });

export type PhotoAnalysisDiagnostics = z.infer<
  typeof photoAnalysisDiagnosticsSchema
>;

export type PhotoAnalysisConfigurationSnapshot = Pick<
  PhotoAnalysisDiagnostics,
  | "geminiModel"
  | "jevModel"
  | "categoryConfidenceThreshold"
  | "productConfidenceThreshold"
>;

const configurationSnapshotSchema = z
  .object({
    geminiModel: identifier,
    jevModel: identifier,
    categoryConfidenceThreshold: probability,
    productConfidenceThreshold: probability,
  })
  .strict();

export type PhotoAnalysisOutcome = {
  kind: "photo-analysis-outcome";
  result: unknown;
  evidence: UsdaEvidence[];
  diagnostics: PhotoAnalysisDiagnostics;
};

const outcomeSchema = z
  .object({
    kind: z.literal("photo-analysis-outcome"),
    result: z.unknown(),
    evidence: z.array(usdaEvidenceSchema).max(8),
    diagnostics: photoAnalysisDiagnosticsSchema,
  })
  .strict();

export function parsePhotoAnalysisOutcome(
  value: unknown,
): PhotoAnalysisOutcome | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("kind" in value) ||
    value.kind !== "photo-analysis-outcome"
  ) {
    return null;
  }
  return outcomeSchema.parse(value);
}

export function serializePhotoAnalysisDiagnostics(
  diagnostics: unknown,
  result: PhotoResult,
  evidence: UsdaEvidence[],
): string {
  const parsed = photoAnalysisDiagnosticsSchema.parse(diagnostics);
  validateCompletedDiagnostics(parsed, result);
  validateCapturedEvidence(parsed, result, evidence);
  return encodePhotoAnalysisDiagnostics(parsed);
}

function validateCompletedDiagnostics(
  diagnostics: PhotoAnalysisDiagnostics,
  result: PhotoResult,
) {
  if (
    diagnostics.catalogGeneration === null ||
    diagnostics.components.length === 0
  ) {
    throw new Error("Completed matching diagnostics are incomplete");
  }
  const componentIds = result.components.map((component) => component.id);
  if (
    diagnostics.components
      .map((component) => component.componentId)
      .join("\0") !==
    componentIds.join("\0")
  ) {
    throw new Error("Matching diagnostics do not describe the analyzed components");
  }
  for (const [index, component] of result.components.entries()) {
    validateComponentDiagnostic(component, diagnostics.components[index]);
  }
}

function validateComponentDiagnostic(
  component: PhotoResult["components"][number],
  diagnostic: PhotoAnalysisDiagnostics["components"][number],
) {
  if (component.source.kind === "usda") {
    if (
      diagnostic.fallbackReason !== null ||
      diagnostic.product?.choice.key !== `food_${component.source.fdcId}`
    ) {
      throw new Error("USDA provenance does not match the analyzed result");
    }
    return;
  }
  if (
    diagnostic.fallbackReason === null ||
    diagnostic.fallbackReason.message !== component.source.reason
  ) {
    throw new Error("Gemini fallback provenance does not match the analyzed result");
  }
}

function validateCapturedEvidence(
  diagnostics: PhotoAnalysisDiagnostics,
  result: PhotoResult,
  evidence: UsdaEvidence[],
) {
  const capturedIds = new Set(
    evidence.map((item) => item.food.providerFoodId),
  );
  for (const component of result.components) {
    if (
      component.source.kind === "usda" &&
      !capturedIds.has(component.source.fdcId)
    ) {
      throw new Error("USDA provenance is missing its captured evidence");
    }
  }
  if (
    evidence.some(
      (item) =>
        item.food.catalogGeneration !== undefined &&
        item.food.catalogGeneration !== diagnostics.catalogGeneration,
    )
  ) {
    throw new Error("USDA provenance mixes catalog generations");
  }
}

export function serializePhotoAnalysisProgress(diagnostics: unknown): string {
  const parsed = photoAnalysisDiagnosticsSchema.parse(diagnostics);
  if (parsed.catalogGeneration === null || parsed.components.length === 0) {
    throw new Error("Matching progress is incomplete");
  }
  return encodePhotoAnalysisDiagnostics(parsed);
}

function encodePhotoAnalysisDiagnostics(
  diagnostics: PhotoAnalysisDiagnostics,
): string {
  const encoded = JSON.stringify(diagnostics);
  if (Buffer.byteLength(encoded, "utf8") > MAX_DIAGNOSTICS_BYTES) {
    throw new Error("Matching diagnostics exceed the storage limit");
  }
  return encoded;
}

export function serializePhotoAnalysisConfiguration(
  configuration: unknown,
): string {
  const parsed = configurationSnapshotSchema.parse(configuration);
  return JSON.stringify({
    ...parsed,
    catalogGeneration: null,
    components: [],
  });
}

export function hasRecordedPhotoAnalysisProvenance(
  value: string | null,
): boolean {
  if (value === null || Buffer.byteLength(value, "utf8") > MAX_DIAGNOSTICS_BYTES) {
    return false;
  }
  try {
    photoAnalysisDiagnosticsSchema.parse(JSON.parse(value));
    return true;
  } catch {
    return false;
  }
}
