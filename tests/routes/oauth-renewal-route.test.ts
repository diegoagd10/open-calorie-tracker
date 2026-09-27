import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { sql } from "drizzle-orm";
import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import { getApplicationDatabase, initializeApplicationDatabase, shutdownApplicationDatabase } from "../../app/database/runtime.server";
import { action as registerClient, action as connectionAction, loader as connectionLoader } from "../../app/routes/settings.oauth-clients";
import { action as authorize } from "../../app/routes/oauth.authorize";
import { action as tokenAction } from "../../app/routes/oauth.token";
import { loader as readDailyLog } from "../../app/routes/api.v1.daily-log";
import { loader as metadata } from "../../app/routes/oauth.metadata";
import { action as usersAction } from "../../app/routes/settings.users";
import { getGoalSetupService } from "../../app/setup/runtime.server";
import { validateSetupFields } from "../../app/setup/validation";
import { seedAuthenticatedAccount } from "../support/authentication";

const origin = "http://localhost:3000";
const callback = "http://127.0.0.1:4567/callback";
const verifier = "a".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");
const password = "correct horse battery staple";
let directory: string;
let adminCookie: string;
let adminCsrf: string;
let memberCookie: string;
let memberCsrf: string;
let memberName: string;
let memberSequence = 0;

function args(request: Request) {
  return { request, params: {}, context: new RouterContextProvider(), pattern: new URL(request.url).pathname, url: new URL(request.url) };
}
function asResponse(value: unknown): Response {
  if (!(value instanceof Response)) throw new Error("Expected an OAuth redirect");
  return value;
}
function post(pathname: string, fields: Record<string, string>, cookie = memberCookie, csrfToken = memberCsrf) {
  return args(new Request(`${origin}${pathname}`, {
    method: "POST", headers: { Cookie: cookie, Origin: origin },
    body: new URLSearchParams({ csrfToken, ...fields }),
  }));
}
function tokenPost(fields: Record<string, string>) {
  return args(new Request(`${origin}/oauth/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  }));
}
function apiGet(accessToken: string) {
  return args(new Request(`${origin}/api/v1/daily-log?date=2026-08-31`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }));
}
function authorizationUrl(clientId: string) {
  const url = new URL("/oauth/authorize", origin);
  for (const [key, value] of Object.entries({
    response_type: "code", client_id: clientId, redirect_uri: callback,
    scope: "daily-log:read", code_challenge: challenge,
    code_challenge_method: "S256", state: "client-state-0123456789",
  })) url.searchParams.set(key, value);
  return url;
}
async function register(name: string) {
  const result = await registerClient(post("/settings/oauth-clients", {
    intent: "register", name, redirectUris: callback,
  }, adminCookie, adminCsrf));
  const id = result.data.client?.id;
  if (!id) throw new Error("OAuth client registration failed");
  return id;
}
async function issue(clientId: string) {
  const url = authorizationUrl(clientId);
  const approval = asResponse(await authorize(post(url.pathname + url.search, { decision: "approve", scope: "daily-log:read" })));
  const code = new URL(approval.headers.get("Location") ?? "").searchParams.get("code") ?? "";
  const response = await tokenAction(tokenPost({
    grant_type: "authorization_code", code, client_id: clientId,
    redirect_uri: callback, code_verifier: verifier,
  }));
  expect(response.status).toBe(200);
  return await response.json() as { access_token: string; refresh_token: string; expires_in: number; scope: string };
}
async function renew(clientId: string, refreshToken: string, extra: Record<string, string> = {}) {
  return tokenAction(tokenPost({
    grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken, ...extra,
  }));
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "oauth-renewal-route-"));
  vi.stubEnv("APPLICATION_URL", origin);
  vi.stubEnv("DATABASE_PATH", path.join(directory, "application.sqlite"));
  vi.stubEnv("FOOD_LOG_TEST_NOW", "2026-08-31T16:00:00.000Z");
  vi.stubEnv("SETUP_TEST_NOW", "2026-08-31T16:00:00.000Z");
  initializeApplicationDatabase();
  const auth = getAuthenticationService();
  const admin = await auth.register("oauth.admin", password, "203.0.113.200");
  if (!admin.ok) throw new Error("Administrator registration failed");
  adminCookie = serializeSessionCookie(admin.session).split(";", 1)[0];
  adminCsrf = admin.session.csrfToken;
});
beforeEach(async () => {
  const auth = getAuthenticationService();
  memberName = `oauth.member.${++memberSequence}`;
  const member = await seedAuthenticatedAccount(auth, getApplicationDatabase().getClient(), memberName, password, "203.0.113.201");
  memberCookie = serializeSessionCookie(member).split(";", 1)[0];
  memberCsrf = member.csrfToken;
  const setup = validateSetupFields({
    calories: "2050", carbohydrate: "230", displayUnits: "us", fat: "70", fiber: "25",
    protein: "120", sodium: "2300", sugar: "50", timeZone: "America/New_York", water: "80",
  });
  if (!setup.success) throw new Error("Invalid test setup");
  getGoalSetupService().completeInitial(member.user.id, setup.data);
});
afterAll(async () => {
  shutdownApplicationDatabase();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

test("public-client refresh rotates the stored credential and grants a new short-lived read token", async () => {
  const clientId = await register("Phone app");
  const first = await issue(clientId);
  expect(first).toMatchObject({
    access_token: expect.any(String) as unknown,
    refresh_token: expect.any(String) as unknown,
    expires_in: 900, scope: "daily-log:read",
  });
  expect(first.refresh_token).not.toBe(first.access_token);
  expect(await metadata().json()).toMatchObject({ grant_types_supported: ["authorization_code", "refresh_token"] });
  const refreshHash = createHash("sha256").update(first.refresh_token, "ascii").digest("hex");
  const stored = getApplicationDatabase().getClient().all(sql`SELECT token_hash FROM oauth_refresh_tokens WHERE token_hash = ${refreshHash}`);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toEqual({ token_hash: refreshHash });
  expect(JSON.stringify(stored)).not.toContain(first.refresh_token);
  const missing = await tokenAction(tokenPost({ grant_type: "refresh_token", client_id: clientId }));
  expect(await missing.json()).toEqual({ error: "invalid_request" });
  const wrongClient = await renew("another-client", first.refresh_token);
  expect(await wrongClient.json()).toEqual({ error: "invalid_client" });
  const widerScope = await renew(clientId, first.refresh_token, { scope: "daily-log:write" });
  expect(await widerScope.json()).toEqual({ error: "invalid_scope" });

  const renewed = await renew(clientId, first.refresh_token, { scope: "daily-log:read" });
  expect(renewed.status).toBe(200);
  expect(renewed.headers.get("Cache-Control")).toContain("no-store");
  const second = await renewed.json() as typeof first;
  expect(second.refresh_token).not.toBe(first.refresh_token);
  expect(second.access_token).not.toBe(first.access_token);
  expect(second).toMatchObject({ expires_in: 900, scope: "daily-log:read" });
  expect(readDailyLog(apiGet(second.access_token)).status).toBe(200);
  const replay = await renew(clientId, first.refresh_token);
  expect(replay.status).toBe(400);
  expect(await replay.json()).toEqual({ error: "invalid_grant" });
  expect(await (await renew(clientId, second.refresh_token)).json()).toEqual({ error: "invalid_grant" });
});

test("the account lists and revokes one connection without affecting another", async () => {
  const firstId = await register("Phone app");
  const secondId = await register("Desktop app");
  const first = await issue(firstId);
  const second = await issue(secondId);
  const otherAccount = await connectionAction(post("/settings/oauth-clients", { intent: "revoke", clientId: firstId }, adminCookie, adminCsrf));
  expect(otherAccount.init?.status).toBe(404);
  expect(readDailyLog(apiGet(first.access_token)).status).toBe(200);
  const listed = await connectionLoader(args(new Request(`${origin}/settings/oauth-clients`, { headers: { Cookie: memberCookie } })));
  expect(listed.connections).toEqual(expect.arrayContaining([
    expect.objectContaining({ clientId: firstId, name: "Phone app", scope: "daily-log:read" }),
    expect.objectContaining({ clientId: secondId, name: "Desktop app", scope: "daily-log:read" }),
  ]));
  await expect(connectionAction(post("/settings/oauth-clients", { intent: "revoke", clientId: firstId }, "", memberCsrf)))
    .rejects.toMatchObject({ status: 302 });
  await expect(connectionAction(post("/settings/oauth-clients", { intent: "revoke", clientId: firstId }, memberCookie, "bad")))
    .rejects.toMatchObject({ status: 403 });
  const revoked = await connectionAction(post("/settings/oauth-clients", { intent: "revoke", clientId: firstId }));
  expect(revoked.init?.status).toBe(200);
  expect(revoked.data).toMatchObject({ revokedClient: { clientId: firstId, name: "Phone app" } });
  expect(readDailyLog(apiGet(first.access_token)).status).toBe(401);
  expect(await (await renew(firstId, first.refresh_token)).json()).toEqual({ error: "invalid_grant" });
  expect(readDailyLog(apiGet(second.access_token)).status).toBe(200);
  expect((await renew(secondId, second.refresh_token)).status).toBe(200);
  const after = await connectionLoader(args(new Request(`${origin}/settings/oauth-clients`, { headers: { Cookie: memberCookie } })));
  expect(after.connections.map((connection: { clientId: string }) => connection.clientId)).toEqual([secondId]);
  const cannotRevokeAgain = await connectionAction(post("/settings/oauth-clients", { intent: "revoke", clientId: firstId }));
  expect(cannotRevokeAgain.init?.status).toBe(404);
});

test("account disable suspends read and renewal, and re-enable restores the grant", async () => {
  const clientId = await register("Phone app");
  const token = await issue(clientId);
  const disable = await usersAction(post("/settings/users", {
    intent: "disable-member", targetUsername: memberName, confirmationUsername: memberName,
  }, adminCookie, adminCsrf));
  expect(disable.init?.status).toBe(200);
  expect(readDailyLog(apiGet(token.access_token)).status).toBe(401);
  expect(await (await renew(clientId, token.refresh_token)).json()).toEqual({ error: "invalid_grant" });
  const restored = await usersAction(post("/settings/users", {
    intent: "reactivate-member", targetUsername: memberName,
  }, adminCookie, adminCsrf));
  expect(restored.init?.status).toBe(200);
  const hash = createHash("sha256").update(token.access_token, "ascii").digest("hex");
  getApplicationDatabase().getClient().run(sql`UPDATE oauth_access_tokens SET expires_at = '2020-01-01T00:00:00.000Z' WHERE token_hash = ${hash}`);
  expect(readDailyLog(apiGet(token.access_token)).status).toBe(401);
  const renewed = await renew(clientId, token.refresh_token);
  expect(renewed.status).toBe(200);
  const next = await renewed.json() as typeof token;
  expect(readDailyLog(apiGet(next.access_token)).status).toBe(200);
});

test("administrator password reset preserves the member's approved connection", async () => {
  const clientId = await register("Phone app");
  const token = await issue(clientId);
  const reset = await usersAction(post("/settings/users", {
    intent: "reset-member-password", targetUsername: memberName,
    newPassword: "temporary route reset passphrase", confirmPassword: "temporary route reset passphrase",
  }, adminCookie, adminCsrf));
  expect(reset.init?.status).toBe(200);
  expect(readDailyLog(apiGet(token.access_token)).status).toBe(200);
  const renewed = await renew(clientId, token.refresh_token);
  expect(renewed.status).toBe(200);
  const next = await renewed.json() as typeof token;
  expect(readDailyLog(apiGet(next.access_token)).status).toBe(200);
});
