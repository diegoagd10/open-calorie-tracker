import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";

import {
  openApplicationDatabase,
  type ApplicationDatabaseClient,
} from "../app/database/database.server";
import { TestFoodCatalogProvider } from "../app/catalog/test-fixture.server";
import { FoodCatalog } from "../app/catalog/food-catalog.server";
import {
  goalVersions,
  userPreferences,
  users,
  waterEvents,
} from "../app/database/schema.server";
import {
  FoodLogService,
  FutureFoodLogDateError,
  InvalidFoodLogDateError,
} from "../app/food-log/food-log.server";
import { FoodEntryService } from "../app/food-entry/food-entry.server";
import { localDateAt } from "../app/food-log/date";
import {
  InvalidWaterEventInputError,
  StaleWaterEventError,
  WaterEventIdempotencyConflictError,
  WaterEventService,
  WaterEventSetupRequiredError,
  WaterEventUnavailableError,
} from "../app/water-event/water-event.server";

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

test("one mixed preset operation creates one Water Event with a serving breakdown", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "water.mixed.presets");
  const service = new WaterEventService(
    client,
    () => new Date("2026-08-29T18:45:30.000Z"),
  );

  const event = service.create(userId, {
    foodLogDate: "2026-08-29",
    selection: "presets",
    counts: { "8": 1, "16": 2, "24": 0 },
  });
  const log = new FoodLogService(client).read(userId, "2026-08-29");
  if (!log) throw new Error("Expected a food log");

  expect(event).toMatchObject({
    amountMicroliters: 1_182_940,
    preset8Count: 1,
    preset16Count: 2,
    preset24Count: 0,
  });
  expect(log.waterEvents).toHaveLength(1);
  expect(log.waterTotalMicroliters).toBe(1_182_940);
  database.close();
});

test("editing only the time preserves the preset breakdown, while changing the total clears it", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "water.grouped.edit");
  const service = new WaterEventService(
    client,
    () => new Date("2026-08-29T18:45:30.000Z"),
  );
  const event = service.create(userId, {
    foodLogDate: "2026-08-29",
    selection: "presets",
    counts: { "8": 1, "16": 2, "24": 0 },
  });

  const retimed = service.update(userId, event.id, {
    amount: "40",
    expectedUpdatedAt: event.updatedAt,
    foodLogDate: event.foodLogDate,
    localEventTime: "09:15",
    selection: "exact",
  });
  expect(retimed).toMatchObject({
    amountMicroliters: 1_182_940,
    localEventTime: "09:15:00",
    preset8Count: 1,
    preset16Count: 2,
  });

  const changed = service.update(userId, event.id, {
    amount: "41",
    expectedUpdatedAt: retimed.updatedAt,
    foodLogDate: event.foodLogDate,
    localEventTime: "09:15",
    selection: "exact",
  });
  expect(changed).toMatchObject({
    amountMicroliters: 1_212_515,
    preset8Count: 0,
    preset16Count: 0,
    preset24Count: 0,
  });
  database.close();
});

test("preset operations require whole servings within the Exact edit limit", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "water.grouped.bounds");
  const service = new WaterEventService(client);

  for (const counts of [
    { "8": 0, "16": 0, "24": 0 },
    { "8": 0, "16": 0, "24": 21 },
    { "8": 1.5, "16": 0, "24": 0 },
  ]) {
    expect(() => service.create(userId, {
      counts,
      foodLogDate: "2026-08-29",
      selection: "presets",
    })).toThrow(InvalidWaterEventInputError);
  }

  database.close();
});

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

