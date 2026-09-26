import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import { getApplicationDatabase, initializeApplicationDatabase, shutdownApplicationDatabase } from "../../app/database/runtime.server";
import { action as settingsAction, loader as settingsLoader } from "../../app/routes/settings.oauth-clients";
import { action as authorize, loader as consent } from "../../app/routes/oauth.authorize";
import { action as tokenAction } from "../../app/routes/oauth.token";
import { loader as readDailyLog } from "../../app/routes/api.v1.daily-log";
import { loader as metadata } from "../../app/routes/oauth.metadata";
import { action as usersAction } from "../../app/routes/settings.users";
import { getGoalSetupService } from "../../app/setup/runtime.server";
import { validateSetupFields } from "../../app/setup/validation";
import { seedAuthenticatedAccount } from "../support/authentication";

const origin = "http://localhost:3000";
const callback = "https://server.example/callback";
const verifier = "a".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");
const password = "correct horse battery staple";
let directory: string;
let adminCookie: string;
let adminCsrf: string;
let memberCookie: string;
let memberCsrf: string;
let memberName: string;
let sequence = 0;

function args(request: Request) {
  return { request, params: {}, context: new RouterContextProvider(), pattern: new URL(request.url).pathname, url: new URL(request.url) };
}
function post(pathname: string, fields: Record<string, string>, cookie = memberCookie, csrfToken = memberCsrf) {
  return args(new Request(`${origin}${pathname}`, {
    method: "POST", headers: { Cookie: cookie, Origin: origin },
    body: new URLSearchParams({ csrfToken, ...fields }),
  }));
}
function authorizationUrl(clientId: string) {
  const url = new URL("/oauth/authorize", origin);
  for (const [key, value] of Object.entries({
    response_type: "code", client_id: clientId, redirect_uri: callback,
    scope: "daily-log:read", code_challenge: challenge, code_challenge_method: "S256",
    state: "confidential-state-0123456789",
  })) url.searchParams.set(key, value);
  return url;
}
function tokenPost(fields: Record<string, string>, clientId?: string, secret?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (clientId !== undefined && secret !== undefined) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${secret}`, "ascii").toString("base64")}`;
  }
  return args(new Request(`${origin}/oauth/token`, {
    method: "POST", headers, body: new URLSearchParams(fields),
  }));
}
function apiGet(token: string) {
  return args(new Request(`${origin}/api/v1/daily-log?date=2026-08-31`, { headers: { Authorization: `Bearer ${token}` } }));
}
async function register() {
  const result = await settingsAction(post("/settings/oauth-clients", {
    intent: "register", clientType: "confidential", name: "Server reader", redirectUris: callback,
  }, adminCookie, adminCsrf));
  expect(result.init?.status).toBe(201);
  const clientId = result.data.client?.id ?? "";
  const secret = result.data.clientSecret ?? "";
  expect(clientId).toMatch(/^[A-Za-z0-9_-]{32}$/u);
  expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  return { clientId, secret };
}
async function approve(clientId: string) {
  const url = authorizationUrl(clientId);
  const result = await authorize(post(url.pathname + url.search, { decision: "approve" }));
  expect(result.status).toBe(302);
  return new URL(result.headers.get("Location") ?? "").searchParams.get("code") ?? "";
}
function codeFields(clientId: string, code: string) {
  return { grant_type: "authorization_code", client_id: clientId, code, redirect_uri: callback, code_verifier: verifier };
}
async function issue(clientId: string, secret: string) {
  const code = await approve(clientId);
  const response = await tokenAction(tokenPost(codeFields(clientId, code), clientId, secret));
  expect(response.status).toBe(200);
  return await response.json() as { access_token: string; refresh_token: string; scope: string; expires_in: number };
}
function renew(clientId: string, secret: string | undefined, refreshToken: string) {
  return tokenAction(tokenPost({ grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken }, clientId, secret));
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "oauth-confidential-route-"));
  vi.stubEnv("APPLICATION_URL", origin);
  vi.stubEnv("DATABASE_PATH", path.join(directory, "application.sqlite"));
  vi.stubEnv("FOOD_LOG_TEST_NOW", "2026-08-31T16:00:00.000Z");
  vi.stubEnv("SETUP_TEST_NOW", "2026-08-31T16:00:00.000Z");
  initializeApplicationDatabase();
  const auth = getAuthenticationService();
  const admin = await auth.register("confidential.admin", password, "203.0.113.210");
  if (!admin.ok) throw new Error("Administrator registration failed");
  adminCookie = serializeSessionCookie(admin.session).split(";", 1)[0];
  adminCsrf = admin.session.csrfToken;
});
beforeEach(async () => {
  const auth = getAuthenticationService();
  memberName = `confidential.member.${++sequence}`;
  const member = await seedAuthenticatedAccount(auth, getApplicationDatabase().getClient(), memberName, password, "203.0.113.211");
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

test("registration, consent, denial, and metadata support confidential clients", async () => {
  const { clientId, secret } = await register();
  const ownerList = await settingsLoader(args(new Request(`${origin}/settings/oauth-clients`, { headers: { Cookie: adminCookie } })));
  expect(ownerList.clients).toEqual(expect.arrayContaining([expect.objectContaining({ id: clientId, type: "confidential" })]));
  expect(JSON.stringify(ownerList)).not.toContain(secret);
  const url = authorizationUrl(clientId);
  expect(await consent(args(new Request(url, { headers: { Cookie: memberCookie } })))).toMatchObject({ client: { id: clientId, name: "Server reader" } });
  const denied = await authorize(post(url.pathname + url.search, { decision: "deny" }));
  expect(new URL(denied.headers.get("Location") ?? "").searchParams.get("error")).toBe("access_denied");
  expect(new URL(denied.headers.get("Location") ?? "").searchParams.get("code")).toBeNull();
  const invalid = authorizationUrl(clientId);
  invalid.searchParams.set("redirect_uri", "https://attacker.example/callback");
  expect((await consent(args(new Request(invalid, { headers: { Cookie: memberCookie } }))) as Response).status).toBe(400);
  const noPkce = authorizationUrl(clientId);
  noPkce.searchParams.delete("code_challenge");
  expect((await consent(args(new Request(noPkce, { headers: { Cookie: memberCookie } }))) as Response).status).toBe(400);
  expect(await metadata().json()).toMatchObject({ token_endpoint_auth_methods_supported: ["none", "client_secret_basic"] });
});

test("code exchange requires the secret and PKCE, then reads and renews the scoped log", async () => {
  const { clientId, secret } = await register();
  const code = await approve(clientId);
  for (const response of [
    await tokenAction(tokenPost(codeFields(clientId, code))),
    await tokenAction(tokenPost(codeFields(clientId, code), clientId, "b".repeat(43))),
  ]) {
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Basic");
    expect(await response.json()).toEqual({ error: "invalid_client" });
  }
  const wrongVerifier = await tokenAction(tokenPost({ ...codeFields(clientId, code), code_verifier: "b".repeat(43) }, clientId, secret));
  expect(await wrongVerifier.json()).toEqual({ error: "invalid_grant" });
  const mismatchedClient = await tokenAction(tokenPost({ ...codeFields(clientId, code), client_id: "another-client" }, clientId, secret));
  expect(mismatchedClient.status).toBe(401);
  const bodySecret = await tokenAction(tokenPost({ ...codeFields(clientId, code), client_secret: secret }, clientId, secret));
  expect(await bodySecret.json()).toEqual({ error: "invalid_request" });
  const malformed = await tokenAction(args(new Request(`${origin}/oauth/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic not-base64!" },
    body: new URLSearchParams(codeFields(clientId, code)),
  })));
  expect(malformed.status).toBe(401);
  const accepted = await tokenAction(tokenPost(codeFields(clientId, code), clientId, secret));
  expect(accepted.status).toBe(200);
  const first = await accepted.json() as { access_token: string; refresh_token: string; scope: string; expires_in: number };
  expect(first).toMatchObject({ scope: "daily-log:read", expires_in: 900 });
  expect(readDailyLog(apiGet(secret)).status).toBe(401);
  const daily = readDailyLog(apiGet(first.access_token));
  expect(daily.status).toBe(200);
  expect(await daily.json()).toMatchObject({ version: "1", selectedDate: "2026-08-31", goal: { calorieTargetMilliKcal: 2_050_000 } });
  expect((await renew(clientId, undefined, first.refresh_token)).status).toBe(401);
  expect((await renew(clientId, "b".repeat(43), first.refresh_token)).status).toBe(401);
  const renewed = await renew(clientId, secret, first.refresh_token);
  expect(renewed.status).toBe(200);
  const second = await renewed.json() as typeof first;
  expect(second.refresh_token).not.toBe(first.refresh_token);
  expect(readDailyLog(apiGet(second.access_token)).status).toBe(200);
  expect(await (await renew(clientId, secret, first.refresh_token)).json()).toEqual({ error: "invalid_grant" });
});

test("a public client cannot use confidential credentials", async () => {
  const result = await settingsAction(post("/settings/oauth-clients", {
    intent: "register", clientType: "public", name: "Browser reader", redirectUris: callback,
  }, adminCookie, adminCsrf));
  const clientId = result.data.client?.id ?? "";
  const code = await approve(clientId);
  const rejected = await tokenAction(tokenPost(codeFields(clientId, code), clientId, "x".repeat(43)));
  expect(rejected.status).toBe(401);
  const accepted = await tokenAction(tokenPost(codeFields(clientId, code)));
  expect(accepted.status).toBe(200);
});

test("Basic authentication can identify a confidential client without a body client ID", async () => {
  const { clientId, secret } = await register();
  const code = await approve(clientId);
  const exchangeRequest = tokenPost({
    grant_type: "authorization_code", code, redirect_uri: callback, code_verifier: verifier,
  }, clientId, secret);
  exchangeRequest.request.headers.set("Authorization", `basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`);
  const exchanged = await tokenAction(exchangeRequest);
  expect(exchanged.status).toBe(200);
  const first = await exchanged.json() as { refresh_token: string };
  const renewalRequest = tokenPost({
    grant_type: "refresh_token", refresh_token: first.refresh_token,
  }, clientId, secret);
  renewalRequest.request.headers.set("Authorization", `bAsIc ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`);
  const renewed = await tokenAction(renewalRequest);
  expect(renewed.status).toBe(200);
});

test("malformed Basic client credentials are rejected before token exchange", async () => {
  for (const authorization of [
    "Bearer opaque",
    `Basic ${Buffer.from("missing-colon").toString("base64")}`,
    `Basic ${Buffer.from(`${"a".repeat(31)}:secret`).toString("base64")}`,
    `Basic ${Buffer.from(`${"a".repeat(32)}:short`).toString("base64")}`,
    "Basic a",
    "Basic !!!!",
  ]) {
    const response = await tokenAction(args(new Request(`${origin}/oauth/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: authorization },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: "a".repeat(32), refresh_token: "r".repeat(43) }),
    })));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_client" });
  }
});

