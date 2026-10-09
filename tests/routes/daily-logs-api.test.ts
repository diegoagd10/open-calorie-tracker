import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import { shutdownCredentialStorage } from "../../app/credentials/runtime.server";
import { getApplicationDatabase, initializeApplicationDatabase, shutdownApplicationDatabase } from "../../app/database/runtime.server";
import { getFoodEventService } from "../../app/food-event/runtime.server";
import { loader as readDailyLog } from "../../app/routes/api.v1.daily-log";
import { action as mutateDailyLogs, loader as readDailyLogs } from "../../app/routes/api.v1.daily-logs";
import { action as keysAction, loader as keysLoader } from "../../app/routes/settings.api-keys";
import { action as copyAction } from "../../app/routes/settings.api-keys.copy";
import { getWaterEventService } from "../../app/water-event/runtime.server";
import { completeTestSetup } from "../support/setup";
import { seedAuthenticatedAccount } from "../support/authentication";

const origin = "http://localhost:3000";
type Account = { id: number; cookie: string; csrf: string };
type DayBody = { selectedDate: string; isFuture: boolean; foodEvents: Array<Record<string, unknown>> } & Record<string, unknown>;
let directory: string;
let reader: Account;
let readerKey: string;
let ipCounter = 0;

function args(request: Request) {
  return { request, params: {}, context: new RouterContextProvider(), pattern: new URL(request.url).pathname, url: new URL(request.url) };
}
/** Each request comes from its own client IP so failure limits do not leak between tests. */
function freshIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}
function get(route: (routeArgs: ReturnType<typeof args>) => Response, url: string, authorization: string | null) {
  const headers = new Headers({ "X-Open-Calory-Client-IP": freshIp() });
  if (authorization !== null) headers.set("Authorization", authorization);
  return route(args(new Request(`${origin}${url}`, { headers })));
}
function readRange(key: string | null, query: string) {
  return get(readDailyLogs, `/api/v1/daily-logs?${query}`, key === null ? null : `Bearer ${key}`);
}
async function account(username: string): Promise<Account> {
  const session = await seedAuthenticatedAccount(getAuthenticationService(), getApplicationDatabase().getClient(), username, "correct horse battery staple", "203.0.113.10");
  return { id: session.user.id, cookie: serializeSessionCookie(session).split(";", 1)[0], csrf: session.csrfToken };
}
async function createKey(owner: Account, name: string): Promise<{ id: number; key: string }> {
  const request = (url: string, fields: Record<string, string>) => new Request(`${origin}${url}`, {
    method: "POST",
    headers: { Cookie: owner.cookie, Origin: origin },
    body: new URLSearchParams({ csrfToken: owner.csrf, ...fields }),
  });
  await keysAction(args(request("/settings/api-keys", { intent: "create", name, scope: "daily-log:read", expiration: "90d" })));
  const listed = (await keysLoader(args(new Request(`${origin}/settings/api-keys`, { headers: { Cookie: owner.cookie } })))).keys.find((entry) => entry.name === name);
  if (!listed) throw new Error(`No key named ${name}`);
  const copied = await copyAction(args(request("/settings/api-keys/copy", { keyId: String(listed.id) })));
  return { id: listed.id, key: ((await copied.json()) as { key: string }).key };
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "daily-logs-api-"));
  vi.stubEnv("APPLICATION_URL", origin);
  vi.stubEnv("DATABASE_PATH", path.join(directory, "application.sqlite"));
  vi.stubEnv("APPLICATION_SECRETS_PATH", path.join(directory, "secrets"));
  vi.stubEnv("FOOD_LOG_TEST_NOW", "2026-08-31T16:00:00.000Z");
  vi.stubEnv("SETUP_TEST_NOW", "2026-08-31T16:00:00.000Z");
  initializeApplicationDatabase();
  const owner = await getAuthenticationService().register("range.admin", "correct horse battery staple", "203.0.113.9");
  if (!owner.ok) throw new Error("Could not register owner");
  reader = await account("range.reader");
  completeTestSetup(reader.id);
  const now = new Date("2026-08-31T16:00:00.000Z");
  // 03:30 UTC on August 28 is 23:30 on August 27 in New York.
  await getFoodEventService(now).save(reader.id, {
    method: "manual", logDate: "2026-08-28T03:30:00.000Z", name: "Late oatmeal", quantity: "1", saveAsFavorite: false,
    nutrition: { energyKcal: "350", proteinGrams: "12" },
  });
  await getFoodEventService(now).save(reader.id, {
    method: "manual", logDate: "2026-08-30T12:05:00.000Z", name: "Toast", quantity: "1", saveAsFavorite: false,
    nutrition: { energyKcal: "101", proteinGrams: "3" },
  });
  getWaterEventService(now).save(reader.id, { logDate: "2026-08-29T15:00:00Z", quantity: { ounces: "8.125" } });
  getWaterEventService(now).save(reader.id, { logDate: "2026-08-30T15:00:00Z", quantity: { ounces: "16" } });
  readerKey = (await createKey(reader, "Range")).key;
});
afterAll(async () => {
  shutdownCredentialStorage();
  shutdownApplicationDatabase();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

test("a range returns every date with the single-day detail, each food's local time, and range totals and averages", async () => {
  const response = readRange(readerKey, "startDate=2026-08-27&endDate=2026-09-01");
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  const body = await response.json() as Record<string, unknown> & { days: DayBody[] };
  expect(Object.keys(body).sort()).toEqual([
    "averages", "days", "endDate", "nutritionTotals", "startDate", "timeZone", "today", "version", "waterTotalOunces",
  ].sort());
  expect(body).toMatchObject({
    version: "1",
    startDate: "2026-08-27",
    endDate: "2026-09-01",
    today: "2026-08-31",
    timeZone: "America/New_York",
    waterTotalOunces: 24.125,
    nutritionTotals: {
      energyMilliKcal: { known: 451_000, isIncomplete: false },
      proteinMilligrams: { known: 15_000, isIncomplete: false },
      sodiumMilligrams: { known: 0, isIncomplete: true },
    },
    averages: {
      foodDayCount: 2,
      waterDayCount: 2,
      nutrition: { energyMilliKcal: 225_500, proteinMilligrams: 7_500, sodiumMilligrams: 0 },
      // 24.125 fl oz over two days.
      waterOunces: 12.063,
    },
  });
  expect(body.days.map((day) => [day.selectedDate, day.isFuture])).toEqual([
    ["2026-08-27", false], ["2026-08-28", false], ["2026-08-29", false],
    ["2026-08-30", false], ["2026-08-31", false], ["2026-09-01", true],
  ]);
  expect(body.days[0].foodEvents.map((event) => [event.name, event.localTime])).toEqual([["Late oatmeal", "23:30"]]);
  expect(body.days[3].foodEvents.map((event) => [event.name, event.localTime])).toEqual([["Toast", "08:05"]]);

  for (const day of body.days) {
    const { version, ...single } = await get(readDailyLog, `/api/v1/daily-log?date=${day.selectedDate}`, `Bearer ${readerKey}`).json() as DayBody;
    expect(version).toBe("2");
    expect(day).toEqual({
      ...single,
      foodEvents: single.foodEvents.map((event, index) => ({ ...event, localTime: day.foodEvents[index].localTime })),
    });
  }
});

test("invalid, reversed, repeated, and longer than 92-day ranges are rejected", async () => {
  expect(readRange(readerKey, "startDate=2026-06-01&endDate=2026-08-31").status).toBe(200);
  for (const query of [
    "startDate=2026-06-01&endDate=2026-09-01",
    "startDate=2026-08-31&endDate=2026-08-30",
    "startDate=2026-02-30&endDate=2026-03-01",
    "startDate=2026-08-01",
    "endDate=2026-08-01",
    "",
    "startDate=2026-08-01&startDate=2026-08-02&endDate=2026-08-03",
    "startDate=2026-08-01&endDate=2026-08-03&endDate=2026-08-04",
  ]) {
    const response = readRange(readerKey, query);
    expect(response.status, query).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_date_range" });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  }
});

test("a range needs a valid key with the Food Log scope and a finished setup, and is read-only", async () => {
  const query = "startDate=2026-08-30&endDate=2026-08-31";
  const anonymous = readRange(null, query);
  expect(anonymous.status).toBe(401);
  expect(await anonymous.json()).toEqual({ error: "invalid_token" });

  const unscoped = await createKey(reader, "Unscoped");
  getApplicationDatabase().getClient().run(sql`UPDATE api_keys SET scopes = '["other:read"]' WHERE id = ${unscoped.id}`);
  const forbidden = readRange(unscoped.key, query);
  expect(forbidden.status).toBe(403);
  expect(forbidden.headers.get("WWW-Authenticate")).toContain('realm="daily-logs", error="insufficient_scope", scope="daily-log:read"');

  const incomplete = await account("range.incomplete");
  const missingSetup = readRange((await createKey(incomplete, "Incomplete")).key, query);
  expect(missingSetup.status).toBe(409);
  expect(await missingSetup.json()).toEqual({ error: "missing_setup" });

  const write = mutateDailyLogs();
  expect(write.status).toBe(405);
  expect(await write.json()).toEqual({ error: "method_not_allowed" });
});
