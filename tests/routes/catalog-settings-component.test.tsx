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
async function render(catalog: CatalogState = empty, offCatalog: CatalogState = empty) {
  const load = vi.fn(() => ({ catalog, offCatalog, today: "2026-09-08", csrfToken: "catalog-csrf" }));
  const Routes = createRoutesStub([{ path: "/settings/catalogs", id: "catalogs", Component: CatalogSettings, loader: load }]);
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

test("each catalog card shows availability, official downloads and metadata controls without installation controls", async () => {
  expect(meta()).toEqual([{ title: "Food Catalogs · Open Calorie Tracker" }]);
  const { renderer, card } = await render();
  const off = card("open-food-facts"); const usda = card("usda-fdc");
  expect(text(renderer.root)).toContain("Shared reference foods for local search and logging.");
  expect(text(off)).toContain("Open Food FactsNot installedDownload the official product JSONL GZIP (recommended for serving nutrition), then install it with the terminal command. Existing tab-separated CSV GZIP imports remain supported.");
  expect(text(off)).toContain("Open Database License (ODbL)");
  expect(text(off)).toContain("Saved Food Entries keep their original nutrition and measurements.");
  expect(off.findByType("a").props).toMatchObject({ href: "https://world.openfoodfacts.org/data", target: "_blank", rel: "noreferrer" });
  expect(usda.findByType("a").props.href).toBe("https://fdc.nal.usda.gov/download-datasets/");
  expect(renderer.root.findAllByProps({ type: "file" })).toHaveLength(0);
  expect(text(off.findByType("button"))).toBe("Check OFF updates");
  expect(text(usda.findByType("button"))).toBe("Check USDA updates");
});

test.each(["uploading", "queued", "validating", "importing", "indexing", "activating", "succeeded", "failed", "interrupted"] as const)("%s jobs expose no progress, diagnostic data, reports or polling on either card", async phase => {
  vi.useFakeTimers();
  const state = { ...empty, busy: true, job: { ...job(phase), error: "Private archive error", exclusions: { invalid_identity: 2345 } } };
  const { renderer, load } = await render(state, state);
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

test.each([undefined, { earliest: null, latest: null }, { earliest: "2024-01-01", latest: "2025-01-01" }])("installed sources show distinct dates and immutable snapshot metadata %#", async sourceDateRange => {
  const installed = { generation: "generation", filename: "release.csv.gz", sha256: "abc123", installedAt: new Date(2026, 0, 2, 3, 4, 5).toISOString(), foodCount: 1234, publicationDateRange: { earliest: "2020-01-01", latest: "2023-01-01" }, sourceDateRange };
  const { card } = await render({ ...empty, installed, job: job("succeeded") }, { ...empty, installed });
  const off = card("open-food-facts"); const usda = card("usda-fdc");
  expect(text(off)).toContain("Open Food FactsInstalled");
  expect(text(off)).toContain("1,234 foods installedArchive: release.csv.gz");
  expect(text(off)).toContain(`Product modification dates: ${sourceDateRange?.earliest ?? "Unknown"} – ${sourceDateRange?.latest ?? "Unknown"}`);
  expect(text(off)).toContain("These dates describe products, not an official dump release.");
  expect(text(usda)).toContain("Food publication dates: 2020-01-01 – 2023-01-01");
  expect(text(usda)).not.toContain("USDA installation complete");
  expect(text(off.findByType("details"))).toBe("Source snapshot fingerprintSHA-256: abc123");
  expect(text(off)).toContain("Installed: 1/2/2026, 3:04:05 AM");
  expect(text(off)).toContain("Import a newer OFF archive, or deliberately reimport this archive, while the installed catalog remains available.");
  expect(text(usda)).toContain("Import a newer Foundation archive, or deliberately reimport this archive, while the installed catalog remains available.");
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
});

test("OFF displays matched snapshot dates separately from unknown dates and unchecked status", async () => {
  const snapshot = { lastModified: "2026-09-07T12:00:00.000Z", etag: '"snapshot"', archiveByteLength: 252, crc64nvme: "JX7I3P/MX4I=" };
  const installed = { generation: "generation", filename: "renamed.gz", sha256: "abc", installedAt: "2026-09-08T13:00:00.000Z", foodCount: 1, publicationDateRange: { earliest: "", latest: "" }, sourceSnapshot: snapshot };
  const checked = await render(empty, { ...empty, installed, updateCheck: { status: "newer", checkedAt: "2026-09-09T14:30:00.000Z", availableRelease: null, availableSnapshot: { ...snapshot, lastModified: "2026-09-09T12:00:00.000Z" }, error: null } });
  const off = checked.card("open-food-facts");
  expect(text(off)).toContain("Installed official snapshot: 2026-09-07T12:00:00.000Z");
  expect(text(off)).toContain("Available export last modified: 2026-09-09T12:00:00.000Z");
  expect(text(off)).not.toContain("The installed archive has not been matched");
  expect(off.findByProps({ name: "intent" }).props.value).toBe("check-off-update");
  expect(checked.card("usda-fdc").findByProps({ name: "intent" }).props.value).toBe("check-usda-update");

  const withoutDate = await render(empty, { ...empty, installed: { ...installed, sourceSnapshot: { ...snapshot, lastModified: null } } });
  const unknown = withoutDate.card("open-food-facts");
  expect(text(unknown)).toContain("Installed official snapshot: Matched export; date unknown");
  expect(text(unknown)).toContain("Available export last modified: Unknown");
  expect(text(unknown)).toContain("OFF update status has not been checked.");
  expect(text(unknown.findByProps({ name: "intent" }))).toBe("Check OFF updates");
});
