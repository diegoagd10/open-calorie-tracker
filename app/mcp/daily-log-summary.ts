import { z } from "zod";
import type { FoodLogService } from "../food-log/food-log.server";
import { formatOunceThousandths, ounceThousandths } from "../water-event/water-event.utils";

type FoodLog = NonNullable<ReturnType<FoodLogService["read"]>>;
type Totals = FoodLog["nutritionTotals"];
type Goal = NonNullable<FoodLog["goal"]>;

/**
 * Each summarized nutrient: its unit, the canonical total and goal fields it
 * reads, how many canonical units make one display unit, and its display precision.
 */
const NUTRIENTS = {
  energy: { unit: "kcal", total: "energyMilliKcal", goal: "calorieTarget", goalType: "target", scale: 1_000, decimals: 0 },
  protein: { unit: "g", total: "proteinMilligrams", goal: "proteinTarget", goalType: "target", scale: 1_000, decimals: 1 },
  carbohydrate: { unit: "g", total: "carbohydrateMilligrams", goal: "carbohydrateTarget", goalType: "target", scale: 1_000, decimals: 1 },
  fat: { unit: "g", total: "fatMilligrams", goal: "fatTarget", goalType: "target", scale: 1_000, decimals: 1 },
  fiber: { unit: "g", total: "fiberMilligrams", goal: "fiberTarget", goalType: "target", scale: 1_000, decimals: 1 },
  sugar: { unit: "g", total: "sugarMilligrams", goal: "sugarMaximum", goalType: "maximum", scale: 1_000, decimals: 1 },
  sodium: { unit: "mg", total: "sodiumMilligrams", goal: "sodiumMaximum", goalType: "maximum", scale: 1, decimals: 0 },
} as const satisfies Record<string, {
  unit: string; total: keyof Totals; goal: keyof Goal; goalType: "target" | "maximum"; scale: number; decimals: number;
}>;
type NutrientName = keyof typeof NUTRIENTS;
const NUTRIENT_NAMES = Object.keys(NUTRIENTS) as NutrientName[];

const nutrientSchema = z.object({
  unit: z.string(),
  consumed: z.number().describe("Sum of known values; foods without a value count as zero"),
  goal: z.number().nullable().describe("Daily goal, or null when no goal is set"),
  goalType: z.enum(["target", "maximum"]).describe("Whether the goal is an amount to reach or a limit to stay under"),
  remaining: z.number().nullable().describe("goal minus consumed; negative means over the goal"),
  isIncomplete: z.boolean().describe("True when some foods have no value for this nutrient, so consumed is a lower bound"),
});

export const dailyLogSummarySchema = {
  date: z.string().describe("The Food Log date (YYYY-MM-DD)"),
  today: z.string().describe("Today in the account's time zone (YYYY-MM-DD)"),
  timeZone: z.string(),
  isFuture: z.boolean(),
  nutrients: z.object(Object.fromEntries(NUTRIENT_NAMES.map((name) => [name, nutrientSchema])) as Record<NutrientName, typeof nutrientSchema>),
  water: z.object({
    unit: z.literal("fl oz"),
    consumed: z.number(),
    goal: z.number().nullable().describe("Daily water target, or null when no goal is set"),
    remaining: z.number().nullable().describe("goal minus consumed; negative means over the goal"),
  }).describe("Water in fluid ounces, exact to three decimals"),
  incompleteNutrients: z.array(z.enum(NUTRIENT_NAMES as [NutrientName, ...NutrientName[]])),
  foods: z.array(z.object({
    time: z.string().describe("Local time (HH:MM)"),
    name: z.string(),
    brand: z.string().nullable(),
    serving: z.string(),
    energyKcal: z.number().nullable(),
    proteinG: z.number().nullable(),
    carbohydrateG: z.number().nullable(),
    fatG: z.number().nullable(),
    fiberG: z.number().nullable(),
    sugarG: z.number().nullable(),
    sodiumMg: z.number().nullable(),
  })).describe("Foods logged on the date, most recent first; null means the value is unknown"),
};
type DailyLogSummary = z.infer<z.ZodObject<typeof dailyLogSummarySchema>>;

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function display(canonical: number | null, name: NutrientName): number | null {
  const { scale, decimals } = NUTRIENTS[name];
  return canonical === null ? null : round(canonical / scale, decimals);
}

