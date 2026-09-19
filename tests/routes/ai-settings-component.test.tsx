import { createElement } from "react";
import { createMemoryRouter, createRoutesStub, RouterProvider, useLoaderData } from "react-router";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, test, vi } from "vitest";
import { SettingsDestinations } from "../../app/settings-destinations";
import AiSettings from "../../app/routes/settings.ai";
import type { PiConnectionService } from "../../app/photo-analysis/pi-connection.server";
import { ProviderPipelineDemoView } from "../../app/photo-analysis/provider-pipeline-demo";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Connection = Awaited<ReturnType<PiConnectionService["read"]>>;
const disconnected: Connection = { supported: true, connected: false, busy: false, error: undefined, attempt: undefined };
const authorizationUrl = "https://auth.openai.com/oauth/authorize?response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&state=test-state&code_challenge=test-challenge";
async function render(connection: Connection, actionError?: string) {
  const load = vi.fn(() => ({
    csrfToken: "test-csrf", username: "admin", today: "2026-09-06", connection,
  }));
  const Routes = createRoutesStub([{ path: "/settings/ai", id: "ai", Component: AiSettings, loader: load }]);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(Routes, {
      initialEntries: ["/settings/ai"],
      hydrationData: { loaderData: { ai: load() }, actionData: actionError ? { ai: { error: actionError } } : undefined },
    }));
  });
  return { renderer, load };
}
function text(node: ReactTestRenderer["root"]): string {
  return node.children.map(child => typeof child === "string" ? child : text(child)).join("");
}
function buttons(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType("button").map(button => text(button));
}

test("Settings explains the shared connection, links to the other settings and offers sign-in", async () => {
  const { renderer } = await render(disconnected);
  expect(text(renderer.root)).toContain("Not connected");
  expect(text(renderer.root)).toContain("everyone on this tracker");
  expect(buttons(renderer)).toContain("Connect OpenAI");
  expect(buttons(renderer)).not.toContain("Disconnect");
  expect(renderer.root.findAllByType("a").map(link => String(link.props.href))).toContain("/settings/goals");
  expect(renderer.root.findAllByType("input").find(input => input.props.name === "csrfToken")?.props.value).toBe("test-csrf");
  expect(text(renderer.root.findByProps({ role: "status" }))).toBe("");
  expect(renderer.root.findAllByType("button").find(button => text(button) === "Connect OpenAI")?.props.value).toBe("connect");
  expect(renderer.root.findAllByType("input").find(input => input.props.name === "attemptId")?.props.value).toBe("");
  await act(() => renderer.unmount());
});

test("waiting renders browser authorization without any manual code or token input, polls, and only offers cancel", async () => {
  vi.useFakeTimers();
  const { renderer, load } = await render({ ...disconnected, busy: true, attempt: { id: "attempt-1", state: "waiting", authorizationUrl } });
  try {
    expect(text(renderer.root)).toContain("approve access with your OpenAI account");
    expect(text(renderer.root)).toContain("No device-code login setting is required");
    expect(buttons(renderer)).toContain("Cancel sign-in");
    expect(buttons(renderer)).not.toContain("Finish authorization");
    expect(renderer.root.findAllByType("button").find(button => text(button) === "Cancel sign-in")?.props.value).toBe("cancel");
    expect(buttons(renderer)).not.toContain("Connect OpenAI");
    const link = renderer.root.findAllByType("a").find(link => link.props.href === authorizationUrl);
    expect(link?.props.target).toBe("_blank");
    expect(link?.props.rel).toBe("noreferrer");
    expect(renderer.root.findAllByProps({ name: "authorizationResponse" })).toHaveLength(0);
    expect(text(renderer.root)).not.toContain("copy its complete address");
    expect(renderer.root.findAllByType("input").find(input => input.props.name === "attemptId")?.props.value).toBe("attempt-1");
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(load).toHaveBeenCalledTimes(2);
    await act(() => renderer.unmount());
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    await act(() => renderer.unmount());
    vi.useRealTimers();
  }
});

