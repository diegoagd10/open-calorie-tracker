import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import { getApplicationDatabase, shutdownApplicationDatabase } from "../../app/database/runtime.server";
import { getCatalogManagement, shutdownCatalogManagement } from "../../app/catalog-management/runtime.server";
import { action, loader, headers } from "../../app/routes/settings.catalogs";
import { seedAuthenticatedAccount } from "../support/authentication";
import { foundationArchive } from "../support/foundation-archive";

const origin = "http://localhost:3000";
let directory: string;
let adminCookie: string;
let memberCookie: string;
let csrfToken: string;
function args(request: Request) { return { request, params: {}, context: new RouterContextProvider(), pattern: "/settings/catalogs", url: new URL(request.url) }; }
function get(cookie = adminCookie) { return args(new Request(`${origin}/settings/catalogs`, { headers: { Cookie: cookie } })); }
function post(body: Uint8Array, cookie = adminCookie, csrf = csrfToken, requestOrigin = origin) {
  return args(new Request(`${origin}/settings/catalogs`, { method: "POST", headers: { Cookie: cookie, Origin: requestOrigin, "X-CSRF-Token": csrf, "X-Archive-Name": "foundation.zip", "Content-Type": "application/zip" }, body: new Uint8Array(body) }));
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "catalog-settings-"));
  vi.stubEnv("APPLICATION_URL", origin); vi.stubEnv("DATABASE_PATH", path.join(directory, "application.sqlite")); vi.stubEnv("CATALOG_DIRECTORY", path.join(directory, "catalogs"));
  const auth = getAuthenticationService();
  const admin = await auth.register("catalog.admin", "correct horse battery staple", "203.0.113.181");
  if (!admin.ok) throw new Error("Could not register admin");
  adminCookie = serializeSessionCookie(admin.session).split(";", 1)[0]; csrfToken = admin.session.csrfToken;
  const member = await seedAuthenticatedAccount(auth, getApplicationDatabase().getClient(), "catalog.member", "correct horse battery staple", "203.0.113.182");
  memberCookie = serializeSessionCookie(member).split(";", 1)[0];
});
afterAll(async () => { await shutdownCatalogManagement(); shutdownApplicationDatabase(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

test("catalog management requires administrator authentication and upload CSRF before consuming the archive", async () => {
  await expect(loader(get(""))).rejects.toMatchObject({ status: 302 });
  await expect(loader(get(memberCookie))).rejects.toMatchObject({ status: 404 });
  const zip = await foundationArchive();
  await expect(action(post(zip, memberCookie))).rejects.toMatchObject({ status: 404 });
  await expect(action(post(zip, adminCookie, "invalid"))).rejects.toMatchObject({ status: 403 });
  await expect(action(post(zip, adminCookie, csrfToken, "https://attacker.example"))).rejects.toMatchObject({ status: 403 });
  expect((await loader(get())).catalog).toMatchObject({ installed: null, job: null, busy: false });
  expect((await loader(get())).csrfToken).toBe(csrfToken);
  expect((await loader(get())).today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(headers()).toEqual({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
});

test("malformed upload requests return public errors without claiming an installation", async () => {
  for (const [header, value, status, error] of [
    ["Content-Type", "text/plain", 400, "Choose a Foundation CSV ZIP archive."],
    ["X-Archive-Name", "%ZZ", 409, "Invalid archive filename."],
    ["X-Archive-Name", "wrong.csv", 409, "Choose a USDA Foundation CSV ZIP archive."],
    ["Content-Length", "0", 409, "Archive exceeds the configured upload limit or is empty."],
    ["Content-Length", "NaN", 409, "Archive exceeds the configured upload limit or is empty."],
  ] as const) {
    const request = post(await foundationArchive());
    request.request.headers.set(header, value);
    const response = await action(request);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect((await loader(get())).catalog).toEqual({ installed: null, job: null, busy: false });
  }
  const missingCsrf = post(await foundationArchive());
  missingCsrf.request.headers.delete("X-CSRF-Token");
  await expect(action(missingCsrf)).rejects.toMatchObject({ status: 403 });
  const forbidden = await action(missingCsrf).catch((error: unknown) => error);
  expect(await (forbidden as Response).text()).toBe("CSRF token rejected.");
  const missingName = post(await foundationArchive());
  missingName.request.headers.delete("X-Archive-Name");
  expect(await (await action(missingName)).json()).toEqual({ error: "Choose a USDA Foundation CSV ZIP archive." });
  const noBody = args(new Request(`${origin}/settings/catalogs`, { method: "POST", headers: { Cookie: adminCookie, Origin: origin, "X-CSRF-Token": csrfToken, "Content-Type": "application/zip" } }));
  expect(await (await action(noBody)).json()).toEqual({ error: "Choose a Foundation CSV ZIP archive." });
});

test("an administrator upload returns while import continues and returning to Settings shows the persisted outcome", async () => {
  const archive = await foundationArchive();
  const request = post(archive);
  request.request.headers.set("X-Archive-Name", "Fondaci%C3%B3n.zip");
  request.request.headers.set("Content-Length", String(archive.length));
  const response = await action(request);
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ accepted: true });
  expect((await loader(get())).catalog.busy).toBe(true);
  await vi.waitFor(() => expect(getCatalogManagement().read().busy).toBe(false), { timeout: 3000 });
  expect((await loader(get())).catalog).toMatchObject({ installed: { foodCount: 4, filename: "Fondación.zip" }, job: { phase: "succeeded", error: null, receivedBytes: archive.length } });
  expect((await action(post(await foundationArchive()))).status).toBe(409);
});
