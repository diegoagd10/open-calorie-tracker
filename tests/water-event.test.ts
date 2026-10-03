import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, test } from "vitest";

import {
  openApplicationDatabase,
  type ApplicationDatabaseClient,
} from "../app/database/database.server";
import { goalVersions, userPreferences, users } from "../app/database/schema.server";
import { convertLegacyWaterEventLogDates } from "../app/database/water-event-log-dates.server";
import { FoodLogService } from "../app/food-log/food-log.server";
import { WaterEventRepository } from "../app/water-event/water-event.repository.server";
import { waterEvents } from "../app/water-event/water-event.schema.server";
import { WaterEventService } from "../app/water-event/water-event.server";
import {
  formatOunceThousandths,
  formatWaterAmount,
  formatWaterTime,
  ounceThousandths,
  ouncesFromJson,
  presentWaterEvent,
  presentWaterEventDeletion,
  presentWaterEventList,
  sumOunces,
} from "../app/water-event/water-event.utils";
import {
  WaterEventNotFoundError,
  WaterEventValidationError,
} from "../app/water-event/water-events.exceptions";

const NOW = "2026-10-01T12:00:00.000Z";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
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

function insertUser(client: ApplicationDatabaseClient, username: string, timeZone: string | null = "America/New_York"): number {
  const createdAt = "2026-01-01T00:00:00.000Z";
  const userId = client.insert(users).values({ createdAt, usernameNormalized: username }).returning({ id: users.id }).get().id;
  if (timeZone) {
    client.insert(userPreferences).values({ createdAt, displayUnits: "us", timeZone, updatedAt: createdAt, userId }).run();
    client.insert(goalVersions).values({
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
    }).run();
  }
  return userId;
}

async function setup(now = NOW) {
  const database = await setupDatabase();
  const client = database.getClient();
  let clock = new Date(now);
  const tick = () => new Date(clock);
  const service = new WaterEventService(new WaterEventRepository(client, tick), tick);
  return {
    client,
    service,
    setNow: (instant: string) => { clock = new Date(instant); },
    owner: insertUser(client, "water.owner"),
    other: insertUser(client, "water.other"),
  };
}

/** The code of the validation error `action` throws, or undefined when it throws none. */
function validationCode(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof WaterEventValidationError) return error.code;
    throw error;
  }
  return undefined;
}