test("connections remain account scoped and account state preserves grants", async () => {
  const { clientId, secret } = await register();
  const first = await issue(clientId, secret);
  const secondMember = await seedAuthenticatedAccount(getAuthenticationService(), getApplicationDatabase().getClient(), `confidential.other.${sequence}`, password, "203.0.113.212");
  const otherSetup = validateSetupFields({
    calories: "1800", carbohydrate: "200", displayUnits: "metric", fat: "60", fiber: "25",
    protein: "100", sodium: "2000", sugar: "40", timeZone: "America/Chicago", water: "75",
  });
  if (!otherSetup.success) throw new Error("Invalid second member setup");
  getGoalSetupService().completeInitial(secondMember.user.id, otherSetup.data);
  const otherCookie = serializeSessionCookie(secondMember).split(";", 1)[0];
  const otherCsrf = secondMember.csrfToken;
  const otherCodeResponse = await authorize(post(authorizationUrl(clientId).pathname + authorizationUrl(clientId).search, { decision: "approve" }, otherCookie, otherCsrf));
  const otherCode = new URL(otherCodeResponse.headers.get("Location") ?? "").searchParams.get("code") ?? "";
  const otherTokenResponse = await tokenAction(tokenPost(codeFields(clientId, otherCode), clientId, secret));
  expect(otherTokenResponse.status).toBe(200);
  const otherToken = await otherTokenResponse.json() as typeof first;
  expect(readDailyLog(apiGet(otherToken.access_token)).status).toBe(200);
  expect(await readDailyLog(apiGet(otherToken.access_token)).json()).toMatchObject({ goal: { calorieTargetMilliKcal: 1_800_000 } });
  const listed = await settingsLoader(args(new Request(`${origin}/settings/oauth-clients`, { headers: { Cookie: memberCookie } })));
  expect(listed.connections).toEqual(expect.arrayContaining([expect.objectContaining({ clientId, scope: "daily-log:read" })]));
  const disable = await usersAction(post("/settings/users", { intent: "disable-member", targetUsername: memberName, confirmationUsername: memberName }, adminCookie, adminCsrf));
  expect(disable.init?.status).toBe(200);
  expect(readDailyLog(apiGet(first.access_token)).status).toBe(401);
  expect((await renew(clientId, secret, first.refresh_token)).status).toBe(400);
  expect(readDailyLog(apiGet(otherToken.access_token)).status).toBe(200);
  const enabled = await usersAction(post("/settings/users", { intent: "reactivate-member", targetUsername: memberName }, adminCookie, adminCsrf));
  expect(enabled.init?.status).toBe(200);
  const reset = await usersAction(post("/settings/users", {
    intent: "reset-member-password", targetUsername: memberName,
    newPassword: "temporary route reset passphrase", confirmPassword: "temporary route reset passphrase",
  }, adminCookie, adminCsrf));
  expect(reset.init?.status).toBe(200);
  const restoredToken = await renew(clientId, secret, first.refresh_token);
  expect(restoredToken.status).toBe(200);
  expect(readDailyLog(apiGet((await restoredToken.json() as typeof first).access_token)).status).toBe(200);
  expect(readDailyLog(apiGet(otherToken.access_token)).status).toBe(200);
});

test("revocation invalidates one account's confidential tokens without affecting another", async () => {
  const { clientId, secret } = await register();
  const first = await issue(clientId, secret);
  const other = await seedAuthenticatedAccount(getAuthenticationService(), getApplicationDatabase().getClient(), `confidential.revocation.${sequence}`, password, "203.0.113.213");
  const otherCookie = serializeSessionCookie(other).split(";", 1)[0];
  const url = authorizationUrl(clientId);
  const approval = await authorize(post(url.pathname + url.search, { decision: "approve" }, otherCookie, other.csrfToken));
  const code = new URL(approval.headers.get("Location") ?? "").searchParams.get("code") ?? "";
  const response = await tokenAction(tokenPost(codeFields(clientId, code), clientId, secret));
  expect(response.status).toBe(200);
  const otherToken = await response.json() as typeof first;
  const revoked = await settingsAction(post("/settings/oauth-clients", { intent: "revoke", clientId }));
  expect(revoked.init?.status).toBe(200);
  expect(readDailyLog(apiGet(first.access_token)).status).toBe(401);
  expect((await renew(clientId, secret, first.refresh_token)).status).toBe(400);
  expect((await renew(clientId, secret, otherToken.refresh_token)).status).toBe(200);
});
