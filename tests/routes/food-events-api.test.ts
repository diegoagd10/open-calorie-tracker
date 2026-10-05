import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import { action as catalogAction, loader as catalogLoader } from "../../app/catalog/routes/api.v1.catalog";
import { getOpenFoodFactsClient } from "../../app/catalog/runtime.server";
import { TEST_CATALOG_GENERATION } from "../../app/catalog/test-fixture.server";
import { shutdownCredentialStorage } from "../../app/credentials/runtime.server";
import { getApplicationDatabase, initializeApplicationDatabase, shutdownApplicationDatabase } from "../../app/database/runtime.server";
import { action as foodAction, headers as foodHeaders, loader as foodLoader } from "../../app/food-event/routes/api.v1.food-events";
import { getFoodEventService } from "../../app/food-event/runtime.server";
import { loader as readDailyLog } from "../../app/routes/api.v1.daily-log";
import { action as mcpAction } from "../../app/routes/mcp";
import { action as keysAction, loader as keysLoader } from "../../app/routes/settings.api-keys";
import { action as copyAction } from "../../app/routes/settings.api-keys.copy";
import { completeTestSetup } from "../support/setup";
import { seedAuthenticatedAccount } from "../support/authentication";
import { fakeOffApi, offApiFixtureReplies } from "../support/off-api";

const origin = "http://localhost:3000";
const now = "2026-08-31T16:00:00.000Z";
type Account = { id: number; cookie: string; csrf: string };
type ToolResult = { isError?: boolean; structuredContent?: Record<string, unknown>; content: { type: string; text: string }[] };
type Presented = Record<string, unknown> & { id: number; updatedAt: string };
let directory: string;
let owner: Account;
let other: Account;
let writerKey: string;
let readerKey: string;
let otherKey: string;
let catalogKey: string;
let ipCounter = 0;
const offApi = fakeOffApi(offApiFixtureReplies());

function args(request: Request, pattern = "/api/v1/food-events") {
  return { request, params: {}, context: new RouterContextProvider(), pattern, url: new URL(request.url) };
}
function freshIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}
function rest(key: string | null, method: string, options: { body?: string; query?: string } = {}) {
  const headers = new Headers({ "X-Open-Calory-Client-IP": freshIp(), "Content-Type": "application/json" });
  if (key !== null) headers.set("Authorization", `Bearer ${key}`);
  const request = new Request(`${origin}/api/v1/food-events${options.query ? `?${options.query}` : ""}`, {
    method, headers, body: options.body,
  });
  return method === "GET" ? foodLoader(args(request)) : foodAction(args(request));
}
const post = (key: string, body: unknown) => rest(key, "POST", { body: typeof body === "string" ? body : JSON.stringify(body) });
const remove = (key: string, body: unknown) => rest(key, "DELETE", { body: JSON.stringify(body) });
const list = (key: string, query: string) => rest(key, "GET", { query });
function catalog(key: string | null, query: string, method = "GET") {
  const headers = new Headers({ "X-Open-Calory-Client-IP": freshIp() });
  if (key !== null) headers.set("Authorization", `Bearer ${key}`);
  const request = new Request(`${origin}/api/v1/catalog?${query}`, { headers, method });
  return method === "GET" ? catalogLoader(args(request, "/api/v1/catalog")) : Promise.resolve(catalogAction());
}