test("update accepts an explicit exact selection", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "water.update.explicit.exact");
  const service = new WaterEventService(
    client,
    () => new Date("2026-08-29T18:45:31.000Z"),
  );
  const event = service.create(userId, {
    foodLogDate: "2026-08-29",
    selection: "8",
  });
  expect(service.update(userId, event.id, {
    amount: "12",
    expectedUpdatedAt: event.updatedAt,
    foodLogDate: event.foodLogDate,
    localEventTime: "09:15",
    selection: "exact",
  }).amountMicroliters).toBe(354_882);
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
  const foodProvider = new TestFoodCatalogProvider();
  const food = new FoodEntryService(
    client,
    new FoodCatalog([
      {
        capability: "search",
        provider: "usda-fdc",
        service: foodProvider,
      },
    ]),
    now,
  );

  const firstWater = water.create(userId, {
    foodLogDate: "2026-08-28",
    selection: "8",
  });
  const nextFood = await food.log(userId, {
    foodLogDate: "2026-08-28",
    idempotencyKey: "mixed-food-event",
    provider: "usda-fdc",
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
  expect(
    new FoodLogService(client, now).read(userId, "2026-08-28")?.events.map(
      (event) => ({ id: event.id, kind: event.kind }),
    ),
  ).toEqual([
    { id: newestWater.id, kind: "water" },
    { id: nextFood.id, kind: "food" },
    { id: firstWater.id, kind: "water" },
  ]);
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

test("Water Event errors preserve their public names and messages", () => {
  expect(new InvalidWaterEventInputError()).toMatchObject({
    message: "Enter a valid bounded water amount.",
    name: "InvalidWaterEventInputError",
  });
  expect(new WaterEventUnavailableError()).toMatchObject({
    message: "Water Event is unavailable",
    name: "WaterEventUnavailableError",
  });
  expect(new StaleWaterEventError()).toMatchObject({
    message:
      "This Water Event changed after you opened it. Review it and try again.",
    name: "StaleWaterEventError",
  });
});

test.each([
  [
    { amount: "8", foodLogDate: "bad-date", selection: "exact" },
    InvalidFoodLogDateError,
  ],
  [
    { amount: "8".repeat(17), foodLogDate: "2026-08-29", selection: "exact" },
    InvalidWaterEventInputError,
  ],
  [
    { foodLogDate: "2026-08-29", selection: "7" },
    InvalidWaterEventInputError,
  ],
  [
    { foodLogDate: "2026-08-29", selection: "" },
    InvalidWaterEventInputError,
  ],
] as const)("malformed Water Event creation is rejected", async (input, ErrorType) => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, `water.create.invalid.${input.selection}`);
  const service = new WaterEventService(
    client,
    () => new Date("2026-08-29T18:45:30.000Z"),
  );

  expect(() => service.create(userId, input as never)).toThrow(ErrorType);
  database.close();
});

test("creation requires configured display preferences", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertUserOnly(client, "water.unconfigured");
  const service = new WaterEventService(
    client,
    () => new Date("2026-08-29T18:45:30.000Z"),
  );

  expect(() =>
    service.create(userId, { foodLogDate: "2026-08-29", selection: "8" }),
  ).toThrow(InvalidFoodLogDateError);
  database.close();
});

test("the default clock can create a Water Event for the current local day", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "water.default.clock");
  const today = localDateAt(new Date(), "America/New_York");

  expect(
    new WaterEventService(client).create(userId, {
      foodLogDate: today,
      selection: "8",
    }),
  ).toMatchObject({ foodLogDate: today });
  database.close();
});

test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])(
  "Water Event id %s is unavailable",
  async (eventId) => {
    const database = await setupDatabase();
    const client = database.getClient();
    const userId = insertConfiguredUser(client, `water.id.${String(eventId)}`);
    expect(() => new WaterEventService(client).read(userId, eventId)).toThrow(
      WaterEventUnavailableError,
    );
    database.close();
  },
);

function insertUserOnly(
  client: ApplicationDatabaseClient,
  username: string,
): number {
  return client
    .insert(users)
    .values({
      createdAt: "2026-01-01T00:00:00.000Z",
      usernameNormalized: username,
    })
    .returning({ id: users.id })
    .get().id;
}

test("update validates its full input and id boundaries", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "water.update.validation");
  const service = new WaterEventService(
    client,
    () => new Date("2026-08-29T18:45:30.000Z"),
  );
  const event = service.create(userId, {
    foodLogDate: "2026-08-29",
    selection: "8",
  });
  const base = {
    amount: "12",
    expectedUpdatedAt: event.updatedAt,
    foodLogDate: event.foodLogDate,
    localEventTime: "09:15",
  };

  for (const change of [
    { localEventTime: "x09:15" },
    { localEventTime: "09:15x" },
    { localEventTime: "24:00" },
    { localEventTime: "09:60" },
    { amount: "1".repeat(33) },
    { selection: "32" },
  ]) {
    expect(() => service.update(userId, event.id, { ...base, ...change } as never))
      .toThrow(InvalidWaterEventInputError);
  }
  for (const eventId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => service.update(userId, eventId, base)).toThrow(
      InvalidWaterEventInputError,
    );
  }
  database.close();
});

