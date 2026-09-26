import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { sql } from "drizzle-orm";
import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import { getApplicationDatabase, initializeApplicationDatabase, shutdownApplicationDatabase } from "../../app/database/runtime.server";
import { action as registerClient } from "../../app/routes/settings.oauth-clients";
import { action as authorize, loader as consent } from "../../app/routes/oauth.authorize";
import { action as loginAction, loader as loginLoader } from "../../app/routes/login";
import { action as exchangeCode } from "../../app/routes/oauth.token";
import { loader as readDailyLog } from "../../app/routes/api.v1.daily-log";
import { action as mutateDailyLog } from "../../app/routes/api.v1.daily-log";
import { loader as metadata } from "../../app/routes/oauth.metadata";
import { action as homeAction, loader as homeLoader } from "../../app/routes/home";
import { goalVersions } from "../../app/database/schema.server";
import { getGoalSetupService } from "../../app/setup/runtime.server";
import { validateSetupFields } from "../../app/setup/validation";
import { seedAuthenticatedAccount } from "../support/authentication";

const origin = "http://localhost:3000";
const redirectUri = "http://127.0.0.1:4567/callback";
const date = "2026-08-31";
const verifier = "a".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");
let directory: string;
let ownerCookie: string;
let ownerCsrf: string;
let readerCookie: string;
let readerCsrf: string;
let readerId: number;
let declinerCookie: string;
let declinerCsrf: string;
let incompleteCookie: string;
let incompleteCsrf: string;
let incompleteId: number;
let clientId: string;

