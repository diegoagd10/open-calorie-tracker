import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  CatalogInvalidResponseError,
  CatalogUnsafeMeasurementError,
  type FoodCatalogProvider,
} from "../catalog/food-catalog.server";
import type { ApplicationDatabaseClient } from "../database/database.server";
import { foodEntries, userPreferences } from "../database/schema.server";
import { localDateAt, parseIsoLocalDate } from "../food-log/date";
import {
  FutureFoodLogDateError,
  InvalidFoodLogDateError,
} from "../food-log/food-log.server";
import { foodEntrySnapshot, scaleCatalogNutrient } from "./snapshot.server";

const logFoodInputSchema = z.object({
  foodLogDate: z.string(),
  idempotencyKey: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/),
  providerFoodId: z.string().regex(/^[1-9]\d*$/),
  quantity: z.string().trim().min(1).max(32),
  selectedMeasurementId: z.string().min(1).max(128),
});

export type LogFoodInput = z.input<typeof logFoodInputSchema>;

export class InvalidFoodEntryInputError extends Error {
  constructor() {
    super("The Food Entry request is invalid");
    this.name = "InvalidFoodEntryInputError";
  }
}

function quantityMicrounits(value: string): number {
  const match = /^(\d{1,2})(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) throw new InvalidFoodEntryInputError();
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(6, "0"));
  const result = whole * 1_000_000n + fraction;
  if (result <= 0n || result > 99_000_000n) {
    throw new InvalidFoodEntryInputError();
  }
  return Number(result);
}

function localTimeAt(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    second: "2-digit",
    timeZone,
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("hour")}:${value("minute")}:${value("second")}`;
}

function nextRetroactiveTime(latest: string | undefined): string {
  if (!latest) return "12:00:00";
  const [hour, minute, second] = latest.split(":").map(Number);
  const totalSeconds = hour * 3_600 + minute * 60 + second;
  if (totalSeconds >= 86_340) return latest;
  const next = totalSeconds + 60;
  return [Math.floor(next / 3_600), Math.floor((next % 3_600) / 60), next % 60]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

export class FoodEntryService {
  readonly #database: ApplicationDatabaseClient;
  readonly #now: () => Date;
  readonly #provider: FoodCatalogProvider;

  constructor(
    database: ApplicationDatabaseClient,
    provider: FoodCatalogProvider,
    now: () => Date = () => new Date(),
  ) {
    this.#database = database;
    this.#provider = provider;
    this.#now = now;
  }

  async log(userId: number, input: LogFoodInput) {
    const parsed = logFoodInputSchema.safeParse(input);
    if (!parsed.success) throw new InvalidFoodEntryInputError();
    const quantity = quantityMicrounits(parsed.data.quantity);

    const existing = this.#database
      .select()
      .from(foodEntries)
      .where(
        and(
          eq(foodEntries.userId, userId),
          eq(foodEntries.idempotencyKey, parsed.data.idempotencyKey),
        ),
      )
      .get();
    if (existing) return foodEntrySnapshot(existing);

    this.#requireWritableDate(userId, parsed.data.foodLogDate);
    const food = await this.#provider.getFood(parsed.data.providerFoodId);
    if (food.providerFoodId !== parsed.data.providerFoodId) {
      throw new CatalogInvalidResponseError();
    }
    const measurement = food.measurements.find(
      (candidate) => candidate.id === parsed.data.selectedMeasurementId,
    );
    if (!measurement || measurement.unit !== food.authoritativeBaseUnit) {
      throw new CatalogUnsafeMeasurementError();
    }

    const instant = this.#now();
    const createdAt = instant.toISOString();
    const scale = (value: Parameters<typeof scaleCatalogNutrient>[0]) =>
      scaleCatalogNutrient(
        value,
        measurement.baseQuantityMicrounits,
        quantity,
        food.authoritativeBaseQuantityMicrounits,
      );
    return this.#database.transaction((transaction) => {
      const repeated = transaction
        .select()
        .from(foodEntries)
        .where(
          and(
            eq(foodEntries.userId, userId),
            eq(foodEntries.idempotencyKey, parsed.data.idempotencyKey),
          ),
        )
        .get();
      if (repeated) return foodEntrySnapshot(repeated);

      const preference = transaction
        .select({ timeZone: userPreferences.timeZone })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .get();
      if (!preference) throw new InvalidFoodLogDateError();
      const today = localDateAt(instant, preference.timeZone);
      if (parsed.data.foodLogDate > today) throw new FutureFoodLogDateError();

      const latest =
        parsed.data.foodLogDate === today
          ? undefined
          : transaction
              .select({ localEventTime: foodEntries.localEventTime })
              .from(foodEntries)
              .where(
                and(
                  eq(foodEntries.userId, userId),
                  eq(foodEntries.foodLogDate, parsed.data.foodLogDate),
                ),
              )
              .orderBy(
                desc(foodEntries.localEventTime),
                desc(foodEntries.createdAt),
                desc(foodEntries.id),
              )
              .limit(1)
              .get()?.localEventTime;
      const localEventTime =
        parsed.data.foodLogDate === today
          ? localTimeAt(instant, preference.timeZone)
          : nextRetroactiveTime(latest);

      const row = transaction
        .insert(foodEntries)
        .values({
          authoritativeBaseQuantityMicrounits:
            food.authoritativeBaseQuantityMicrounits,
          authoritativeBaseUnit: food.authoritativeBaseUnit,
          carbohydrateMilligrams: scale(
            food.nutritionPerAuthoritativeBase.carbohydrateMilligrams,
          ),
          energyMilliKcal: scale(
            food.nutritionPerAuthoritativeBase.energyMilliKcal,
          ),
          fatMilligrams: scale(
            food.nutritionPerAuthoritativeBase.fatMilligrams,
          ),
          fiberMilligrams: scale(
            food.nutritionPerAuthoritativeBase.fiberMilligrams,
          ),
          proteinMilligrams: scale(
            food.nutritionPerAuthoritativeBase.proteinMilligrams,
          ),
          sodiumMilligrams: scale(
            food.nutritionPerAuthoritativeBase.sodiumMilligrams,
          ),
          sugarMilligrams: scale(
            food.nutritionPerAuthoritativeBase.sugarMilligrams,
          ),
          barcode: food.barcode,
          brand: food.brand,
          createdAt,
          foodLogDate: parsed.data.foodLogDate,
          idempotencyKey: parsed.data.idempotencyKey,
          localEventTime,
          marketCountry: food.marketCountry,
          originalName: food.name,
          provider: food.provider,
          providerFoodId: food.providerFoodId,
          providerModifiedDate: food.providerModifiedDate,
          providerPublishedDate: food.providerPublishedDate,
          quantityMicrounits: quantity,
          selectedMeasurementBaseQuantityMicrounits:
            measurement.baseQuantityMicrounits,
          selectedMeasurementId: measurement.id,
          selectedMeasurementLabel: measurement.label,
          selectedMeasurementUnit: measurement.unit,
          sourceDataType: food.dataType,
          updatedAt: createdAt,
          userId,
        })
        .returning()
        .get();
      return foodEntrySnapshot(row);
    });
  }

  #requireWritableDate(userId: number, value: string): void {
    const date = parseIsoLocalDate(value);
    if (!date) throw new InvalidFoodLogDateError();
    const preference = this.#database
      .select({ timeZone: userPreferences.timeZone })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .get();
    if (!preference) throw new InvalidFoodLogDateError();
    if (date > localDateAt(this.#now(), preference.timeZone)) {
      throw new FutureFoodLogDateError();
    }
  }
}
