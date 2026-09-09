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
function job(phase: ImportPhase): NonNullable<CatalogState["job"]> { return { id: "job", filename: "archive.gz", phase, receivedBytes: 1234, processedRecords: 5678, exclusions: {}, error: null, startedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }; }
function text(node: ReactTestInstance): string { return node.children.map(child => typeof child === "string" ? child : text(child)).join(""); }
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
  expect(off.findByType("input").props).toMatchObject({ type: "file", name: "archive", accept: ".gz,application/gzip", required: true, disabled: false });
  expect(usda.findByType("input").props.accept).toBe(".zip,application/zip");
  expect(off.findByType("a").props).toMatchObject({ href: "https://world.openfoodfacts.org/data", target: "_blank", rel: "noreferrer" });
  expect(usda.findByType("a").props.href).toBe("https://fdc.nal.usda.gov/download-datasets/");
  expect(text(off.findByType("button"))).toBe("Install Open Food Facts");
  expect(text(usda.findByType("button"))).toBe("Install USDA Foundation");
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
  expect(off.findByType("button").props.disabled).toBe(busy);
  expect(off.findByType("input").props.disabled).toBe(busy);
  expect(card("usda-fdc").findByType("button").props.disabled).toBe(false);
  expect(text(off).includes("You can leave this page. Import continues on the server; return here for the outcome.")).toBe(busy);
  expect(text(off.findByType("details"))).toBe("Excluded records and unavailable datainvalid identity: 2,345These counts describe individual records or values; an archive failure is shown separately above.");
  if (phase === "failed") expect(text(off.findByProps({ role: "alert" }))).toBe("Archive rejected");
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
  expect(text(off)).toContain("Catalog replacement is not available yet.");
  expect(off.findAllByType("form")).toHaveLength(0);
  expect(text(usda)).toContain("Upload a newer Foundation archive, or deliberately reimport this archive, while the installed catalog remains available.");
  expect(text(usda.findByType("button"))).toBe("Replace or reimport USDA Foundation");
  expect(usda.findByType("input").props.disabled).toBe(false);
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
  await act(() => { card.findByType("form").props.onSubmit({ preventDefault, currentTarget: {} }); });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(get).toHaveBeenCalledWith("archive");
  return UploadRequest.requests.at(-1)!;
}

test.each([null, "archive", new File([], "empty.gz")])("empty/non-file submissions stay local %#", async file => {
  const { card } = await render();
  await submit(card("open-food-facts"), file);
  expect(text(card("open-food-facts").findByProps({ role: "alert" }))).toBe("Choose a OFF tab-separated CSV GZIP archive.");
  expect(card("open-food-facts").findByType("button").props.disabled).toBe(false);
});

test.each(["usda-fdc", "open-food-facts"] as const)("%s sends its upload headers, reports bytes, and refreshes after acceptance", async provider => {
  vi.useFakeTimers();
  const { card, load } = await render();
  const file = new File(["1234567890"], "source name.gz");
  const request = await submit(card(provider), file);
  expect(request.open).toHaveBeenCalledWith("POST", "/settings/catalogs");
  expect(request.setRequestHeader.mock.calls).toEqual([["Content-Type", provider === "usda-fdc" ? "application/zip" : "application/gzip"], ["X-Catalog-Provider", provider], ["X-CSRF-Token", "catalog-csrf"], ["X-Archive-Name", "source%20name.gz"]]);
  expect(request.send).toHaveBeenCalledWith(file);
  expect(card(provider).findByType("input").props.disabled).toBe(true);
  expect(card(provider).findByType("button").props.disabled).toBe(true);
  await act(() => request.upload.onprogress!({ loaded: 4 }));
  expect(text(card(provider))).toContain("Uploading: 4 / 10 bytes");
  expect(card(provider).findByType("progress").props).toMatchObject({ "aria-label": "Archive upload", value: 4, max: 10 });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(load).toHaveBeenCalledTimes(2);
  await act(() => request.onload!());
  expect(card(provider).findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(card(provider).findByType("button").props.disabled).toBe(false);
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
  expect(off.findByType("button").props.disabled).toBe(false);
  await submit(off, new File(["retry"], "retry.gz"));
  expect(off.findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(load).toHaveBeenCalledTimes(2);
});

test("connection errors refresh the durable server outcome and allow retry", async () => {
  const { card, load } = await render();
  const request = await submit(card("open-food-facts"), new File(["body"], "archive.gz"));
  await act(() => request.onerror!());
  expect(text(card("open-food-facts").findByProps({ role: "alert" }))).toBe("Upload connection failed. Return to Settings to check the server outcome before retrying.");
  expect(card("open-food-facts").findByType("button").props.disabled).toBe(false);
  expect(load).toHaveBeenCalledTimes(2);
});
