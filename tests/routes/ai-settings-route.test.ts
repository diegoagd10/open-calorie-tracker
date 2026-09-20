import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
const network = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>();
function providerResponse(input: string | URL) {
  return String(input).includes("generativelanguage")
    ? Response.json({ models: [{ name: "models/gemini-3.1-flash-lite", displayName: "Gemini 3.1 Flash-Lite", supportedGenerationMethods: ["generateContent"] }] })
    : Response.json({ data: [{ id: "jev", effective_model: "jev-1.13.0" }, { id: "jev-1.14.0" }] });
}
function args(request: Request) {
  return { request, params: {}, context: new RouterContextProvider(), pattern: "/settings/ai", url: new URL(request.url) };
}
function request(cookie = adminCookie) { return new Request(`${origin}/settings/ai`, { headers: { Cookie: cookie } }); }
function post(fields: Record<string, string>, cookie = adminCookie, requestOrigin = origin) {
  return args(new Request(`${origin}/settings/ai`, {
    method: "POST", headers: { Cookie: cookie, Origin: requestOrigin },
    body: new URLSearchParams({ csrfToken, ...fields }),
  }));
}
async function saveCredentials() {
  const response = await action(post({ intent: "save-credentials", ...validPair }));
  expect(response.data.error).toBeUndefined();
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
  getApplicationDatabase().getClient().run(sql`DELETE FROM encrypted_credential_bundles`);
  getApplicationDatabase().getClient().run(sql`DELETE FROM application_metadata WHERE key = 'photo_analysis_configuration'`);
  network.mockReset();
  network.mockImplementation(async input => providerResponse(input));
});
afterAll(async () => {
  shutdownPhotoAnalysis();
  shutdownApplicationDatabase();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(directory, { force: true, recursive: true });
});