function args(request: Request, pattern = new URL(request.url).pathname) {
  return { request, params: {}, context: new RouterContextProvider(), pattern, url: new URL(request.url) };
}
function authorizationUrl(state = "client-state-0123456789") {
  const url = new URL("/oauth/authorize", origin);
  for (const [key, value] of Object.entries({
    response_type: "code", client_id: clientId, redirect_uri: redirectUri,
    scope: "daily-log:read", code_challenge: challenge,
    code_challenge_method: "S256", state,
  })) url.searchParams.set(key, value);
  return url;
}
function authorizationRequest(cookie = readerCookie, url = authorizationUrl()) {
  return args(new Request(url, { headers: { Cookie: cookie } }));
}
function consentPost(decision: "approve" | "deny", cookie = readerCookie, csrfToken = readerCsrf, url = authorizationUrl()) {
  return args(new Request(url, {
    method: "POST", headers: { Cookie: cookie, Origin: origin },
    body: new URLSearchParams({ decision, csrfToken }),
  }));
}
function tokenPost(code: string, overrides: Record<string, string> = {}) {
  return args(new Request(`${origin}/oauth/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, client_id: clientId,
      redirect_uri: redirectUri, code_verifier: verifier, ...overrides,
    }),
  }));
}
function apiGet(token: string, requestedDate = date) {
  return args(new Request(`${origin}/api/v1/daily-log?date=${requestedDate}`, {
    headers: { Authorization: `Bearer ${token}` },
  }));
}
async function issueToken(cookie = readerCookie, csrfToken = readerCsrf) {
  const approval = await authorize(consentPost("approve", cookie, csrfToken));
  const code = new URL(approval.headers.get("Location") ?? "").searchParams.get("code") ?? "";
  const response = await exchangeCode(tokenPost(code));
  expect(response.status).toBe(200);
  return (await response.json() as { access_token: string }).access_token;
}
function homePost(fields: Record<string, string>) {
  return args(new Request(`${origin}/`, {
    method: "POST",
    headers: { Cookie: readerCookie, Origin: origin, "X-Test-Food-Log-Now": "2026-08-31T16:00:00.000Z" },
    body: new URLSearchParams({ csrfToken: readerCsrf, date, ...fields }),
  }), "/");
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "oauth-daily-log-route-"));
  vi.stubEnv("APPLICATION_URL", origin);
  vi.stubEnv("DATABASE_PATH", path.join(directory, "application.sqlite"));
  vi.stubEnv("FOOD_LOG_TEST_NOW", "2026-08-31T16:00:00.000Z");
  vi.stubEnv("SETUP_TEST_NOW", "2026-08-31T16:00:00.000Z");
  initializeApplicationDatabase();
  const auth = getAuthenticationService();
  const owner = await auth.register("oauth.admin", "correct horse battery staple", "203.0.113.190");
  if (!owner.ok) throw new Error("Could not register owner");
  ownerCookie = serializeSessionCookie(owner.session).split(";", 1)[0];
  ownerCsrf = owner.session.csrfToken;
  const reader = await seedAuthenticatedAccount(auth, getApplicationDatabase().getClient(), "oauth.reader", "correct horse battery staple", "203.0.113.191");
  readerCookie = serializeSessionCookie(reader).split(";", 1)[0];
  readerCsrf = reader.csrfToken;
  readerId = reader.user.id;
  const decliner = await seedAuthenticatedAccount(auth, getApplicationDatabase().getClient(), "oauth.decliner", "correct horse battery staple", "203.0.113.192");
  declinerCookie = serializeSessionCookie(decliner).split(";", 1)[0];
  declinerCsrf = decliner.csrfToken;
  const incomplete = await seedAuthenticatedAccount(auth, getApplicationDatabase().getClient(), "oauth.incomplete", "correct horse battery staple", "203.0.113.193");
  incompleteCookie = serializeSessionCookie(incomplete).split(";", 1)[0];
  incompleteCsrf = incomplete.csrfToken;
  incompleteId = incomplete.user.id;
  const setup = validateSetupFields({
    calories: "2050", carbohydrate: "230", displayUnits: "us", fat: "70", fiber: "25",
    protein: "120", sodium: "2300", sugar: "50", timeZone: "America/New_York", water: "80",
  });
  if (!setup.success) throw new Error("Invalid test setup");
  getGoalSetupService().completeInitial(reader.user.id, setup.data);
  const registered = await registerClient(args(new Request(`${origin}/settings/oauth-clients`, {
    method: "POST", headers: { Cookie: ownerCookie, Origin: origin },
    body: new URLSearchParams({ intent: "register", csrfToken: ownerCsrf, name: "Daily Log CLI", redirectUris: redirectUri }),
  })));
  clientId = registered.data.client?.id ?? "";
  if (!clientId) throw new Error("Client registration failed");
});
afterAll(async () => {
  shutdownApplicationDatabase();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

test("a public client gains a scoped, short-lived token only after consent and PKCE exchange", async () => {
  expect(await consent(authorizationRequest())).toMatchObject({
    client: { id: clientId, name: "Daily Log CLI" },
    permission: "Read your daily Food Log",
    csrfToken: readerCsrf,
  });
  const approved = await authorize(consentPost("approve"));
  expect(approved.status).toBe(302);
  const callback = new URL(approved.headers.get("Location") ?? "");
  expect(callback.origin + callback.pathname).toBe(redirectUri.replace("/callback", "") + "/callback");
  expect(callback.searchParams.get("state")).toBe("client-state-0123456789");
  const code = callback.searchParams.get("code") ?? "";
  expect(code).not.toBe("");

  const tokenResponse = await exchangeCode(tokenPost(code));
  expect(tokenResponse.status).toBe(200);
  const token = await tokenResponse.json() as { access_token: string; token_type: string; expires_in: number; scope: string };
  expect(token).toMatchObject({ access_token: expect.any(String) as unknown, token_type: "Bearer", expires_in: 900, scope: "daily-log:read" });
  expect(tokenResponse.headers.get("Cache-Control")).toContain("no-store");
  const daily = readDailyLog(apiGet(token.access_token));
  expect(daily.status).toBe(200);
  expect(await daily.json()).toMatchObject({
    version: "1", selectedDate: date, today: date, isFuture: false,
    timeZone: "America/New_York", displayUnits: "us",
    goal: { calorieTargetMilliKcal: 2_050_000 },
    foodEntries: [], waterEvents: [], events: [], waterTotalMicroliters: 0,
  });
  expect(daily.headers.get("Cache-Control")).toContain("no-store");
});

test("sign-in resumes a valid public authorization request without accepting arbitrary destinations", async () => {
  const authorization = authorizationUrl();
  const returnPath = authorization.pathname + authorization.search;
  const anonymous = await consent(authorizationRequest("")).catch((error: unknown) => error);
  expect(anonymous).toBeInstanceOf(Response);
  const loginLocation = (anonymous as Response).headers.get("Location") ?? "";
  expect((anonymous as Response).status).toBe(302);
  expect(new URL(loginLocation, origin).searchParams.get("next")).toBe(returnPath);

  const loginPage = await loginLoader(args(new Request(`${origin}${loginLocation}`), "/login"));
  if (loginPage instanceof Response) throw new Error("Expected login form");
  expect(loginPage.data.returnPath).toBe(returnPath);
  expect(loginPage.data.loginAction).toBe(loginLocation);
  const preAuthCookie = new Headers(loginPage.init?.headers).get("Set-Cookie")?.split(";", 1)[0] ?? "";
  const signedIn = await loginAction(args(new Request(`${origin}${loginLocation}`, {
    method: "POST", headers: { Cookie: preAuthCookie, Origin: origin },
    body: new URLSearchParams({ csrfToken: loginPage.data.csrfToken, username: "oauth.reader", password: "correct horse battery staple" }),
  }), "/login"));
  expect(signedIn).toBeInstanceOf(Response);
  expect((signedIn as Response).headers.get("Location")).toBe(returnPath);
  const signedInCookie = (signedIn as Response).headers.get("Set-Cookie")?.split(";", 1)[0] ?? "";
  expect(await consent(authorizationRequest(signedInCookie))).toMatchObject({ client: { id: clientId } });
  const alreadySignedIn = await loginLoader(args(new Request(`${origin}${loginLocation}`, { headers: { Cookie: readerCookie } }), "/login"));
  expect((alreadySignedIn as Response).headers.get("Location")).toBe(returnPath);

  const invalidAuthorization = authorizationUrl();
  invalidAuthorization.searchParams.set("redirect_uri", "https://attacker.example/callback");
  const rejectedAuthorization = await consent(authorizationRequest("", invalidAuthorization));
  expect((rejectedAuthorization as Response).status).toBe(400);
  expect((rejectedAuthorization as Response).headers.get("Location")).toBeNull();

  for (const next of ["https://attacker.example/", "//attacker.example/", "/oauth/authorize?client_id=unknown", "/settings/users"]) {
    const rejected = await loginLoader(args(new Request(`${origin}/login?next=${encodeURIComponent(next)}`), "/login"));
    if (rejected instanceof Response) throw new Error("Expected login form");
    expect(rejected.data.returnPath).toBe("/");
  }
});

test("metadata describes the public PKCE flow and denial creates no code", async () => {
  const document = metadata();
  expect(await document.json()).toMatchObject({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["daily-log:read"],
    token_endpoint_auth_methods_supported: ["none"],
  });
  const denied = await authorize(consentPost("deny", declinerCookie, declinerCsrf));
  const callback = new URL(denied.headers.get("Location") ?? "");
  expect(callback.searchParams.get("error")).toBe("access_denied");
  expect(callback.searchParams.get("code")).toBeNull();
  expect(callback.searchParams.get("state")).toBe("client-state-0123456789");
  const token = await exchangeCode(tokenPost("z".repeat(43)));
  expect(token.status).toBe(400);
  expect(await token.json()).toEqual({ error: "invalid_grant" });
});

test("authorization rejects unsafe requests and never redirects to an unregistered callback", async () => {
  await expect(consent(authorizationRequest(""))).rejects.toMatchObject({ status: 302 });
  await expect(authorize(consentPost("approve", ""))).rejects.toMatchObject({ status: 302 });
  await expect(authorize(consentPost("approve", readerCookie, "invalid"))).rejects.toMatchObject({ status: 403 });
  const invalidRequests: Record<string, string>[] = [
    { redirect_uri: "https://attacker.example/callback" },
    { client_id: "unknown-client" },
    { scope: "daily-log:write" },
    { code_challenge_method: "plain" },
    { code_challenge: "invalid" },
    { response_type: "token" },
    { state: "short" },
  ];
  for (const changes of invalidRequests) {
    const url = authorizationUrl();
    for (const [key, value] of Object.entries(changes)) url.searchParams.set(key, value);
    const rejected = await consent(authorizationRequest(readerCookie, url));
    expect(rejected).toBeInstanceOf(Response);
    expect((rejected as Response).status).toBe(400);
    expect((rejected as Response).headers.get("Location")).toBeNull();
  }
  const badRedirect = authorizationUrl();
  badRedirect.searchParams.set("redirect_uri", "https://attacker.example/callback");
  const rejectedPost = await authorize(consentPost("approve", readerCookie, readerCsrf, badRedirect));
  expect(rejectedPost.status).toBe(400);
  expect(rejectedPost.headers.get("Location")).toBeNull();
  const invalidDecision = await authorize(args(new Request(authorizationUrl(), {
    method: "POST", headers: { Cookie: readerCookie, Origin: origin },
    body: new URLSearchParams({ csrfToken: readerCsrf, decision: "maybe" }),
  })));
  expect(invalidDecision.status).toBe(400);
});

test("code exchange binds the public client, exact redirect, verifier, and one use", async () => {
  const approved = await authorize(consentPost("approve"));
  const code = new URL(approved.headers.get("Location") ?? "").searchParams.get("code") ?? "";
  const invalidExchanges: Record<string, string>[] = [
    { code_verifier: "b".repeat(43) },
    { redirect_uri: "http://127.0.0.1:4568/callback" },
    { client_id: "another-client" },
  ];
  for (const overrides of invalidExchanges) {
    const failure = await exchangeCode(tokenPost(code, overrides));
    expect(failure.status).toBe(400);
    expect(await failure.json()).toMatchObject({ error: expect.stringMatching(/^invalid_(grant|client)$/u) as unknown });
  }
  const success = await exchangeCode(tokenPost(code));
  expect(success.status).toBe(200);
  const replay = await exchangeCode(tokenPost(code));
  expect(replay.status).toBe(400);
  expect(await replay.json()).toEqual({ error: "invalid_grant" });
});

test("token endpoint rejects malformed and unsupported requests without issuing credentials", async () => {
  const wrongType = await exchangeCode(args(new Request(`${origin}/oauth/token`, {
    method: "POST", headers: { "Content-Type": "text/plain" }, body: "grant_type=authorization_code",
  })));
  expect(wrongType.status).toBe(400);
  expect(await wrongType.json()).toEqual({ error: "invalid_request" });
  const oversized = await exchangeCode(args(new Request(`${origin}/oauth/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "x".repeat(4_097),
  })));
  expect(await oversized.json()).toEqual({ error: "invalid_request" });
  const unsupported = await exchangeCode(tokenPost("c".repeat(43), { grant_type: "password" }));
  expect(await unsupported.json()).toEqual({ error: "unsupported_grant_type" });
  const invalidVerifier = await exchangeCode(tokenPost("c".repeat(43), { code_verifier: "short" }));
  expect(await invalidVerifier.json()).toEqual({ error: "invalid_request" });
});

