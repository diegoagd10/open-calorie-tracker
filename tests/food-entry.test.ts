import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";

import type {
  CatalogFood,
  CatalogSearchResult,
  FoodCatalogProvider,
} from "../app/catalog/food-catalog.server";
import {
  CatalogConfigurationError,
  CatalogCredentialsError,
  CatalogFoodNotFoundError,
  CatalogInvalidResponseError,
  CatalogRateLimitError,
  CatalogUnavailableError,
  CatalogUnsafeMeasurementError,
} from "../app/catalog/food-catalog.server";
import {
  openApplicationDatabase,
  type ApplicationDatabaseClient,
} from "../app/database/database.server";
import {
  foodEntries,
  goalVersions,
  userPreferences,
  users,
} from "../app/database/schema.server";
import {
  FoodEntryService,
  FoodEntryUnavailableError,
  InvalidFoodEntryInputError,
  StaleFoodEntryError,
} from "../app/food-entry/food-entry.server";
import { scaleCatalogNutrient } from "../app/food-entry/snapshot.server";
import { FoodLogService } from "../app/food-log/food-log.server";
import { FutureFoodLogDateError } from "../app/food-log/food-log.server";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function setupDatabase() {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-food-entry-"));
  temporaryDirectories.push(directory);
  return openApplicationDatabase({
    databasePath: path.join(directory, "application.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });
}

function insertConfiguredUser(
  client: ApplicationDatabaseClient,
  username: string,
): number {
  const createdAt = "2026-01-01T00:00:00.000Z";
  const userId = client
    .insert(users)
    .values({ createdAt, usernameNormalized: username })
    .returning({ id: users.id })
    .get().id;
  client
    .insert(userPreferences)
    .values({
      createdAt,
      displayUnits: "us",
      timeZone: "America/New_York",
      updatedAt: createdAt,
      userId,
    })
    .run();
  client
    .insert(goalVersions)
    .values({
      calorieTargetMilliKcal: 2_000_000,
      carbohydrateTargetMilligrams: 250_000,
      createdAt,
      effectiveDate: "2026-01-01",
      fatTargetMilligrams: 70_000,
      fiberTargetMilligrams: 25_000,
      proteinTargetMilligrams: 120_000,
      sodiumMaximumMilligrams: 2_300,
      sugarMaximumMilligrams: 50_000,
      userId,
      waterTargetMicroliters: 2_000_000,
    })
    .run();
  return userId;
}

function foundationBread(): CatalogFood {
  return {
    authoritativeBaseQuantityMicrounits: 100_000_000,
    authoritativeBaseUnit: "g",
    barcode: "0012345678905",
    brand: null,
    dataType: "Foundation",
    isSelectable: true,
    marketCountry: "United States",
    measurementSummary: "1 slice (32 g)",
    measurements: [
      {
        baseQuantityMicrounits: 32_000_000,
        id: "portion:7",
        label: "1 slice (32 g)",
        unit: "g",
      },
      {
        baseQuantityMicrounits: 100_000_000,
        id: "base:g:100000000",
        label: "100 g",
        unit: "g",
      },
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

class FakeCatalogProvider implements FoodCatalogProvider {
  food = foundationBread();
  getFoodCalls = 0;

  async getFood(): Promise<CatalogFood> {
    this.getFoodCalls += 1;
    return structuredClone(this.food);
  }

  async search(): Promise<CatalogSearchResult[]> {
    return [];
  }
}

function validLogInput() {
  return {
    foodLogDate: "2026-08-29",
    idempotencyKey: "boundary-log-entry",
    providerFoodId: "200",
    quantity: "1",
    selectedMeasurementId: "portion:7",
  };
}

test("a provider-backed fractional portion becomes an immutable Food Entry snapshot", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "snapshot.user");
  const provider = new FakeCatalogProvider();
  const now = () => new Date("2026-08-29T18:00:00.000Z");
  const service = new FoodEntryService(client, provider, now);

  const created = await service.log(userId, {
    foodLogDate: "2026-08-28",
    idempotencyKey: "0198f7e2-5aab-7000-8000-000000000001",
    providerFoodId: "200",
    quantity: "1.5",
    selectedMeasurementId: "portion:7",
  });

  expect(created).toMatchObject({
    authoritativeBaseQuantityMicrounits: 100_000_000,
    authoritativeBaseUnit: "g",
    authoritativeNutrition: provider.food.nutritionPerAuthoritativeBase,
    barcode: "0012345678905",
    carbohydrateMilligrams: null,
    energyMilliKcal: 120_000,
    foodLogDate: "2026-08-28",
    localEventTime: "12:00:00",
    name: "Bread, whole-wheat",
    proteinMilligrams: 0,
    quantityMicrounits: 1_500_000,
    selectedMeasurementLabel: "1 slice (32 g)",
    sodiumMilligrams: 58,
  });

  provider.food.name = "Provider changed this later";
  provider.food.nutritionPerAuthoritativeBase.energyMilliKcal = {
    amount: 999,
    fixedPointMultiplier: 1_000,
  };
  const foodLog = new FoodLogService(client, now).read(userId, "2026-08-28");
  expect(foodLog?.entries).toHaveLength(1);
  expect(foodLog?.entries[0]).toMatchObject({
    authoritativeNutrition: {
      energyMilliKcal: { amount: 250, fixedPointMultiplier: 1_000 },
    },
    energyMilliKcal: 120_000,
    name: "Bread, whole-wheat",
    provider: "usda-fdc",
  });
  database.close();
});

test("nutrients scale from the unrounded provider amount and round once at snapshot creation", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "rounding.user");
  const provider = new FakeCatalogProvider();
  provider.food.measurements = [
    {
      baseQuantityMicrounits: 200_000_000,
      id: "portion:double",
      label: "1 double portion (200 g)",
      unit: "g",
    },
  ];
  provider.food.nutritionPerAuthoritativeBase.energyMilliKcal = {
    amount: 0.0006,
    fixedPointMultiplier: 1_000,
  };
  const created = await new FoodEntryService(
    client,
    provider,
    () => new Date("2026-08-29T18:00:00.000Z"),
  ).log(userId, {
    foodLogDate: "2026-08-29",
    idempotencyKey: "0198f7e2-5aab-7000-8000-000000000002",
    providerFoodId: "200",
    quantity: "1",
    selectedMeasurementId: "portion:double",
  });

  expect(created.energyMilliKcal).toBe(1);
  expect(client.select().from(foodEntries).get()?.energyMilliKcal).toBe(1);
  database.close();
});

test("fixed-point scaling and display rounding are exact across supported serving quantities", () => {
  for (const [quantity, expected] of [
    [0.5, 40_000],
    [1, 80_000],
    [1.5, 120_000],
    [2, 160_000],
  ] as const) {
    const scaled = scaleCatalogNutrient(
      { amount: 250, fixedPointMultiplier: 1_000 },
      32_000_000,
      quantity * 1_000_000,
      100_000_000,
    );
    expect(scaled).toBe(expected);
    expect((scaled! / 1_000).toFixed(1)).toBe((expected / 1_000).toFixed(1));
  }
});

test("an idempotency key returns one entry while distinct submissions remain valid duplicates", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "idempotent.user");
  const provider = new FakeCatalogProvider();
  const now = () => new Date("2026-08-29T18:00:00.000Z");
  const service = new FoodEntryService(client, provider, now);
  const firstInput = {
    foodLogDate: "2026-08-28",
    idempotencyKey: "0198f7e2-5aab-7000-8000-000000000010",
    providerFoodId: "200",
    quantity: "0.5",
    selectedMeasurementId: "portion:7",
  };

  const first = await service.log(userId, firstInput);
  const repeated = await service.log(userId, firstInput);
  const intentionalDuplicate = await service.log(userId, {
    ...firstInput,
    idempotencyKey: "0198f7e2-5aab-7000-8000-000000000011",
  });

  expect(repeated.id).toBe(first.id);
  expect(intentionalDuplicate.id).not.toBe(first.id);
  expect(provider.getFoodCalls).toBe(2);
  expect(
    new FoodLogService(client, now).read(userId, "2026-08-28")?.entries,
  ).toMatchObject([
    { id: intentionalDuplicate.id, localEventTime: "12:01:00" },
    { id: first.id, localEventTime: "12:00:00" },
  ]);
  database.close();
});

