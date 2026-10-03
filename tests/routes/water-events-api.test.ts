import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import { shutdownCredentialStorage } from "../../app/credentials/runtime.server";
import { getApplicationDatabase, initializeApplicationDatabase, shutdownApplicationDatabase } from "../../app/database/runtime.server";
import { loader as readDailyLog } from "../../app/routes/api.v1.daily-log";
import { action as mcpAction } from "../../app/routes/mcp";
import { action as keysAction, loader as keysLoader } from "../../app/routes/settings.api-keys";
import { action as copyAction } from "../../app/routes/settings.api-keys.copy";
import { getGoalSetupService } from "../../app/setup/runtime.server";
import { validateSetupFields } from "../../app/setup/validation";
import { action as waterAction, headers as waterHeaders, loader as waterLoader } from "../../app/water-event/routes/api.v1.water-events";
import { getWaterEventService } from "../../app/water-event/runtime.server";
import { seedAuthenticatedAccount } from "../support/authentication";

const origin = "http://localhost:3000";
const now = "2026-08-31T16:00:00.000Z";
type Account = { id: number; cookie: string; csrf: string };
type ToolResult = { isError?: boolean; structuredContent?: Record<string, unknown>; content: { type: string; text: string }[] };
let directory: string;
let owner: Account;
let other: Account;
let writerKey: string;
let readerKey: string;
let otherKey: string;
let ipCounter = 0;

function args(request: Request, pattern = "/api/v1/water-events") {
  return { request, params: {}, context: new RouterContextProvider(), pattern, url: new URL(request.url) };
}
function freshIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}
function rest(key: string | null, method: string, options: { body?: string; query?: string } = {}) {
  const headers = new Headers({ "X-Open-Calory-Client-IP": freshIp(), "Content-Type": "application/json" });
  if (key !== null) headers.set("Authorization", `Bearer ${key}`);
  const request = new Request(`${origin}/api/v1/water-events${options.query ? `?${options.query}` : ""}`, {
    method, headers, body: options.body,
  });
  return method === "GET" ? waterLoader(args(request)) : waterAction(args(request));
}
const post = (key: string, body: unknown) => rest(key, "POST", { body: typeof body === "string" ? body : JSON.stringify(body) });
const remove = (key: string, body: unknown) => rest(key, "DELETE", { body: JSON.stringify(body) });
const list = (key: string, query: string) => rest(key, "GET", { query });

async function callTool(key: string, name: string, toolArguments: Record<string, unknown>): Promise<ToolResult> {
  const response = await mcpAction(args(new Request(`${origin}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "X-Open-Calory-Client-IP": freshIp(),
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: toolArguments } }),
  }), "/mcp"));
  const body = await response.json() as { result: ToolResult };
  return body.result;
}
async function listTools(key: string): Promise<{ name: string; annotations?: Record<string, unknown> }[]> {
  const response = await mcpAction(args(new Request(`${origin}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "X-Open-Calory-Client-IP": freshIp(),
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  }), "/mcp"));
  return ((await response.json()) as { result: { tools: { name: string }[] } }).result.tools;
}

