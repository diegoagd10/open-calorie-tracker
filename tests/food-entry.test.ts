import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
import { FoodEntryService } from "../app/food-entry/food-entry.server";
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
      async search() {
        return [];
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
