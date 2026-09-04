import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  CatalogInvalidResponseError,
  CatalogUnsafeMeasurementError,
  type CatalogFood,
  type CatalogMeasurement,
  type CatalogOperationContext,
  type FoodCatalogReader,
} from "../catalog/food-catalog.server";
import { isSupportedCommercialBarcode } from "../catalog/barcode";
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
  type FoodEntryRow,
} from "./snapshot.server";
import { quantityMicrounitsFromDecimal } from "./nutrition";

const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .refine((value) => /^[A-Za-z0-9._:-]+$/.test(value));

export const copyFoodEntryIdempotencyKeySchema = idempotencyKeySchema.refine(
  (value) => value.startsWith("copy:"),
);

export function createCopyFoodEntryIdempotencyKey(nonce: string): string {
  return copyFoodEntryIdempotencyKeySchema.parse(`copy:${nonce}`);
}

function logFoodInputSchema() {
  return z.object({
    foodLogDate: z.string(),
    idempotencyKey: idempotencyKeySchema.refine(
      (value) => !value.startsWith("copy:"),
    ),
    provider: z.string().min(1).max(64),
    providerFoodId: z.string().min(1).max(128),
    quantity: z.string().min(1).max(32),
    selectedMeasurementId: z.string().min(1).max(128),
  });
}

function copyFoodEntryInputSchema() {
  return z.object({
    foodLogDate: z.string(),
    idempotencyKey: copyFoodEntryIdempotencyKeySchema,
  });
}

function validProviderFoodIdentity(provider: string, providerFoodId: string) {
  if (provider === "usda-fdc") return /^[1-9]\d*$/.test(providerFoodId);
  if (provider === "open-food-facts") {
    return isSupportedCommercialBarcode(providerFoodId);
  }
  return true;
}

function updateFoodInputSchema() {
  return z.object({
    carbohydrateGrams: z.string().max(32).optional(),
    energyKcal: z.string().max(32).optional(),
    expectedUpdatedAt: z.iso.datetime({ offset: true }),
    fatGrams: z.string().max(32).optional(),
    fiberGrams: z.string().max(32).optional(),
    foodLogDate: z.string(),
    name: z.string().trim().min(1).max(200),
    proteinGrams: z.string().max(32).optional(),
    quantity: z.string().min(1).max(32),
    selectedMeasurementId: z.string().min(1).max(128),
    sodiumMilligrams: z.string().max(32).optional(),
    sugarGrams: z.string().max(32).optional(),
  });
}

export type LogFoodInput = z.input<ReturnType<typeof logFoodInputSchema>>;
export type CopyFoodEntryInput = z.input<
  ReturnType<typeof copyFoodEntryInputSchema>
>;
export type UpdateFoodInput = z.input<ReturnType<typeof updateFoodInputSchema>>;

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

function selectedCatalogMeasurement(
  food: CatalogFood,
  provider: string,
  providerFoodId: string,
  selectedMeasurementId: string,
): CatalogMeasurement {
  if (
    food.providerFoodId !== providerFoodId ||
    (provider === "open-food-facts" && food.barcode !== providerFoodId)
  ) {
    throw new CatalogInvalidResponseError();
  }
  const measurement = food.measurements.find(
    (candidate) => candidate.id === selectedMeasurementId,
  );
  if (!measurement || measurement.unit !== food.authoritativeBaseUnit) {
    throw new CatalogUnsafeMeasurementError();
  }
  if (
    provider === "open-food-facts" &&
    (food.dataType !== "Open Food Facts" ||
      food.authoritativeBaseUnit !== "serving" ||
      food.authoritativeBaseQuantityMicrounits !== 1_000_000 ||
      measurement.id !== "serving" ||
      measurement.baseQuantityMicrounits !== 1_000_000)
  ) {
    throw new CatalogUnsafeMeasurementError();
  }
  return measurement;
}

function scaledCatalogNutrition(
  food: CatalogFood,
  measurement: CatalogMeasurement,
  quantity: number,
) {
  const scale = (value: Parameters<typeof scaleCatalogNutrient>[0]) =>
    scaleCatalogNutrient(
      value,
      measurement.baseQuantityMicrounits,
      quantity,
      food.authoritativeBaseQuantityMicrounits,
    );
  return {
    carbohydrateMilligrams: scale(
      food.nutritionPerAuthoritativeBase.carbohydrateMilligrams,
    ),
    energyMilliKcal: scale(
      food.nutritionPerAuthoritativeBase.energyMilliKcal,
    ),
    fatMilligrams: scale(food.nutritionPerAuthoritativeBase.fatMilligrams),
    fiberMilligrams: scale(food.nutritionPerAuthoritativeBase.fiberMilligrams),
    proteinMilligrams: scale(
      food.nutritionPerAuthoritativeBase.proteinMilligrams,
    ),
    sodiumMilligrams: scale(
      food.nutritionPerAuthoritativeBase.sodiumMilligrams,
    ),
    sugarMilligrams: scale(food.nutritionPerAuthoritativeBase.sugarMilligrams),
  };
}

