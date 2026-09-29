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
import { getFoodEntryService } from "../../app/food-entry/runtime.server";
import { loader as readDailyLog } from "../../app/routes/api.v1.daily-log";
import { action as mcpAction, loader as mcpLoader } from "../../app/routes/mcp";
import { action as keysAction, loader as keysLoader } from "../../app/routes/settings.api-keys";
import { action as copyAction } from "../../app/routes/settings.api-keys.copy";
import { getGoalSetupService } from "../../app/setup/runtime.server";
import { validateSetupFields } from "../../app/setup/validation";
import { getWaterEventService } from "../../app/water-event/runtime.server";
import { seedAuthenticatedAccount } from "../support/authentication";

const origin = "http://localhost:3000";
const today = "2026-08-31";
type Account = { id: number; cookie: string; csrf: string };
type RpcResponse = { jsonrpc: "2.0"; id: number; result?: Record<string, unknown>; error?: { code: number; message: string } };
let directory: string;
let reader: Account;
let readerKey: string;
let ipCounter = 0;

function args(request: Request) {
  return { request, params: {}, context: new RouterContextProvider(), pattern: "/mcp", url: new URL(request.url) };
}
function freshIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}
function mcpRequest(authorization: string | null, body: unknown, method = "POST", ip = freshIp()) {
  const headers = new Headers({
    "X-Open-Calory-Client-IP": ip,
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  });
  if (authorization !== null) headers.set("Authorization", authorization);
  const request = new Request(`${origin}/mcp`, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body) });
  return method === "GET" ? mcpLoader(args(request)) : mcpAction(args(request));
}
function restRequest(authorization: string, ip = freshIp()) {
  const request = new Request(`${origin}/api/v1/daily-log?date=${today}`, {
    headers: { Authorization: authorization, "X-Open-Calory-Client-IP": ip },
  });
  return readDailyLog({ ...args(request), pattern: "/api/v1/daily-log" });
}
async function rpc(key: string, method: string, params: Record<string, unknown> = {}): Promise<RpcResponse> {
  const response = await mcpRequest(`Bearer ${key}`, { jsonrpc: "2.0", id: 1, method, params });
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(response.headers.get("Mcp-Session-Id")).toBeNull();
  return await response.json() as RpcResponse;
}
async function callDailyLog(key: string, toolArguments: Record<string, unknown> = {}) {
  const { result } = await rpc(key, "tools/call", { name: "get_daily_log", arguments: toolArguments });
  return result as { isError?: boolean; structuredContent?: Record<string, unknown>; content: { type: string; text: string }[] };
}
async function account(username: string): Promise<Account> {
  const session = await seedAuthenticatedAccount(getAuthenticationService(), getApplicationDatabase().getClient(), username, "correct horse battery staple", "203.0.113.10");
  return { id: session.user.id, cookie: serializeSessionCookie(session).split(";", 1)[0], csrf: session.csrfToken };
}
function completeSetup(userId: number, displayUnits: "us" | "metric", water: string) {
  const setup = validateSetupFields({
    calories: "2050", carbohydrate: "230", displayUnits, fat: "70", fiber: "25",
    protein: "120", sodium: "2300", sugar: "50", timeZone: "America/New_York", water,
  });
  if (!setup.success) throw new Error("Invalid test setup");
  getGoalSetupService().completeInitial(userId, setup.data);
}
async function createKey(owner: Account, name: string, scopes: readonly string[] = ["daily-log:read"]): Promise<{ id: number; key: string }> {
  const request = (url: string, fields: Record<string, string>, repeated: [string, string][] = []) => new Request(`${origin}${url}`, {
    method: "POST",
    headers: { Cookie: owner.cookie, Origin: origin },
    body: new URLSearchParams([...Object.entries({ csrfToken: owner.csrf, ...fields }), ...repeated]),
  });
  await keysAction(args(request("/settings/api-keys", { intent: "create", name, expiration: "90d" }, scopes.map((scope) => ["scope", scope]))));
  const listed = (await keysLoader(args(new Request(`${origin}/settings/api-keys`, { headers: { Cookie: owner.cookie } })))).keys.find((entry) => entry.name === name);
  if (!listed) throw new Error(`No key named ${name}`);
  const copied = await copyAction(args(request("/settings/api-keys/copy", { keyId: String(listed.id) })));
  return { id: listed.id, key: ((await copied.json()) as { key: string }).key };
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "mcp-route-"));
  vi.stubEnv("APPLICATION_URL", origin);
  vi.stubEnv("DATABASE_PATH", path.join(directory, "application.sqlite"));
  vi.stubEnv("APPLICATION_SECRETS_PATH", path.join(directory, "secrets"));
  vi.stubEnv("FOOD_LOG_TEST_NOW", "2026-08-31T16:00:00.000Z");
  vi.stubEnv("SETUP_TEST_NOW", "2026-08-31T16:00:00.000Z");
  initializeApplicationDatabase();
  const owner = await getAuthenticationService().register("mcp.admin", "correct horse battery staple", "203.0.113.9");
  if (!owner.ok) throw new Error("Could not register owner");
  reader = await account("mcp.reader");
  completeSetup(reader.id, "us", "80");
  const now = new Date("2026-08-31T16:00:00.000Z");
  getFoodEntryService(now).logManual(reader.id, {
    carbohydrateGrams: "60", energyKcal: "350.4", fatGrams: "6.25", fiberGrams: "8", foodLogDate: today,
    idempotencyKey: "mcp-oatmeal", name: "Oatmeal", proteinGrams: "12", quantity: "1", sodiumMilligrams: "", sugarGrams: "10",
  });
  getWaterEventService(now).create(reader.id, { foodLogDate: today, selection: "16" });
  readerKey = (await createKey(reader, "Muse")).key;
});
afterAll(async () => {
  shutdownCredentialStorage();
  shutdownApplicationDatabase();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

test("a client initializes statelessly and lists the Food Log tool", async () => {
  const initialized = await rpc(readerKey, "initialize", {
    protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" },
  });
  expect(initialized.result).toMatchObject({ capabilities: { tools: {} }, serverInfo: { name: "open-calory-tracker" } });

  const listed = await rpc(readerKey, "tools/list");
  const tools = listed.result?.tools as { name: string; inputSchema: { properties: Record<string, unknown> }; annotations?: Record<string, unknown> }[];
  expect(tools.map((tool) => tool.name)).toEqual(["get_daily_log", "search_saved_foods"]);
  expect(Object.keys(tools[0].inputSchema.properties)).toEqual(["date"]);
  expect(tools[0].annotations).toMatchObject({ readOnlyHint: true });
});

test("get_daily_log summarizes today's Food Log in the account's units by default", async () => {
  const result = await callDailyLog(readerKey);
  expect(result.isError).toBeFalsy();
  expect(result.structuredContent).toMatchObject({
    date: today,
    today,
    timeZone: "America/New_York",
    isFuture: false,
    nutrients: {
      energy: { unit: "kcal", consumed: 350, goal: 2050, goalType: "target", remaining: 1700, isIncomplete: false },
      protein: { unit: "g", consumed: 12, goal: 120, goalType: "target", remaining: 108, isIncomplete: false },
      carbohydrate: { unit: "g", consumed: 60, goal: 230, remaining: 170 },
      fat: { unit: "g", consumed: 6.3, goal: 70, remaining: 63.8 },
      fiber: { unit: "g", consumed: 8, goal: 25, remaining: 17 },
      sugar: { unit: "g", consumed: 10, goal: 50, goalType: "maximum", remaining: 40 },
      sodium: { unit: "mg", consumed: 0, goal: 2300, goalType: "maximum", remaining: 2300, isIncomplete: true },
    },
    water: { unit: "fl oz", consumed: 16, goal: 80, remaining: 64 },
    incompleteNutrients: ["sodium"],
    foods: [{ name: "Oatmeal", energyKcal: 350, proteinG: 12, carbohydrateG: 60, fatG: 6.3, sodiumMg: null }],
  });
  const text = result.content.map((part) => part.text).join("\n");
  expect(text).toContain("2026-08-31");
  expect(text).toContain("350 of 2050 kcal");
  expect(text).toContain("16 of 80 fl oz");
  expect(text).toMatch(/sodium/iu);
  expect(text).toContain("Oatmeal");
});

test("get_daily_log reports water in ml for metric accounts", async () => {
  const metric = await account("mcp.metric");
  completeSetup(metric.id, "metric", "2000");
  getWaterEventService(new Date("2026-08-31T16:00:00.000Z")).create(metric.id, { foodLogDate: today, selection: "8" });
  const { key } = await createKey(metric, "Metric");

  const result = await callDailyLog(key, { date: today });
  expect(result.structuredContent).toMatchObject({
    date: today,
    water: { unit: "ml", consumed: 237, goal: 2000, remaining: 1763 },
    nutrients: { energy: { consumed: 0, goal: 2050, remaining: 2050 } },
    incompleteNutrients: [],
    foods: [],
  });
});

test("get_daily_log reads an earlier date, before any goal took effect", async () => {
  const result = await callDailyLog(readerKey, { date: "2026-08-30" });
  expect(result.isError).toBeFalsy();
  expect(result.structuredContent).toMatchObject({
    date: "2026-08-30",
    today,
    nutrients: { energy: { consumed: 0, goal: null, remaining: null }, sodium: { goal: null, isIncomplete: false } },
    water: { unit: "fl oz", consumed: 0, goal: null, remaining: null },
    foods: [],
  });
  expect(result.content[0].text).toContain("no goal set");
});

test("an invalid date and a missing account setup are tool errors, not HTTP errors", async () => {
  for (const date of ["2026-02-30", "yesterday", "2026-8-1"]) {
    const result = await callDailyLog(readerKey, { date });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/date/iu);
  }
  const unset = await account("mcp.unset");
  const { key } = await createKey(unset, "Unset");
  const result = await callDailyLog(key);
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toMatch(/setup/iu);
});

test("nothing reaches the tools without a valid key", async () => {
  const listTools = { jsonrpc: "2.0", id: 1, method: "tools/list" };
  const expired = await createKey(reader, "Expired");
  getApplicationDatabase().getClient().run(sql`UPDATE api_keys SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ${expired.id}`);
  for (const authorization of [null, "Bearer", `Bearer oct_${"A".repeat(43)}`, `Bearer ${expired.key}`, "Basic dXNlcjpwYXNz"]) {
    const response = await mcpRequest(authorization, listTools);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_token" });
    expect(response.headers.get("WWW-Authenticate")).toMatch(/^Bearer\b/u);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  }
  const get = await mcpRequest(null, undefined, "GET");
  expect(get.status).toBe(401);
});

test("REST and MCP failures from one client IP count against one shared limit", async () => {
  const unknown = `Bearer oct_${"C".repeat(43)}`;
  const listTools = { jsonrpc: "2.0", id: 1, method: "tools/list" };
  const blocked = freshIp();
  // Five failures on each endpoint, interleaved, exhaust the ten-attempt budget together.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    expect((await mcpRequest(unknown, listTools, "POST", blocked)).status).toBe(401);
    expect(restRequest(unknown, blocked).status).toBe(401);
  }
  const mcpLimited = await mcpRequest(`Bearer ${readerKey}`, listTools, "POST", blocked);
  expect(mcpLimited.status).toBe(429);
  expect(mcpLimited.headers.get("Retry-After")).toBe("900");
  const restLimited = restRequest(`Bearer ${readerKey}`, blocked);
  expect(restLimited.status).toBe(429);
  expect(restLimited.headers.get("Retry-After")).toBe("900");

  // Success on either endpoint clears the count for both.
  const recovering = freshIp();
  for (let attempt = 0; attempt < 9; attempt += 1) expect(restRequest(unknown, recovering).status).toBe(401);
  expect((await mcpRequest(`Bearer ${readerKey}`, listTools, "POST", recovering)).status).toBe(200);
  for (let attempt = 0; attempt < 9; attempt += 1) expect((await mcpRequest(unknown, listTools, "POST", recovering)).status).toBe(401);
  expect(restRequest(`Bearer ${readerKey}`, recovering).status).toBe(200);
});

