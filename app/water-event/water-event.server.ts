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
import { waterTargetMicrolitersFromDisplay } from "../setup/validation";

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

    const preference = this.#database
      .select({
        displayUnits: userPreferences.displayUnits,
        timeZone: userPreferences.timeZone,
      })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .get();
    if (!preference || !["metric", "us"].includes(preference.displayUnits)) {
      throw new InvalidFoodLogDateError();
    }

    const instant = this.#now();
    const today = localDateAt(instant, preference.timeZone);
    if (foodLogDate > today) throw new FutureFoodLogDateError();
    const amountMicroliters = canonicalWaterAmount(
      parsed.data,
      preference.displayUnits as "metric" | "us",
    );

    const createdAt = instant.toISOString();
    return this.#database
      .insert(waterEvents)
      .values({
        amountMicroliters,
        createdAt,
        foodLogDate,
        localEventTime: localEventTimeForNewFoodLogEvent(
          this.#database,
          userId,
          foodLogDate,
          today,
          instant,
          preference.timeZone,
        ),
        updatedAt: createdAt,
        userId,
      })
      .returning()
      .get();
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
    const preference = this.#database
      .select({ displayUnits: userPreferences.displayUnits })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .get();
    if (!preference || !["metric", "us"].includes(preference.displayUnits)) {
      throw new WaterEventUnavailableError();
    }
    const amountMicroliters = canonicalWaterAmount(
      parsed.data,
      preference.displayUnits as "metric" | "us",
    );
    const updated = this.#database
      .update(waterEvents)
      .set({
        amountMicroliters,
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
