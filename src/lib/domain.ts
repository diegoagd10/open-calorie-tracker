export const NUTRIENT_KEYS = [
  "caloriesPerServingCal",
  "proteinPerServingG",
  "carbsPerServingG",
  "fatPerServingG",
  "fiberPerServingG",
  "sugarPerServingG",
  "sodiumPerServingMg",
] as const;

export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

export type Nutrition = Record<NutrientKey, number>;

export type ProductStatus = "active" | "retired";

export type FoodProduct = Nutrition & {
  id: string;
  name: string;
  nameNormalized: string;
  measurementType: "serving";
  servingDescription: string;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
};

export type ProductDraft = Nutrition & {
  name: string;
  servingDescription: string;
  measurementType: "serving";
};

export type FoodLogSnapshot = Nutrition & {
  titleSnapshot: string;
  servingDescriptionSnapshot: string;
  quantity: number;
};

export type FoodLogEntry = FoodLogSnapshot & {
  id: string;
  date: string;
  productId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FoodLogCreateInput = {
  date: string;
  productId: string;
  quantity: number;
};

export type FoodLogSnapshotPatch = Partial<FoodLogSnapshot>;

export type DailyNutritionTotals = {
  caloriesCal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sugarG: number;
  sodiumMg: number;
};

export type DailyTargetVersion = {
  id: string;
  effectiveDate: string;
  calorieMaximumCal: number;
  proteinMinimumG: number;
  carbsMaximumG: number;
  fiberMaximumG: number;
  sugarMaximumG: number;
  sodiumMaximumMg: number;
  waterMinimumFlOz: number;
  fatRule: "calorie-30-percent";
  createdAt: string;
  updatedAt: string;
};

export type TargetDirection = "maximum" | "minimum";
export type TargetStatus =
  | "within-limit"
  | "exceeded"
  | "met"
  | "below-target";

export type TargetMetricStatus = {
  current: number;
  target: number;
  direction: TargetDirection;
  status: TargetStatus;
};

export type DailyTargetStatuses = {
  calories: TargetMetricStatus;
  protein: TargetMetricStatus;
  carbs: TargetMetricStatus;
  fat: TargetMetricStatus;
  fiber: TargetMetricStatus;
  sugar: TargetMetricStatus;
  sodium: TargetMetricStatus;
  water: TargetMetricStatus;
};

export type WaterDay = {
  date: string;
  totalFluidOz: number;
  updatedAt: string;
};

export type WeightEntry = {
  date: string;
  weightLb: number;
  updatedAt: string;
};

export type UserSettings = {
  targetWeightLb: number | null;
  updatedAt: string;
};

export type ValidationIssue = {
  field: string;
  message: string;
};

export class ValidationError extends Error {
  readonly status = 422;
  readonly code = "VALIDATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  readonly status = 404;
  readonly code = "NOT_FOUND";

  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  readonly status = 409;
  readonly code = "CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

type RecordInput = Record<string, unknown>;

function asRecord(input: unknown): RecordInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError("Request body must be an object");
  }
  return input as RecordInput;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`${label} is required`);
  }
  return value.trim();
}

function finiteNumber(
  value: unknown,
  label: string,
  options: { positive: boolean },
): number {
  const candidate =
    typeof value === "string" && value.trim() ? Number(value) : value;

  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    throw new ValidationError(`${label} must be a finite number`);
  }

  if (options.positive ? candidate <= 0 : candidate < 0) {
    throw new ValidationError(
      `${label} must be ${options.positive ? "greater than zero" : "non-negative"}`,
    );
  }

  return candidate;
}

function nutritionFromRecord(input: RecordInput): Nutrition {
  return {
    caloriesPerServingCal: finiteNumber(
      input.caloriesPerServingCal,
      "Calories per serving",
      { positive: false },
    ),
    proteinPerServingG: finiteNumber(input.proteinPerServingG, "Protein per serving", {
      positive: false,
    }),
    carbsPerServingG: finiteNumber(input.carbsPerServingG, "Carbs per serving", {
      positive: false,
    }),
    fatPerServingG: finiteNumber(input.fatPerServingG, "Fat per serving", {
      positive: false,
    }),
    fiberPerServingG: finiteNumber(input.fiberPerServingG, "Fiber per serving", {
      positive: false,
    }),
    sugarPerServingG: finiteNumber(input.sugarPerServingG, "Sugar per serving", {
      positive: false,
    }),
    sodiumPerServingMg: finiteNumber(input.sodiumPerServingMg, "Sodium per serving", {
      positive: false,
    }),
  };
}

