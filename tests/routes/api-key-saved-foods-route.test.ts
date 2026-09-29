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
import { action as writeSavedFoods, loader as searchSavedFoods } from "../../app/routes/api.v1.saved-foods";
import { action as keysAction, loader as keysLoader } from "../../app/routes/settings.api-keys";
import { action as copyAction } from "../../app/routes/settings.api-keys.copy";
import { getGoalSetupService } from "../../app/setup/runtime.server";
import { validateSetupFields } from "../../app/setup/validation";
import { seedAuthenticatedAccount } from "../support/authentication";

const origin = "http://localhost:3000";
const date = "2026-08-31";
type Account = { id: number; cookie: string; csrf: string };
type SavedFoodsBody = { version: string; savedFoods: Record<string, unknown>[]; truncated: boolean };
let directory: string;
let pantry: Account;
let pantryKey: string;
let ipCounter = 0;
let savedFoodCounter = 0;

function args(request: Request) {
  return { request, params: {}, context: new RouterContextProvider(), pattern: "/api/v1/saved-foods", url: new URL(request.url) };
}
/** Each request comes from its own client IP so failure limits do not leak between tests. */
function freshIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}
function apiGet(authorization: string | null, query = "", ip = freshIp()) {
  const headers = new Headers({ "X-Open-Calory-Client-IP": ip });
  if (authorization !== null) headers.set("Authorization", authorization);
  return searchSavedFoods(args(new Request(`${origin}/api/v1/saved-foods${query}`, { headers })));
}
async function names(response: Response) {
  return ((await response.json()) as SavedFoodsBody).savedFoods.map((food) => food.name);
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
async function createKey(owner: Account, name: string, scopes: readonly string[]): Promise<{ id: number; key: string }> {
  const request = (url: string, fields: [string, string][]) => new Request(`${origin}${url}`, {
    method: "POST",
    headers: { Cookie: owner.cookie, Origin: origin },
    body: new URLSearchParams([["csrfToken", owner.csrf], ...fields]),
  });
  await keysAction(args(request("/settings/api-keys", [["intent", "create"], ["name", name], ["expiration", "90d"], ...scopes.map((scope): [string, string] => ["scope", scope])])));
  const listed = (await keysLoader(args(new Request(`${origin}/settings/api-keys`, { headers: { Cookie: owner.cookie } })))).keys.find((entry) => entry.name === name);
  if (!listed) throw new Error(`No key named ${name}`);
  const copied = await copyAction(args(request("/settings/api-keys/copy", [["keyId", String(listed.id)]])));
  return { id: listed.id, key: ((await copied.json()) as { key: string }).key };
}
function saveFood(userId: number, name: string, nutrients: Record<string, string> = {}) {
  savedFoodCounter += 1;
  // Logging a manual food in the web also keeps it in My foods.
  getFoodEntryService(new Date("2026-08-31T16:00:00.000Z")).logManual(userId, {
    carbohydrateGrams: "", energyKcal: "100", fatGrams: "", fiberGrams: "", foodLogDate: date, idempotencyKey: `api-saved-${savedFoodCounter}`,
    name, proteinGrams: "", quantity: "1", sodiumMilligrams: "", sugarGrams: "", ...nutrients,
  });
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "api-key-saved-foods-route-"));
  vi.stubEnv("APPLICATION_URL", origin);
  vi.stubEnv("DATABASE_PATH", path.join(directory, "application.sqlite"));
  vi.stubEnv("APPLICATION_SECRETS_PATH", path.join(directory, "secrets"));
  vi.stubEnv("FOOD_LOG_TEST_NOW", "2026-08-31T16:00:00.000Z");
  vi.stubEnv("SETUP_TEST_NOW", "2026-08-31T16:00:00.000Z");
  initializeApplicationDatabase();
  const owner = await getAuthenticationService().register("saved.admin", "correct horse battery staple", "203.0.113.9");
  if (!owner.ok) throw new Error("Could not register owner");
  pantry = await account("saved.pantry");
  completeSetup(pantry.id);
  saveFood(pantry.id, "Huevo (1 grande)", { energyKcal: "78", proteinGrams: "6.3", carbohydrateGrams: "0.6", fatGrams: "5.3", sodiumMilligrams: "62" });
  saveFood(pantry.id, "Pan tostado", { energyKcal: "80.125" });
  // Saved from a Food Entry of two servings: the search shows one serving, not the entry's totals.
  saveFood(pantry.id, "huevo revuelto", { energyKcal: "400", proteinGrams: "26", sodiumMilligrams: "300", quantity: "2" });
  saveFood(pantry.id, "Huevo (1 grande)", { energyKcal: "72" });
  pantryKey = (await createKey(pantry, "Pantry", ["daily-log:read"])).key;
});
afterAll(async () => {
  shutdownCredentialStorage();
  shutdownApplicationDatabase();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

test("a key reads its owner's Saved Foods matching part of a name, with one serving's nutrition in canonical units", async () => {
  const response = apiGet(`Bearer ${pantryKey}`, "?query=HUEVO");
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  const body = await response.json() as SavedFoodsBody;
  expect(body.version).toBe("1");
  expect(body.truncated).toBe(false);
  expect(body.savedFoods[0]).toEqual({
    id: expect.any(Number) as number, name: "Huevo (1 grande)",
    energyMilliKcal: 78_000, proteinMilligrams: 6_300, carbohydrateMilligrams: 600, fatMilligrams: 5_300,
    fiberMilligrams: null, sugarMilligrams: null, sodiumMilligrams: 62,
  });
  expect(body.savedFoods[1]).toMatchObject({ name: "Huevo (1 grande)", energyMilliKcal: 72_000 });
  expect(body.savedFoods[1].id as number).toBeGreaterThan(body.savedFoods[0].id as number);
  expect(body.savedFoods[2]).toMatchObject({ name: "huevo revuelto", energyMilliKcal: 200_000, proteinMilligrams: 13_000, sodiumMilligrams: 150 });
  expect(body.savedFoods).toHaveLength(3);
});

test("an empty or missing query lists every Saved Food by name then id, and no match is an empty list", async () => {
  const all = ["Huevo (1 grande)", "Huevo (1 grande)", "Pan tostado", "huevo revuelto"];
  expect(await names(apiGet(`Bearer ${pantryKey}`))).toEqual(all);
  expect(await names(apiGet(`Bearer ${pantryKey}`, "?query="))).toEqual(all);
  const none = apiGet(`Bearer ${pantryKey}`, "?query=pizza");
  expect(none.status).toBe(200);
  expect(await none.json()).toEqual({ version: "1", savedFoods: [], truncated: false });
});

test("at most 25 Saved Foods are returned, with truncated when more match", async () => {
  const bulk = await account("saved.bulk");
  completeSetup(bulk.id);
  for (let index = 27; index >= 1; index -= 1) saveFood(bulk.id, `Food ${String(index).padStart(2, "0")}`);
  const { key } = await createKey(bulk, "Bulk", ["daily-log:read"]);

  const all = await apiGet(`Bearer ${key}`).json() as SavedFoodsBody;
  expect(all.truncated).toBe(true);
  expect(all.savedFoods.map((food) => food.name)).toEqual(Array.from({ length: 25 }, (_, index) => `Food ${String(index + 1).padStart(2, "0")}`));
  const narrowed = await apiGet(`Bearer ${key}`, "?query=food%202").json() as SavedFoodsBody;
  expect(narrowed.truncated).toBe(false);
  expect(narrowed.savedFoods).toHaveLength(8);
});

test("a key with the Log foods permission alone can search, and a key with neither permission is challenged with both", async () => {
  const writer = await createKey(pantry, "Writer", ["food-log:write"]);
  expect(await names(apiGet(`Bearer ${writer.key}`, "?query=pan"))).toEqual(["Pan tostado"]);

  getApplicationDatabase().getClient().run(sql`UPDATE api_keys SET scopes = '["other:read"]' WHERE id = ${writer.id}`);
  const refused = apiGet(`Bearer ${writer.key}`);
  expect(refused.status).toBe(403);
  expect(await refused.json()).toEqual({ error: "insufficient_scope" });
  expect(refused.headers.get("WWW-Authenticate")).toBe('Bearer realm="saved-foods", error="insufficient_scope", scope="daily-log:read food-log:write"');
});

test("missing or unknown keys get 401, repeated failures get 429, and other accounts' Saved Foods stay private", async () => {
  for (const authorization of [null, "Bearer", `Bearer oct_${"A".repeat(43)}`]) {
    const response = apiGet(authorization);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_token" });
    expect(response.headers.get("WWW-Authenticate")).toBe('Bearer realm="saved-foods", error="invalid_token"');
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  }
  const blocked = freshIp();
  for (let attempt = 0; attempt < 10; attempt += 1) expect(apiGet(`Bearer oct_${"B".repeat(43)}`, "", blocked).status).toBe(401);
  const limited = apiGet(`Bearer ${pantryKey}`, "", blocked);
  expect(limited.status).toBe(429);
  expect(limited.headers.get("Retry-After")).toBe("900");

  const stranger = await account("saved.stranger");
  const { key } = await createKey(stranger, "Stranger", ["daily-log:read"]);
  expect(await apiGet(`Bearer ${key}`, "?query=huevo").json()).toEqual({ version: "1", savedFoods: [], truncated: false });
});

test("a repeated or overlong query is invalid, and methods other than GET are not allowed", async () => {
  for (const query of ["?query=huevo&query=pan", `?query=${"a".repeat(201)}`]) {
    const invalid = apiGet(`Bearer ${pantryKey}`, query);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_request" });
  }
  expect(apiGet(`Bearer ${pantryKey}`, `?query=${"a".repeat(200)}`).status).toBe(200);
  const write = writeSavedFoods();
  expect(write.status).toBe(405);
  expect(await write.json()).toEqual({ error: "method_not_allowed" });
  expect(write.headers.get("Cache-Control")).toContain("no-store");
});
