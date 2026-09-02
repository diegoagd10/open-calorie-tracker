import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import {
  CatalogFoodNotFoundError,
  CatalogInvalidResponseError,
  CatalogUnknownProviderError,
  CatalogUnsafeMeasurementError,
  FoodCatalog,
  type BarcodeFoodCatalogProvider,
  type CatalogFood,
} from "../app/catalog/food-catalog.server";
import { OpenFoodFactsAdapter } from "../app/catalog/open-food-facts.server";
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
  InvalidFoodEntryInputError,
} from "../app/food-entry/food-entry.server";
import {
  FutureFoodLogDateError,
  InvalidFoodLogDateError,
} from "../app/food-log/food-log.server";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function setupDatabase() {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-off-entry-"));
  temporaryDirectories.push(directory);
  return openApplicationDatabase({
    databasePath: path.join(directory, "application.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });
}

function insertConfiguredUser(client: ApplicationDatabaseClient): number {
  const createdAt = "2026-01-01T00:00:00.000Z";
  const userId = client
    .insert(users)
    .values({ createdAt, usernameNormalized: "off.snapshot" })
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

function cereal(): CatalogFood {
  return {
    authoritativeBaseQuantityMicrounits: 1_000_000,
    authoritativeBaseUnit: "serving",
    barcode: "0034000470693",
    brand: "Example Foods",
    dataType: "Open Food Facts",
    isSelectable: true,
    marketCountry: "United States",
    measurementSummary: "1 serving",
    measurements: [
      {
        baseQuantityMicrounits: 1_000_000,
        id: "serving",
        label: "1 serving",
        unit: "serving",
      },
    ],
    name: "Example cereal",
    nutritionPerAuthoritativeBase: {
      carbohydrateMilligrams: { amount: 24.1234, fixedPointMultiplier: 1_000 },
      energyMilliKcal: { amount: 181.111, fixedPointMultiplier: 1_000 },
      fatMilligrams: { amount: 0, fixedPointMultiplier: 1_000 },
      fiberMilligrams: null,
      proteinMilligrams: null,
      sodiumMilligrams: { amount: 120.5, fixedPointMultiplier: 1 },
      sugarMilligrams: null,
    },
    originalName: "Example cereal",
    provider: "open-food-facts",
    providerFoodId: "0034000470693",
    providerModifiedDate: "2026-08-28T10:15:00Z",
    providerPublishedDate: null,
  };
}

class OpenFoodFactsDouble implements BarcodeFoodCatalogProvider {
  getFoodCalls = 0;
  food = cereal();

  async getFood(): Promise<CatalogFood> {
    this.getFoodCalls += 1;
    return structuredClone(this.food);
  }

  async lookupBarcode(): Promise<CatalogFood> {
    return structuredClone(this.food);
  }
}

function foodEntryService(
  client: ApplicationDatabaseClient,
  provider: BarcodeFoodCatalogProvider,
) {
  return new FoodEntryService(
    client,
    new FoodCatalog([
      {
        capability: "barcode",
        provider: "open-food-facts",
        service: provider,
      },
    ]),
    () => new Date("2026-08-29T18:00:00.000Z"),
  );
}

test("the production adapter refetches reviewed food and saves its available revision", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client);
  const revisedAt = "2026-08-28T10:15:00.000Z";
  const providerResponse = (energyKcal: number, modifiedAt: string) =>
    new Response(
      JSON.stringify({
        product: {
          code: "0034000470693",
          last_modified_t: Date.parse(modifiedAt) / 1_000,
          nutriments: { "energy-kcal_serving": energyKcal },
          product_name: "Example cereal",
        },
        status: "success",
      }),
      { status: 200 },
    );
  const fetchImplementation = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      providerResponse(180, "2026-08-27T10:15:00.000Z"),
    )
    .mockResolvedValueOnce(providerResponse(200, revisedAt));
  const provider = new OpenFoodFactsAdapter({
    baseUrl: "https://example.test",
    contactEmail: "maintainer@example.test",
    fetchImplementation,
  });

  await expect(
    provider.lookupBarcode("0034000470693"),
  ).resolves.toMatchObject({
    nutritionPerAuthoritativeBase: {
      energyMilliKcal: { amount: 180, fixedPointMultiplier: 1_000 },
    },
  });
  const created = await foodEntryService(client, provider).log(
    userId,
    validLogInput(),
  );

  expect(created).toMatchObject({
    energyMilliKcal: 200_000,
    providerModifiedDate: revisedAt,
  });
  expect(fetchImplementation).toHaveBeenCalledTimes(2);
  database.close();
});

function validLogInput() {
  return {
    foodLogDate: "2026-08-29",
    idempotencyKey: "off-valid-entry",
    provider: "open-food-facts",
    providerFoodId: "0034000470693",
    quantity: "1",
    selectedMeasurementId: "serving",
  };
}

test("half an Open Food Facts serving becomes an authoritative local Nutrition Snapshot", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client);
  const provider = new OpenFoodFactsDouble();
  const service = foodEntryService(client, provider);

  const created = await service.log(userId, {
    foodLogDate: "2026-08-29",
    idempotencyKey: "off-half-serving",
    provider: "open-food-facts",
    providerFoodId: "0034000470693",
    quantity: "0.5",
    selectedMeasurementId: "serving",
  });

  expect(created).toMatchObject({
    authoritativeBaseQuantityMicrounits: 1_000_000,
    authoritativeBaseUnit: "serving",
    authoritativeNutrition: provider.food.nutritionPerAuthoritativeBase,
    barcode: "0034000470693",
    carbohydrateMilligrams: 12_062,
    energyMilliKcal: 90_556,
    fatMilligrams: 0,
    fiberMilligrams: null,
    originalName: "Example cereal",
    provider: "open-food-facts",
    providerFoodId: "0034000470693",
    providerModifiedDate: "2026-08-28T10:15:00Z",
    quantityMicrounits: 500_000,
    selectedMeasurementId: "serving",
    selectedMeasurementLabel: "1 serving",
    selectedMeasurementUnit: "serving",
    sodiumMilligrams: 60,
  });
  expect(provider.getFoodCalls).toBe(1);
  database.close();
});

