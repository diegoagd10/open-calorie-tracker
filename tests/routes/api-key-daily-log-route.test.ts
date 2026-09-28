import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import { shutdownCredentialStorage } from "../../app/credentials/runtime.server";
import { deleteMemberAccount } from "../../app/database/member-deletion.server";
import { getApplicationDatabase, initializeApplicationDatabase, shutdownApplicationDatabase } from "../../app/database/runtime.server";
import { loader as readDailyLog } from "../../app/routes/api.v1.daily-log";
import { action as keysAction, loader as keysLoader } from "../../app/routes/settings.api-keys";
import { action as copyAction } from "../../app/routes/settings.api-keys.copy";
import { getGoalSetupService } from "../../app/setup/runtime.server";
import { validateSetupFields } from "../../app/setup/validation";
import { seedAuthenticatedAccount } from "../support/authentication";

const origin = "http://localhost:3000";
const date = "2026-08-31";
type Account = { id: number; cookie: string; csrf: string };
let directory: string;
let reader: Account;
let ipCounter = 0;

function args(request: Request, pattern = new URL(request.url).pathname) {
  return { request, params: {}, context: new RouterContextProvider(), pattern, url: new URL(request.url) };
}
/** Each test reads from its own client IP so failure limits do not leak between tests. */
function freshIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}
function apiGet(authorization: string | null, ip: string, query = `date=${date}`) {
  const headers = new Headers({ "X-Open-Calory-Client-IP": ip });
  if (authorization !== null) headers.set("Authorization", authorization);
  return readDailyLog(args(new Request(`${origin}/api/v1/daily-log?${query}`, { headers })));
}
async function account(username: string): Promise<Account> {
  const session = await seedAuthenticatedAccount(getAuthenticationService(), getApplicationDatabase().getClient(), username, "correct horse battery staple", "203.0.113.10");
  return { id: session.user.id, cookie: serializeSessionCookie(session).split(";", 1)[0], csrf: session.csrfToken };
}
function completeSetup(userId: number) {
  const setup = validateSetupFields({
    calories: "2050", carbohydrate: "230", displayUnits: "us", fat: "70", fiber: "25",
    protein: "120", sodium: "2300", sugar: "50", timeZone: "America/New_York", water: "80",
  });
  if (!setup.success) throw new Error("Invalid test setup");
  getGoalSetupService().completeInitial(userId, setup.data);
}
function listKeys(owner: Account) {
  return keysLoader(args(new Request(`${origin}/settings/api-keys`, { headers: { Cookie: owner.cookie } })));
}
async function createKey(owner: Account, name: string): Promise<{ id: number; key: string }> {
  const created = await keysAction(args(new Request(`${origin}/settings/api-keys`, {
    method: "POST",
    headers: { Cookie: owner.cookie, Origin: origin },
    body: new URLSearchParams({ csrfToken: owner.csrf, intent: "create", name, scope: "daily-log:read", expiration: "90d" }),
  })));
  if (!(created instanceof Response)) throw new Error(`Could not create key ${name}`);
  const listed = (await listKeys(owner)).keys.find((entry) => entry.name === name);
  if (!listed) throw new Error(`No key named ${name}`);
  const copied = await copyAction(args(new Request(`${origin}/settings/api-keys/copy`, {
    method: "POST",
    headers: { Cookie: owner.cookie, Origin: origin },
    body: new URLSearchParams({ csrfToken: owner.csrf, keyId: String(listed.id) }),
  })));
  return { id: listed.id, key: ((await copied.json()) as { key: string }).key };
}
async function expectInvalidToken(response: Response) {
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "invalid_token" });
  expect(response.headers.get("WWW-Authenticate")).toMatch(/^Bearer\b/u);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "api-key-daily-log-route-"));
  vi.stubEnv("APPLICATION_URL", origin);
  vi.stubEnv("DATABASE_PATH", path.join(directory, "application.sqlite"));
  vi.stubEnv("APPLICATION_SECRETS_PATH", path.join(directory, "secrets"));
  vi.stubEnv("FOOD_LOG_TEST_NOW", "2026-08-31T16:00:00.000Z");
  vi.stubEnv("SETUP_TEST_NOW", "2026-08-31T16:00:00.000Z");
  initializeApplicationDatabase();
  const owner = await getAuthenticationService().register("keys.admin", "correct horse battery staple", "203.0.113.9");
  if (!owner.ok) throw new Error("Could not register owner");
  reader = await account("keys.reader");
  completeSetup(reader.id);
});
afterAll(async () => {
  shutdownCredentialStorage();
  shutdownApplicationDatabase();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

test("a valid key reads its owner's Food Log in the unchanged v1 shape", async () => {
  const { key } = await createKey(reader, "Muse");
  const response = apiGet(`Bearer ${key}`, freshIp());
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  const body = await response.json() as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual([
    "displayUnits", "events", "foodEntries", "goal", "isFuture", "nutritionTotals",
    "selectedDate", "timeZone", "today", "version", "waterEvents", "waterTotalMicroliters",
  ].sort());
  expect(body).toMatchObject({ version: "1", selectedDate: date, timeZone: "America/New_York", goal: { calorieTargetMilliKcal: 2_050_000 } });
  expect(apiGet(`bearer ${key}`, freshIp()).status).toBe(200);
});

test("keys are accepted only in the Authorization header", async () => {
  const { key } = await createKey(reader, "Header only");
  const ip = freshIp();
  for (const query of [`date=${date}&access_token=${key}`, `date=${date}&api_key=${key}`, `date=${date}&key=${key}`]) {
    await expectInvalidToken(apiGet(null, ip, query));
  }
  expect(apiGet(`Bearer ${key}`, ip).status).toBe(200);
});

test("missing, unknown, expired, deleted, and disabled-account keys all get the same 401", async () => {
  const database = getApplicationDatabase().getClient();
  const member = await account("keys.disabled");
  completeSetup(member.id);
  const disabledKey = await createKey(member, "Disabled");
  const expired = await createKey(reader, "Expired");
  database.run(sql`UPDATE api_keys SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ${expired.id}`);
  const deleted = await createKey(reader, "Deleted");
  database.run(sql`DELETE FROM api_keys WHERE id = ${deleted.id}`);
  const ip = freshIp();

  database.run(sql`UPDATE users SET access_state = 'disabled' WHERE id = ${member.id}`);
  const responses = [
    apiGet(null, ip),
    apiGet("Bearer", ip),
    apiGet(`Bearer oct_${"A".repeat(43)}`, ip),
    apiGet(`Bearer ${expired.key}`, ip),
    apiGet(`Bearer ${deleted.key}`, ip),
    apiGet(`Bearer ${disabledKey.key}`, ip),
  ];
  for (const response of responses) await expectInvalidToken(response);
  const headers = new Set(responses.map((response) => response.headers.get("WWW-Authenticate")));
  expect(headers.size).toBe(1);

  database.run(sql`UPDATE users SET access_state = 'active' WHERE id = ${member.id}`);
  expect(apiGet(`Bearer ${disabledKey.key}`, freshIp()).status).toBe(200);

  expect(deleteMemberAccount(database, { id: member.id, usernameNormalized: "keys.disabled" })).toBe(true);
  await expectInvalidToken(apiGet(`Bearer ${disabledKey.key}`, freshIp()));
});

test("an edited key keeps authenticating with the same value, and a deleted key stops on the next request", async () => {
  const { id, key } = await createKey(reader, "Short lived");
  const settings = (fields: Record<string, string>) => keysAction(args(new Request(`${origin}/settings/api-keys`, {
    method: "POST",
    headers: { Cookie: reader.cookie, Origin: origin },
    body: new URLSearchParams({ csrfToken: reader.csrf, keyId: String(id), ...fields }),
  })));
  expect(apiGet(`Bearer ${key}`, freshIp()).status).toBe(200);
  expect(await settings({ intent: "update", name: "Renamed", scope: "daily-log:read", expiration: "never" })).toBeInstanceOf(Response);
  expect(apiGet(`Bearer ${key}`, freshIp()).status).toBe(200);
  expect(await settings({ intent: "delete" })).toBeInstanceOf(Response);
  await expectInvalidToken(apiGet(`Bearer ${key}`, freshIp()));
});

test("a valid key without the Food Log permission gets 403 insufficient_scope", async () => {
  const { id, key } = await createKey(reader, "Unscoped");
  getApplicationDatabase().getClient().run(sql`UPDATE api_keys SET scopes = '["other:read"]' WHERE id = ${id}`);
  const response = apiGet(`Bearer ${key}`, freshIp());
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "insufficient_scope" });
  expect(response.headers.get("WWW-Authenticate")).toContain('error="insufficient_scope"');
});