function catalogSnapshotSource(
  food: CatalogFood,
  measurement: CatalogMeasurement,
) {
  return {
    authoritativeBaseQuantityMicrounits:
      food.authoritativeBaseQuantityMicrounits,
    authoritativeBaseUnit: food.authoritativeBaseUnit,
    authoritativeNutrition: serializeCatalogNutrition(
      food.nutritionPerAuthoritativeBase,
    ),
    barcode: food.barcode,
    brand: food.brand,
    marketCountry: food.marketCountry,
    originalName: food.originalName,
    provider: food.provider,
    providerFoodId: food.providerFoodId,
    providerModifiedDate: food.providerModifiedDate,
    providerPublishedDate: food.providerPublishedDate,
    selectedMeasurementBaseQuantityMicrounits:
      measurement.baseQuantityMicrounits,
    selectedMeasurementId: measurement.id,
    selectedMeasurementLabel: measurement.label,
    selectedMeasurementUnit: measurement.unit,
    sourceDataType: food.dataType,
    supportedMeasurements: serializeCatalogMeasurements(
      food.measurements.filter(
        (candidate) => candidate.unit === food.authoritativeBaseUnit,
      ),
    ),
  };
}

function quantityMicrounits(value: string): number {
  const result = quantityMicrounitsFromDecimal(value);
  if (result === undefined) throw new InvalidFoodEntryInputError();
  return result;
}

function nullableNutrient(
  value: string | undefined,
  integerMilligrams: boolean,
): number | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match =
    integerMilligrams
      ? /^(\d{1,7})$/.exec(trimmed)
      : /^(\d{1,6})(?:\.(\d{1,3}))?$/.exec(trimmed);
  if (!match) throw new InvalidFoodEntryInputError();
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(3, "0"));
  const multiplier = integerMilligrams ? 1n : 1_000n;
  const result = whole * multiplier + fraction;
  return Number(result);
}

function savedNutritionSnapshotValues(source: FoodEntryRow) {
  return {
    authoritativeBaseQuantityMicrounits:
      source.authoritativeBaseQuantityMicrounits,
    authoritativeBaseUnit: source.authoritativeBaseUnit,
    authoritativeNutrition: source.authoritativeNutrition,
    barcode: source.barcode,
    brand: source.brand,
    carbohydrateMilligrams: source.carbohydrateMilligrams,
    editedName: source.editedName,
    energyMilliKcal: source.energyMilliKcal,
    fatMilligrams: source.fatMilligrams,
    fiberMilligrams: source.fiberMilligrams,
    marketCountry: source.marketCountry,
    originalName: source.originalName,
    proteinMilligrams: source.proteinMilligrams,
    provider: source.provider,
    providerFoodId: source.providerFoodId,
    providerModifiedDate: source.providerModifiedDate,
    providerPublishedDate: source.providerPublishedDate,
    quantityMicrounits: source.quantityMicrounits,
    selectedMeasurementBaseQuantityMicrounits:
      source.selectedMeasurementBaseQuantityMicrounits,
    selectedMeasurementId: source.selectedMeasurementId,
    selectedMeasurementLabel: source.selectedMeasurementLabel,
    selectedMeasurementUnit: source.selectedMeasurementUnit,
    sodiumMilligrams: source.sodiumMilligrams,
    sourceDataType: source.sourceDataType,
    sugarMilligrams: source.sugarMilligrams,
    supportedMeasurements: source.supportedMeasurements,
  };
}

export class FoodEntryService {
  readonly #database: ApplicationDatabaseClient;
  readonly #now: () => Date;
  readonly #catalog: FoodCatalogReader;

  constructor(
    database: ApplicationDatabaseClient,
    catalog: FoodCatalogReader,
    now: () => Date = () => new Date(),
  ) {
    this.#database = database;
    this.#catalog = catalog;
    this.#now = now;
  }

  async log(
    userId: number,
    input: LogFoodInput,
    context?: CatalogOperationContext,
  ) {
    const parsed = logFoodInputSchema().safeParse(input);
    if (!parsed.success) throw new InvalidFoodEntryInputError();
    if (
      !validProviderFoodIdentity(
        parsed.data.provider,
        parsed.data.providerFoodId,
      )
    ) {
      throw new InvalidFoodEntryInputError();
    }
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
    const food = await this.#catalog.getFood(
      parsed.data.provider,
      parsed.data.providerFoodId,
      context,
    );
    const measurement = selectedCatalogMeasurement(
      food,
      parsed.data.provider,
      parsed.data.providerFoodId,
      parsed.data.selectedMeasurementId,
    );

