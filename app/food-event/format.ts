import { utcToZonedDateTime } from "../shared/date-time";
import type { FoodEvent } from "./food-event.model";

/** Display helpers shared by Food Event components and Home. */

/** Kilocalories from milli-kilocalories with up to one decimal, or a dash when unknown. */
export function formatEnergy(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value / 1_000);
}

/** Grams from milligrams with up to three decimals, or whole milligrams. */
export function formatNutrient(value: number, unit: "g" | "mg"): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: unit === "g" ? 3 : 0,
  }).format(unit === "g" ? value / 1_000 : value);
}

/** The consumption time on the account's wall clock, such as `2:45 PM`. */
export function formatFoodEventTime(logDate: string, timeZone: string): string {
  const [hour, minute] = utcToZonedDateTime(logDate, timeZone).slice(11, 16).split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

/** Where a food's values came from, such as `USDA FoodData Central · Foundation`. */
export function foodSourceLabel(source: FoodEvent["source"]): string {
  if (source.provider === "open-food-facts") return "Open Food Facts";
  if (source.provider === "manual") return "Manual";
  return `USDA FoodData Central · ${source.dataType}`;
}

/** The amount eaten, such as `1 slice (32 g) × 1.5`. */
export function formatServing(event: Pick<FoodEvent, "measurement" | "quantityMicrounits">): string {
  return `${event.measurement.label} × ${event.quantityMicrounits / 1_000_000}`;
}