test("ten failed attempts per client IP in fifteen minutes block further attempts, and success clears the count", async () => {
  const { key } = await createKey(reader, "Limited IP");
  const unknown = `Bearer oct_${"B".repeat(43)}`;
  const recovering = freshIp();
  for (let attempt = 0; attempt < 9; attempt += 1) await expectInvalidToken(apiGet(unknown, recovering));
  expect(apiGet(`Bearer ${key}`, recovering).status).toBe(200);
  for (let attempt = 0; attempt < 9; attempt += 1) await expectInvalidToken(apiGet(unknown, recovering));
  expect(apiGet(`Bearer ${key}`, recovering).status).toBe(200);

  const blocked = freshIp();
  for (let attempt = 0; attempt < 10; attempt += 1) await expectInvalidToken(apiGet(unknown, blocked));
  const limited = apiGet(`Bearer ${key}`, blocked);
  expect(limited.status).toBe(429);
  expect(await limited.json()).toEqual({ error: "rate_limited" });
  expect(limited.headers.get("Retry-After")).toBe("900");
  expect(apiGet(`Bearer ${key}`, freshIp()).status).toBe(200);
});

test("each key is limited to 120 requests per minute", async () => {
  const busy = await createKey(reader, "Busy");
  const quiet = await createKey(reader, "Quiet");
  for (let request = 0; request < 120; request += 1) {
    expect(apiGet(`Bearer ${busy.key}`, freshIp()).status).toBe(200);
  }
  const limited = apiGet(`Bearer ${busy.key}`, freshIp());
  expect(limited.status).toBe(429);
  expect(await limited.json()).toEqual({ error: "rate_limited" });
  expect(limited.headers.get("Retry-After")).toBe("60");
  expect(apiGet(`Bearer ${quiet.key}`, freshIp()).status).toBe(200);
});

