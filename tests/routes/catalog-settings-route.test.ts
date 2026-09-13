import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import { getApplicationDatabase, shutdownApplicationDatabase } from "../../app/database/runtime.server";
import type { CatalogOutcome } from "../../app/catalog-management/catalog-management.server";
import { getCatalogManagement, shutdownCatalogManagement } from "../../app/catalog-management/runtime.server";
import { loader as notificationLoader, action as notificationAction } from "../../app/routes/catalog-notifications";
import { loader as rootLoader } from "../../app/root";
import { action, loader, headers } from "../../app/routes/settings.catalogs";
import { seedAuthenticatedAccount } from "../support/authentication";
import { offArchive, offWithBasis } from "../support/off-archive";
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
function checkAgain(cookie = adminCookie, csrf = csrfToken, requestOrigin = origin, intent = "check-usda-update") {
  return args(new Request(`${origin}/settings/catalogs`, { method: "POST", headers: { Cookie: cookie, Origin: requestOrigin, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }, body: new URLSearchParams({ csrfToken: csrf, intent }) }));
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "catalog-settings-"));
  vi.stubEnv("APPLICATION_URL", origin); vi.stubEnv("DATABASE_PATH", path.join(directory, "application.sqlite")); vi.stubEnv("CATALOG_DIRECTORY", path.join(directory, "catalogs"));
  vi.stubEnv("OFF_CATALOG_MAX_UPLOAD_BYTES", "1000000"); vi.stubEnv("OFF_CATALOG_MAX_EXPANDED_BYTES", "10000000"); vi.stubEnv("OFF_CATALOG_MAX_DATABASE_BYTES", "10000000");
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
  expect((await loader(get())).catalog.updateCheck).toMatchObject({ status: "indeterminate", availableRelease: null, error: null });
  expect((await loader(get())).csrfToken).toBe(csrfToken);
  expect((await loader(get())).today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(headers()).toEqual({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
});

test("explicit USDA checks reuse administrator and CSRF protections without starting an import", async () => {
  await expect(action(checkAgain(memberCookie))).rejects.toMatchObject({ status: 404 });
  await expect(action(checkAgain(adminCookie, "invalid"))).rejects.toMatchObject({ status: 403 });
  await expect(action(checkAgain(adminCookie, csrfToken, "https://attacker.example"))).rejects.toMatchObject({ status: 403 });
  const before = getCatalogManagement().read();
  const response = await action(checkAgain());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ checked: true });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(getCatalogManagement().read()).toMatchObject({ installed: before.installed, job: before.job, busy: false, updateCheck: { status: "indeterminate" } });
});

test("unsupported catalog form actions are rejected without changing either catalog", async () => {
  const before = await loader(get());
  const request = checkAgain();
  request.request = new Request(request.request, { body: new URLSearchParams({ csrfToken, intent: "unexpected" }) });
  const response = await action(request);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Unsupported action." });
  expect((await loader(get())).catalog).toEqual(before.catalog);
  expect((await loader(get())).offCatalog).toEqual(before.offCatalog);
});

test("malformed upload requests return public errors without claiming an installation", async () => {
  for (const [header, value, status, error] of [
    ["Content-Type", "text/plain", 400, "Choose an archive matching this catalog."],
    ["X-Archive-Name", "%ZZ", 409, "Invalid archive filename."],
    ["X-Archive-Name", "wrong.csv", 409, "Choose a USDA .zip archive."],
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
    expect((await loader(get())).catalog).toMatchObject({ installed: null, job: null, busy: false, updateCheck: { status: "indeterminate" } });
  }
  const missingCsrf = post(await foundationArchive());
  missingCsrf.request.headers.delete("X-CSRF-Token");
  await expect(action(missingCsrf)).rejects.toMatchObject({ status: 403 });
  const forbidden = await action(missingCsrf).catch((error: unknown) => error);
  expect(await (forbidden as Response).text()).toBe("CSRF token rejected.");
  const missingName = post(await foundationArchive());
  missingName.request.headers.delete("X-Archive-Name");
  expect(await (await action(missingName)).json()).toEqual({ error: "Choose a USDA .zip archive." });
  const noBody = args(new Request(`${origin}/settings/catalogs`, { method: "POST", headers: { Cookie: adminCookie, Origin: origin, "X-CSRF-Token": csrfToken, "Content-Type": "application/zip" } }));
  expect(await (await action(noBody)).json()).toEqual({ error: "Choose an archive matching this catalog." });
});

test("an administrator upload returns while import continues and returning to Settings shows the persisted outcome", async () => {
  const archive = await foundationArchive();
  const upload = post(archive);
  upload.request.headers.set("Content-Length", String(archive.length));
  upload.request.headers.set("X-Archive-Name", "Fondaci%C3%B3n.zip");
  const response = await action(upload);
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ accepted: true });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect((await loader(get())).catalog.busy).toBe(true);
  await vi.waitFor(() => expect(getCatalogManagement().read().busy).toBe(false), { timeout: 3000 });
  expect((await loader(get())).catalog).toMatchObject({ installed: { foodCount: 4, filename: "Fondación.zip" }, job: { phase: "succeeded", error: null, receivedBytes: archive.length } });
  const firstGeneration = getCatalogManagement().read().installed?.generation;
  expect((await action(post(await foundationArchive()))).status).toBe(202);
  await vi.waitFor(() => expect(getCatalogManagement().read().busy).toBe(false), { timeout: 3000 });
  expect(getCatalogManagement().read()).toMatchObject({ installed: { filename: "foundation.zip" }, job: { phase: "succeeded" } });
  expect(getCatalogManagement().read().installed?.generation).not.toBe(firstGeneration);
});

