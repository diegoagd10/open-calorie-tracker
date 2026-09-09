import type { CatalogFood } from "./food-catalog.server";

export type UsdaEvidence = {
  food: CatalogFood;
  record: Record<string, unknown>;
};

export type UsdaAnalysisReader = {
  searchEvidence(
    query: string,
    page: number,
    signal: AbortSignal,
  ): Promise<UsdaEvidence[]>;
  getEvidence(id: string, signal: AbortSignal): Promise<UsdaEvidence>;
};
