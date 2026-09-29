import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import { shutdownCredentialStorage } from "../../app/credentials/runtime.server";
import { getApplicationDatabase, initializeApplicationDatabase, shutdownApplicationDatabase } from "../../app/database/runtime.server";
import { getFoodEntryService } from "../../app/food-entry/runtime.server";
import { loader as readDailyLog } from "../../app/routes/api.v1.daily-log";
import { action as writeFoodEntries, loader as readFoodEntries } from "../../app/routes/api.v1.food-entries";
import { action as mcpAction } from "../../app/routes/mcp";
import { action as keysAction, loader as keysLoader } from "../../app/routes/settings.api-keys";
import { action as copyAction } from "../../app/routes/settings.api-keys.copy";
import { getGoalSetupService } from "../../app/setup/runtime.server";
import { validateSetupFields } from "../../app/setup/validation";
import { seedAuthenticatedAccount } from "../support/authentication";

const origin = "http://localhost:3000";
const today = "2026-08-31";
const yesterday = "2026-08-30";
type Account = { id: number; cookie: string; csrf: string };
type LoggedBody = { version: string; foodEntry: Record<string, unknown>; replayed: boolean };
let directory: string;
let eater: Account;
let eaterKey: string;
let egg: number;
let toast: number;
let ipCounter = 0;
let savedFoodCounter = 0;

