import { z } from "zod";
import type { FoodLogDay, FoodLogRange } from "../food-log/food-log.server";
import { utcToZonedDateTime } from "../shared/date-time";
import { formatOunceThousandths, ounceThousandths } from "../water-event/water-event.utils";

type FoodLog = FoodLogDay;
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

/** A nutrient consumed over a range, which has no goal of its own. */
const rangeNutrientSchema = nutrientSchema.pick({ unit: true, consumed: true, isIncomplete: true });

const foodSchema = z.object({
  logDate: z.string().describe("When the food was eaten, as a UTC ISO date-time"),
  name: z.string(),
  provider: z.string().describe("Food source: usda-fdc, open-food-facts, or manual"),
  dataType: z.string().describe("Source data type, for example Foundation, Open Food Facts, or User entered"),
  brand: z.string().nullable(),
  serving: z.string(),
  energyKcal: z.number().nullable(),
  proteinG: z.number().nullable(),
  carbohydrateG: z.number().nullable(),
  fatG: z.number().nullable(),
  fiberG: z.number().nullable(),
  sugarG: z.number().nullable(),
  sodiumMg: z.number().nullable(),
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
  foods: z.array(foodSchema).describe("Foods logged on the date, most recent first; null means the value is unknown"),
};
type DailyLogSummary = z.infer<z.ZodObject<typeof dailyLogSummarySchema>>;

export const dailyLogsSummarySchema = {
  startDate: z.string().describe("The first date of the range (YYYY-MM-DD)"),
  endDate: z.string().describe("The last date of the range, inclusive (YYYY-MM-DD)"),
  today: z.string().describe("Today in the account's time zone (YYYY-MM-DD)"),
  timeZone: z.string(),
  totals: z.object({
    nutrients: z.object(Object.fromEntries(NUTRIENT_NAMES.map((name) => [name, rangeNutrientSchema])) as Record<NutrientName, typeof rangeNutrientSchema>),
    water: z.object({ unit: z.literal("fl oz"), consumed: z.number() }),
  }).describe("Everything consumed over the range"),
  averages: z.object({
    foodDayCount: z.number().describe("Dates with at least one food; nutrient averages divide by this"),
    waterDayCount: z.number().describe("Dates with at least one water entry; the water average divides by this"),
    nutrients: z.object(Object.fromEntries(NUTRIENT_NAMES.map((name) => [name, z.number()])) as Record<NutrientName, z.ZodNumber>)
      .describe("Known amount per date with food, in each nutrient's unit"),
    waterOunces: z.number().describe("Fluid ounces per date with water"),
  }).describe("Daily averages over the dates that have records; 0 when there are none"),
  days: z.array(z.object({
    ...dailyLogSummarySchema,
    foods: z.array(foodSchema.extend({
      localTime: z.string().describe("When the food was eaten on the account's clock (HH:MM)"),
    })).describe("Foods logged on the date, most recent first; null means the value is unknown"),
  })).describe("Every date of the range in order, including empty and future dates, each against the current Daily Goal"),
};
type DailyLogsSummary = z.infer<z.ZodObject<typeof dailyLogsSummarySchema>>;

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

function summarizeFood(event: FoodLog["foodEvents"][number]) {
  const { nutrients } = event;
  return {
    logDate: event.logDate,
    name: event.name,
    provider: event.source.provider,
    dataType: event.source.dataType,
    brand: event.source.brand,
    serving: `${event.measurement.label} × ${event.quantityMicrounits / 1_000_000}`,
    energyKcal: display(nutrients.energyMilliKcal, "energy"),
    proteinG: display(nutrients.proteinMilligrams, "protein"),
    carbohydrateG: display(nutrients.carbohydrateMilligrams, "carbohydrate"),
    fatG: display(nutrients.fatMilligrams, "fat"),
    fiberG: display(nutrients.fiberMilligrams, "fiber"),
    sugarG: display(nutrients.sugarMilligrams, "sugar"),
    sodiumMg: display(nutrients.sodiumMilligrams, "sodium"),
  };
}

function amountLine(label: string, amount: { unit: string; consumed: number; goal: number | null; remaining: number | null }, goalType: "target" | "maximum" = "target") {
  if (amount.goal === null || amount.remaining === null) return `${label}: ${amount.consumed} ${amount.unit} (no goal set)`;
  const goal = goalType === "maximum" ? `${amount.goal} ${amount.unit} maximum` : `${amount.goal} ${amount.unit}`;
  const rest = amount.remaining < 0 ? `${-amount.remaining} ${amount.unit} over` : `${amount.remaining} ${amount.unit} remaining`;
  return `${label}: ${amount.consumed} of ${goal}, ${rest}`;
}

function sourceLabel(food: DailyLogSummary["foods"][number]): string {
  if (food.provider === "manual") return "Manual";
  if (food.provider === "open-food-facts") return "Open Food Facts";
  return `USDA FoodData Central · ${food.dataType}`;
}

/** The `HH:MM` wall-clock time of a UTC instant in `timeZone`. */
function localTime(logDate: string, timeZone: string): string {
  return utcToZonedDateTime(logDate, timeZone).slice(11, 16);
}

function foodLine(food: DailyLogSummary["foods"][number], timeZone: string): string {
  return `- ${localTime(food.logDate, timeZone)} ${food.name}${food.brand ? ` (${food.brand})` : ""}, ${sourceLabel(food)}, ${food.serving}: ${food.energyKcal ?? "unknown"} kcal`;
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
  for (const food of summary.foods) lines.push(foodLine(food, summary.timeZone));
  return lines.join("\n");
}

/** `350 of 2050 kcal`, or `350 kcal` without a goal. */
function ofGoal(amount: { unit: string; consumed: number; goal: number | null }): string {
  return amount.goal === null ? `${amount.consumed} ${amount.unit}` : `${amount.consumed} of ${amount.goal} ${amount.unit}`;
}

function amounts(nutrients: Record<NutrientName, number>, water: number): string {
  return [...NUTRIENT_NAMES.map((name) => `${nutrients[name]} ${NUTRIENTS[name].unit} ${name}`), `${water} fl oz water`].join(", ");
}

function rangeText(summary: DailyLogsSummary): string {
  const { totals, averages } = summary;
  const incomplete = NUTRIENT_NAMES.filter((name) => totals.nutrients[name].isIncomplete);
  const consumed = Object.fromEntries(NUTRIENT_NAMES.map((name) => [name, totals.nutrients[name].consumed])) as Record<NutrientName, number>;
  const lines = [
    `Food Log from ${summary.startDate} to ${summary.endDate} (${summary.days.length} days), time zone ${summary.timeZone}, today ${summary.today}.`,
    `Totals: ${amounts(consumed, totals.water.consumed)}.` + (incomplete.length ? ` Incomplete, some foods have no value: ${incomplete.join(", ")}.` : ""),
    `Daily averages over ${averages.foodDayCount} days with food and ${averages.waterDayCount} days with water: ${amounts(averages.nutrients, averages.waterOunces)}.`,
  ];
  for (const day of summary.days) {
    const label = day.date === summary.today ? " (today)" : day.isFuture ? " (future)" : "";
    const foods = day.foods.length ? `${day.foods.length} ${day.foods.length === 1 ? "food" : "foods"}:` : "no foods";
    lines.push(`${day.date}${label}: ${ofGoal(day.nutrients.energy)}, ${ofGoal(day.water)} water, ${foods}`);
    for (const food of day.foods) lines.push(foodLine(food, summary.timeZone));
  }
  return lines.join("\n");
}

/** One Food Log in display units, with goals and remaining amounts. */
function dailyLogStructured(foodLog: FoodLog): DailyLogSummary {
  const nutrients = Object.fromEntries(
    NUTRIENT_NAMES.map((name) => [name, summarizeNutrient(name, foodLog.nutritionTotals, foodLog.goal)]),
  ) as DailyLogSummary["nutrients"];
  return {
    date: foodLog.selectedDate,
    today: foodLog.today,
    timeZone: foodLog.timeZone,
    isFuture: foodLog.isFuture,
    nutrients,
    water: summarizeWater(foodLog),
    incompleteNutrients: NUTRIENT_NAMES.filter((name) => nutrients[name].isIncomplete),
    foods: foodLog.foodEvents.map(summarizeFood),
  };
}

/** A model-friendly summary of one Food Log in display units, with goals and remaining amounts. */
export function summarizeDailyLog(foodLog: FoodLogDay) {
  const structured = dailyLogStructured(foodLog);
  return { structured, text: summaryText(structured) };
}

/**
 * A model-friendly summary of every date in a range: each day as `summarizeDailyLog` shows it,
 * each food with its local time, and the range's totals (without goals) and daily averages.
 */
export function summarizeDailyLogs(range: FoodLogRange) {
  const structured: DailyLogsSummary = {
    startDate: range.startDate,
    endDate: range.endDate,
    today: range.today,
    timeZone: range.timeZone,
    totals: {
      nutrients: Object.fromEntries(NUTRIENT_NAMES.map((name) => {
        const { known, isIncomplete } = range.totals[NUTRIENTS[name].total];
        return [name, { unit: NUTRIENTS[name].unit, consumed: display(known, name)!, isIncomplete }];
      })) as DailyLogsSummary["totals"]["nutrients"],
      water: { unit: "fl oz", consumed: ounces(ounceThousandths(range.waterTotalOunces)!) },
    },
    averages: {
      foodDayCount: range.averages.foodDayCount,
      waterDayCount: range.averages.waterDayCount,
      nutrients: Object.fromEntries(NUTRIENT_NAMES.map((name) => [
        name,
        display(range.averages.nutrition[NUTRIENTS[name].total], name)!,
      ])) as Record<NutrientName, number>,
      waterOunces: ounces(ounceThousandths(range.averages.waterOunces)!),
    },
    days: range.days.map((day) => {
      const summary = dailyLogStructured(day);
      return { ...summary, foods: summary.foods.map((food) => ({ ...food, localTime: localTime(food.logDate, day.timeZone) })) };
    }),
  };
  return { structured, text: rangeText(structured) };
}
