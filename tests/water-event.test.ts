import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";

import {
  openApplicationDatabase,
  type ApplicationDatabaseClient,
} from "../app/database/database.server";
import { TestFoodCatalogProvider } from "../app/catalog/test-fixture.server";
import {
  goalVersions,
  userPreferences,
  users,
} from "../app/database/schema.server";
import { FoodLogService } from "../app/food-log/food-log.server";
import { FoodEntryService } from "../app/food-entry/food-entry.server";
import { WaterEventService } from "../app/water-event/water-event.server";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function setupDatabase() {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-water-event-"));
  temporaryDirectories.push(directory);
  return openApplicationDatabase({
    databasePath: path.join(directory, "application.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });
}

function insertConfiguredUser(
  client: ApplicationDatabaseClient,
  username: string,
  displayUnits: "metric" | "us" = "us",
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
      displayUnits,
      timeZone: "America/New_York",
      updatedAt: createdAt,
      userId,
    })
    .run();
  client
    .insert(goalVersions)
    .values({
      calorieTargetMilliKcal: 2_050_000,
      carbohydrateTargetMilligrams: 230_000,
      createdAt,
      effectiveDate: "2026-01-01",
      fatTargetMilligrams: 70_000,
      fiberTargetMilligrams: 25_000,
      proteinTargetMilligrams: 120_000,
      sodiumMaximumMilligrams: 2_300,
      sugarMaximumMilligrams: 50_000,
      userId,
      waterTargetMicroliters: 2_365_882,
    })
    .run();

  return userId;
}

test("an exact US amount creates today's canonical Water Event", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "water.owner");
  const service = new WaterEventService(
    client,
    () => new Date("2026-08-29T18:45:30.000Z"),
  );

  expect(
    service.create(userId, {
      amount: "12.5",
      foodLogDate: "2026-08-29",
      selection: "exact",
    }),
  ).toMatchObject({
    amountMicroliters: 369_669,
    createdAt: "2026-08-29T18:45:30.000Z",
    foodLogDate: "2026-08-29",
    localEventTime: "14:45:30",
    userId,
  });

  database.close();
});

test.each([
  ["us", "8", 236_588],
  ["us", "16", 473_176],
  ["us", "24", 709_765],
  ["metric", "8", 236_588],
  ["metric", "16", 473_176],
  ["metric", "24", 709_765],
] as const)(
  "%s display preserves the canonical %s fl oz preset",
  async (displayUnits, selection, amountMicroliters) => {
    const database = await setupDatabase();
    const client = database.getClient();
    const userId = insertConfiguredUser(
      client,
      `water.${displayUnits}.${selection}`,
      displayUnits,
    );
    const service = new WaterEventService(
      client,
      () => new Date("2026-08-29T18:45:30.000Z"),
    );

    expect(
      service.create(userId, { foodLogDate: "2026-08-29", selection }),
    ).toMatchObject({ amountMicroliters });

    database.close();
  },
);

test("retroactive Water Events start at noon and advance newest-first", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "water.retroactive");
  const service = new WaterEventService(
    client,
    () => new Date("2026-08-29T18:45:30.000Z"),
  );

  const first = service.create(userId, {
    amount: "12",
    foodLogDate: "2026-08-28",
    selection: "exact",
  });
  const second = service.create(userId, {
    foodLogDate: "2026-08-28",
    selection: "8",
  });

  expect([first.localEventTime, second.localEventTime]).toEqual([
    "12:00:00",
    "12:01:00",
  ]);
  database.close();
});

test("Water Event reads stay scoped to the authenticated owner", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const ownerId = insertConfiguredUser(client, "water.read.owner");
  const otherId = insertConfiguredUser(client, "water.read.other");
  const service = new WaterEventService(
    client,
    () => new Date("2026-08-29T18:45:30.000Z"),
  );
  const event = service.create(ownerId, {
    foodLogDate: "2026-08-29",
    selection: "16",
  });

  expect(service.read(ownerId, event.id)).toMatchObject({ id: event.id });
  expect(() => service.read(otherId, event.id)).toThrow(
    "Water Event is unavailable",
  );
  expect(() =>
    service.update(otherId, event.id, {
      amount: "20",
      expectedUpdatedAt: event.updatedAt,
      foodLogDate: event.foodLogDate,
      localEventTime: "09:15",
    }),
  ).toThrow("Water Event is unavailable");
  database.close();
});

test("editing a Water Event changes amount and time without moving its date", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "water.edit.owner");
  const service = new WaterEventService(
    client,
    () => new Date("2026-08-29T18:45:30.000Z"),
  );
  const event = service.create(userId, {
    foodLogDate: "2026-08-28",
    selection: "8",
  });

  const updated = service.update(userId, event.id, {
    amount: "20",
    expectedUpdatedAt: event.updatedAt,
    foodLogDate: event.foodLogDate,
    localEventTime: "09:15",
  });

  expect(updated).toMatchObject({
    amountMicroliters: 591_471,
    createdAt: event.createdAt,
    foodLogDate: "2026-08-28",
    localEventTime: "09:15:00",
  });
  database.close();
});

