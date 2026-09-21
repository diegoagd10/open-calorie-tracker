import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  CatalogInvalidDataError,
  CatalogStaleReviewError,
  CatalogNutritionUnavailableError,
  CatalogUnsafeMeasurementError,
  type CatalogFood,
  type CatalogMeasurement,
  type CatalogOperationContext,
  type FoodCatalogReader,
} from "../catalog/food-catalog.server";
import { isSupportedCommercialBarcode } from "../catalog/barcode";
import type { ApplicationDatabaseClient } from "../database/database.server";
import {
  insertSavedFood,
  listSavedFoodRows,
  readSavedFoodForEntry,
  readSavedFoodRow,
  saveManualEntryRow,
} from "../database/saved-foods.server";
import { readUserTimeZone } from "../database/user-preferences.server";
import { isPhotoEntryProcessing } from "../database/photo-analysis.server";
import { foodEntries, userPreferences } from "../database/schema.server";
import { localDateAt, parseIsoLocalDate } from "../food-log/date";
import {
  localEventTimeForCopiedFoodEntry,
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

export const savedFoodIdempotencyKeySchema = idempotencyKeySchema.refine(
  (value) => !value.startsWith("copy:"),
);

export const copyFoodEntryIdempotencyKeySchema = idempotencyKeySchema.refine(
  (value) => value.startsWith("copy:"),
);

export function createCopyFoodEntryIdempotencyKey(
  entryId: number,
  nonce: string,
): string {
  const parsedId = z.number().int().positive().parse(entryId);
  return copyFoodEntryIdempotencyKeySchema.parse(`copy:${parsedId}:${nonce}`);
}

function copyKeyBelongsToEntry(key: string, entryId: number): boolean {
  return key.startsWith(`copy:${entryId}:`);
}

function logFoodInputSchema() {
  return z.object({
    catalogGeneration: z.string().uuid().optional(),
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

function copyFoodEntryToDateInputSchema() {
  return copyFoodEntryInputSchema().extend({
    destinationFoodLogDate: z.string(),
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

function logManualFoodInputSchema() {
  return z.object({
    carbohydrateGrams: z.string().max(32).optional(),
    energyKcal: z.string().trim().min(1).max(32),
    fatGrams: z.string().max(32).optional(),
    fiberGrams: z.string().max(32).optional(),
    foodLogDate: z.string(),
    idempotencyKey: z
      .string()
      .min(8)
      .max(128)
      .refine((value) => /^[A-Za-z0-9._:-]+$/.test(value)),
    name: z.string().trim().min(1).max(200),
    proteinGrams: z.string().max(32).optional(),
    quantity: z.string().min(1).max(32),
    sodiumMilligrams: z.string().max(32).optional(),
    sugarGrams: z.string().max(32).optional(),
  });
}

export type LogFoodInput = z.input<ReturnType<typeof logFoodInputSchema>>;
export type CopyFoodEntryInput = z.input<
  ReturnType<typeof copyFoodEntryInputSchema>
>;
export type CopyFoodEntryToDateInput = z.input<
  ReturnType<typeof copyFoodEntryToDateInputSchema>
>;
export type LogManualFoodInput = z.input<
  ReturnType<typeof logManualFoodInputSchema>
>;
export type UpdateFoodInput = z.input<ReturnType<typeof updateFoodInputSchema>>;
type ParsedLogManualFoodInput = z.output<
  ReturnType<typeof logManualFoodInputSchema>
>;
type ParsedUpdateFoodInput = z.output<ReturnType<typeof updateFoodInputSchema>>;
type FoodEntryInsertSource = Omit<
  typeof foodEntries.$inferInsert,
  | "createdAt"
  | "foodLogDate"
  | "id"
  | "idempotencyKey"
  | "localEventTime"
  | "updatedAt"
  | "userId"
>;

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

const offMeasuredAuthority = z.object({ catalogGeneration: z.string().min(1), authoritativeBaseUnit: z.enum(["g", "ml"]), authoritativeBaseQuantityMicrounits: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), measurement: z.object({ baseQuantityMicrounits: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }) });
const offServingAuthority = z.object({ authoritativeBaseUnit: z.literal("serving"), authoritativeBaseQuantityMicrounits: z.literal(1_000_000), measurement: z.object({ id: z.literal("serving"), baseQuantityMicrounits: z.literal(1_000_000) }) });
function requireSupportedOffMeasurement(food: CatalogFood, measurement: CatalogMeasurement) {
  const valid = z.union([offServingAuthority, offMeasuredAuthority]).safeParse({ ...food, measurement });
  if (food.dataType !== "Open Food Facts" || !valid.success) throw new CatalogUnsafeMeasurementError();
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
    throw new CatalogInvalidDataError();
  }
  const measurement = food.measurements.find(
    (candidate) => candidate.id === selectedMeasurementId,
  );
  if (!measurement || measurement.unit !== food.authoritativeBaseUnit) {
    throw new CatalogUnsafeMeasurementError();
  }
  if (provider === "open-food-facts") requireSupportedOffMeasurement(food, measurement);
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

type SavedFoodRow = NonNullable<ReturnType<typeof readSavedFoodRow>>;

function savedFoodSnapshot(row: SavedFoodRow) {
  return {
    id: row.id,
    name: row.name,
    sourceEntryId: row.sourceEntryId,
    ...JSON.parse(row.snapshot) as ReturnType<typeof savedNutritionSnapshotValues>,
  };
}

function insertManualFoodSnapshot(
  database: Pick<ApplicationDatabaseClient, "insert" | "select">,
  userId: number,
  source: FoodEntryRow,
  createdAt: string,
) {
  insertSavedFood(
    database,
    userId,
    source,
    createdAt,
    JSON.stringify(savedNutritionSnapshotValues(source)),
  );
}

function eligibleCopyDestination(
  source: FoodEntryRow | undefined,
  sourceFoodLogDate: string,
  today: string,
  requestedDestination: string | undefined,
): { destination: string; source: FoodEntryRow } {
  const destination = requestedDestination ?? today;
  if (
    !source ||
    source.foodLogDate !== sourceFoodLogDate ||
    source.foodLogDate >= today ||
    destination > today ||
    destination === source.foodLogDate
  ) {
    throw new FoodEntryUnavailableError();
  }
  return { destination, source };
}

function repeatedCopySnapshot(
  repeated: FoodEntryRow | undefined,
  destination: string,
) {
  if (!repeated) return undefined;
  if (repeated.foodLogDate !== destination) {
    throw new InvalidFoodEntryInputError();
  }
  return foodEntrySnapshot(repeated);
}

function manualAuthoritativeNutrient(
  total: number | null,
  fixedPointMultiplier: number,
  quantity: number,
) {
  return total === null
    ? null
    : {
        amount: total / fixedPointMultiplier / (quantity / 1_000_000),
        fixedPointMultiplier,
      };
}

const manualMeasurement: CatalogMeasurement = {
  baseQuantityMicrounits: 1_000_000,
  id: "serving",
  label: "1 serving",
  unit: "serving",
};

function manualFoodEntrySource(
  input: ParsedLogManualFoodInput,
  quantity: number,
): FoodEntryInsertSource {
  const energyMilliKcal = nullableNutrient(input.energyKcal, false);
  if (energyMilliKcal === null || energyMilliKcal === undefined) {
    throw new InvalidFoodEntryInputError();
  }
  const totals = {
    carbohydrateMilligrams:
      nullableNutrient(input.carbohydrateGrams, false) ?? null,
    energyMilliKcal,
    fatMilligrams: nullableNutrient(input.fatGrams, false) ?? null,
    fiberMilligrams: nullableNutrient(input.fiberGrams, false) ?? null,
    proteinMilligrams: nullableNutrient(input.proteinGrams, false) ?? null,
    sodiumMilligrams: nullableNutrient(input.sodiumMilligrams, true) ?? null,
    sugarMilligrams: nullableNutrient(input.sugarGrams, false) ?? null,
  };
  const perServing = (total: number | null, integerMilligrams = false) =>
    manualAuthoritativeNutrient(
      total,
      integerMilligrams ? 1 : 1_000,
      quantity,
    );
  return {
    ...totals,
    authoritativeBaseQuantityMicrounits: 1_000_000,
    authoritativeBaseUnit: "serving",
    authoritativeNutrition: serializeCatalogNutrition({
      carbohydrateMilligrams: perServing(totals.carbohydrateMilligrams),
      energyMilliKcal: perServing(totals.energyMilliKcal),
      fatMilligrams: perServing(totals.fatMilligrams),
      fiberMilligrams: perServing(totals.fiberMilligrams),
      proteinMilligrams: perServing(totals.proteinMilligrams),
      sodiumMilligrams: perServing(totals.sodiumMilligrams, true),
      sugarMilligrams: perServing(totals.sugarMilligrams),
    }),
    barcode: null,
    brand: null,
    marketCountry: null,
    originalName: input.name,
    provider: "manual",
    providerFoodId: input.idempotencyKey,
    providerModifiedDate: null,
    providerPublishedDate: null,
    quantityMicrounits: quantity,
    selectedMeasurementBaseQuantityMicrounits:
      manualMeasurement.baseQuantityMicrounits,
    selectedMeasurementId: manualMeasurement.id,
    selectedMeasurementLabel: manualMeasurement.label,
    selectedMeasurementUnit: manualMeasurement.unit,
    sourceDataType: "User entered",
    supportedMeasurements: serializeCatalogMeasurements([manualMeasurement]),
  };
}

function manualNutritionAfterUpdate(
  input: ParsedUpdateFoodInput,
  nutrition: ReturnType<typeof parseCatalogNutrition>,
  quantity: number,
  scale: (value: Parameters<typeof scaleCatalogNutrient>[0]) => number | null,
) {
  const afterEdit = (
    inputValue: string | undefined,
    integerMilligrams: boolean,
    authoritativeValue: Parameters<typeof scaleCatalogNutrient>[0],
  ) => {
    const edited = nullableNutrient(inputValue, integerMilligrams);
    if (edited === undefined || edited === scale(authoritativeValue)) {
      return authoritativeValue;
    }
    return manualAuthoritativeNutrient(
      edited,
      integerMilligrams ? 1 : 1_000,
      quantity,
    );
  };
  return {
    carbohydrateMilligrams: afterEdit(
      input.carbohydrateGrams,
      false,
      nutrition.carbohydrateMilligrams,
    ),
    energyMilliKcal: afterEdit(
      input.energyKcal,
      false,
      nutrition.energyMilliKcal,
    ),
    fatMilligrams: afterEdit(input.fatGrams, false, nutrition.fatMilligrams),
    fiberMilligrams: afterEdit(
      input.fiberGrams,
      false,
      nutrition.fiberMilligrams,
    ),
    proteinMilligrams: afterEdit(
      input.proteinGrams,
      false,
      nutrition.proteinMilligrams,
    ),
    sodiumMilligrams: afterEdit(
      input.sodiumMilligrams,
      true,
      nutrition.sodiumMilligrams,
    ),
    sugarMilligrams: afterEdit(
      input.sugarGrams,
      false,
      nutrition.sugarMilligrams,
    ),
  };
}

function nutritionValuesAfterUpdate(
  input: ParsedUpdateFoodInput,
  nutrition: ReturnType<typeof parseCatalogNutrition>,
  scale: (value: Parameters<typeof scaleCatalogNutrient>[0]) => number | null,
) {
  const value = (
    inputValue: string | undefined,
    integerMilligrams: boolean,
    authoritativeValue: Parameters<typeof scaleCatalogNutrient>[0],
  ) => {
    const edited = nullableNutrient(inputValue, integerMilligrams);
    return edited === undefined ? scale(authoritativeValue) : edited;
  };
  return {
    carbohydrateMilligrams: value(
      input.carbohydrateGrams,
      false,
      nutrition.carbohydrateMilligrams,
    ),
    energyMilliKcal: value(input.energyKcal, false, nutrition.energyMilliKcal),
    fatMilligrams: value(input.fatGrams, false, nutrition.fatMilligrams),
    fiberMilligrams: value(input.fiberGrams, false, nutrition.fiberMilligrams),
    proteinMilligrams: value(
      input.proteinGrams,
      false,
      nutrition.proteinMilligrams,
    ),
    sodiumMilligrams: value(
      input.sodiumMilligrams,
      true,
      nutrition.sodiumMilligrams,
    ),
    sugarMilligrams: value(input.sugarGrams, false, nutrition.sugarMilligrams),
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

    const existing = this.#findIdempotentEntry(
      userId,
      parsed.data.idempotencyKey,
    );
    if (existing) return existing;

    this.#requireWritableDate(userId, parsed.data.foodLogDate);
    const food = await this.#catalog.getFood(
      parsed.data.provider,
      parsed.data.providerFoodId,
      {
        requestId: context?.requestId ?? randomUUID(),
        reviewedCatalogGeneration: parsed.data.catalogGeneration,
      },
    );
    if (food.catalogGeneration !== parsed.data.catalogGeneration) throw new CatalogStaleReviewError();
    if (!food.isSelectable) throw new CatalogNutritionUnavailableError();
    const measurement = selectedCatalogMeasurement(
      food,
      parsed.data.provider,
      parsed.data.providerFoodId,
      parsed.data.selectedMeasurementId,
    );

    return this.#insertSnapshot(
      userId,
      parsed.data.foodLogDate,
      parsed.data.idempotencyKey,
      {
        ...catalogSnapshotSource(food, measurement),
        ...scaledCatalogNutrition(food, measurement, quantity),
        quantityMicrounits: quantity,
      },
      this.#now(),
    );
  }

  logManual(userId: number, input: LogManualFoodInput) {
    const parsed = logManualFoodInputSchema().safeParse(input);
    if (!parsed.success) throw new InvalidFoodEntryInputError();
    const quantity = quantityMicrounits(parsed.data.quantity);
    const existing = this.#findIdempotentEntry(
      userId,
      parsed.data.idempotencyKey,
    );
    if (existing) return existing;

    this.#requireWritableDate(userId, parsed.data.foodLogDate);
    return this.#insertSnapshot(
      userId,
      parsed.data.foodLogDate,
      parsed.data.idempotencyKey,
      manualFoodEntrySource(parsed.data, quantity),
      this.#now(),
      { saveManual: true },
    );
  }

  listSavedFoods(userId: number, query = "") {
    return listSavedFoodRows(this.#database, userId, query).map(savedFoodSnapshot);
  }

  readSavedFood(userId: number, savedFoodId: number) {
    const parsedId = z.number().int().positive().safeParse(savedFoodId);
    if (!parsedId.success) throw new FoodEntryUnavailableError();
    const row = readSavedFoodRow(this.#database, userId, parsedId.data);
    if (!row) throw new FoodEntryUnavailableError();
    return savedFoodSnapshot(row);
  }

  isManualEntrySaved(userId: number, entryId: number) {
    return readSavedFoodForEntry(this.#database, userId, entryId) !== undefined;
  }

  saveManualEntry(userId: number, entryId: number) {
    const parsedId = z.number().int().positive().safeParse(entryId);
    if (!parsedId.success) throw new FoodEntryUnavailableError();
    const saved = saveManualEntryRow(
      this.#database,
      userId,
      parsedId.data,
      this.#now().toISOString(),
      (source) => JSON.stringify(savedNutritionSnapshotValues(source)),
    );
    if (!saved) throw new FoodEntryUnavailableError();
    return savedFoodSnapshot(saved);
  }

  logSavedFood(
    userId: number,
    savedFoodId: number,
    foodLogDate: string,
    idempotencyKey: string,
  ) {
    if (!savedFoodIdempotencyKeySchema.safeParse(idempotencyKey).success) {
      throw new InvalidFoodEntryInputError();
    }
    const saved = this.readSavedFood(userId, savedFoodId);
    this.#requireWritableDate(userId, foodLogDate);
    return this.#insertSnapshot(
      userId,
      foodLogDate,
      idempotencyKey,
      (({ id: _id, name: _name, sourceEntryId: _sourceEntryId, ...source }) => source)(saved),
      this.#now(),
      { sourceSavedFoodId: saved.id },
    );
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
      !parseIsoLocalDate(parsed.data.foodLogDate) ||
      !copyKeyBelongsToEntry(parsed.data.idempotencyKey, parsedId.data)
    ) {
      throw new InvalidFoodEntryInputError();
    }
    return this.#copy(userId, parsedId.data, parsed.data, this.#now());
  }

  copyToDate(
    userId: number,
    entryId: number,
    input: CopyFoodEntryToDateInput,
  ) {
    const parsed = copyFoodEntryToDateInputSchema().safeParse(input);
    const parsedId = z.number().int().positive().safeParse(entryId);
    if (
      !parsed.success ||
      !parsedId.success ||
      !parseIsoLocalDate(parsed.data.foodLogDate) ||
      !parseIsoLocalDate(parsed.data.destinationFoodLogDate) ||
      !copyKeyBelongsToEntry(parsed.data.idempotencyKey, parsedId.data)
    ) {
      throw new InvalidFoodEntryInputError();
    }
    return this.#copy(
      userId,
      parsedId.data,
      parsed.data,
      this.#now(),
      parsed.data.destinationFoodLogDate,
    );
  }

  #copy(
    userId: number,
    entryId: number,
    input: CopyFoodEntryInput,
    instant: Date,
    requestedDestination?: string,
  ) {
    this.#requireNotProcessing(userId, entryId);
    const createdAt = instant.toISOString();
    return this.#database.transaction((transaction) => {
      const source = transaction
        .select()
        .from(foodEntries)
        .where(
          and(
            eq(foodEntries.userId, userId),
            eq(foodEntries.id, entryId),
          ),
        )
        .get();
      const timeZone = readUserTimeZone(transaction, userId);
      if (!timeZone) throw new InvalidFoodLogDateError();
      const today = localDateAt(instant, timeZone);
      const eligible = eligibleCopyDestination(
        source,
        input.foodLogDate,
        today,
        requestedDestination,
      );

      const repeated = transaction
        .select()
        .from(foodEntries)
        .where(
          and(
            eq(foodEntries.userId, userId),
            eq(foodEntries.idempotencyKey, input.idempotencyKey),
          ),
        )
        .get();
      const repeatedSnapshot = repeatedCopySnapshot(
        repeated,
        eligible.destination,
      );
      if (repeatedSnapshot) return repeatedSnapshot;

      const row = transaction
        .insert(foodEntries)
        .values({
          ...savedNutritionSnapshotValues(eligible.source),
          createdAt,
          foodLogDate: eligible.destination,
          idempotencyKey: input.idempotencyKey,
          localEventTime: localEventTimeForCopiedFoodEntry(
            transaction,
            userId,
            eligible.destination,
            today,
            instant,
            timeZone,
          ),
          sourceSavedFoodId: readSavedFoodForEntry(
            transaction,
            userId,
            eligible.source.id,
          )?.id,
          updatedAt: createdAt,
          userId,
        })
        .returning()
        .get();
      return foodEntrySnapshot(row);
    });
  }

  read(userId: number, entryId: number) {
    return foodEntrySnapshot(this.#readOwnedRow(userId, entryId));
  }

  readCopied(userId: number, entryId: number) {
    const row = this.#readOwnedRow(userId, entryId);
    if (!row.idempotencyKey.startsWith("copy:")) {
      throw new FoodEntryUnavailableError();
    }
    return foodEntrySnapshot(row);
  }

  #requireNotProcessing(userId: number, entryId: number) {
    if (isPhotoEntryProcessing(this.#database, userId, entryId)) throw new FoodEntryUnavailableError();
  }

  #readOwnedRow(userId: number, entryId: number) {
    this.#requireNotProcessing(userId, entryId);
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
    return row;
  }

  update(userId: number, entryId: number, input: UpdateFoodInput) {
    this.#requireNotProcessing(userId, entryId);
    const parsed = updateFoodInputSchema().safeParse(input);
    if (!parsed.success) throw new InvalidFoodEntryInputError();
    const quantity = quantityMicrounits(parsed.data.quantity);
    const { existing, measurement } = this.#entryForUpdate(
      userId,
      entryId,
      parsed.data,
    );
    const nutrition = parseCatalogNutrition(existing.authoritativeNutrition);
    const scale = (value: Parameters<typeof scaleCatalogNutrient>[0]) =>
      scaleCatalogNutrient(
        value,
        measurement.baseQuantityMicrounits,
        quantity,
        existing.authoritativeBaseQuantityMicrounits,
      );
    const nutritionValues = nutritionValuesAfterUpdate(
      parsed.data,
      nutrition,
      scale,
    );
    const authoritativeNutrition =
      existing.provider === "manual"
        ? serializeCatalogNutrition(
            manualNutritionAfterUpdate(
              parsed.data,
              nutrition,
              quantity,
              scale,
            ),
          )
        : existing.authoritativeNutrition;
    const updated = this.#database
      .update(foodEntries)
      .set({
        ...nutritionValues,
        authoritativeNutrition,
        editedName: parsed.data.name,
        quantityMicrounits: quantity,
        selectedMeasurementBaseQuantityMicrounits:
          measurement.baseQuantityMicrounits,
        selectedMeasurementId: measurement.id,
        selectedMeasurementLabel: measurement.label,
        selectedMeasurementUnit: measurement.unit,
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

  #entryForUpdate(
    userId: number,
    entryId: number,
    input: ParsedUpdateFoodInput,
  ) {
    const parsedId = z.number().int().positive().safeParse(entryId);
    if (!parsedId.success) throw new InvalidFoodEntryInputError();
    const existing = this.#readOwnedRow(userId, parsedId.data);
    if (existing.foodLogDate !== input.foodLogDate) {
      throw new FoodEntryUnavailableError();
    }
    if (
      existing.provider === "manual" &&
      nullableNutrient(input.energyKcal, false) === null
    ) {
      throw new InvalidFoodEntryInputError();
    }
    const snapshot = foodEntrySnapshot(existing);
    const measurement = snapshot.supportedMeasurements.find(
      (candidate) => candidate.id === input.selectedMeasurementId,
    );
    if (!measurement || measurement.unit !== existing.authoritativeBaseUnit) {
      throw new InvalidFoodEntryInputError();
    }
    return { existing, measurement };
  }

  delete(
    userId: number,
    entryId: number,
    input: { expectedUpdatedAt: string; foodLogDate: string },
  ) {
    this.#requireNotProcessing(userId, entryId);
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
    const existing = this.#readOwnedRow(userId, parsedId.data);
    if (existing.foodLogDate !== input.foodLogDate) {
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

  #findIdempotentEntry(userId: number, idempotencyKey: string) {
    const row = this.#database
      .select()
      .from(foodEntries)
      .where(
        and(
          eq(foodEntries.userId, userId),
          eq(foodEntries.idempotencyKey, idempotencyKey),
        ),
      )
      .get();
    return row ? foodEntrySnapshot(row) : undefined;
  }

  #insertSnapshot(
    userId: number,
    foodLogDate: string,
    idempotencyKey: string,
    source: FoodEntryInsertSource,
    instant: Date,
    options: { saveManual?: boolean; sourceSavedFoodId?: number } = {},
  ) {
    const createdAt = instant.toISOString();
    return this.#database.transaction((transaction) => {
      const repeated = transaction
        .select()
        .from(foodEntries)
        .where(
          and(
            eq(foodEntries.userId, userId),
            eq(foodEntries.idempotencyKey, idempotencyKey),
          ),
        )
        .get();
      if (repeated) return foodEntrySnapshot(repeated);

      const timeZone = readUserTimeZone(transaction, userId);
      if (!timeZone) throw new InvalidFoodLogDateError();
      const today = localDateAt(instant, timeZone);
      if (foodLogDate > today) throw new FutureFoodLogDateError();
      const localEventTime = localEventTimeForNewFoodLogEvent(
        transaction,
        userId,
        foodLogDate,
        today,
        instant,
        timeZone,
      );
      const row = transaction
        .insert(foodEntries)
        .values({
          ...source,
          createdAt,
          foodLogDate,
          idempotencyKey,
          localEventTime,
          sourceSavedFoodId: options.sourceSavedFoodId,
          updatedAt: createdAt,
          userId,
        })
        .returning()
        .get();
      if (options.saveManual) {
        insertManualFoodSnapshot(transaction, userId, row, createdAt);
      }
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