test("today uses current local time and past entries retain deterministic ties at day end", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "ordering.user");
  const provider = new FakeCatalogProvider();
  const now = () => new Date("2026-08-29T18:23:45.000Z");
  const service = new FoodEntryService(client, provider, now);

  const todayEntry = await service.log(userId, {
    foodLogDate: "2026-08-29",
    idempotencyKey: "0198f7e2-5aab-7000-8000-000000000020",
    providerFoodId: "200",
    quantity: "1",
    selectedMeasurementId: "base:g:100000000",
  });
  expect(todayEntry.localEventTime).toBe("14:23:45");

  client
    .insert(foodEntries)
    .values({
      authoritativeBaseQuantityMicrounits: 100_000_000,
      authoritativeBaseUnit: "g",
      authoritativeNutrition: JSON.stringify(
        provider.food.nutritionPerAuthoritativeBase,
      ),
      energyMilliKcal: 1_000,
      barcode: null,
      brand: null,
      createdAt: "2026-08-29T17:00:00.000Z",
      foodLogDate: "2026-08-28",
      idempotencyKey: "existing-at-day-end",
      localEventTime: "23:59:30",
      marketCountry: null,
      originalName: "Existing late entry",
      provider: "usda-fdc",
      providerFoodId: "999",
      providerModifiedDate: null,
      providerPublishedDate: null,
      quantityMicrounits: 1_000_000,
      selectedMeasurementBaseQuantityMicrounits: 100_000_000,
      selectedMeasurementId: "base:g:100000000",
      selectedMeasurementLabel: "100 g",
      selectedMeasurementUnit: "g",
      sourceDataType: "Foundation",
      updatedAt: "2026-08-29T17:00:00.000Z",
      userId,
    })
    .run();
  const tied = await service.log(userId, {
    foodLogDate: "2026-08-28",
    idempotencyKey: "0198f7e2-5aab-7000-8000-000000000021",
    providerFoodId: "200",
    quantity: "1",
    selectedMeasurementId: "base:g:100000000",
  });
  expect(tied.localEventTime).toBe("23:59:30");
  expect(
    new FoodLogService(client, now).read(userId, "2026-08-28")?.entries[0]?.id,
  ).toBe(tied.id);
  database.close();
});

