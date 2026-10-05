import { z } from "zod";

import type { FoodCatalog } from "../catalog/food-catalog.server";
import { parseIsoDateTime, utcToZonedDateTime } from "../shared/date-time";
import { localDateAt, parseIsoLocalDate } from "../shared/local-date";
import type {
  CopyFoodEvent,
  CreateFoodEvent,
  EditFoodEvent,
  Favorite,
  FindFavorites,
  FoodEvent,
  FoodEventChanges,
  FoodEventList,
  FoodEventRange,
  FoodSnapshot,
  SaveFoodEvent,
  ScaledNutrients,
  VersionedId,
} from "./food-event.model";
import {
  FoodEventConflictError,
  FoodEventNotFoundError,
  FoodEventValidationError,
  type FoodEventValidationCode,
} from "./food-event.exceptions";
import type { FavoritePolicy, FoodEventRepository } from "./food-event.repository.server";
import { resolveCatalogFood } from "./methods/catalog.server";
import { favoriteFood } from "./methods/favorite.server";
import { manualAuthoritativeNutrient, manualSnapshot, validFoodName } from "./methods/manual.server";
import {
  NUTRIENT_FIELDS,
  nutrientFromDecimal,
  nutritionTotals,
  quantityMicrounitsFromDecimal,
  scaleNutrients,
} from "./nutrition";
import { snapshotColumns } from "./snapshot.server";

const MAXIMUM_DELETED_EVENTS = 100;
/** How far ahead of the server clock a consumption time may be, for callers whose clocks run fast. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

/** Request correlation passed to catalog providers. */
export type FoodEventContext = { requestId?: string };

function invalid(code: FoodEventValidationCode, message: string): FoodEventValidationError {
  return new FoodEventValidationError(code, message);
}

function isEventId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validQuantity(quantity: unknown): number {
  const microunits = typeof quantity === "string" ? quantityMicrounitsFromDecimal(quantity) : undefined;
  if (microunits === undefined) {
    throw invalid("invalid_quantity", "Enter a quantity greater than 0 and at most 99, with at most six decimals.");
  }
  return microunits;
}

function validLogDate(logDate: unknown): string {
  const parsed = typeof logDate === "string" ? parseIsoDateTime(logDate) : null;
  if (!parsed) {
    throw invalid("invalid_log_date", "Send when the food was eaten as an ISO date-time with an offset.");
  }
  return parsed;
}

const versionSchema = z.iso.datetime({ offset: true });

function validVersion(value: unknown): string {
  const parsed = versionSchema.safeParse(value);
  if (!parsed.success) throw invalid("invalid_input", "Send expectedUpdatedAt as the updatedAt of the version you read.");
  return parsed.data;
}

/** The snapshot part of an event, which copies and favorites keep independently. */
function snapshotOf(event: FoodEvent): FoodSnapshot {
  const { source, originalName, editedName, authority, measurements, measurement, quantityMicrounits, nutrients } = event;
  return { source, originalName, editedName, authority, measurements, measurement, quantityMicrounits, nutrients };
}

function isEdit(input: SaveFoodEvent): input is EditFoodEvent {
  return typeof input === "object" && input !== null && "id" in input && input.id !== undefined;
}

/**
 * An edit of `current`: quantity and measurement rescale from the stored authority, never from
 * rounded values; omitted nutrients keep their value unless the amount changed; null clears one.
 * A manual food's changed nutrient redefines its authority per serving.
 */
function editedSnapshot(current: FoodEvent, changes: FoodEventChanges): FoodSnapshot {
  if (typeof changes !== "object" || changes === null) throw invalid("invalid_input", "Send the changes to make.");
  const quantityMicrounits = changes.quantity === undefined ? current.quantityMicrounits : validQuantity(changes.quantity);
  const measurement = changes.measurementId === undefined
    ? current.measurement
    : current.measurements.find((candidate) => candidate.id === changes.measurementId);
  if (!measurement || measurement.unit !== current.authority.unit) {
    throw invalid("invalid_measurement", "Choose one of this food's saved measurements.");
  }
  const rescaled = quantityMicrounits !== current.quantityMicrounits || measurement.id !== current.measurement.id;
  const scaled = scaleNutrients(current.authority, measurement, quantityMicrounits);
  const manual = current.source.provider === "manual";
  const entered = typeof changes.nutrition === "object" && changes.nutrition !== null ? changes.nutrition : {};
  const nutrients: ScaledNutrients = { ...scaled };
  const nutrition = { ...current.authority.nutrition };
  for (const { field, nutrient, wholeMilligrams } of NUTRIENT_FIELDS) {
    const value = entered[field];
    if (value === undefined) {
      if (!rescaled) nutrients[nutrient] = current.nutrients[nutrient];
      continue;
    }
    const amount = value === null ? null : typeof value === "string" ? nutrientFromDecimal(value, wholeMilligrams) : undefined;
    if (amount === undefined) {
      throw invalid("invalid_nutrition", "Enter nutrients as non-negative amounts: up to three decimals, or whole milligrams of sodium.");
    }
    if (manual && field === "energyKcal" && amount === null) {
      throw invalid("invalid_nutrition", "Manual foods need calories; zero is allowed.");
    }
    nutrients[nutrient] = amount;
    if (manual && amount !== scaled[nutrient]) {
      nutrition[nutrient] = manualAuthoritativeNutrient(amount, wholeMilligrams, quantityMicrounits);
    }
  }
  return {
    ...snapshotOf(current),
    editedName: changes.name === undefined ? current.editedName : validFoodName(changes.name),
    authority: { ...current.authority, nutrition },
    measurement,
    quantityMicrounits,
    nutrients,
  };
}

