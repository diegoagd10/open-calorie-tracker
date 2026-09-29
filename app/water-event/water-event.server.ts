import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { ApplicationDatabaseClient } from "../database/database.server";
import { userPreferences, waterEvents } from "../database/schema.server";
import { localDateAt, parseIsoLocalDate } from "../food-log/date";
import {
  localEventTimeForNewFoodLogEvent,
  nextUpdatedAt,
} from "../food-log/event-time.server";
import {
  FutureFoodLogDateError,
  InvalidFoodLogDateError,
} from "../food-log/food-log.server";
import {
  waterTargetMicrolitersFromDisplay,
  waterTargetThousandthsFromMicroliters,
} from "../setup/validation";
import {
  waterPresetTotalMicroliters,
  waterPresetTotalOunces,
  type WaterPresetCounts,
} from "./presets";

const presetCountsSchema = z.object({
  "8": z.number().int().nonnegative(),
  "16": z.number().int().nonnegative(),
  "24": z.number().int().nonnegative(),
}).refine((counts) => {
  const ounces = waterPresetTotalOunces(counts);
  return ounces > 0 && ounces <= 500;
});

function storedPresetCounts(counts: WaterPresetCounts) {
  return {
    preset8Count: counts["8"],
    preset16Count: counts["16"],
    preset24Count: counts["24"],
  };
}

function singlePresetCounts(selection: "8" | "16" | "24") {
  return storedPresetCounts({
    "8": Number(selection === "8"),
    "16": Number(selection === "16"),
    "24": Number(selection === "24"),
  });
}

const noPresetCounts = storedPresetCounts({ "8": 0, "16": 0, "24": 0 });

function createWaterEventSchema() {
  return z.discriminatedUnion("selection", [
    z.object({
      amount: z.string().max(32),
      foodLogDate: z.string(),
      selection: z.literal("exact"),
    }),
    z.object({
      foodLogDate: z.string(),
      selection: z.enum(["8", "16", "24"]),
    }),
    z.object({
      counts: presetCountsSchema,
      foodLogDate: z.string(),
      selection: z.literal("presets"),
    }),
  ]);
}

export type CreateWaterEventInput = z.input<
  ReturnType<typeof createWaterEventSchema>
>;

function updateWaterEventSchema() {
  return z.object({
    amount: z.string().max(32),
    expectedUpdatedAt: z.iso.datetime({ offset: true }),
    foodLogDate: z.string(),
    localEventTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    selection: z.enum(["8", "16", "24", "exact"]).default("exact"),
  });
}

export type UpdateWaterEventInput = z.input<
  ReturnType<typeof updateWaterEventSchema>
>;

export class InvalidWaterEventInputError extends Error {
  constructor() {
    super("Enter a valid bounded water amount.");
    this.name = "InvalidWaterEventInputError";
  }
}

export class WaterEventUnavailableError extends Error {
  constructor() {
    super("Water Event is unavailable");
    this.name = "WaterEventUnavailableError";
  }
}

export class WaterEventSetupRequiredError extends Error {
  constructor() {
    super("This account has not finished setup");
    this.name = "WaterEventSetupRequiredError";
  }
}

export class WaterEventIdempotencyConflictError extends Error {
  constructor() {
    super("This idempotency key was already used for a different Water Event");
    this.name = "WaterEventIdempotencyConflictError";
  }
}

/** The channel-prefixed key stored with an external caller's Water Event. */
const storedIdempotencyKeySchema = z.string().min(1).max(128);

export type IdempotentWaterEventInput = {
  counts: WaterPresetCounts;
  /** Omitted means today in the account's time zone; a replay then accepts the stored date. */
  foodLogDate?: string;
};

export class StaleWaterEventError extends Error {
  constructor() {
    super(
      "This Water Event changed after you opened it. Review it and try again.",
    );
    this.name = "StaleWaterEventError";
  }
}

function canonicalWaterAmount(
  input: { amount?: string; selection: "8" | "16" | "24" | "exact" },
  displayUnits: "metric" | "us",
): number {
  const exact = input.selection === "exact";
  const amountMicroliters = waterTargetMicrolitersFromDisplay(
    exact ? (input.amount ?? "") : input.selection,
    exact ? displayUnits : "us",
  );
  if (amountMicroliters === undefined) {
    throw new InvalidWaterEventInputError();
  }
  return amountMicroliters;
}