test("Open Food Facts confirmations are idempotent while deliberate repeats remain separate consumption events", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client);
  const provider = new OpenFoodFactsDouble();
  const service = foodEntryService(client, provider);

  const first = await service.log(userId, validLogInput());
  const repeated = await service.log(userId, validLogInput());
  const deliberate = await service.log(userId, {
    ...validLogInput(),
    idempotencyKey: "off-deliberate-repeat",
    quantity: "2",
  });

  expect(repeated.id).toBe(first.id);
  expect(deliberate).toMatchObject({
    energyMilliKcal: 362_222,
    quantityMicrounits: 2_000_000,
  });
  expect(deliberate.id).not.toBe(first.id);
  expect(provider.getFoodCalls).toBe(2);
  expect(client.select().from(foodEntries).all()).toHaveLength(2);
  database.close();
});

test("Open Food Facts confirmation failures leave the Food Log unchanged", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client);
  const provider = new OpenFoodFactsDouble();
  const service = foodEntryService(client, provider);

  await expect(
    service.log(userId + 100, {
      ...validLogInput(),
      idempotencyKey: "off-wrong-user",
    }),
  ).rejects.toBeInstanceOf(InvalidFoodLogDateError);
  await expect(
    service.log(userId, {
      ...validLogInput(),
      foodLogDate: "2026-08-30",
      idempotencyKey: "off-future-date",
    }),
  ).rejects.toBeInstanceOf(FutureFoodLogDateError);
  await expect(
    service.log(userId, {
      ...validLogInput(),
      idempotencyKey: "off-unknown-provider",
      provider: "unknown-provider",
    }),
  ).rejects.toBeInstanceOf(CatalogUnknownProviderError);
  await expect(
    service.log(userId, {
      ...validLogInput(),
      idempotencyKey: "off-invalid-measurement",
      selectedMeasurementId: "package",
    }),
  ).rejects.toBeInstanceOf(CatalogUnsafeMeasurementError);

  provider.food.providerFoodId = "0034000470694";
  await expect(
    service.log(userId, {
      ...validLogInput(),
      idempotencyKey: "off-changed-identity",
    }),
  ).rejects.toBeInstanceOf(CatalogInvalidResponseError);

  provider.food = cereal();
  provider.food.barcode = "0034000470694";
  await expect(
    service.log(userId, {
      ...validLogInput(),
      idempotencyKey: "off-changed-barcode",
    }),
  ).rejects.toBeInstanceOf(CatalogInvalidResponseError);

  const unsafeServingChanges: Array<{
    change(food: CatalogFood): void;
    id: string;
    selectedMeasurementId?: string;
  }> = [
    {
      change: (food) => {
        food.dataType = "Branded";
      },
      id: "data-type",
    },
    {
      change: (food) => {
        food.authoritativeBaseUnit = "g";
        food.measurements[0].unit = "g";
      },
      id: "base-unit",
    },
    {
      change: (food) => {
        food.authoritativeBaseQuantityMicrounits = 2_000_000;
      },
      id: "base-quantity",
    },
    {
      change: (food) => {
        food.measurements[0].id = "package";
      },
      id: "measurement-id",
      selectedMeasurementId: "package",
    },
    {
      change: (food) => {
        food.measurements[0].baseQuantityMicrounits = 2_000_000;
      },
      id: "measurement-quantity",
    },
  ];
  for (const change of unsafeServingChanges) {
    provider.food = cereal();
    change.change(provider.food);
    await expect(
      service.log(userId, {
        ...validLogInput(),
        idempotencyKey: `off-changed-${change.id}`,
        selectedMeasurementId:
          change.selectedMeasurementId ?? "serving",
      }),
    ).rejects.toBeInstanceOf(CatalogUnsafeMeasurementError);
  }

  provider.food = cereal();
  provider.getFood = async () => {
    throw new CatalogFoodNotFoundError();
  };
  await expect(
    service.log(userId, {
      ...validLogInput(),
      idempotencyKey: "off-provider-failure",
    }),
  ).rejects.toBeInstanceOf(CatalogFoodNotFoundError);

  provider.food = cereal();
  provider.food.originalName = null as never;
  provider.getFood = async () => structuredClone(provider.food);
  await expect(
    service.log(userId, {
      ...validLogInput(),
      idempotencyKey: "off-transaction-failure",
    }),
  ).rejects.toThrow();

  expect(client.select().from(foodEntries).all()).toEqual([]);
  database.close();
});

