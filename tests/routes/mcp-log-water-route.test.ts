import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import { shutdownCredentialStorage } from "../../app/credentials/runtime.server";
import { getApplicationDatabase, initializeApplicationDatabase, shutdownApplicationDatabase } from "../../app/database/runtime.server";
import { waterEvents } from "../../app/database/schema.server";
import { action as logWaterRest } from "../../app/routes/api.v1.water-events";
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
type ToolResult = { isError?: boolean; structuredContent?: Record<string, unknown>; content: { type: string; text: string }[] };
type RpcResponse = { jsonrpc: "2.0"; id: number; result?: Record<string, unknown>; error?: { code: number; message: string } };
let directory: string;
let owner: Account;
let writer: string;
let reader: string;
let ipCounter = 0;
let keyCounter = 0;

function args(request: Request) {
  return { request, params: {}, context: new RouterContextProvider(), pattern: new URL(request.url).pathname, url: new URL(request.url) };
}
function freshIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}
/** A distinct caller key per call, so tests only replay when they mean to. */
function freshKey() {
  keyCounter += 1;
  return `mcp-water-${keyCounter}`;
}
async function rpc(key: string, method: string, params: Record<string, unknown> = {}): Promise<RpcResponse> {
  const request = new Request(`${origin}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "X-Open-Calory-Client-IP": freshIp(),
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const response = await mcpAction(args(request));
  expect(response.status).toBe(200);
  return await response.json() as RpcResponse;
}
async function callTool(key: string, name: string, toolArguments: Record<string, unknown>) {
  return (await rpc(key, "tools/call", { name, arguments: toolArguments })).result as ToolResult;
}
function logWater(toolArguments: Record<string, unknown>, key = writer) {
  return callTool(key, "log_water", { idempotencyKey: freshKey(), ...toolArguments });
}
async function expectToolError(result: ToolResult | Promise<ToolResult>, message: RegExp) {
  const resolved = await result;
  expect(resolved.isError).toBe(true);
  expect(resolved.content[0].text).toMatch(message);
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
async function createKey(holder: Account, name: string, scopes: string[]): Promise<string> {
  const body = new URLSearchParams({ csrfToken: holder.csrf, intent: "create", name, expiration: "90d" });
  for (const scope of scopes) body.append("scope", scope);
  await keysAction(args(new Request(`${origin}/settings/api-keys`, { method: "POST", headers: { Cookie: holder.cookie, Origin: origin }, body })));
  const listed = (await keysLoader(args(new Request(`${origin}/settings/api-keys`, { headers: { Cookie: holder.cookie } })))).keys.find((entry) => entry.name === name);
  if (!listed) throw new Error(`No key named ${name}`);
  const copied = await copyAction(args(new Request(`${origin}/settings/api-keys/copy`, {
    method: "POST",
    headers: { Cookie: holder.cookie, Origin: origin },
    body: new URLSearchParams({ csrfToken: holder.csrf, keyId: String(listed.id) }),
  })));
  return ((await copied.json()) as { key: string }).key;
}
function storedEvents(userId: number, idempotencyKey?: string) {
  const client = getApplicationDatabase().getClient();
  return client.select().from(waterEvents)
    .where(idempotencyKey === undefined ? eq(waterEvents.userId, userId) : and(eq(waterEvents.userId, userId), eq(waterEvents.idempotencyKey, idempotencyKey)))
    .all();
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "mcp-log-water-route-"));
  vi.stubEnv("APPLICATION_URL", origin);
  vi.stubEnv("DATABASE_PATH", path.join(directory, "application.sqlite"));
  vi.stubEnv("APPLICATION_SECRETS_PATH", path.join(directory, "secrets"));
  vi.stubEnv("FOOD_LOG_TEST_NOW", "2026-08-31T16:00:00.000Z");
  vi.stubEnv("SETUP_TEST_NOW", "2026-08-31T16:00:00.000Z");
  initializeApplicationDatabase();
  const administrator = await getAuthenticationService().register("mcp.water.admin", "correct horse battery staple", "203.0.113.9");
  if (!administrator.ok) throw new Error("Could not register owner");
  owner = await account("mcp.water.owner");
  completeSetup(owner.id, "us", "80");
  writer = await createKey(owner, "Assistant", ["daily-log:read", "water-log:write"]);
  reader = await createKey(owner, "Reader", ["daily-log:read"]);
});
afterAll(async () => {
  shutdownCredentialStorage();
  shutdownApplicationDatabase();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

test("log_water is listed and callable only with water-log:write, and a Log water key alone can use the MCP", async () => {
  const listed = async (key: string) => ((await rpc(key, "tools/list")).result?.tools as { name: string; title?: string; annotations?: Record<string, unknown>; inputSchema: { properties: Record<string, unknown>; required?: string[] } }[]);

  expect((await listed(reader)).map((tool) => tool.name)).toEqual(["get_daily_log"]);
  const before = storedEvents(owner.id).length;
  const refused = await callTool(reader, "log_water", { idempotencyKey: freshKey(), glasses: 1 });
  expect(refused.isError).toBe(true);
  expect(storedEvents(owner.id)).toHaveLength(before);

  const waterOnly = await createKey(owner, "Water only", ["water-log:write"]);
  const tools = await listed(waterOnly);
  expect(tools.map((tool) => tool.name)).toEqual(["log_water"]);
  expect(tools[0].title).toBe("Log water to the Food Log");
  expect(tools[0].annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  expect(Object.keys(tools[0].inputSchema.properties).sort()).toEqual(["bottles", "date", "glasses", "idempotencyKey", "large"]);
  expect(tools[0].inputSchema.required).toEqual(["idempotencyKey"]);
  expect((await logWater({ date: "2026-08-29", glasses: 1 }, waterOnly)).isError).toBeFalsy();

  expect((await listed(writer)).map((tool) => tool.name).sort()).toEqual(["get_daily_log", "log_water"]);
});

test("logging for today uses the current local time and returns the Water Event, replayed, and the day summary", async () => {
  const idempotencyKey = freshKey();
  const result = await callTool(writer, "log_water", { idempotencyKey, glasses: 2, bottles: 1 });
  expect(result.isError).toBeFalsy();
  const structured = result.structuredContent as { waterEvent: { id: number }; dailyLog: Record<string, unknown> };
  expect(structured).toMatchObject({
    waterEvent: {
      date: today,
      time: "12:00",
      amountMl: 946,
      amount: 32,
      unit: "fl oz",
      containers: { glasses: 2, bottles: 1, large: 0 },
    },
    replayed: false,
  });
  const [stored] = storedEvents(owner.id, `mcp:${idempotencyKey}`);
  expect(structured.waterEvent.id).toBe(stored.id);

  const dailyLog = await callTool(writer, "get_daily_log", { date: today });
  expect(structured.dailyLog).toEqual(dailyLog.structuredContent);
  expect(dailyLog.structuredContent).toMatchObject({ water: { unit: "fl oz", consumed: 32, goal: 80, remaining: 48 } });
  expect(result.content).toEqual([{ type: "text", text: "Logged 2 glasses and 1 bottle (32 fl oz) on 2026-08-31. Water today: 32 of 80 fl oz, 48 fl oz remaining." }]);

  // Today takes the current local time even when that minute is taken; a past day would move to 12:01.
  expect((await logWater({ glasses: 1 })).structuredContent).toMatchObject({ waterEvent: { date: today, time: "12:00" } });
});

test("logging for a past day takes the next free slot from noon and reports that day's summary", async () => {
  const first = await logWater({ date: yesterday, large: 1 });
  const second = await logWater({ date: yesterday, bottles: 1 });
  expect(first.structuredContent).toMatchObject({ waterEvent: { date: yesterday, time: "12:00", amountMl: 710, amount: 24, containers: { large: 1 } } });
  expect(second.structuredContent).toMatchObject({
    waterEvent: { date: yesterday, time: "12:01", amountMl: 473, amount: 16, containers: { glasses: 0, bottles: 1, large: 0 } },
    dailyLog: { date: yesterday, today, water: { unit: "fl oz", consumed: 40, goal: null, remaining: null } },
  });
  const dailyLog = await callTool(writer, "get_daily_log", { date: yesterday });
  expect((second.structuredContent as { dailyLog: unknown }).dailyLog).toEqual(dailyLog.structuredContent);
  expect(second.content[0].text).toBe("Logged 1 bottle (16 fl oz) on 2026-08-30. Water on 2026-08-30: 40 fl oz (no goal set).");
});

test("metric accounts get the amount and day summary in ml", async () => {
  const metric = await account("mcp.water.metric");
  completeSetup(metric.id, "metric", "2000");
  const key = await createKey(metric, "Metric assistant", ["water-log:write"]);
  const result = await logWater({ large: 1, glasses: 1 }, key);
  expect(result.structuredContent).toMatchObject({
    waterEvent: { amountMl: 946, amount: 946, unit: "ml", containers: { glasses: 1, bottles: 0, large: 1 } },
    dailyLog: { water: { unit: "ml", consumed: 946, goal: 2000, remaining: 1054 } },
  });
  expect(result.content[0].text).toBe("Logged 1 glass and 1 large (946 ml) on 2026-08-31. Water today: 946 of 2000 ml, 1054 ml remaining.");
});

test("a same-key retry replays the original, and changed counts or a changed explicit date are a conflict", async () => {
  const idempotencyKey = freshKey();
  const original = await callTool(writer, "log_water", { idempotencyKey, bottles: 1 });
  const replay = await callTool(writer, "log_water", { idempotencyKey, bottles: 1, glasses: 0 });
  expect(replay.isError).toBeFalsy();
  const { replayed: _replayed, dailyLog: _dailyLog, ...originalEvent } = original.structuredContent!;
  expect(replay.structuredContent).toMatchObject({ ...originalEvent, replayed: true });
  expect((replay.structuredContent as { dailyLog: unknown }).dailyLog).toEqual((await callTool(writer, "get_daily_log", { date: today })).structuredContent);
  expect(replay.content[0].text).toMatch(/^Already logged 1 bottle \(16 fl oz\) on 2026-08-31/u);
  expect((await callTool(writer, "log_water", { idempotencyKey, bottles: 1, date: today })).structuredContent).toMatchObject({ replayed: true });
  expect(storedEvents(owner.id, `mcp:${idempotencyKey}`)).toHaveLength(1);

  for (const changed of [{ bottles: 2 }, { glasses: 1 }, { bottles: 1, date: yesterday }]) {
    await expectToolError(callTool(writer, "log_water", { idempotencyKey, ...changed }), /idempotencyKey.*already used/iu);
  }
  expect(storedEvents(owner.id, `mcp:${idempotencyKey}`)).toHaveLength(1);
});

test("the same caller key through REST and MCP creates two separate Water Events", async () => {
  const idempotencyKey = "shared-between-channels";
  const rest = await logWaterRest(args(new Request(`${origin}/api/v1/water-events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${writer}`, "Idempotency-Key": idempotencyKey, "Content-Type": "application/json", "X-Open-Calory-Client-IP": freshIp() },
    body: JSON.stringify({ foodLogDate: today, glasses: 1 }),
  })));
  expect(rest.status).toBe(201);
  const mcp = await callTool(writer, "log_water", { idempotencyKey, glasses: 1 });
  expect(mcp.structuredContent).toMatchObject({ replayed: false });
  const [restEvent] = storedEvents(owner.id, `api:${idempotencyKey}`);
  const [mcpEvent] = storedEvents(owner.id, `mcp:${idempotencyKey}`);
  expect(mcpEvent.id).not.toBe(restEvent.id);
});

test("idempotencyKey is required, 8 to 124 characters from A-Z a-z 0-9 . _ : -", async () => {
  const before = storedEvents(owner.id).length;
  await expectToolError(callTool(writer, "log_water", { glasses: 1 }), /idempotencyKey/u);
  for (const idempotencyKey of ["", "a".repeat(7), "a".repeat(125), "has space", "slash/key1", 12345678]) {
    await expectToolError(callTool(writer, "log_water", { idempotencyKey, glasses: 1 }), /idempotencyKey.*8.*124/u);
  }
  expect(storedEvents(owner.id)).toHaveLength(before);
  for (const idempotencyKey of ["c".repeat(8), "d".repeat(124), "Az09._:-"]) {
    expect((await callTool(writer, "log_water", { idempotencyKey, glasses: 1 })).isError).toBeFalsy();
    expect(storedEvents(owner.id, `mcp:${idempotencyKey}`)).toHaveLength(1);
  }
});

test("future and invalid dates are tool errors", async () => {
  const before = storedEvents(owner.id).length;
  await expectToolError(logWater({ date: "2026-09-01", glasses: 1 }), /future/iu);
  for (const date of ["2026-02-30", "yesterday", "2026-8-1"]) {
    await expectToolError(logWater({ date, glasses: 1 }), /date.*YYYY-MM-DD/u);
  }
  expect(storedEvents(owner.id)).toHaveLength(before);
});

test("counts must be whole, non-negative, at least one container, and at most 500 fl oz", async () => {
  const before = storedEvents(owner.id).length;
  await expectToolError(logWater({ glasses: 0.5 }), /fractions are not accepted/iu);
  await expectToolError(logWater({ bottles: 1.5 }), /fractions are not accepted/iu);
  await expectToolError(logWater({ glasses: -1, bottles: 1 }), /negative/iu);
  await expectToolError(logWater({}), /at least one/iu);
  await expectToolError(logWater({ glasses: 0, bottles: 0, large: 0 }), /at least one/iu);
  await expectToolError(logWater({ large: 21 }), /500 fl oz/u);
  await expectToolError(logWater({ glasses: "1" }), /glasses/u);
  expect(storedEvents(owner.id)).toHaveLength(before);
  expect((await logWater({ large: 20, glasses: 2 })).isError).toBeFalsy();
});

test("an account without finished setup gets the same message as get_daily_log", async () => {
  const incomplete = await account("mcp.water.incomplete");
  const key = await createKey(incomplete, "Early assistant", ["daily-log:read", "water-log:write"]);
  const dailyLog = await callTool(key, "get_daily_log", {});
  expect(dailyLog.isError).toBe(true);
  await expectToolError(logWater({ glasses: 1 }, key), new RegExp(`^${dailyLog.content[0].text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "u"));
  expect(storedEvents(incomplete.id)).toHaveLength(0);
});
