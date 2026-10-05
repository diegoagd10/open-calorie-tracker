import { createElement } from "react";
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
async function mount(viewerId = 7) {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(createElement(CatalogNotifications, { viewerId })); });
  renderers.push(renderer);
  return renderer;
}
async function render(outcomes: CatalogOutcome[]) {
  vi.useFakeTimers();
  const storage = new Map<string, string>();
  const durableStorage = new Map<string, string>();
  const browser = Object.assign(new EventTarget(), {
    localStorage: { getItem: (key: string) => durableStorage.get(key) ?? null, setItem: (key: string, value: string) => { durableStorage.set(key, value); } },
    sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } },
  });
  vi.stubGlobal("window", browser);
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({ outcomes }));
  vi.stubGlobal("fetch", fetch);
  return { renderer: await mount(), fetch, browser };
}
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

// Polling, expiry and deduplication are temporal behavior, rather than static markup.
test("nothing is visible without an event or for acknowledged operator outcomes", async () => {
  const { renderer, fetch, browser } = await render([]);
  expect(text(renderer.root)).toBe("");
  expect(renderer.root.findAllByType("button")).toHaveLength(0);
  expect(renderer.root.findAllByProps({ role: "status" })).toHaveLength(0);
  fetch.mockResolvedValueOnce(Response.json({ outcomes: [outcome({ phase: "failed", acknowledgedAt: "2026-09-09T13:00:00Z" })] }));
  await act(async () => { browser.dispatchEvent(new Event("focus")); });
  expect(text(renderer.root)).toBe("");
});

test("no catalog change stays quiet through polling, focus and refresh", async () => {
  const { renderer, browser } = await render([]);
  await advance(9000);
  await act(async () => { browser.dispatchEvent(new Event("focus")); });
  expect(text(renderer.root)).toBe("");
  await act(() => renderer.unmount());
  const refreshed = await mount();
  expect(text(refreshed.root)).toBe("");
});

test("a new catalog activation notifies a connected user", async () => {
  const { renderer, fetch, browser } = await render([]);
  fetch.mockResolvedValueOnce(Response.json({ outcomes: [outcome({ jobId: "usda-new", operation: "update" })] }));
  await act(async () => { browser.dispatchEvent(new Event("focus")); });
  expect(text(renderer.root)).toBe("USDA Foundation catalog updated.");
});

