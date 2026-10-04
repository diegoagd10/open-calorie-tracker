import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { TEST_DAILY_GOAL } from "./support/setup";

let directory: string;

beforeEach(async () => {
  vi.resetModules();
  directory = await mkdtemp(path.join(tmpdir(), "daily-goal-runtime-"));
  vi.stubEnv("DATABASE_PATH", path.join(directory, "application.sqlite"));
});

afterEach(async () => {
  const { shutdownApplicationDatabase } = await import("../app/database/runtime.server");
  shutdownApplicationDatabase();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

/** The runtime module and one account to save goals for. */
async function runtime() {
  const database = await import("../app/database/runtime.server");
  const { users } = await import("../app/database/schema.server");
  const userId = database.initializeApplicationDatabase().getClient()
    .insert(users)
    .values({ createdAt: "2026-01-01T00:00:00.000Z", usernameNormalized: "runtime.goal" })
    .returning({ id: users.id })
    .get().id;
  return { ...(await import("../app/daily-goal/runtime.server")), userId };
}

test("an invalid test clock is refused before the service is created", async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("FOOD_LOG_TEST_NOW", "not an instant");
  const { getDailyGoalService } = await runtime();
  expect(() => getDailyGoalService()).toThrow("FOOD_LOG_TEST_NOW must be an ISO date-time");
});

test("the shared service stamps saves with the pinned test clock and is reused", async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("FOOD_LOG_TEST_NOW", "2026-08-31T16:00:00.000Z");
  const { getDailyGoalService, userId } = await runtime();
  const service = getDailyGoalService();
  expect(getDailyGoalService()).toBe(service);
  expect(service.save(userId, TEST_DAILY_GOAL)).toMatchObject({
    createdAt: "2026-08-31T16:00:00.000Z",
    updatedAt: "2026-08-31T16:00:00.000Z",
  });
});

test("outside tests the shared service follows the real clock", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("FOOD_LOG_TEST_NOW", "2000-01-01T00:00:00.000Z");
  const { getDailyGoalService, userId } = await runtime();
  const before = Date.now();
  expect(new Date(getDailyGoalService().save(userId, TEST_DAILY_GOAL).createdAt).getTime())
    .toBeGreaterThanOrEqual(before);
});
