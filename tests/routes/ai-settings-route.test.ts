import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import { getApplicationDatabase, initializeApplicationDatabase, shutdownApplicationDatabase } from "../../app/database/runtime.server";
import { shutdownPhotoAnalysis } from "../../app/photo-analysis/runtime.server";
import { action, loader, headers, meta } from "../../app/routes/settings.ai";
import { seedAuthenticatedAccount } from "../support/authentication";

const origin = "http://localhost:3000";
let directory: string;
let adminCookie: string;
let memberCookie: string;
let csrfToken: string;
const network = vi.fn(async (_input: string | URL | Request) => new Response(null, { status: 500 }));
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
  vi.stubEnv("PHOTO_AI_AUTH_PATH", path.join(directory, "pi/auth.json"));
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
afterAll(async () => {
  shutdownPhotoAnalysis();
  shutdownApplicationDatabase();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(directory, { force: true, recursive: true });
});

test("only administrators can read or mutate the instance connection", async () => {
  await expect(loader(args(request("")))).rejects.toMatchObject({ status: 302 });
  await expect(loader(args(request(memberCookie)))).rejects.toMatchObject({ status: 404 });
  for (const intent of ["connect", "disconnect", "cancel"]) {
    await expect(action(post({ intent }, ""))).rejects.toMatchObject({ status: 302 });
    await expect(action(post({ intent }, memberCookie))).rejects.toMatchObject({ status: 404 });
    await expect(action(post({ intent, csrfToken: "invalid" }))).rejects.toMatchObject({ status: 403 });
    await expect(action(post({ intent }, adminCookie, "https://attacker.example"))).rejects.toMatchObject({ status: 403 });
  }
  expect(network).not.toHaveBeenCalled();
  expect(await loader(args(request()))).toMatchObject({ csrfToken, username: "settings.admin", connection: { connected: false, busy: false } });
  expect(headers()).toEqual({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  expect((await loader(args(request()))).today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(meta()).toEqual([{ title: "AI photo estimates · Open Calorie Tracker" }]);
});

test("valid actions start, poll and cancel a device flow without exposing credentials", async () => {
  network.mockImplementation(async input => String(input).endsWith("/deviceauth/usercode") ? Response.json({ device_auth_id: "private-id", user_code: "ROUTE-123", interval: 5 }) : new Response(null, { status: 403 }));
  expect((await action(post({ intent: "connect" }))).data.error).toBeUndefined();
  await vi.waitFor(async () => expect((await loader(args(request()))).connection.attempt).toMatchObject({ state: "waiting", userCode: "ROUTE-123" }));
  const state = await loader(args(request()));
  expect(JSON.stringify(state)).not.toContain("private-id");
  expect((await action(post({ intent: "connect" }))).init?.status).toBe(409);
  expect((await action(post({ intent: "cancel", attemptId: "stale" }))).init?.status).toBe(409);
  expect((await action(post({ intent: "cancel", attemptId: state.connection.attempt!.id }))).data.error).toBeUndefined();
  expect((await loader(args(request()))).connection).toMatchObject({ busy: false, connected: false, attempt: { state: "cancelled" } });
  expect((await action(post({ intent: "disconnect" }))).data.error).toBeUndefined();
  expect((await action(post({ intent: "unknown" }))).init?.status).toBe(400);
});