function summarizeNutrient(name: NutrientName, totals: Totals, goal: FoodLog["goal"]) {
  const { unit, total, goalType } = NUTRIENTS[name];
  const { known, isIncomplete } = totals[total];
  const goalValue = goal ? goal[NUTRIENTS[name].goal] : null;
  return {
    unit,
    consumed: display(known, name)!,
    goal: display(goalValue, name),
    goalType,
    remaining: display(goalValue === null ? null : goalValue - known, name),
    isIncomplete,
  };
}

/** Fluid ounces as a JSON number; three decimals are exact up to billions of ounces. */
function ounces(thousandths: bigint): number {
  return thousandths < 0n ? -Number(formatOunceThousandths(-thousandths)) : Number(formatOunceThousandths(thousandths));
}

/** Water consumed, goal, and remaining, computed in thousandths of a fluid ounce like stored amounts. */
function summarizeWater(foodLog: FoodLog) {
  const consumed = ounceThousandths(foodLog.waterTotalOunces)!;
  const goal = foodLog.goal ? ounceThousandths(foodLog.goal.waterTarget) : null;
  return {
    unit: "fl oz" as const,
    consumed: ounces(consumed),
    goal: goal === null ? null : ounces(goal),
    remaining: goal === null ? null : ounces(goal - consumed),
  };
}

function summarizeFood(entry: FoodLog["entries"][number]) {
  return {
    time: entry.localEventTime.slice(0, 5),
    name: entry.name,
    brand: entry.brand,
    serving: `${entry.selectedMeasurementLabel} × ${entry.quantityMicrounits / 1_000_000}`,
    energyKcal: display(entry.energyMilliKcal, "energy"),
    proteinG: display(entry.proteinMilligrams, "protein"),
    carbohydrateG: display(entry.carbohydrateMilligrams, "carbohydrate"),
    fatG: display(entry.fatMilligrams, "fat"),
    fiberG: display(entry.fiberMilligrams, "fiber"),
    sugarG: display(entry.sugarMilligrams, "sugar"),
    sodiumMg: display(entry.sodiumMilligrams, "sodium"),
  };
}

function amountLine(label: string, amount: { unit: string; consumed: number; goal: number | null; remaining: number | null }, goalType: "target" | "maximum" = "target") {
  if (amount.goal === null || amount.remaining === null) return `${label}: ${amount.consumed} ${amount.unit} (no goal set)`;
  const goal = goalType === "maximum" ? `${amount.goal} ${amount.unit} maximum` : `${amount.goal} ${amount.unit}`;
  const rest = amount.remaining < 0 ? `${-amount.remaining} ${amount.unit} over` : `${amount.remaining} ${amount.unit} remaining`;
  return `${label}: ${amount.consumed} of ${goal}, ${rest}`;
}

function summaryText(summary: DailyLogSummary): string {
  const lines = [`Food Log for ${summary.date}${summary.date === summary.today ? " (today)" : ""}, time zone ${summary.timeZone}.`];
  for (const name of NUTRIENT_NAMES) {
    const nutrient = summary.nutrients[name];
    const label = name[0].toUpperCase() + name.slice(1);
    lines.push(amountLine(label, nutrient, nutrient.goalType) + (nutrient.isIncomplete ? " (incomplete: some foods have no value)" : ""));
  }
  lines.push(amountLine("Water", summary.water));
  lines.push(summary.foods.length ? "Foods:" : "No foods logged.");
  for (const food of summary.foods) {
    lines.push(`- ${food.time} ${food.name}${food.brand ? ` (${food.brand})` : ""}, ${food.serving}: ${food.energyKcal ?? "unknown"} kcal`);
  }
  return lines.join("\n");
}

/** A model-friendly summary of one Food Log in display units, with goals and remaining amounts. */
export function summarizeDailyLog(foodLog: NonNullable<ReturnType<FoodLogService["read"]>>) {
  const nutrients = Object.fromEntries(
    NUTRIENT_NAMES.map((name) => [name, summarizeNutrient(name, foodLog.nutritionTotals, foodLog.goal)]),
  ) as DailyLogSummary["nutrients"];
  const structured: DailyLogSummary = {
    date: foodLog.selectedDate,
    today: foodLog.today,
    timeZone: foodLog.timeZone,
    isFuture: foodLog.isFuture,
    nutrients,
    water: summarizeWater(foodLog),
    incompleteNutrients: NUTRIENT_NAMES.filter((name) => nutrients[name].isIncomplete),
    foods: foodLog.entries.map(summarizeFood),
  };
  return { structured, text: summaryText(structured) };
}