test("a key's 120 requests per minute are shared between REST and MCP", async () => {
  const busy = await createKey(reader, "Busy across routes");
  const listTools = { jsonrpc: "2.0", id: 1, method: "tools/list" };
  for (let request = 0; request < 60; request += 1) {
    expect(restRequest(`Bearer ${busy.key}`).status).toBe(200);
    expect((await mcpRequest(`Bearer ${busy.key}`, listTools)).status).toBe(200);
  }
  const mcpLimited = await mcpRequest(`Bearer ${busy.key}`, listTools);
  expect(mcpLimited.status).toBe(429);
  expect(mcpLimited.headers.get("Retry-After")).toBe("60");
  const restLimited = restRequest(`Bearer ${busy.key}`);
  expect(restLimited.status).toBe(429);
  expect(restLimited.headers.get("Retry-After")).toBe("60");
  expect(restRequest(`Bearer ${readerKey}`).status).toBe(200);
});

test("tools are listed and callable only with their scope, and a key with no tool scope gets 403", async () => {
  const { id, key } = await createKey(reader, "Other scope");
  getApplicationDatabase().getClient().run(sql`UPDATE api_keys SET scopes = '["other:read"]' WHERE id = ${id}`);
  const response = await mcpRequest(`Bearer ${key}`, { jsonrpc: "2.0", id: 1, method: "tools/list" });
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "insufficient_scope" });
  expect(response.headers.get("WWW-Authenticate")).toContain('error="insufficient_scope", scope="daily-log:read food-log:write"');
});