function args(request: Request, pattern = "/api/v1/food-entries") {
  return { request, params: {}, context: new RouterContextProvider(), pattern, url: new URL(request.url) };
}
/** Each request comes from its own client IP so failure limits do not leak between tests. */
function freshIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}
function apiHeaders(authorization: string | null, idempotencyKey: string | null = null) {
  const headers = new Headers({ "X-Open-Calory-Client-IP": freshIp(), "Content-Type": "application/json" });
  if (authorization !== null) headers.set("Authorization", authorization);
  if (idempotencyKey !== null) headers.set("Idempotency-Key", idempotencyKey);
  return headers;
}
async function apiPost(authorization: string | null, idempotencyKey: string | null, body: unknown, method = "POST") {
  const request = new Request(`${origin}/api/v1/food-entries`, {
    method, headers: apiHeaders(authorization, idempotencyKey), body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return await writeFoodEntries(args(request));
}
/** Calls `log_saved_food` through the `/mcp` route with the same kind of key. */
async function mcpLogSavedFood(key: string, toolArguments: Record<string, unknown>) {
  const headers = apiHeaders(`Bearer ${key}`);
  headers.set("Accept", "application/json, text/event-stream");
  const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "log_saved_food", arguments: toolArguments } };
  const response = await mcpAction(args(new Request(`${origin}/mcp`, { method: "POST", headers, body: JSON.stringify(body) }), "/mcp"));
  const { result } = await response.json() as { result: { isError?: boolean; structuredContent: { foodEntry: { id: number } } } };
  expect(result.isError).toBeUndefined();
  return result.structuredContent.foodEntry;
}
async function dailyLogFoods(key: string, date: string) {
  const request = new Request(`${origin}/api/v1/daily-log?date=${date}`, { headers: apiHeaders(`Bearer ${key}`) });
  const response = readDailyLog(args(request, "/api/v1/daily-log"));
  return ((await response.json()) as { foodEntries: Record<string, unknown>[] }).foodEntries;
}
async function account(username: string): Promise<Account> {
  const session = await seedAuthenticatedAccount(getAuthenticationService(), getApplicationDatabase().getClient(), username, "correct horse battery staple", "203.0.113.10");
  return { id: session.user.id, cookie: serializeSessionCookie(session).split(";", 1)[0], csrf: session.csrfToken };
}
function completeSetup(userId: number) {
  const setup = validateSetupFields({
    calories: "2050", carbohydrate: "230", displayUnits: "metric", fat: "70", fiber: "25",
    protein: "120", sodium: "2300", sugar: "50", timeZone: "America/New_York", water: "2000",
  });
  if (!setup.success) throw new Error("Invalid test setup");
  getGoalSetupService().completeInitial(userId, setup.data);
}
async function createKey(owner: Account, name: string, scopes: readonly string[]): Promise<string> {
  const request = (url: string, fields: [string, string][]) => new Request(`${origin}${url}`, {
    method: "POST",
    headers: { Cookie: owner.cookie, Origin: origin },
    body: new URLSearchParams([["csrfToken", owner.csrf], ...fields]),
  });
  await keysAction(args(request("/settings/api-keys", [["intent", "create"], ["name", name], ["expiration", "90d"], ...scopes.map((scope): [string, string] => ["scope", scope])])));
  const listed = (await keysLoader(args(new Request(`${origin}/settings/api-keys`, { headers: { Cookie: owner.cookie } })))).keys.find((entry) => entry.name === name);
  if (!listed) throw new Error(`No key named ${name}`);
  const copied = await copyAction(args(request("/settings/api-keys/copy", [["keyId", String(listed.id)]])));
  return ((await copied.json()) as { key: string }).key;
}
function saveFood(userId: number, name: string, nutrients: { energyKcal: number; proteinGrams?: number; sodiumMilligrams?: number }) {
  savedFoodCounter += 1;
  return getFoodEntryService().createSavedFood(userId, { name, ...nutrients, idempotencyKey: `api:entries-saved-${savedFoodCounter}` }).savedFood.id;
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "api-key-food-entries-route-"));
  vi.stubEnv("APPLICATION_URL", origin);
  vi.stubEnv("DATABASE_PATH", path.join(directory, "application.sqlite"));
  vi.stubEnv("APPLICATION_SECRETS_PATH", path.join(directory, "secrets"));
  vi.stubEnv("FOOD_LOG_TEST_NOW", "2026-08-31T16:00:00.000Z");
  vi.stubEnv("SETUP_TEST_NOW", "2026-08-31T16:00:00.000Z");
  initializeApplicationDatabase();
  const owner = await getAuthenticationService().register("entries.admin", "correct horse battery staple", "203.0.113.9");
  if (!owner.ok) throw new Error("Could not register owner");
  eater = await account("entries.eater");
  completeSetup(eater.id);
  egg = saveFood(eater.id, "Huevo (1 grande)", { energyKcal: 78, proteinGrams: 6.3, sodiumMilligrams: 62 });
  toast = saveFood(eater.id, "Pan tostado", { energyKcal: 80 });
  eaterKey = await createKey(eater, "Eater", ["daily-log:read", "food-log:write"]);
});
afterAll(async () => {
  shutdownCredentialStorage();
  shutdownApplicationDatabase();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

test("a Log foods key logs servings of a Saved Food as a Food Entry that the daily log then shows", async () => {
  const created = await apiPost(`Bearer ${eaterKey}`, "rest-entry-0001", { source: "saved-food", foodLogDate: today, savedFoodId: egg, quantity: 1.5 });
  expect(created.status).toBe(201);
  expect(created.headers.get("Cache-Control")).toContain("no-store");
  expect(created.headers.get("Referrer-Policy")).toBe("no-referrer");
  const body = await created.json() as LoggedBody;
  expect(body.version).toBe("1");
  expect(body.replayed).toBe(false);
  expect(body.foodEntry).toMatchObject({
    foodLogDate: today, name: "Huevo (1 grande)", quantityMicrounits: 1_500_000,
    energyMilliKcal: 117_000, proteinMilligrams: 9_450, sodiumMilligrams: 93, fatMilligrams: null,
  });
  expect(body).not.toHaveProperty("dailyLog");
  expect(await dailyLogFoods(eaterKey, today)).toContainEqual(body.foodEntry);
});

test("the quantity defaults to one serving and a past day can be logged", async () => {
  const created = await apiPost(`Bearer ${eaterKey}`, "rest-entry-0002", { source: "saved-food", foodLogDate: yesterday, savedFoodId: toast });
  expect(created.status).toBe(201);
  const { foodEntry } = await created.json() as LoggedBody;
  expect(foodEntry).toMatchObject({ foodLogDate: yesterday, name: "Pan tostado", quantityMicrounits: 1_000_000, energyMilliKcal: 80_000 });
  expect(await dailyLogFoods(eaterKey, yesterday)).toEqual([foodEntry]);
});

test("a retry with the same Idempotency-Key and data is 200 with the original, and a changed Saved Food, quantity, or date is 409", async () => {
  const request = { source: "saved-food", foodLogDate: today, savedFoodId: egg, quantity: 2 };
  const original = await (await apiPost(`Bearer ${eaterKey}`, "rest-retry-0001", request)).json() as LoggedBody;
  const replay = await apiPost(`Bearer ${eaterKey}`, "rest-retry-0001", request);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual({ ...original, replayed: true });

  for (const changed of [{ savedFoodId: toast }, { quantity: 3 }, { quantity: undefined }, { foodLogDate: yesterday }]) {
    const conflict = await apiPost(`Bearer ${eaterKey}`, "rest-retry-0001", { ...request, ...changed });
    expect(conflict.status, JSON.stringify(changed)).toBe(409);
    expect(await conflict.json()).toEqual({ error: "idempotency_conflict" });
  }
  expect((await dailyLogFoods(eaterKey, today)).filter((entry) => entry.id === original.foodEntry.id)).toHaveLength(1);
});

test("the same key through MCP and REST logs two separate Food Entries", async () => {
  const viaMcp = await mcpLogSavedFood(eaterKey, { savedFoodId: toast, date: today, idempotencyKey: "shared-entry-0001" });
  const viaRest = await apiPost(`Bearer ${eaterKey}`, "shared-entry-0001", { source: "saved-food", foodLogDate: today, savedFoodId: toast });
  expect(viaRest.status).toBe(201);
  const { foodEntry } = await viaRest.json() as LoggedBody;
  expect(foodEntry.id).not.toBe(viaMcp.id);
  const ids = (await dailyLogFoods(eaterKey, today)).map((entry) => entry.id);
  expect(ids).toEqual(expect.arrayContaining([viaMcp.id, foodEntry.id]));
});

test("unknown or foreign Saved Foods are 404, and bad or future dates are 400", async () => {
  const stranger = await account("entries.stranger");
  completeSetup(stranger.id);
  const foreign = saveFood(stranger.id, "Secret", { energyKcal: 10 });
  for (const savedFoodId of [foreign, 999_999]) {
    const response = await apiPost(`Bearer ${eaterKey}`, `rest-missing-${savedFoodId}`, { source: "saved-food", foodLogDate: today, savedFoodId });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "saved_food_not_found" });
  }
  for (const foodLogDate of ["2026-02-30", "31/08/2026", ""]) {
    const response = await apiPost(`Bearer ${eaterKey}`, `rest-date-${foodLogDate || "empty"}-01`.replaceAll("/", "."), { source: "saved-food", foodLogDate, savedFoodId: egg });
    expect(response.status, foodLogDate).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_date" });
  }
  const future = await apiPost(`Bearer ${eaterKey}`, "rest-future-0001", { source: "saved-food", foodLogDate: "2026-09-01", savedFoodId: egg });
  expect(future.status).toBe(400);
  expect(await future.json()).toEqual({ error: "future_date" });
});

