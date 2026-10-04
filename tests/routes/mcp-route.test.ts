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
import { completeTestSetup } from "../support/setup";
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
function completeSetup(userId: number, waterTarget = "80") {
  completeTestSetup(userId, { goal: { waterTarget } });
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
  completeSetup(reader.id);
  const now = new Date("2026-08-31T16:00:00.000Z");
  getFoodEntryService(now).logManual(reader.id, {
    carbohydrateGrams: "60", energyKcal: "350.4", fatGrams: "6.25", fiberGrams: "8", foodLogDate: today,
    idempotencyKey: "mcp-oatmeal", name: "Oatmeal", proteinGrams: "12", quantity: "1", sodiumMilligrams: "", sugarGrams: "10",
  });
  getWaterEventService(now).save(reader.id, { logDate: "2026-08-31T15:00:00Z", quantity: { ounces: "16" } });
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
  expect(tools.map((tool) => tool.name)).toEqual(["get_daily_log"]);
  expect(Object.keys(tools[0].inputSchema.properties)).toEqual(["date"]);
  expect(tools[0].annotations).toMatchObject({ readOnlyHint: true });
});

test("get_daily_log summarizes today's Food Log by default", async () => {
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
    foods: [{ name: "Oatmeal", provider: "manual", dataType: "User entered", energyKcal: 350, proteinG: 12, carbohydrateG: 60, fatG: 6.3, sodiumMg: null }],
  });
  const text = result.content.map((part) => part.text).join("\n");
  expect(text).toContain("2026-08-31");
  expect(text).toContain("350 of 2050 kcal");
  expect(text).toContain("16 of 80 fl oz");
  expect(text).toMatch(/sodium/iu);
  expect(text).toContain("Oatmeal, Manual, 1 serving × 1: 350 kcal");
});

test("get_daily_log reports water in fluid ounces, exact to three decimals", async () => {
  const holder = await account("mcp.precise");
  completeSetup(holder.id, "67.628");
  const waterEvents = getWaterEventService(new Date("2026-08-31T16:00:00.000Z"));
  waterEvents.save(holder.id, { logDate: "2026-08-31T15:00:00Z", quantity: { ounces: "8.125" } });
  const { key } = await createKey(holder, "Precise");

  const under = await callDailyLog(key, { date: today });
  expect(under.structuredContent).toMatchObject({
    date: today,
    water: { unit: "fl oz", consumed: 8.125, goal: 67.628, remaining: 59.503 },
    nutrients: { energy: { consumed: 0, goal: 2050, remaining: 2050 } },
    incompleteNutrients: [],
    foods: [],
  });
  expect(under.content[0].text).toContain("Water: 8.125 of 67.628 fl oz, 59.503 fl oz remaining");

  waterEvents.save(holder.id, { logDate: "2026-08-31T15:30:00Z", quantity: { ounces: "60" } });
  const over = await callDailyLog(key, { date: today });
  expect(over.structuredContent).toMatchObject({
    water: { unit: "fl oz", consumed: 68.125, goal: 67.628, remaining: -0.497 },
  });
  expect(over.content[0].text).toContain("Water: 68.125 of 67.628 fl oz, 0.497 fl oz over");
});

test("get_daily_log totals water beyond a single event's digit limit", async () => {
  const holder = await account("mcp.large.total");
  completeSetup(holder.id, "500");
  const waterEvents = getWaterEventService(new Date("2026-08-31T16:00:00.000Z"));
  const start = Date.parse("2026-08-31T05:00:00Z");
  for (let index = 0; index < 2_000; index++) {
    waterEvents.save(holder.id, { logDate: new Date(start + index * 15_000).toISOString(), quantity: { ounces: "500" } });
  }
  const { key } = await createKey(holder, "Large total");

  const result = await callDailyLog(key, { date: today });
  expect(result.isError).toBeFalsy();
  expect(result.structuredContent).toMatchObject({
    water: { unit: "fl oz", consumed: 1_000_000, goal: 500, remaining: -999_500 },
  });
  expect(result.content[0].text).toContain("Water: 1000000 of 500 fl oz, 999500 fl oz over");
});

test("get_daily_log measures an earlier date against the current Daily Goal", async () => {
  const result = await callDailyLog(readerKey, { date: "2026-08-30" });
  expect(result.isError).toBeFalsy();
  expect(result.structuredContent).toMatchObject({
    date: "2026-08-30",
    today,
    nutrients: { energy: { consumed: 0, goal: 2050, remaining: 2050 }, sodium: { goal: 2300, isIncomplete: false } },
    water: { unit: "fl oz", consumed: 0, goal: 80, remaining: 80 },
    foods: [],
  });
  expect(result.content[0].text).not.toContain("no goal set");
});

test("get_daily_log reports no goal for an account with a time zone but no Daily Goal", async () => {
  const holder = await account("mcp.zone.only");
  getApplicationDatabase().getClient().run(sql`INSERT INTO user_preferences (user_id, time_zone, created_at, updated_at)
    VALUES (${holder.id}, 'America/New_York', '2026-08-31T16:00:00.000Z', '2026-08-31T16:00:00.000Z')`);
  const { key } = await createKey(holder, "Zone only");

  const result = await callDailyLog(key, { date: today });
  expect(result.structuredContent).toMatchObject({
    nutrients: { energy: { consumed: 0, goal: null, remaining: null } },
    water: { unit: "fl oz", consumed: 0, goal: null, remaining: null },
  });
  expect(result.content[0].text).toContain("Water: 0 fl oz (no goal set)");
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
  expect(response.headers.get("WWW-Authenticate")).toContain('error="insufficient_scope", scope="daily-log:read water-events:write water-events:read"');
});

test("only POST carries MCP messages; there are no sessions or streams", async () => {
  const get = await mcpRequest(`Bearer ${readerKey}`, undefined, "GET");
  expect(get.status).toBe(405);
  expect(get.headers.get("Allow")).toBe("POST");
  const remove = await mcpRequest(`Bearer ${readerKey}`, {}, "DELETE");
  expect(remove.status).toBe(405);
});