test("only POST carries MCP messages; there are no sessions or streams", async () => {
  const get = await mcpRequest(`Bearer ${readerKey}`, undefined, "GET");
  expect(get.status).toBe(405);
  expect(get.headers.get("Allow")).toBe("POST");
  const remove = await mcpRequest(`Bearer ${readerKey}`, {}, "DELETE");
  expect(remove.status).toBe(405);
});

type SearchResult = { isError?: boolean; structuredContent?: { savedFoods: Record<string, unknown>[]; truncated: boolean }; content: { type: string; text: string }[] };
async function searchSavedFoods(key: string, toolArguments: Record<string, unknown> = {}) {
  const { result } = await rpc(key, "tools/call", { name: "search_saved_foods", arguments: toolArguments });
  return result as SearchResult;
}
let savedFoodCounter = 0;
function saveFood(userId: number, name: string, nutrients: Partial<Record<"energyKcal" | "proteinGrams" | "carbohydrateGrams" | "fatGrams" | "fiberGrams" | "sugarGrams" | "sodiumMilligrams" | "quantity", string>> = {}) {
  savedFoodCounter += 1;
  // Logging a manual food in the web also keeps it in My foods.
  getFoodEntryService(new Date("2026-08-31T16:00:00.000Z")).logManual(userId, {
    carbohydrateGrams: "", energyKcal: "100", fatGrams: "", fiberGrams: "", foodLogDate: today, idempotencyKey: `mcp-saved-${savedFoodCounter}`,
    name, proteinGrams: "", quantity: "1", sodiumMilligrams: "", sugarGrams: "", ...nutrients,
  });
}
function savedFoodNames(result: SearchResult) {
  return result.structuredContent?.savedFoods.map((food) => food.name);
}