describe("save", () => {
  test("creates an event at a UTC consumption time with a canonical amount", async () => {
    const { service, owner } = await setup();
    const event = service.save(owner, { logDate: "2026-09-30T14:45:00-04:00", quantity: { ounces: "012.500" } });
    expect(event).toEqual({
      id: event.id,
      userId: owner,
      logDate: "2026-09-30T18:45:00.000Z",
      ounces: "12.5",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  test("repeated creates insert separate events", async () => {
    const { service, owner } = await setup();
    const input = { logDate: "2026-09-30T14:45:00Z", quantity: { ounces: "8" } };
    expect(service.save(owner, input).id).not.toBe(service.save(owner, input).id);
  });

  test("editing changes only the amount and advances updatedAt", async () => {
    const { service, owner, setNow } = await setup();
    const created = service.save(owner, { logDate: "2026-09-30T14:45:00Z", quantity: { ounces: "8" } });
    setNow("2026-10-01T13:00:00.000Z");
    const edited = service.save(owner, { id: created.id, quantity: { ounces: "16.25" } });
    expect(edited).toEqual({ ...created, ounces: "16.25", updatedAt: "2026-10-01T13:00:00.000Z" });
    setNow("2026-10-01T12:30:00.000Z");
    expect(service.save(owner, { id: created.id, quantity: { ounces: "4" } }).updatedAt).toBe("2026-10-01T13:00:00.001Z");
  });

  test("editing a missing or another account's event is not found", async () => {
    const { service, owner, other } = await setup();
    const created = service.save(owner, { logDate: "2026-09-30T14:45:00Z", quantity: { ounces: "8" } });
    expect(() => service.save(other, { id: created.id, quantity: { ounces: "1" } })).toThrow(WaterEventNotFoundError);
    expect(() => service.save(owner, { id: 999_999, quantity: { ounces: "1" } })).toThrow(WaterEventNotFoundError);
    expect(service.read(owner, created.id).ounces).toBe("8");
  });

  test.each(["0", "0.0001", "500.001", "-1", "1e2", "", " 8", "8.", ".5", "1234567"])(
    "rejects the amount %j",
    async (ounces) => {
      const { service, owner } = await setup();
      expect(validationCode(() => service.save(owner, { logDate: "2026-09-30T14:45:00Z", quantity: { ounces } }))).toBe("invalid_amount");
    },
  );

  test("accepts the amount bounds", async () => {
    const { service, owner } = await setup();
    expect(service.save(owner, { logDate: "2026-09-30T14:45:00Z", quantity: { ounces: "0.001" } }).ounces).toBe("0.001");
    expect(service.save(owner, { logDate: "2026-09-30T14:45:00Z", quantity: { ounces: "500.000" } }).ounces).toBe("500");
  });

  test.each(["2026-09-30T14:45:00", "2026-10-01T12:05:00.001Z", "yesterday", ""])(
    "rejects the consumption time %j",
    async (logDate) => {
      const { service, owner } = await setup();
      expect(validationCode(() => service.save(owner, { logDate, quantity: { ounces: "8" } }))).toBe("invalid_log_date");
    },
  );

  test("accepts consumption times up to five minutes ahead of the server clock", async () => {
    const { service, owner } = await setup();
    expect(service.save(owner, { logDate: "2026-10-01T12:05:00Z", quantity: { ounces: "8" } }).logDate)
      .toBe("2026-10-01T12:05:00.000Z");
  });

  test("an edit ignores a consumption time sent with it", async () => {
    const { service, owner } = await setup();
    const created = service.save(owner, { logDate: "2026-09-30T14:45:00Z", quantity: { ounces: "8" } });
    const edited = service.save(owner, { id: created.id, logDate: "2026-09-29T08:00:00Z", quantity: { ounces: "9" } } as never);
    expect(edited).toMatchObject({ logDate: created.logDate, ounces: "9" });
  });

  test("rejects malformed edit shapes", async () => {
    const { service, owner } = await setup();
    const created = service.save(owner, { logDate: "2026-09-30T14:45:00Z", quantity: { ounces: "8" } });
    expect(validationCode(() => service.save(owner, { id: 0, quantity: { ounces: "8" } }))).toBe("invalid_input");
    expect(validationCode(() => service.save(owner, { id: 1.5, quantity: { ounces: "8" } }))).toBe("invalid_input");
    expect(validationCode(() => service.save(owner, { id: created.id, quantity: null } as never))).toBe("invalid_amount");
  });
});

describe("read", () => {
  test("is scoped to the owner", async () => {
    const { service, owner, other } = await setup();
    const created = service.save(owner, { logDate: "2026-09-30T14:45:00Z", quantity: { ounces: "8" } });
    expect(service.read(owner, created.id)).toEqual(created);
    expect(() => service.read(other, created.id)).toThrow(WaterEventNotFoundError);
    expect(() => service.read(owner, -1)).toThrow(WaterEventNotFoundError);
  });
});

describe("list", () => {
  test("returns owned events in [from, to), newest first with id breaking ties, and the exact total", async () => {
    const { service, owner, other } = await setup();
    const at = (logDate: string, ounces: string, userId = owner) => service.save(userId, { logDate, quantity: { ounces } });
    const first = at("2026-09-30T04:00:00Z", "0.1");
    const tieOne = at("2026-09-30T18:45:00Z", "0.2");
    const tieTwo = at("2026-09-30T18:45:00Z", "0.3");
    at("2026-10-01T04:00:00Z", "1");
    at("2026-09-30T03:59:59.999Z", "1");
    at("2026-09-30T12:00:00Z", "100", other);

    const list = service.list(owner, { from: "2026-09-30T00:00:00-04:00", to: "2026-10-01T00:00:00-04:00" });
    expect(list.events.map((event) => event.id)).toEqual([tieTwo.id, tieOne.id, first.id]);
    expect(list.totalOunces).toBe("0.6");
  });

  test("an empty range result totals zero", async () => {
    const { service, owner } = await setup();
    expect(service.list(owner, { from: "2026-09-30T00:00:00Z", to: "2026-09-30T00:00:01Z" })).toEqual({ events: [], totalOunces: "0" });
  });

  test.each([
    { from: "2026-09-30T00:00:00Z", to: "2026-09-30T00:00:00Z" },
    { from: "2026-10-01T00:00:00Z", to: "2026-09-30T00:00:00Z" },
    { from: "2026-09-30T00:00:00", to: "2026-10-01T00:00:00Z" },
    { from: "2026-09-30T00:00:00Z", to: "tomorrow" },
  ])("rejects the range %j", async (range) => {
    const { service, owner } = await setup();
    expect(validationCode(() => service.list(owner, range))).toBe("invalid_range");
  });

  test("migrated rows converted at startup list as the instants they were consumed", async () => {
    const { client, service, owner, other } = await setup();
    const legacy = (userId: number, logDate: string) => client.insert(waterEvents).values({
      userId, logDate, ounces: "8", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    }).returning().get();
    const lateEvening = legacy(owner, "2026-09-30T23:30:00");
    const earlyMorning = legacy(owner, "2026-09-30T00:10:00");
    legacy(owner, "2026-10-01T00:00:00");
    const unconfigured = legacy(insertUser(client, "water.legacy.unconfigured", null), "2026-09-30T12:00:00");
    const modern = service.save(owner, { logDate: "2026-09-30T16:00:00Z", quantity: { ounces: "4" } });
    client.update(userPreferences).set({ timeZone: "Europe/Madrid" }).where(eq(userPreferences.userId, other)).run();
    const madrid = legacy(other, "2026-09-30T23:30:00");

    expect(convertLegacyWaterEventLogDates(client)).toBe(5);
    expect(convertLegacyWaterEventLogDates(client)).toBe(0);
    expect(service.read(owner, lateEvening.id).logDate).toBe("2026-10-01T03:30:00.000Z");
    expect(service.read(other, madrid.id).logDate).toBe("2026-09-30T21:30:00.000Z");
    expect(client.select().from(waterEvents).where(eq(waterEvents.id, unconfigured.id)).get()?.logDate)
      .toBe("2026-09-30T12:00:00.000Z");

    const list = service.list(owner, { from: "2026-09-30T00:00:00-04:00", to: "2026-10-01T00:00:00-04:00" });
    expect(list.events.map((event) => event.id)).toEqual([lateEvening.id, modern.id, earlyMorning.id]);
    expect(list.totalOunces).toBe("20");
  });

  test("an unreadable migrated log date stops the conversion", async () => {
    const { client, owner } = await setup();
    client.insert(waterEvents).values({
      userId: owner, logDate: "2026-02-30T10:00:00", ounces: "8", createdAt: NOW, updatedAt: NOW,
    }).run();
    expect(() => convertLegacyWaterEventLogDates(client)).toThrow("has an unreadable log date");
  });
});


describe("delete", () => {
  test("removes owned, deduplicated IDs and ignores missing and foreign IDs", async () => {
    const { service, owner, other } = await setup();
    const mine = service.save(owner, { logDate: "2026-09-30T14:45:00Z", quantity: { ounces: "8" } });
    const kept = service.save(owner, { logDate: "2026-09-30T15:45:00Z", quantity: { ounces: "8" } });
    const theirs = service.save(other, { logDate: "2026-09-30T14:45:00Z", quantity: { ounces: "8" } });

    expect(service.delete(owner, [mine.id, mine.id, theirs.id, 999_999])).toBe(1);
    expect(service.delete(owner, [mine.id])).toBe(0);
    expect(service.delete(owner, [])).toBe(0);
    expect(service.read(owner, kept.id)).toEqual(kept);
    expect(service.read(other, theirs.id)).toEqual(theirs);
  });

  test.each([[[0]], [[1.5]], [["1"]], [Array.from({ length: 101 }, (_, index) => index + 1)], ["1"]])(
    "rejects the IDs %j",
    async (eventIds) => {
      const { service, owner } = await setup();
      expect(validationCode(() => service.delete(owner, eventIds as number[]))).toBe("invalid_event_ids");
    },
  );
});

describe("day summary", () => {
  test("totals the account's local day of the consumption time", async () => {
    const { service, owner } = await setup();
    service.save(owner, { logDate: "2026-09-30T05:00:00Z", quantity: { ounces: "8" } });
    service.save(owner, { logDate: "2026-10-01T03:00:00Z", quantity: { ounces: "12.5" } });
    service.save(owner, { logDate: "2026-10-01T04:00:00Z", quantity: { ounces: "100" } });
    expect(service.daySummary(owner, "2026-10-01T03:00:00.000Z", "America/New_York")).toEqual({ date: "2026-09-30", totalOunces: "20.5" });
    expect(service.daySummary(owner, "2026-10-01T03:00:00.000Z", "UTC")).toEqual({ date: "2026-10-01", totalOunces: "112.5" });
  });

  test("the account's time zone is unknown before setup", async () => {
    const { client, service, owner } = await setup();
    expect(service.timeZone(owner)).toBe("America/New_York");
    expect(service.timeZone(insertUser(client, "water.unconfigured", null))).toBeNull();
  });
});

describe("Food Log", () => {
  test("lists the selected local day's water events with their local times and total", async () => {
    const { client, service, owner } = await setup();
    const morning = service.save(owner, { logDate: "2026-09-30T13:15:00Z", quantity: { ounces: "8" } });
    const evening = service.save(owner, { logDate: "2026-10-01T01:30:00Z", quantity: { ounces: "16.5" } });
    service.save(owner, { logDate: "2026-10-01T04:30:00Z", quantity: { ounces: "24" } });

    const foodLog = new FoodLogService(client, () => new Date(NOW)).read(owner, "2026-09-30")!;
    expect(foodLog.waterTotalOunces).toBe("24.5");
    expect(foodLog.waterEvents.map((event) => event.id)).toEqual([evening.id, morning.id]);
    expect(foodLog.events.map((event) => [event.kind, event.localEventTime])).toEqual([
      ["water", "21:30:00"],
      ["water", "09:15:00"],
    ]);
  });

  test("a time-zone change moves events to the day they were consumed on the new clock", async () => {
    const { client, service, owner } = await setup();
    service.save(owner, { logDate: "2026-10-01T01:30:00Z", quantity: { ounces: "8" } });
    client.update(userPreferences).set({ timeZone: "UTC" }).where(eq(userPreferences.userId, owner)).run();
    const foodLog = new FoodLogService(client, () => new Date(NOW));
    expect(foodLog.read(owner, "2026-09-30")!.waterTotalOunces).toBe("0");
    expect(foodLog.read(owner, "2026-10-01")!.waterTotalOunces).toBe("8");
  });
});

describe("utilities", () => {
  const event = {
    id: 42,
    userId: 7,
    logDate: "2026-09-30T18:45:00.000Z",
    ounces: "12.5",
    createdAt: "2026-10-01T12:00:00.000Z",
    updatedAt: "2026-10-01T12:00:00.000Z",
  };

  test("present events, lists, and deletions without the owner", () => {
    const presented = {
      id: 42,
      logDate: "2026-09-30T18:45:00.000Z",
      ounces: 12.5,
      createdAt: "2026-10-01T12:00:00.000Z",
      updatedAt: "2026-10-01T12:00:00.000Z",
    };
    expect(presentWaterEvent(event)).toEqual(presented);
    expect(presentWaterEventList({ events: [event], totalOunces: "12.5" })).toEqual({ events: [presented], totalOunces: 12.5 });
    expect(presentWaterEventDeletion(2)).toEqual({ deletedCount: 2 });
  });

  test("format amounts and consumption times for display", () => {
    expect(formatWaterAmount("12.5", "us")).toBe("12.5 fl oz");
    expect(formatWaterAmount("8.125", "us")).toBe("8.125 fl oz");
    expect(formatWaterAmount("8", "metric")).toBe("237 ml");
    expect(formatWaterTime(event.logDate, "America/New_York")).toBe("2:45 PM");
    expect(formatWaterTime("2026-09-30T04:05:00.000Z", "America/New_York")).toBe("12:05 AM");
  });

  test("do exact decimal arithmetic on amounts", () => {
    expect(ounceThousandths("12.5")).toBe(12_500n);
    expect(ounceThousandths("12.50a")).toBeNull();
    expect(formatOunceThousandths(12_500n)).toBe("12.5");
    expect(formatOunceThousandths(0n)).toBe("0");
    expect(sumOunces(["0.1", "0.2", "8"])).toBe("8.3");
    expect(sumOunces([])).toBe("0");
    expect([12.5, 0.001, 500, 0.1].map(ouncesFromJson)).toEqual(["12.5", "0.001", "500", "0.1"]);
    expect(["12.5", Number.NaN, Number.POSITIVE_INFINITY, null].map(ouncesFromJson)).toEqual(["", "", "", ""]);
    expect(sumOunces(["not stored by the service", "1"])).toBe("1");
  });

});
