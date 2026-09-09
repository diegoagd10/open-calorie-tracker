/* eslint-disable @typescript-eslint/no-unsafe-call -- react-test-renderer host event props are untyped */
import { createElement } from "react";
import { createRoutesStub } from "react-router";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import CatalogSettings, { meta } from "../../app/routes/settings.catalogs";
import type { CatalogState, ImportPhase } from "../../app/catalog-management/catalog-management.server";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const renderers: ReactTestRenderer[] = [];
afterEach(async () => { for (const renderer of renderers.splice(0)) await act(() => renderer.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
const empty: CatalogState = { installed: null, job: null, busy: false };
function job(phase: ImportPhase): NonNullable<CatalogState["job"]> { return { id: "job", filename: "archive.gz", phase, receivedBytes: 1234, processedRecords: 5678, importedRecords: 4321, rejectedRecords: 123, exclusions: {}, error: null, startedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }; }
function text(node: ReactTestInstance): string { return node.children.map(child => typeof child === "string" ? child : text(child)).join(""); }
function uploadInput(card: ReactTestInstance) { return card.findAllByType("input").find(input => input.props.type === "file")!; }
function uploadButton(card: ReactTestInstance) { return card.findAllByType("button").find(button => /Install|Replace or reimport|Retry/.test(text(button)))!; }
function uploadForm(card: ReactTestInstance) { return card.findAllByType("form").find(form => form.findAllByProps({ name: "archive" }).length > 0)!; }
async function render(catalog = empty, offCatalog = empty) {
  const load = vi.fn(() => ({ catalog, offCatalog, today: "2026-09-08", csrfToken: "catalog-csrf" }));
  const Routes = createRoutesStub([{ path: "/settings/catalogs", id: "catalogs", Component: CatalogSettings, loader: load }]);
  let renderer!: ReactTestRenderer;
  await act(() => { renderer = create(createElement(Routes, { initialEntries: ["/settings/catalogs"], hydrationData: { loaderData: { catalogs: load() } } })); });
  renderers.push(renderer);
  return { renderer, load, card: (provider: string) => renderer.root.findByProps({ "aria-labelledby": `${provider}-heading` }) };
}

test("each catalog card identifies its source, archive type, license and independent controls", async () => {
  expect(meta()).toEqual([{ title: "Food Catalogs · Open Calorie Tracker" }]);
  const { renderer, card, load } = await render();
  const off = card("open-food-facts"); const usda = card("usda-fdc");
  expect(text(renderer.root)).toContain("Install shared reference foods for local search and logging.");
  expect(text(off)).toContain("Open Food FactsNot installedDownload the OFF tab-separated CSV GZIP, then upload it here.");
  expect(text(off)).toContain("Open Food Facts data is available under the Open Database License (ODbL). Products without an explicit nutrition basis can be reviewed but cannot be used for calculated logging.");
  expect(text(off)).toContain("Saved Food Entries keep their original nutrition and measurements.");
  expect(uploadInput(off).props).toMatchObject({ type: "file", name: "archive", accept: ".gz,application/gzip", required: true, disabled: false });
  expect(uploadInput(usda).props.accept).toBe(".zip,application/zip");
  expect(off.findByType("a").props).toMatchObject({ href: "https://world.openfoodfacts.org/data", target: "_blank", rel: "noreferrer" });
  expect(usda.findByType("a").props.href).toBe("https://fdc.nal.usda.gov/download-datasets/");
  expect(text(uploadButton(off))).toBe("Install Open Food Facts");
  expect(text(uploadButton(usda))).toBe("Install USDA Foundation");
  expect(off.findByProps({ role: "status" }).props["aria-live"]).toBe("polite");
  expect(text(off.findByType("noscript"))).toBe("Enable JavaScript to upload a catalog and view import progress.");
  expect(load).toHaveBeenCalledTimes(1);
});

test.each([
  ["uploading", "Receiving archive"], ["queued", "Queued for import"], ["validating", "Validating archive"], ["importing", "Importing foods and nutrition"], ["indexing", "Building search index"], ["activating", "Activating catalog"], ["succeeded", "Open Food Facts installation complete"], ["failed", "Open Food Facts installation failed"], ["interrupted", "Open Food Facts installation interrupted"],
] as const)("OFF phase %s exposes progress independently of USDA", async (phase, label) => {
  const busy = !["succeeded", "failed", "interrupted"].includes(phase);
  const { card } = await render(empty, { ...empty, busy, job: { ...job(phase), error: phase === "failed" ? "Archive rejected" : null, exclusions: { invalid_identity: 2345 } } });
  const off = card("open-food-facts");
  expect(text(off.findByProps({ role: "status" }))).toContain(`${label}1,234 bytes received · 5,678 records processed`);
  expect(uploadButton(off).props.disabled).toBe(busy);
  expect(uploadInput(off).props.disabled).toBe(busy);
  expect(uploadButton(card("usda-fdc")).props.disabled).toBe(false);
  expect(text(off).includes("You can leave this page. Import continues on the server; return here for the outcome.")).toBe(busy);
  expect(text(off.findByType("details"))).toBe("Excluded records and unavailable datainvalid identity: 2,345These counts describe individual records or values; an archive failure is shown separately above.");
  if (phase === "failed") expect(text(off.findByProps({ role: "alert" }))).toBe("Archive rejected");
});

test.each([
  ["usda-fdc", "failed", "Retry USDA Foundation installation"],
  ["open-food-facts", "interrupted", "Retry Open Food Facts installation"],
] as const)("%s %s state offers a safe archive retry after reload", async (provider, phase, button) => {
  const retryable = { ...empty, job: { ...job(phase), error: `${provider} recovery message` } };
  const { card } = await render(provider === "usda-fdc" ? retryable : empty, provider === "open-food-facts" ? retryable : empty);
  const catalog = card(provider);
  expect(text(uploadButton(catalog))).toBe(button);
  expect(text(catalog)).toContain("Select the archive again to retry. Partial uploads are not resumed.");
  expect(uploadInput(catalog).props.disabled).toBe(false);
});

test("each catalog reports imported foods separately from rejected food records", async () => {
  const { card } = await render({ ...empty, busy: true, job: job("importing") }, { ...empty, busy: true, job: job("importing") });
  expect(text(card("usda-fdc").findByProps({ role: "status" }))).toContain("4,321 foods imported · 123 food records rejected");
  expect(text(card("open-food-facts").findByProps({ role: "status" }))).toContain("4,321 foods imported · 123 food records rejected");
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

test.each([undefined, { earliest: null, latest: null }, { earliest: "2024-01-01", latest: "2025-01-01" }])("installed sources show distinct dates and immutable snapshot metadata %#", async sourceDateRange => {
  const installed = { generation: "generation", filename: "release.csv.gz", sha256: "abc123", installedAt: new Date(2026, 0, 2, 3, 4, 5).toISOString(), foodCount: 1234, publicationDateRange: { earliest: "2020-01-01", latest: "2023-01-01" }, sourceDateRange };
  const { card } = await render({ ...empty, installed, job: job("succeeded") }, { ...empty, installed });
  const off = card("open-food-facts"); const usda = card("usda-fdc");
  expect(text(off)).toContain("Open Food FactsInstalled");
  expect(text(off)).toContain("1,234 foods installedArchive: release.csv.gz");
  expect(text(off)).toContain(`Product modification dates: ${sourceDateRange?.earliest ?? "Unknown"} – ${sourceDateRange?.latest ?? "Unknown"}`);
  expect(text(off)).toContain("These dates describe products, not an official dump release.");
  expect(text(usda)).toContain("Food publication dates: 2020-01-01 – 2023-01-01");
  expect(text(usda)).toContain("USDA installation complete");
  expect(text(off.findByType("details"))).toBe("Source snapshot fingerprintSHA-256: abc123");
  expect(text(off)).toContain("Installed: 1/2/2026, 3:04:05 AM");
  expect(text(off)).toContain("Upload a newer OFF archive, or deliberately reimport this archive, while the installed catalog remains available.");
  expect(text(uploadButton(off))).toBe("Replace or reimport Open Food Facts");
  expect(uploadInput(off).props.disabled).toBe(false);
  expect(text(usda)).toContain("Upload a newer Foundation archive, or deliberately reimport this archive, while the installed catalog remains available.");
  expect(text(uploadButton(usda))).toBe("Replace or reimport USDA Foundation");
  expect(uploadInput(usda).props.disabled).toBe(false);
});

test("busy catalogs poll, stop polling on unmount, and idle catalogs do not poll", async () => {
  vi.useFakeTimers();
  const idle = await render();
  await act(() => { vi.advanceTimersByTime(2000); });
  expect(idle.load).toHaveBeenCalledTimes(1);
  const busy = await render(empty, { ...empty, busy: true, job: job("importing") });
  await act(async () => { await vi.advanceTimersByTimeAsync(999); });
  expect(busy.load).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(busy.load).toHaveBeenCalledTimes(2);
  await act(() => busy.renderer.unmount());
  expect(vi.getTimerCount()).toBe(0);
});

class UploadRequest {
  static requests: UploadRequest[] = [];
  status = 202;
  responseText = "";
  upload = { onprogress: null as null | ((event: { loaded: number }) => void) };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  open = vi.fn(); setRequestHeader = vi.fn(); send = vi.fn();
  constructor() { UploadRequest.requests.push(this); }
}
async function submit(card: ReactTestInstance, file: unknown) {
  const get = vi.fn(() => file);
  vi.stubGlobal("FormData", class { get = get; });
  vi.stubGlobal("XMLHttpRequest", UploadRequest);
  const preventDefault = vi.fn();
  await act(() => { uploadForm(card).props.onSubmit({ preventDefault, currentTarget: {} }); });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(get).toHaveBeenCalledWith("archive");
  return UploadRequest.requests.at(-1)!;
}

test.each([null, "archive", new File([], "empty.gz")])("empty/non-file submissions stay local %#", async file => {
  const { card } = await render();
  await submit(card("open-food-facts"), file);
  expect(text(card("open-food-facts").findByProps({ role: "alert" }))).toBe("Choose a OFF tab-separated CSV GZIP archive.");
  expect(uploadButton(card("open-food-facts")).props.disabled).toBe(false);
});

test.each(["usda-fdc", "open-food-facts"] as const)("%s sends its upload headers, reports bytes, and refreshes after acceptance", async provider => {
  vi.useFakeTimers();
  const { card, load } = await render();
  const file = new File(["1234567890"], "source name.gz");
  const request = await submit(card(provider), file);
  expect(request.open).toHaveBeenCalledWith("POST", "/settings/catalogs");
  expect(request.setRequestHeader.mock.calls).toEqual([["Content-Type", provider === "usda-fdc" ? "application/zip" : "application/gzip"], ["X-Catalog-Provider", provider], ["X-CSRF-Token", "catalog-csrf"], ["X-Archive-Name", "source%20name.gz"]]);
  expect(request.send).toHaveBeenCalledWith(file);
  expect(uploadInput(card(provider)).props.disabled).toBe(true);
  expect(uploadButton(card(provider)).props.disabled).toBe(true);
  await act(() => request.upload.onprogress!({ loaded: 4 }));
  expect(text(card(provider))).toContain("Uploading: 4 / 10 bytes");
  expect(card(provider).findByType("progress").props).toMatchObject({ "aria-label": "Archive upload", value: 4, max: 10 });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(load).toHaveBeenCalledTimes(2);
  await act(() => request.onload!());
  expect(card(provider).findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(uploadButton(card(provider)).props.disabled).toBe(false);
  expect(card(provider).findAllByType("progress")).toHaveLength(0);
  expect(load).toHaveBeenCalledTimes(3);
});

test.each([
  [409, '{"error":"Busy on another device"}', "Busy on another device"],
  [201, '{}', "Upload was rejected. Reload Settings and try again."],
  [203, '<html>Forbidden</html>', "Upload was rejected. Reload Settings and try again."],
] as const)("upload status %s shows an actionable rejection and permits retry", async (status, responseText, message) => {
  const { card, load } = await render();
  const off = card("open-food-facts");
  const request = await submit(off, new File(["body"], "archive.gz"));
  request.status = status; request.responseText = responseText;
  await act(() => request.onload!());
  expect(text(off.findByProps({ role: "alert" }))).toBe(message);
  expect(uploadButton(off).props.disabled).toBe(false);
  await submit(off, new File(["retry"], "retry.gz"));
  expect(off.findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(load).toHaveBeenCalledTimes(2);
});

test("connection errors refresh the durable server outcome and allow retry", async () => {
  const { card, load } = await render();
  const request = await submit(card("open-food-facts"), new File(["body"], "archive.gz"));
  await act(() => request.onerror!());
  expect(text(card("open-food-facts").findByProps({ role: "alert" }))).toBe("Upload connection failed. Return to Settings to check the server outcome before retrying.");
  expect(uploadButton(card("open-food-facts")).props.disabled).toBe(false);
  expect(load).toHaveBeenCalledTimes(2);
});

test.each([
  ["newer", "A newer OFF export snapshot is available."],
  ["unchanged", "No change detected in the OFF export."],
  ["unavailable", "OFF snapshot metadata is temporarily unavailable."],
  ["indeterminate", "OFF snapshot metadata cannot be compared safely."],
] as const)("OFF %s state is visible independently of USDA and unknown uploads", async (status, message) => {
  const { card } = await render(empty, { ...empty, updateCheck: { status, checkedAt: "2026-09-09T14:30:00.000Z", availableRelease: null, availableSnapshot: null, error: null } });
  const off = card("open-food-facts");
  expect(text(off)).toContain(message);
  expect(text(off)).toContain("Installed official snapshot: Unknown");
  expect(text(off)).toContain("Last checked: 9/9/2026, 10:30:00 AM");
  expect(text(off)).toContain("Check OFF updates again");
  expect(text(card("usda-fdc"))).not.toContain(message);
  expect(uploadInput(off).props.disabled).toBe(false);
});

test("OFF displays matched snapshot dates separately from unknown dates and unchecked status", async () => {
  const snapshot = { lastModified: "2026-09-07T12:00:00.000Z", etag: '"snapshot"', archiveByteLength: 252, crc64nvme: "JX7I3P/MX4I=" };
  const installed = { generation: "generation", filename: "renamed.gz", sha256: "abc", installedAt: "2026-09-08T13:00:00.000Z", foodCount: 1, publicationDateRange: { earliest: "", latest: "" }, sourceSnapshot: snapshot };
  const checked = await render(empty, { ...empty, installed, updateCheck: { status: "newer", checkedAt: "2026-09-09T14:30:00.000Z", availableRelease: null, availableSnapshot: { ...snapshot, lastModified: "2026-09-09T12:00:00.000Z" }, error: null } });
  const off = checked.card("open-food-facts");
  expect(text(off)).toContain("Installed official snapshot: 2026-09-07T12:00:00.000Z");
  expect(text(off)).toContain("Available export last modified: 2026-09-09T12:00:00.000Z");
  expect(text(off)).not.toContain("The uploaded archive has not been matched");
  expect(off.findByProps({ name: "intent" }).props.value).toBe("check-off-update");
  expect(checked.card("usda-fdc").findByProps({ name: "intent" }).props.value).toBe("check-usda-update");

  const withoutDate = await render(empty, { ...empty, installed: { ...installed, sourceSnapshot: { ...snapshot, lastModified: null } } });
  const unknown = withoutDate.card("open-food-facts");
  expect(text(unknown)).toContain("Installed official snapshot: Matched export; date unknown");
  expect(text(unknown)).toContain("Available export last modified: Unknown");
  expect(text(unknown)).toContain("OFF update status has not been checked.");
  expect(text(unknown.findByProps({ name: "intent" }))).toBe("Check OFF updates");
});
