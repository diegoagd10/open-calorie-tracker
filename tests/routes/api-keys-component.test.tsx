import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import ApiKeysSettings from "../../app/routes/settings.api-keys";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loaderData = {
  csrfToken: "csrf-token",
  isAdministrator: false,
  today: "2026-09-28",
  timeZone: "Pacific/Kiritimati",
  mcpUrl: "https://calories.example/mcp",
  apiUrl: "https://calories.example/api/v1/daily-log",
  view: "list",
  created: false,
  updated: false,
  deleted: false,
  keys: [{
    id: 7,
    name: "Muse",
    maskedKey: "oct_ab12••••9f3k",
    scopes: ["daily-log:read"],
    createdAt: "2026-09-28T11:30:00.000Z",
    expiresAt: "2026-12-27T11:30:00.000Z",
    lastUsedAt: null,
    expired: false,
  }],
};
const expiredKey = {
  id: 8,
  name: "Old laptop",
  maskedKey: "oct_zz99••••0000",
  scopes: ["daily-log:read"],
  createdAt: "2026-09-01T11:30:00.000Z",
  expiresAt: "2026-09-08T11:30:00.000Z",
  lastUsedAt: null,
  expired: true,
};

function labels(renderer: ReactTestRenderer) {
  return renderer.root.findAll((node) => typeof node.type === "string" && typeof node.props["aria-label"] === "string")
    .map((node) => node.props["aria-label"] as string);
}

function routes(data: object, initialEntry = "/settings/api-keys") {
  const Routes = createRoutesStub([{ path: "/settings/api-keys", id: "subject", Component: ApiKeysSettings as never }]);
  return createElement(Routes, { initialEntries: [initialEntry], hydrationData: { loaderData: { subject: data } } });
}

async function render(data: object, initialEntry?: string) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(routes(data, initialEntry));
  });
  return renderer;
}

function visibleText(renderer: ReactTestRenderer) {
  return renderer.root.findAll((node) => typeof node.type === "string")
    .flatMap((node) => node.children)
    .filter((value): value is string => typeof value === "string")
    .join("");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("the list shows masked keys with permissions and dates in the account's time zone, and one line of help", async () => {
  const renderer = await render(loaderData);
  const text = visibleText(renderer);
  expect(text).toContain("Muse");
  expect(text).toContain("oct_ab12••••9f3k");
  expect(text).toContain("Read Food Log");
  // 11:30 UTC is already the next day in Kiritimati (UTC+14).
  expect(text).toContain("Created Sep 29, 2026");
  expect(text).toContain("Expires Dec 28, 2026");
  expect(text).toContain("Last used —");
  expect(text).toContain("Authorization: Bearer <key>");
  expect(text).toContain("https://calories.example/mcp");
  expect(text).toContain("https://calories.example/api/v1/daily-log");
  const copyLabels = renderer.root.findAllByType("button")
    .map((button) => button.props["aria-label"] as string | undefined)
    .filter((label) => label?.startsWith("Copy"));
  expect(copyLabels).toEqual([
    "Copy bearer header", "Copy MCP URL", "Copy API URL", "Copy Muse",
  ]);
  await act(() => renderer.unmount());
});

test("copying a key posts the CSRF token, writes the response to the clipboard, and confirms without rendering the key", async () => {
  const fullKey = "oct_ab12cdefghijklmnopqrstuvwxyz0123456789ABC9f3k";
  const fetch = vi.fn(() => Promise.resolve(Response.json({ key: fullKey })));
  const writeText = vi.fn(() => Promise.resolve());
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("ClipboardItem", undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const renderer = await render(loaderData);
  await act(async () => {
    (renderer.root.findByProps({ "aria-label": "Copy Muse" }).props as { onClick: () => void }).onClick();
  });
  expect(fetch).toHaveBeenCalledWith("/settings/api-keys/copy", expect.objectContaining({ method: "POST" }));
  const body = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
  expect(Object.fromEntries(body)).toEqual({ csrfToken: "csrf-token", keyId: "7" });
  expect(writeText).toHaveBeenCalledWith(fullKey);
  expect(visibleText(renderer)).toContain("Copied");
  expect(visibleText(renderer)).not.toContain(fullKey);
  await act(() => renderer.unmount());
});

test("help values copy through a pending clipboard item, and a failed copy says so", async () => {
  const items: Array<Record<string, Promise<Blob>>> = [];
  class FakeClipboardItem {
    constructor(item: Record<string, Promise<Blob>>) {
      items.push(item);
    }
  }
  const write = vi.fn(() => Promise.resolve());
  vi.stubGlobal("ClipboardItem", FakeClipboardItem);
  vi.stubGlobal("navigator", { clipboard: { write } });
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 404 }))));
  const renderer = await render(loaderData);
  const click = async (label: string) => act(async () => {
    (renderer.root.findByProps({ "aria-label": label }).props as { onClick: () => void }).onClick();
  });
  await click("Copy MCP URL");
  expect(write).toHaveBeenCalledOnce();
  expect(await items[0]["text/plain"].then((blob) => blob.text())).toBe("https://calories.example/mcp");
  expect(visibleText(renderer)).toContain("Copied");

  write.mockImplementation(async () => {
    await items[1]["text/plain"];
  });
  await click("Copy Muse");
  expect(visibleText(renderer)).toContain("Could not copy");
  await act(() => renderer.unmount());
});

