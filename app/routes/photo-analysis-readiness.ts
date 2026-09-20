import type {
  PhotoAnalysisReadiness,
  PhotoAnalysisReadinessCode,
} from "../photo-analysis/readiness.server";

export type PresentedPhotoAnalysisReadiness =
  | { state: "ready" }
  | { state: "unavailable"; reason: string; destination?: string };

const administratorPresentation: Record<
  PhotoAnalysisReadinessCode,
  { reason: string; destination: string }
> = {
  "missing-credentials": {
    reason: "Configure Gemini and TypeSafe credentials.",
    destination: "/settings/ai",
  },
  "unreadable-credentials": {
    reason: "Repair the Photo Analysis credential encryption setup.",
    destination: "/settings/ai",
  },
  "unavailable-models": {
    reason: "Refresh the selected Gemini and Jev models.",
    destination: "/settings/ai",
  },
  "catalog-not-installed": {
    reason: "Install USDA Foundation for Photo Analysis.",
    destination: "/settings/catalogs",
  },
  "catalog-reimport-required": {
    reason: "Reimport USDA Foundation for Photo Analysis.",
    destination: "/settings/catalogs",
  },
  "catalog-unavailable": {
    reason: "Repair or reimport USDA Foundation for Photo Analysis.",
    destination: "/settings/catalogs",
  },
};

export function presentPhotoAnalysisReadiness(
  readiness: Extract<PhotoAnalysisReadiness, { state: "unavailable" }>,
  role: "admin" | "member",
): Extract<PresentedPhotoAnalysisReadiness, { state: "unavailable" }>;
export function presentPhotoAnalysisReadiness(
  readiness: PhotoAnalysisReadiness,
  role: "admin" | "member",
): PresentedPhotoAnalysisReadiness;
export function presentPhotoAnalysisReadiness(
  readiness: PhotoAnalysisReadiness,
  role: "admin" | "member",
): PresentedPhotoAnalysisReadiness {
  if (readiness.state === "ready") return readiness;
  if (role === "member") {
    return {
      state: "unavailable",
      reason: "AI photo analysis is not available right now.",
    };
  }
  const presentation = administratorPresentation[readiness.code];
  return {
    state: "unavailable",
    reason: readiness.detail ?? presentation.reason,
    destination: presentation.destination,
  };
}