test("authorization, future dates, unsafe measurements, provider failures, and transaction failures create nothing", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "failure.user");
  const provider = new FakeCatalogProvider();
  const now = () => new Date("2026-08-29T18:00:00.000Z");
  const service = new FoodEntryService(client, provider, now);
  const input = {
    foodLogDate: "2026-08-28",
    idempotencyKey: "0198f7e2-5aab-7000-8000-000000000030",
    providerFoodId: "200",
    quantity: "1",
    selectedMeasurementId: "portion:7",
  };

  await expect(service.log(999_999, input)).rejects.toThrow(
    "Food Log date is invalid",
  );
  await expect(
    service.log(userId, {
      ...input,
      foodLogDate: "2026-08-30",
      idempotencyKey: "0198f7e2-5aab-7000-8000-000000000031",
    }),
  ).rejects.toBeInstanceOf(FutureFoodLogDateError);
  await expect(
    service.log(userId, {
      ...input,
      idempotencyKey: "0198f7e2-5aab-7000-8000-000000000032",
      selectedMeasurementId: "invented serving text",
    }),
  ).rejects.toBeInstanceOf(CatalogUnsafeMeasurementError);

  const providerFailures = [
    new CatalogConfigurationError(),
    new CatalogCredentialsError(),
    new CatalogFoodNotFoundError(),
    new CatalogInvalidResponseError(),
    new CatalogRateLimitError(),
    new CatalogUnavailableError(),
  ];
  for (const [index, providerFailure] of providerFailures.entries()) {
    const failingProvider: FoodCatalogProvider = {
      async getFood() {
        throw providerFailure;
      },
    };
    await expect(
      new FoodEntryService(client, failingProvider, now).log(userId, {
        ...input,
        idempotencyKey: `catalog-failure-${index}`,
      }),
    ).rejects.toBeInstanceOf(providerFailure.constructor);
  }

  provider.food.authoritativeBaseQuantityMicrounits = -1;
  await expect(
    service.log(userId, {
      ...input,
      idempotencyKey: "0198f7e2-5aab-7000-8000-000000000034",
    }),
  ).rejects.toThrow();

  expect(
    new FoodLogService(client, now).read(userId, "2026-08-28")?.entries,
  ).toEqual([]);
  database.close();
});