test("update enforces date, version, preference, and preset semantics", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "water.update.contract");
  const service = new WaterEventService(
    client,
    () => new Date("2026-08-29T18:45:31.000Z"),
  );
  const event = service.create(userId, {
    foodLogDate: "2026-08-29",
    selection: "8",
  });
  const base = {
    amount: "999",
    expectedUpdatedAt: event.updatedAt,
    foodLogDate: event.foodLogDate,
    localEventTime: "09:15",
    selection: "24" as const,
  };

  expect(() =>
    service.update(userId, event.id, {
      ...base,
      foodLogDate: "2026-08-28",
    }),
  ).toThrow(WaterEventUnavailableError);
  expect(() =>
    service.update(userId, event.id, {
      ...base,
      expectedUpdatedAt: "2026-08-29T18:45:30.001Z",
    }),
  ).toThrow(StaleWaterEventError);
  expect(() =>
    service.update(userId, event.id, {
      ...base,
      expectedUpdatedAt: "2026-08-29T18:45:30.000+00:00",
    }),
  ).toThrow(StaleWaterEventError);
  client.delete(userPreferences).where(eq(userPreferences.userId, userId)).run();
  expect(() => service.update(userId, event.id, base)).toThrow(
    WaterEventUnavailableError,
  );

  client.insert(userPreferences).values({
    createdAt: "2026-01-01T00:00:00.000Z",
    displayUnits: "metric",
    timeZone: "America/New_York",
    updatedAt: "2026-01-01T00:00:00.000Z",
    userId,
  }).run();
  expect(service.update(userId, event.id, base)).toMatchObject({
    amountMicroliters: 709_765,
    localEventTime: "09:15:00",
  });
  database.close();
});

test.each([
  ["8", 236_588],
  ["16", 473_176],
  ["24", 709_765],
] as const)("update accepts the %s fl oz preset", async (selection, amountMicroliters) => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, `water.update.preset.${selection}`);
  const service = new WaterEventService(
    client,
    () => new Date("2026-08-29T18:45:31.000Z"),
  );
  const event = service.create(userId, {
    foodLogDate: "2026-08-29",
    selection: "8",
  });

  expect(service.update(userId, event.id, {
    amount: "999",
    expectedUpdatedAt: event.updatedAt,
    foodLogDate: event.foodLogDate,
    localEventTime: "09:15",
    selection,
  }).amountMicroliters).toBe(amountMicroliters);
  database.close();
});

test("a concurrent Water Event update is reported as stale", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "water.update.race");
  const service = new WaterEventService(
    client,
    () => new Date("2026-08-29T18:45:31.000Z"),
  );
  const event = service.create(userId, {
    foodLogDate: "2026-08-29",
    selection: "8",
  });
  client.run(sql.raw(`CREATE TRIGGER ignore_water_update
    BEFORE UPDATE ON water_events
    WHEN OLD.id = ${event.id}
    BEGIN SELECT RAISE(IGNORE); END`));

  expect(() => service.update(userId, event.id, {
    amount: "12",
    expectedUpdatedAt: event.updatedAt,
    foodLogDate: event.foodLogDate,
    localEventTime: "09:15",
  })).toThrow(StaleWaterEventError);
  database.close();
});

