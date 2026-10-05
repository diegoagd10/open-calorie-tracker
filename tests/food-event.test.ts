import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";

import {
  CatalogFoodNotFoundError,
  CatalogInvalidDataError,
  CatalogNotInstalledError,
  CatalogStaleReviewError,
  CatalogUnavailableError,
  FoodCatalog,
  type CatalogFood,
  type CatalogOperationContext,
  type CatalogProviderId,
} from "../app/catalog/food-catalog.server";
import { createOpenFoodFactsClient } from "../app/catalog/runtime.server";
import { openApplicationDatabase, type ApplicationDatabaseClient } from "../app/database/database.server";
import { userPreferences, users } from "../app/database/schema.server";
import {
  FoodEventConflictError,
  FoodEventNotFoundError,
  FoodEventValidationError,
  FoodSourceError,
} from "../app/food-event/food-event.exceptions";
import type { CreateFoodEvent, FoodEvent, FoodEventChanges } from "../app/food-event/food-event.model";
import { favoriteFoods, foodEvents } from "../app/food-event/food-event.schema.server";
import { createFoodEventService } from "../app/food-event/runtime.server";
import { FoodLogService } from "../app/food-log/food-log.server";
import { completeTestSetup } from "./support/setup";
import { exampleCerealProduct, fakeOffApi, type OffApiReply } from "./support/off-api";

const GENERATION = "00000000-0000-4000-8000-000000000001";
const NOW = "2026-08-29T18:00:00.000Z";
/** Noon on 2026-08-28 in New York, the default test time zone. */
const YESTERDAY_NOON = "2026-08-28T16:00:00.000Z";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