test("a Food Entry edit recalculates from its authoritative snapshot without accumulating rounding", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "edit.rounding");
  const provider = new FakeCatalogProvider();
  provider.food.nutritionPerAuthoritativeBase.energyMilliKcal = {
    amount: 0.0006,
    fixedPointMultiplier: 1_000,
  };
  const service = new FoodEntryService(
    client,
    provider,
    () => new Date("2026-08-29T18:00:00.000Z"),
  );
  const created = await service.log(userId, {
    foodLogDate: "2026-08-29",
    idempotencyKey: "edit-rounding-create",
    providerFoodId: "200",
    quantity: "1",
    selectedMeasurementId: "portion:7",
  });

  const tripled = service.update(userId, created.id, {
    expectedUpdatedAt: created.updatedAt,
    foodLogDate: created.foodLogDate,
    name: "Corrected bread",
    quantity: "3",
    selectedMeasurementId: "portion:7",
  });
  expect(tripled).toMatchObject({
    energyMilliKcal: 1,
    name: "Corrected bread",
    quantityMicrounits: 3_000_000,
  });

  const restored = service.update(userId, created.id, {
    expectedUpdatedAt: tripled.updatedAt,
    foodLogDate: created.foodLogDate,
    name: "Corrected bread",
    quantity: "1",
    selectedMeasurementId: "portion:7",
  });
  expect(restored.energyMilliKcal).toBe(0);
  expect(restored.authoritativeNutrition).toEqual(
    created.authoritativeNutrition,
  );
  database.close();
});

test("Food Entry corrections and deletion are isolated, concurrency-safe, and preserve ordering", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "edit.owner");
  const otherUserId = insertConfiguredUser(client, "edit.other");
  const provider = new FakeCatalogProvider();
  const service = new FoodEntryService(
    client,
    provider,
    () => new Date("2026-08-29T18:00:00.000Z"),
  );
  const first = await service.log(userId, {
    foodLogDate: "2026-08-28",
    idempotencyKey: "edit-isolation-first",
    providerFoodId: "200",
    quantity: "1",
    selectedMeasurementId: "portion:7",
  });
  const second = await service.log(userId, {
    foodLogDate: "2026-08-28",
    idempotencyKey: "edit-isolation-second",
    providerFoodId: "200",
    quantity: "1",
    selectedMeasurementId: "portion:7",
  });

  const corrected = service.update(userId, first.id, {
    carbohydrateGrams: "12.345",
    energyKcal: "",
    expectedUpdatedAt: first.updatedAt,
    fatGrams: "0",
    fiberGrams: "",
    foodLogDate: first.foodLogDate,
    name: "My corrected bread",
    proteinGrams: "0",
    quantity: "0.5",
    selectedMeasurementId: "base:g:100000000",
    sodiumMilligrams: "0",
    sugarGrams: "",
  });
  expect(corrected).toMatchObject({
    carbohydrateMilligrams: 12_345,
    energyMilliKcal: null,
    fatMilligrams: 0,
    fiberMilligrams: null,
    name: "My corrected bread",
    proteinMilligrams: 0,
    quantityMicrounits: 500_000,
    sodiumMilligrams: 0,
    sugarMilligrams: null,
  });
  expect(service.read(userId, second.id)).toMatchObject({
    name: "Bread, whole-wheat",
    quantityMicrounits: 1_000_000,
  });
  expect(
    new FoodLogService(client, () =>
      new Date("2026-08-29T18:00:00.000Z"),
    ).read(userId, "2026-08-28")?.entries.map((entry) => entry.id),
  ).toEqual([second.id, first.id]);

  expect(() => service.read(otherUserId, first.id)).toThrow(
    FoodEntryUnavailableError,
  );
  expect(() =>
    service.update(userId, first.id, {
      expectedUpdatedAt: first.updatedAt,
      foodLogDate: first.foodLogDate,
      name: "Stale change",
      quantity: "1",
      selectedMeasurementId: "portion:7",
    }),
  ).toThrow(StaleFoodEntryError);
  expect(() =>
    service.update(userId, second.id, {
      expectedUpdatedAt: second.updatedAt,
      foodLogDate: "2026-08-27",
      name: "Cannot move dates",
      quantity: "1",
      selectedMeasurementId: "portion:7",
    }),
  ).toThrow(FoodEntryUnavailableError);
  expect(() =>
    service.update(userId, second.id, {
      expectedUpdatedAt: second.updatedAt,
      foodLogDate: second.foodLogDate,
      name: "Malformed nutrient",
      proteinGrams: "1.0009",
      quantity: "1",
      selectedMeasurementId: "portion:7",
    }),
  ).toThrow(InvalidFoodEntryInputError);
  expect(service.read(userId, second.id)).toMatchObject({
    name: "Bread, whole-wheat",
    proteinMilligrams: 0,
  });
  expect(() =>
    service.delete(otherUserId, first.id, {
      expectedUpdatedAt: corrected.updatedAt,
      foodLogDate: first.foodLogDate,
    }),
  ).toThrow(FoodEntryUnavailableError);
  expect(() =>
    service.delete(userId, first.id, {
      expectedUpdatedAt: first.updatedAt,
      foodLogDate: first.foodLogDate,
    }),
  ).toThrow(StaleFoodEntryError);

  expect(
    service.delete(userId, first.id, {
      expectedUpdatedAt: corrected.updatedAt,
      foodLogDate: first.foodLogDate,
    }),
  ).toEqual({ foodLogDate: "2026-08-28" });
  expect(
    new FoodLogService(client, () =>
      new Date("2026-08-29T18:00:00.000Z"),
    ).read(userId, "2026-08-28")?.entries.map((entry) => entry.id),
  ).toEqual([second.id]);
  expect(provider.getFoodCalls).toBe(2);
  database.close();
});