test("an account without finished setup is 409 missing_setup", async () => {
  const newcomer = await account("entries.newcomer");
  const food = saveFood(newcomer.id, "Tea", { energyKcal: 2 });
  const key = await createKey(newcomer, "Newcomer", ["food-log:write"]);
  const response = await apiPost(`Bearer ${key}`, "rest-setup-0001", { source: "saved-food", foodLogDate: today, savedFoodId: food });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "missing_setup" });
});

test("malformed bodies and unknown sources are 400 invalid_request, and malformed keys are 400 invalid_idempotency_key", async () => {
  const valid = { source: "saved-food", foodLogDate: today, savedFoodId: egg };
  const before = await dailyLogFoods(eaterKey, today);
  for (const key of [null, "", "short", "has spaces in it", "k".repeat(125)]) {
    const response = await apiPost(`Bearer ${eaterKey}`, key, valid);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_idempotency_key" });
  }
  const invalidBodies: unknown[] = [
    "not json", "[]", "null", {}, { ...valid, source: undefined }, { ...valid, source: "catalog" }, { ...valid, source: 1 },
    { ...valid, foodLogDate: undefined }, { ...valid, savedFoodId: undefined }, { ...valid, savedFoodId: "1" }, { ...valid, savedFoodId: 1.5 },
    { ...valid, quantity: 0 }, { ...valid, quantity: -1 }, { ...valid, quantity: 99.5 }, { ...valid, quantity: 1.0001 }, { ...valid, quantity: "1" },
    { ...valid, date: today },
  ];
  for (const [index, body] of invalidBodies.entries()) {
    const response = await apiPost(`Bearer ${eaterKey}`, `rest-invalid-${String(index).padStart(4, "0")}`, body);
    expect(response.status, JSON.stringify(body)).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  }
  expect(await dailyLogFoods(eaterKey, today)).toEqual(before);
});

test("logging needs the Log foods permission, and only POST is allowed", async () => {
  const reader = await createKey(eater, "Reader", ["daily-log:read"]);
  const refused = await apiPost(`Bearer ${reader}`, "rest-refused-0001", { source: "saved-food", foodLogDate: today, savedFoodId: egg });
  expect(refused.status).toBe(403);
  expect(await refused.json()).toEqual({ error: "insufficient_scope" });
  expect(refused.headers.get("WWW-Authenticate")).toBe('Bearer realm="food-entries", error="insufficient_scope", scope="food-log:write"');

  const unauthenticated = await apiPost(null, "rest-no-token-01", { source: "saved-food", foodLogDate: today, savedFoodId: egg });
  expect(unauthenticated.status).toBe(401);
  expect(await unauthenticated.json()).toEqual({ error: "invalid_token" });
  expect(unauthenticated.headers.get("WWW-Authenticate")).toBe('Bearer realm="food-entries", error="invalid_token"');

  for (const method of ["PUT", "PATCH", "DELETE"]) {
    const response = await apiPost(`Bearer ${eaterKey}`, "rest-method-0001", {}, method);
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: "method_not_allowed" });
  }
  const get = readFoodEntries();
  expect(get.status).toBe(405);
  expect(get.headers.get("Cache-Control")).toContain("no-store");
});