export function normalizeProductDraft(input: unknown): ProductDraft {
  const record = asRecord(input);
  const measurementType = record.measurementType ?? "serving";

  if (measurementType !== "serving") {
    throw new ValidationError("Measurement type must be serving");
  }

  return {
    name: requiredText(record.name, "Food name"),
    servingDescription: requiredText(
      record.servingDescription,
      "Serving description",
    ),
    measurementType: "serving",
    ...nutritionFromRecord(record),
  };
}

export function validateDate(value: unknown, label = "Date"): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError(`${label} must use YYYY-MM-DD`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new ValidationError(`${label} must be a valid calendar date`);
  }

  return value;
}

export function currentLocalDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

// Kept as a named compatibility seam for server-side callers.
export const currentUtcDate = currentLocalDate;

export function assertNotFutureDate(
  date: string,
  today = currentLocalDate(),
): void {
  validateDate(today, "Today");
  if (date > today) {
    throw new ValidationError("Future dates are not available");
  }
}

export function normalizeFoodLogCreateInput(
  input: unknown,
  today = currentLocalDate(),
): FoodLogCreateInput {
  const record = asRecord(input);
  const productId = requiredText(record.productId, "Product ID");
  const date = validateDate(record.date, "Date");
  assertNotFutureDate(date, today);

  return {
    productId,
    date,
    quantity: finiteNumber(record.quantity, "Serving quantity", {
      positive: true,
    }),
  };
}

export function normalizeFoodLogSnapshot(input: unknown): FoodLogSnapshot {
  const record = asRecord(input);

  return {
    titleSnapshot: requiredText(record.titleSnapshot, "Food title"),
    servingDescriptionSnapshot: requiredText(
      record.servingDescriptionSnapshot,
      "Serving description",
    ),
    quantity: finiteNumber(record.quantity, "Serving quantity", {
      positive: true,
    }),
    ...nutritionFromRecord(record),
  };
}

export function normalizeFoodLogSnapshotPatch(
  input: unknown,
): FoodLogSnapshotPatch {
  const record = asRecord(input);
  const patch: FoodLogSnapshotPatch = {};

  if ("titleSnapshot" in record) {
    patch.titleSnapshot = requiredText(record.titleSnapshot, "Food title");
  }
  if ("servingDescriptionSnapshot" in record) {
    patch.servingDescriptionSnapshot = requiredText(
      record.servingDescriptionSnapshot,
      "Serving description",
    );
  }
  if ("quantity" in record) {
    patch.quantity = finiteNumber(record.quantity, "Serving quantity", {
      positive: true,
    });
  }

  for (const key of NUTRIENT_KEYS) {
    if (key in record) {
      patch[key] = finiteNumber(record[key], key, { positive: false });
    }
  }

  if (Object.keys(patch).length === 0) {
    throw new ValidationError("At least one food snapshot field is required");
  }

  return patch;
}

export function scaleNutrition(
  nutrition: Nutrition,
  quantity: number,
): Nutrition {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new ValidationError("Serving quantity must be greater than zero");
  }

  return {
    caloriesPerServingCal: nutrition.caloriesPerServingCal * quantity,
    proteinPerServingG: nutrition.proteinPerServingG * quantity,
    carbsPerServingG: nutrition.carbsPerServingG * quantity,
    fatPerServingG: nutrition.fatPerServingG * quantity,
    fiberPerServingG: nutrition.fiberPerServingG * quantity,
    sugarPerServingG: nutrition.sugarPerServingG * quantity,
    sodiumPerServingMg: nutrition.sodiumPerServingMg * quantity,
  };
}

export function aggregateFoodLogs(
  entries: ReadonlyArray<Pick<FoodLogEntry, NutrientKey | "quantity">>,
): DailyNutritionTotals {
  return entries.reduce<DailyNutritionTotals>(
    (totals, entry) => {
      totals.caloriesCal += entry.caloriesPerServingCal * entry.quantity;
      totals.proteinG += entry.proteinPerServingG * entry.quantity;
      totals.carbsG += entry.carbsPerServingG * entry.quantity;
      totals.fatG += entry.fatPerServingG * entry.quantity;
      totals.fiberG += entry.fiberPerServingG * entry.quantity;
      totals.sugarG += entry.sugarPerServingG * entry.quantity;
      totals.sodiumMg += entry.sodiumPerServingMg * entry.quantity;
      return totals;
    },
    {
      caloriesCal: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      fiberG: 0,
      sugarG: 0,
      sodiumMg: 0,
    },
  );
}