test("the versioned resource preserves populated, empty, historical, and future Food Log behavior", async () => {
  getApplicationDatabase().getClient().insert(goalVersions).values({
    userId: readerId, effectiveDate: "2026-08-01", calorieTargetMilliKcal: 1_800_000,
    waterTargetMicroliters: 2_000_000, proteinTargetMilligrams: 120_000,
    carbohydrateTargetMilligrams: 230_000, fatTargetMilligrams: 70_000,
    fiberTargetMilligrams: 25_000, sugarMaximumMilligrams: 50_000,
    sodiumMaximumMilligrams: 2_300, createdAt: "2026-08-01T12:00:00.000Z",
  }).run();
  const previousDate = "2026-08-30";
  const food = await homeAction(homePost({
    date: previousDate, intent: "log-manual-food", idempotencyKey: "oauth-manual-food",
    name: "Tortillas", quantity: "3", energyKcal: "180", proteinGrams: "6",
    carbohydrateGrams: "36", fatGrams: "3", fiberGrams: "4", sugarGrams: "1", sodiumMilligrams: "30",
  }));
  expect(food).toBeInstanceOf(Response);
  const water = await homeAction(homePost({ date: previousDate, intent: "create-water", waterSelection: "8" }));
  expect(water).toBeInstanceOf(Response);
  getApplicationDatabase().getClient().run(sql`UPDATE food_entries SET authoritative_fiber_milligrams = NULL WHERE idempotency_key = 'oauth-manual-food'`);

  const token = await issueToken();
  const historicalResponse = readDailyLog(apiGet(token, previousDate));
  expect(historicalResponse.status).toBe(200);
  const historical = await historicalResponse.json() as Record<string, unknown> & {
    foodEntries: Array<Record<string, unknown>>;
    waterEvents: Array<Record<string, unknown>>;
    events: Array<{ kind: string; id: number }>;
    nutritionTotals: Record<string, { known: number; isIncomplete: boolean }>;
    goal: { calorieTargetMilliKcal: number; effectiveDate: string };
    waterTotalMicroliters: number;
  };
  expect(Object.keys(historical).sort()).toEqual([
    "displayUnits", "events", "foodEntries", "goal", "isFuture", "nutritionTotals",
    "selectedDate", "timeZone", "today", "version", "waterEvents", "waterTotalMicroliters",
  ].sort());
  expect(historical.goal).toMatchObject({ effectiveDate: "2026-08-01", calorieTargetMilliKcal: 1_800_000 });
  expect(historical.foodEntries).toHaveLength(1);
  expect(historical.foodEntries[0]).toMatchObject({ name: "Tortillas", energyMilliKcal: 180_000, fiberMilligrams: null, quantityMicrounits: 3_000_000 });
  expect(historical.waterEvents).toHaveLength(1);
  expect(historical.waterTotalMicroliters).toBeGreaterThan(0);
  expect(historical.nutritionTotals.energyMilliKcal).toEqual({ known: 180_000, isIncomplete: false });
  expect(historical.nutritionTotals.fiberMilligrams).toEqual({ known: 0, isIncomplete: true });

  const page = await homeLoader(args(new Request(`${origin}/?date=${previousDate}`, {
    headers: { Cookie: readerCookie, "X-Test-Food-Log-Now": "2026-08-31T16:00:00.000Z" },
  }), "/"));
  if (page instanceof Response) throw new Error("Expected Food Log page data");
  expect(historical.events.map(({ kind, id }) => ({ kind, id }))).toEqual(
    page.data.foodLog.events.map(({ kind, id }) => ({ kind, id })),
  );
  expect(historical.foodEntries[0].energyMilliKcal).toBe(page.data.foodLog.entries[0].energyMilliKcal);
  expect(historical.waterTotalMicroliters).toBe(page.data.foodLog.waterTotalMicroliters);
  expect(historical.goal.calorieTargetMilliKcal).toBe(page.data.foodLog.goal?.calorieTargetMilliKcal);

  const empty: unknown = await readDailyLog(apiGet(token, "2026-08-29")).json();
  expect(empty).toMatchObject({ selectedDate: "2026-08-29", foodEntries: [], waterEvents: [], events: [], waterTotalMicroliters: 0 });
  const future: unknown = await readDailyLog(apiGet(token, "2026-09-01")).json();
  expect(future).toMatchObject({ selectedDate: "2026-09-01", isFuture: true, foodEntries: [], waterEvents: [], events: [], goal: { calorieTargetMilliKcal: 2_050_000 } });
});