test("delete validates input, ownership date, version, and atomic races", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "water.delete.contract");
  const service = new WaterEventService(
    client,
    () => new Date("2026-08-29T18:45:30.000Z"),
  );
  const event = service.create(userId, {
    foodLogDate: "2026-08-29",
    selection: "8",
  });
  const base = {
    expectedUpdatedAt: event.updatedAt,
    foodLogDate: event.foodLogDate,
  };

  for (const [eventId, input] of [
    [0, base],
    [-1, base],
    [1.5, base],
    [event.id, { ...base, expectedUpdatedAt: "not-an-instant" }],
    [event.id, { ...base, foodLogDate: "not-a-date" }],
  ] as const) {
    expect(() => service.delete(userId, eventId, input)).toThrow(
      InvalidWaterEventInputError,
    );
  }
  expect(() =>
    service.delete(userId, event.id, { ...base, foodLogDate: "2026-08-28" }),
  ).toThrow(WaterEventUnavailableError);
  expect(() =>
    service.delete(userId, event.id, {
      ...base,
      expectedUpdatedAt: "2026-08-29T18:45:30.001Z",
    }),
  ).toThrow(StaleWaterEventError);
  expect(() =>
    service.delete(userId, event.id, {
      ...base,
      expectedUpdatedAt: "2026-08-29T18:45:30.000+00:00",
    }),
  ).toThrow(StaleWaterEventError);

  client.run(sql.raw(`CREATE TRIGGER ignore_water_delete
    BEFORE DELETE ON water_events
    WHEN OLD.id = ${event.id}
    BEGIN SELECT RAISE(IGNORE); END`));
  expect(() => service.delete(userId, event.id, base)).toThrow(
    StaleWaterEventError,
  );
  expect(client.select().from(waterEvents).where(eq(waterEvents.id, event.id)).get())
    .toBeDefined();
  database.close();
});

function waterRows(client: ApplicationDatabaseClient, userId: number) {
  return client.select().from(waterEvents).where(eq(waterEvents.userId, userId)).all();
}

test("a keyed container call creates one Water Event, and a same-key retry replays it", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "water.keyed.replay");
  const service = new WaterEventService(client, () => new Date("2026-08-29T18:45:30.000Z"));
  const counts = { "8": 0, "16": 1, "24": 0 };

  const created = service.createIdempotently(userId, { counts, foodLogDate: "2026-08-29" }, "api:retry-001");
  expect(created).toMatchObject({
    replayed: false,
    event: { amountMicroliters: 473_176, foodLogDate: "2026-08-29", idempotencyKey: "api:retry-001", localEventTime: "14:45:30", preset16Count: 1 },
  });
  expect(service.createIdempotently(userId, { counts, foodLogDate: "2026-08-29" }, "api:retry-001"))
    .toEqual({ event: created.event, replayed: true });
  expect(service.createIdempotently(userId, { counts }, "api:retry-001"))
    .toEqual({ event: created.event, replayed: true });
  expect(waterRows(client, userId)).toHaveLength(1);
  database.close();
});

test("a dateless retry after midnight replays the original on its original day", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "water.keyed.midnight");
  let now = new Date("2026-08-30T03:55:00.000Z");
  const service = new WaterEventService(client, () => now);
  const counts = { "8": 1, "16": 0, "24": 0 };

  const created = service.createIdempotently(userId, { counts }, "mcp:before-midnight");
  expect(created.event).toMatchObject({ foodLogDate: "2026-08-29", localEventTime: "23:55:00" });
  now = new Date("2026-08-30T04:05:00.000Z");
  expect(service.createIdempotently(userId, { counts }, "mcp:before-midnight"))
    .toEqual({ event: created.event, replayed: true });
  expect(() => service.createIdempotently(userId, { counts, foodLogDate: "2026-08-30" }, "mcp:before-midnight"))
    .toThrow(WaterEventIdempotencyConflictError);
  expect(waterRows(client, userId)).toHaveLength(1);
  database.close();
});

test("a reused key with changed counts or a different explicit date is an idempotency conflict", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "water.keyed.conflict");
  const service = new WaterEventService(client, () => new Date("2026-08-29T18:45:30.000Z"));
  service.createIdempotently(userId, { counts: { "8": 2, "16": 0, "24": 0 }, foodLogDate: "2026-08-28" }, "api:conflict-1");

  for (const input of [
    { counts: { "8": 1, "16": 0, "24": 0 }, foodLogDate: "2026-08-28" },
    { counts: { "8": 0, "16": 1, "24": 0 }, foodLogDate: "2026-08-28" },
    { counts: { "8": 2, "16": 0, "24": 0 }, foodLogDate: "2026-08-27" },
    { counts: { "8": 2, "16": 0, "24": 0 }, foodLogDate: "2026-08-29" },
  ]) {
    expect(() => service.createIdempotently(userId, input, "api:conflict-1")).toThrow(WaterEventIdempotencyConflictError);
  }
  expect(waterRows(client, userId)).toHaveLength(1);
  expect(new WaterEventIdempotencyConflictError()).toMatchObject({ name: "WaterEventIdempotencyConflictError" });
  database.close();
});

