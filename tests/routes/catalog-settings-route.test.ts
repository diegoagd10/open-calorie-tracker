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
import { offArchive } from "../support/off-archive";
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
  vi.stubEnv("OFF_CATALOG_MAX_UPLOAD_BYTES", "1000000"); vi.stubEnv("OFF_CATALOG_MAX_EXPANDED_BYTES", "10000000");
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
  expect(headers()).toMatchObject({ "Cache-Control": "no-store" });
});

test("an administrator upload returns while import continues and returning to Settings shows the persisted outcome", async () => {
  const response = await action(post(await foundationArchive()));
  expect(response.status).toBe(202);
  expect((await loader(get())).catalog.busy).toBe(true);
  await vi.waitFor(() => expect(getCatalogManagement().read().busy).toBe(false), { timeout: 3000 });
  expect((await loader(get())).catalog).toMatchObject({ installed: { foodCount: 4 }, job: { phase: "succeeded", error: null } });
  expect((await action(post(await foundationArchive()))).status).toBe(409);
});

test("OFF upload has its own authorization, content type and installed outcome", async () => {
  const archive = offArchive();
  function offRequest(cookie = adminCookie, token = csrfToken) {
    return args(new Request(`${origin}/settings/catalogs`, { method: "POST", headers: { Cookie: cookie, Origin: origin, "X-CSRF-Token": token, "X-Archive-Name": "products.csv.gz", "X-Catalog-Provider": "open-food-facts", "Content-Type": "application/gzip" }, body: new Uint8Array(archive) }));
  }
  await expect(action(offRequest(memberCookie))).rejects.toMatchObject({ status: 404 });
  await expect(action(offRequest(adminCookie, "invalid"))).rejects.toMatchObject({ status: 403 });
  const before = (await loader(get())).catalog;
  expect((await action(offRequest())).status).toBe(202);
  await vi.waitFor(() => expect(getCatalogManagement("open-food-facts").read().busy).toBe(false));
  const state = await loader(get());
  expect(state.catalog).toEqual(before);
  expect(state.offCatalog).toMatchObject({ installed: { foodCount: 1 }, job: { phase: "succeeded" } });
});