test("deleting one Water Event is owner-scoped and leaves other events", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const ownerId = insertConfiguredUser(client, "water.delete.owner");
  const otherId = insertConfiguredUser(client, "water.delete.other");
  const service = new WaterEventService(
    client,
    () => new Date("2026-08-29T18:45:30.000Z"),
  );
  const deletedEvent = service.create(ownerId, {
    foodLogDate: "2026-08-29",
    selection: "8",
  });
  const retainedEvent = service.create(ownerId, {
    foodLogDate: "2026-08-29",
    selection: "16",
  });

  expect(() =>
    service.delete(otherId, deletedEvent.id, {
      expectedUpdatedAt: deletedEvent.updatedAt,
      foodLogDate: deletedEvent.foodLogDate,
    }),
  ).toThrow("Water Event is unavailable");
  expect(
    service.delete(ownerId, deletedEvent.id, {
      expectedUpdatedAt: deletedEvent.updatedAt,
      foodLogDate: deletedEvent.foodLogDate,
    }),
  ).toEqual({ foodLogDate: "2026-08-29" });
  expect(service.read(ownerId, retainedEvent.id)).toMatchObject({
    id: retainedEvent.id,
  });
  database.close();
});

test("a Food Log lists private Water Events newest first with its historical goal", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const ownerId = insertConfiguredUser(client, "water.log.owner");
  const otherId = insertConfiguredUser(client, "water.log.other");
  client
    .insert(goalVersions)
    .values({
      calorieTargetMilliKcal: 2_100_000,
      carbohydrateTargetMilligrams: 240_000,
      createdAt: "2026-08-29T00:00:00.000Z",
      effectiveDate: "2026-08-29",
      fatTargetMilligrams: 75_000,
      fiberTargetMilligrams: 30_000,
      proteinTargetMilligrams: 125_000,
      sodiumMaximumMilligrams: 2_200,
      sugarMaximumMilligrams: 55_000,
      userId: ownerId,
      waterTargetMicroliters: 2_957_353,
    })
    .run();
  const water = new WaterEventService(
    client,
    () => new Date("2026-08-29T18:45:30.000Z"),
  );
  const first = water.create(ownerId, {
    foodLogDate: "2026-08-28",
    selection: "8",
  });
  const second = water.create(ownerId, {
    foodLogDate: "2026-08-28",
    selection: "16",
  });
  water.create(otherId, {
    foodLogDate: "2026-08-28",
    selection: "24",
  });

  expect(
    new FoodLogService(client, () =>
      new Date("2026-08-29T18:45:30.000Z"),
    ).read(ownerId, "2026-08-28"),
  ).toMatchObject({
    goal: {
      effectiveDate: "2026-01-01",
      waterTargetMicroliters: 2_365_882,
    },
    waterEvents: [{ id: second.id }, { id: first.id }],
    waterTotalMicroliters: 709_764,
  });
  database.close();
});

test("retroactive food and water actions share one newest-first clock", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "water.mixed.order");
  const now = () => new Date("2026-08-29T18:45:30.000Z");
  const water = new WaterEventService(client, now);
  const food = new FoodEntryService(client, new TestFoodCatalogProvider(), now);

  const firstWater = water.create(userId, {
    foodLogDate: "2026-08-28",
    selection: "8",
  });
  const nextFood = await food.log(userId, {
    foodLogDate: "2026-08-28",
    idempotencyKey: "mixed-food-event",
    providerFoodId: "1001",
    quantity: "1",
    selectedMeasurementId: "serving:g:170000000",
  });
  const newestWater = water.create(userId, {
    foodLogDate: "2026-08-28",
    selection: "16",
  });

  expect([
    firstWater.localEventTime,
    nextFood.localEventTime,
    newestWater.localEventTime,
  ]).toEqual(["12:00:00", "12:01:00", "12:02:00"]);
  database.close();
});

test("metric exact amounts retain microliter precision", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "water.metric.exact", "metric");
  const event = new WaterEventService(
    client,
    () => new Date("2026-08-29T18:45:30.000Z"),
  ).create(userId, {
    amount: "500.125",
    foodLogDate: "2026-08-29",
    selection: "exact",
  });

  expect(event.amountMicroliters).toBe(500_125);
  database.close();
});

test("future, zero, and out-of-range exact Water Events are rejected", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "water.invalid");
  const service = new WaterEventService(
    client,
    () => new Date("2026-08-29T18:45:30.000Z"),
  );

  expect(() =>
    service.create(userId, {
      amount: "8",
      foodLogDate: "2026-08-30",
      selection: "exact",
    }),
  ).toThrow("Future Food Logs cannot be changed");
  for (const amount of ["0", "500.001", "not-water"]) {
    expect(() =>
      service.create(userId, {
        amount,
        foodLogDate: "2026-08-29",
        selection: "exact",
      }),
    ).toThrow("Enter a valid bounded water amount");
  }
  database.close();
});

test.each([
  ["2026-03-08T07:30:00.000Z", "2026-03-08", "03:30:00"],
  ["2026-11-01T06:30:00.000Z", "2026-11-01", "01:30:00"],
] as const)(
  "today's Water Event follows local time across DST at %s",
  async (instant, foodLogDate, localEventTime) => {
    const database = await setupDatabase();
    const client = database.getClient();
    const userId = insertConfiguredUser(client, `water.dst.${foodLogDate}`);

    expect(
      new WaterEventService(client, () => new Date(instant)).create(userId, {
        foodLogDate,
        selection: "8",
      }),
    ).toMatchObject({ foodLogDate, localEventTime });
    database.close();
  },
);

test("a time-zone change never moves a historical Water Event", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "water.travel");
  const event = new WaterEventService(
    client,
    () => new Date("2026-08-29T18:45:30.000Z"),
  ).create(userId, {
    foodLogDate: "2026-08-28",
    selection: "8",
  });
  client
    .update(userPreferences)
    .set({ timeZone: "Pacific/Honolulu" })
    .where(eq(userPreferences.userId, userId))
    .run();

  expect(new WaterEventService(client).read(userId, event.id)).toMatchObject({
    foodLogDate: "2026-08-28",
  });
  database.close();
});
