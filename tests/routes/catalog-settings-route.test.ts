import { mkdtemp, rm } from "node:fs/promises";
import { Readable } from "node:stream";
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
import { getOpenFoodFactsClient } from "../../app/catalog/runtime.server";
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
  expect(Object.keys((await loader(get())).catalog).sort()).toEqual(["installed", "updateCheck"]);
  expect((await loader(get())).catalog).toMatchObject({ installed: null });
  expect((await loader(get())).catalog).not.toHaveProperty("job");
  expect((await loader(get())).catalog).not.toHaveProperty("busy");
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

test("unsupported catalog form actions are rejected without changing the catalog or contact", async () => {
  const before = await loader(get());
  const request = checkAgain();
  request.request = new Request(request.request, { body: new URLSearchParams({ csrfToken, intent: "unexpected" }) });
  const response = await action(request);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Unsupported action." });
  expect((await loader(get())).catalog).toEqual(before.catalog);
  expect((await loader(get())).offContact).toEqual(before.offContact);
  for (const intent of ["check-off-update", ""]) {
    const legacy = checkAgain();
    legacy.request = new Request(legacy.request, { body: new URLSearchParams({ csrfToken, intent }) });
    expect((await action(legacy)).status).toBe(400);
  }
});

test.each(["usda-fdc", "open-food-facts"] as const)("crafted %s archive requests cannot claim an installation", async provider => {
  const before = getCatalogManagement().read();
  const request = post(await foundationArchive());
  request.request.headers.set("X-Catalog-Provider", provider);
  const response = await action(request);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Catalog installation is available through terminal commands only." });
  expect(getCatalogManagement().read()).toEqual(before);
});

function contactForm(fields: Record<string, string>, cookie = adminCookie, csrf = csrfToken, requestOrigin = origin) {
  return args(new Request(`${origin}/settings/catalogs`, { method: "POST", headers: { Cookie: cookie, Origin: requestOrigin, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }, body: new URLSearchParams({ csrfToken: csrf, ...fields }) }));
}

test("administrators save, validate, replace and remove the Open Food Facts contact email", async () => {
  expect((await loader(get())).offContact).toBeUndefined();

  const enabled = await action(contactForm({ intent: "save-off-contact", email: " family@example.com " }));
  expect(enabled.status).toBe(200);
  expect(enabled.headers.get("Cache-Control")).toBe("no-store");
  expect(await enabled.json()).toEqual({ contact: "enabled" });
  expect((await loader(get())).offContact).toBe("family@example.com");
  expect(getOpenFoodFactsClient().isConfigured()).toBe(true);

  const invalid = await action(contactForm({ intent: "save-off-contact", email: "family(at)example" }));
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toEqual({ contact: "invalid", error: "Enter a valid email address.", value: "family(at)example" });
  expect((await loader(get())).offContact).toBe("family@example.com");

  const updated = await action(contactForm({ intent: "save-off-contact", email: "parents@example.com" }));
  expect(await updated.json()).toEqual({ contact: "updated" });
  expect((await loader(get())).offContact).toBe("parents@example.com");

  const removed = await action(contactForm({ intent: "remove-off-contact" }));
  expect(await removed.json()).toEqual({ contact: "removed" });
  expect((await loader(get())).offContact).toBeUndefined();
  expect(getOpenFoodFactsClient().isConfigured()).toBe(false);
});

test("members and forged requests cannot view or change the Open Food Facts contact email", async () => {
  await expect(action(contactForm({ intent: "save-off-contact", email: "member@example.com" }, memberCookie))).rejects.toMatchObject({ status: 404 });
  await expect(action(contactForm({ intent: "remove-off-contact" }, memberCookie))).rejects.toMatchObject({ status: 404 });
  await expect(action(contactForm({ intent: "save-off-contact", email: "forged@example.com" }, adminCookie, "invalid"))).rejects.toMatchObject({ status: 403 });
  await expect(action(contactForm({ intent: "save-off-contact", email: "forged@example.com" }, adminCookie, csrfToken, "https://attacker.example"))).rejects.toMatchObject({ status: 403 });
  expect(getOpenFoodFactsClient().contact()).toBeUndefined();
});

async function importArchive(filename: string, archive: Uint8Array) {
  await getCatalogManagement().submitArchive({ filename, stream: Readable.from([archive]) });
  await vi.waitFor(() => expect(getCatalogManagement().read().busy).toBe(false));
}