async function mcp(key: string, body: Record<string, unknown>) {
  const response = await mcpAction(args(new Request(`${origin}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "X-Open-Calory-Client-IP": freshIp(),
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }),
  }), "/mcp"));
  return response.json() as Promise<{ result: Record<string, unknown> }>;
}
async function callTool(key: string, name: string, toolArguments: Record<string, unknown>): Promise<ToolResult> {
  return (await mcp(key, { method: "tools/call", params: { name, arguments: toolArguments } })).result as ToolResult;
}
async function listTools(key: string): Promise<{ name: string; annotations?: Record<string, unknown> }[]> {
  return (await mcp(key, { method: "tools/list" })).result.tools as { name: string }[];
}

async function account(username: string, setup = true): Promise<Account> {
  const session = await seedAuthenticatedAccount(getAuthenticationService(), getApplicationDatabase().getClient(), username, "correct horse battery staple", "203.0.113.10");
  if (setup) completeTestSetup(session.user.id);
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

const lookup = (change: Record<string, unknown> = {}) => ({
  method: "lookup",
  logDate: "2026-08-31T10:45:00-04:00",
  providerFoodId: "1001",
  reviewVersion: TEST_CATALOG_GENERATION,
  measurementId: "serving:g:170000000",
  quantity: "1.5",
  ...change,
});
const manual = (change: Record<string, unknown> = {}) => ({
  method: "manual",
  logDate: "2026-08-30T12:00:00Z",
  name: "Tortillas",
  quantity: 3,
  nutrition: { energyKcal: 180, proteinGrams: "6" },
  ...change,
});

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "food-events-api-"));
  vi.stubEnv("APPLICATION_URL", origin);
  vi.stubEnv("DATABASE_PATH", path.join(directory, "application.sqlite"));
  vi.stubEnv("APPLICATION_SECRETS_PATH", path.join(directory, "secrets"));
  vi.stubEnv("FOOD_CATALOG_TEST_FIXTURE", "1");
  vi.stubEnv("FOOD_LOG_TEST_NOW", now);
  vi.stubEnv("SETUP_TEST_NOW", now);
  vi.stubGlobal("fetch", offApi.fetch);
  initializeApplicationDatabase();
  const administrator = await getAuthenticationService().register("food.admin", "correct horse battery staple", "203.0.113.9");
  if (!administrator.ok) throw new Error("Could not register administrator");
  getOpenFoodFactsClient().saveContact("family@example.com");
  owner = await account("food.api.owner");
  other = await account("food.api.other");
  writerKey = await createKey(owner, "Writer", ["daily-log:read", "food-events:read", "food-events:write", "catalog:read"]);
  readerKey = await createKey(owner, "Reader", ["food-events:read"]);
  catalogKey = await createKey(owner, "Catalog", ["catalog:read"]);
  otherKey = await createKey(other, "Other", ["food-events:read", "food-events:write"]);
});
afterAll(async () => {
  shutdownCredentialStorage();
  shutdownApplicationDatabase();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

test("POST creates a reviewed catalog food and edits the version read, returning it without its owner", async () => {
  const created = await post(writerKey, { ...lookup(), source: "meal planner" });
  expect(created.status).toBe(201);
  expect(created.headers.get("Cache-Control")).toBe("private, no-store");
  const event = await created.json() as Presented;
  expect(event).toMatchObject({
    logDate: "2026-08-31T14:45:00.000Z",
    createdAt: now,
    updatedAt: now,
    name: "Plain nonfat Greek yogurt",
    provider: "usda-fdc",
    providerFoodId: "1001",
    selectedMeasurementId: "serving:g:170000000",
    quantity: "1.5",
    quantityMicrounits: 1_500_000,
    energyMilliKcal: 150_450,
    fiberMilligrams: null,
    favoriteId: null,
    copiedFromId: null,
  });
  expect(event).not.toHaveProperty("userId");
  expect(event).not.toHaveProperty("foodLogDate");

  const edited = await post(writerKey, { id: event.id, expectedUpdatedAt: event.updatedAt, changes: { quantity: 1, nutrition: { fiberGrams: 2 } }, logDate: "2026-08-20T08:00:00Z" });
  expect(edited.status).toBe(200);
  expect(await edited.json()).toMatchObject({
    id: event.id,
    logDate: event.logDate,
    quantity: "1",
    energyMilliKcal: 100_300,
    fiberMilligrams: 2_000,
    updatedAt: "2026-08-31T16:00:00.001Z",
  });

  const stale = await post(writerKey, { id: event.id, expectedUpdatedAt: event.updatedAt, changes: { name: "Stale" } });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ error: "edit_conflict", event: { id: event.id, updatedAt: "2026-08-31T16:00:00.001Z" } });

  const notOwned = await post(otherKey, { id: event.id, expectedUpdatedAt: event.updatedAt, changes: { quantity: 1 } });
  expect(notOwned.status).toBe(404);
  expect(await notOwned.json()).toEqual({ error: "not_found" });
  expect(foodHeaders()).toEqual({ "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" });
});

test("POST saves manual foods as totals for the quantity, favorites only when asked, and reuses favorites", async () => {
  const unsaved = await (await post(writerKey, manual())).json() as Presented;
  expect(unsaved).toMatchObject({ provider: "manual", energyMilliKcal: 180_000, proteinMilligrams: 6_000, quantity: "3", favoriteId: null });

  const saved = await (await post(writerKey, manual({ name: "Mexican tortilla", saveAsFavorite: true }))).json() as Presented;
  expect(saved.favoriteId).toEqual(expect.any(Number));
  const reused = await post(writerKey, { method: "favorite", logDate: "2026-08-31T12:00:00Z", favoriteId: saved.favoriteId });
  expect(reused.status).toBe(201);
  expect(await reused.json()).toMatchObject({ name: "Mexican tortilla", favoriteId: saved.favoriteId, energyMilliKcal: 180_000 });
  const foreign = await post(otherKey, { method: "favorite", logDate: "2026-08-31T12:00:00Z", favoriteId: saved.favoriteId });
  expect(foreign.status).toBe(404);
});

test("POST saves an Open Food Facts product while it matches the reviewed fingerprint", async () => {
  const reviewed = await catalog(catalogKey, "barcode=034000470693");
  const { food } = await reviewed.json() as { food: { reviewVersion: string; providerFoodId: string } };
  const created = await post(writerKey, {
    method: "barcode",
    logDate: "2026-08-29T12:00:00Z",
    providerFoodId: food.providerFoodId,
    reviewVersion: food.reviewVersion,
    measurementId: "serving",
    quantity: 2,
  });
  expect(created.status).toBe(201);
  expect(await created.json()).toMatchObject({ provider: "open-food-facts", providerFoodId: "0034000470693", energyMilliKcal: 360_000 });
  const changed = await post(writerKey, { method: "barcode", logDate: "2026-08-29T12:00:00Z", providerFoodId: "0034000470693", reviewVersion: "0".repeat(64), measurementId: "serving", quantity: 1 });
  expect(changed.status).toBe(409);
  expect(await changed.json()).toEqual({ error: "catalog_changed" });
});

test.each([
  ["{not json", 400, "invalid_input"],
  [[], 400, "invalid_input"],
  [{ id: "1", expectedUpdatedAt: now, changes: {} }, 400, "invalid_input"],
  [{ id: 1, changes: {} }, 400, "invalid_input"],
  [{ method: "photo", logDate: now }, 400, "invalid_input"],
  [lookup({ method: undefined }), 400, "invalid_input"],
  [lookup({ reviewVersion: "0".repeat(64) }), 400, "invalid_input"],
  [lookup({ quantity: "0" }), 400, "invalid_quantity"],
  [lookup({ quantity: 1.2345678 }), 400, "invalid_quantity"],
  [lookup({ measurementId: "invented" }), 400, "invalid_measurement"],
  [lookup({ logDate: "2026-08-31T10:00:00" }), 400, "invalid_log_date"],
  [lookup({ logDate: undefined }), 400, "invalid_log_date"],
  [lookup({ logDate: "2026-08-31T16:05:01Z" }), 422, "future_date"],
  [lookup({ reviewVersion: "00000000-0000-4000-8000-000000000002" }), 409, "catalog_changed"],
  [lookup({ providerFoodId: "4040" }), 404, "food_not_found"],
  [lookup({ providerFoodId: "8888" }), 503, "source_unavailable"],
  [manual({ nutrition: { proteinGrams: 6 } }), 400, "invalid_nutrition"],
  [manual({ name: " " }), 400, "invalid_input"],
  [{ method: "favorite", logDate: now, favoriteId: 999_999 }, 404, "not_found"],
])("POST %j is refused as %i %s", async (body, status, error) => {
  const response = await post(writerKey, body);
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error });
});

test("POST bodies are capped at 16 KiB as received", async () => {
  const limit = 16 * 1024;
  const base = JSON.stringify({ ...manual(), note: "" });
  const overLimit = await post(writerKey, JSON.stringify({ ...manual(), note: "x".repeat(limit + 1 - base.length) }));
  expect(overLimit.status).toBe(413);
  expect(await overLimit.json()).toEqual({ error: "payload_too_large" });
});

test("GET lists the caller's events in a range with totals and local days; DELETE removes versions all or none", async () => {
  const save = async (key: string, body: Record<string, unknown>) => (await post(key, body)).json() as Promise<Presented>;
  const early = await save(writerKey, manual({ logDate: "2026-08-27T13:00:00Z", nutrition: { energyKcal: 100 } }));
  const late = await save(writerKey, manual({ logDate: "2026-08-28T02:00:00Z", nutrition: { energyKcal: 50, sodiumMilligrams: 3 } }));
  const foreign = await save(otherKey, manual({ logDate: "2026-08-27T15:00:00Z" }));

  const range = "from=2026-08-27T00%3A00%3A00-04%3A00&to=2026-08-28T00%3A00%3A00-04%3A00";
  const listed = await list(readerKey, range);
  expect(listed.status).toBe(200);
  expect(await listed.json()).toMatchObject({
    events: [{ id: late.id }, { id: early.id }],
    totals: { energyMilliKcal: { known: 150_000, isIncomplete: false }, sodiumMilligrams: { known: 3, isIncomplete: true } },
    days: { "2026-08-27": { eventCount: 2 } },
  });
  for (const query of ["from=2026-08-27T00:00:00Z", `${range}&from=2026-08-26T00:00:00Z`, "from=2026-08-28T00:00:00Z&to=2026-08-27T00:00:00Z", "from=yesterday&to=today"]) {
    const response = await list(readerKey, query);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_range" });
  }

  const version = (event: Presented) => ({ id: event.id, expectedUpdatedAt: event.updatedAt });
  const withForeign = await remove(writerKey, { events: [version(early), version(foreign)] });
  expect(withForeign.status).toBe(404);
  const stale = await remove(writerKey, { events: [version(early), { ...version(late), expectedUpdatedAt: "2026-08-01T00:00:00Z" }] });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ error: "edit_conflict", event: { id: late.id } });
  expect(getFoodEventService().read(owner.id, early.id).id).toBe(early.id);
  expect(await (await remove(writerKey, { events: [version(early), version(late)] })).json()).toEqual({ deletedCount: 2 });
  expect(await (await remove(writerKey, { events: [] })).json()).toEqual({ deletedCount: 0 });
  expect(getFoodEventService().read(other.id, foreign.id).id).toBe(foreign.id);
  for (const body of [{ events: [{ id: 0, expectedUpdatedAt: now }] }, { events: [{ id: 1 }] }, { events: 1 }, { eventIds: [1] }]) {
    const response = await remove(writerKey, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_event_ids" });
  }
});

test("the daily Food Log presents its Food Events in the same shape", async () => {
  const created = await (await post(writerKey, manual({ logDate: "2026-08-26T13:00:00Z" }))).json() as Presented;
  const request = new Request(`${origin}/api/v1/daily-log?date=2026-08-26`, {
    headers: { Authorization: `Bearer ${writerKey}`, "X-Open-Calory-Client-IP": freshIp() },
  });
  const body = await readDailyLog(args(request, "/api/v1/daily-log")).json() as Record<string, unknown>;
  expect(body).toMatchObject({ version: "2", foodEvents: [created], events: [{ kind: "food", ...created }] });
});

test("REST requires the matching food permission and supports only GET, POST, and DELETE", async () => {
  const readOnly = await post(readerKey, manual());
  expect(readOnly.status).toBe(403);
  expect(readOnly.headers.get("WWW-Authenticate")).toBe('Bearer realm="food-events", error="insufficient_scope", scope="food-events:write"');
  expect((await list(catalogKey, "from=2026-08-30T00:00:00Z&to=2026-08-31T00:00:00Z")).status).toBe(403);
  expect((await rest(null, "GET", { query: "from=2026-08-30T00:00:00Z&to=2026-08-31T00:00:00Z" })).status).toBe(401);
  const put = await rest(writerKey, "PUT", { body: "{}" });
  expect(put.status).toBe(405);
  expect(put.headers.get("Allow")).toBe("GET, POST, DELETE");
});

test("the catalog REST API searches USDA, reviews one food, and looks barcodes up, under catalog:read", async () => {
  const searched = await catalog(catalogKey, "query=yogurt");
  expect(searched.status).toBe(200);
  expect(await searched.json()).toEqual({
    results: [{
      provider: "usda-fdc",
      providerFoodId: "1001",
      name: "Plain nonfat Greek yogurt",
      brand: "Example Dairy Co.",
      dataType: "Branded",
      measurementSummary: "1 container · 170 g",
      isSelectable: true,
      publishedDate: "2026-04-01",
    }],
  });
  const reviewed = await (await catalog(catalogKey, "providerFoodId=1001")).json() as { food: Record<string, unknown> };
  expect(reviewed.food).toMatchObject({
    provider: "usda-fdc",
    providerFoodId: "1001",
    reviewVersion: TEST_CATALOG_GENERATION,
    nutritionBasis: { quantity: 100, unit: "g" },
    nutrition: { energyKcal: 59, proteinG: 10.59, fiberG: null, sodiumMg: 36 },
    measurements: [{ id: "serving:g:170000000", label: "1 container (170 g)", quantity: 170, unit: "g" }, { id: "base:g:100000000", quantity: 100 }],
  });
  expect(await (await catalog(catalogKey, "barcode=034000470693")).json()).toMatchObject({
    food: { provider: "open-food-facts", providerFoodId: "0034000470693", name: "Example cereal", reviewVersion: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown },
  });

  for (const [query, status, error] of [
    ["", 400, "invalid_input"],
    ["query=yogurt&barcode=034000470693", 400, "invalid_input"],
    ["query=a", 400, "invalid_query"],
    ["providerFoodId=01", 400, "invalid_food_id"],
    ["barcode=123", 400, "invalid_barcode"],
    ["providerFoodId=4040", 404, "food_not_found"],
    ["barcode=0000000000001", 404, "food_not_found"],
    ["query=not-installed", 503, "catalog_not_installed"],
    ["query=unavailable", 503, "source_unavailable"],
    ["barcode=0000000000004", 503, "source_unavailable"],
  ] as const) {
    const response = await catalog(catalogKey, query);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  }
  expect((await catalog(readerKey, "query=yogurt")).status).toBe(403);
  expect((await catalog(catalogKey, "query=yogurt", "POST")).status).toBe(405);
});

test("MCP lists food and catalog tools by scope", async () => {
  expect((await listTools(writerKey)).map((tool) => tool.name)).toEqual([
    "get_daily_log", "log_food", "list_food", "delete_food", "search_foods", "get_food", "lookup_barcode",
  ]);
  expect((await listTools(readerKey)).map((tool) => tool.name)).toEqual(["list_food"]);
  expect((await listTools(catalogKey)).map((tool) => tool.name)).toEqual(["search_foods", "get_food", "lookup_barcode"]);
  expect((await listTools(writerKey)).find((tool) => tool.name === "delete_food")?.annotations)
    .toMatchObject({ destructiveHint: true, readOnlyHint: false });
});

test("an agent finds a food in the catalog, logs it, edits it, lists it, and deletes it", async () => {
  const searched = await callTool(writerKey, "search_foods", { query: "yogurt" });
  expect(searched.structuredContent).toMatchObject({ results: [{ providerFoodId: "1001" }] });
  expect(searched.content[0].text).toContain("1001: Plain nonfat Greek yogurt");

  const reviewed = await callTool(writerKey, "get_food", { providerFoodId: "1001" });
  const food = (reviewed.structuredContent as { food: { reviewVersion: string } }).food;
  expect(reviewed.content[0].text).toContain(`reviewVersion "${food.reviewVersion}"`);

  const created = await callTool(writerKey, "log_food", {
    method: "lookup", logDate: "2026-08-25T08:30:00-04:00", providerFoodId: "1001",
    reviewVersion: food.reviewVersion, measurementId: "serving:g:170000000", quantity: "1",
  });
  expect(created.isError).toBeFalsy();
  const event = (created.structuredContent as { event: Presented }).event;
  expect(created.structuredContent).toMatchObject({
    event: { logDate: "2026-08-25T12:30:00.000Z", name: "Plain nonfat Greek yogurt", energyMilliKcal: 100_300 },
    day: { date: "2026-08-25", energyMilliKcal: { known: 100_300, isIncomplete: false } },
  });
  expect(created.content[0].text).toEqual(expect.stringMatching(/Plain nonfat Greek yogurt.*100\.3 kcal.*2026-08-25: 100\.3 kcal/));

  const edited = await callTool(writerKey, "log_food", { id: event.id, expectedUpdatedAt: event.updatedAt, changes: { quantity: 2 } });
  expect(edited.structuredContent).toMatchObject({ event: { id: event.id, quantity: "2", energyMilliKcal: 200_600 } });
  const stale = await callTool(writerKey, "log_food", { id: event.id, expectedUpdatedAt: event.updatedAt, changes: { quantity: 3 } });
  expect(stale.isError).toBe(true);
  expect(stale.content[0].text).toContain("changed after you opened it. Review it and try again. Its current updatedAt is");

  const listed = await callTool(readerKey, "list_food", { from: "2026-08-25T00:00:00-04:00", to: "2026-08-26T00:00:00-04:00" });
  const current = (listed.structuredContent as { events: Presented[] }).events[0];
  expect(listed.structuredContent).toMatchObject({ events: [{ id: event.id }], totals: { energyMilliKcal: { known: 200_600 } } });
  expect(listed.content[0].text).toEqual(expect.stringMatching(/1 food event\b.*200\.6 kcal/));

  const deleted = await callTool(writerKey, "delete_food", { events: [{ id: event.id, expectedUpdatedAt: current.updatedAt }] });
  expect(deleted.structuredContent).toEqual({ deletedCount: 1 });
  expect(deleted.content[0].text).toEqual(expect.stringMatching(/\b1 food event\b/));
});

test("an agent logs a manual food, a barcode product, and a favorite", async () => {
  const manualFood = await callTool(writerKey, "log_food", {
    method: "manual", logDate: "2026-08-24T12:00:00Z", name: "Soup", quantity: 2,
    nutrition: { energyKcal: 240, sodiumMilligrams: 800 }, saveAsFavorite: true,
  });
  const soup = (manualFood.structuredContent as { event: Presented & { favoriteId: number } }).event;
  expect(soup).toMatchObject({ energyMilliKcal: 240_000, sodiumMilligrams: 800, favoriteId: expect.any(Number) as unknown });
  const favorite = await callTool(writerKey, "log_food", { method: "favorite", logDate: "2026-08-24T18:00:00Z", favoriteId: soup.favoriteId });
  expect(favorite.structuredContent).toMatchObject({ event: { name: "Soup", favoriteId: soup.favoriteId }, day: { energyMilliKcal: { known: 480_000 } } });

  const product = await callTool(writerKey, "lookup_barcode", { barcode: "034000470693" });
  const reviewed = (product.structuredContent as { food: { reviewVersion: string; providerFoodId: string } }).food;
  expect(product.content[0].text).toContain('method "barcode"');
  const cereal = await callTool(writerKey, "log_food", {
    method: "barcode", logDate: "2026-08-24T07:00:00Z", providerFoodId: reviewed.providerFoodId,
    reviewVersion: reviewed.reviewVersion, measurementId: "serving", quantity: "1",
  });
  expect(cereal.structuredContent).toMatchObject({ event: { provider: "open-food-facts", energyMilliKcal: 180_000 } });
});

test("MCP food and catalog refusals are tool errors the agent can act on", async () => {
  const refusal = async (key: string, name: string, toolArguments: Record<string, unknown>) => {
    const result = await callTool(key, name, toolArguments);
    expect(result.isError).toBe(true);
    return result.content[0].text;
  };
  expect(await refusal(writerKey, "log_food", { method: "manual", name: "Soup", quantity: 1, nutrition: { energyKcal: 1 } })).toContain("ISO date-time with an offset");
  expect(await refusal(writerKey, "log_food", { logDate: now })).toContain("lookup, barcode, manual, or favorite");
  expect(await refusal(writerKey, "log_food", { ...lookup(), quantity: "0" })).toContain("at most 99");
  expect(await refusal(writerKey, "log_food", { ...lookup(), reviewVersion: "00000000-0000-4000-8000-000000000002" })).toContain("catalog changed");
  expect(await refusal(writerKey, "log_food", { id: 999_999, expectedUpdatedAt: now, changes: {} })).toBe("Food event not found.");
  expect(await refusal(writerKey, "list_food", { from: "2026-08-28T00:00:00Z", to: "2026-08-27T00:00:00Z" })).toContain("from before to");
  expect(await refusal(writerKey, "delete_food", { events: [{ id: 999_999, expectedUpdatedAt: now }] })).toBe("Food event not found.");
  expect(await refusal(writerKey, "search_foods", { query: "a" })).toContain("2 to 100 characters");
  expect(await refusal(writerKey, "get_food", { providerFoodId: "4040" })).toContain("No usable food");
  expect(await refusal(writerKey, "lookup_barcode", { barcode: "12" })).toContain("digit barcode");
  expect(await refusal(readerKey, "log_food", manual())).toContain("disabled");
});

test("unexpected failures propagate instead of becoming food errors", async () => {
  const service = getFoodEventService();
  const original = service.list.bind(service);
  const unexpected = new Error("unexpected food failure");
  service.list = () => {
    throw unexpected;
  };
  try {
    await expect(Promise.resolve().then(() => list(readerKey, "from=2026-08-30T00:00:00Z&to=2026-08-31T00:00:00Z"))).rejects.toBe(unexpected);
    const result = await callTool(readerKey, "list_food", { from: "2026-08-30T00:00:00Z", to: "2026-08-31T00:00:00Z" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("unexpected food failure");
  } finally {
    service.list = original;
  }
});

test("food stays unavailable until the account finishes setup, as the daily Food Log does", async () => {
  const holder = await account("food.api.unconfigured", false);
  const key = await createKey(holder, "Before setup", ["daily-log:read", "food-events:read", "food-events:write"]);

  for (const response of [
    await post(key, manual()),
    await list(key, "from=2026-08-30T00:00:00Z&to=2026-08-31T00:00:00Z"),
    await remove(key, { events: [] }),
  ]) {
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "missing_setup" });
  }
  const dailyLog = await callTool(key, "get_daily_log", {});
  for (const [name, toolArguments] of [
    ["log_food", manual()],
    ["list_food", { from: "2026-08-30T00:00:00Z", to: "2026-08-31T00:00:00Z" }],
    ["delete_food", { events: [] }],
  ] as const) {
    const result = await callTool(key, name, toolArguments);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(dailyLog.content[0].text);
  }
});

test("catalog tools explain empty searches, unbranded and unselectable foods, and propagate unexpected failures", async () => {
  const none = await callTool(catalogKey, "search_foods", { query: "none" });
  expect(none).toMatchObject({ structuredContent: { results: [] }, content: [{ text: "No foods found." }] });
  const unsafe = await callTool(catalogKey, "search_foods", { query: "unsafe" });
  expect(unsafe.content[0].text).toContain("9999: Unsafe provider measurement (Example Dairy Co. · Measurement unavailable) — nutrition unavailable");

  const conflicting = await callTool(catalogKey, "lookup_barcode", { barcode: "0000000000007" });
  expect(conflicting.structuredContent).toMatchObject({ food: { isSelectable: false, unavailableReason: "conflicting_nutrition_bases" } });
  expect(conflicting.content[0].text).toContain("cannot be logged");
  expect(conflicting.content[0].text).not.toContain("log_food");

  const { setFoodCatalogProviderForTests } = await import("../../app/catalog/runtime.server");
  const unexpected = new Error("unexpected catalog failure");
  setFoodCatalogProviderForTests({
    getFood: () => Promise.reject(unexpected),
    search: () => Promise.resolve([{
      barcode: null, brand: null, dataType: "Foundation", isSelectable: true, measurementSummary: "",
      name: "Plain egg", provider: "usda-fdc", providerFoodId: "42", providerPublishedDate: null,
    }]),
  });
  try {
    expect((await callTool(catalogKey, "search_foods", { query: "egg" })).content[0].text).toBe("- 42: Plain egg");
    const failed = await callTool(catalogKey, "get_food", { providerFoodId: "42" });
    expect(failed.isError).toBe(true);
    expect(failed.content[0].text).toContain("unexpected catalog failure");
    await expect(catalog(catalogKey, "providerFoodId=42")).rejects.toBe(unexpected);
  } finally {
    setFoodCatalogProviderForTests(undefined);
  }
});

test("an agent sees unknown and incomplete calories, plural counts, and cleared nutrients", async () => {
  const product = (await callTool(writerKey, "lookup_barcode", { barcode: "034000470693" })).structuredContent as { food: { reviewVersion: string } };
  const logged = await callTool(writerKey, "log_food", {
    method: "barcode", logDate: "2026-08-23T07:00:00Z", providerFoodId: "0034000470693",
    reviewVersion: product.food.reviewVersion, measurementId: "serving", quantity: 1,
  });
  const event = (logged.structuredContent as { event: Presented }).event;
  const cleared = await callTool(writerKey, "log_food", {
    id: event.id, expectedUpdatedAt: event.updatedAt, changes: { nutrition: { energyKcal: null, fatGrams: null } },
  });
  expect(cleared.structuredContent).toMatchObject({
    event: { energyMilliKcal: null, fatMilligrams: null, carbohydrateMilligrams: 24_000 },
    day: { date: "2026-08-23", energyMilliKcal: { known: 0, isIncomplete: true } },
  });
  expect(cleared.content[0].text).toEqual(expect.stringMatching(/unknown kcal.*2026-08-23: 0 kcal known/));
  await callTool(writerKey, "log_food", manual({ logDate: "2026-08-23T12:00:00Z", nutrition: { energyKcal: "100", proteinGrams: null } }));
  const listed = await callTool(readerKey, "list_food", { from: "2026-08-23T00:00:00-04:00", to: "2026-08-24T00:00:00-04:00" });
  expect(listed.content[0].text).toBe("2 food events, 100 kcal known in total.");
});

test("the daily log names each food's source and brand", async () => {
  const yogurt = await callTool(writerKey, "get_food", { providerFoodId: "1001" });
  await callTool(writerKey, "log_food", {
    method: "lookup", logDate: "2026-08-22T12:00:00Z", providerFoodId: "1001",
    reviewVersion: (yogurt.structuredContent as { food: { reviewVersion: string } }).food.reviewVersion,
    measurementId: "base:g:100000000", quantity: "1",
  });
  const cereal = await callTool(writerKey, "lookup_barcode", { barcode: "034000470693" });
  await callTool(writerKey, "log_food", {
    method: "barcode", logDate: "2026-08-22T13:00:00Z", providerFoodId: "0034000470693",
    reviewVersion: (cereal.structuredContent as { food: { reviewVersion: string } }).food.reviewVersion,
    measurementId: "serving", quantity: "1",
  });
  const summary = await callTool(writerKey, "get_daily_log", { date: "2026-08-22" });
  expect(summary.content[0].text).toContain("- 09:00 Example cereal (Example Foods), Open Food Facts, 1 serving (30 g) × 1: 180 kcal");
  expect(summary.content[0].text).toContain("- 08:00 Plain nonfat Greek yogurt (Example Dairy Co.), USDA FoodData Central · Branded, 100 g × 1: 59 kcal");
});

test("JSON bodies of the wrong shape become refusals", async () => {
  for (const [body, error] of [
    [manual({ quantity: true }), "invalid_quantity"],
    [manual({ nutrition: [180] }), "invalid_nutrition"],
    [{ id: 999_999, expectedUpdatedAt: now, changes: [] }, "not_found"],
  ] as const) {
    const response = await post(writerKey, body);
    expect(await response.json()).toEqual({ error });
  }
});
