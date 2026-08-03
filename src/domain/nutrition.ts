export const NUTRIENT_DEFINITIONS = [
  { key: "calories", label: "Calories", unit: "kcal", kind: "calories" },
  { key: "protein", label: "Protein", unit: "g", kind: "grams" },
  { key: "carbohydrates", label: "Total carbohydrates", unit: "g", kind: "grams" },
  { key: "fat", label: "Fat", unit: "g", kind: "grams" },
  { key: "fiber", label: "Fiber", unit: "g", kind: "grams" },
  { key: "addedSugar", label: "Added sugar", unit: "g", kind: "grams" },
  { key: "sugar", label: "Total sugar", unit: "g", kind: "grams" },
  { key: "saturatedFat", label: "Saturated fat", unit: "g", kind: "grams" },
  { key: "sodium", label: "Sodium", unit: "mg", kind: "milligrams" },
] as const;

export type NutrientKey = (typeof NUTRIENT_DEFINITIONS)[number]["key"];
export type OptionalNutrientKey = Exclude<NutrientKey, "calories">;
export type NutrientValues = Record<NutrientKey, number | null>;
export type AggregatedNutrients = Record<NutrientKey, number>;

export type MealTag = "Breakfast" | "Lunch" | "Dinner" | "Snack";

export interface Quantity {
  value: number;
  display: string;
  unit: string;
}

export interface NutritionProfile {
  calories: number;
  protein?: number | null;
  carbohydrates?: number | null;
  fat?: number | null;
  fiber?: number | null;
  addedSugar?: number | null;
  sugar?: number | null;
  saturatedFat?: number | null;
  sodium?: number | null;
}

export interface NutritionalSnapshot {
  nutrients: NutrientValues;
  baseNutrients: NutrientValues;
  quantity: Quantity;
  quantityBasis: string;
  basisQuantity: number;
}

export interface FoodProfile {
  name: string;
  brand?: string | null;
  description?: string | null;
  quantityBasis: string;
  basisQuantity?: number;
  nutrients: NutritionProfile;
  source?: string;
}

export interface NutrientReference {
  type: "target" | "minimum" | "range" | "upper" | "label";
  min?: number;
  max?: number;
  value?: number;
  label?: string;
  enabled?: boolean;
}

export type NutrientReferences = Partial<Record<NutrientKey, NutrientReference>> & {
  proteinAdequacy?: NutrientReference;
};

export interface NutrientSummary {
  key: NutrientKey;
  label: string;
  unit: string;
  value: number;
  display: string;
  missing: boolean;
  reference?: NutrientReference;
  status?: string;
}

export interface DailySummary {
  nutrients: NutrientSummary[];
  missingNutrients: NutrientKey[];
  hasMissingData: boolean;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a || 1;
}

function rationalFromString(input: string): { numerator: number; denominator: number } {
  const value = input.trim().replace(/\s+/g, " ");
  if (!value) throw new Error("Quantity is required.");

  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(value);
  if (mixed) {
    const whole = Number(mixed[1]);
    const numerator = Number(mixed[2]);
    const denominator = Number(mixed[3]);
    if (!denominator || numerator >= denominator) throw new Error("Enter a valid fraction.");
    return { numerator: whole * denominator + numerator, denominator };
  }

  const fraction = /^(\d+)\/(\d+)$/.exec(value);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (!denominator) throw new Error("Enter a valid fraction.");
    return { numerator, denominator };
  }

  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error("Enter a decimal or fraction quantity.");
  const [whole, decimals = ""] = value.split(".");
  if (!decimals) return { numerator: Number(whole), denominator: 1 };
  const denominator = 10 ** decimals.length;
  return { numerator: Number(whole) * denominator + Number(decimals), denominator };
}

export function parseQuantity(input: string | number, unit = "serving"): Quantity {
  const rational = typeof input === "number"
    ? rationalFromString(String(input))
    : rationalFromString(input);
  const divisor = greatestCommonDivisor(rational.numerator, rational.denominator);
  const numerator = rational.numerator / divisor;
  const denominator = rational.denominator / divisor;
  if (numerator <= 0) throw new Error("Quantity must be greater than zero.");

  const whole = Math.floor(numerator / denominator);
  const remainder = numerator % denominator;
  const display = remainder === 0
    ? String(whole)
    : whole
      ? `${whole} ${remainder}/${denominator}`
      : `${remainder}/${denominator}`;
  return { value: numerator / denominator, display, unit: unit.trim() || "serving" };
}

export function normalizeNutrition(nutrients: Partial<Record<NutrientKey, number | null>>): NutrientValues {
  const normalized = {} as NutrientValues;
  for (const definition of NUTRIENT_DEFINITIONS) {
    const value = nutrients[definition.key];
    normalized[definition.key] = value === undefined || value === null ? null : Number(value);
  }
  if (normalized.calories === null || !Number.isFinite(normalized.calories) || normalized.calories < 0) {
    throw new Error("Calories are required and must be a non-negative number.");
  }
  return normalized;
}