test("same-key calls racing on separate connections leave exactly one row", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "water.keyed.race");
  const databasePath = client.get<{ file: string }>(sql`SELECT file FROM pragma_database_list WHERE name = 'main'`).file;
  const other = openApplicationDatabase({ databasePath, migrationsFolder: path.resolve("drizzle") });
  const now = () => new Date("2026-08-29T18:45:30.000Z");
  const first = new WaterEventService(client, now);
  const second = new WaterEventService(other.getClient(), now);
  const counts = { "8": 0, "16": 0, "24": 1 };

  const winner = first.createIdempotently(userId, { counts, foodLogDate: "2026-08-29" }, "api:race-key");
  expect(second.createIdempotently(userId, { counts, foodLogDate: "2026-08-29" }, "api:race-key"))
    .toEqual({ event: winner.event, replayed: true });
  expect(() => second.createIdempotently(userId, { counts: { "8": 1, "16": 0, "24": 0 }, foodLogDate: "2026-08-29" }, "api:race-key"))
    .toThrow(WaterEventIdempotencyConflictError);
  expect(waterRows(client, userId)).toHaveLength(1);
  other.close();
  database.close();
});

test("keys belong to one account and one channel", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const first = insertConfiguredUser(client, "water.keyed.first");
  const second = insertConfiguredUser(client, "water.keyed.second");
  const service = new WaterEventService(client, () => new Date("2026-08-29T18:45:30.000Z"));
  const input = { counts: { "8": 1, "16": 0, "24": 0 }, foodLogDate: "2026-08-29" };

  expect(service.createIdempotently(first, input, "api:shared-key").replayed).toBe(false);
  expect(service.createIdempotently(second, input, "api:shared-key").replayed).toBe(false);
  expect(service.createIdempotently(first, input, "mcp:shared-key").replayed).toBe(false);
  expect(waterRows(client, first)).toHaveLength(2);
  expect(waterRows(client, second)).toHaveLength(1);
  database.close();
});

test("keyless web creation is unchanged and stores no key", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "water.keyless");
  const service = new WaterEventService(client, () => new Date("2026-08-29T18:45:30.000Z"));
  const input = { counts: { "8": 1, "16": 0, "24": 0 }, foodLogDate: "2026-08-29", selection: "presets" } as const;

  const first = service.create(userId, input);
  const second = service.create(userId, input);
  expect(first).toMatchObject({ idempotencyKey: null, preset8Count: 1 });
  expect(second.id).not.toBe(first.id);
  expect(waterRows(client, userId).map((row) => row.idempotencyKey)).toEqual([null, null]);
  database.close();
});

test("keyed creation validates counts, dates, keys, and setup before writing", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  const userId = insertConfiguredUser(client, "water.keyed.invalid");
  const unconfigured = client.insert(users).values({ createdAt: "2026-01-01T00:00:00.000Z", usernameNormalized: "water.keyed.unconfigured" })
    .returning({ id: users.id }).get().id;
  const service = new WaterEventService(client, () => new Date("2026-08-29T18:45:30.000Z"));
  const glass = { "8": 1, "16": 0, "24": 0 };

  for (const counts of [{ "8": 0, "16": 0, "24": 0 }, { "8": 0, "16": 0, "24": 21 }, { "8": 1.5, "16": 0, "24": 0 }, { "8": -1, "16": 1, "24": 0 }]) {
    expect(() => service.createIdempotently(userId, { counts }, "api:invalid-counts")).toThrow(InvalidWaterEventInputError);
  }
  expect(() => service.createIdempotently(userId, { counts: glass }, "")).toThrow(InvalidWaterEventInputError);
  expect(() => service.createIdempotently(userId, { counts: glass }, `api:${"k".repeat(125)}`)).toThrow(InvalidWaterEventInputError);
  expect(() => service.createIdempotently(userId, { counts: glass, foodLogDate: "2026-02-30" }, "api:bad-date")).toThrow(InvalidFoodLogDateError);
  expect(() => service.createIdempotently(userId, { counts: glass, foodLogDate: "2026-08-30" }, "api:future-date")).toThrow(FutureFoodLogDateError);
  expect(() => service.createIdempotently(unconfigured, { counts: glass }, "api:no-setup")).toThrow(WaterEventSetupRequiredError);
  expect(waterRows(client, userId)).toHaveLength(0);
  database.close();
});
