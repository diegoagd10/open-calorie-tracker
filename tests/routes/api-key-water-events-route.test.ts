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
import { loader as readDailyLog } from "../../app/routes/api.v1.daily-log";
import { action as logWater, headers as waterHeaders, loader as getWaterEvents } from "../../app/routes/api.v1.water-events";
import { action as homeAction } from "../../app/routes/home";
import { action as keysAction, loader as keysLoader } from "../../app/routes/settings.api-keys";
import { action as copyAction } from "../../app/routes/settings.api-keys.copy";
import { getGoalSetupService } from "../../app/setup/runtime.server";
import { validateSetupFields } from "../../app/setup/validation";
import { seedAuthenticatedAccount } from "../support/authentication";

const origin = "http://localhost:3000";
const today = "2026-08-31";
const instant = "2026-08-31T16:00:00.000Z";
type Account = { id: number; cookie: string; csrf: string };
type WaterBody = Record<string, unknown>;
let directory: string;
let owner: Account;
let writer: string;
let ipCounter = 0;
let keyCounter = 0;

function args(request: Request) {
  return { request, params: {}, context: new RouterContextProvider(), pattern: new URL(request.url).pathname, url: new URL(request.url) };
}
function freshIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}
/** A distinct caller key per request, so tests only replay when they mean to. */
function freshKey() {
  keyCounter += 1;
  return `water-key-${keyCounter}`;
}
function waterRequest(
  body: unknown,
  { key = writer, idempotencyKey = freshKey(), method = "POST", ip = freshIp() }: { key?: string | null; idempotencyKey?: string | null; method?: string; ip?: string } = {},
) {
  const headers = new Headers({ "Content-Type": "application/json", "X-Open-Calory-Client-IP": ip });
  if (key !== null) headers.set("Authorization", `Bearer ${key}`);
  if (idempotencyKey !== null) headers.set("Idempotency-Key", idempotencyKey);
  return new Request(`${origin}/api/v1/water-events`, {
    method,
    headers,
    ...(method === "GET" || method === "HEAD" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}
function post(body: unknown, options: Parameters<typeof waterRequest>[1] = {}) {
  return logWater(args(waterRequest(body, options)));
}
async function expectError(response: Response | Promise<Response>, status: number, error: string) {
  const resolved = await response;
  expect(resolved.status).toBe(status);
  expect(await resolved.json()).toEqual({ error });
  expect(resolved.headers.get("Cache-Control")).toBe("private, no-store");
  return resolved;
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
  directory = await mkdtemp(path.join(tmpdir(), "api-key-water-events-route-"));
  vi.stubEnv("APPLICATION_URL", origin);
  vi.stubEnv("DATABASE_PATH", path.join(directory, "application.sqlite"));
  vi.stubEnv("APPLICATION_SECRETS_PATH", path.join(directory, "secrets"));
  vi.stubEnv("FOOD_LOG_TEST_NOW", instant);
  vi.stubEnv("SETUP_TEST_NOW", instant);
  initializeApplicationDatabase();
  const administrator = await getAuthenticationService().register("water.admin", "correct horse battery staple", "203.0.113.9");
  if (!administrator.ok) throw new Error("Could not register owner");
  owner = await account("water.owner");
  completeSetup(owner.id);
  writer = await createKey(owner, "Smart bottle", ["water-log:write"]);
});
afterAll(async () => {
  shutdownCredentialStorage();
  shutdownApplicationDatabase();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

test("a Log water key logs containers for today at the current local time, in the daily-log water format", async () => {
  const response = await post({ foodLogDate: today, glasses: 2, bottles: 1 }, { idempotencyKey: "today-glasses-and-bottle" });
  expect(response.status).toBe(201);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  const body = await response.json() as WaterBody;
  expect(Object.keys(body).sort()).toEqual([
    "amountMicroliters", "createdAt", "foodLogDate", "id", "localEventTime",
    "preset16Count", "preset24Count", "preset8Count", "replayed", "updatedAt",
  ].sort());
  expect(body).toEqual({
    id: expect.any(Number) as number,
    foodLogDate: today,
    localEventTime: "12:00:00",
    createdAt: instant,
    updatedAt: instant,
    amountMicroliters: 946_352,
    preset8Count: 2,
    preset16Count: 1,
    preset24Count: 0,
    replayed: false,
  });
  expect(storedEvents(owner.id, "api:today-glasses-and-bottle")).toHaveLength(1);
  expect(waterHeaders()).toEqual({ "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" });
});

test("a past day takes the next free slot from noon, and GET /api/v1/daily-log shows the new Water Events", async () => {
  const past = "2026-08-20";
  const first = await (await post({ foodLogDate: past, large: 1 })).json() as WaterBody;
  const second = await (await post({ foodLogDate: past, bottles: 2 })).json() as WaterBody;
  expect(first).toMatchObject({ foodLogDate: past, localEventTime: "12:00:00", amountMicroliters: 709_765, preset24Count: 1 });
  expect(second).toMatchObject({ foodLogDate: past, localEventTime: "12:01:00", amountMicroliters: 946_352, preset16Count: 2 });

  const reader = await createKey(owner, "Reader for water", ["daily-log:read"]);
  const log = readDailyLog(args(new Request(`${origin}/api/v1/daily-log?date=${past}`, { headers: { Authorization: `Bearer ${reader}`, "X-Open-Calory-Client-IP": freshIp() } })));
  const dailyLog = await log.json() as { waterEvents: WaterBody[]; waterTotalMicroliters: number };
  const withoutReplayed = ({ replayed: _replayed, ...event }: WaterBody) => event;
  expect(dailyLog.waterEvents).toEqual([withoutReplayed(second), withoutReplayed(first)]);
  expect(dailyLog.waterTotalMicroliters).toBe(1_656_117);
});

test("a retry with the same key replays the original with 200, and a changed retry is a conflict", async () => {
  const idempotencyKey = "retry:bottle.2026-08-31";
  const created = await post({ foodLogDate: today, bottles: 1 }, { idempotencyKey });
  expect(created.status).toBe(201);
  const original = await created.json() as WaterBody;

  const replay = await post({ foodLogDate: today, bottles: 1, glasses: 0 }, { idempotencyKey });
  expect(replay.status).toBe(200);
  expect(replay.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await replay.json()).toEqual({ ...original, replayed: true });

  await expectError(post({ foodLogDate: today, bottles: 2 }, { idempotencyKey }), 409, "idempotency_conflict");
  await expectError(post({ foodLogDate: today, glasses: 1 }, { idempotencyKey }), 409, "idempotency_conflict");
  await expectError(post({ foodLogDate: "2026-08-30", bottles: 1 }, { idempotencyKey }), 409, "idempotency_conflict");
  expect(storedEvents(owner.id, `api:${idempotencyKey}`)).toHaveLength(1);
});

test("the Idempotency-Key header is required, 8 to 124 characters from A-Z a-z 0-9 . _ : -", async () => {
  const valid = { foodLogDate: today, glasses: 1 };
  for (const idempotencyKey of [null, "", "a".repeat(7), "a".repeat(125), "has space", "slash/key1", "caf\u00e9-latte-key", "percent%key"]) {
    await expectError(post(valid, { idempotencyKey }), 400, "invalid_idempotency_key");
  }
  for (const idempotencyKey of ["a".repeat(8), "b".repeat(124), "Az09._:-"]) {
    expect((await post(valid, { idempotencyKey })).status).toBe(201);
    expect(storedEvents(owner.id, `api:${idempotencyKey}`)).toHaveLength(1);
  }
});

test("dates must be real calendar days, today or earlier", async () => {
  const before = storedEvents(owner.id).length;
  await expectError(post({ foodLogDate: "2026-09-01", glasses: 1 }), 400, "future_date");
  for (const foodLogDate of ["2026-02-30", "not-a-date", "", "2026-8-1"]) {
    await expectError(post({ foodLogDate, glasses: 1 }), 400, "invalid_date");
  }
  expect(storedEvents(owner.id)).toHaveLength(before);
});

test("container counts must be whole, non-negative, at least one container, and at most 500 fl oz", async () => {
  for (const counts of [
    {},
    { glasses: 0, bottles: 0, large: 0 },
    { glasses: 0.5 },
    { bottles: 1.5 },
    { glasses: -1, bottles: 1 },
    { large: 21 },
    { glasses: 63 },
    { glasses: "1" },
    { bottles: null },
  ]) {
    await expectError(post({ foodLogDate: today, ...counts }), 400, "invalid_request");
  }
  expect((await post({ foodLogDate: today, large: 20, glasses: 2 })).status).toBe(201);
});

test("a missing foodLogDate or a malformed body is an invalid request", async () => {
  const before = storedEvents(owner.id).length;
  for (const body of [{ glasses: 1 }, { foodLogDate: 20260831, glasses: 1 }, "not json", "[]", "null", "{\"foodLogDate\":"]) {
    await expectError(post(body), 400, "invalid_request");
  }
  expect(storedEvents(owner.id)).toHaveLength(before);
});

test("keys without Log water get 403 insufficient_scope, and unknown keys get 401", async () => {
  const reader = await createKey(owner, "Read only", ["daily-log:read"]);
  const refused = await expectError(post({ foodLogDate: today, glasses: 1 }, { key: reader }), 403, "insufficient_scope");
  expect(refused.headers.get("WWW-Authenticate")).toBe('Bearer realm="water-events", error="insufficient_scope", scope="water-log:write"');

  for (const key of [null, `oct_${"A".repeat(43)}`]) {
    const unauthorized = await expectError(post({ foodLogDate: today, glasses: 1 }, { key }), 401, "invalid_token");
    expect(unauthorized.headers.get("WWW-Authenticate")).toBe('Bearer realm="water-events", error="invalid_token"');
  }

  const both = await createKey(owner, "Read and log", ["daily-log:read", "water-log:write"]);
  expect((await post({ foodLogDate: today, glasses: 1 }, { key: both })).status).toBe(201);
});

test("repeated failed attempts from one client IP are rate limited", async () => {
  const ip = freshIp();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await expectError(post({ foodLogDate: today, glasses: 1 }, { key: `oct_${"C".repeat(43)}`, ip }), 401, "invalid_token");
  }
  const limited = await expectError(post({ foodLogDate: today, glasses: 1 }, { ip }), 429, "rate_limited");
  expect(limited.headers.get("Retry-After")).toBe("900");
});

test("an account without finished setup gets 409 missing_setup", async () => {
  const incomplete = await account("water.incomplete");
  const key = await createKey(incomplete, "Early bottle", ["water-log:write"]);
  await expectError(post({ foodLogDate: today, glasses: 1 }, { key }), 409, "missing_setup");
  expect(storedEvents(incomplete.id)).toHaveLength(0);
});

test("only POST is allowed", async () => {
  expect((await expectError(getWaterEvents(), 405, "method_not_allowed")).headers.get("Allow")).toBe("POST");
  for (const method of ["PUT", "PATCH", "DELETE"]) {
    const refused = await expectError(post({ foodLogDate: today, glasses: 1 }, { method }), 405, "method_not_allowed");
    expect(refused.headers.get("Allow")).toBe("POST");
  }
});

test("water logged through REST can be edited and deleted in the web app", async () => {
  const created = await (await post({ foodLogDate: today, bottles: 1 })).json() as { id: number; updatedAt: string };
  const web = (fields: Record<string, string>) => homeAction(args(new Request(`${origin}/`, {
    method: "POST",
    headers: { Cookie: owner.cookie, Origin: origin, "X-Test-Food-Log-Now": instant },
    body: new URLSearchParams({ csrfToken: owner.csrf, date: today, eventId: String(created.id), ...fields }),
  })));

  const updated = await web({ intent: "update-water", expectedUpdatedAt: created.updatedAt, waterAmount: "10", waterEventTime: "13:15", waterSelection: "exact" });
  expect((updated as Response).headers.get("Location")).toBe(`/?date=${today}&notice=water-updated`);
  const [edited] = storedEvents(owner.id).filter((event) => event.id === created.id);
  expect(edited).toMatchObject({ amountMicroliters: 295_735, localEventTime: "13:15:00" });

  const deleted = await web({ intent: "delete-water", expectedUpdatedAt: edited.updatedAt });
  expect((deleted as Response).headers.get("Location")).toBe(`/?date=${today}&notice=water-deleted`);
  expect(storedEvents(owner.id).some((event) => event.id === created.id)).toBe(false);
});