test("Food Entry errors expose stable user-safe messages", () => {
  expect(new InvalidFoodEntryInputError().message).toBe(
    "The Food Entry request is invalid",
  );
  expect(new InvalidFoodEntryInputError().name).toBe(
    "InvalidFoodEntryInputError",
  );
  expect(new FoodEntryUnavailableError().message).toBe(
    "Food Entry is unavailable",
  );
  expect(new FoodEntryUnavailableError().name).toBe(
    "FoodEntryUnavailableError",
  );
  expect(new StaleFoodEntryError().message).toBe(
    "This Food Entry changed after you opened it. Review it and try again.",
  );
  expect(new StaleFoodEntryError().name).toBe("StaleFoodEntryError");
});

test("log rejects malformed public input before consulting the provider", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "log.boundaries");
  const provider = new FakeCatalogProvider();
  const service = new FoodEntryService(
    client,
    provider,
    () => new Date("2026-08-29T18:00:00.000Z"),
  );
  const valid = validLogInput();
  const invalidChanges: Array<Partial<typeof valid>> = [
    { idempotencyKey: "short" },
    { idempotencyKey: "a".repeat(129) },
    { idempotencyKey: "!valid-key-123" },
    { idempotencyKey: "valid-key-123!" },
    { providerFoodId: "0" },
    { providerFoodId: "01" },
    { providerFoodId: "x200" },
    { providerFoodId: "200x" },
    { quantity: "" },
    { quantity: "0" },
    { quantity: "100" },
    { quantity: "1.1234567" },
    { quantity: "value" },
    { quantity: "1".repeat(33) },
    { selectedMeasurementId: "" },
    { selectedMeasurementId: "m".repeat(129) },
  ];

  for (const [index, change] of invalidChanges.entries()) {
    await expect(
      service.log(userId, {
        ...valid,
        idempotencyKey: `boundary-${index}-valid-key`,
        ...change,
      }),
    ).rejects.toBeInstanceOf(InvalidFoodEntryInputError);
  }

  expect(provider.getFoodCalls).toBe(0);
  expect(client.select().from(foodEntries).all()).toEqual([]);
  database.close();
});

test("log validates provider identity and measurement unit", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "provider.boundaries");
  const provider = new FakeCatalogProvider();
  const service = new FoodEntryService(
    client,
    provider,
    () => new Date("2026-08-29T18:00:00.000Z"),
  );

  provider.food.providerFoodId = "201";
  await expect(service.log(userId, validLogInput())).rejects.toBeInstanceOf(
    CatalogInvalidResponseError,
  );

  provider.food.providerFoodId = "200";
  provider.food.measurements = [
    {
      baseQuantityMicrounits: 32_000_000,
      id: "portion:7",
      label: "1 volume portion",
      unit: "ml",
    },
  ];
  await expect(
    service.log(userId, {
      ...validLogInput(),
      idempotencyKey: "wrong-measurement-unit",
    }),
  ).rejects.toBeInstanceOf(CatalogUnsafeMeasurementError);

  expect(client.select().from(foodEntries).all()).toEqual([]);
  database.close();
});

test("read rejects every unsafe or unavailable entry identity", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "read.boundaries");
  const otherUserId = insertConfiguredUser(client, "read.other");
  const service = new FoodEntryService(
    client,
    new FakeCatalogProvider(),
    () => new Date("2026-08-29T18:00:00.000Z"),
  );
  const created = await service.log(userId, validLogInput());

  for (const entryId of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => service.read(userId, entryId)).toThrow(
      FoodEntryUnavailableError,
    );
  }
  expect(() => service.read(userId, created.id + 1000)).toThrow(
    FoodEntryUnavailableError,
  );
  expect(() => service.read(otherUserId, created.id)).toThrow(
    FoodEntryUnavailableError,
  );
  expect(service.read(userId, created.id).id).toBe(created.id);
  database.close();
});

