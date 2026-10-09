import { createElement } from "react";
import { createRoutesStub } from "react-router";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import CatalogSettings, { meta } from "../../app/routes/settings.catalogs";
import type { CatalogState, ImportPhase } from "../../app/catalog-management/catalog-management.server";
import { BarcodeContactSection, type BarcodeContactResult } from "../../app/barcode";
import { UsdaCatalogCard } from "../../app/catalog-management/usda-catalog-card";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const renderers: ReactTestRenderer[] = [];
afterEach(async () => { for (const renderer of renderers.splice(0)) await act(() => renderer.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
const empty: CatalogState = { installed: null, job: null, busy: false };
function job(phase: ImportPhase): NonNullable<CatalogState["job"]> { return { id: "job", filename: "archive.gz", phase, receivedBytes: 1234, processedRecords: 5678, importedRecords: 4321, rejectedRecords: 123, exclusions: {}, error: null, startedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }; }
function text(node: ReactTestInstance): string { return node.children.map(child => typeof child === "string" ? child : text(child)).join(""); }
async function render(catalog: CatalogState = empty, offContact?: string, actionResult?: BarcodeContactResult) {
  const load = vi.fn(() => ({ catalog, offContact, today: "2026-09-08", csrfToken: "catalog-csrf", renderedAt: "2026-09-09T14:45:00.000Z" }));
  const Routes = createRoutesStub([{ path: "/settings/catalogs", id: "catalogs", Component: CatalogSettings, loader: load, action: () => actionResult ?? null }]);
  let renderer!: ReactTestRenderer;
  await act(() => { renderer = create(createElement(Routes, { initialEntries: ["/settings/catalogs"], hydrationData: { loaderData: { catalogs: load() } } })); });
  renderers.push(renderer);
  return { renderer, load, card: (provider: string) => renderer.root.findByProps({ "aria-labelledby": `${provider}-heading` }) };
}

test("an installed USDA catalog reports only catalog details, with no analysis status", async () => {
  const installed = { generation: "generation", filename: "foundation.zip", sha256: "abc", installedAt: "2026-01-02T03:04:05.000Z", foodCount: 4, publicationDateRange: { earliest: "2019-04-01", latest: "2026-04-30" } };
  const { card } = await render({ ...empty, installed });
  expect(text(card("usda-fdc"))).toContain("4 foods installed");
  expect(text(card("usda-fdc"))).toContain("Archivefoundation.zip");
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
  expect(new Set(usda.findAllByType("a").map(link => link.props.href as string))).toEqual(new Set(["https://fdc.nal.usda.gov/download-datasets/"]));
  expect(renderer.root.findAllByProps({ type: "file" })).toHaveLength(0);
  expect(text(usda.findByProps({ type: "submit" }))).toBe("Check for updates");
  expect(text(usda)).toContain("Not installed");
  expect(usda.findByType("details").props.open).toBe(true);
  expect(text(usda.findByType("details"))).toContain("Install USDA Foundation");
  expect(text(usda)).toContain("pnpm catalog:import:usda -- /absolute/path/to/FoodData_Central_foundation_food_csv.zip");
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
  expect(text(renderer.root)).not.toMatch(/Private archive error|bytes received|records processed|foods imported|records rejected|invalid identity|installation complete|installation failed|installation interrupted|Receiving archive|Queued for import|Validating archive|Importing foods|Building search index|Activating catalog|Excluded records/);
  expect(renderer.root.findAllByType("button").filter(button => /Install|Replace|Retry/.test(text(button)))).toHaveLength(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
  expect(load).toHaveBeenCalledTimes(1);
});

const availableRelease = { releasePeriod: "2026-04", identifier: "FoodData Central 15.0", releasedOn: "2026-04-30", archiveUrl: "https://fdc.nal.usda.gov/fdc-datasets/foundation.zip", archiveFilename: "foundation-2026-04.zip", archiveByteLength: 48250000 };
const boundInstalled = {
  generation: "generation", filename: "foundation-old.zip", sha256: "3f9a7d1e0b5c42a88e6f1d93b7c0a5e4d2f81c6b9a0e3d7f5c1b8a2e6d4f9c21e", installedAt: "2026-08-22T14:45:00.000Z", foodCount: 1234,
  publicationDateRange: { earliest: "2020-01-01", latest: "2025-01-01" },
  sourceRelease: { releasePeriod: "2025-12", identifier: "FoodData Central 14.0", releasedOn: "2025-12-18", archiveFilename: "foundation-old.zip", archiveByteLength: 3000000 },
};
function checked(status: "newer" | "unchanged" | "unavailable" | "indeterminate"): NonNullable<CatalogState["updateCheck"]> {
  return { status, checkedAt: "2026-09-09T14:30:00.000Z", availableRelease: status === "unavailable" ? null : availableRelease, error: status === "unavailable" ? "Official USDA release metadata could not be checked." : null };
}

test.each([
  ["unchanged", "Up to date", "FoodData Central 14.0 is the latest USDA release.", "Check again"],
  ["unavailable", "Couldn’t reach USDA", "Your installed catalog keeps working. Try again later.", "Try again"],
  ["indeterminate", "Couldn’t compare with USDA", "USDA release metadata cannot be compared safely.", "Try again"],
] as const)("USDA %s update state leads with its status and a check action", async (status, title, detail, action) => {
  const { card } = await render({ ...empty, installed: boundInstalled, updateCheck: checked(status) });
  const usda = card("usda-fdc");
  expect(text(usda)).toContain(title);
  expect(text(usda)).toContain(detail);
  expect(text(usda.findByProps({ action: "/settings/catalogs" }))).toBe(action);
  expect(text(usda)).toContain("Last checked 15 minutes ago");
  expect(text(usda)).toContain("Installed18 days ago");
  expect(text(usda)).toContain("ReleaseFDC 14.02025-12-18");
  expect(text(usda)).toContain("SHA-2563f9a…c21e");
  expect(text(usda.findByType("details"))).toContain("Reinstall this archive");
  expect(text(usda)).toContain("/absolute/path/to/foundation-old.zip");
});

test("a newer USDA release turns the card amber and opens the update steps on demand", async () => {
  const { card } = await render({ ...empty, installed: boundInstalled, updateCheck: checked("newer") });
  const usda = card("usda-fdc");
  expect(text(usda)).toContain("New release: FDC 15.0Published 2026-04-30 · you have FDC 14.0");
  expect(text(usda)).toContain("ReleaseFDC 14.0FDC 15.0 available");
  expect(text(usda.findByProps({ action: "/settings/catalogs" }))).toBe("Check again");
  const details = usda.findByType("details");
  expect(details.props.open).toBe(false);
  expect(text(details)).toContain("Update to FDC 15.0");
  expect(text(details)).toContain("Foundation Foods · CSV · 48.3 MB");
  expect(text(details)).toContain("pnpm catalog:import:usda -- /absolute/path/to/foundation-2026-04.zip");
});

async function renderCard(props: Partial<Parameters<typeof UsdaCatalogCard>[0]>, details?: { open: boolean; scrollIntoView: () => void }) {
  const Routes = createRoutesStub([{ path: "/", Component: () => createElement(UsdaCatalogCard, { catalog: { installed: boundInstalled, updateCheck: checked("unchanged") }, csrfToken: "catalog-csrf", renderedAt: "2026-09-09T14:30:10.000Z", rechecked: false, ...props }) }]);
  let renderer!: ReactTestRenderer;
  await act(() => { renderer = create(createElement(Routes, { initialEntries: ["/"] }), { createNodeMock: element => element.type === "details" ? details ?? null : null }); });
  renderers.push(renderer);
  return renderer;
}

test("How to update opens the details and scrolls them into view", async () => {
  const details = { open: false, scrollIntoView: vi.fn() };
  const renderer = await renderCard({ catalog: { installed: boundInstalled, updateCheck: checked("newer") } }, details);
  await act(() => { (renderer.root.findByProps({ children: "How to update" }).props as { onClick: () => void }).onClick(); });
  expect(details.open).toBe(true);
  expect(details.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  const unmounted = await renderCard({ catalog: { installed: boundInstalled, updateCheck: checked("newer") } });
  await act(() => { (unmounted.root.findByProps({ children: "How to update" }).props as { onClick: () => void }).onClick(); });
});

test("Copy puts the full SHA-256 on the clipboard and reports failures", async () => {
  const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const renderer = await renderCard({});
  const copy = () => renderer.root.findByProps({ "aria-label": "Copy full SHA-256" });
  await act(async () => { (copy().props as { onClick: () => void }).onClick(); await Promise.resolve(); });
  expect(writeText).toHaveBeenCalledWith(boundInstalled.sha256);
  expect(text(renderer.root.findByProps({ role: "status" }))).toBe("Copied");
  await act(async () => { (copy().props as { onClick: () => void }).onClick(); await Promise.resolve(); });
  expect(text(renderer.root.findByProps({ role: "alert" }))).toBe("Could not copy");
});

test("an unchecked catalog asks for its first check", async () => {
  const renderer = await renderCard({ catalog: { installed: boundInstalled, updateCheck: undefined } });
  expect(text(renderer.root)).toContain("Not checked yetUSDA update status has not been checked.");
  expect(text(renderer.root)).toContain("USDA has not been checked");
  expect(text(renderer.root.findByProps({ type: "submit" }))).toBe("Check for updates");
});

test("a just-run check that finds no newer release confirms it was checked", async () => {
  const renderer = await renderCard({ rechecked: true });
  expect(text(renderer.root)).toContain("Still up to dateNo newer release at USDA.");
  expect(text(renderer.root)).toContain("Last checked just now");
});

test("a not-installed USDA catalog and an unbound archive never claim to be current", async () => {
  const notInstalled = await render({ ...empty, updateCheck: checked("indeterminate") });
  expect(text(notInstalled.card("usda-fdc"))).toContain("Not installed");
  expect(text(notInstalled.card("usda-fdc"))).not.toContain("Up to date");
  const unbound = await render({ ...empty, installed: { ...boundInstalled, filename: "renamed.zip", sourceRelease: undefined }, updateCheck: checked("unchanged") });
  expect(text(unbound.card("usda-fdc"))).toContain("Release unknownThe installed archive could not be tied to a declared USDA release.");
  expect(text(unbound.card("usda-fdc"))).toContain("ReleaseUnknownNot declared");
  expect(text(unbound.card("usda-fdc"))).not.toContain("Up to date");
});

test("an installed USDA catalog shows its dates and immutable snapshot metadata", async () => {
  const installed = { generation: "generation", filename: "release.zip", sha256: "abc123", installedAt: new Date(2026, 0, 2, 3, 4, 5).toISOString(), foodCount: 1234, publicationDateRange: { earliest: "2020-01-01", latest: "2023-01-01" } };
  const { card } = await render({ ...empty, installed, job: job("succeeded") });
  const usda = card("usda-fdc");
  expect(text(usda)).toContain("1,234 foods installed");
  expect(text(usda)).not.toContain("USDA installation complete");
  const details = text(usda.findByType("details"));
  expect(details).toContain("Archiverelease.zip");
  expect(details).toContain("Food dates2020-01-01 – 2023-01-01");
  expect(details).toContain("SHA-256abc123");
  expect(details).toContain("Installed1/2/2026, 3:04:05 AM");
  expect(details).toContain("Saved Food Entries keep their original nutrition and measurements.");
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