export function waterGlasses(totalFluidOz: number): number {
  if (!Number.isFinite(totalFluidOz) || totalFluidOz < 0) {
    throw new ValidationError("Water total must be non-negative");
  }
  return totalFluidOz / 8;
}

export const waterToGlasses = waterGlasses;

export function fatLimitForCalories(calorieMaximumCal: number): number {
  if (!Number.isFinite(calorieMaximumCal) || calorieMaximumCal < 0) {
    throw new ValidationError("Calorie maximum must be non-negative");
  }
  return (calorieMaximumCal * 0.3) / 9;
}

export const calculateFatLimit = fatLimitForCalories;

function maximumStatus(current: number, target: number): TargetMetricStatus {
  return {
    current,
    target,
    direction: "maximum",
    status: current <= target ? "within-limit" : "exceeded",
  };
}

function minimumStatus(current: number, target: number): TargetMetricStatus {
  return {
    current,
    target,
    direction: "minimum",
    status: current >= target ? "met" : "below-target",
  };
}

export function calculateTargetStatuses(
  totals: DailyNutritionTotals,
  waterTotalFluidOz: number,
  target: DailyTargetVersion,
): DailyTargetStatuses {
  return {
    calories: maximumStatus(totals.caloriesCal, target.calorieMaximumCal),
    protein: minimumStatus(totals.proteinG, target.proteinMinimumG),
    carbs: maximumStatus(totals.carbsG, target.carbsMaximumG),
    fat: maximumStatus(
      totals.fatG,
      fatLimitForCalories(target.calorieMaximumCal),
    ),
    fiber: maximumStatus(totals.fiberG, target.fiberMaximumG),
    sugar: maximumStatus(totals.sugarG, target.sugarMaximumG),
    sodium: maximumStatus(totals.sodiumMg, target.sodiumMaximumMg),
    water: minimumStatus(waterTotalFluidOz, target.waterMinimumFlOz),
  };
}

export const evaluateTargetStatuses = calculateTargetStatuses;

export type TargetInput = Omit<
  DailyTargetVersion,
  "id" | "createdAt" | "updatedAt"
> & {
  effectiveDate?: string;
};

export function normalizeTargetInput(
  input: unknown,
  defaultDate = currentLocalDate(),
): Omit<DailyTargetVersion, "id" | "createdAt" | "updatedAt"> {
  const record = asRecord(input);
  const effectiveDate = validateDate(
    record.effectiveDate ?? defaultDate,
    "Effective date",
  );
  assertNotFutureDate(effectiveDate, defaultDate);

  const fatRule = record.fatRule ?? "calorie-30-percent";
  if (fatRule !== "calorie-30-percent") {
    throw new ValidationError("Fat rule must use the 30% calorie maximum");
  }

  return {
    effectiveDate,
    calorieMaximumCal: finiteNumber(record.calorieMaximumCal, "Calorie maximum", {
      positive: false,
    }),
    proteinMinimumG: finiteNumber(record.proteinMinimumG, "Protein minimum", {
      positive: false,
    }),
    carbsMaximumG: finiteNumber(record.carbsMaximumG, "Carbohydrate maximum", {
      positive: false,
    }),
    fiberMaximumG: finiteNumber(record.fiberMaximumG, "Fiber maximum", {
      positive: false,
    }),
    sugarMaximumG: finiteNumber(record.sugarMaximumG, "Sugar maximum", {
      positive: false,
    }),
    sodiumMaximumMg: finiteNumber(record.sodiumMaximumMg, "Sodium maximum", {
      positive: false,
    }),
    waterMinimumFlOz: finiteNumber(
      record.waterMinimumFlOz,
      "Water minimum",
      { positive: false },
    ),
    fatRule: "calorie-30-percent",
  };
}

export function resolveTargetVersion(
  versions: ReadonlyArray<DailyTargetVersion>,
  selectedDate: string,
): DailyTargetVersion | null {
  validateDate(selectedDate, "Date");
  return (
    versions
      .filter((version) => version.effectiveDate <= selectedDate)
      .sort((a, b) => {
        const dateOrder = b.effectiveDate.localeCompare(a.effectiveDate);
        return dateOrder || b.createdAt.localeCompare(a.createdAt);
      })[0] ?? null
  );
}

export function normalizeWaterAmount(
  value: unknown,
  label = "Water amount",
): number {
  return finiteNumber(value, label, { positive: true });
}

export function normalizeWeight(value: unknown): number {
  return finiteNumber(value, "Weight", { positive: true });
}

export function normalizeTargetWeight(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  return finiteNumber(value, "Target weight", { positive: true });
}