test("update normalizes editable values at their exact storage boundaries", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "update.boundaries");
  const service = new FoodEntryService(
    client,
    new FakeCatalogProvider(),
    () => new Date("2026-08-29T18:00:00.000Z"),
  );
  const created = await service.log(userId, validLogInput());

  const maximum = service.update(userId, created.id, {
    carbohydrateGrams: "999999.999",
    energyKcal: " 1.2 ",
    expectedUpdatedAt: created.updatedAt,
    foodLogDate: created.foodLogDate,
    name: "  Corrected boundary food  ",
    quantity: " 2.5 ",
    selectedMeasurementId: "portion:7",
    sodiumMilligrams: "9999999",
  });
  expect(maximum).toMatchObject({
    carbohydrateMilligrams: 999_999_999,
    energyMilliKcal: 1_200,
    name: "Corrected boundary food",
    quantityMicrounits: 2_500_000,
    sodiumMilligrams: 9_999_999,
  });

  const blanked = service.update(userId, created.id, {
    energyKcal: "   ",
    expectedUpdatedAt: maximum.updatedAt,
    foodLogDate: created.foodLogDate,
    name: "Blank nutrient",
    quantity: "1",
    selectedMeasurementId: "portion:7",
  });
  expect(blanked.energyMilliKcal).toBeNull();

  for (const change of [
    { energyKcal: "x1" },
    { energyKcal: "1x" },
    { energyKcal: "1.0009" },
    { energyKcal: "1000000" },
    { carbohydrateGrams: "1000000.000" },
    { sodiumMilligrams: "x1" },
    { sodiumMilligrams: "1x" },
    { sodiumMilligrams: "1.0" },
    { sodiumMilligrams: "10000000" },
  ]) {
    expect(() =>
      service.update(userId, created.id, {
        ...change,
        expectedUpdatedAt: blanked.updatedAt,
        foodLogDate: created.foodLogDate,
        name: "Invalid nutrient",
        quantity: "1",
        selectedMeasurementId: "portion:7",
      }),
    ).toThrow(InvalidFoodEntryInputError);
  }

  database.close();
});

test("update and delete reject malformed identifiers and concurrency tokens", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "mutation.boundaries");
  const service = new FoodEntryService(
    client,
    new FakeCatalogProvider(),
    () => new Date("2026-08-29T18:00:00.000Z"),
  );
  const created = await service.log(userId, validLogInput());
  const validUpdate = {
    expectedUpdatedAt: created.updatedAt,
    foodLogDate: created.foodLogDate,
    name: "Valid name",
    quantity: "1",
    selectedMeasurementId: "portion:7",
  };

  for (const entryId of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => service.update(userId, entryId, validUpdate)).toThrow(
      InvalidFoodEntryInputError,
    );
    expect(() =>
      service.delete(userId, entryId, {
        expectedUpdatedAt: created.updatedAt,
        foodLogDate: created.foodLogDate,
      }),
    ).toThrow(InvalidFoodEntryInputError);
  }

  for (const change of [
    { expectedUpdatedAt: "not-an-instant" },
    { foodLogDate: "2026-02-29" },
    { foodLogDate: "not-a-date" },
  ]) {
    expect(() =>
      service.delete(userId, created.id, {
        expectedUpdatedAt: created.updatedAt,
        foodLogDate: created.foodLogDate,
        ...change,
      }),
    ).toThrow(InvalidFoodEntryInputError);
  }

  for (const change of [
    { expectedUpdatedAt: "not-an-instant" },
    { name: "   " },
    { name: "n".repeat(201) },
    { quantity: "" },
    { selectedMeasurementId: "" },
    { selectedMeasurementId: "m".repeat(129) },
  ]) {
    expect(() =>
      service.update(userId, created.id, { ...validUpdate, ...change }),
    ).toThrow(InvalidFoodEntryInputError);
  }

  database.close();
});

test("snapshots retain only measurements compatible with the authoritative base", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "measurement.filter");
  const provider = new FakeCatalogProvider();
  provider.food.measurements.push({
    baseQuantityMicrounits: 250_000_000,
    id: "volume:unsafe",
    label: "Unsafe volume",
    unit: "ml",
  });
  const service = new FoodEntryService(
    client,
    provider,
    () => new Date("2026-08-29T18:00:00.000Z"),
  );

  const created = await service.log(userId, validLogInput());

  expect(created.supportedMeasurements).toEqual([
    provider.food.measurements[0],
    provider.food.measurements[1],
  ]);
  database.close();
});