/** Food Event rules shared by the web app, the REST API, and MCP tools. */
export class FoodEventService {
  readonly #repository: FoodEventRepository;
  readonly #catalog: Pick<FoodCatalog, "getFood">;
  readonly #now: () => Date;

  constructor(repository: FoodEventRepository, catalog: Pick<FoodCatalog, "getFood">, now: () => Date) {
    this.#repository = repository;
    this.#catalog = catalog;
    this.#now = now;
  }

  /**
   * Creates an event by one of the four methods, or with `id` edits the version read at
   * `expectedUpdatedAt`. A create checks the account and time before any provider work, resolves
   * the food outside the database transaction, then rechecks both inside it.
   */
  async save(userId: number, input: SaveFoodEvent, context: FoodEventContext = {}): Promise<FoodEvent> {
    if (typeof input !== "object" || input === null) throw invalid("invalid_input", "Send a Food Event to save.");
    if (isEdit(input)) return this.#edit(userId, input);
    const logDate = validLogDate(input.logDate);
    this.#requireWritableTime(this.#repository.timeZone(userId), logDate);
    const { snapshot, favorite } = await this.#resolve(userId, input, context);
    return this.#repository.insert(
      userId,
      { logDate, snapshot, favorite },
      (timeZone) => this.#requireWritableTime(timeZone, logDate),
    );
  }

  /** Dispatches over the closed set of add methods; each fixes its source and favorite policy. */
  async #resolve(
    userId: number,
    input: CreateFoodEvent,
    context: FoodEventContext,
  ): Promise<{ snapshot: FoodSnapshot; favorite: FavoritePolicy }> {
    switch (input.method) {
      case "lookup":
      case "barcode": {
        const quantity = validQuantity(input.quantity);
        return { snapshot: await resolveCatalogFood(this.#catalog, input, quantity, context.requestId), favorite: "none" };
      }
      case "manual":
        return {
          snapshot: manualSnapshot(input, validQuantity(input.quantity)),
          favorite: input.saveAsFavorite === true ? "create" : "none",
        };
      case "favorite":
        return favoriteFood(this.#repository, userId, input.favoriteId);
      default:
        throw invalid("invalid_input", "Send method as lookup, barcode, manual, or favorite.");
    }
  }

  #edit(userId: number, input: EditFoodEvent): FoodEvent {
    if (!isEventId(input.id)) throw invalid("invalid_input", "To edit a Food Event, send its positive integer id.");
    const expectedUpdatedAt = validVersion(input.expectedUpdatedAt);
    const current = this.read(userId, input.id);
    if (current.updatedAt !== expectedUpdatedAt) throw new FoodEventConflictError(current);
    const edited = snapshotColumns(editedSnapshot(current, input.changes));
    const updated = this.#repository.update(userId, { id: input.id, expectedUpdatedAt }, edited);
    if (updated) return updated;
    throw new FoodEventConflictError(this.read(userId, input.id));
  }

  /** Account setup exists and `logDate` is not in the future. */
  #requireWritableTime(timeZone: string | null, logDate: string): void {
    if (!timeZone) throw invalid("missing_setup", "Finish setup before logging food.");
    const latest = new Date(this.#now().getTime() + FUTURE_TOLERANCE_MS).toISOString();
    if (logDate > latest) throw invalid("future_date", "Food can only be logged for now or earlier.");
  }

  read(userId: number, eventId: number): FoodEvent {
    const event = isEventId(eventId) ? this.#repository.findById(userId, eventId) : null;
    if (!event) throw new FoodEventNotFoundError();
    return event;
  }

  /**
   * Owned events eaten from `range.from` (inclusive) to `range.to` (exclusive), newest first,
   * with totals and per-day totals grouped by local date in the account's time zone.
   */
  list(userId: number, range: FoodEventRange): FoodEventList {
    const from = typeof range?.from === "string" ? parseIsoDateTime(range.from) : null;
    const to = typeof range?.to === "string" ? parseIsoDateTime(range.to) : null;
    if (!from || !to || from >= to) {
      throw invalid("invalid_range", "Send from and to as ISO date-times with offsets, with from before to.");
    }
    const timeZone = this.#repository.timeZone(userId);
    if (!timeZone) throw invalid("missing_setup", "Finish setup before reading food.");
    const events = this.#repository.list(userId, { from, to });
    const byDay = new Map<string, FoodEvent[]>();
    for (const event of events) {
      const day = localDay(event.logDate, timeZone);
      byDay.set(day, [...(byDay.get(day) ?? []), event]);
    }
    return {
      events,
      totals: nutritionTotals(events.map((event) => event.nutrients)),
      days: Object.fromEntries([...byDay].map(([day, dayEvents]) => [
        day,
        { eventCount: dayEvents.length, totals: nutritionTotals(dayEvents.map((event) => event.nutrients)) },
      ])),
    };
  }

  /**
   * Deletes every listed event at its expected version in one transaction, or none: a missing
   * or unowned item is not found, and a changed one is a conflict carrying its current version.
   */
  delete(userId: number, items: readonly VersionedId[]): number {
    if (!Array.isArray(items) || items.length > MAXIMUM_DELETED_EVENTS) {
      throw invalid("invalid_event_ids", `Send at most ${MAXIMUM_DELETED_EVENTS} events, each with its id and expectedUpdatedAt.`);
    }
    const versions = new Map<number, string>();
    for (const item of items as unknown[]) {
      const { id, expectedUpdatedAt } = (typeof item === "object" && item !== null ? item : {}) as Partial<VersionedId>;
      const version = versionSchema.safeParse(expectedUpdatedAt);
      if (!isEventId(id) || !version.success || (versions.has(id) && versions.get(id) !== version.data)) {
        throw invalid("invalid_event_ids", `Send at most ${MAXIMUM_DELETED_EVENTS} events, each with its id and expectedUpdatedAt.`);
      }
      versions.set(id, version.data);
    }
    const outcome = this.#repository.delete(userId, [...versions].map(([id, expectedUpdatedAt]) => ({ id, expectedUpdatedAt })));
    if ("missing" in outcome) throw new FoodEventNotFoundError();
    if ("stale" in outcome) throw new FoodEventConflictError(outcome.stale);
    return outcome.deleted;
  }

  /**
   * Copies an earlier day's event from its stored snapshot, so it works with providers offline.
   * The source must be on `sourceDate`, before today; the copy goes to a different local day,
   * not in the future, and keeps the source's favorite link.
   */
  copy(userId: number, input: CopyFoodEvent): FoodEvent {
    if (!isEventId(input?.eventId) || typeof input.sourceDate !== "string" || !parseIsoLocalDate(input.sourceDate)) {
      throw invalid("invalid_input", "Send the eventId and sourceDate of the Food Event to copy.");
    }
    const logDate = validLogDate(input.logDate);
    const timeZone = this.#repository.timeZone(userId);
    this.#requireWritableTime(timeZone, logDate);
    const source = this.read(userId, input.eventId);
    const sourceDay = localDay(source.logDate, timeZone!);
    if (sourceDay !== input.sourceDate) throw new FoodEventNotFoundError();
    if (sourceDay >= localDateAt(this.#now(), timeZone!)) {
      throw invalid("invalid_input", "Only food from an earlier day can be copied.");
    }
    if (localDay(logDate, timeZone!) === sourceDay) {
      throw invalid("invalid_log_date", "Copy the food to a different day than the original.");
    }
    return this.#repository.insert(
      userId,
      {
        logDate,
        snapshot: snapshotOf(source),
        copiedFromId: source.id,
        favorite: source.favoriteId === null ? "none" : { reuse: source.favoriteId },
      },
      (current) => this.#requireWritableTime(current, logDate),
    );
  }

  /** Favorites whose name contains `query`, or the one favorite with `favoriteId`. */
  findFavorites(userId: number, query: FindFavorites): Favorite[] {
    if ("favoriteId" in query) {
      const favorite = isEventId(query.favoriteId) ? this.#repository.findFavorite(userId, query.favoriteId) : null;
      return favorite ? [favorite] : [];
    }
    return this.#repository.findFavorites(userId, typeof query.query === "string" ? query.query : "");
  }

  /**
   * Saves an owned manual event to My foods, once: a repeat, or an event already reused from a
   * favorite, returns the existing favorite. Catalog foods cannot be favorites.
   */
  addFavorite(userId: number, eventId: number): Favorite {
    const favorite = isEventId(eventId) ? this.#repository.addFavorite(userId, eventId) : null;
    if (!favorite) throw new FoodEventNotFoundError();
    if (favorite === "not_manual") throw invalid("invalid_input", "Only manual foods can be saved to My foods.");
    return favorite;
  }

  /** The account's time zone, or null before setup. */
  timeZone(userId: number): string | null {
    return this.#repository.timeZone(userId);
  }
}

/** The local date `YYYY-MM-DD` in `timeZone` of a UTC consumption instant. */
export function localDay(logDate: string, timeZone: string): string {
  return utcToZonedDateTime(logDate, timeZone).slice(0, 10);
}