test("signed-in clients read successes independently while operator outcomes and acknowledgement stay administrator-only", async () => {
  await expect(notificationLoader(get(""))).rejects.toMatchObject({ status: 302 });
  const memberNavigation = await rootLoader(get(memberCookie));
  const adminNavigation = await rootLoader(get());
  expect(memberNavigation.catalogNotifications?.viewerId).toBeTypeOf("number");
  expect(adminNavigation.catalogNotifications?.viewerId).toBeTypeOf("number");
  expect(await rootLoader(get(""))).toEqual({ catalogNotifications: null, theme: "dark" });
  await importArchive("foundation.zip", await foundationArchive());
  expect((await loader(get())).catalog).toEqual({
    installed: getCatalogManagement().read().installed,
    updateCheck: getCatalogManagement().read().updateCheck,
  });
  await importArchive("replacement.zip", await foundationArchive());
  const before = await (await notificationLoader(get())).json() as { outcomes: CatalogOutcome[] };
  await importArchive("failure.zip", new Uint8Array([1, 2]));
  const response = await notificationLoader(get());
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const result = await response.json() as { outcomes: CatalogOutcome[] };
  expect(result.outcomes).toHaveLength(before.outcomes.length + 1);
  expect(result.outcomes).toEqual(expect.arrayContaining([
    expect.objectContaining({ provider: "usda-fdc", phase: "succeeded", operation: "install" }),
    expect.objectContaining({ provider: "usda-fdc", phase: "succeeded", operation: "update" }),
    expect.objectContaining({ provider: "usda-fdc", phase: "failed", filename: "failure.zip" }),
  ]));
  expect(await (await notificationLoader(get())).json()).toEqual(result);
  const memberResult = await (await notificationLoader(get(memberCookie))).json() as { outcomes: Partial<CatalogOutcome>[] };
  expect(memberResult.outcomes.map(outcome => [outcome.provider, outcome.phase, outcome.operation]).sort()).toEqual([
    ["usda-fdc", "succeeded", "install"], ["usda-fdc", "succeeded", "update"],
  ]);
  expect(memberResult.outcomes).toHaveLength(2);
  expect(Object.keys(memberResult.outcomes[0]).sort()).toEqual(["completedAt", "jobId", "operation", "phase", "provider"]);
  expect(JSON.stringify(memberResult)).not.toMatch(/filename|error|installed|csrfToken|failure.zip|catalogs/);
  const failed = result.outcomes.find((item: { phase: string }) => item.phase === "failed")!;
  expect(failed.installed?.filename).toBe("replacement.zip");
  function acknowledge(cookie = adminCookie, csrf = csrfToken, requestOrigin = origin, jobId = failed.jobId, completedAt = failed.completedAt, provider: string = failed.provider) {
    return args(new Request(`${origin}/catalog-notifications`, { method: "POST", headers: { Cookie: cookie, Origin: requestOrigin }, body: new URLSearchParams({ csrfToken: csrf, provider, jobId, completedAt }) }));
  }
  await expect(notificationAction(acknowledge(memberCookie))).rejects.toMatchObject({ status: 404 });
  await expect(notificationAction(acknowledge(adminCookie, "wrong"))).rejects.toMatchObject({ status: 403 });
  await expect(notificationAction(acknowledge(adminCookie, csrfToken, "https://attacker.example"))).rejects.toMatchObject({ status: 403 });
  expect((await notificationAction(acknowledge(adminCookie, csrfToken, origin, "missing"))).status).toBe(409);
  expect((await notificationAction(acknowledge(adminCookie, csrfToken, origin, failed.jobId, "stale"))).status).toBe(409);
  expect((await notificationAction(acknowledge(adminCookie, csrfToken, origin, failed.jobId, failed.completedAt, "unknown"))).status).toBe(400);
  expect((await notificationAction(acknowledge(adminCookie, csrfToken, origin, failed.jobId, failed.completedAt, "open-food-facts"))).status).toBe(400);
  expect((await notificationAction(acknowledge())).status).toBe(200);
  const success = result.outcomes.find(outcome => outcome.phase === "succeeded")!;
  expect((await notificationAction(acknowledge(adminCookie, csrfToken, origin, success.jobId, success.completedAt, success.provider))).status).toBe(200);
  expect(await (await notificationLoader(get(memberCookie))).json()).toEqual(memberResult);

  expect((await notificationAction(acknowledge())).status).toBe(200);
  await shutdownCatalogManagement();
  const reloaded = await (await notificationLoader(get())).json() as { outcomes: CatalogOutcome[] };
  expect(reloaded.outcomes).toHaveLength(result.outcomes.length);
  expect(reloaded.outcomes.find((item: { jobId: string }) => item.jobId === failed.jobId)!.acknowledgedAt).not.toBeNull();
  expect(reloaded.outcomes.filter((item: { acknowledgedAt: string | null }) => item.acknowledgedAt !== null)).toHaveLength(2);
});


test("real shutdown interruption persists only for administrator notification reads", async () => {
  const provider = "usda-fdc";
  const management = getCatalogManagement();
  const installed = management.read().installed;
  await management.submitArchive({ filename: "private-interruption.zip", stream: Readable.from([await foundationArchive()]) });
  const jobId = management.read().job!.id;
  await shutdownCatalogManagement();
  const response = await notificationLoader(get());
  const admin = await response.json() as { outcomes: CatalogOutcome[] };
  expect(admin.outcomes.find(outcome => outcome.jobId === jobId)).toMatchObject({ provider, phase: "interrupted", operation: "update", installed });
  const memberResponse = await notificationLoader(get(memberCookie));
  const member = await memberResponse.text();
  expect(member).not.toContain(jobId);
  expect(member).not.toMatch(/private-interruption|interrupted|filename|error|csrfToken/);
  expect(getCatalogManagement().read().installed).toEqual(installed);
});
