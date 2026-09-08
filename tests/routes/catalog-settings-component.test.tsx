import { createElement } from "react";
import { createRoutesStub } from "react-router";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import CatalogSettings, { meta } from "../../app/routes/settings.catalogs";
import type { CatalogState, ImportPhase } from "../../app/catalog-management/catalog-management.server";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const empty: CatalogState = { installed: null, job: null, busy: false };
const renderers: ReactTestRenderer[] = [];
afterEach(async () => {
  for (const renderer of renderers.splice(0)) await act(() => renderer.unmount());
  vi.useRealTimers(); vi.unstubAllGlobals();
});
async function render(catalog: CatalogState = empty) {
  const load = vi.fn(() => ({ catalog, csrfToken: "archive-csrf", today: "2026-09-08" }));
  const Routes = createRoutesStub([{ path: "/settings/catalogs", id: "catalogs", Component: CatalogSettings, loader: load }]);
  let renderer!: ReactTestRenderer;
  await act(() => { renderer = create(createElement(Routes, { initialEntries: ["/settings/catalogs"], hydrationData: { loaderData: { catalogs: load() } } })); });
  renderers.push(renderer);
  return { renderer, load };
}
function text(node: ReactTestRenderer["root"]): string {
  return node.children.map(child => typeof child === "string" ? child : text(child)).join("");
}
function job(phase: ImportPhase): CatalogState["job"] {
  return { id: "generation-1", filename: "Foundation.zip", phase, receivedBytes: 1234, processedRecords: 4321, exclusions: {}, error: null, startedAt: "2026-09-08T12:00:00.000Z", updatedAt: "2026-09-08T12:01:00.000Z" };
}
function uploadTransport() {
  const xhr = {
    open: vi.fn(), setRequestHeader: vi.fn(), send: vi.fn(), upload: { onprogress: (_event: { loaded: number }) => {} },
    status: 0, responseText: "", onload: () => {}, onerror: () => {},
  };
  vi.stubGlobal("XMLHttpRequest", function () { return xhr; });
  return xhr;
}
async function submit(renderer: ReactTestRenderer, file: File | string | null) {
  vi.stubGlobal("FormData", class { get(name: string) { return name === "archive" ? file : null; } });
  const form = renderer.root.findAllByType("form").find(node => node.findAllByType("input").some(input => input.props.name === "archive"))!;
  const preventDefault = vi.fn();
  await act(() => { (form.props as { onSubmit: (event: unknown) => void }).onSubmit({ currentTarget: {}, preventDefault }); });
  expect(preventDefault).toHaveBeenCalled();
}

test("catalog Settings shows installed provenance and durable exclusions without offering replacement", async () => {
  const { renderer } = await render({ installed: { generation: "generation-1", filename: "Foundation.zip", sha256: "abc", foodCount: 1234, installedAt: "2026-09-08T12:00:00.000Z", publicationDateRange: { earliest: "2019-04-01", latest: "2026-04-30" } }, busy: false, job: { ...job("succeeded")!, exclusions: { research_record: 1234 } } });
  const content = text(renderer.root);
  for (const expected of ["1,234 foods installed", "Archive: Foundation.zip", "2019-04-01 – 2026-04-30", "USDA installation complete", "1,234 bytes received · 4,321 records processed", "research record: 1,234", "Catalog replacement is not available yet."]) expect(content).toContain(expected);
  expect(renderer.root.findAllByProps({ name: "archive" })).toHaveLength(0);
  expect(renderer.root.findByType("h2").props.id).toBe("usda-heading");
  expect(renderer.root.findByProps({ "aria-labelledby": "usda-heading" })).toBeDefined();
  expect(text(renderer.root)).not.toContain("Import continues on the server");
  const source = renderer.root.findByProps({ href: "https://fdc.nal.usda.gov/download-datasets/" });
  expect(source.props).toMatchObject({ target: "_blank", rel: "noreferrer" });
  expect(meta()).toEqual([{ title: "Food Catalogs · Open Calorie Tracker" }]);
});