test("a new event produces a brief accessible toast, expires and stays dismissed after polls and reload", async () => {
  const { renderer, fetch, browser } = await render([]);
  fetch.mockImplementation(async () => Response.json({ outcomes: [outcome()] }));
  await advance(3000);
  expect(text(renderer.root)).toBe("USDA Foundation catalog updated.");
  expect(renderer.root.findByProps({ role: "status" }).props).toMatchObject({ "aria-live": "polite", "aria-atomic": "true" });
  expect(renderer.root.findAllByType("details")).toHaveLength(0);
  await advance(5819);
  expect(renderer.root.findByProps({ "data-phase": "succeeded" }).props["data-leaving"]).toBe(false);
  await advance(1);
  expect(renderer.root.findByProps({ "data-phase": "succeeded" }).props["data-leaving"]).toBe(true);
  await advance(180);
  expect(text(renderer.root)).toBe("");
  expect(renderer.root.findAllByProps({ role: "status" })).toHaveLength(0);
  await advance(9000);
  await act(async () => { browser.dispatchEvent(new Event("online")); });
  expect(text(renderer.root)).toBe("");
  await act(() => renderer.unmount());
  const reloaded = await mount();
  expect(text(reloaded.root)).toBe("");
  expect(fetch.mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
});

test("multiple outcomes are queued with distinct messages and a changed outcome can notify again", async () => {
  const { renderer, fetch, browser } = await render([
    outcome({ jobId: "interrupted", phase: "interrupted", installed: null }),
    outcome({ jobId: "failed", phase: "failed", error: "Internal archive details" }),
    outcome(),
  ]);
  expect(text(renderer.root)).toBe("USDA Foundation catalog updated.");
  await advance(6000);
  expect(text(renderer.root)).toBe("USDA Foundation import failed. Inspect the terminal and retry the command.");
  expect(renderer.root.findByProps({ "data-phase": "failed" })).toBeDefined();
  await act(() => { (renderer.root.findByType("button").props as { onClick: () => void }).onClick(); });
  expect(text(renderer.root)).toBe("USDA Foundation import interrupted. Inspect the terminal and retry the command.");
  await advance(6000);
  expect(text(renderer.root)).toBe("");
  fetch.mockResolvedValueOnce(Response.json({ outcomes: [outcome({ phase: "failed", completedAt: "2026-09-09T14:00:00Z" })] }));
  await act(async () => { browser.dispatchEvent(new Event("focus")); });
  expect(text(renderer.root)).toBe("USDA Foundation import failed. Inspect the terminal and retry the command.");
});

test("hovering and keyboard focus keep a toast visible until the reader leaves", async () => {
  const { renderer } = await render([outcome()]);
  type ToastEvents = {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocusCapture: () => void;
    onBlurCapture: (event: { currentTarget: { contains: () => boolean }; relatedTarget: object | null }) => void;
  };
  const toast = () => renderer.root.findByProps({ "data-phase": "succeeded" }).props as ToastEvents;
  await act(() => toast().onMouseEnter());
  await advance(12000);
  expect(text(renderer.root)).toBe("USDA Foundation catalog updated.");
  await act(() => { toast().onFocusCapture(); toast().onMouseLeave(); });
  await advance(12000);
  expect(text(renderer.root)).toBe("USDA Foundation catalog updated.");
  await act(() => toast().onBlurCapture({ currentTarget: { contains: () => true }, relatedTarget: {} }));
  await advance(6000);
  expect(text(renderer.root)).toBe("USDA Foundation catalog updated.");
  await act(() => toast().onBlurCapture({ currentTarget: { contains: () => false }, relatedTarget: null }));
  await advance(6000);
  expect(text(renderer.root)).toBe("");
});

test("failed polling is quiet, reconnects and does not repeat an expired event", async () => {
  const { renderer, fetch, browser } = await render([outcome()]);
  fetch.mockRejectedValueOnce(new Error("offline"));
  await act(async () => { browser.dispatchEvent(new Event("online")); });
  expect(text(renderer.root)).toBe("USDA Foundation catalog updated.");
  fetch.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
  await act(async () => { browser.dispatchEvent(new Event("focus")); });
  await advance(6000);
  expect(text(renderer.root)).toBe("");
  await act(async () => { browser.dispatchEvent(new Event("online")); });
  expect(text(renderer.root)).toBe("");
});

test("unavailable storage does not break expiry or in-memory deduplication", async () => {
  const { renderer, browser } = await render([]);
  Object.defineProperty(browser, "localStorage", { get: () => { throw new Error("storage disabled"); } });
  Object.defineProperty(browser, "sessionStorage", { get: () => { throw new Error("storage disabled"); } });
  const fetch = vi.mocked(globalThis.fetch);
  fetch.mockImplementation(async () => Response.json({ outcomes: [outcome()] }));
  await advance(3000);
  expect(text(renderer.root)).toBe("USDA Foundation catalog updated.");
  await advance(12000);
  expect(text(renderer.root)).toBe("");
});

test("an unmounted toast ignores a late poll and removes its timers", async () => {
  const { renderer, fetch, browser } = await render([]);
  let resolve!: (response: Response) => void;
  fetch.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  await act(async () => { browser.dispatchEvent(new Event("focus")); });
  await act(async () => { browser.dispatchEvent(new Event("online")); });
  expect(fetch).toHaveBeenCalledTimes(2);
  await act(() => renderer.unmount());
  await act(async () => { resolve(Response.json({ outcomes: [outcome()] })); });
  expect(vi.getTimerCount()).toBe(0);
});


test("first activation announces installation with only public notification fields", async () => {
  const { renderer } = await render([outcome({ operation: "install" })]);
  expect(text(renderer.root)).toBe("USDA Foundation catalog installed.");
});

test("shared acknowledgement cannot suppress success and displaying deduplicates even before dismissal on refresh", async () => {
  const { renderer } = await render([outcome({ operation: "update", acknowledgedAt: "2026-09-09T13:00:00Z" })]);
  expect(text(renderer.root)).toBe("USDA Foundation catalog updated.");
  await act(() => renderer.unmount());
  const refreshed = await mount();
  expect(text(refreshed.root)).toBe("");
});

test("a catalog update delivered ten days ago stays quiet through repeated refreshes", async () => {
  vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));
  const { renderer, browser } = await render([outcome({ completedAt: "2026-09-05T12:00:00Z", operation: "update" })]);
  expect(text(renderer.root)).toBe("USDA Foundation catalog updated.");
  await act(() => renderer.unmount());
  vi.setSystemTime(new Date("2026-09-15T12:00:00Z"));
  let refreshedSession = new Map<string, string>();
  Object.defineProperty(browser, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => refreshedSession.get(key) ?? null,
      setItem: (key: string, value: string) => { refreshedSession.set(key, value); },
    },
  });
  const firstRefresh = await mount();
  expect(text(firstRefresh.root)).toBe("");
  await act(() => firstRefresh.unmount());
  refreshedSession = new Map<string, string>();
  const secondRefresh = await mount();
  expect(text(secondRefresh.root)).toBe("");
});

test("refresh does not advance through a backlog of catalog success outcomes", async () => {
  const { renderer } = await render([
    outcome({ jobId: "usda-update", operation: "update" }),
    outcome({ jobId: "usda-failure", phase: "failed", completedAt: "2026-09-09T13:00:00Z" }),
  ]);
  expect(text(renderer.root)).toBe("USDA Foundation import failed. Inspect the terminal and retry the command.");
  await act(() => renderer.unmount());
  const refreshed = await mount();
  expect(text(refreshed.root)).toBe("");
});

test("only the newest successful version of each catalog is queued", async () => {
  const { renderer } = await render([
    outcome({ jobId: "new-version", completedAt: "2026-09-09T14:00:00Z", operation: "update" }),
    outcome({ jobId: "old-version", completedAt: "2026-09-09T12:00:00Z", operation: "install" }),
  ]);
  expect(text(renderer.root)).toBe("USDA Foundation catalog updated.");
  await act(() => { (renderer.root.findByType("button").props as { onClick: () => void }).onClick(); });
  expect(text(renderer.root)).toBe("");
});

test("delivery receipts are isolated between signed-in users in the same browser", async () => {
  const { renderer } = await render([outcome({ operation: "update" })]);
  expect(text(renderer.root)).toBe("USDA Foundation catalog updated.");
  await act(() => renderer.unmount());
  const otherUser = await mount(8);
  expect(text(otherUser.root)).toBe("USDA Foundation catalog updated.");
});
