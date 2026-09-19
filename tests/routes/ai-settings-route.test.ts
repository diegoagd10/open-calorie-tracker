import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import { getApplicationDatabase, initializeApplicationDatabase, shutdownApplicationDatabase } from "../../app/database/runtime.server";
import { shutdownPhotoAnalysis } from "../../app/photo-analysis/runtime.server";
import { action, loader, headers, meta } from "../../app/routes/settings.ai";
import { seedAuthenticatedAccount } from "../support/authentication";

const origin = "http://localhost:3000";
const validPair = {
  geminiKey: "AIzaSyRouteGeminiCredential_1234567890",
  typeSafeKey: "ts_live_RouteTypeSafeCredential_1234567890",
};
let directory: string;
let adminCookie: string;
let memberCookie: string;
let csrfToken: string;
const network = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>(
  async () => new Response('{"models":[]}', { status: 200 }),
);
function args(request: Request) {
  return { request, params: {}, context: new RouterContextProvider(), pattern: "/settings/ai", url: new URL(request.url) };
}
function request(cookie = adminCookie) {
  return new Request(`${origin}/settings/ai`, { headers: { Cookie: cookie } });
}
function post(fields: Record<string, string>, cookie = adminCookie, requestOrigin = origin) {
  return args(new Request(`${origin}/settings/ai`, {
    method: "POST", headers: { Cookie: cookie, Origin: requestOrigin },
    body: new URLSearchParams({ csrfToken, ...fields }),
  }));
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "ai-settings-route-"));
  vi.stubEnv("APPLICATION_URL", origin);
  vi.stubEnv("DATABASE_PATH", path.join(directory, "application.sqlite"));
  vi.stubEnv("APPLICATION_SECRETS_PATH", path.join(directory, "secrets"));
  vi.stubGlobal("fetch", network);
  initializeApplicationDatabase();
  const auth = getAuthenticationService();
  const admin = await auth.register("settings.admin", "correct horse battery staple", "203.0.113.188");
  if (!admin.ok) throw new Error("Could not register administrator");
  adminCookie = serializeSessionCookie(admin.session).split(";", 1)[0];
  csrfToken = admin.session.csrfToken;
  const member = await seedAuthenticatedAccount(auth, getApplicationDatabase().getClient(), "settings.member", "correct horse battery staple", "203.0.113.189");
  memberCookie = serializeSessionCookie(member).split(";", 1)[0];
});
beforeEach(() => {
  network.mockReset();
  network.mockResolvedValue(new Response('{"models":[]}', { status: 200 }));
});
afterAll(async () => {
  shutdownPhotoAnalysis();
  shutdownApplicationDatabase();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(directory, { force: true, recursive: true });
});