test("API errors are machine readable, private, and account scoped", async () => {
  const token = await issueToken();
  const lowercaseScheme = readDailyLog(args(new Request(`${origin}/api/v1/daily-log?date=${date}`, {
    headers: { Authorization: `bearer ${token}` },
  })));
  expect(lowercaseScheme.status).toBe(200);
  for (const request of [
    args(new Request(`${origin}/api/v1/daily-log?date=${date}`)),
    args(new Request(`${origin}/api/v1/daily-log?date=${date}`, { headers: { Cookie: readerCookie } })),
    apiGet(clientId),
  ]) {
    const response = readDailyLog(request);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_token" });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  }
  for (const requestedDate of ["2026-02-30", "not-a-date", ""]) {
    const response = readDailyLog(apiGet(token, requestedDate));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_date" });
  }
  const missingDate = readDailyLog(args(new Request(`${origin}/api/v1/daily-log`, { headers: { Authorization: `Bearer ${token}` } })));
  expect(missingDate.status).toBe(400);
  expect(await missingDate.json()).toEqual({ error: "invalid_date" });
  const duplicateDate = readDailyLog(args(new Request(`${origin}/api/v1/daily-log?date=${date}&date=${date}`, { headers: { Authorization: `Bearer ${token}` } })));
  expect(duplicateDate.status).toBe(400);
  expect(await duplicateDate.json()).toEqual({ error: "invalid_date" });
  const ownDay = readDailyLog(apiGet(token));
  const ignoredUserId = readDailyLog(args(new Request(`${origin}/api/v1/daily-log?date=${date}&userId=${incompleteId}`, { headers: { Authorization: `Bearer ${token}` } })));
  expect(ignoredUserId.status).toBe(200);
  expect(await ignoredUserId.json()).toEqual(await ownDay.json());

  const incompleteToken = await issueToken(incompleteCookie, incompleteCsrf);
  const missingSetup = readDailyLog(apiGet(incompleteToken));
  expect(missingSetup.status).toBe(409);
  expect(await missingSetup.json()).toEqual({ error: "missing_setup" });
  expect(missingSetup.headers.get("Cache-Control")).toContain("no-store");
  const write = mutateDailyLog();
  expect(write.status).toBe(405);
  expect(await write.json()).toEqual({ error: "method_not_allowed" });
});

test("insufficient permission, disabled accounts, and expired tokens cannot read", async () => {
  const token = await issueToken();
  const database = getApplicationDatabase().getClient();
  try {
    database.run(sql`UPDATE oauth_grants SET scope = 'other:read' WHERE client_id = ${clientId} AND user_id = ${readerId}`);
    const insufficient = readDailyLog(apiGet(token));
    expect(insufficient.status).toBe(403);
    expect(await insufficient.json()).toEqual({ error: "insufficient_scope" });
    expect(insufficient.headers.get("WWW-Authenticate")).toContain('error="insufficient_scope"');
  } finally {
    database.run(sql`UPDATE oauth_grants SET scope = 'daily-log:read' WHERE client_id = ${clientId} AND user_id = ${readerId}`);
  }
  try {
    database.run(sql`UPDATE users SET access_state = 'disabled' WHERE id = ${readerId}`);
    const disabled = readDailyLog(apiGet(token));
    expect(disabled.status).toBe(401);
    expect(await disabled.json()).toEqual({ error: "invalid_token" });
  } finally {
    database.run(sql`UPDATE users SET access_state = 'active' WHERE id = ${readerId}`);
  }
  const tokenHash = createHash("sha256").update(token, "ascii").digest("hex");
  database.run(sql`UPDATE oauth_access_tokens SET expires_at = '2020-01-01T00:00:00.000Z' WHERE token_hash = ${tokenHash}`);
  const expired = readDailyLog(apiGet(token));
  expect(expired.status).toBe(401);
  expect(await expired.json()).toEqual({ error: "invalid_token" });
});