async function account(username: string): Promise<Account> {
  const session = await seedAuthenticatedAccount(getAuthenticationService(), getApplicationDatabase().getClient(), username, "correct horse battery staple", "203.0.113.10");
  const setup = validateSetupFields({
    calories: "2050", carbohydrate: "230", displayUnits: "us", fat: "70", fiber: "25",
    protein: "120", sodium: "2300", sugar: "50", timeZone: "America/New_York", water: "80",
  });
  if (!setup.success) throw new Error("Invalid test setup");
  getGoalSetupService().completeInitial(session.user.id, setup.data);
  return { id: session.user.id, cookie: serializeSessionCookie(session).split(";", 1)[0], csrf: session.csrfToken };
}
async function createKey(holder: Account, name: string, scopes: string[]): Promise<string> {
  const request = (url: string, fields: [string, string][]) => new Request(`${origin}${url}`, {
    method: "POST",
    headers: { Cookie: holder.cookie, Origin: origin },
    body: new URLSearchParams([["csrfToken", holder.csrf], ...fields]),
  });
  await keysAction(args(request("/settings/api-keys", [
    ["intent", "create"], ["name", name], ["expiration", "90d"], ...scopes.map((scope): [string, string] => ["scope", scope]),
  ]), "/settings/api-keys"));
  const listed = (await keysLoader(args(new Request(`${origin}/settings/api-keys`, { headers: { Cookie: holder.cookie } }), "/settings/api-keys")))
    .keys.find((entry) => entry.name === name);
  if (!listed) throw new Error(`No key named ${name}`);
  expect(listed.scopes).toEqual(scopes);
  const copied = await copyAction(args(request("/settings/api-keys/copy", [["keyId", String(listed.id)]]), "/settings/api-keys/copy"));
  return ((await copied.json()) as { key: string }).key;
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "water-events-api-"));
  vi.stubEnv("APPLICATION_URL", origin);
  vi.stubEnv("DATABASE_PATH", path.join(directory, "application.sqlite"));
  vi.stubEnv("APPLICATION_SECRETS_PATH", path.join(directory, "secrets"));
  vi.stubEnv("FOOD_LOG_TEST_NOW", now);
  vi.stubEnv("SETUP_TEST_NOW", now);
  initializeApplicationDatabase();
  const administrator = await getAuthenticationService().register("water.admin", "correct horse battery staple", "203.0.113.9");
  if (!administrator.ok) throw new Error("Could not register administrator");
  owner = await account("water.api.owner");
  other = await account("water.api.other");
  writerKey = await createKey(owner, "Writer", ["daily-log:read", "water-events:read", "water-events:write"]);
  readerKey = await createKey(owner, "Reader", ["water-events:read"]);
  otherKey = await createKey(other, "Other", ["water-events:read", "water-events:write"]);
});
afterAll(async () => {
  shutdownCredentialStorage();
  shutdownApplicationDatabase();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

test("POST creates and edits a Water Event, returning it without its owner", async () => {
  const created = await post(writerKey, { logDate: "2026-08-31T10:45:00-04:00", ounces: 12.5, source: "smart bottle" });
  expect(created.status).toBe(201);
  expect(created.headers.get("Cache-Control")).toBe("private, no-store");
  const event = await created.json() as Record<string, unknown>;
  expect(event).toEqual({
    id: expect.any(Number) as unknown,
    logDate: "2026-08-31T14:45:00.000Z",
    ounces: 12.5,
    createdAt: now,
    updatedAt: now,
  });

  const edited = await post(writerKey, { id: event.id, logDate: "2026-08-30T08:00:00Z", ounces: 16 });
  expect(edited.status).toBe(200);
  expect(await edited.json()).toEqual({ ...event, ounces: 16, updatedAt: "2026-08-31T16:00:00.001Z" });

  const notOwned = await post(otherKey, { id: event.id, ounces: 1 });
  expect(notOwned.status).toBe(404);
  expect(await notOwned.json()).toEqual({ error: "not_found" });
  expect(waterHeaders()).toEqual({ "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" });
});

test.each([
  ["{not json", "invalid_input"],
  [[], "invalid_input"],
  [{ id: "1", ounces: 8 }, "invalid_input"],
  [{ id: 0, ounces: 8 }, "invalid_input"],
  [{ logDate: "2026-08-31T10:00:00Z", ounces: "8" }, "invalid_amount"],
  [{ logDate: "2026-08-31T10:00:00Z", ounces: 500.5 }, "invalid_amount"],
  [{ logDate: "2026-08-31T10:00:00Z", ounces: 12.3456 }, "invalid_amount"],
  [{ logDate: "2026-08-31T10:00:00", ounces: 8 }, "invalid_log_date"],
  [{ logDate: "2026-08-31T16:05:01Z", ounces: 8 }, "invalid_log_date"],
  [{ ounces: 8 }, "invalid_log_date"],
])("POST %j is rejected as %s", async (body, error) => {
  const response = await post(writerKey, body);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error });
});