export function scaleNutrition(nutrients: NutritionProfile, quantity: number): NutrientValues {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Quantity must be greater than zero.");
  const normalized = normalizeNutrition(nutrients);
  return Object.fromEntries(
    NUTRIENT_DEFINITIONS.map(({ key }) => [
      key,
      normalized[key] === null ? null : normalized[key] * quantity,
    ]),
  ) as NutrientValues;
}

export function addNutrition(values: NutrientValues[]): AggregatedNutrients {
  return Object.fromEntries(
    NUTRIENT_DEFINITIONS.map(({ key }) => {
      const knownValues = values.map((value) => value[key]).filter((value): value is number => value !== null);
      return [key, knownValues.reduce((total, value) => total + value, 0)];
    }),
  ) as AggregatedNutrients;
}

export function formatNutritionValue(key: NutrientKey, value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  const definition = NUTRIENT_DEFINITIONS.find((item) => item.key === key);
  if (!definition) return String(value);
  if (definition.kind === "calories" || definition.kind === "milligrams") return String(Math.round(value));
  return value.toFixed(1);
}

function referenceStatus(value: number, reference: NutrientReference): string | undefined {
  if (reference.enabled === false) return undefined;
  if (reference.type === "range") {
    if (reference.min !== undefined && value < reference.min) return "below minimum";
    if (reference.max !== undefined && value > reference.max) return "above range";
    return "within range";
  }
  if (reference.type === "minimum") return reference.min !== undefined && value < reference.min ? "below minimum" : "meets minimum";
  if (reference.type === "upper") return reference.max !== undefined && value > reference.max ? "over upper reference" : "within upper reference";
  if (reference.type === "target") {
    if (reference.value === undefined) return undefined;
    return value === reference.value ? "at target" : value < reference.value ? "below target" : "above target";
  }
  return undefined;
}

export function summarizeNutrition(
  values: Array<(Partial<NutritionProfile> & { calories: number }) | NutrientValues>,
  references: NutrientReferences = {},
): DailySummary {
  const normalizedValues = values.map((value) => normalizeNutrition(value));
  const totals = addNutrition(normalizedValues);
  const missingNutrients = NUTRIENT_DEFINITIONS
    .filter(({ key }) => normalizedValues.some((value) => value[key] === null))
    .map(({ key }) => key);
  return {
    nutrients: NUTRIENT_DEFINITIONS.map((definition) => {
      const reference = references[definition.key];
      return {
        key: definition.key,
        label: definition.label,
        unit: definition.unit,
        value: totals[definition.key],
        display: formatNutritionValue(definition.key, totals[definition.key]),
        missing: missingNutrients.includes(definition.key),
        reference,
        status: reference ? referenceStatus(totals[definition.key], reference) : undefined,
      };
    }),
    missingNutrients,
    hasMissingData: missingNutrients.some((key) => key !== "calories"),
  };
}

export interface NutritionEstimateInput {
  age: number;
  sex: "female" | "male";
  heightCm: number;
  weightKg: number;
  activity: "Inactive" | "Low active" | "Active" | "Very active";
  plan: "Lose" | "Maintain" | "Gain";
  targetWeightKg?: number;
  targetDate?: string;
  today?: string;
}

export interface NutritionEstimate {
  maintenanceCalories: number;
  targetCalories: number;
  plan: NutritionEstimateInput["plan"];
  references: NutrientReferences;
  metadata: {
    sourceEdition: string;
    sourceDate: string;
    referenceProfileVersion: string;
    modelVersion: string;
    inputs: NutritionEstimateInput;
    attribution: string;
  };
  warnings: string[];
}

const EER_COEFFICIENTS = {
  female: {
    Inactive: [584.9, -7.01, 5.72, 11.71],
    "Low active": [575.77, -7.01, 6.6, 12.14],
    Active: [710.25, -7.01, 6.54, 12.34],
    "Very active": [511.83, -7.01, 9.07, 12.56],
  },
  male: {
    Inactive: [753.07, -10.83, 6.5, 14.1],
    "Low active": [581.47, -10.83, 8.3, 14.94],
    Active: [1004.82, -10.83, 6.52, 15.91],
    "Very active": [-517.88, -10.83, 15.61, 19.11],
  },
} as const;

export function estimateMaintenanceCalories(input: Pick<NutritionEstimateInput, "age" | "sex" | "heightCm" | "weightKg" | "activity">): number {
  if (input.age < 19) throw new Error("Nutrition estimates are supported for adults age 19 and older.");
  if (input.heightCm <= 0 || input.weightKg <= 0) throw new Error("Height and weight must be greater than zero.");
  const [constant, age, height, weight] = EER_COEFFICIENTS[input.sex][input.activity];
  return constant + age * input.age + height * input.heightCm + weight * input.weightKg;
}