test.each([
  [{ ...disconnected, connected: true }, "Connected", "Reconnect OpenAI"],
  [{ ...disconnected, attempt: { id: "1", state: "failed", error: "Try connecting again." } }, "Try connecting again.", "Connect OpenAI"],
  [{ ...disconnected, connected: true, attempt: { id: "1", state: "cancelled" } }, "Your previous connection is still saved.", "Reconnect OpenAI"],
  [{ ...disconnected, attempt: { id: "1", state: "cancelled" } }, "No active sign-in.", "Connect OpenAI"],
] satisfies [Connection, string, string][])("connected and terminal states expose the appropriate recovery actions: %j", async (connection, message, button) => {
  const { renderer } = await render(connection);
  expect(text(renderer.root)).toContain(message);
  expect(buttons(renderer)).toContain(button);
  expect(buttons(renderer).includes("Disconnect")).toBe(connection.connected);
  await act(() => renderer.unmount());
});

test.each([
  [{ ...disconnected, busy: true }, "another session"],
  [{ ...disconnected, busy: true, attempt: { id: "1", state: "starting" } }, "Getting your secure OpenAI link"],
  [{ ...disconnected, busy: true, attempt: { id: "1", state: "disconnecting" } }, "Disconnecting"],
  [{ ...disconnected, supported: false }, "does not support sign-in here"],
  [{ ...disconnected, error: "Storage unavailable." }, "Storage unavailable."],
] satisfies [Connection, string][])("status remains understandable while setup is unavailable: %j", async (connection, message) => {
  const { renderer } = await render(connection);
  expect(text(renderer.root)).toContain(message);
  await act(() => renderer.unmount());
});

test("action conflicts are visible", async () => {
  const { renderer } = await render(disconnected, "Already in progress.");
  expect(text(renderer.root.findByProps({ role: "alert" }))).toBe("Already in progress.");
  await act(() => renderer.unmount());
});

test("provider experiment compares one photo across three product previews", async () => {
  const product = {
    name: "Egg plate", assumptions: ["Portion estimated visually"],
    totals: { energyKcal: 210, proteinGrams: 14, carbohydrateGrams: 2, fatGrams: 15, fiberGrams: 0, sugarGrams: 0, sodiumMilligrams: 220 },
    components: [{ name: "fried eggs", quantity: 100, unit: "g" as const, source: "USDA 171288", energyKcal: 210, proteinGrams: 14, carbohydrateGrams: 2, fatGrams: 15 }],
  };
  const demo = {
    totalElapsedMs: 2_300,
    pipelines: [
      { id: "pi" as const, label: "Current Pi", model: "Configured Pi photo model", elapsedMs: 2_300, status: "succeeded" as const, product },
      { id: "gemini" as const, label: "Gemini", model: "gemini-3.1-flash-lite", elapsedMs: 800, status: "succeeded" as const, product },
      { id: "gemini-jev" as const, label: "Gemini + Jev", model: "gemini-3.1-flash-lite + jev-1.13.0", elapsedMs: 1_000, status: "succeeded" as const, product, matches: [{ observed: "fried eggs", selected: "Egg, whole, cooked, fried", confidence: .91, source: "usda" as const }] },
    ],
  };
  const Routes = createRoutesStub([{ path: "/", Component: () => <ProviderPipelineDemoView actionData={{ demo }} csrfToken="test-csrf" piConnected status={{ geminiConfigured: true, jevConfigured: true, ready: true }} /> }]);
  let renderer!: ReactTestRenderer;
  await act(() => { renderer = create(createElement(Routes)); });
  const rendered = text(renderer.root);
  expect(rendered).toContain("One photo, three pipelines");
  expect(rendered).toContain("Current Pi");
  expect(rendered).toContain("Gemini + Jev");
  expect(rendered).toContain("What each pipeline would create");
  expect(rendered.match(/210/g)).toHaveLength(6);
  expect(buttons(renderer)).toContain("Compare all three");
  expect(renderer.root.findAllByType("input").find(input => input.props.name === "photo")?.props.accept).toContain("image/jpeg");
  await act(() => renderer.unmount());
});