test("POST bodies are capped at 16 KiB as received, without buffering more or creating an event", async () => {
  const limit = 16 * 1024;
  const sized = (bytes: number, logDate: string) => {
    const base = JSON.stringify({ logDate, ounces: 8, note: "" });
    return JSON.stringify({ logDate, ounces: 8, note: "x".repeat(bytes - base.length) });
  };
  const atLimit = await post(writerKey, sized(limit, "2026-08-29T10:00:00Z"));
  expect(atLimit.status).toBe(201);

  const overLimit = await post(writerKey, sized(limit + 1, "2026-08-29T11:00:00Z"));
  expect(overLimit.status).toBe(413);
  expect(await overLimit.json()).toEqual({ error: "payload_too_large" });

  const declared = new Request(`${origin}/api/v1/water-events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${writerKey}`, "Content-Length": String(limit + 1), "X-Open-Calory-Client-IP": freshIp() },
    body: sized(limit + 1, "2026-08-29T12:00:00Z"),
  });
  expect((await waterAction(args(declared))).status).toBe(413);

  const encoder = new TextEncoder();
  const chunks = [sized(limit + 1, "2026-08-29T13:00:00Z").slice(0, limit / 2), sized(limit + 1, "2026-08-29T13:00:00Z").slice(limit / 2)];
  const streamed = new Request(`${origin}/api/v1/water-events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${writerKey}`, "X-Open-Calory-Client-IP": freshIp() },
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit);
  expect((await waterAction(args(streamed))).status).toBe(413);

  const day = await list(writerKey, "from=2026-08-29T00%3A00%3A00Z&to=2026-08-30T00%3A00%3A00Z");
  const events = ((await day.json()) as { events: { id: number; logDate: string }[] }).events;
  expect(events.map((event) => event.logDate)).toEqual(["2026-08-29T10:00:00.000Z"]);
  expect((await remove(writerKey, { eventIds: events.map((event) => event.id) })).status).toBe(200);
});

test("POST accepts a consumption time up to five minutes ahead of the server clock", async () => {
  const response = await post(writerKey, { logDate: "2026-08-31T16:05:00Z", ounces: 0.001 });
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ logDate: "2026-08-31T16:05:00.000Z", ounces: 0.001 });
});