test("writable-date preflight avoids provider work for invalid and future logs", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "date.preflight");
  const provider = new FakeCatalogProvider();
  const service = new FoodEntryService(
    client,
    provider,
    () => new Date("2026-08-29T18:00:00.000Z"),
  );

  await expect(
    service.log(userId, { ...validLogInput(), foodLogDate: "2026-02-29" }),
  ).rejects.toThrow("Food Log date is invalid");
  await expect(
    service.log(userId, {
      ...validLogInput(),
      foodLogDate: "2026-08-30",
      idempotencyKey: "future-date-preflight",
    }),
  ).rejects.toBeInstanceOf(FutureFoodLogDateError);
  expect(provider.getFoodCalls).toBe(0);
  database.close();
});

test("transaction rechecks idempotency after provider work", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "idempotency.race");
  const input = validLogInput();
  const competitor = new FoodEntryService(
    client,
    new FakeCatalogProvider(),
    () => new Date("2026-08-29T18:00:00.000Z"),
  );
  let competingEntryId: number | undefined;
  const racingProvider = new FakeCatalogProvider();
  racingProvider.getFood = async () => {
    competingEntryId = (await competitor.log(userId, input)).id;
    return structuredClone(racingProvider.food);
  };
  const service = new FoodEntryService(
    client,
    racingProvider,
    () => new Date("2026-08-29T18:00:00.000Z"),
  );

  const result = await service.log(userId, input);

  expect(result.id).toBe(competingEntryId);
  expect(client.select().from(foodEntries).all()).toHaveLength(1);
  database.close();
});

test("transaction rechecks account preferences after provider work", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "preference.race");
  const provider = new FakeCatalogProvider();
  provider.getFood = async () => {
    client
      .delete(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .run();
    return structuredClone(provider.food);
  };
  const service = new FoodEntryService(
    client,
    provider,
    () => new Date("2026-08-29T18:00:00.000Z"),
  );

  await expect(service.log(userId, validLogInput())).rejects.toThrow(
    "Food Log date is invalid",
  );
  expect(client.select().from(foodEntries).all()).toEqual([]);
  database.close();
});

test("transaction rechecks the local day after provider work", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "date.race");
  const instants = [
    new Date("2026-08-29T18:00:00.000Z"),
    new Date("2026-08-28T18:00:00.000Z"),
  ];
  const service = new FoodEntryService(
    client,
    new FakeCatalogProvider(),
    () => instants.shift() ?? new Date("2026-08-28T18:00:00.000Z"),
  );

  await expect(service.log(userId, validLogInput())).rejects.toBeInstanceOf(
    FutureFoodLogDateError,
  );
  expect(client.select().from(foodEntries).all()).toEqual([]);
  database.close();
});

test("offset timestamps and optimistic update races preserve stale-write safety", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "update.race");
  const service = new FoodEntryService(
    client,
    new FakeCatalogProvider(),
    () => new Date("2026-08-29T18:00:01.000Z"),
  );
  const created = await service.log(userId, validLogInput());
  const offsetTimestamp = "2026-08-29T18:00:00+00:00";
  client
    .update(foodEntries)
    .set({ updatedAt: offsetTimestamp })
    .where(eq(foodEntries.id, created.id))
    .run();

  const accepted = service.update(userId, created.id, {
    expectedUpdatedAt: offsetTimestamp,
    foodLogDate: created.foodLogDate,
    name: "Offset timestamp accepted",
    quantity: "1",
    selectedMeasurementId: "portion:7",
  });
  expect(accepted.name).toBe("Offset timestamp accepted");

  client.run(sql.raw(`CREATE TRIGGER ignore_food_entry_update
    BEFORE UPDATE ON food_entries
    WHEN OLD.id = ${created.id}
    BEGIN
      SELECT RAISE(IGNORE);
    END`));
  expect(() =>
    service.update(userId, created.id, {
      expectedUpdatedAt: accepted.updatedAt,
      foodLogDate: created.foodLogDate,
      name: "Lost race",
      quantity: "1",
      selectedMeasurementId: "portion:7",
    }),
  ).toThrow(StaleFoodEntryError);
  database.close();
});

