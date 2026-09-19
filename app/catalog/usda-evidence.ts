import type { CatalogFood } from "./food-catalog.server";

export type UsdaEvidence = {
  food: CatalogFood;
  record: Record<string, unknown>;
};

export type UsdaPhotoAnalysisCategory = { id: string; name: string };
export type UsdaPhotoAnalysisCandidate = { fdcId: string; description: string };

export type UsdaPhotoAnalysisSnapshot = {
  readonly generation: string;
  categories(): UsdaPhotoAnalysisCategory[];
  candidates(categoryId: string): UsdaPhotoAnalysisCandidate[];
  evidence(fdcId: string): UsdaEvidence;
};

export type UsdaPhotoAnalysisReadiness =
  | { state: "not-installed" }
  | { state: "reimport-required"; generation: string }
  | { state: "unavailable"; generation: string }
  | { state: "ready"; generation: string };

export type UsdaPhotoAnalysisCatalog = {
  photoAnalysisReadiness(): Promise<UsdaPhotoAnalysisReadiness>;
  withPhotoAnalysisSnapshot<T>(
    signal: AbortSignal,
    read: (snapshot: UsdaPhotoAnalysisSnapshot) => Promise<T> | T,
  ): Promise<T>;
};

export type UsdaAnalysisReader = {
  searchEvidence(
    query: string,
    page: number,
    signal: AbortSignal,
  ): Promise<UsdaEvidence[]>;
  getEvidence(id: string, signal: AbortSignal): Promise<UsdaEvidence>;
};