    const instant = this.#now();
    const createdAt = instant.toISOString();
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
          ...catalogSnapshotSource(food, measurement),
          ...scaledCatalogNutrition(food, measurement, quantity),
          createdAt,
          foodLogDate: parsed.data.foodLogDate,
          idempotencyKey: parsed.data.idempotencyKey,
          localEventTime,
          quantityMicrounits: quantity,
          updatedAt: createdAt,
          userId,
        })
        .returning()
        .get();
      return foodEntrySnapshot(row);
    });
  }

  copyToToday(
    userId: number,
    entryId: number,
    input: CopyFoodEntryInput,
  ) {
    const parsed = copyFoodEntryInputSchema().safeParse(input);
    const parsedId = z.number().int().positive().safeParse(entryId);
    if (
      !parsed.success ||
      !parsedId.success ||
      !parseIsoLocalDate(parsed.data.foodLogDate)
    ) {
      throw new InvalidFoodEntryInputError();
    }

    const instant = this.#now();
    const createdAt = instant.toISOString();
    return this.#database.transaction((transaction) => {
      const source = transaction
        .select()
        .from(foodEntries)
        .where(
          and(
            eq(foodEntries.userId, userId),
            eq(foodEntries.id, parsedId.data),
          ),
        )
        .get();
      const preference = transaction
        .select({ timeZone: userPreferences.timeZone })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .get();
      if (!preference) throw new InvalidFoodLogDateError();
      const today = localDateAt(instant, preference.timeZone);
      if (
        !source ||
        source.foodLogDate !== parsed.data.foodLogDate ||
        source.foodLogDate >= today
      ) {
        throw new FoodEntryUnavailableError();
      }

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

      const row = transaction
        .insert(foodEntries)
        .values({
          ...savedNutritionSnapshotValues(source),
          createdAt,
          foodLogDate: today,
          idempotencyKey: parsed.data.idempotencyKey,
          localEventTime: localEventTimeForNewFoodLogEvent(
            transaction,
            userId,
            today,
            today,
            instant,
            preference.timeZone,
          ),
          updatedAt: createdAt,
          userId,
        })
        .returning()
        .get();
      return foodEntrySnapshot(row);
    });
  }

  read(userId: number, entryId: number) {
    const parsedId = z.number().int().positive().safeParse(entryId);
    const row = parsedId.success
      ? this.#database
          .select()
          .from(foodEntries)
          .where(
            and(
              eq(foodEntries.userId, userId),
              eq(foodEntries.id, parsedId.data),
            ),
          )
          .get()
      : undefined;
    if (!row) throw new FoodEntryUnavailableError();
    return foodEntrySnapshot(row);
  }

  update(userId: number, entryId: number, input: UpdateFoodInput) {
    const parsed = updateFoodInputSchema().safeParse(input);
    const parsedId = z.number().int().positive().safeParse(entryId);
    if (!parsed.success || !parsedId.success) {
      throw new InvalidFoodEntryInputError();
    }
    const quantity = quantityMicrounits(parsed.data.quantity);
    const existing = this.#database
      .select()
      .from(foodEntries)
      .where(
        and(eq(foodEntries.userId, userId), eq(foodEntries.id, parsedId.data)),
      )
      .get();
    if (!existing || existing.foodLogDate !== parsed.data.foodLogDate) {
      throw new FoodEntryUnavailableError();
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
      integerMilligrams: boolean,
      authoritativeValue: Parameters<typeof scaleCatalogNutrient>[0],
    ) => {
      const edited = nullableNutrient(inputValue, integerMilligrams);
      return edited === undefined ? scale(authoritativeValue) : edited;
    };
    const updated = this.#database
      .update(foodEntries)
      .set({
        carbohydrateMilligrams: editedOrScaled(
          parsed.data.carbohydrateGrams,
          false,
          nutrition.carbohydrateMilligrams,
        ),
        editedName: parsed.data.name,
        energyMilliKcal: editedOrScaled(
          parsed.data.energyKcal,
          false,
          nutrition.energyMilliKcal,
        ),
        fatMilligrams: editedOrScaled(
          parsed.data.fatGrams,
          false,
          nutrition.fatMilligrams,
        ),
        fiberMilligrams: editedOrScaled(
          parsed.data.fiberGrams,
          false,
          nutrition.fiberMilligrams,
        ),
        proteinMilligrams: editedOrScaled(
          parsed.data.proteinGrams,
          false,
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
          true,
          nutrition.sodiumMilligrams,
        ),
        sugarMilligrams: editedOrScaled(
          parsed.data.sugarGrams,
          false,
          nutrition.sugarMilligrams,
        ),
        updatedAt: nextUpdatedAt(this.#now(), existing.updatedAt),
      })
      .where(
        and(
          eq(foodEntries.userId, userId),
          eq(foodEntries.id, parsedId.data),
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
    const parsedId = z.number().int().positive().safeParse(entryId);
    if (
      !expectedUpdatedAt.success ||
      !parseIsoLocalDate(input.foodLogDate) ||
      !parsedId.success
    ) {
      throw new InvalidFoodEntryInputError();
    }
    const existing = this.#database
      .select()
      .from(foodEntries)
      .where(
        and(eq(foodEntries.userId, userId), eq(foodEntries.id, parsedId.data)),
      )
      .get();
    if (!existing || existing.foodLogDate !== input.foodLogDate) {
      throw new FoodEntryUnavailableError();
    }
    const deleted = this.#database
      .delete(foodEntries)
      .where(
        and(
          eq(foodEntries.userId, userId),
          eq(foodEntries.id, parsedId.data),
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