test("optimistic delete reports a race when the database removes no row", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "delete.race");
  const service = new FoodEntryService(
    client,
    new FakeCatalogProvider(),
    () => new Date("2026-08-29T18:00:00.000Z"),
  );
  const created = await service.log(userId, validLogInput());
  client.run(sql.raw(`CREATE TRIGGER ignore_food_entry_delete
    BEFORE DELETE ON food_entries
    WHEN OLD.id = ${created.id}
    BEGIN
      SELECT RAISE(IGNORE);
    END`));

  expect(() =>
    service.delete(userId, created.id, {
      expectedUpdatedAt: created.updatedAt,
      foodLogDate: created.foodLogDate,
    }),
  ).toThrow(StaleFoodEntryError);
  expect(service.read(userId, created.id).id).toBe(created.id);
  database.close();
});

test("update selects the requested compatible measurement and rejects unsafe choices", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "update.measurement");
  const service = new FoodEntryService(
    client,
    new FakeCatalogProvider(),
    () => new Date("2026-08-29T18:00:00.000Z"),
  );
  const created = await service.log(userId, validLogInput());

  const changed = service.update(userId, created.id, {
    expectedUpdatedAt: created.updatedAt,
    foodLogDate: created.foodLogDate,
    name: "Base quantity",
    quantity: "1",
    selectedMeasurementId: "base:g:100000000",
  });
  expect(changed).toMatchObject({
    energyMilliKcal: 250_000,
    selectedMeasurementId: "base:g:100000000",
    selectedMeasurementLabel: "100 g",
  });

  expect(() =>
    service.update(userId, created.id, {
      expectedUpdatedAt: changed.updatedAt,
      foodLogDate: created.foodLogDate,
      name: "Missing measurement",
      quantity: "1",
      selectedMeasurementId: "missing-measurement",
    }),
  ).toThrow(InvalidFoodEntryInputError);

  client
    .update(foodEntries)
    .set({
      supportedMeasurements: JSON.stringify([
        {
          baseQuantityMicrounits: 250_000_000,
          id: "volume:unsafe",
          label: "Unsafe volume",
          unit: "ml",
        },
      ]),
    })
    .where(eq(foodEntries.id, created.id))
    .run();
  expect(() =>
    service.update(userId, created.id, {
      expectedUpdatedAt: changed.updatedAt,
      foodLogDate: created.foodLogDate,
      name: "Wrong measurement unit",
      quantity: "1",
      selectedMeasurementId: "volume:unsafe",
    }),
  ).toThrow(InvalidFoodEntryInputError);
  database.close();
});

test("every decimal nutrient field stores fractional thousandths", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "fractional.nutrients");
  const service = new FoodEntryService(
    client,
    new FakeCatalogProvider(),
    () => new Date("2026-08-29T18:00:00.000Z"),
  );
  const created = await service.log(userId, validLogInput());

  const updated = service.update(userId, created.id, {
    carbohydrateGrams: "1.001",
    energyKcal: "2.002",
    expectedUpdatedAt: created.updatedAt,
    fatGrams: "3.003",
    fiberGrams: "4.004",
    foodLogDate: created.foodLogDate,
    name: "Fractional nutrients",
    proteinGrams: "5.005",
    quantity: "1",
    selectedMeasurementId: "portion:7",
    sodiumMilligrams: "6",
    sugarGrams: "7.007",
  });

  expect(updated).toMatchObject({
    carbohydrateMilligrams: 1_001,
    energyMilliKcal: 2_002,
    fatMilligrams: 3_003,
    fiberMilligrams: 4_004,
    proteinMilligrams: 5_005,
    sodiumMilligrams: 6,
    sugarMilligrams: 7_007,
  });
  database.close();
});

test("delete validates the log date and accepts an offset concurrency token", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "delete.offset");
  const service = new FoodEntryService(
    client,
    new FakeCatalogProvider(),
    () => new Date("2026-08-29T18:00:00.000Z"),
  );
  const created = await service.log(userId, validLogInput());

  expect(() =>
    service.delete(userId, created.id, {
      expectedUpdatedAt: created.updatedAt,
      foodLogDate: "2026-08-28",
    }),
  ).toThrow(FoodEntryUnavailableError);

  const offsetTimestamp = "2026-08-29T18:00:00+00:00";
  client
    .update(foodEntries)
    .set({ updatedAt: offsetTimestamp })
    .where(eq(foodEntries.id, created.id))
    .run();
  expect(
    service.delete(userId, created.id, {
      expectedUpdatedAt: offsetTimestamp,
      foodLogDate: created.foodLogDate,
    }),
  ).toEqual({ foodLogDate: created.foodLogDate });
  database.close();
});