test("only administrators can read or mutate shared Photo Analysis configuration", async () => {
  await expect(loader(args(request("")))).rejects.toMatchObject({ status: 302 });
  await expect(loader(args(request(memberCookie)))).rejects.toMatchObject({ status: 404 });
  for (const intent of ["save-credentials", "delete-credentials", "save-configuration"]) {
    await expect(action(post({ intent }, ""))).rejects.toMatchObject({ status: 302 });
    await expect(action(post({ intent }, memberCookie))).rejects.toMatchObject({ status: 404 });
    await expect(action(post({ intent, csrfToken: "invalid" }))).rejects.toMatchObject({ status: 403 });
    await expect(action(post({ intent }, adminCookie, "https://attacker.example"))).rejects.toMatchObject({ status: 403 });
  }
  expect(network).not.toHaveBeenCalled();
  expect(await loader(args(request()))).toMatchObject({
    csrfToken, credentials: { state: "unconfigured" }, settings: undefined,
  });
  expect(headers()).toEqual({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  expect((await loader(args(request()))).today).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  expect(meta()).toEqual([{ title: "AI photo estimates · Open Calorie Tracker" }]);
});

test("unusable master-key storage still renders actionable settings and rejects writes", async () => {
  shutdownPhotoAnalysis();
  const secretsPath = path.join(directory, "secrets");
  await rm(secretsPath, { force: true, recursive: true });
  await writeFile(secretsPath, "not a directory");
  try {
    await expect(loader(args(request()))).resolves.toMatchObject({
      credentials: { state: "storage-unavailable" },
      readiness: {
        state: "unavailable",
        reason: "Repair the Photo Analysis credential encryption setup.",
        destination: "/settings/ai",
      },
      settings: undefined,
    });
    const response = await action(post({
      intent: "save-credentials",
      ...validPair,
    }));
    expect(response.init?.status).toBe(503);
    expect(response.data).toMatchObject({
      area: "credentials",
      error: "Credential storage is unavailable. Repair the master-key path and try again.",
    });
  } finally {
    shutdownPhotoAnalysis();
    await rm(secretsPath, { force: true });
    await mkdir(secretsPath, { mode: 0o700 });
  }
});

test("saves a validated pair and discovers compatible models without returning secrets", async () => {
  const response = await action(post({ intent: "save-credentials", ...validPair }));
  expect(response.data).toEqual({ area: "credentials", success: "Photo Analysis credentials saved." });
  expect(network).toHaveBeenCalledTimes(2);

  network.mockClear();
  const state = await loader(args(request()));
  expect(network).toHaveBeenCalledTimes(2);
  expect(state.credentials).toMatchObject({ state: "configured", validatedAt: expect.any(String) as unknown });
  expect(state.settings).toMatchObject({
    ready: true,
    configuration: { geminiModel: "gemini-3.1-flash-lite", jevModel: "jev-1.13.0", calibrated: false },
    gemini: { models: [{ id: "gemini-3.1-flash-lite" }] },
    jev: { models: [{ id: "jev-1.13.0" }, { id: "jev-1.14.0" }] },
  });
  expect(JSON.stringify(state)).not.toContain(validPair.geminiKey);
  expect(JSON.stringify(state)).not.toContain(validPair.typeSafeKey);
});

test("input, provider, and persistence failures preserve the configured pair", async () => {
  await saveCredentials();
  network.mockClear();
  const inputFailure = await action(post({ intent: "save-credentials", geminiKey: "short", typeSafeKey: validPair.typeSafeKey }));
  expect(inputFailure.init?.status).toBe(400);
  expect(network).not.toHaveBeenCalled();

  network.mockResolvedValueOnce(new Response("rejected", { status: 401 }));
  network.mockImplementationOnce(async input => providerResponse(input));
  const validationFailure = await action(post({
    intent: "save-credentials",
    geminiKey: "AIzaSyReplacementGemini_1234567890",
    typeSafeKey: "ts_live_ReplacementTypeSafe_1234567890",
  }));
  expect(validationFailure.init?.status).toBe(422);
  expect(validationFailure.data.fieldErrors?.geminiKey).toBe("Gemini rejected this key.");

  getApplicationDatabase().getClient().run(sql.raw(`
    CREATE TRIGGER reject_settings_credential_update BEFORE UPDATE ON encrypted_credential_bundles
    BEGIN SELECT RAISE(ABORT, 'private persistence detail'); END
  `));
  const persistenceFailure = await action(post({
    intent: "save-credentials",
    geminiKey: "AIzaSyPersistGemini_1234567890",
    typeSafeKey: "ts_live_PersistTypeSafe_1234567890",
  }));
  expect(persistenceFailure.init?.status).toBe(503);
  expect(JSON.stringify(persistenceFailure.data)).not.toContain("private persistence detail");
  getApplicationDatabase().getClient().run(sql`DROP TRIGGER reject_settings_credential_update`);
  expect((await loader(args(request()))).credentials.state).toBe("configured");
});

test("validates model choices and atomically saves confidence thresholds", async () => {
  await saveCredentials();
  const arbitrary = await action(post({
    intent: "save-configuration",
    geminiModel: "free-text-model",
    jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: "0.1",
    productConfidenceThreshold: "0.2",
  }));
  expect(arbitrary.init?.status).toBe(400);
  expect(arbitrary.data.fieldErrors).toMatchObject({
    geminiModel: "Choose an available supported Gemini model.",
  });
  const invalidThresholds = await action(post({
    intent: "save-configuration",
    geminiModel: "gemini-3.1-flash-lite",
    jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: "-0.1",
    productConfidenceThreshold: "2",
  }));
  expect(invalidThresholds.init?.status).toBe(400);
  expect(invalidThresholds.data.fieldErrors).toMatchObject({
    categoryConfidenceThreshold: "Enter a value from 0.0 through 1.0.",
    productConfidenceThreshold: "Enter a value from 0.0 through 1.0.",
  });
  const missingThresholds = await action(post({
    intent: "save-configuration", geminiModel: "gemini-3.1-flash-lite", jevModel: "jev-1.13.0",
  }));
  expect(missingThresholds.init?.status).toBe(400);
  expect(missingThresholds.data.fieldErrors).toMatchObject({
    categoryConfidenceThreshold: "Enter a value from 0.0 through 1.0.",
    productConfidenceThreshold: "Enter a value from 0.0 through 1.0.",
  });
  const malformedModels = await action(post({
    intent: "save-configuration", geminiModel: "bad model", jevModel: "", categoryConfidenceThreshold: "0", productConfidenceThreshold: "0",
  }));
  expect(malformedModels.init?.status).toBe(400);
  expect(malformedModels.data.fieldErrors).toMatchObject({
    geminiModel: "Enter a valid Gemini model identifier.",
    jevModel: "Enter a valid Jev model identifier.",
  });

  const saved = await action(post({
    intent: "save-configuration",
    geminiModel: "gemini-3.1-flash-lite",
    jevModel: "jev-1.14.0",
    categoryConfidenceThreshold: "0.3",
    productConfidenceThreshold: "0.55",
  }));
  expect(saved.data).toEqual({ area: "configuration", success: "Photo Analysis model settings saved for future attempts." });
  expect((await loader(args(request()))).settings).toMatchObject({
    configuration: {
      geminiModel: "gemini-3.1-flash-lite", jevModel: "jev-1.14.0",
      categoryConfidenceThreshold: 0.3, productConfidenceThreshold: 0.55, calibrated: true,
    },
  });

  network.mockImplementation(async input => String(input).includes("generativelanguage")
    ? providerResponse(input)
    : Response.json({ data: [{ id: "jev-1.13.0" }] }));
  expect((await loader(args(request()))).settings).toMatchObject({
    ready: false,
    reason: "The selected Jev model is unavailable.",
    configuration: { jevModel: "jev-1.14.0", categoryConfidenceThreshold: 0.3, productConfidenceThreshold: 0.55 },
    jev: { models: [{ id: "jev-1.13.0" }] },
  });
});

test("discovery and database failures preserve the last settings without leaking details", async () => {
  await saveCredentials();
  await action(post({
    intent: "save-configuration", geminiModel: "gemini-3.1-flash-lite", jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: "0.2", productConfidenceThreshold: "0.4",
  }));
  network.mockRejectedValueOnce(new Error(`socket detail ${validPair.geminiKey}`));
  network.mockImplementationOnce(async input => providerResponse(input));
  const discoveryFailure = await action(post({
    intent: "save-configuration", geminiModel: "gemini-3.1-flash-lite", jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: "0.8", productConfidenceThreshold: "0.9",
  }));
  expect(discoveryFailure.init?.status).toBe(503);
  expect(JSON.stringify(discoveryFailure.data)).not.toContain(validPair.geminiKey);

  network.mockResolvedValueOnce(new Response("incompatible private detail", { status: 404 }));
  network.mockImplementationOnce(async input => providerResponse(input));
  const incompatible = await action(post({
    intent: "save-configuration", geminiModel: "gemini-3.1-flash-lite", jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: "0.8", productConfidenceThreshold: "0.9",
  }));
  expect(incompatible.init?.status).toBe(409);
  expect(incompatible.data.error).toContain("incompatible");
  expect(JSON.stringify(incompatible.data)).not.toContain("private detail");

  getApplicationDatabase().getClient().run(sql.raw(`
    CREATE TRIGGER reject_photo_configuration_update BEFORE UPDATE ON application_metadata
    WHEN OLD.key = 'photo_analysis_configuration'
    BEGIN SELECT RAISE(ABORT, 'private config detail'); END
  `));
  const persistenceFailure = await action(post({
    intent: "save-configuration", geminiModel: "gemini-3.1-flash-lite", jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: "0.7", productConfidenceThreshold: "0.7",
  }));
  expect(persistenceFailure.init?.status).toBe(503);
  expect(JSON.stringify(persistenceFailure.data)).not.toContain("private config detail");
  getApplicationDatabase().getClient().run(sql`DROP TRIGGER reject_photo_configuration_update`);
  expect((await loader(args(request()))).settings?.configuration).toMatchObject({
    categoryConfidenceThreshold: 0.2, productConfidenceThreshold: 0.4,
  });
});

test("deletion requires explicit confirmation and removes credentials for future discovery", async () => {
  await saveCredentials();
  const rejected = await action(post({ intent: "delete-credentials" }));
  expect(rejected.init?.status).toBe(400);
  expect((await loader(args(request()))).credentials.state).toBe("configured");

  getApplicationDatabase().getClient().run(sql.raw(`
    CREATE TRIGGER reject_settings_credential_delete BEFORE DELETE ON encrypted_credential_bundles
    BEGIN SELECT RAISE(ABORT, 'private delete detail'); END
  `));
  const persistenceFailure = await action(post({ intent: "delete-credentials", confirmation: "delete" }));
  expect(persistenceFailure.init?.status).toBe(503);
  expect(JSON.stringify(persistenceFailure.data)).not.toContain("private delete detail");
  getApplicationDatabase().getClient().run(sql`DROP TRIGGER reject_settings_credential_delete`);

  const deleted = await action(post({ intent: "delete-credentials", confirmation: "delete" }));
  expect(deleted.data).toEqual({ area: "credentials", success: "Photo Analysis credentials deleted." });
  expect(await loader(args(request()))).toMatchObject({ credentials: { state: "unconfigured" }, settings: undefined });
  expect((await action(post({ intent: "unknown" }))).init?.status).toBe(400);
});