test("GET lists the caller's events in a range with the total; DELETE removes owned IDs only", async () => {
  const save = async (key: string, logDate: string, ounces: number) => (await post(key, { logDate, ounces })).json() as Promise<{ id: number }>;
  const early = await save(writerKey, "2026-08-30T08:00:00Z", 8);
  const late = await save(writerKey, "2026-08-30T20:00:00Z", 0.5);
  await save(writerKey, "2026-08-29T23:59:59Z", 100);
  const foreign = await save(otherKey, "2026-08-30T12:00:00Z", 24);

  const range = "from=2026-08-30T00%3A00%3A00Z&to=2026-08-31T00%3A00%3A00%2B00%3A00";
  const listed = await list(readerKey, range);
  expect(listed.status).toBe(200);
  expect(await listed.json()).toMatchObject({
    events: [{ id: late.id, ounces: 0.5 }, { id: early.id, ounces: 8 }],
    totalOunces: 8.5,
  });
  expect(await (await list(readerKey, "from=2026-08-30T00:00:00Z&to=2026-08-30T00:00:01Z")).json()).toEqual({ events: [], totalOunces: 0 });

  for (const query of ["from=2026-08-30T00:00:00Z", `${range}&from=2026-08-29T00:00:00Z`, "from=2026-08-31T00:00:00Z&to=2026-08-30T00:00:00Z", "from=yesterday&to=today"]) {
    const response = await list(readerKey, query);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_range" });
  }

  const deleted = await remove(writerKey, { eventIds: [early.id, early.id, foreign.id] });
  expect(await deleted.json()).toEqual({ deletedCount: 1 });
  expect(await (await remove(writerKey, { eventIds: [early.id] })).json()).toEqual({ deletedCount: 0 });
  expect(await (await remove(writerKey, { eventIds: [] })).json()).toEqual({ deletedCount: 0 });
  expect(getWaterEventService().read(other.id, foreign.id).ounces).toBe("24");
  for (const body of [{ eventIds: [0] }, { eventIds: ["1"] }, { eventIds: 1 }, { ids: [1] }]) {
    const response = await remove(writerKey, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_event_ids" });
  }
});

test("the daily Food Log presents its Water Events in the same shape", async () => {
  const created = await (await post(writerKey, { logDate: "2026-08-28T13:00:00Z", ounces: 8.25 })).json() as Record<string, unknown>;
  const request = new Request(`${origin}/api/v1/daily-log?date=2026-08-28`, {
    headers: { Authorization: `Bearer ${writerKey}`, "X-Open-Calory-Client-IP": freshIp() },
  });
  const body = await readDailyLog(args(request, "/api/v1/daily-log")).json() as Record<string, unknown>;
  expect(body).toMatchObject({ waterEvents: [created], events: [{ kind: "water", ...created }], waterTotalOunces: 8.25 });
});

test("REST requires the matching water permission and supports only GET, POST, and DELETE", async () => {
  const readOnly = await post(readerKey, { logDate: "2026-08-31T10:00:00Z", ounces: 8 });
  expect(readOnly.status).toBe(403);
  expect(readOnly.headers.get("WWW-Authenticate")).toBe('Bearer realm="water-events", error="insufficient_scope", scope="water-events:write"');
  const dailyOnly = await createKey(owner, "Daily only", ["daily-log:read"]);
  expect((await list(dailyOnly, "from=2026-08-30T00:00:00Z&to=2026-08-31T00:00:00Z")).status).toBe(403);
  expect((await rest(null, "GET", { query: "from=2026-08-30T00:00:00Z&to=2026-08-31T00:00:00Z" })).status).toBe(401);
  const put = await rest(writerKey, "PUT", { body: "{}" });
  expect(put.status).toBe(405);
  expect(put.headers.get("Allow")).toBe("GET, POST, DELETE");
});

test("MCP lists water tools by scope and logs, lists, and deletes water", async () => {
  expect((await listTools(writerKey)).map((tool) => tool.name)).toEqual(["get_daily_log", "log_water", "list_water", "delete_water"]);
  expect((await listTools(readerKey)).map((tool) => tool.name)).toEqual(["list_water"]);
  expect((await listTools(writerKey)).find((tool) => tool.name === "delete_water")?.annotations)
    .toMatchObject({ destructiveHint: true, idempotentHint: true, readOnlyHint: false });

  const created = await callTool(writerKey, "log_water", { logDate: "2026-08-27T09:30:00-04:00", ounces: 12.5 });
  expect(created.isError).toBeFalsy();
  const event = (created.structuredContent as { event: { id: number } }).event;
  expect(created.structuredContent).toEqual({
    event: { id: event.id, logDate: "2026-08-27T13:30:00.000Z", ounces: 12.5, createdAt: now, updatedAt: now },
    day: { date: "2026-08-27", totalOunces: 12.5 },
  });
  // The text carries what the agent needs; its wording is not a contract.
  expect(created.content[0].text).toEqual(expect.stringMatching(/12\.5 fl oz.*2026-08-27T13:30:00\.000Z.*2026-08-27: 12\.5 fl oz/));

  const edited = await callTool(writerKey, "log_water", { id: event.id, logDate: "2026-08-20T09:30:00Z", ounces: 20 });
  expect(edited.structuredContent).toMatchObject({
    event: { id: event.id, logDate: "2026-08-27T13:30:00.000Z", ounces: 20 },
    day: { date: "2026-08-27", totalOunces: 20 },
  });
  expect(edited.content[0].text).toEqual(expect.stringMatching(new RegExp(`${event.id}.*20 fl oz.*2026-08-27: 20 fl oz`)));

  const listed = await callTool(readerKey, "list_water", { from: "2026-08-27T00:00:00-04:00", to: "2026-08-28T00:00:00-04:00" });
  expect(listed.structuredContent).toMatchObject({ events: [{ id: event.id, ounces: 20 }], totalOunces: 20 });
  expect(listed.content[0].text).toEqual(expect.stringMatching(/1 water event\b.*20 fl oz/));

  const deleted = await callTool(writerKey, "delete_water", { eventIds: [event.id, event.id] });
  expect(deleted.structuredContent).toEqual({ deletedCount: 1 });
  expect(deleted.content[0].text).toEqual(expect.stringMatching(/\b1 water event\b/));
  expect((await callTool(writerKey, "delete_water", { eventIds: [event.id] })).content[0].text).toEqual(expect.stringMatching(/\b0 water events\b/));
});

test("unexpected failures propagate instead of becoming water errors", async () => {
  const service = getWaterEventService();
  const original = service.list.bind(service);
  const unexpected = new Error("unexpected water failure");
  service.list = () => {
    throw unexpected;
  };
  try {
    await expect(Promise.resolve().then(() => list(readerKey, "from=2026-08-30T00:00:00Z&to=2026-08-31T00:00:00Z"))).rejects.toBe(unexpected);
    const result = await mcpAction(args(new Request(`${origin}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${readerKey}`,
        "X-Open-Calory-Client-IP": freshIp(),
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_water", arguments: { from: "2026-08-30T00:00:00Z", to: "2026-08-31T00:00:00Z" } } }),
    }), "/mcp"));
    const body = await result.json() as { result: ToolResult };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("unexpected water failure");
  } finally {
    service.list = original;
  }
});

