import { utcToZonedDateTime } from "../shared/date-time";
import type { WaterEvent, WaterEventList } from "./water-event.model";

const DECIMAL_OUNCES = /^(\d+)(?:\.(\d{1,3}))?$/;

/**
 * A Water Event as REST and MCP callers see it, without its owner. Amounts are JSON numbers;
 * with at most three decimals and 500 fl oz, a number represents each one exactly.
 */
export function presentWaterEvent(event: WaterEvent) {
  const { id, logDate, ounces, createdAt, updatedAt } = event;
  return { id, logDate, ounces: Number(ounces), createdAt, updatedAt };
}

export function presentWaterEventList(list: WaterEventList) {
  return { events: list.events.map(presentWaterEvent), totalOunces: Number(list.totalOunces) };
}

/** A JSON amount as the decimal text Water Events store; anything but a finite number fails validation. */
export function ouncesFromJson(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

export function presentWaterEventDeletion(deletedCount: number) {
  return { deletedCount };
}

/** Fluid ounces with up to three decimals, such as `67.628 fl oz`. */
export function formatWaterAmount(ounces: string): string {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(Number(ounces))} fl oz`;
}

/** The consumption time on the account's wall clock, such as `2:45 PM`. */
export function formatWaterTime(logDate: string, timeZone: string): string {
  const [hour, minute] = waterEventLocalDateTime(logDate, timeZone).slice(11, 16).split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

/** The consumption date and time `YYYY-MM-DDTHH:MM:SS` on the account's wall clock. */
export function waterEventLocalDateTime(logDate: string, timeZone: string): string {
  return utcToZonedDateTime(logDate, timeZone);
}

/**
 * Thousandths of a fluid ounce in a decimal amount such as `"12.5"`, or null when it is not one.
 * Any number of whole ounces parses, so daily totals do too; callers enforce their own ranges.
 */
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