test.each([
  ["X-Catalog-Provider", "unknown", 400, "Unknown catalog."],
  ["Content-Type", "text/plain", 400, "Choose an archive matching this catalog."],
  ["X-Archive-Name", "%", 409, "Invalid archive filename."],
  ["Content-Length", "invalid", 409, "Archive exceeds the configured upload limit or is empty."],
  ["X-Archive-Name", null, 409, "Choose a USDA .zip archive."],
] as const)("invalid upload header %s is rejected without changing catalog state", async (name, value, status, error) => {
  const before = await loader(get());
  const upload = post(new Uint8Array([1]));
  if (value === null) upload.request.headers.delete(name); else upload.request.headers.set(name, value);
  const response = await action(upload);
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(await loader(get())).toEqual(before);
});

test("missing upload body and missing CSRF header have distinct failures", async () => {
  const upload = args(new Request(`${origin}/settings/catalogs`, { method: "POST", headers: { Cookie: adminCookie, Origin: origin, "X-CSRF-Token": csrfToken, "Content-Type": "application/zip" } }));
  const response = await action(upload);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Choose an archive matching this catalog." });
  upload.request.headers.delete("X-CSRF-Token");
  await expect(action(upload)).rejects.toMatchObject({ status: 403 });
});

test("OFF upload and replacement have their own authorization, state and installed outcome", async () => {
  const archive = offArchive();
  function offRequest(cookie = adminCookie, token = csrfToken, source = archive, filename = "products.csv.gz") {
    return args(new Request(`${origin}/settings/catalogs`, { method: "POST", headers: { Cookie: cookie, Origin: origin, "X-CSRF-Token": token, "X-Archive-Name": filename, "X-Catalog-Provider": "open-food-facts", "Content-Type": "application/gzip" }, body: new Uint8Array(source) }));
  }
  await expect(action(offRequest(memberCookie))).rejects.toMatchObject({ status: 404 });
  await expect(action(offRequest(adminCookie, "invalid"))).rejects.toMatchObject({ status: 403 });
  const before = (await loader(get())).catalog;
  expect((await action(offRequest())).status).toBe(202);
  await vi.waitFor(() => expect(getCatalogManagement("open-food-facts").read().busy).toBe(false));
  const state = await loader(get());
  expect(state.catalog).toEqual(before);
  expect(state.offCatalog).toMatchObject({ installed: { foodCount: 1, filename: "products.csv.gz" }, job: { phase: "succeeded", importedRecords: 1, rejectedRecords: 0 } });
  const firstGeneration = state.offCatalog.installed?.generation;

  const replacement = offArchive([{ ...offWithBasis("100g", "0012345678906"), product_name: "Replacement product" }]);
  expect((await action(offRequest(adminCookie, csrfToken, replacement, "replacement.csv.gz"))).status).toBe(202);
  await vi.waitFor(() => expect(getCatalogManagement("open-food-facts").read().busy).toBe(false));
  const replaced = await loader(get());
  expect(replaced.catalog).toEqual(before);
  expect(replaced.offCatalog).toMatchObject({ installed: { foodCount: 1, filename: "replacement.csv.gz" }, job: { phase: "succeeded", importedRecords: 1, rejectedRecords: 0 } });
  expect(replaced.offCatalog.installed?.generation).not.toBe(firstGeneration);
});