export function dynamicWeightChangeCalories(input: {
  maintenanceCalories: number;
  startingWeightKg: number;
  targetWeightKg: number;
  days: number;
}): number {
  if (input.days <= 0) throw new Error("Target date must be in the future.");
  if (input.startingWeightKg <= 0 || input.targetWeightKg <= 0) throw new Error("Weights must be greater than zero.");
  if (input.startingWeightKg === input.targetWeightKg) return Math.round(input.maintenanceCalories);

  const energyPerKg = 7700;
  const direction = input.targetWeightKg < input.startingWeightKg ? -1 : 1;
  const expenditureAtWeight = (weight: number) => input.maintenanceCalories * (weight / input.startingWeightKg) ** 0.75;
  const projectedWeight = (intake: number) => {
    let weight = input.startingWeightKg;
    for (let day = 0; day < input.days; day += 1) {
      weight += (intake - expenditureAtWeight(weight)) / energyPerKg;
      weight = Math.max(1, weight);
    }
    return weight;
  };

  let low = direction < 0 ? input.maintenanceCalories * 0.3 : input.maintenanceCalories;
  let high = direction < 0 ? input.maintenanceCalories : input.maintenanceCalories * 1.7;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const midpoint = (low + high) / 2;
    const weight = projectedWeight(midpoint);
    if ((direction < 0 && weight > input.targetWeightKg) || (direction > 0 && weight < input.targetWeightKg)) low = midpoint;
    else high = midpoint;
  }
  return Math.round((low + high) / 2);
}

function differenceInDays(today: string, targetDate: string): number {
  const start = new Date(`${today}T00:00:00Z`).getTime();
  const end = new Date(`${targetDate}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}

export function buildNutritionReferences(targetCalories: number, weightKg: number): NutrientReferences {
  return {
    protein: { type: "range", min: weightKg * 1.2, max: weightKg * 1.6, label: "1.2-1.6 g/kg/day" },
    proteinAdequacy: { type: "minimum", min: weightKg * 0.8, label: "0.8 g/kg/day adequacy reference" },
    carbohydrates: { type: "range", min: targetCalories * 0.45 / 4, max: targetCalories * 0.65 / 4, label: "45-65% of calories" },
    fat: { type: "range", min: targetCalories * 0.2 / 9, max: targetCalories * 0.35 / 9, label: "20-35% of calories" },
    fiber: { type: "minimum", min: targetCalories * 14 / 1000, label: "14 g per 1,000 kcal" },
    saturatedFat: { type: "upper", max: targetCalories * 0.1 / 9, label: "below 10% of calories" },
    sodium: { type: "upper", max: 2300, label: "below 2,300 mg/day" },
    sugar: { type: "label", label: "Informational only" },
    addedSugar: { type: "label", value: 50, label: "50 g FDA label reference" },
  };
}

export function estimateNutrition(input: NutritionEstimateInput): NutritionEstimate {
  const maintenanceCalories = estimateMaintenanceCalories(input);
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const warnings: string[] = ["This is a general starting estimate, not medical advice."];
  let targetCalories = maintenanceCalories;
  let modelVersion = "nase-m-eer-2023-v1";

  if (input.plan !== "Maintain") {
    if (!input.targetWeightKg || !input.targetDate) throw new Error("Lose and Gain plans require a target weight and target date.");
    if (input.plan === "Lose" && input.targetWeightKg >= input.weightKg) throw new Error("Lose plan target weight must be below the current weight.");
    if (input.plan === "Gain" && input.targetWeightKg <= input.weightKg) throw new Error("Gain plan target weight must be above the current weight.");
    const days = differenceInDays(today, input.targetDate);
    targetCalories = dynamicWeightChangeCalories({
      maintenanceCalories,
      startingWeightKg: input.weightKg,
      targetWeightKg: input.targetWeightKg,
      days,
    });
    modelVersion = "dynamic-energy-balance-v1";
    warnings.push("Lose and Gain estimates use an independent dynamic energy-balance model inspired by published adult weight-change research.");
    if (targetCalories < 1000) warnings.push("The proposed intake is below 1,000 kcal/day; seek individualized professional guidance before using it.");
  }

  return {
    maintenanceCalories,
    targetCalories,
    plan: input.plan,
    references: buildNutritionReferences(targetCalories, input.weightKg),
    metadata: {
      sourceEdition: "National Academies Dietary Reference Intakes for Energy (2023)",
      sourceDate: "2023",
      referenceProfileVersion: "adult-general-v1",
      modelVersion,
      inputs: input,
      attribution: "Independent implementation; dynamic model informed by Hall et al. and NIDDK Body Weight Planner research. No NIH/NIDDK code or branding is used.",
    },
    warnings,
  };
}