test("only administrators can read or mutate shared Photo Analysis credentials", async () => {
  await expect(loader(args(request("")))).rejects.toMatchObject({ status: 302 });
  await expect(loader(args(request(memberCookie)))).rejects.toMatchObject({ status: 404 });
  for (const intent of ["save", "delete", "connect", "disconnect", "cancel"]) {
    await expect(action(post({ intent }, ""))).rejects.toMatchObject({ status: 302 });
    await expect(action(post({ intent }, memberCookie))).rejects.toMatchObject({ status: 404 });
    await expect(action(post({ intent, csrfToken: "invalid" }))).rejects.toMatchObject({ status: 403 });
    await expect(action(post({ intent }, adminCookie, "https://attacker.example"))).rejects.toMatchObject({ status: 403 });
  }
  expect(network).not.toHaveBeenCalled();
  expect(await loader(args(request()))).toMatchObject({
    csrfToken,
    username: "settings.admin",
    credentials: { state: "unconfigured" },
    connection: { connected: false, busy: false },
  });
  expect(headers()).toEqual({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  expect((await loader(args(request()))).today).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  expect(meta()).toEqual([{ title: "AI photo estimates · Open Calorie Tracker" }]);
});

test("saves a validated pair atomically and never returns secret values", async () => {
  const response = await action(post({ intent: "save", ...validPair }));
  expect(response.data).toEqual({ area: "credentials", success: "Photo Analysis credentials saved." });
  expect(network).toHaveBeenCalledTimes(2);

  const state = await loader(args(request()));
  expect(state.credentials).toMatchObject({
    state: "configured",
    configuredAt: expect.any(String) as unknown,
    updatedAt: expect.any(String) as unknown,
    validatedAt: expect.any(String) as unknown,
  });
  expect(JSON.stringify(state)).not.toContain(validPair.geminiKey);
  expect(JSON.stringify(state)).not.toContain(validPair.typeSafeKey);
  expect(JSON.stringify(response.data)).not.toContain(validPair.geminiKey);
  expect(JSON.stringify(response.data)).not.toContain(validPair.typeSafeKey);
});

test("input, provider, and persistence failures preserve the configured pair", async () => {
  network.mockClear();
  const inputFailure = await action(post({ intent: "save", geminiKey: "short", typeSafeKey: validPair.typeSafeKey }));
  expect(inputFailure.init?.status).toBe(400);
  expect(inputFailure.data.fieldErrors?.geminiKey).toContain("Gemini key");
  expect(network).not.toHaveBeenCalled();

  network.mockResolvedValueOnce(new Response("rejected", { status: 401 }));
  network.mockResolvedValueOnce(new Response('{"models":[]}', { status: 200 }));
  const validationFailure = await action(post({
    intent: "save",
    geminiKey: "AIzaSyReplacementGemini_1234567890",
    typeSafeKey: "ts_live_ReplacementTypeSafe_1234567890",
  }));
  expect(validationFailure.init?.status).toBe(422);
  expect(validationFailure.data).toMatchObject({
    error: "The credential pair could not be validated.",
    area: "credentials",
    fieldErrors: { geminiKey: "Gemini rejected this key." },
  });

  getApplicationDatabase().getClient().run(sql.raw(`
    CREATE TRIGGER reject_settings_credential_update
    BEFORE UPDATE ON encrypted_credential_bundles
    BEGIN SELECT RAISE(ABORT, 'private persistence detail'); END
  `));
  network.mockResolvedValue(new Response('{"models":[]}', { status: 200 }));
  const persistenceFailure = await action(post({
    intent: "save",
    geminiKey: "AIzaSyPersistGemini_1234567890",
    typeSafeKey: "ts_live_PersistTypeSafe_1234567890",
  }));
  expect(persistenceFailure.init?.status).toBe(503);
  expect(persistenceFailure.data).toEqual({
    area: "credentials",
    error: "Credentials could not be saved. The previous pair remains active.",
  });
  expect(JSON.stringify(persistenceFailure.data)).not.toContain("private persistence detail");
  getApplicationDatabase().getClient().run(sql`DROP TRIGGER reject_settings_credential_update`);
  expect((await loader(args(request()))).credentials.state).toBe("configured");
});

test("deletion requires explicit confirmation and removes the pair for future reads", async () => {
  const rejected = await action(post({ intent: "delete" }));
  expect(rejected.init?.status).toBe(400);
  expect(rejected.data).toEqual({ area: "credentials", error: "Confirm deletion before removing the shared credentials." });
  expect((await loader(args(request()))).credentials.state).toBe("configured");

  const deleted = await action(post({ intent: "delete", confirmation: "delete" }));
  expect(deleted.data).toEqual({ area: "credentials", success: "Photo Analysis credentials deleted." });
  expect((await loader(args(request()))).credentials).toEqual({ state: "unconfigured" });
  expect((await action(post({ intent: "unknown" }))).init?.status).toBe(400);
});

test("a deletion persistence failure keeps the configured pair and exposes no storage detail", async () => {
  await action(post({ intent: "save", ...validPair }));
  getApplicationDatabase().getClient().run(sql.raw(`
    CREATE TRIGGER reject_settings_credential_delete
    BEFORE DELETE ON encrypted_credential_bundles
    BEGIN SELECT RAISE(ABORT, 'private delete detail'); END
  `));
  const response = await action(post({ intent: "delete", confirmation: "delete" }));
  expect(response.init?.status).toBe(503);
  expect(response.data).toEqual({
    area: "credentials",
    error: "Credentials could not be deleted. The previous pair remains active.",
  });
  expect(JSON.stringify(response.data)).not.toContain("private delete detail");
  getApplicationDatabase().getClient().run(sql`DROP TRIGGER reject_settings_credential_delete`);
  expect((await loader(args(request()))).credentials.state).toBe("configured");
});

test("the existing Pi connection flow remains operational during the credential-storage expand step", async () => {
  expect((await action(post({ intent: "connect" }))).data.error).toBeUndefined();
  await vi.waitFor(async () => {
    const connection = (await loader(args(request()))).connection;
    expect(connection.attempt).toMatchObject({ state: "waiting" });
    expect(connection.attempt?.authorizationUrl).toContain("https://auth.openai.com/oauth/authorize?");
  });
  const state = await loader(args(request()));
  expect(JSON.stringify(state)).not.toContain("access_token");
  expect((await action(post({ intent: "connect" }))).init?.status).toBe(409);
  expect((await action(post({ intent: "cancel", attemptId: "stale" }))).init?.status).toBe(409);
  expect((await action(post({ intent: "cancel", attemptId: state.connection.attempt!.id }))).data.error).toBeUndefined();
  expect((await loader(args(request()))).connection).toMatchObject({ busy: false, connected: false, attempt: { state: "cancelled" } });
  expect((await action(post({ intent: "disconnect" }))).data.error).toBeUndefined();
});