test("administrator notifications consume real independent outcomes, persist acknowledgement and deny members", async () => {
  await expect(notificationLoader(get(memberCookie))).rejects.toMatchObject({ status: 404 });
  await expect(notificationLoader(get(""))).rejects.toMatchObject({ status: 302 });
  expect(await rootLoader(get(memberCookie))).toEqual({ catalogAdministrator: false });
  expect(await rootLoader(get())).toEqual({ catalogAdministrator: true });
  const before = await (await notificationLoader(get())).json() as { outcomes: CatalogOutcome[] };
  const upload = post(new Uint8Array([1, 2]));
  upload.request.headers.set("X-Catalog-Provider", "open-food-facts");
  upload.request.headers.set("Content-Type", "application/gzip");
  upload.request.headers.set("X-Archive-Name", "failure.gz");
  await action(upload);
  await vi.waitFor(() => expect(getCatalogManagement("open-food-facts").read().busy).toBe(false));
  const response = await notificationLoader(get());
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const result = await response.json() as { outcomes: CatalogOutcome[] };
  expect(result.outcomes).toHaveLength(before.outcomes.length + 1);
  expect(result.outcomes).toEqual(expect.arrayContaining([
    expect.objectContaining({ provider: "usda-fdc", phase: "succeeded" }),
    expect.objectContaining({ provider: "open-food-facts", phase: "succeeded" }),
    expect.objectContaining({ provider: "open-food-facts", phase: "failed", filename: "failure.gz" }),
  ]));
  expect(await (await notificationLoader(get())).json()).toEqual(result);
  const failed = result.outcomes.find((item: { phase: string }) => item.phase === "failed")!;
  expect(failed.installed?.filename).toBe("replacement.csv.gz");
  function acknowledge(cookie = adminCookie, csrf = csrfToken, requestOrigin = origin, jobId = failed.jobId, completedAt = failed.completedAt, provider: string = failed.provider) {
    return args(new Request(`${origin}/catalog-notifications`, { method: "POST", headers: { Cookie: cookie, Origin: requestOrigin }, body: new URLSearchParams({ csrfToken: csrf, provider, jobId, completedAt }) }));
  }
  await expect(notificationAction(acknowledge(memberCookie))).rejects.toMatchObject({ status: 404 });
  await expect(notificationAction(acknowledge(adminCookie, "wrong"))).rejects.toMatchObject({ status: 403 });
  await expect(notificationAction(acknowledge(adminCookie, csrfToken, "https://attacker.example"))).rejects.toMatchObject({ status: 403 });
  expect((await notificationAction(acknowledge(adminCookie, csrfToken, origin, "missing"))).status).toBe(409);
  expect((await notificationAction(acknowledge(adminCookie, csrfToken, origin, failed.jobId, "stale"))).status).toBe(409);
  expect((await notificationAction(acknowledge(adminCookie, csrfToken, origin, failed.jobId, failed.completedAt, "unknown"))).status).toBe(400);
  expect((await notificationAction(acknowledge())).status).toBe(200);
  expect((await notificationAction(acknowledge())).status).toBe(200);
  await shutdownCatalogManagement();
  const reloaded = await (await notificationLoader(get())).json() as { outcomes: CatalogOutcome[] };
  expect(reloaded.outcomes).toHaveLength(result.outcomes.length);
  expect(reloaded.outcomes.find((item: { jobId: string }) => item.jobId === failed.jobId)!.acknowledgedAt).not.toBeNull();
  expect(reloaded.outcomes.filter((item: { acknowledgedAt: string | null }) => item.acknowledgedAt !== null)).toHaveLength(1);
});


test("OFF check-again enforces administrator, origin and CSRF and leaves USDA and imports unchanged", async () => {
  await expect(action(checkAgain(memberCookie, csrfToken, origin, "check-off-update"))).rejects.toMatchObject({ status: 404 });
  await expect(action(checkAgain(adminCookie, "invalid", origin, "check-off-update"))).rejects.toMatchObject({ status: 403 });
  await expect(action(checkAgain(adminCookie, csrfToken, "https://attacker.example", "check-off-update"))).rejects.toMatchObject({ status: 403 });
  const before = await loader(get());
  expect((await action(checkAgain(adminCookie, csrfToken, origin, "check-off-update"))).status).toBe(200);
  const after = await loader(get());
  expect(after.catalog).toEqual(before.catalog);
  expect(after.offCatalog).toMatchObject({ installed: before.offCatalog.installed, job: before.offCatalog.job, updateCheck: { status: "indeterminate" } });
});
