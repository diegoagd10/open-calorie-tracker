import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  CatalogInvalidResponseError,
  CatalogUnsafeMeasurementError,
  type CatalogOperationContext,
  type FoodCatalogProvider,
} from "../catalog/food-catalog.server";
import type { ApplicationDatabaseClient } from "../database/database.server";
import { foodEntries, userPreferences } from "../database/schema.server";
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
  foodEntrySnapshot,
  parseCatalogNutrition,
  scaleCatalogNutrient,
  serializeCatalogMeasurements,
  serializeCatalogNutrition,
} from "./snapshot.server";
import {
  quantityMicrounitsFromDecimal,
  type NutrientStorageScale,
} from "./nutrition";

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

const updateFoodInputSchema = z.object({
  carbohydrateGrams: z.string().max(32).optional(),
  energyKcal: z.string().max(32).optional(),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  fatGrams: z.string().max(32).optional(),
  fiberGrams: z.string().max(32).optional(),
  foodLogDate: z.string(),
  name: z.string().trim().min(1).max(200),
  proteinGrams: z.string().max(32).optional(),
  quantity: z.string().trim().min(1).max(32),
  selectedMeasurementId: z.string().min(1).max(128),
  sodiumMilligrams: z.string().max(32).optional(),
  sugarGrams: z.string().max(32).optional(),
});

export type LogFoodInput = z.input<typeof logFoodInputSchema>;
export type UpdateFoodInput = z.input<typeof updateFoodInputSchema>;

export class InvalidFoodEntryInputError extends Error {
  constructor() {
    super("The Food Entry request is invalid");
    this.name = "InvalidFoodEntryInputError";
  }
}

export class FoodEntryUnavailableError extends Error {
  constructor() {
    super("Food Entry is unavailable");
    this.name = "FoodEntryUnavailableError";
  }
}

export class StaleFoodEntryError extends Error {
  constructor() {
    super(
      "This Food Entry changed after you opened it. Review it and try again.",
    );
    this.name = "StaleFoodEntryError";
  }
}

function quantityMicrounits(value: string): number {
  const result = quantityMicrounitsFromDecimal(value);
  if (result === undefined) throw new InvalidFoodEntryInputError();
  return result;
}