test("last use is recorded to the minute and shown on the settings list", async () => {
  const { id, key } = await createKey(reader, "Tracked");
  const database = getApplicationDatabase().getClient();
  const lastUsed = () => database.get<{ last_used_at: string | null }>(sql`SELECT last_used_at FROM api_keys WHERE id = ${id}`)?.last_used_at;
  expect(lastUsed()).toBeNull();
  const before = Date.now();
  expect(apiGet(`Bearer ${key}`, freshIp()).status).toBe(200);
  const recorded = lastUsed() ?? "";
  expect(recorded).toMatch(/:00\.000Z$/u);
  expect(Date.parse(recorded)).toBeGreaterThan(before - 60_000);
  expect(Date.parse(recorded)).toBeLessThanOrEqual(Date.now());
  expect((await listKeys(reader)).keys.find((entry) => entry.id === id)?.lastUsedAt).toBe(recorded);
});

test("logs never contain a full key", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const warn = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const { key } = await createKey(reader, "Logged");
    const blocked = freshIp();
    for (let attempt = 0; attempt < 11; attempt += 1) apiGet(`Bearer ${key.slice(0, -1)}A`, blocked);
    apiGet(`Bearer ${key}`, freshIp());
    const logged = [...log.mock.calls, ...warn.mock.calls].map((call) => call.map(String).join(" ")).join("\n");
    expect(logged).not.toContain(key.slice(8));
    expect(logged).not.toContain(key.slice(8, -1));
  } finally {
    log.mockRestore();
    warn.mockRestore();
  }
});