test.each([
  ["uploading", "Receiving archive"], ["queued", "Queued for import"], ["validating", "Validating archive"],
  ["importing", "Importing foods and nutrition"], ["indexing", "Building search index"], ["activating", "Activating USDA"],
] as const)("%s remains visibly busy and refreshes persisted progress", async (phase, label) => {
  vi.useFakeTimers();
  const { renderer, load } = await render({ ...empty, busy: true, job: job(phase) });
  expect(text(renderer.root.findByProps({ role: "status" }))).toContain(label);
  expect(text(renderer.root)).toContain("Import continues on the server");
  expect(renderer.root.findByProps({ name: "archive" }).props.disabled).toBe(true);
  expect(renderer.root.findAllByType("button").find(button => text(button) === "Install USDA Foundation")?.props.disabled).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(999); });
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(load).toHaveBeenCalledTimes(2);
  await act(() => renderer.unmount());
  expect(vi.getTimerCount()).toBe(0);
});

test.each([["failed", "USDA installation failed"], ["interrupted", "USDA installation interrupted"]] as const)("%s exposes the saved error and permits retry without background polling", async (phase, label) => {
  vi.useFakeTimers();
  const { renderer, load } = await render({ ...empty, job: { ...job(phase)!, error: "Storage full. Free space and retry." } });
  expect(text(renderer.root.findByProps({ role: "alert" }))).toBe("Storage full. Free space and retry.");
  expect(text(renderer.root.findByProps({ role: "status" }))).toContain(label);
  expect(renderer.root.findByProps({ name: "archive" }).props).toMatchObject({ disabled: false, type: "file", required: true, accept: ".zip,application/zip" });
  expect(renderer.root.findAllByType("button").find(button => text(button) === "Install USDA Foundation")?.props.disabled).toBe(false);
  expect(text(renderer.root)).not.toContain("Import continues on the server");
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(load).toHaveBeenCalledTimes(1);
});

test("upload validates a file, sends protected archive bytes, displays progress and refreshes after acceptance", async () => {
  vi.useFakeTimers();
  const xhr = uploadTransport();
  const { renderer, load } = await render();
  for (const invalid of [null, "not a file", new File([], "empty.zip")]) {
    await submit(renderer, invalid);
    expect(text(renderer.root.findByProps({ role: "alert" }))).toBe("Choose a Foundation CSV ZIP archive.");
    expect(xhr.send).not.toHaveBeenCalled();
  }
  const file = new File([new Uint8Array(2048)], "Fondación USDA.zip");
  await submit(renderer, file);
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(xhr.open).toHaveBeenCalledWith("POST", "/settings/catalogs");
  expect(xhr.setRequestHeader.mock.calls).toEqual([["Content-Type", "application/zip"], ["X-CSRF-Token", "archive-csrf"], ["X-Archive-Name", "Fondaci%C3%B3n%20USDA.zip"]]);
  expect(xhr.send).toHaveBeenCalledWith(file);
  expect(renderer.root.findByProps({ name: "archive" }).props.disabled).toBe(true);
  expect(renderer.root.findAllByType("button").find(button => text(button) === "Install USDA Foundation")?.props.disabled).toBe(true);
  expect(text(renderer.root)).not.toContain("Import continues on the server");
  await act(() => xhr.upload.onprogress({ loaded: 1024 }));
  expect(renderer.root.findByType("progress").props).toMatchObject({ "aria-label": "Archive upload", value: 1024, max: 2048 });
  expect(text(renderer.root)).toContain("Uploading: 1,024 / 2,048 bytes");
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(load).toHaveBeenCalledTimes(2);
  xhr.status = 202;
  await act(() => xhr.onload());
  expect(renderer.root.findAllByType("progress")).toHaveLength(0);
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(renderer.root.findByProps({ name: "archive" }).props.disabled).toBe(false);
  expect(load).toHaveBeenCalledTimes(3);
});

test.each([
  [409, '{"error":"Already installed."}', "Already installed."],
  [403, "<html>Forbidden</html>", "Upload was rejected. Reload Settings and try again."],
  [400, "{}", "Upload was rejected. Reload Settings and try again."],
  [0, "", "Upload connection failed. Return to Settings to check the server outcome before retrying."],
])("upload failure %i clears progress and explains recovery", async (status, responseText, message) => {
  const xhr = uploadTransport();
  const { renderer, load } = await render();
  await submit(renderer, new File(["bytes"], "archive.zip"));
  xhr.status = status; xhr.responseText = responseText;
  await act(() => { if (status === 0) xhr.onerror(); else xhr.onload(); });
  expect(text(renderer.root.findByProps({ role: "alert" }))).toBe(message);
  expect(renderer.root.findAllByType("progress")).toHaveLength(0);
  expect(renderer.root.findByProps({ name: "archive" }).props.disabled).toBe(false);
  expect(load).toHaveBeenCalledTimes(2);
});
