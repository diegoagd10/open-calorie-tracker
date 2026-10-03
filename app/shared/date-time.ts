/** Generic ISO date-time helpers, independent of any feature. */

const ISO_DATE_TIME_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function validCalendarFields(year: number, month: number, day: number, hour: number, minute: number, second: number): boolean {
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false;
  const lastDay = new Date(Date.UTC(2000, month, 0));
  lastDay.setUTCFullYear(year, month, 0);
  return day <= lastDay.getUTCDate();
}

/**
 * Validates an ISO date-time with an explicit `Z` or numeric offset and normalizes it to
 * a UTC ISO string, or returns null for an invalid value or one without an offset.
 */
export function parseIsoDateTime(value: string): string | null {
  const match = ISO_DATE_TIME_WITH_OFFSET.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second = 0] = match.slice(1, 7).map((part) => Number(part ?? 0));
  const offset = match[8];
  if (!validCalendarFields(year, month, day, hour, minute, second)) return null;
  if (offset !== "Z" && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59)) return null;
  return new Date(value).toISOString();
}

function offsetMinutesAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(instant));
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)!.value);
  const wallClock = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
  return Math.round((wallClock - Math.floor(instant / 1_000) * 1_000) / 60_000);
}

/**
 * The UTC instant of a wall-clock `YYYY-MM-DDTHH:MM[:SS]` in `timeZone`, or null when the
 * value is not a valid local date-time. Daylight-saving transitions follow RFC 5545 §3.3.5,
 * as calendars do: a repeated time (clocks go back) is its first occurrence, and a skipped
 * time (clocks go forward) uses the offset before the gap, which moves it forward.
 */
export function zonedDateTimeToUtc(localDateTime: string, timeZone: string): string | null {
  const match = LOCAL_DATE_TIME.exec(localDateTime);
  if (!match) return null;
  const [year, month, day, hour, minute, second = 0] = match.slice(1, 7).map((part) => Number(part ?? 0));
  if (!validCalendarFields(year, month, day, hour, minute, second)) return null;
  const wallClock = new Date(0);
  wallClock.setUTCFullYear(year, month - 1, day);
  wallClock.setUTCHours(hour, minute, second, 0);
  const asUtc = wallClock.getTime();
  const before = offsetMinutesAt(asUtc - 86_400_000, timeZone);
  const after = offsetMinutesAt(asUtc + 86_400_000, timeZone);
  const candidates = [...new Set([before, after])]
    .map((offset) => asUtc - offset * 60_000)
    .filter((instant) => offsetMinutesAt(instant, timeZone) === Math.round((asUtc - instant) / 60_000))
    .sort((left, right) => left - right);
  const instant = candidates[0] ?? asUtc - before * 60_000;
  return new Date(instant).toISOString();
}

/** The wall-clock date and time `YYYY-MM-DDTHH:MM:SS` of a UTC instant in `timeZone`. */
export function utcToZonedDateTime(instant: string, timeZone: string): string {
  const time = new Date(instant).getTime();
  return new Date(time + offsetMinutesAt(time, timeZone) * 60_000).toISOString().slice(0, 19);
}

/** The UTC range `[from, to)` covering local calendar day `YYYY-MM-DD` in `timeZone`. */
export function localDayRange(localDate: string, timeZone: string): { from: string; to: string } {
  const start = zonedDateTimeToUtc(`${localDate}T00:00:00`, timeZone);
  if (!start) throw new Error("Invalid local date");
  const next = new Date(Date.UTC(2000, 0, 1));
  next.setUTCFullYear(Number(localDate.slice(0, 4)), Number(localDate.slice(5, 7)) - 1, Number(localDate.slice(8, 10)) + 1);
  return { from: start, to: zonedDateTimeToUtc(`${next.toISOString().slice(0, 10)}T00:00:00`, timeZone)! };
}