test("development settings route opens the functional provider experiment", async () => {
  const loaderData = {
    csrfToken: "test-csrf",
    username: "admin",
    today: "2026-09-06",
    connection: disconnected,
    providerPrototypeEnabled: true,
    providerDemo: {
      geminiConfigured: true,
      jevConfigured: true,
      ready: true,
    },
  };
  const Routes = createRoutesStub([{
    path: "/settings/ai",
    id: "ai",
    Component: AiSettings,
    loader: () => loaderData,
  }]);
  let renderer!: ReactTestRenderer;
  await act(() => {
    renderer = create(createElement(Routes, {
      initialEntries: ["/settings/ai?prototype=providers"],
      hydrationData: { loaderData: { ai: loaderData } },
    }));
  });
  expect(text(renderer.root)).toContain("One photo, three pipelines");
  expect(text(renderer.root)).not.toContain("Connect OpenAI");
  await act(() => renderer.unmount());
});


test.each([
  ["goals", true, ["/settings/catalogs", "/settings/ai", "/settings/users", "/settings/security"]],
  ["users", true, ["/settings/goals", "/settings/catalogs", "/settings/ai", "/settings/security"]],
  ["ai", true, ["/settings/goals", "/settings/catalogs", "/settings/users", "/settings/security"]],
  ["catalogs", true, ["/settings/goals", "/settings/ai", "/settings/users", "/settings/security"]],
  ["goals", false, ["/settings/security"]],
] as const)("Settings destinations for %s respect administrator access (%s)", async (active, isAdministrator, expected) => {
  const Routes = createRoutesStub([{ path: "/", Component: () => <SettingsDestinations active={active} isAdministrator={isAdministrator} csrfToken="nav-csrf" /> }]);
  let renderer!: ReactTestRenderer;
  await act(() => { renderer = create(createElement(Routes)); });
  expect(renderer.root.findAllByType("a").map(link => String(link.props.href))).toEqual(expected);
  await act(() => renderer.unmount());
});

test.each([false, true])("connection controls stay disabled until a submitted action settles (waiting=%s)", async waiting => {
  const connection: Connection = waiting ? { ...disconnected, busy: true, attempt: { id: "pending-id", state: "waiting", authorizationUrl } } : { ...disconnected, connected: true };
  const data = { csrfToken: "test-csrf", username: "admin", today: "2026-09-06", connection };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const router = createMemoryRouter([{ path: "/settings/ai", id: "ai", Component: () => createElement(AiSettings, { loaderData: useLoaderData(), actionData: undefined } as never), loader: () => data, action: async () => { await gate; return {}; } }], { initialEntries: ["/settings/ai"], hydrationData: { loaderData: { ai: data } } });
  let renderer!: ReactTestRenderer;
  await act(() => { renderer = create(createElement(RouterProvider, { router })); });
  const form = new FormData();
  form.set("intent", waiting ? "cancel" : "connect");
  let submitted!: Promise<void>;
  await act(async () => { submitted = router.navigate("/settings/ai", { formMethod: "post", formData: form }); });
  const controls = renderer.root.findAllByType("button").filter(button => button.props.name === "intent");
  expect(controls.length).toBe(waiting ? 1 : 2);
  for (const button of controls) expect(button.props.disabled).toBe(true);
  if (!waiting) expect(buttons(renderer)).toContain("Please wait…");
  await act(async () => { release(); await submitted; });
  for (const button of renderer.root.findAllByType("button").filter(button => button.props.name === "intent")) expect(button.props.disabled).toBe(false);
  await act(() => renderer.unmount());
  router.dispose();
});

test("non-pending settings do not poll and other-session/disconnecting states offer no cancellation", async () => {
  vi.useFakeTimers();
  try {
    const { renderer, load } = await render(disconnected);
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(load).toHaveBeenCalledTimes(1);
    await act(() => renderer.unmount());
    for (const attempt of [undefined, { id: "disconnect", state: "disconnecting" as const }]) {
      const { renderer } = await render({ ...disconnected, busy: true, attempt });
      expect(buttons(renderer)).not.toContain("Cancel sign-in");
      expect(buttons(renderer)).not.toContain("Connect OpenAI");
      const status = text(renderer.root.findByProps({ role: "status" }));
      expect(status).toBe(attempt ? "Disconnecting…" : "A sign-in is in progress in another session.");
      await act(() => renderer.unmount());
    }
  } finally { vi.useRealTimers(); }
});
