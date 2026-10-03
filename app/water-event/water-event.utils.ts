import { hasUtcOffset, utcToZonedDateTime, zonedDateTimeToUtc } from "../shared/date-time";
import type { WaterEvent, WaterEventList } from "./water-event.model";

export type WaterDisplayUnits = "us" | "metric";

const MILLILITERS_PER_FLUID_OUNCE = 29.5735295625;
const DECIMAL_OUNCES = /^(\d{1,6})(?:\.(\d{1,3}))?$/;

/** A Water Event as REST and MCP callers see it, without its owner. */
export function presentWaterEvent(event: WaterEvent) {
  const { id, logDate, ounces, createdAt, updatedAt } = event;
  return { id, logDate, ounces, createdAt, updatedAt };
}

export function presentWaterEventList(list: WaterEventList) {
  return { events: list.events.map(presentWaterEvent), totalOunces: list.totalOunces };
}

export function presentWaterEventDeletion(deletedCount: number) {
  return { deletedCount };
}

/** Whole ml for metric accounts, or fl oz with up to three decimals. */
export function formatWaterAmount(ounces: string, units: WaterDisplayUnits): string {
  const value = Number(ounces);
  return units === "metric"
    ? `${Math.round(value * MILLILITERS_PER_FLUID_OUNCE)} ml`
    : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value)} fl oz`;
}

/** The consumption time in the account's time zone; legacy rows without an offset keep their local time. */
export function formatWaterTime(logDate: string, timeZone: string): string {
  const [hour, minute] = waterEventLocalDateTime(logDate, timeZone).slice(11, 16).split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

/** The consumption date and time `YYYY-MM-DDTHH:MM:SS` on the account's wall clock. */
export function waterEventLocalDateTime(logDate: string, timeZone: string): string {
  return hasUtcOffset(logDate) ? utcToZonedDateTime(logDate, timeZone) : logDate.slice(0, 19);
}

/** The UTC instant of consumption, reading a legacy local date-time in the account's time zone. */
export function waterEventInstant(logDate: string, timeZone: string): string {
  return hasUtcOffset(logDate) ? logDate : zonedDateTimeToUtc(logDate, timeZone) ?? logDate;
}

/** Thousandths of a fluid ounce in a decimal amount such as `"12.5"`, or null when it is not one. */
export function ounceThousandths(ounces: string): bigint | null {
  const match = DECIMAL_OUNCES.exec(ounces);
  if (!match) return null;
  return BigInt(match[1]) * 1_000n + BigInt((match[2] ?? "").padEnd(3, "0"));
}

/** The canonical decimal spelling of an amount in thousandths, such as `"12.5"` or `"0"`. */
export function formatOunceThousandths(thousandths: bigint): string {
  const whole = thousandths / 1_000n;
  const fraction = String(thousandths % 1_000n).padStart(3, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/** The exact decimal sum of stored amounts. */
export function sumOunces(amounts: readonly string[]): string {
  return formatOunceThousandths(amounts.reduce((total, ounces) => total + (ounceThousandths(ounces) ?? 0n), 0n));
}