test("search_saved_foods is listed and callable with either the Food Log read scope or the Log foods scope", async () => {
  const { key: writer } = await createKey(reader, "Writer only", ["food-log:write"]);
  const listed = await rpc(writer, "tools/list");
  const tools = listed.result?.tools as { name: string; annotations?: Record<string, unknown>; outputSchema?: unknown }[];
  expect(tools.map((tool) => tool.name)).toEqual(["search_saved_foods", "create_saved_food", "log_saved_food"]);
  expect(tools[0].annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
  expect(tools[0].outputSchema).toBeDefined();

  for (const key of [readerKey, writer]) {
    const result = await searchSavedFoods(key, { query: "oat" });
    expect(result.isError).toBeFalsy();
    expect(savedFoodNames(result)).toEqual(["Oatmeal"]);
  }
  const dailyLog = await rpc(writer, "tools/call", { name: "get_daily_log", arguments: {} });
  expect(JSON.stringify(dailyLog)).toMatch(/disabled/u);
  expect(dailyLog.result?.structuredContent).toBeUndefined();
});

test("search_saved_foods matches part of a name in any case and returns per-serving nutrition", async () => {
  const pantry = await account("mcp.pantry");
  completeSetup(pantry.id, "metric", "2000");
  saveFood(pantry.id, "Huevo (1 grande)", { energyKcal: "78", proteinGrams: "6.3", carbohydrateGrams: "0.6", fatGrams: "5.3", sodiumMilligrams: "62" });
  saveFood(pantry.id, "Pan tostado", { energyKcal: "80.125" });
  // Saved from a Food Entry of two servings: the search shows one serving, not the entry's totals.
  saveFood(pantry.id, "huevo revuelto", { energyKcal: "400", proteinGrams: "26", sodiumMilligrams: "300", quantity: "2" });
  saveFood(pantry.id, "Huevo (1 grande)", { energyKcal: "72" });
  const { key } = await createKey(pantry, "Pantry");

  const eggs = await searchSavedFoods(key, { query: "HUEVO" });
  expect(eggs.isError).toBeFalsy();
  expect(eggs.structuredContent?.truncated).toBe(false);
  const [first, second, scrambled] = eggs.structuredContent?.savedFoods ?? [];
  expect(first).toEqual({
    id: expect.any(Number) as number, name: "Huevo (1 grande)",
    energyKcal: 78, proteinG: 6.3, carbohydrateG: 0.6, fatG: 5.3, fiberG: null, sugarG: null, sodiumMg: 62,
  });
  expect(second).toMatchObject({ name: "Huevo (1 grande)", energyKcal: 72 });
  expect(second.id as number).toBeGreaterThan(first.id as number);
  expect(scrambled).toMatchObject({ name: "huevo revuelto", energyKcal: 200, proteinG: 13, sodiumMg: 150, fatG: null });
  expect(eggs.content).toHaveLength(1);
  expect(eggs.content[0].text).not.toContain("\n");
  expect(eggs.content[0].text).toContain("Huevo (1 grande)");

  const everything = await searchSavedFoods(key);
  expect(savedFoodNames(everything)).toEqual(["Huevo (1 grande)", "Huevo (1 grande)", "Pan tostado", "huevo revuelto"]);
  expect(savedFoodNames(await searchSavedFoods(key, { query: "" }))).toEqual(savedFoodNames(everything));
  expect(everything.structuredContent?.savedFoods[2]).toMatchObject({ energyKcal: 80.125 });

  const none = await searchSavedFoods(key, { query: "pizza" });
  expect(none.isError).toBeFalsy();
  expect(none.structuredContent).toEqual({ savedFoods: [], truncated: false });
  expect(none.content[0].text).toMatch(/no saved foods/iu);

  const overlong = await searchSavedFoods(key, { query: "a".repeat(201) });
  expect(overlong.isError).toBe(true);
});

test("search_saved_foods returns at most 25 Saved Foods and says when more exist, without changing the Food Log", async () => {
  const bulk = await account("mcp.bulk");
  completeSetup(bulk.id, "metric", "2000");
  for (let index = 27; index >= 1; index -= 1) saveFood(bulk.id, `Food ${String(index).padStart(2, "0")}`);
  const { key } = await createKey(bulk, "Bulk");
  const before = (await callDailyLog(key)).structuredContent;

  const all = await searchSavedFoods(key);
  expect(all.structuredContent?.truncated).toBe(true);
  expect(savedFoodNames(all)).toEqual(Array.from({ length: 25 }, (_, index) => `Food ${String(index + 1).padStart(2, "0")}`));
  expect(all.content[0].text).toMatch(/more/iu);

  const narrowed = await searchSavedFoods(key, { query: "food 2" });
  expect(narrowed.structuredContent?.truncated).toBe(false);
  expect(savedFoodNames(narrowed)).toEqual(["Food 20", "Food 21", "Food 22", "Food 23", "Food 24", "Food 25", "Food 26", "Food 27"]);

  expect((await callDailyLog(key)).structuredContent).toEqual(before);
});

type CreateResult = { isError?: boolean; structuredContent?: Record<string, unknown>; content: { type: string; text: string }[] };
async function createSavedFood(key: string, toolArguments: Record<string, unknown>) {
  const { result } = await rpc(key, "tools/call", { name: "create_saved_food", arguments: toolArguments });
  return result as CreateResult;
}
const egg = { name: " Huevo (1 grande) ", energyKcal: 78, proteinGrams: 6.3, carbohydrateGrams: 0.6, fatGrams: 5.3, sodiumMilligrams: 62 };

test("create_saved_food returns the new Saved Food's id and one serving's nutrition without logging food", async () => {
  const cook = await account("mcp.cook");
  completeSetup(cook.id, "metric", "2000");
  const { key } = await createKey(cook, "Cook", ["daily-log:read", "food-log:write"]);
  const before = (await callDailyLog(key)).structuredContent;

  const listed = (await rpc(key, "tools/list")).result?.tools as { name: string; description: string; annotations?: Record<string, unknown>; inputSchema: { required?: string[] } }[];
  const tool = listed.find((candidate) => candidate.name === "create_saved_food");
  expect(tool?.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  expect(tool?.inputSchema.required?.sort()).toEqual(["energyKcal", "idempotencyKey", "name"]);
  expect(tool?.description).toMatch(/search_saved_foods/u);
  expect(tool?.description).toMatch(/serving/u);

  const created = await createSavedFood(key, { ...egg, idempotencyKey: "create-egg-0001" });
  expect(created.isError).toBeFalsy();
  expect(created.structuredContent).toEqual({
    id: expect.any(Number) as number, name: "Huevo (1 grande)",
    energyKcal: 78, proteinG: 6.3, carbohydrateG: 0.6, fatG: 5.3, fiberG: null, sugarG: null, sodiumMg: 62,
    replayed: false,
  });
  expect(created.content[0].text).toContain("Huevo (1 grande)");
  expect(created.content[0].text).not.toContain("\n");

  expect((await callDailyLog(key)).structuredContent).toEqual(before);
  const found = await searchSavedFoods(key, { query: "huevo" });
  expect(found.structuredContent?.savedFoods).toEqual([
    { id: created.structuredContent?.id, name: "Huevo (1 grande)", energyKcal: 78, proteinG: 6.3, carbohydrateG: 0.6, fatG: 5.3, fiberG: null, sugarG: null, sodiumMg: 62 },
  ]);

  const sameName = await createSavedFood(key, { name: "Huevo (1 grande)", energyKcal: 72, idempotencyKey: "create-egg-0002" });
  expect(sameName.structuredContent).toMatchObject({ name: "Huevo (1 grande)", energyKcal: 72, proteinG: null, replayed: false });
  expect(sameName.structuredContent?.id).not.toBe(created.structuredContent?.id);
  expect(savedFoodNames(await searchSavedFoods(key, { query: "huevo" }))).toEqual(["Huevo (1 grande)", "Huevo (1 grande)"]);
});

test("create_saved_food keeps fiber and sugar per serving with up to three decimals", async () => {
  const baker = await account("mcp.baker");
  const { key } = await createKey(baker, "Baker", ["food-log:write"]);
  const created = await createSavedFood(key, { name: "Avena (40 g)", energyKcal: 150.5, fiberGrams: 4.125, sugarGrams: 0.375, idempotencyKey: "create-oats-0001" });
  expect(created.isError).toBeFalsy();
  const oats = {
    id: expect.any(Number) as number, name: "Avena (40 g)",
    energyKcal: 150.5, proteinG: null, carbohydrateG: null, fatG: null, fiberG: 4.125, sugarG: 0.375, sodiumMg: null,
  };
  expect(created.structuredContent).toEqual({ ...oats, replayed: false });
  expect((await searchSavedFoods(key, { query: "avena" })).structuredContent?.savedFoods).toEqual([{ ...oats, id: created.structuredContent?.id }]);
});

test("create_saved_food replays a retry with the same key and data, and refuses a reused key with different data", async () => {
  const retrier = await account("mcp.retrier");
  const { key } = await createKey(retrier, "Retrier", ["food-log:write"]);
  const original = await createSavedFood(key, { ...egg, idempotencyKey: "retry-egg-0001" });
  const replay = await createSavedFood(key, { ...egg, name: "Huevo (1 grande)", fiberGrams: null, idempotencyKey: "retry-egg-0001" });
  expect(replay.isError).toBeFalsy();
  expect(replay.structuredContent).toEqual({ ...original.structuredContent, replayed: true });

  const conflict = await createSavedFood(key, { ...egg, energyKcal: 80, idempotencyKey: "retry-egg-0001" });
  expect(conflict.isError).toBe(true);
  expect(conflict.content[0].text).toMatch(/already used/u);
  expect(conflict.content[0].text).toMatch(/new idempotencyKey/u);
  expect((await searchSavedFoods(key)).structuredContent?.savedFoods).toHaveLength(1);
});

test("create_saved_food is hidden from and refused for keys without the Log foods scope", async () => {
  const listed = (await rpc(readerKey, "tools/list")).result?.tools as { name: string }[];
  expect(listed.map((tool) => tool.name)).not.toContain("create_saved_food");
  const refused = await rpc(readerKey, "tools/call", { name: "create_saved_food", arguments: { ...egg, idempotencyKey: "refused-egg-0001" } });
  expect(JSON.stringify(refused)).toMatch(/disabled/u);
  expect(savedFoodNames(await searchSavedFoods(readerKey, { query: "huevo" }))).toEqual([]);
});

test("create_saved_food explains malformed names, nutrients, and idempotency keys", async () => {
  const careless = await account("mcp.careless");
  const { key } = await createKey(careless, "Careless", ["food-log:write"]);
  const invalid: [Record<string, unknown>, RegExp][] = [
    [{ ...egg, idempotencyKey: "short" }, /idempotencyKey/u],
    [{ ...egg, idempotencyKey: "has spaces in it" }, /idempotencyKey/u],
    [{ ...egg, idempotencyKey: "k".repeat(125) }, /idempotencyKey/u],
    [{ ...egg, name: "   ", idempotencyKey: "invalid-name-0001" }, /name/u],
    [{ ...egg, energyKcal: -5, idempotencyKey: "invalid-kcal-0001" }, /energyKcal/u],
    [{ ...egg, energyKcal: 1.0001, idempotencyKey: "invalid-kcal-0002" }, /decimal/u],
    [{ ...egg, sodiumMilligrams: 1.5, idempotencyKey: "invalid-sodium-01" }, /sodiumMilligrams/u],
    [{ name: "Tea", idempotencyKey: "missing-kcal-0001" }, /energyKcal/u],
  ];
  for (const [toolArguments, message] of invalid) {
    const result = await createSavedFood(key, toolArguments);
    expect(result.isError, JSON.stringify(toolArguments)).toBe(true);
    expect(result.content[0].text).toMatch(message);
  }
  expect(await createSavedFood(key, { ...egg, idempotencyKey: "k".repeat(124) })).toMatchObject({ structuredContent: { replayed: false } });
  expect((await searchSavedFoods(key)).structuredContent?.savedFoods).toHaveLength(1);
});

type LogResult = {
  isError?: boolean;
  structuredContent?: { foodEntry: Record<string, unknown> & { id: number }; replayed: boolean; dailyLog: Record<string, unknown> & { foods: Record<string, unknown>[] } };
  content: { type: string; text: string }[];
};
async function logSavedFood(key: string, toolArguments: Record<string, unknown>) {
  const { result } = await rpc(key, "tools/call", { name: "log_saved_food", arguments: toolArguments });
  return result as LogResult;
}
async function eater(username: string) {
  const owner = await account(username);
  completeSetup(owner.id, "metric", "2000");
  const { key } = await createKey(owner, "Eater", ["daily-log:read", "food-log:write"]);
  const created = await createSavedFood(key, { ...egg, idempotencyKey: `${username}-egg` });
  return { owner, key, eggId: created.structuredContent?.id as number };
}

test("log_saved_food logs one serving today by default and returns the Food Entry with the updated day summary", async () => {
  const { key, eggId } = await eater("mcp.eater");
  const listed = (await rpc(key, "tools/list")).result?.tools as { name: string; annotations?: Record<string, unknown>; inputSchema: { required?: string[] } }[];
  const tool = listed.find((candidate) => candidate.name === "log_saved_food");
  expect(tool?.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  expect(tool?.inputSchema.required?.sort()).toEqual(["idempotencyKey", "savedFoodId"]);

  const logged = await logSavedFood(key, { savedFoodId: eggId, idempotencyKey: "log-egg-0001" });
  expect(logged.isError).toBeFalsy();
  expect(logged.structuredContent?.foodEntry).toEqual({
    id: expect.any(Number) as number, date: today, name: "Huevo (1 grande)", servings: 1,
    energyKcal: 78, proteinG: 6.3, carbohydrateG: 0.6, fatG: 5.3, fiberG: null, sugarG: null, sodiumMg: 62,
  });
  expect(logged.structuredContent?.replayed).toBe(false);
  const dailyLog = (await callDailyLog(key)).structuredContent;
  expect(logged.structuredContent?.dailyLog).toEqual(dailyLog);
  expect(dailyLog).toMatchObject({
    date: today,
    nutrients: { energy: { consumed: 78, goal: 2050, remaining: 1972 } },
    foods: [{ name: "Huevo (1 grande)", serving: "1 serving × 1", energyKcal: 78 }],
  });
  const [text] = logged.content;
  expect(text.text).not.toContain("\n");
  expect(text.text).toContain("Huevo (1 grande)");
  expect(text.text).toContain("1972 kcal remaining");
});

test("log_saved_food scales nutrition by fractional servings and logs past days", async () => {
  const { key, eggId } = await eater("mcp.past.eater");
  const yesterday = "2026-08-30";
  const logged = await logSavedFood(key, { savedFoodId: eggId, quantity: 1.5, date: yesterday, idempotencyKey: "log-past-0001" });
  expect(logged.structuredContent?.foodEntry).toMatchObject({
    date: yesterday, servings: 1.5, energyKcal: 117, proteinG: 9.45, carbohydrateG: 0.9, fatG: 7.95, sodiumMg: 93,
  });
  expect(logged.structuredContent?.dailyLog).toEqual((await callDailyLog(key, { date: yesterday })).structuredContent);
  expect(logged.structuredContent?.dailyLog).toMatchObject({ date: yesterday, foods: [{ time: "12:00", serving: "1 serving × 1.5" }] });

  const third = await logSavedFood(key, { savedFoodId: eggId, quantity: 0.333, date: yesterday, idempotencyKey: "log-past-0002" });
  expect(third.structuredContent?.foodEntry).toMatchObject({ servings: 0.333, energyKcal: 25.974 });
  expect(third.structuredContent?.dailyLog.foods).toHaveLength(2);
  expect((await callDailyLog(key)).structuredContent?.foods).toEqual([]);
});

test("log_saved_food logs one serving of a Saved Food created in the web from a Food Entry", async () => {
  const { owner, key } = await eater("mcp.web.eater");
  getFoodEntryService(new Date("2026-08-31T16:00:00.000Z")).logManual(owner.id, {
    energyKcal: "500", foodLogDate: "2026-08-30", idempotencyKey: "web-pasta-two", name: "Pasta", proteinGrams: "30", quantity: "2",
  });
  const pastaId = (await searchSavedFoods(key, { query: "pasta" })).structuredContent?.savedFoods[0].id;
  const logged = await logSavedFood(key, { savedFoodId: pastaId, idempotencyKey: "log-pasta-0001" });
  expect(logged.structuredContent?.foodEntry).toMatchObject({ date: today, name: "Pasta", servings: 1, energyKcal: 250, proteinG: 15 });
});

test("log_saved_food replays a retry with the same data and refuses a reused key with a different Saved Food, quantity, or date", async () => {
  const { key, eggId } = await eater("mcp.retry.eater");
  const other = await createSavedFood(key, { name: "Toast", energyKcal: 90, idempotencyKey: "retry-toast-01" });
  const request = { savedFoodId: eggId, quantity: 2, idempotencyKey: "log-retry-0001" };
  const original = await logSavedFood(key, request);
  for (const retry of [request, { ...request, date: today }]) {
    const replay = await logSavedFood(key, retry);
    expect(replay.isError).toBeFalsy();
    expect(replay.structuredContent).toEqual({ ...original.structuredContent, replayed: true });
    expect(replay.content[0].text).toMatch(/already logged/u);
  }
  for (const changed of [{ savedFoodId: other.structuredContent?.id }, { quantity: 3 }, { date: "2026-08-30" }]) {
    const conflict = await logSavedFood(key, { ...request, ...changed });
    expect(conflict.isError, JSON.stringify(changed)).toBe(true);
    expect(conflict.content[0].text).toMatch(/already used/u);
    expect(conflict.content[0].text).toMatch(/new idempotencyKey/u);
  }
  expect((await callDailyLog(key)).structuredContent?.foods).toHaveLength(1);
  expect((await callDailyLog(key, { date: "2026-08-30" })).structuredContent?.foods).toEqual([]);
});

test("log_saved_food explains unknown Saved Foods, bad dates, quantities, and keys, and logs nothing", async () => {
  const { key, eggId } = await eater("mcp.clumsy.eater");
  const stranger = await eater("mcp.stranger.eater");
  const invalid: [Record<string, unknown>, RegExp][] = [
    [{ savedFoodId: 999_999 }, /search_saved_foods/u],
    [{ savedFoodId: stranger.eggId }, /search_saved_foods/u],
    [{ date: "2026-02-30" }, /date/u],
    [{ date: "yesterday" }, /date/u],
    [{ date: "2026-09-01" }, /future/u],
    [{ quantity: 0 }, /quantity/u],
    [{ quantity: -1 }, /quantity/u],
    [{ quantity: 100 }, /quantity/u],
    [{ quantity: 1.0001 }, /quantity/u],
    [{ quantity: "two" }, /quantity/u],
    [{ idempotencyKey: "short" }, /idempotencyKey/u],
    [{ idempotencyKey: undefined }, /idempotencyKey/u],
  ];
  for (const [change, message] of invalid) {
    const result = await logSavedFood(key, { savedFoodId: eggId, idempotencyKey: "log-invalid-0001", ...change });
    expect(result.isError, JSON.stringify(change)).toBe(true);
    expect(result.content[0].text).toMatch(message);
  }
  expect((await callDailyLog(key)).structuredContent?.foods).toEqual([]);
  expect(await logSavedFood(key, { savedFoodId: eggId, quantity: 99, idempotencyKey: "log-invalid-0001" }))
    .toMatchObject({ structuredContent: { foodEntry: { servings: 99 } } });
});

test("log_saved_food gives the get_daily_log message to an account without finished setup", async () => {
  const unset = await account("mcp.unset.eater");
  const { key } = await createKey(unset, "Unset eater", ["daily-log:read", "food-log:write"]);
  const created = await createSavedFood(key, { ...egg, idempotencyKey: "unset-egg-0001" });
  const result = await logSavedFood(key, { savedFoodId: created.structuredContent?.id, idempotencyKey: "unset-log-0001" });
  expect(result.isError).toBe(true);
  expect(result.content).toEqual((await callDailyLog(key)).content);
});

test("log_saved_food is hidden from and refused for keys without the Log foods scope", async () => {
  const oatmealId = (await searchSavedFoods(readerKey, { query: "oat" })).structuredContent?.savedFoods[0].id;
  const listed = (await rpc(readerKey, "tools/list")).result?.tools as { name: string }[];
  expect(listed.map((tool) => tool.name)).not.toContain("log_saved_food");
  const refused = await rpc(readerKey, "tools/call", { name: "log_saved_food", arguments: { savedFoodId: oatmealId, idempotencyKey: "refused-log-0001" } });
  expect(JSON.stringify(refused)).toMatch(/disabled/u);
  expect((await callDailyLog(readerKey)).structuredContent?.foods).toHaveLength(1);
});
