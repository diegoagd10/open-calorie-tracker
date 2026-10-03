import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, test, vi } from "vitest";

let directory: string;

beforeEach(async () => {
  vi.resetModules();
  directory = await mkdtemp(path.join(tmpdir(), "water-event-runtime-"));
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
  return import("../app/water-event/runtime.server");
}

test("an invalid test clock is refused before the service is created", async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("FOOD_LOG_TEST_NOW", "not an instant");
  const { getWaterEventService } = await runtime();
  expect(() => getWaterEventService()).toThrow("FOOD_LOG_TEST_NOW must be an ISO date-time");
});

test("the shared service uses the pinned test clock and is reused", async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("FOOD_LOG_TEST_NOW", "2026-08-31T16:00:00.000Z");
  const { getWaterEventService } = await runtime();
  const service = getWaterEventService();
  expect(getWaterEventService()).toBe(service);
  expect(() => service.save(1, { logDate: "2026-08-31T16:05:01Z", quantity: { ounces: "8" } }))
    .toThrow("not in the future");
});

test("outside tests the shared service follows the real clock", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("FOOD_LOG_TEST_NOW", "2000-01-01T00:00:00.000Z");
  const { getWaterEventService } = await runtime();
  expect(() => getWaterEventService().save(1, { logDate: "2000-01-01T00:00:01Z", quantity: { ounces: "8" } }))
    .toThrow(/FOREIGN KEY/u);
});
