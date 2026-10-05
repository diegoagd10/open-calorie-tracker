import type { CatalogMeasurement, CatalogProviderId } from "./food-catalog.server";

/** What a client can ask the catalog for: a USDA search, one USDA food, or a barcode's product. */
export type FindCatalogFoods =
  | { provider: "usda-fdc"; query: string }
  | { provider: "usda-fdc"; providerFoodId: string }
  | { provider: "open-food-facts"; barcode: string };

/** Nutrition in display units (kcal, g, and mg of sodium) for a stated amount; null is unknown. */
export type DisplayNutrition = {
  energyKcal: number | null;
  proteinG: number | null;
  carbohydrateG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
};

/** One search result; open it with `get_food` to review it before logging. */
export type CatalogFoodSummary = {
  provider: CatalogProviderId;
  providerFoodId: string;
  name: string;
  brand: string | null;
  dataType: string;
  measurementSummary: string;
  isSelectable: boolean;
  publishedDate: string | null;
};

/**
 * A food as reviewed before logging: `log_food` takes its `providerFoodId`, `reviewVersion`,
 * one `measurements[].id`, and a quantity.
 */
export type ReviewableFood = Omit<CatalogFoodSummary, "measurementSummary" | "publishedDate"> & {
  /** The USDA catalog generation or Open Food Facts product fingerprint a save must match. */
  reviewVersion: string;
  barcode: string | null;
  unavailableReason: string | null;
  /** The amount `nutrition` describes, such as 100 g. */
  nutritionBasis: { quantity: number; unit: CatalogMeasurement["unit"] };
  nutrition: DisplayNutrition;
  /** Measurements to log by; `quantity` is in the basis unit. */
  measurements: Array<{ id: string; label: string; unit: CatalogMeasurement["unit"]; quantity: number }>;
};
