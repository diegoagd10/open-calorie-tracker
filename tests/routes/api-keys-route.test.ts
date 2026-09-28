import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { tmpdir } from "node:os";
import path from "node:path";
import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import { shutdownCredentialStorage } from "../../app/credentials/runtime.server";
import { deleteMemberAccount } from "../../app/database/member-deletion.server";
import { getApplicationDatabase, initializeApplicationDatabase, shutdownApplicationDatabase } from "../../app/database/runtime.server";
import { action, loader } from "../../app/routes/settings.api-keys";
import { action as copyAction } from "../../app/routes/settings.api-keys.copy";
import { seedAuthenticatedAccount } from "../support/authentication";

const origin = "http://localhost:3000";
let directory: string;
let ownerCookie: string;
let ownerCsrf: string;
let otherCookie: string;
let otherCsrf: string;

function args(request: Request, pattern = "/settings/api-keys") {
  return { request, params: {}, context: new RouterContextProvider(), pattern, url: new URL(request.url) };
}
function get(cookie: string) {
  return args(new Request(`${origin}/settings/api-keys`, { headers: { Cookie: cookie } }));
}
function post(fields: Record<string, string | string[]>, cookie = ownerCookie, csrfToken = ownerCsrf) {
  const body = new URLSearchParams({ csrfToken });
  for (const [name, value] of Object.entries(fields)) {
    for (const entry of Array.isArray(value) ? value : [value]) body.append(name, entry);
  }
  return args(new Request(`${origin}/settings/api-keys`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin },
    body,
  }));
}
function copy(keyId: number | string, cookie = ownerCookie, csrfToken = ownerCsrf, requestOrigin = origin) {
  return copyAction(args(new Request(`${origin}/settings/api-keys/copy`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: requestOrigin },
    body: new URLSearchParams({ csrfToken, keyId: String(keyId) }),
  }), "/settings/api-keys/copy"));
}
async function keyNamed(name: string, cookie = ownerCookie) {
  const key = (await loader(get(cookie))).keys.find((entry) => entry.name === name);
  if (!key) throw new Error(`No key named ${name}`);
  return key;
}
function create(name: string, fields: Record<string, string | string[]> = {}, cookie = ownerCookie, csrfToken = ownerCsrf) {
  return action(post({ intent: "create", name, scope: "daily-log:read", expiration: "90d", ...fields }, cookie, csrfToken));
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "api-keys-route-"));
  vi.stubEnv("APPLICATION_URL", origin);
  vi.stubEnv("DATABASE_PATH", path.join(directory, "application.sqlite"));
  vi.stubEnv("APPLICATION_SECRETS_PATH", path.join(directory, "secrets"));
  initializeApplicationDatabase();
  const auth = getAuthenticationService();
  const owner = await auth.register("keys.owner", "correct horse battery staple", "203.0.113.190");
  if (!owner.ok) throw new Error("Could not register owner");
  ownerCookie = serializeSessionCookie(owner.session).split(";", 1)[0];
  ownerCsrf = owner.session.csrfToken;
  const other = await seedAuthenticatedAccount(auth, getApplicationDatabase().getClient(), "keys.other", "correct horse battery staple", "203.0.113.191");
  otherCookie = serializeSessionCookie(other).split(";", 1)[0];
  otherCsrf = other.csrfToken;
});
afterAll(async () => {
  shutdownCredentialStorage();
  shutdownApplicationDatabase();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

test("an account holder creates a key and sees it listed masked with its permission and expiration", async () => {
  const before = Date.now();
  const response = await create("Muse");
  expect(response).toBeInstanceOf(Response);
  expect((response as Response).headers.get("Location")).toBe("/settings/api-keys?created=1");
  const keys = (await loader(get(ownerCookie))).keys;
  expect(keys).toHaveLength(1);
  const [key] = keys;
  expect(key).toMatchObject({ name: "Muse", scopes: ["daily-log:read"], lastUsedAt: null });
  expect(key.maskedKey).toMatch(/^oct_[A-Za-z0-9_-]{4}••••[A-Za-z0-9_-]{4}$/u);
  const createdAt = Date.parse(key.createdAt);
  expect(createdAt).toBeGreaterThanOrEqual(before);
  expect(Date.parse(key.expiresAt ?? "")).toBe(createdAt + 90 * 86_400_000);
});

test("copy returns the full key, which is stored only as a hash and ciphertext and logged by prefix", async () => {
  await create("Copy me");
  const listed = await keyNamed("Copy me");
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const response = await copy(listed.id);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const { key } = (await response.json()) as { key: string };
  expect(key).toMatch(/^oct_[A-Za-z0-9_-]{43}$/u);
  expect(listed.maskedKey).toBe(`${key.slice(0, 8)}••••${key.slice(-4)}`);

  const logged = log.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
  log.mockRestore();
  expect(logged).not.toContain(key);
  const records = logged.split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  const record = records.find((entry) => entry.event === "api_key_copy");
  expect(Object.keys(record ?? {}).sort()).toEqual(["event", "keyPrefix", "level", "timestamp", "userId"]);
  expect(record?.userId).toEqual(expect.any(Number));

  const stored = getApplicationDatabase().getClient().get<Record<string, unknown>>(sql`SELECT * FROM api_keys WHERE id = ${listed.id}`);
  expect(stored?.key_hash).toBe(createHash("sha256").update(key, "ascii").digest("hex"));
  expect(JSON.stringify(stored)).not.toContain(key.slice(8, -4));
  expect(JSON.stringify(await loader(get(ownerCookie)))).not.toContain(key.slice(8, -4));
});

test("a key needs a printable name unique to the account, a known permission, and an offered expiration", async () => {
  await create("Unique");
  const before = (await loader(get(ownerCookie))).keys.length;
  const invalid: Array<[Record<string, string | string[]>, string]> = [
    [{ name: "  " }, "name"],
    [{ name: "x".repeat(81) }, "name"],
    [{ name: "Bell\u0007" }, "name"],
    [{ name: "unique" }, "name"],
    [{ name: "No scope", scope: [] }, "scopes"],
    [{ name: "Bad scope", scope: "daily-log:write" }, "scopes"],
    [{ name: "Custom date", expiration: "2027-01-01" }, "expiration"],
  ];
  for (const [fields, field] of invalid) {
    const response = await create(String(fields.name), fields);
    expect(response).not.toBeInstanceOf(Response);
    const rejected = response as Exclude<typeof response, Response>;
    expect(rejected.init?.status).toBe(400);
    expect(rejected.data.errors).toHaveProperty(field);
  }
  expect((await loader(get(ownerCookie))).keys).toHaveLength(before);
  expect(await create("x".repeat(80))).toBeInstanceOf(Response);
});

test("expiration presets count whole days from creation, and No expiration leaves it empty", async () => {
  await create("One year", { expiration: "1y" });
  await create("One day", { expiration: "1d" });
  await create("Forever", { expiration: "never" });
  const year = await keyNamed("One year");
  expect(Date.parse(year.expiresAt ?? "") - Date.parse(year.createdAt)).toBe(365 * 86_400_000);
  const day = await keyNamed("One day");
  expect(Date.parse(day.expiresAt ?? "") - Date.parse(day.createdAt)).toBe(86_400_000);
  expect((await keyNamed("Forever")).expiresAt).toBeNull();
});

test("an account holds at most 25 keys", async () => {
  const database = getApplicationDatabase().getClient();
  const member = await seedAuthenticatedAccount(getAuthenticationService(), database, "keys.limit", "correct horse battery staple", "203.0.113.192");
  const cookie = serializeSessionCookie(member).split(";", 1)[0];
  for (let index = 1; index <= 25; index += 1) {
    expect(await create(`Key ${index}`, {}, cookie, member.csrfToken)).toBeInstanceOf(Response);
  }
  const rejected = await create("Key 26", {}, cookie, member.csrfToken);
  expect(rejected).not.toBeInstanceOf(Response);
  expect((rejected as Exclude<typeof rejected, Response>).data.errors.form).toContain("25");
  expect((await loader(get(cookie))).keys).toHaveLength(25);
});

test("each account sees and copies only its own keys, even as administrator", async () => {
  await create("Owner only");
  const ownerKey = await keyNamed("Owner only");
  expect((await loader(get(otherCookie))).keys).toEqual([]);
  const crossAccount = await copy(ownerKey.id, otherCookie, otherCsrf);
  expect(crossAccount.status).toBe(404);
  expect(await crossAccount.text()).not.toContain("oct_");
  expect((await copy("not-a-number")).status).toBe(404);

  expect(await create("Other's key", {}, otherCookie, otherCsrf)).toBeInstanceOf(Response);
  const otherKey = await keyNamed("Other's key", otherCookie);
  expect((await loader(get(ownerCookie))).keys.map((key) => key.id)).not.toContain(otherKey.id);
  expect((await copy(otherKey.id)).status).toBe(404);
});

test("anonymous, CSRF-less, and cross-site requests cannot create, list, or copy keys", async () => {
  await create("Protected");
  const { id } = await keyNamed("Protected");
  await expect(loader(get(""))).rejects.toMatchObject({ status: 302 });
  await expect(create("Anonymous", {}, "")).rejects.toMatchObject({ status: 302 });
  await expect(create("No CSRF", {}, ownerCookie, "invalid")).rejects.toMatchObject({ status: 403 });
  await expect(copy(id, "")).rejects.toMatchObject({ status: 302 });
  await expect(copy(id, ownerCookie, "invalid")).rejects.toMatchObject({ status: 403 });
  await expect(copy(id, ownerCookie, ownerCsrf, "https://attacker.example")).rejects.toMatchObject({ status: 403 });
});

test("deleting an account deletes its keys", async () => {
  const database = getApplicationDatabase().getClient();
  const member = await seedAuthenticatedAccount(getAuthenticationService(), database, "keys.deleted", "correct horse battery staple", "203.0.113.193");
  const cookie = serializeSessionCookie(member).split(";", 1)[0];
  await create("Doomed", {}, cookie, member.csrfToken);
  expect(deleteMemberAccount(database, { id: member.user.id, usernameNormalized: "keys.deleted" })).toBe(true);
  expect(database.get<{ total: number }>(sql`SELECT count(*) AS total FROM api_keys WHERE owner_id = ${member.user.id}`)?.total).toBe(0);
});
