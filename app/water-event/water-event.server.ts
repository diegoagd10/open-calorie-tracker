import { localDayRange, parseIsoDateTime } from "../shared/date-time";
import type { CreateWaterEvent, WaterEvent, WaterEventList, WaterEventRange } from "./water-event.model";
import type { WaterEventRepository } from "./water-event.repository.server";
import { WaterEventNotFoundError, WaterEventValidationError } from "./water-events.exceptions";
import {
  formatOunceThousandths,
  ounceThousandths,
  sumOunces,
  waterEventLocalDateTime,
} from "./water-event.utils";

const MINIMUM_OUNCE_THOUSANDTHS = 1n;
const MAXIMUM_OUNCE_THOUSANDTHS = 500_000n;
const MAXIMUM_DELETED_IDS = 100;
/** How far ahead of the server clock a consumption time may be, for callers whose clocks run fast. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

function isEventId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** The canonical spelling of an amount from 0.001 through 500 fl oz with at most three decimals. */
function validOunces(quantity: unknown): string {
  const ounces = typeof quantity === "object" && quantity !== null ? (quantity as { ounces?: unknown }).ounces : undefined;
  const thousandths = typeof ounces === "string" ? ounceThousandths(ounces) : null;
  if (thousandths === null || thousandths < MINIMUM_OUNCE_THOUSANDTHS || thousandths > MAXIMUM_OUNCE_THOUSANDTHS) {
    throw new WaterEventValidationError(
      "invalid_amount",
      "Enter an amount from 0.001 to 500 fl oz, with at most three decimals.",
    );
  }
  return formatOunceThousandths(thousandths);
}

/** Water Event rules shared by the web app, the REST API, and MCP tools. */
export class WaterEventService {
  readonly #repository: WaterEventRepository;
  readonly #now: () => Date;

  constructor(repository: WaterEventRepository, now: () => Date) {
    this.#repository = repository;
    this.#now = now;
  }

  /**
   * Creates an event without `id`; with `id`, changes only that owned event's amount, and a
   * `logDate` sent with it is ignored because the consumption time cannot change.
   */
  save(userId: number, input: CreateWaterEvent): WaterEvent {
    const ounces = validOunces(input.quantity);
    if (input.id !== undefined) {
      if (!isEventId(input.id)) {
        throw new WaterEventValidationError("invalid_input", "To edit a Water Event, send its positive integer id.");
      }
      const updated = this.#repository.save(userId, { id: input.id, quantity: { ounces } });
      if (!updated) throw new WaterEventNotFoundError();
      return updated;
    }
    const logDate = typeof input.logDate === "string" ? parseIsoDateTime(input.logDate) : null;
    const latest = new Date(this.#now().getTime() + FUTURE_TOLERANCE_MS).toISOString();
    if (!logDate || logDate > latest) {
      throw new WaterEventValidationError(
        "invalid_log_date",
        "Enter when the water was consumed as an ISO date-time with an offset, not in the future.",
      );
    }
    return this.#repository.save(userId, { logDate, quantity: { ounces } })!;
  }

  read(userId: number, eventId: number): WaterEvent {
    const event = isEventId(eventId) ? this.#repository.findById(userId, eventId) : null;
    if (!event) throw new WaterEventNotFoundError();
    return event;
  }

  /** Owned events consumed from `range.from` (inclusive) to `range.to` (exclusive), newest first. */
  list(userId: number, range: WaterEventRange): WaterEventList {
    const from = typeof range.from === "string" ? parseIsoDateTime(range.from) : null;
    const to = typeof range.to === "string" ? parseIsoDateTime(range.to) : null;
    if (!from || !to || from >= to) {
      throw new WaterEventValidationError(
        "invalid_range",
        "Send from and to as ISO date-times with offsets, with from before to.",
      );
    }
    const events = this.#repository.list(userId, { from, to });
    return { events, totalOunces: sumOunces(events.map((event) => event.ounces)) };
  }

  /** Removes the owned events among `eventIds`; missing and other accounts' IDs are ignored. */
  delete(userId: number, eventIds: readonly number[]): number {
    if (!Array.isArray(eventIds) || eventIds.length > MAXIMUM_DELETED_IDS || !eventIds.every(isEventId)) {
      throw new WaterEventValidationError(
        "invalid_event_ids",
        `Send eventIds as an array of at most ${MAXIMUM_DELETED_IDS} positive integer IDs.`,
      );
    }
    return this.#repository.delete(userId, [...new Set(eventIds)]);
  }

  /** The local day in `timeZone` containing `logDate` and that day's total ounces. */
  daySummary(userId: number, logDate: string, timeZone: string): { date: string; totalOunces: string } {
    const date = waterEventLocalDateTime(logDate, timeZone).slice(0, 10);
    return { date, totalOunces: this.list(userId, localDayRange(date, timeZone)).totalOunces };
  }

  /** The account's time zone, or null before setup. */
  timeZone(userId: number): string | null {
    return this.#repository.timeZone(userId);
  }
}