test("MCP water refusals are tool errors the agent can act on", async () => {
  const refusal = async (key: string, name: string, toolArguments: Record<string, unknown>) => {
    const result = await callTool(key, name, toolArguments);
    expect(result.isError).toBe(true);
    return result.content[0].text;
  };
  expect(await refusal(writerKey, "log_water", { ounces: 8 })).toContain("ISO date-time with an offset");
  expect(await refusal(writerKey, "log_water", { logDate: "2026-08-27T09:30:00Z", ounces: 0 })).toContain("0.001 to 500 fl oz");
  expect(await refusal(writerKey, "log_water", { logDate: "2026-08-27T09:30:00Z", ounces: 1.2345 })).toContain("at most three decimals");
  expect(await refusal(writerKey, "log_water", { logDate: "2026-08-27T09:30:00Z", ounces: "8" })).toContain("expected number");
  expect(await refusal(writerKey, "log_water", { id: 999_999, ounces: 1 })).toBe("Water event not found.");
  expect(await refusal(writerKey, "list_water", { from: "2026-08-28T00:00:00Z", to: "2026-08-27T00:00:00Z" })).toContain("from before to");
  expect(await refusal(writerKey, "delete_water", { eventIds: Array.from({ length: 101 }, (_, index) => index + 1) })).toContain("at most 100");
  expect(await refusal(readerKey, "log_water", { logDate: "2026-08-27T09:30:00Z", ounces: 1 })).toContain("disabled");
});

test("water stays unavailable until the account finishes setup, as the daily Food Log does", async () => {
  const session = await seedAuthenticatedAccount(getAuthenticationService(), getApplicationDatabase().getClient(), "water.api.unconfigured", "correct horse battery staple", "203.0.113.11");
  const holder = { id: session.user.id, cookie: serializeSessionCookie(session).split(";", 1)[0], csrf: session.csrfToken };
  const key = await createKey(holder, "Before setup", ["daily-log:read", "water-events:read", "water-events:write"]);

  for (const response of [
    await post(key, { logDate: "2026-08-31T10:00:00Z", ounces: 8 }),
    await list(key, "from=2026-08-30T00:00:00Z&to=2026-08-31T00:00:00Z"),
    await remove(key, { eventIds: [1] }),
  ]) {
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "missing_setup" });
  }
  const dailyLog = await callTool(key, "get_daily_log", {});
  for (const [name, toolArguments] of [
    ["log_water", { logDate: "2026-08-31T10:00:00Z", ounces: 8 }],
    ["list_water", { from: "2026-08-30T00:00:00Z", to: "2026-08-31T00:00:00Z" }],
    ["delete_water", { eventIds: [1] }],
  ] as const) {
    const result = await callTool(key, name, toolArguments);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(dailyLog.content[0].text);
  }
});
