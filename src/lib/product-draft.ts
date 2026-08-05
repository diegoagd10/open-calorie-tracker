import { normalizeProductDraft, type ProductDraft } from "./domain";

export type ProductDraftSource = "manual" | (string & {});

export interface ProductDraftProvider {
  readonly source: ProductDraftSource;
  toDraft(input: unknown): ProductDraft;
}

// Future barcode, label, and image providers can implement this contract
// without changing product persistence or historical food snapshots.
export const manualProductDraftProvider: ProductDraftProvider = {
  source: "manual",
  toDraft: normalizeProductDraft,
};
