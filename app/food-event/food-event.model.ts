import type {
  CatalogFood,
  CatalogMeasurement,
  CatalogNutrition,
  CatalogSearchResult,
} from "../catalog/food-catalog.server";
import type { buildCalendarMonth } from "../shared/local-date";

export type CalendarMonth = ReturnType<typeof buildCalendarMonth>;

export type FoodProvider = "usda-fdc" | "open-food-facts" | "manual";

/** Decimal text, greater than 0 and at most 99, with at most six decimals (micro-units). */
export type Quantity = string;

/** Stored nutrients: integer milli-kilocalories or milligrams. */
export type Nutrient =
  | "energyMilliKcal"
  | "proteinMilligrams"
  | "carbohydrateMilligrams"
  | "fatMilligrams"
  | "fiberMilligrams"
  | "sugarMilligrams"
  | "sodiumMilligrams";

/** Entered nutrients as decimal text in display units: kcal, grams, or milligrams of sodium. */
export type NutrientField =
  | "energyKcal"
  | "proteinGrams"
  | "carbohydrateGrams"
  | "fatGrams"
  | "fiberGrams"
  | "sugarGrams"
  | "sodiumMilligrams";

export type OptionalNutrientField = Exclude<NutrientField, "energyKcal">;

/** Totals for the entered quantity; calories are required and may be zero. */
export type ManualNutrition = { energyKcal: string } & Partial<Record<OptionalNutrientField, string>>;

/** Every caller sends the UTC consumption time, as Water Events do. */
export type NewFoodEvent = { logDate: string };

/** A catalog food as reviewed: its `reviewVersion` must still be current when saving. */
export type ReviewedFoodInput = {
  providerFoodId: string;
  /** The USDA catalog generation or the Open Food Facts product fingerprint. */
  reviewVersion: string;
  measurementId: string;
  quantity: Quantity;
};

export type CreateFoodEvent =
  | (NewFoodEvent & ReviewedFoodInput & { method: "lookup" })
  | (NewFoodEvent & ReviewedFoodInput & { method: "barcode" })
  | (NewFoodEvent & {
      method: "manual";
      name: string;
      quantity: Quantity;
      nutrition: ManualNutrition;
      /** Also save it to My foods, in the same transaction. */
      saveAsFavorite: boolean;
    })
  | (NewFoodEvent & { method: "favorite"; favoriteId: number });

/** Omitted keeps a value; null clears it; a manual food's calories cannot be cleared. */
export type FoodEventChanges = {
  name?: string;
  quantity?: Quantity;
  measurementId?: string;
  nutrition?: Partial<Record<NutrientField, string | null>>;
};

export type EditFoodEvent = { id: number; expectedUpdatedAt: string; changes: FoodEventChanges };

/** Creates an event without `id`; with `id`, edits the version read at `expectedUpdatedAt`. */
export type SaveFoodEvent = CreateFoodEvent | EditFoodEvent;

export type FoodSource = {
  provider: FoodProvider;
  providerFoodId: string;
  dataType: string;
  brand: string | null;
  barcode: string | null;
  marketCountry: string | null;
  publishedDate: string | null;
  modifiedDate: string | null;
};

/** The provider's unrounded nutrition for a base quantity, from which every amount scales. */
export type AuthoritativeNutrition = {
  unit: CatalogMeasurement["unit"];
  quantityMicrounits: number;
  nutrition: CatalogNutrition;
};

/** Nutrients for the chosen amount; null means unknown, never zero. */
export type ScaledNutrients = Record<Nutrient, number | null>;

/** Everything a Food Event records about what was eaten, independent of its provider. */
export type FoodSnapshot = {
  source: FoodSource;
  originalName: string;
  editedName: string | null;
  authority: AuthoritativeNutrition;
  /** Measurements compatible with the authoritative base. */
  measurements: CatalogMeasurement[];
  measurement: CatalogMeasurement;
  quantityMicrounits: number;
  nutrients: ScaledNutrients;
};

export type FoodEvent = FoodSnapshot & {
  id: number;
  /** The edited name, or the original one. */
  name: string;
  /** UTC ISO date-time of consumption. */
  logDate: string;
  /** UTC instant the record was saved. */
  createdAt: string;
  /** UTC instant of the last edit; send it back as `expectedUpdatedAt`. */
  updatedAt: string;
  /** The My foods entry this event came from or created, or null. */
  favoriteId: number | null;
  /** The event this one was copied from, or null. */
  copiedFromId: number | null;
};

export type NutritionTotals = Record<Nutrient, { known: number; isIncomplete: boolean }>;

/** Inclusive `from`, exclusive `to`, ISO date-times with offsets. */
export type FoodEventRange = { from: string; to: string };

export type FoodEventList = {
  events: FoodEvent[];
  totals: NutritionTotals;
  /** Per local date in the account's time zone, for calendars. */
  days: Record<string, { eventCount: number; totals: NutritionTotals }>;
};

export type VersionedId = { id: number; expectedUpdatedAt: string };

/** Copies an earlier day's event, from its stored snapshot, to `logDate`. */
export type CopyFoodEvent = { eventId: number; sourceDate: string; logDate: string };

/** Favorites are Food Event data; catalog discovery lives in `app/catalog`. */
export type FindFavorites = { query: string } | { favoriteId: number };

/** A manual food saved to My foods, with the snapshot it reuses. */
export type Favorite = {
  id: number;
  name: string;
  snapshot: FoodSnapshot;
  sourceEventId: number;
  createdAt: string;
};

/** How Scan barcode appears in Add Food: usable, set up by an administrator, or not shown. */
export type BarcodeLookupAccess = "enabled" | "admin-setup" | "hidden";

/** The Add Food dialog's current step, from Home's `food=` query parameter. */
export type AddFoodStage =
  | { mode: "choose" }
  | { mode: "manual" }
  | { mode: "barcode"; barcode: string; food?: CatalogFood; message?: string; title?: string }
  | {
      mode: "search";
      query: string;
      results: CatalogSearchResult[];
      favorites: Favorite[];
      message?: string;
      title?: string;
    }
  | { mode: "my"; query: string; favorites: Favorite[] }
  | { mode: "saved"; query: string; favorite: Favorite }
  | { mode: "detail"; query: string; food: CatalogFood };

export type CopyFoodEventDialogModel = {
  event: FoodEvent;
  sourceDate: string;
  destinationDate?: string;
  calendar: Omit<CalendarMonth, "days"> & { days: Array<CalendarMonth["days"][number] & { isSource: boolean }> };
};

/** Everything Home needs to show Food Event dialogs for one request. */
export type FoodEventDialogs = {
  addFood?: AddFoodStage;
  barcodeLookup: BarcodeLookupAccess;
  editor?: { event: FoodEvent; canCopy: boolean };
  copy?: CopyFoodEventDialogModel;
  copyError?: string;
};

/** What `/food-events` answers a rejected submission with; a conflict carries the current event. */
export type FoodEventActionData = { code: string; message: string; event?: FoodEvent };
