import { createElement } from "react";
import { createRoutesStub } from "react-router";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { CatalogNotifications } from "../../app/catalog-management/notifications";
import type { CatalogOutcome } from "../../app/catalog-management/catalog-management.server";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const renderers: ReactTestRenderer[] = [];
afterEach(async () => {
  for (const renderer of renderers.splice(0)) await act(() => renderer.unmount());
  vi.useRealTimers(); vi.unstubAllGlobals();
});
function text(node: ReactTestInstance): string { return node.children.map(child => typeof child === "string" ? child : text(child)).join(""); }
function outcome(patch: Partial<CatalogOutcome> = {}): CatalogOutcome {
  return { provider: "usda-fdc", jobId: "job", filename: "foundation.zip", phase: "succeeded", completedAt: "2026-09-09T12:00:00Z", error: null, acknowledgedAt: null,
    installed: { generation: "job", filename: "foundation.zip", sha256: "snapshot-fingerprint", installedAt: "2026-09-09T12:00:00Z", foodCount: 469, publicationDateRange: { earliest: "2020-01-01", latest: "2026-04-30" } }, ...patch };
}
async function render(outcomes: CatalogOutcome[]) {
  const browser = new EventTarget();
  vi.stubGlobal("window", browser);
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({ csrfToken: "csrf", outcomes }));
  vi.stubGlobal("fetch", fetch);
  const Routes = createRoutesStub([{ path: "/", Component: CatalogNotifications }]);
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(createElement(Routes, { initialEntries: ["/"] })); });
  renderers.push(renderer);
  return { renderer, fetch, browser };
}

test("the notification control distinguishes source outcomes, snapshots, absent catalogs and acknowledged history", async () => {
  const success = outcome();
  const { renderer } = await render([
    success,
    outcome({ jobId: "failed", provider: "open-food-facts", phase: "failed", filename: "broken.gz", error: "Invalid archive" }),
    outcome({ jobId: "interrupted", phase: "interrupted", installed: null }),
    outcome({ jobId: "acknowledged", acknowledgedAt: "2026-09-09T13:00:00Z" }),
  ]);
  const content = text(renderer.root);
  expect(content).toContain("(3 unread)");
  expect(content).toContain("USDA update succeeded");
  expect(content).toContain("Open Food Facts update failed");
  expect(content).toContain("The previous catalog remains active.");
  expect(content).toContain("Invalid archive");
  expect(content).toContain("No catalog was active at completion.");
  expect(content).toContain("Installed snapshot: foundation.zip");
  expect(content).toContain("469 foods");
  expect(content).toContain("SHA-256: snapshot-fingerprint");
  expect(content).toContain("Acknowledged updates (1)");
  expect(renderer.root.findAllByType("button")).toHaveLength(3);
  expect(renderer.root.findAllByType("a").map(link => link.props.href as string)).toContain("/settings/catalogs#open-food-facts-heading");
});

test("failed polling preserves outcomes and reconnect refreshes without duplicate notifications", async () => {
  const { renderer, fetch, browser } = await render([outcome()]);
  fetch.mockRejectedValueOnce(new Error("offline"));
  await act(async () => { browser.dispatchEvent(new Event("online")); });
  expect(text(renderer.root)).toContain("Catalog updates could not refresh. Reconnecting automatically.");
  expect(text(renderer.root)).toContain("USDA update succeeded");
  fetch.mockResolvedValueOnce(Response.json({ csrfToken: "csrf", outcomes: [outcome({ acknowledgedAt: "2026-09-09T13:00:00Z" })] }));
  await act(async () => { browser.dispatchEvent(new Event("online")); });
  expect(text(renderer.root)).not.toContain("could not refresh");
  expect(text(renderer.root)).toContain("(0 unread)");
  expect(text(renderer.root)).toContain("No unread catalog updates.");
  expect(renderer.root.findAllByType("h3")).toHaveLength(1);
});

test("handoff failure identifies the active replacement and renders official release metadata", async () => {
  const installed = outcome().installed!;
  const { renderer, fetch, browser } = await render([outcome({ phase: "failed", installed: { ...installed, sourceRelease: { identifier: "FoodData Central 15.0", releasedOn: "2026-04-30", releasePeriod: "2026-04", archiveFilename: "foundation.zip", archiveByteLength: 100 } } })]);
  expect(text(renderer.root)).toContain("The replacement catalog is active.");
  expect(text(renderer.root)).toContain("Official release: FoodData Central 15.0");
  fetch.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
  await act(async () => { browser.dispatchEvent(new Event("focus")); });
  expect(text(renderer.root)).toContain("could not refresh");
});