function nullableNutrient(
  value: string | undefined,
  storageScale: NutrientStorageScale,
): number | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match =
    storageScale === "integer-milligrams"
      ? /^(\d{1,7})$/.exec(trimmed)
      : /^(\d{1,6})(?:\.(\d{1,3}))?$/.exec(trimmed);
  if (!match) throw new InvalidFoodEntryInputError();
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(3, "0"));
  const multiplier = storageScale === "integer-milligrams" ? 1n : 1_000n;
  const result = whole * multiplier + fraction;
  if (result > 999_999_999n) throw new InvalidFoodEntryInputError();
  return Number(result);
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

  async log(
    userId: number,
    input: LogFoodInput,
    context?: CatalogOperationContext,
  ) {
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
    const food = await this.#provider.getFood(
      parsed.data.providerFoodId,
      context,
    );
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

      const localEventTime = localEventTimeForNewFoodLogEvent(
        transaction,
        userId,
        parsed.data.foodLogDate,
        today,
        instant,
        preference.timeZone,
      );

      const row = transaction
        .insert(foodEntries)
        .values({
          authoritativeBaseQuantityMicrounits:
            food.authoritativeBaseQuantityMicrounits,
          authoritativeBaseUnit: food.authoritativeBaseUnit,
          authoritativeNutrition: serializeCatalogNutrition(
            food.nutritionPerAuthoritativeBase,
          ),
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
          originalName: food.originalName,
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
          supportedMeasurements: serializeCatalogMeasurements(
            food.measurements.filter(
              (candidate) => candidate.unit === food.authoritativeBaseUnit,
            ),
          ),
          sourceDataType: food.dataType,
          updatedAt: createdAt,
          userId,
        })
        .returning()
        .get();
      return foodEntrySnapshot(row);
    });
  }

  read(userId: number, entryId: number) {
    if (!Number.isSafeInteger(entryId) || entryId <= 0) {
      throw new FoodEntryUnavailableError();
    }
    const row = this.#database
      .select()
      .from(foodEntries)
      .where(
        and(eq(foodEntries.userId, userId), eq(foodEntries.id, entryId)),
      )
      .get();
    if (!row) throw new FoodEntryUnavailableError();
    return foodEntrySnapshot(row);
  }

  update(userId: number, entryId: number, input: UpdateFoodInput) {
    const parsed = updateFoodInputSchema.safeParse(input);
    if (!parsed.success || !Number.isSafeInteger(entryId) || entryId <= 0) {
      throw new InvalidFoodEntryInputError();
    }
    const quantity = quantityMicrounits(parsed.data.quantity);
    const existing = this.#database
      .select()
      .from(foodEntries)
      .where(
        and(eq(foodEntries.userId, userId), eq(foodEntries.id, entryId)),
      )
      .get();
    if (!existing || existing.foodLogDate !== parsed.data.foodLogDate) {
      throw new FoodEntryUnavailableError();
    }
    if (existing.updatedAt !== parsed.data.expectedUpdatedAt) {
      throw new StaleFoodEntryError();
    }
    const snapshot = foodEntrySnapshot(existing);
    const measurement = snapshot.supportedMeasurements.find(
      (candidate) => candidate.id === parsed.data.selectedMeasurementId,
    );
    if (!measurement || measurement.unit !== existing.authoritativeBaseUnit) {
      throw new InvalidFoodEntryInputError();
    }
    const nutrition = parseCatalogNutrition(existing.authoritativeNutrition);
    const scale = (value: Parameters<typeof scaleCatalogNutrient>[0]) =>
      scaleCatalogNutrient(
        value,
        measurement.baseQuantityMicrounits,
        quantity,
        existing.authoritativeBaseQuantityMicrounits,
      );
    const editedOrScaled = (
      inputValue: string | undefined,
      storageScale: NutrientStorageScale,
      authoritativeValue: Parameters<typeof scaleCatalogNutrient>[0],
    ) => {
      const edited = nullableNutrient(inputValue, storageScale);
      return edited === undefined ? scale(authoritativeValue) : edited;
    };
    const updated = this.#database
      .update(foodEntries)
      .set({
        carbohydrateMilligrams: editedOrScaled(
          parsed.data.carbohydrateGrams,
          "decimal-thousandths",
          nutrition.carbohydrateMilligrams,
        ),
        editedName: parsed.data.name,
        energyMilliKcal: editedOrScaled(
          parsed.data.energyKcal,
          "decimal-thousandths",
          nutrition.energyMilliKcal,
        ),
        fatMilligrams: editedOrScaled(
          parsed.data.fatGrams,
          "decimal-thousandths",
          nutrition.fatMilligrams,
        ),
        fiberMilligrams: editedOrScaled(
          parsed.data.fiberGrams,
          "decimal-thousandths",
          nutrition.fiberMilligrams,
        ),
        proteinMilligrams: editedOrScaled(
          parsed.data.proteinGrams,
          "decimal-thousandths",
          nutrition.proteinMilligrams,
        ),
        quantityMicrounits: quantity,
        selectedMeasurementBaseQuantityMicrounits:
          measurement.baseQuantityMicrounits,
        selectedMeasurementId: measurement.id,
        selectedMeasurementLabel: measurement.label,
        selectedMeasurementUnit: measurement.unit,
        sodiumMilligrams: editedOrScaled(
          parsed.data.sodiumMilligrams,
          "integer-milligrams",
          nutrition.sodiumMilligrams,
        ),
        sugarMilligrams: editedOrScaled(
          parsed.data.sugarGrams,
          "decimal-thousandths",
          nutrition.sugarMilligrams,
        ),
        updatedAt: nextUpdatedAt(this.#now(), existing.updatedAt),
      })
      .where(
        and(
          eq(foodEntries.userId, userId),
          eq(foodEntries.id, entryId),
          eq(foodEntries.updatedAt, parsed.data.expectedUpdatedAt),
        ),
      )
      .returning()
      .get();
    if (!updated) throw new StaleFoodEntryError();
    return foodEntrySnapshot(updated);
  }

  delete(
    userId: number,
    entryId: number,
    input: { expectedUpdatedAt: string; foodLogDate: string },
  ) {
    const expectedUpdatedAt = z.iso.datetime({ offset: true }).safeParse(
      input.expectedUpdatedAt,
    );
    if (
      !expectedUpdatedAt.success ||
      !parseIsoLocalDate(input.foodLogDate) ||
      !Number.isSafeInteger(entryId) ||
      entryId <= 0
    ) {
      throw new InvalidFoodEntryInputError();
    }
    const existing = this.#database
      .select()
      .from(foodEntries)
      .where(
        and(eq(foodEntries.userId, userId), eq(foodEntries.id, entryId)),
      )
      .get();
    if (!existing || existing.foodLogDate !== input.foodLogDate) {
      throw new FoodEntryUnavailableError();
    }
    if (existing.updatedAt !== expectedUpdatedAt.data) {
      throw new StaleFoodEntryError();
    }
    const deleted = this.#database
      .delete(foodEntries)
      .where(
        and(
          eq(foodEntries.userId, userId),
          eq(foodEntries.id, entryId),
          eq(foodEntries.updatedAt, expectedUpdatedAt.data),
        ),
      )
      .returning({ foodLogDate: foodEntries.foodLogDate })
      .get();
    if (!deleted) throw new StaleFoodEntryError();
    return deleted;
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
