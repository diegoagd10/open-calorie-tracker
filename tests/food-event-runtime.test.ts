import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, test, vi } from "vitest";

let directory: string;

beforeEach(async () => {
  vi.resetModules();
  directory = await mkdtemp(path.join(tmpdir(), "food-event-runtime-"));
  vi.stubEnv("DATABASE_PATH", path.join(directory, "application.sqlite"));
});

afterEach(async () => {
  const { shutdownApplicationDatabase } = await import("../app/database/runtime.server");
  shutdownApplicationDatabase();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

async function runtime() {
  const database = await import("../app/database/runtime.server");
  database.initializeApplicationDatabase();
  return import("../app/food-event/runtime.server");
}

const manual = (logDate: string) => ({
  method: "manual" as const, logDate, name: "Soup", quantity: "1", nutrition: { energyKcal: "90" }, saveAsFavorite: false,
});

test("an invalid test clock is refused before the service is created", async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("FOOD_LOG_TEST_NOW", "not an instant");
  const { getFoodEventService } = await runtime();
  expect(() => getFoodEventService()).toThrow("FOOD_LOG_TEST_NOW must be an ISO date-time");
});

test("the shared service uses the pinned test clock, is reused, and a request reads the same instant", async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("FOOD_LOG_TEST_NOW", "2026-08-31T16:00:00.000Z");
  const { getFoodEventService, requestInstant } = await runtime();
  const service = getFoodEventService();
  expect(getFoodEventService()).toBe(service);
  expect(requestInstant(new Request("http://localhost/")).toISOString()).toBe("2026-08-31T16:00:00.000Z");
  expect(requestInstant(new Request("http://localhost/", { headers: { "X-Test-Food-Log-Now": "2026-08-01T00:00:00Z" } })).toISOString())
    .toBe("2026-08-01T00:00:00.000Z");
});

test("outside tests the shared service follows the real clock", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("FOOD_LOG_TEST_NOW", "2000-01-01T00:00:00.000Z");
  const { getFoodEventService, requestInstant } = await runtime();
  expect(Math.abs(requestInstant(new Request("http://localhost/")).getTime() - Date.now())).toBeLessThan(60_000);
  // Without setup the account cannot log; the real clock means no future-date refusal comes first.
  await expect(getFoodEventService().save(1, manual("2000-01-01T00:00:01Z"))).rejects.toMatchObject({ code: "missing_setup" });
});