async function setupDatabase() {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-food-event-"));
  temporaryDirectories.push(directory);
  return openApplicationDatabase({
    databasePath: path.join(directory, "application.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });
}

function insertConfiguredUser(client: ApplicationDatabaseClient, username: string, timeZone?: string): number {
  const userId = client
    .insert(users)
    .values({ createdAt: "2026-01-01T00:00:00.000Z", usernameNormalized: username })
    .returning({ id: users.id })
    .get().id;
  completeTestSetup(userId, { database: client, timeZone });
  return userId;
}

function foundationBread(): CatalogFood {
  return {
    authoritativeBaseQuantityMicrounits: 100_000_000,
    authoritativeBaseUnit: "g",
    barcode: "0012345678905",
    brand: null,
    catalogGeneration: GENERATION,
    dataType: "Foundation",
    isSelectable: true,
    marketCountry: "United States",
    measurementSummary: "1 slice (32 g)",
    measurements: [
      { baseQuantityMicrounits: 32_000_000, id: "portion:7", label: "1 slice (32 g)", unit: "g" },
      { baseQuantityMicrounits: 100_000_000, id: "base:g:100000000", label: "100 g", unit: "g" },
    ],
    name: "Bread, whole-wheat",
    nutritionPerAuthoritativeBase: {
      carbohydrateMilligrams: null,
      energyMilliKcal: { amount: 250, fixedPointMultiplier: 1_000 },
      fatMilligrams: { amount: 1.5, fixedPointMultiplier: 1_000 },
      fiberMilligrams: { amount: 2.3, fixedPointMultiplier: 1_000 },
      proteinMilligrams: { amount: 0, fixedPointMultiplier: 1_000 },
      sodiumMilligrams: { amount: 120, fixedPointMultiplier: 1 },
      sugarMilligrams: { amount: 0, fixedPointMultiplier: 1_000 },
    },
    originalName: "Bread, whole-wheat",
    provider: "usda-fdc",
    providerFoodId: "200",
    providerModifiedDate: "2026-04-02",
    providerPublishedDate: "2026-04-01",
  };
}

/** A catalog that returns `food` and records each read, so tests see whether a provider was consulted. */
class FakeCatalog {
  food = foundationBread();
  calls: Array<{ provider: CatalogProviderId; providerFoodId: string; context?: CatalogOperationContext }> = [];
  failure: Error | undefined;
  beforeReturn: (() => void) | undefined;

  async getFood(provider: CatalogProviderId, providerFoodId: string, context?: CatalogOperationContext): Promise<CatalogFood> {
    this.calls.push({ provider, providerFoodId, context });
    if (this.failure) throw this.failure;
    this.beforeReturn?.();
    return structuredClone(this.food);
  }
}

async function setup(options: { now?: () => Date; timeZone?: string } = {}) {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "food.event.owner", options.timeZone);
  const otherUserId = insertConfiguredUser(client, "food.event.other", options.timeZone);
  const catalog = new FakeCatalog();
  const now = options.now ?? (() => new Date(NOW));
  const service = createFoodEventService(client, now, catalog);
  const foodLog = () => new FoodLogService(client, now);
  return { catalog, client, database, foodLog, otherUserId, service, userId };
}

function lookup(change: Partial<Extract<CreateFoodEvent, { method: "lookup" }>> = {}): CreateFoodEvent {
  return {
    method: "lookup",
    logDate: YESTERDAY_NOON,
    providerFoodId: "200",
    reviewVersion: GENERATION,
    measurementId: "portion:7",
    quantity: "1",
    ...change,
  };
}

function manual(change: Partial<Extract<CreateFoodEvent, { method: "manual" }>> = {}): CreateFoodEvent {
  return {
    method: "manual",
    logDate: YESTERDAY_NOON,
    name: "Tortillas",
    quantity: "3",
    nutrition: { energyKcal: "180", carbohydrateGrams: "36", fatGrams: "3", proteinGrams: "6", sodiumMilligrams: "30", sugarGrams: "0" },
    saveAsFavorite: false,
    ...change,
  };
}

function edit(event: FoodEvent, changes: FoodEventChanges = {}) {
  return { id: event.id, expectedUpdatedAt: event.updatedAt, changes };
}

/** The version of `event` a delete names. */
function version(event: FoodEvent) {
  return { id: event.id, expectedUpdatedAt: event.updatedAt };
}

async function rejection(promise: Promise<unknown> | (() => unknown)): Promise<unknown> {
  try {
    await (typeof promise === "function" ? promise() : promise);
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

test("a reviewed USDA food becomes an immutable snapshot at its logDate", async () => {
  const { catalog, database, foodLog, service, userId } = await setup();

  const created = await service.save(userId, lookup({ quantity: "1.5" }));

  expect(created).toMatchObject({
    logDate: YESTERDAY_NOON,
    name: "Bread, whole-wheat",
    source: { provider: "usda-fdc", providerFoodId: "200", dataType: "Foundation", barcode: "0012345678905" },
    authority: { unit: "g", quantityMicrounits: 100_000_000, nutrition: catalog.food.nutritionPerAuthoritativeBase },
    measurement: { id: "portion:7", label: "1 slice (32 g)" },
    quantityMicrounits: 1_500_000,
    nutrients: { energyMilliKcal: 120_000, carbohydrateMilligrams: null, proteinMilligrams: 0, sodiumMilligrams: 58 },
    favoriteId: null,
    copiedFromId: null,
  });

  catalog.food.name = "Provider changed this later";
  catalog.food.nutritionPerAuthoritativeBase.energyMilliKcal = { amount: 999, fixedPointMultiplier: 1_000 };
  const log = foodLog().read(userId, "2026-08-28")!;
  expect(log.foodEvents).toEqual([created]);
  expect(log.nutritionTotals.energyMilliKcal).toEqual({ known: 120_000, isIncomplete: false });
  expect(log.nutritionTotals.carbohydrateMilligrams).toEqual({ known: 0, isIncomplete: true });
  database.close();
});

test("catalog saves read the method's provider with the request and the reviewed generation", async () => {
  const { catalog, database, service, userId } = await setup();

  await service.save(userId, lookup(), { requestId: "food-event-request" });

  expect(catalog.calls).toEqual([{
    provider: "usda-fdc",
    providerFoodId: "200",
    context: { requestId: "food-event-request", reviewedCatalogGeneration: GENERATION },
  }]);
  database.close();
});

test("malformed creates are refused with a code before any provider work", async () => {
  const { catalog, client, database, service, userId } = await setup();
  const invalid: Array<[CreateFoodEvent, string]> = [
    [lookup({ providerFoodId: "0" }), "invalid_input"],
    [lookup({ providerFoodId: "01" }), "invalid_input"],
    [lookup({ providerFoodId: "x200" }), "invalid_input"],
    [lookup({ reviewVersion: "not-a-generation" }), "invalid_input"],
    [lookup({ reviewVersion: "0".repeat(64) }), "invalid_input"],
    [{ ...lookup(), method: "barcode" } as CreateFoodEvent, "invalid_input"],
    [lookup({ measurementId: "" }), "invalid_input"],
    [lookup({ measurementId: "m".repeat(129) }), "invalid_input"],
    [lookup({ quantity: "" }), "invalid_quantity"],
    [lookup({ quantity: "0" }), "invalid_quantity"],
    [lookup({ quantity: "100" }), "invalid_quantity"],
    [lookup({ quantity: "1.1234567" }), "invalid_quantity"],
    [lookup({ logDate: "2026-08-28" }), "invalid_log_date"],
    [lookup({ logDate: "2026-08-28T12:00:00" }), "invalid_log_date"],
    [lookup({ logDate: "2026-08-29T18:06:00.000Z" }), "future_date"],
    [{ ...lookup(), method: "photo" } as unknown as CreateFoodEvent, "invalid_input"],
    [manual({ name: "   " }), "invalid_input"],
    [manual({ name: "n".repeat(201) }), "invalid_input"],
    [manual({ nutrition: { energyKcal: "" } }), "invalid_nutrition"],
    [manual({ nutrition: { energyKcal: "1.0009" } }), "invalid_nutrition"],
    [manual({ nutrition: { energyKcal: "1", sodiumMilligrams: "1.5" } }), "invalid_nutrition"],
  ];
  for (const [input, code] of invalid) {
    const error = await rejection(service.save(userId, input));
    expect(error).toBeInstanceOf(FoodEventValidationError);
    expect((error as FoodEventValidationError).code).toBe(code);
  }
  // Five minutes of clock skew are tolerated, as for Water Events.
  await expect(service.save(userId, lookup({ logDate: "2026-08-29T18:05:00.000Z" }))).resolves.toBeDefined();
  expect(catalog.calls).toHaveLength(1);
  expect(client.select().from(foodEvents).all()).toHaveLength(1);
  database.close();
});

test("an account without setup is refused before any provider work", async () => {
  const { catalog, database, service } = await setup();
  const error = await rejection(service.save(999_999, lookup()));
  expect(error).toMatchObject({ code: "missing_setup" });
  expect(catalog.calls).toEqual([]);
  database.close();
});

test("a USDA generation or food that changed since review refuses the save", async () => {
  const { catalog, client, database, service, userId } = await setup();

  catalog.food.catalogGeneration = "00000000-0000-4000-8000-000000000002";
  expect(await rejection(service.save(userId, lookup()))).toMatchObject({ code: "catalog_changed" });
  catalog.failure = new CatalogStaleReviewError();
  expect(await rejection(service.save(userId, lookup()))).toMatchObject({ code: "catalog_changed" });

  catalog.failure = undefined;
  catalog.food = foundationBread();
  catalog.food.isSelectable = false;
  expect(await rejection(service.save(userId, lookup()))).toMatchObject({ code: "nutrition_unavailable" });
  expect(client.select().from(foodEvents).all()).toEqual([]);
  database.close();
});

test("provider failures become coded Food Event errors and write nothing", async () => {
  const { catalog, client, database, service, userId } = await setup();
  for (const [failure, code] of [
    [new CatalogNotInstalledError(), "source_unavailable"],
    [new CatalogFoodNotFoundError(), "food_not_found"],
    [new CatalogInvalidDataError(), "source_unavailable"],
    [new CatalogUnavailableError(), "source_unavailable"],
  ] as const) {
    catalog.failure = failure;
    const error = await rejection(service.save(userId, lookup()));
    expect(error).toBeInstanceOf(FoodSourceError);
    expect(error).toMatchObject({ code });
  }
  catalog.failure = new Error("unexpected");
  await expect(service.save(userId, lookup())).rejects.toThrow("unexpected");

  catalog.failure = undefined;
  expect(await rejection(service.save(userId, lookup({ measurementId: "invented serving text" })))).toMatchObject({ code: "invalid_measurement" });
  catalog.food.providerFoodId = "201";
  expect(await rejection(service.save(userId, lookup()))).toMatchObject({ code: "source_unavailable" });
  catalog.food = foundationBread();
  catalog.food.measurements = [{ baseQuantityMicrounits: 32_000_000, id: "portion:7", label: "1 volume portion", unit: "ml" }];
  expect(await rejection(service.save(userId, lookup()))).toMatchObject({ code: "invalid_measurement" });
  catalog.food = foundationBread();
  catalog.food.authoritativeBaseQuantityMicrounits = -1;
  await expect(service.save(userId, lookup())).rejects.toThrow();
  expect(client.select().from(foodEvents).all()).toEqual([]);
  database.close();
});

test("nutrients scale from the unrounded provider amount, round once, and keep only compatible measurements", async () => {
  const { catalog, database, service, userId } = await setup();
  catalog.food.measurements.push(
    { baseQuantityMicrounits: 200_000_000, id: "portion:double", label: "1 double portion (200 g)", unit: "g" },
    { baseQuantityMicrounits: 250_000_000, id: "volume:unsafe", label: "Unsafe volume", unit: "ml" },
  );
  catalog.food.nutritionPerAuthoritativeBase.energyMilliKcal = { amount: 0.0006, fixedPointMultiplier: 1_000 };

  const created = await service.save(userId, lookup({ measurementId: "portion:double" }));

  expect(created.nutrients.energyMilliKcal).toBe(1);
  expect(created.measurements.map((measurement) => measurement.id)).toEqual(["portion:7", "base:g:100000000", "portion:double"]);
  database.close();
});

test("manual nutrition is the total for the entered quantity, and edits rescale from one serving", async () => {
  const { database, service, userId } = await setup();

  const created = await service.save(userId, manual());

  expect(created).toMatchObject({
    source: { provider: "manual", dataType: "User entered" },
    authority: {
      unit: "serving",
      quantityMicrounits: 1_000_000,
      nutrition: {
        carbohydrateMilligrams: { amount: 12, fixedPointMultiplier: 1_000 },
        energyMilliKcal: { amount: 60, fixedPointMultiplier: 1_000 },
        fatMilligrams: { amount: 1, fixedPointMultiplier: 1_000 },
        fiberMilligrams: null,
        proteinMilligrams: { amount: 2, fixedPointMultiplier: 1_000 },
        sodiumMilligrams: { amount: 10, fixedPointMultiplier: 1 },
        sugarMilligrams: { amount: 0, fixedPointMultiplier: 1_000 },
      },
    },
    measurement: { id: "serving", label: "1 serving" },
    quantityMicrounits: 3_000_000,
    nutrients: { energyMilliKcal: 180_000, carbohydrateMilligrams: 36_000, fiberMilligrams: null },
    favoriteId: null,
  });

  const scaled = await service.save(userId, edit(created, { quantity: "4" }));
  expect(scaled.nutrients).toMatchObject({ carbohydrateMilligrams: 48_000, energyMilliKcal: 240_000, proteinMilligrams: 8_000 });
  database.close();
});

test("manual foods require calories but accept zero and unknown optional nutrients", async () => {
  const { database, service, userId } = await setup();
  const created = await service.save(userId, manual({ name: "Zero-calorie drink", quantity: "1", nutrition: { energyKcal: "0" } }));
  expect(created.nutrients).toEqual({
    carbohydrateMilligrams: null,
    energyMilliKcal: 0,
    fatMilligrams: null,
    fiberMilligrams: null,
    proteinMilligrams: null,
    sodiumMilligrams: null,
    sugarMilligrams: null,
  });
  database.close();
});

test("manual decimal corrections keep every unit and redefine the serving base for later scaling", async () => {
  const { database, service, userId } = await setup();
  const created = await service.save(userId, manual({
    name: "  Meal  ",
    nutrition: { energyKcal: " 1.111 ", fiberGrams: "0.5", sugarGrams: "0.25" },
  }));
  expect(created).toMatchObject({ name: "Meal", nutrients: { energyMilliKcal: 1111, fiberMilligrams: 500, sugarMilligrams: 250 } });

  const same = await service.save(userId, edit(created, { quantity: "2", nutrition: { energyKcal: "0.741" } }));
  expect(same.authority.nutrition.energyMilliKcal).toEqual(created.authority.nutrition.energyMilliKcal);
  const corrected = await service.save(userId, edit(same, {
    nutrition: { carbohydrateGrams: "3.5", proteinGrams: "2.25", fatGrams: "1.5", fiberGrams: "0.125", sugarGrams: "0.75", sodiumMilligrams: "51" },
  }));
  const doubled = await service.save(userId, edit(corrected, { quantity: "4" }));
  expect(doubled.nutrients).toMatchObject({
    energyMilliKcal: 1481, carbohydrateMilligrams: 7000, proteinMilligrams: 4500, fatMilligrams: 3000,
    fiberMilligrams: 250, sugarMilligrams: 1500, sodiumMilligrams: 102,
  });

  const recalorized = await service.save(userId, edit(doubled, { quantity: "3", nutrition: { energyKcal: "210" } }));
  expect(recalorized.authority.nutrition.energyMilliKcal).toEqual({ amount: 70, fixedPointMultiplier: 1_000 });
  expect((await service.save(userId, edit(recalorized, { quantity: "4" }))).nutrients.energyMilliKcal).toBe(280_000);
  expect(await rejection(service.save(userId, edit(recalorized, { nutrition: { energyKcal: null } })))).toMatchObject({ code: "edit_conflict" });
  const latest = service.read(userId, created.id);
  expect(await rejection(service.save(userId, edit(latest, { nutrition: { energyKcal: null } })))).toMatchObject({ code: "invalid_nutrition" });
  database.close();
});

test("a manual food becomes a favorite only when asked, in the same transaction, and outlives its event", async () => {
  const { client, database, otherUserId, service, userId } = await setup();

  const unsaved = await service.save(userId, manual({ name: "Unsaved soup" }));
  expect(unsaved.favoriteId).toBeNull();
  expect(service.findFavorites(userId, { query: "" })).toEqual([]);

  const original = await service.save(userId, manual({ name: "Mexican tortilla", quantity: "2", nutrition: { energyKcal: "100", proteinGrams: "3" }, saveAsFavorite: true }));
  const [favorite] = service.findFavorites(userId, { query: "TORTILLA" });
  expect(original.favoriteId).toBe(favorite.id);
  expect(favorite).toMatchObject({
    name: "Mexican tortilla",
    sourceEventId: original.id,
    snapshot: { quantityMicrounits: 2_000_000, nutrients: { energyMilliKcal: 100_000, proteinMilligrams: 3_000 } },
  });
  expect(service.findFavorites(userId, { favoriteId: favorite.id })).toEqual([favorite]);
  expect(service.findFavorites(otherUserId, { query: "tortilla" })).toEqual([]);
  expect(service.findFavorites(otherUserId, { favoriteId: favorite.id })).toEqual([]);

  client.run(sql.raw("CREATE TRIGGER fail_favorite BEFORE INSERT ON favorite_foods BEGIN SELECT RAISE(ABORT, 'simulated favorite failure'); END"));
  await expect(service.save(userId, manual({ name: "Lost soup", saveAsFavorite: true }))).rejects.toThrow("simulated favorite failure");
  expect(client.select().from(foodEvents).where(eq(foodEvents.originalName, "Lost soup")).all()).toEqual([]);
  client.run(sql.raw("DROP TRIGGER fail_favorite"));

  await service.save(userId, edit(original, { name: "Changed tortilla", nutrition: { energyKcal: "200" } }));
  service.delete(userId, [version(service.read(userId, original.id))]);
  const reused = await service.save(userId, { method: "favorite", logDate: NOW, favoriteId: favorite.id });
  expect(reused).toMatchObject({
    logDate: NOW,
    name: "Mexican tortilla",
    favoriteId: favorite.id,
    quantityMicrounits: 2_000_000,
    nutrients: { energyMilliKcal: 100_000, proteinMilligrams: 3_000 },
  });
  expect(service.addFavorite(userId, reused.id)).toEqual(favorite);
  expect(service.findFavorites(userId, { query: "" })).toHaveLength(1);
  expect(await rejection(service.save(otherUserId, { method: "favorite", logDate: NOW, favoriteId: favorite.id }))).toBeInstanceOf(FoodEventNotFoundError);
  database.close();
});

test("an older manual event is favorited only explicitly and once; catalog and others' events cannot be", async () => {
  const { database, otherUserId, service, userId } = await setup();
  const historical = await service.save(userId, manual({ name: "Old tortilla", quantity: "2", nutrition: { energyKcal: "120" } }));
  const catalogEvent = await service.save(userId, lookup());

  const saved = service.addFavorite(userId, historical.id);
  expect(service.addFavorite(userId, historical.id)).toEqual(saved);
  expect(service.read(userId, historical.id).favoriteId).toBe(saved.id);
  await service.save(userId, edit(service.read(userId, historical.id), { name: "Changed tortilla", nutrition: { energyKcal: "200" } }));
  expect(service.findFavorites(userId, { favoriteId: saved.id })[0]).toMatchObject({
    name: "Old tortilla",
    snapshot: { nutrients: { energyMilliKcal: 120_000 } },
  });

  expect(() => service.addFavorite(otherUserId, historical.id)).toThrow(FoodEventNotFoundError);
  expect(() => service.addFavorite(userId, 0)).toThrow(FoodEventNotFoundError);
  expect(() => service.addFavorite(userId, catalogEvent.id)).toThrow(expect.objectContaining({ code: "invalid_input" }) as Error);
  database.close();
});

test("edits recalculate from the stored authority, keep logDate, and never consult the catalog", async () => {
  const { catalog, database, service, userId } = await setup();
  catalog.food.nutritionPerAuthoritativeBase.energyMilliKcal = { amount: 0.0006, fixedPointMultiplier: 1_000 };
  const created = await service.save(userId, lookup());

  const tripled = await service.save(userId, edit(created, { name: "Corrected bread", quantity: "3" }));
  expect(tripled).toMatchObject({ logDate: created.logDate, name: "Corrected bread", nutrients: { energyMilliKcal: 1 }, quantityMicrounits: 3_000_000 });
  const restored = await service.save(userId, edit(tripled, { quantity: "1" }));
  expect(restored.nutrients.energyMilliKcal).toBe(0);
  expect(restored.authority).toEqual(created.authority);

  const base = await service.save(userId, edit(restored, { measurementId: "base:g:100000000" }));
  expect(base).toMatchObject({ measurement: { id: "base:g:100000000", label: "100 g" }, nutrients: { fatMilligrams: 1_500 } });
  expect(await rejection(service.save(userId, edit(base, { measurementId: "missing" })))).toMatchObject({ code: "invalid_measurement" });
  expect(catalog.calls).toHaveLength(1);
  database.close();
});

test("edit nutrients: omitted keeps, null clears, and values normalize at their storage boundaries", async () => {
  const { database, service, userId } = await setup();
  const created = await service.save(userId, lookup());
  const overridden = await service.save(userId, edit(created, {
    name: "  Corrected boundary food  ",
    nutrition: { carbohydrateGrams: "999999.999", energyKcal: " 1.2 ", sodiumMilligrams: "9999999", fiberGrams: null },
  }));
  expect(overridden).toMatchObject({
    name: "Corrected boundary food",
    nutrients: { carbohydrateMilligrams: 999_999_999, energyMilliKcal: 1_200, sodiumMilligrams: 9_999_999, fiberMilligrams: null },
  });
  const renamed = await service.save(userId, edit(overridden, { name: "Only the name" }));
  expect(renamed.nutrients).toEqual(overridden.nutrients);
  const rescaled = await service.save(userId, edit(renamed, { quantity: "2" }));
  expect(rescaled.nutrients).toMatchObject({ energyMilliKcal: 160_000, carbohydrateMilligrams: null, fiberMilligrams: 1_472 });

  for (const nutrition of [
    { energyKcal: "x1" }, { energyKcal: "1x" }, { energyKcal: "1.0009" }, { energyKcal: "1000000" },
    { carbohydrateGrams: "1000000.000" }, { sodiumMilligrams: "x1" }, { sodiumMilligrams: "1.0" }, { sodiumMilligrams: "10000000" },
  ]) {
    expect(await rejection(service.save(userId, edit(rescaled, { nutrition })))).toMatchObject({ code: "invalid_nutrition" });
  }
  for (const changes of [{ name: "   " }, { name: "n".repeat(201) }, { quantity: "" }, { measurementId: "" }]) {
    expect(await rejection(service.save(userId, edit(rescaled, changes)))).toBeInstanceOf(FoodEventValidationError);
  }
  for (const id of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    expect(await rejection(service.save(userId, { id, expectedUpdatedAt: rescaled.updatedAt, changes: {} }))).toMatchObject({ code: "invalid_input" });
  }
  expect(await rejection(service.save(userId, { id: rescaled.id, expectedUpdatedAt: "not-an-instant", changes: {} }))).toMatchObject({ code: "invalid_input" });
  database.close();
});

test("edits and deletes from a stale version are refused with the current version", async () => {
  const { database, foodLog, otherUserId, service, userId } = await setup();
  const first = await service.save(userId, lookup());
  const second = await service.save(userId, lookup());

  const corrected = await service.save(userId, edit(first, { name: "My corrected bread", quantity: "0.5", measurementId: "base:g:100000000" }));
  expect(corrected.updatedAt > first.updatedAt).toBe(true);

  const staleEdit = await rejection(service.save(userId, edit(first, { name: "Stale change" })));
  expect(staleEdit).toBeInstanceOf(FoodEventConflictError);
  expect((staleEdit as FoodEventConflictError).current).toEqual(corrected);
  const staleDelete = await rejection(() => service.delete(userId, [version(first)]));
  expect((staleDelete as FoodEventConflictError).current).toEqual(corrected);
  expect(await rejection(() => service.read(otherUserId, first.id))).toBeInstanceOf(FoodEventNotFoundError);
  expect(await rejection(() => service.delete(otherUserId, [version(corrected)]))).toBeInstanceOf(FoodEventNotFoundError);
  expect(await rejection(service.save(otherUserId, edit(corrected, { name: "Not mine" })))).toBeInstanceOf(FoodEventNotFoundError);

  expect(service.delete(userId, [version(corrected)])).toBe(1);
  expect(foodLog().read(userId, "2026-08-28")?.foodEvents.map((event) => event.id)).toEqual([second.id]);
  database.close();
});

test("a batch delete removes every listed event or none", async () => {
  const { client, database, service, userId } = await setup();
  const events = await Promise.all([1, 2, 3].map(() => service.save(userId, lookup())));

  expect(await rejection(() => service.delete(userId, [version(events[0]), { id: 999_999, expectedUpdatedAt: events[0].updatedAt }]))).toBeInstanceOf(FoodEventNotFoundError);
  expect(await rejection(() => service.delete(userId, [version(events[0]), { id: events[1].id, expectedUpdatedAt: "2026-08-29T17:00:00.000Z" }]))).toBeInstanceOf(FoodEventConflictError);
  expect(client.select().from(foodEvents).all()).toHaveLength(3);
  for (const items of [
    "not a list",
    [{ id: 0, expectedUpdatedAt: events[0].updatedAt }],
    [{ id: events[0].id }],
    [version(events[0]), { id: events[0].id, expectedUpdatedAt: "2026-08-29T17:00:00.000Z" }],
    Array.from({ length: 101 }, () => version(events[0])),
  ]) {
    expect(await rejection(() => service.delete(userId, items as never))).toMatchObject({ code: "invalid_event_ids" });
  }

  expect(service.delete(userId, [version(events[0]), version(events[0]), version(events[1])])).toBe(2);
  expect(client.select().from(foodEvents).all().map((row) => row.id)).toEqual([events[2].id]);
  expect(service.delete(userId, [])).toBe(0);
  database.close();
});

test("offset version tokens are exact, and a write the database ignores is a conflict", async () => {
  const { client, database, service, userId } = await setup({ now: () => new Date("2026-08-29T18:00:01.000Z") });
  const created = await service.save(userId, lookup());
  const offsetTimestamp = "2026-08-29T18:00:00+00:00";
  client.update(foodEvents).set({ updatedAt: offsetTimestamp }).where(eq(foodEvents.id, created.id)).run();

  const accepted = await service.save(userId, { id: created.id, expectedUpdatedAt: offsetTimestamp, changes: { name: "Offset accepted" } });
  expect(accepted).toMatchObject({ name: "Offset accepted", updatedAt: "2026-08-29T18:00:01.000Z" });

  client.run(sql.raw(`CREATE TRIGGER ignore_update BEFORE UPDATE ON food_events WHEN OLD.id = ${created.id} BEGIN SELECT RAISE(IGNORE); END`));
  expect(await rejection(service.save(userId, edit(accepted, { name: "Lost race" })))).toBeInstanceOf(FoodEventConflictError);
  client.run(sql.raw(`CREATE TRIGGER ignore_delete BEFORE DELETE ON food_events WHEN OLD.id = ${created.id} BEGIN SELECT RAISE(IGNORE); END`));
  expect(await rejection(() => service.delete(userId, [version(accepted)]))).toBeInstanceOf(FoodEventConflictError);
  expect(service.read(userId, created.id).id).toBe(created.id);
  database.close();
});

test("versions always advance, even when the clock has not moved", async () => {
  const { database, service, userId } = await setup();
  const created = await service.save(userId, lookup());
  const edited = await service.save(userId, edit(created, { name: "Same instant" }));
  expect(edited.updatedAt).toBe("2026-08-29T18:00:00.001Z");
  database.close();
});

test("preferences are rechecked after provider work", async () => {
  const { catalog, client, database, service, userId } = await setup();
  catalog.beforeReturn = () => client.delete(userPreferences).where(eq(userPreferences.userId, userId)).run();
  expect(await rejection(service.save(userId, lookup()))).toMatchObject({ code: "missing_setup" });
  expect(client.select().from(foodEvents).all()).toEqual([]);
  database.close();
});

test("the consumption time is rechecked against the clock after provider work", async () => {
  const instants = [new Date(NOW), new Date("2026-08-28T18:00:00.000Z")];
  const { client, database, service, userId } = await setup({ now: () => instants.shift() ?? new Date("2026-08-28T18:00:00.000Z") });
  expect(await rejection(service.save(userId, lookup({ logDate: NOW })))).toMatchObject({ code: "future_date" });
  expect(client.select().from(foodEvents).all()).toEqual([]);
  database.close();
});

test("resubmitting a create makes a second event, ordered by save time", async () => {
  const instants = ["2026-08-29T18:00:00.000Z", "2026-08-29T18:00:02.000Z"];
  const { database, foodLog, service, userId } = await setup({ now: () => new Date(instants[0]) });
  const first = await service.save(userId, lookup());
  instants.shift();
  const second = await service.save(userId, lookup());

  expect(second.id).not.toBe(first.id);
  expect(foodLog().read(userId, "2026-08-28")?.foodEvents.map((event) => event.id)).toEqual([second.id, first.id]);
  database.close();
});

test("copies are independent snapshots from storage that work with the provider offline", async () => {
  const { catalog, client, database, foodLog, service, userId } = await setup({ now: () => new Date("2026-08-31T16:23:45.000Z") });
  const source = await service.save(userId, lookup({ logDate: "2026-08-29T16:00:00.000Z", quantity: "1.5" }));
  const corrected = await service.save(userId, edit(source, {
    name: "Corrected bread",
    quantity: "2.25",
    nutrition: { carbohydrateGrams: "12.345", energyKcal: "123.456", fatGrams: "4.567", fiberGrams: "2.345", proteinGrams: "6.789", sodiumMilligrams: "321", sugarGrams: "1.234" },
  }));
  catalog.failure = new CatalogUnavailableError();

  const copied = service.copy(userId, { eventId: source.id, sourceDate: "2026-08-29", logDate: "2026-08-31T16:23:45.000Z" });

  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, logDate: _logDate, copiedFromId: _copied, ...snapshot } = corrected;
  expect(copied).toEqual({
    ...snapshot,
    id: copied.id,
    logDate: "2026-08-31T16:23:45.000Z",
    createdAt: "2026-08-31T16:23:45.000Z",
    updatedAt: "2026-08-31T16:23:45.000Z",
    copiedFromId: source.id,
  });
  expect(catalog.calls).toHaveLength(1);
  expect(foodLog().read(userId, "2026-08-31")?.nutritionTotals.energyMilliKcal.known).toBe(123_456);

  service.delete(userId, [version(corrected)]);
  expect(service.read(userId, copied.id)).toEqual(copied);

  client.run(sql.raw("CREATE TRIGGER fail_copy BEFORE INSERT ON food_events BEGIN SELECT RAISE(ABORT, 'simulated copy failure'); END"));
  expect(() => service.copy(userId, { eventId: copied.id, sourceDate: "2026-08-31", logDate: "2026-08-30T16:00:00.000Z" }))
    .toThrow();
  database.close();
});

test("copying accepts only an owned event from an earlier day, to a different day that is not in the future", async () => {
  const { client, database, otherUserId, service, userId } = await setup({ now: () => new Date("2026-08-31T16:00:00.000Z") });
  const historical = await service.save(userId, lookup({ logDate: "2026-08-30T16:00:00.000Z" }));
  const today = await service.save(userId, lookup({ logDate: "2026-08-31T15:00:00.000Z" }));
  const input = { eventId: historical.id, sourceDate: "2026-08-30", logDate: "2026-08-31T16:00:00.000Z" };

  expect(() => service.copy(otherUserId, input)).toThrow(FoodEventNotFoundError);
  expect(() => service.copy(userId, { ...input, sourceDate: "2026-08-29" })).toThrow(FoodEventNotFoundError);
  expect(() => service.copy(userId, { eventId: today.id, sourceDate: "2026-08-31", logDate: "2026-08-31T16:00:00.000Z" }))
    .toThrow(expect.objectContaining({ code: "invalid_input" }) as Error);
  expect(() => service.copy(userId, { ...input, logDate: "2026-08-30T20:00:00.000Z" }))
    .toThrow(expect.objectContaining({ code: "invalid_log_date" }) as Error);
  expect(() => service.copy(userId, { ...input, logDate: "2026-09-01T16:00:00.000Z" }))
    .toThrow(expect.objectContaining({ code: "future_date" }) as Error);
  for (const invalid of [{ ...input, sourceDate: "2026-02-29" }, { ...input, eventId: 0 }, { ...input, eventId: 1.5 }, { ...input, logDate: "2026-08-31" }]) {
    expect(() => service.copy(userId, invalid)).toThrow(FoodEventValidationError);
  }

  const first = service.copy(userId, input);
  const second = service.copy(userId, input);
  expect(second.id).not.toBe(first.id);
  expect(client.select().from(foodEvents).all()).toHaveLength(4);
  database.close();
});

test("copies carry a favorite link so the editor does not offer to save them again", async () => {
  const { database, service, userId } = await setup({ now: () => new Date("2026-08-31T16:00:00.000Z") });
  const favorited = await service.save(userId, manual({ name: "Saved soup", logDate: "2026-08-29T16:00:00.000Z", saveAsFavorite: true }));
  const unsaved = await service.save(userId, manual({ name: "Unsaved soup", logDate: "2026-08-29T16:00:00.000Z" }));

  const copiedFavorite = service.copy(userId, { eventId: favorited.id, sourceDate: "2026-08-29", logDate: "2026-08-31T16:00:00.000Z" });
  const copiedUnsaved = service.copy(userId, { eventId: unsaved.id, sourceDate: "2026-08-29", logDate: "2026-08-31T16:00:00.000Z" });

  expect(copiedFavorite.favoriteId).toBe(favorited.favoriteId);
  expect(copiedUnsaved.favoriteId).toBeNull();
  expect(service.findFavorites(userId, { query: "" })).toHaveLength(1);
  database.close();
});

test("copying reads days in the account's time zone", async () => {
  const { database, service, userId } = await setup({ now: () => new Date("2026-01-01T10:30:45.000Z"), timeZone: "Pacific/Kiritimati" });
  // 2025-12-31 at noon in Kiritimati (UTC+14) is 22:00 UTC the day before.
  const source = await service.save(userId, lookup({ logDate: "2025-12-30T22:00:00.000Z" }));

  const copied = service.copy(userId, { eventId: source.id, sourceDate: "2025-12-31", logDate: "2026-01-01T10:30:45.000Z" });

  expect(copied.logDate).toBe("2026-01-01T10:30:45.000Z");
  expect(() => service.copy(userId, { eventId: source.id, sourceDate: "2025-12-30", logDate: "2026-01-01T10:30:45.000Z" }))
    .toThrow(FoodEventNotFoundError);
  database.close();
});

test("lists are newest first with totals and per-day groups in the account's time zone, across DST", async () => {
  const { database, service, userId } = await setup({ now: () => new Date("2026-11-03T12:00:00.000Z") });
  // New York falls back on 2026-11-01, a 25-hour day: 04:00Z and 05:30Z are both on November 1.
  const early = await service.save(userId, lookup({ logDate: "2026-11-01T04:00:00.000Z" }));
  const late = await service.save(userId, lookup({ logDate: "2026-11-02T04:30:00.000Z" }));
  const nextDay = await service.save(userId, lookup({ logDate: "2026-11-02T05:30:00.000Z" }));
  const before = await service.save(userId, lookup({ logDate: "2026-11-01T03:59:59.000Z" }));

  const list = service.list(userId, { from: "2026-10-31T00:00:00-04:00", to: "2026-11-03T00:00:00-05:00" });

  expect(list.events.map((event) => event.id)).toEqual([nextDay.id, late.id, early.id, before.id]);
  expect(list.totals.energyMilliKcal.known).toBe(320_000);
  expect(Object.keys(list.days)).toEqual(["2026-11-02", "2026-11-01", "2026-10-31"]);
  expect(list.days["2026-11-01"]).toMatchObject({ eventCount: 2, totals: { energyMilliKcal: { known: 160_000, isIncomplete: false } } });
  expect(list.days["2026-10-31"].eventCount).toBe(1);
  expect(service.list(userId, { from: "2026-11-01T04:00:00Z", to: "2026-11-01T04:00:01Z" }).events).toEqual([early]);

  for (const range of [
    { from: "2026-11-02T00:00:00Z", to: "2026-11-01T00:00:00Z" },
    { from: "2026-11-01", to: "2026-11-02" },
    { from: "2026-11-01T00:00:00", to: "2026-11-02T00:00:00" },
  ]) {
    expect(() => service.list(userId, range)).toThrow(expect.objectContaining({ code: "invalid_range" }) as Error);
  }
  database.close();
});

async function barcodeService(replies: Record<string, OffApiReply>) {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "barcode.event.user");
  const api = fakeOffApi(replies);
  const openFoodFacts = createOpenFoodFactsClient(client, api.fetch);
  openFoodFacts.saveContact("family@example.com");
  const catalog = new FoodCatalog([], openFoodFacts);
  const service = createFoodEventService(client, () => new Date(NOW), catalog);
  return { api, catalog, database, service, userId };
}

function barcode(reviewVersion: string): CreateFoodEvent {
  return { method: "barcode", logDate: NOW, providerFoodId: "0034000470693", reviewVersion, measurementId: "serving", quantity: "2" };
}

test("an Open Food Facts product saves when it still matches the reviewed fingerprint", async () => {
  const { api, catalog, database, service, userId } = await barcodeService({ "0034000470693": exampleCerealProduct });
  const reviewed = await catalog.lookupBarcode("0034000470693");

  const created = await service.save(userId, barcode(reviewed.catalogGeneration!));

  expect(created).toMatchObject({
    source: { provider: "open-food-facts", providerFoodId: "0034000470693", barcode: "0034000470693" },
    measurement: { label: "1 serving (30 g)" },
    nutrients: { energyMilliKcal: 360_000, carbohydrateMilligrams: 48_000 },
  });
  expect(api.requests).toHaveLength(2);
  database.close();
});

test("an Open Food Facts save refuses a changed or unverifiable product", async () => {
  let reply: OffApiReply = exampleCerealProduct;
  const { catalog, database, service, userId } = await barcodeService({
    "0034000470693": () => reply instanceof Response ? reply : Response.json({ product: reply }),
  });
  const reviewed = await catalog.lookupBarcode("0034000470693");

  reply = { ...exampleCerealProduct, product_name: "Renamed cereal" };
  expect(await rejection(service.save(userId, barcode(reviewed.catalogGeneration!)))).toMatchObject({ code: "catalog_changed" });
  reply = new Response("Too many requests", { status: 429 });
  expect(await rejection(service.save(userId, barcode(reviewed.catalogGeneration!)))).toMatchObject({
    code: "source_unavailable",
    message: "Open Food Facts isn't responding; try again or log it manually.",
  });
  reply = new Response("Not found", { status: 404 });
  expect(await rejection(service.save(userId, barcode(reviewed.catalogGeneration!)))).toMatchObject({ code: "food_not_found" });
  expect(await rejection(service.save(userId, barcode("not-a-fingerprint")))).toMatchObject({ code: "invalid_input" });
  database.close();
});

test("barcode saves are refused while Open Food Facts lookup is not configured or not installed", async () => {
  const { database, service, userId } = await barcodeService({});
  database.getClient().run(sql.raw("DELETE FROM application_metadata WHERE key = 'off:contact'"));
  expect(await rejection(service.save(userId, barcode("0".repeat(64))))).toMatchObject({ code: "barcode_not_configured" });
  const withoutLookup = createFoodEventService(database.getClient(), () => new Date(NOW), new FoodCatalog([]));
  expect(await rejection(withoutLookup.save(userId, barcode("0".repeat(64))))).toMatchObject({ code: "source_unavailable" });
  expect(database.getClient().select().from(favoriteFoods).all()).toEqual([]);
  database.close();
});

test("untrusted input shapes from REST and MCP are refused with codes, never thrown as type errors", async () => {
  const { database, service, userId } = await setup();
  const created = await service.save(userId, lookup());
  const codeOf = async (attempt: () => unknown) => ((await rejection(attempt)) as FoodEventValidationError).code;

  expect(await codeOf(() => service.save(userId, null as never))).toBe("invalid_input");
  expect(await codeOf(() => service.save(userId, { ...lookup(), quantity: 1 } as never))).toBe("invalid_quantity");
  expect(await codeOf(() => service.save(userId, manual({ name: 42 as never })))).toBe("invalid_input");
  expect(await codeOf(() => service.save(userId, manual({ nutrition: "180 kcal" as never })))).toBe("invalid_nutrition");
  expect(await codeOf(() => service.save(userId, manual({ nutrition: { energyKcal: 180 as never } })))).toBe("invalid_nutrition");
  expect(await codeOf(() => service.save(userId, { id: created.id, expectedUpdatedAt: created.updatedAt, changes: null as never }))).toBe("invalid_input");
  expect(await codeOf(() => service.save(userId, edit(created, { nutrition: { energyKcal: 12 as never } })))).toBe("invalid_nutrition");
  expect(await codeOf(() => service.list(userId, { from: 1 as never, to: 2 as never }))).toBe("invalid_range");
  expect(await codeOf(() => service.list(userId, undefined as never))).toBe("invalid_range");
  expect(await codeOf(() => service.delete(userId, ["1" as never]))).toBe("invalid_event_ids");
  expect(await codeOf(() => service.delete(userId, [null as never]))).toBe("invalid_event_ids");
  expect(service.findFavorites(userId, { favoriteId: "1" as never })).toEqual([]);
  expect(service.findFavorites(userId, { query: 1 as never })).toEqual([]);
  expect(await codeOf(() => service.list(999_999, { from: "2026-08-01T00:00:00Z", to: "2026-09-01T00:00:00Z" }))).toBe("missing_setup");
  database.close();
});

test("an Open Food Facts serving authority saves only its own serving measurement", async () => {
  const { catalog, database, service, userId } = await setup();
  const fingerprint = "f".repeat(64);
  catalog.food = {
    ...foundationBread(),
    authoritativeBaseQuantityMicrounits: 1_000_000,
    authoritativeBaseUnit: "serving",
    barcode: "0034000470693",
    catalogGeneration: fingerprint,
    dataType: "Open Food Facts",
    measurements: [
      { baseQuantityMicrounits: 1_000_000, id: "serving", label: "1 serving", unit: "serving" },
      { baseQuantityMicrounits: 2_000_000, id: "double", label: "2 servings", unit: "serving" },
    ],
    provider: "open-food-facts",
    providerFoodId: "0034000470693",
  };
  const barcodeSave = (measurementId: string): CreateFoodEvent => ({
    method: "barcode", logDate: NOW, providerFoodId: "0034000470693", reviewVersion: fingerprint, measurementId, quantity: "2",
  });

  expect(await service.save(userId, barcodeSave("serving"))).toMatchObject({
    authority: { unit: "serving", quantityMicrounits: 1_000_000 },
    nutrients: { energyMilliKcal: 500_000 },
  });
  expect(await rejection(service.save(userId, barcodeSave("double")))).toMatchObject({ code: "invalid_measurement" });
  expect(catalog.calls.map((call) => call.provider)).toEqual(["open-food-facts", "open-food-facts"]);
  database.close();
});

test("a catalog without the method's provider, or failing unexpectedly, writes nothing", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "missing.providers");
  const service = createFoodEventService(client, () => new Date(NOW), new FoodCatalog([]));
  expect(await rejection(service.save(userId, lookup()))).toMatchObject({
    code: "source_unavailable",
    message: "The selected Food Catalog provider is unavailable.",
  });
  const unexpected = new Error("unexpected barcode failure");
  const failing = createFoodEventService(client, () => new Date(NOW), new FoodCatalog([], { lookup: () => Promise.reject(unexpected) }));
  expect(await rejection(failing.save(userId, barcode("0".repeat(64))))).toBe(unexpected);
  expect(client.select().from(foodEvents).all()).toEqual([]);
  database.close();
});