test("the create form offers the only permission checked and disabled, and the expiration presets defaulting to 90 days", async () => {
  const renderer = await render({ ...loaderData, view: "new" }, "/settings/api-keys?view=new");
  const checkbox = renderer.root.findByProps({ type: "checkbox" });
  expect(checkbox.props).toMatchObject({ checked: true, disabled: true });
  expect(renderer.root.findByProps({ type: "hidden", name: "scope" }).props.value).toBe("daily-log:read");
  expect(visibleText(renderer)).toContain("More permissions coming soon");
  const select = renderer.root.findByProps({ name: "expiration" });
  expect(select.props.defaultValue).toBe("90d");
  expect(select.findAllByType("option").map((option) => option.children.join(""))).toEqual([
    "1 day", "7 days", "30 days", "90 days", "1 year", "No expiration",
  ]);
  expect(renderer.root.findAllByProps({ type: "date" })).toHaveLength(0);
  await act(() => renderer.unmount());
});

test("server-rendered HTML never contains a full key", () => {
  const html = renderToString(routes(loaderData));
  expect(html).toContain("oct_ab12••••9f3k");
  expect(html).not.toMatch(/oct_[A-Za-z0-9_-]{43}/u);
});

test("each live key offers copy, edit, and delete, while an expired key is marked expired and offers only delete", async () => {
  const renderer = await render({ ...loaderData, keys: [...loaderData.keys, expiredKey] });
  expect(labels(renderer).filter((label) => /Muse|Old laptop/u.test(label))).toEqual([
    "Copy Muse", "Edit Muse", "Delete Muse", "Delete Old laptop",
  ]);
  const href = (label: string) => renderer.root.find((node) => node.type === "a" && node.props["aria-label"] === label).props.href as string;
  expect(href("Edit Muse")).toBe("/settings/api-keys?view=edit&key=7");
  expect(href("Delete Old laptop")).toBe("/settings/api-keys?view=delete&key=8");
  const text = visibleText(renderer);
  expect(text).toContain("Old laptopExpired");
  expect(text).toContain("Expired Sep 9, 2026");
  await act(() => renderer.unmount());
});

test("the edit form keeps the key's name and preset, and shows each remaining preset's date in the account's time zone", async () => {
  const [key] = loaderData.keys;
  const editing = {
    key,
    expiration: "90d",
    expirations: [
      { value: "90d", label: "90 days", expiresAt: "2026-12-27T11:30:00.000Z" },
      { value: "1y", label: "1 year", expiresAt: "2027-09-28T11:30:00.000Z" },
      { value: "never", label: "No expiration", expiresAt: null },
    ],
  };
  const renderer = await render({ ...loaderData, view: "edit", editing }, "/settings/api-keys?view=edit&key=7");
  expect(visibleText(renderer)).toContain("Edit Muse");
  expect(renderer.root.findByProps({ name: "name" }).props.defaultValue).toBe("Muse");
  expect(renderer.root.findByProps({ name: "intent" }).props.value).toBe("update");
  expect(renderer.root.findByProps({ name: "keyId" }).props.value).toBe(7);
  expect(renderer.root.findByProps({ type: "checkbox" }).props).toMatchObject({ checked: true, disabled: true });
  const select = renderer.root.findByProps({ name: "expiration" });
  expect(select.props.defaultValue).toBe("90d");
  expect(select.findAllByType("option").map((option) => option.children.join(""))).toEqual([
    "90 days · Dec 28, 2026", "1 year · Sep 29, 2027", "No expiration",
  ]);
  await act(() => renderer.unmount());
});

test("deleting asks for confirmation naming the key", async () => {
  const renderer = await render({ ...loaderData, view: "delete", deleting: { id: 7, name: "Muse" } }, "/settings/api-keys?view=delete&key=7");
  expect(visibleText(renderer)).toContain("Delete Muse?");
  expect(visibleText(renderer)).toContain("stops working immediately");
  expect(renderer.root.findByProps({ name: "intent" }).props.value).toBe("delete");
  expect(renderer.root.findByProps({ name: "keyId" }).props.value).toBe(7);
  expect(renderer.root.findAllByProps({ type: "submit" }).map((button) => button.children.join(""))).toContain("Delete key");
  await act(() => renderer.unmount());
});

test("the list confirms edits and deletions", async () => {
  for (const [flags, notice] of [[{ updated: true }, "API key updated."], [{ deleted: true }, "API key deleted."]] as const) {
    const renderer = await render({ ...loaderData, ...flags });
    expect(renderer.root.findByProps({ role: "status" }).children.join("")).toBe(notice);
    await act(() => renderer.unmount());
  }
});