test("an Open Food Facts snapshot stays local and editing recalculates from its saved serving base", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client);
  const provider = new OpenFoodFactsDouble();
  const service = foodEntryService(client, provider);
  const created = await service.log(userId, validLogInput());

  provider.getFood = async () => {
    throw new CatalogFoodNotFoundError();
  };
  const unchanged = service.read(userId, created.id);
  expect(unchanged).toMatchObject({
    energyMilliKcal: 181_111,
    name: "Example cereal",
  });

  const doubled = service.update(userId, created.id, {
    expectedUpdatedAt: unchanged.updatedAt,
    foodLogDate: unchanged.foodLogDate,
    name: "My cereal",
    quantity: "2",
    selectedMeasurementId: "serving",
  });
  const halvedAgain = service.update(userId, created.id, {
    expectedUpdatedAt: doubled.updatedAt,
    foodLogDate: doubled.foodLogDate,
    name: doubled.name,
    quantity: "0.5",
    selectedMeasurementId: "serving",
  });

  expect(doubled).toMatchObject({
    carbohydrateMilligrams: 48_247,
    energyMilliKcal: 362_222,
    name: "My cereal",
  });
  expect(halvedAgain).toMatchObject({
    carbohydrateMilligrams: 12_062,
    energyMilliKcal: 90_556,
    fatMilligrams: 0,
    fiberMilligrams: null,
    name: "My cereal",
  });
  expect(provider.getFoodCalls).toBe(1);
  database.close();
});

test("Open Food Facts public input rejects unusable barcodes before provider work", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client);
  const provider = new OpenFoodFactsDouble();
  const service = foodEntryService(client, provider);

  for (const providerFoodId of ["", "123", "1234567x", "1".repeat(15)]) {
    await expect(
      service.log(userId, {
        ...validLogInput(),
        idempotencyKey: `off-invalid-${providerFoodId.length}`,
        providerFoodId,
      }),
    ).rejects.toBeInstanceOf(InvalidFoodEntryInputError);
  }

  expect(provider.getFoodCalls).toBe(0);
  expect(client.select().from(foodEntries).all()).toEqual([]);
  database.close();
});