function updatedWaterValues(
  existing: typeof waterEvents.$inferSelect,
  input: z.output<ReturnType<typeof updateWaterEventSchema>>,
  displayUnits: "metric" | "us",
) {
  const submittedAmount = canonicalWaterAmount(input, displayUnits);
  if (input.selection !== "exact") {
    return {
      amountMicroliters: submittedAmount,
      ...singlePresetCounts(input.selection),
    };
  }

  const amountUnchanged =
    waterTargetThousandthsFromMicroliters(submittedAmount, displayUnits) ===
    waterTargetThousandthsFromMicroliters(existing.amountMicroliters, displayUnits);
  return {
    amountMicroliters: amountUnchanged ? existing.amountMicroliters : submittedAmount,
    ...(amountUnchanged
      ? {
          preset8Count: existing.preset8Count,
          preset16Count: existing.preset16Count,
          preset24Count: existing.preset24Count,
        }
      : noPresetCounts),
  };
}

export class WaterEventService {
  readonly #database: ApplicationDatabaseClient;
  readonly #now: () => Date;

  constructor(
    database: ApplicationDatabaseClient,
    now: () => Date = () => new Date(),
  ) {
    this.#database = database;
    this.#now = now;
  }

  create(userId: number, input: CreateWaterEventInput) {
    const parsed = createWaterEventSchema().safeParse(input);
    if (!parsed.success) throw new InvalidWaterEventInputError();
    const foodLogDate = parseIsoLocalDate(parsed.data.foodLogDate);
    if (!foodLogDate) throw new InvalidFoodLogDateError();

    const preference = this.#unitsAndTimeZone(userId);
    if (!preference) throw new InvalidFoodLogDateError();

    const instant = this.#now();
    const today = localDateAt(instant, preference.timeZone);
    if (foodLogDate > today) throw new FutureFoodLogDateError();
    const amountMicroliters = parsed.data.selection === "presets"
      ? waterPresetTotalMicroliters(parsed.data.counts)
      : canonicalWaterAmount(parsed.data, preference.displayUnits);
    const presetCounts = parsed.data.selection === "presets"
      ? storedPresetCounts(parsed.data.counts)
      : parsed.data.selection === "exact"
        ? noPresetCounts
        : singlePresetCounts(parsed.data.selection);

    return this.#database
      .insert(waterEvents)
      .values(this.#newEventValues(
        this.#database,
        userId,
        { amountMicroliters, ...presetCounts, foodLogDate },
        today,
        instant,
        preference.timeZone,
      ))
      .returning()
      .get();
  }

  /**
   * Creates a container Water Event for an external caller once per stored idempotency key.
   * A retry with the same counts, and either no date or the stored date, replays the original
   * event even after "today" has moved on; any other reuse of the key is a conflict. The
   * unique (user, key) index decides concurrent calls, so the loser resolves the same way.
   */
  createIdempotently(
    userId: number,
    input: IdempotentWaterEventInput,
    idempotencyKey: string,
  ): { event: typeof waterEvents.$inferSelect; replayed: boolean } {
    const counts = presetCountsSchema.safeParse(input.counts);
    if (!counts.success || !storedIdempotencyKeySchema.safeParse(idempotencyKey).success) {
      throw new InvalidWaterEventInputError();
    }
    const requestedDate = input.foodLogDate === undefined
      ? undefined
      : parseIsoLocalDate(input.foodLogDate);
    if (input.foodLogDate !== undefined && !requestedDate) {
      throw new InvalidFoodLogDateError();
    }
    const preference = this.#database
      .select({ timeZone: userPreferences.timeZone })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .get();
    if (!preference) throw new WaterEventSetupRequiredError();

    const instant = this.#now();
    const today = localDateAt(instant, preference.timeZone);
    const foodLogDate = requestedDate ?? today;
    if (foodLogDate > today) throw new FutureFoodLogDateError();
    const presetCounts = storedPresetCounts(counts.data);

    return this.#database.transaction((transaction) => {
      const created = transaction
        .insert(waterEvents)
        .values({
          ...this.#newEventValues(
            transaction,
            userId,
            {
              amountMicroliters: waterPresetTotalMicroliters(counts.data),
              ...presetCounts,
              foodLogDate,
            },
            today,
            instant,
            preference.timeZone,
          ),
          idempotencyKey,
        })
        // The partial (user, key) index is the table's only uniqueness rule; a
        // conflict-target WHERE is not emitted in a form SQLite accepts.
        .onConflictDoNothing()
        .returning()
        .get();
      if (created) return { event: created, replayed: false };

      const existing = transaction
        .select()
        .from(waterEvents)
        .where(
          and(
            eq(waterEvents.userId, userId),
            eq(waterEvents.idempotencyKey, idempotencyKey),
          ),
        )
        .get();
      if (!existing) throw new Error("Water Event insert conflicted without an idempotency match");
      const sameCounts =
        existing.preset8Count === presetCounts.preset8Count &&
        existing.preset16Count === presetCounts.preset16Count &&
        existing.preset24Count === presetCounts.preset24Count;
      if (!sameCounts || (requestedDate && requestedDate !== existing.foodLogDate)) {
        throw new WaterEventIdempotencyConflictError();
      }
      return { event: existing, replayed: true };
    });
  }

  /** The account's display units and time zone, or undefined without setup or with unknown units. */
  #unitsAndTimeZone(userId: number) {
    const preference = this.#database
      .select({
        displayUnits: userPreferences.displayUnits,
        timeZone: userPreferences.timeZone,
      })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .get();
    if (!preference || !["metric", "us"].includes(preference.displayUnits)) {
      return undefined;
    }
    return { ...preference, displayUnits: preference.displayUnits as "metric" | "us" };
  }

  #newEventValues(
    database: Parameters<typeof localEventTimeForNewFoodLogEvent>[0],
    userId: number,
    amount: Pick<
      typeof waterEvents.$inferInsert,
      "amountMicroliters" | "foodLogDate" | "preset8Count" | "preset16Count" | "preset24Count"
    >,
    today: string,
    instant: Date,
    timeZone: string,
  ) {
    const createdAt = instant.toISOString();
    return {
      ...amount,
      createdAt,
      localEventTime: localEventTimeForNewFoodLogEvent(
        database,
        userId,
        amount.foodLogDate,
        today,
        instant,
        timeZone,
      ),
      updatedAt: createdAt,
      userId,
    };
  }

  read(userId: number, eventId: number) {
    const event = this.#database
      .select()
      .from(waterEvents)
      .where(
        and(eq(waterEvents.userId, userId), eq(waterEvents.id, eventId)),
      )
      .get();
    if (!event) throw new WaterEventUnavailableError();
    return event;
  }

  update(userId: number, eventId: number, input: UpdateWaterEventInput) {
    const parsed = updateWaterEventSchema().safeParse(input);
    if (!parsed.success || !Number.isSafeInteger(eventId) || eventId <= 0) {
      throw new InvalidWaterEventInputError();
    }
    const existing = this.read(userId, eventId);
    if (existing.foodLogDate !== parsed.data.foodLogDate) {
      throw new WaterEventUnavailableError();
    }
    const preference = this.#unitsAndTimeZone(userId);
    if (!preference) throw new WaterEventUnavailableError();
    const values = updatedWaterValues(existing, parsed.data, preference.displayUnits);
    const updated = this.#database
      .update(waterEvents)
      .set({
        ...values,
        localEventTime: `${parsed.data.localEventTime}:00`,
        updatedAt: nextUpdatedAt(this.#now(), existing.updatedAt),
      })
      .where(
        and(
          eq(waterEvents.userId, userId),
          eq(waterEvents.id, eventId),
          eq(waterEvents.updatedAt, parsed.data.expectedUpdatedAt),
        ),
      )
      .returning()
      .get();
    if (!updated) throw new StaleWaterEventError();
    return updated;
  }

  delete(
    userId: number,
    eventId: number,
    input: { expectedUpdatedAt: string; foodLogDate: string },
  ) {
    const expectedUpdatedAt = z.iso.datetime({ offset: true }).safeParse(
      input.expectedUpdatedAt,
    );
    if (
      !expectedUpdatedAt.success ||
      !parseIsoLocalDate(input.foodLogDate) ||
      !Number.isSafeInteger(eventId) ||
      eventId <= 0
    ) {
      throw new InvalidWaterEventInputError();
    }
    const existing = this.read(userId, eventId);
    if (existing.foodLogDate !== input.foodLogDate) {
      throw new WaterEventUnavailableError();
    }
    const deleted = this.#database
      .delete(waterEvents)
      .where(
        and(
          eq(waterEvents.userId, userId),
          eq(waterEvents.id, eventId),
          eq(waterEvents.updatedAt, expectedUpdatedAt.data),
        ),
      )
      .returning({ foodLogDate: waterEvents.foodLogDate })
      .get();
    if (!deleted) throw new StaleWaterEventError();
    return deleted;
  }
}
