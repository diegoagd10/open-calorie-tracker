import { createElement } from "react";
import { createRoutesStub } from "react-router";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import CatalogSettings, { meta } from "../../app/routes/settings.catalogs";
import type { CatalogState, ImportPhase } from "../../app/catalog-management/catalog-management.server";
import { BarcodeContactSection, type BarcodeContactResult } from "../../app/barcode";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const renderers: ReactTestRenderer[] = [];
afterEach(async () => { for (const renderer of renderers.splice(0)) await act(() => renderer.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
const empty: CatalogState = { installed: null, job: null, busy: false };
function job(phase: ImportPhase): NonNullable<CatalogState["job"]> { return { id: "job", filename: "archive.gz", phase, receivedBytes: 1234, processedRecords: 5678, importedRecords: 4321, rejectedRecords: 123, exclusions: {}, error: null, startedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }; }
function text(node: ReactTestInstance): string { return node.children.map(child => typeof child === "string" ? child : text(child)).join(""); }
async function render(catalog: CatalogState = empty, offContact?: string, actionResult?: BarcodeContactResult) {
  const load = vi.fn(() => ({ catalog, offContact, today: "2026-09-08", csrfToken: "catalog-csrf" }));
  const Routes = createRoutesStub([{ path: "/settings/catalogs", id: "catalogs", Component: CatalogSettings, loader: load, action: () => actionResult ?? null }]);
  let renderer!: ReactTestRenderer;
  await act(() => { renderer = create(createElement(Routes, { initialEntries: ["/settings/catalogs"], hydrationData: { loaderData: { catalogs: load() } } })); });
  renderers.push(renderer);
  return { renderer, load, card: (provider: string) => renderer.root.findByProps({ "aria-labelledby": `${provider}-heading` }) };
}

test("an installed USDA catalog reports only catalog details, with no analysis status", async () => {
  const installed = { generation: "generation", filename: "foundation.zip", sha256: "abc", installedAt: "2026-01-02T03:04:05.000Z", foodCount: 4, publicationDateRange: { earliest: "2019-04-01", latest: "2026-04-30" } };
  const { card } = await render({ ...empty, installed });
  expect(text(card("usda-fdc"))).toContain("4 foods installedArchive: foundation.zip");
  expect(text(card("usda-fdc"))).not.toMatch(/Analysis|Reimport required/);
});

test("administrator Settings destinations list no AI section", async () => {
  const { renderer } = await render();
  const destinations = renderer.root.findAll(node => typeof node.props.to === "string" && node.props.to.startsWith("/settings/")).map(node => node.props.to as string);
  expect(new Set(destinations)).toEqual(new Set(["/settings/goals", "/settings/security", "/settings/api-keys", "/settings/users", "/settings/catalogs"]));
  expect(text(renderer.root)).not.toContain("AI photo");
});

test("the USDA card shows availability, official downloads and metadata controls without installation controls, and OFF has no catalog card", async () => {
  expect(meta()).toEqual([{ title: "Food Catalogs · Open Calorie Tracker" }]);
  const { renderer, card } = await render();
  const usda = card("usda-fdc");
  expect(text(renderer.root)).toContain("Shared reference foods for local search and logging.");
  expect(text(usda)).toContain("Saved Food Entries keep their original nutrition and measurements.");
  expect(usda.findByType("a").props.href).toBe("https://fdc.nal.usda.gov/download-datasets/");
  expect(renderer.root.findAllByProps({ type: "file" })).toHaveLength(0);
  expect(text(usda.findByType("button"))).toBe("Check USDA updates");
  expect(text(renderer.root)).not.toMatch(/Check OFF updates|JSONL|OFF export|Official OFF downloads/);
});

test("without a contact email the Open Food Facts card explains scanning is off and asks for one", async () => {
  const { card } = await render();
  const off = card("open-food-facts");
  expect(text(off)).toContain("Open Food Facts○ Not configured");
  expect(text(off)).toContain("Barcode scanning is off until you add a contact email. Open Food Facts uses it to identify this app; it is not used to sign in.");
  expect(off.findByProps({ name: "email" }).props).toMatchObject({ type: "email", required: true, defaultValue: "", maxLength: 200 });
  expect(off.findByProps({ name: "csrfToken" }).props.value).toBe("catalog-csrf");
  expect(off.findByProps({ value: "save-off-contact" }).props.name).toBe("intent");
  expect(text(off.findByProps({ value: "save-off-contact" }))).toBe("Save and enable scanning");
  expect(text(off)).toContain("Scanned and typed barcodes are sent to Open Food Facts. Data available under the ODbL.");
  expect(off.findByProps({ children: "ODbL" }).props).toMatchObject({ href: "https://opendatacommons.org/licenses/odbl/1-0/", target: "_blank", rel: "noreferrer" });
});

test("a configured contact is read-only until Change, and Remove asks before disabling scanning", async () => {
  const { card } = await render(empty, "family@example.com");
  const off = () => card("open-food-facts");
  expect(text(off())).toContain("Open Food Facts● Enabled");
  expect(text(off())).toContain("Barcode scanning is on for every member.");
  expect(text(off())).toContain("Contact emailfamily@example.com");
  expect(off().findAllByProps({ name: "email" })).toHaveLength(0);

  await act(() => { (off().findByProps({ children: "Change" }).props as { onClick: () => void }).onClick(); });
  expect(off().findByProps({ name: "email" }).props.defaultValue).toBe("family@example.com");
  expect(text(off().findByProps({ value: "save-off-contact" }))).toBe("Save contact email");
  await act(() => { (off().findByProps({ children: "Cancel" }).props as { onClick: () => void }).onClick(); });
  expect(off().findAllByProps({ name: "email" })).toHaveLength(0);

  await act(() => { (off().findByProps({ children: "Remove" }).props as { onClick: () => void }).onClick(); });
  expect(text(off())).toContain("Disable barcode scanning for everyone?");
  expect(off().findByProps({ value: "remove-off-contact" }).props.name).toBe("intent");
  await act(() => { (off().findByProps({ children: "Keep scanning" }).props as { onClick: () => void }).onClick(); });
  expect(text(off())).not.toContain("Disable barcode scanning for everyone?");
});

test.each(["uploading", "queued", "validating", "importing", "indexing", "activating", "succeeded", "failed", "interrupted"] as const)("%s jobs expose no progress, diagnostic data, reports or polling on either card", async phase => {
  vi.useFakeTimers();
  const state = { ...empty, busy: true, job: { ...job(phase), error: "Private archive error", exclusions: { invalid_identity: 2345 } } };
  const { renderer, load } = await render(state);
  expect(renderer.root.findAllByProps({ type: "file" })).toHaveLength(0);
  expect(renderer.root.findAllByType("progress")).toHaveLength(0);
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(renderer.root.findAllByType("details")).toHaveLength(0);
  expect(text(renderer.root)).not.toMatch(/Private archive error|bytes received|records processed|foods imported|records rejected|invalid identity|installation complete|installation failed|installation interrupted|Receiving archive|Queued for import|Validating archive|Importing foods|Building search index|Activating catalog|Excluded records/);
  expect(renderer.root.findAllByType("button").filter(button => /Install|Replace|Retry/.test(text(button)))).toHaveLength(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
  expect(load).toHaveBeenCalledTimes(1);
});

test.each([
  ["newer", "A newer USDA Foundation release is available."],
  ["unchanged", "No newer declared USDA Foundation release was found."],
  ["unavailable", "USDA release metadata is temporarily unavailable."],
  ["indeterminate", "USDA release metadata cannot be compared safely."],
] as const)("USDA %s update state keeps release, install and check times distinct", async (status, message) => {
  const availableRelease = { releasePeriod: "2026-04", identifier: "FoodData Central 15.0", releasedOn: "2026-04-30", archiveUrl: "https://fdc.nal.usda.gov/fdc-datasets/foundation.zip", archiveFilename: "foundation.zip", archiveByteLength: 3825741 };
  const installed = {
    generation: "generation", filename: "foundation.zip", sha256: "abc123", installedAt: new Date(2026, 0, 2, 3, 4, 5).toISOString(), foodCount: 1234,
    publicationDateRange: { earliest: "2020-01-01", latest: "2025-01-01" },
    sourceRelease: { releasePeriod: "2025-12", identifier: "FoodData Central 14.0", releasedOn: "2025-12-18", archiveFilename: "foundation-old.zip", archiveByteLength: 3000000 },
  };
  const { card } = await render({ ...empty, installed, updateCheck: { status, checkedAt: "2026-09-09T14:30:00.000Z", availableRelease: status === "unavailable" ? null : availableRelease, error: status === "unavailable" ? "Official USDA release metadata could not be checked." : null } });
  const usda = card("usda-fdc");
  expect(text(usda)).toContain(message);
  expect(text(usda)).toContain("Installed official release: FoodData Central 14.0 · 2025-12-18");
  expect(text(usda)).toContain(status === "unavailable" ? "Available official release: Unknown" : "Available official release: FoodData Central 15.0 · 2026-04-30");
  expect(text(usda)).toContain("Installed: 1/2/2026, 3:04:05 AM");
  expect(text(usda)).toContain("Last checked: 9/9/2026, 10:30:00 AM");
  expect(text(usda.findByProps({ action: "/settings/catalogs" }))).toContain("Check USDA updates again");
});

test("a not-installed USDA catalog and an unbound archive never claim to be current", async () => {
  const check = { status: "indeterminate" as const, checkedAt: "2026-09-09T14:30:00.000Z", availableRelease: { releasePeriod: "2026-04", identifier: "FoodData Central 15.0", releasedOn: "2026-04-30", archiveUrl: "https://fdc.nal.usda.gov/fdc-datasets/foundation.zip", archiveFilename: "foundation.zip", archiveByteLength: 3825741 }, error: null };
  const notInstalled = await render({ ...empty, updateCheck: check });
  expect(text(notInstalled.card("usda-fdc"))).toContain("Install a Foundation archive before comparing it with USDA's declared release.");
  const unbound = await render({ ...empty, installed: { generation: "generation", filename: "renamed.zip", sha256: "abc", installedAt: "2026-01-02T03:04:05.000Z", foodCount: 1, publicationDateRange: { earliest: "2025-01-01", latest: "2026-04-30" } }, updateCheck: check });
  expect(text(unbound.card("usda-fdc"))).toContain("The installed archive could not be tied to a declared USDA release.");
  expect(text(unbound.card("usda-fdc"))).not.toContain("No newer declared USDA Foundation release was found.");
});

test("an installed USDA catalog shows its dates and immutable snapshot metadata", async () => {
  const installed = { generation: "generation", filename: "release.zip", sha256: "abc123", installedAt: new Date(2026, 0, 2, 3, 4, 5).toISOString(), foodCount: 1234, publicationDateRange: { earliest: "2020-01-01", latest: "2023-01-01" } };
  const { card } = await render({ ...empty, installed, job: job("succeeded") });
  const usda = card("usda-fdc");
  expect(text(usda)).toContain("1,234 foods installedArchive: release.zip");
  expect(text(usda)).toContain("Food publication dates: 2020-01-01 – 2023-01-01");
  expect(text(usda)).not.toContain("USDA installation complete");
  expect(text(usda.findByType("details"))).toBe("Source snapshot fingerprintSHA-256: abc123");
  expect(text(usda)).toContain("Installed: 1/2/2026, 3:04:05 AM");
  expect(text(usda)).toContain("Import a newer Foundation archive, or deliberately reimport this archive, while the installed catalog remains available.");
});

async function renderContact(email: string | undefined, result: BarcodeContactResult) {
  const Routes = createRoutesStub([{ path: "/", Component: () => createElement(BarcodeContactSection, { csrfToken: "catalog-csrf", email, result }) }]);
  let renderer!: ReactTestRenderer;
  await act(() => { renderer = create(createElement(Routes, { initialEntries: ["/"] })); });
  renderers.push(renderer);
  return renderer;
}

test.each([
  ["enabled", "family@example.com", "✓ Barcode scanning enabled."],
  ["updated", "parents@example.com", "✓ Contact email updated."],
] as const)("a %s contact confirms the change on the same card", async (contact, email, message) => {
  const renderer = await renderContact(email, { contact });
  expect(text(renderer.root.findByProps({ role: "status" }))).toBe(message);
  expect(text(renderer.root)).toContain(`Contact email${email}`);
});

test("an invalid contact keeps the typed value with an error and no status change", async () => {
  const renderer = await renderContact("family@example.com", { contact: "invalid", error: "Enter a valid email address.", value: "not an email" });
  expect(renderer.root.findByProps({ name: "email" }).props).toMatchObject({ defaultValue: "not an email", "aria-invalid": true, "aria-describedby": "off-contact-error" });
  expect(text(renderer.root.findByProps({ role: "alert" }))).toBe("Enter a valid email address.");
  expect(text(renderer.root)).toContain("● Enabled");
});

test("Cancel after a rejected email discards it and shows the saved contact again", async () => {
  const renderer = await renderContact("family@example.com", { contact: "invalid", error: "Enter a valid email address.", value: "review@example.c" });
  expect(renderer.root.findByProps({ role: "alert" })).toBeDefined();
  await act(() => { (renderer.root.findByProps({ children: "Cancel" }).props as { onClick: () => void }).onClick(); });
  expect(renderer.root.findAllByProps({ name: "email" })).toHaveLength(0);
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(text(renderer.root)).toContain("Contact emailfamily@example.com");
  await act(() => { (renderer.root.findByProps({ children: "Change" }).props as { onClick: () => void }).onClick(); });
  expect(renderer.root.findByProps({ name: "email" }).props.defaultValue).toBe("family@example.com");
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
});

test("removing the contact returns to the not-configured card", async () => {
  const renderer = await renderContact(undefined, { contact: "removed" });
  expect(text(renderer.root)).toContain("○ Not configured");
  expect(text(renderer.root.findByProps({ role: "status" }))).toBe("Barcode scanning disabled.");
  expect(renderer.root.findByProps({ name: "email" }).props.defaultValue).toBe("");
});
