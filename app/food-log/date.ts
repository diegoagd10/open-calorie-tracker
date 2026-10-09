import { utcToZonedDateTime } from "../shared/date-time";

/** What orders the Food Log timeline: consumption time, then save time, then kind, then ID. */
export type FoodLogEventOrderKey = {
  createdAt: string;
  id: number;
  kind: "food" | "water";
  /** UTC ISO consumption instant. */
  logDate: string;
};

const EVENT_KIND_TIE_BREAKER = { food: 1, water: 0 } as const;

/**
 * Newest first. Food and water IDs come from different tables and can be equal, so kind
 * breaks ties before ID, putting food first.
 */
export function compareFoodLogEventsDescending(
  left: FoodLogEventOrderKey,
  right: FoodLogEventOrderKey,
): number {
  return (
    right.logDate.localeCompare(left.logDate) ||
    right.createdAt.localeCompare(left.createdAt) ||
    EVENT_KIND_TIE_BREAKER[right.kind] - EVENT_KIND_TIE_BREAKER[left.kind] ||
    right.id - left.id
  );
}

/** The `HH:MM` wall-clock time in `timeZone` of a UTC consumption instant. */
export function localTimeOfDay(logDate: string, timeZone: string): string {
  return utcToZonedDateTime(logDate, timeZone).slice(11, 16);
}
