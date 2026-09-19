import { createElement } from "react";
import { createMemoryRouter, createRoutesStub, RouterProvider, useLoaderData } from "react-router";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, test, vi } from "vitest";
import { SettingsDestinations } from "../../app/settings-destinations";
import AiSettings from "../../app/routes/settings.ai";
import type { PhotoAnalysisCredentialStatus } from "../../app/photo-analysis/credentials.server";
import type { PiConnectionService } from "../../app/photo-analysis/pi-connection.server";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const unconfigured: PhotoAnalysisCredentialStatus = { state: "unconfigured" };
const configured: PhotoAnalysisCredentialStatus = {
  state: "configured",
  configuredAt: "2026-09-19T16:00:00.000Z",
  updatedAt: "2026-09-19T16:00:00.000Z",
  validatedAt: "2026-09-19T16:00:00.000Z",
};
type Connection = Awaited<ReturnType<PiConnectionService["read"]>>;
const disconnected: Connection = { supported: true, connected: false, busy: false, error: undefined, attempt: undefined };
async function render(credentials: PhotoAnalysisCredentialStatus, actionData?: { area?: "credentials" | "pi"; error?: string; success?: string; fieldErrors?: { geminiKey?: string; typeSafeKey?: string } }, connection: Connection = disconnected) {
  const load = vi.fn(() => ({
    csrfToken: "test-csrf", username: "admin", today: "2026-09-19", credentials, connection,
  }));
  const Routes = createRoutesStub([{ path: "/settings/ai", id: "ai", Component: AiSettings, loader: load }]);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(Routes, {
      initialEntries: ["/settings/ai"],
      hydrationData: { loaderData: { ai: load() }, actionData: actionData ? { ai: actionData } : undefined },
    }));
  });
  return renderer;
}
function text(node: ReactTestRenderer["root"]): string {
  return node.children.map(child => typeof child === "string" ? child : text(child)).join("");
}
function buttons(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType("button").map(button => text(button));
}

test("unconfigured Settings accepts a bounded pair without repopulating either secret", async () => {
  const renderer = await render(unconfigured);
  expect(text(renderer.root)).toContain("Not configured");
  expect(text(renderer.root)).toContain("never shown again");
  expect(buttons(renderer)).toContain("Save credential pair");
  expect(buttons(renderer)).not.toContain("Delete credential pair");
  const secrets = renderer.root.findAllByType("input").filter(input => ["geminiKey", "typeSafeKey"].includes(String(input.props.name)));
  expect(secrets).toHaveLength(2);
  for (const secret of secrets) {
    expect(secret.props).toMatchObject({
      type: "password",
      autoComplete: "new-password",
      minLength: 16,
      maxLength: 512,
      required: true,
    });
    expect(secret.props.value).toBeUndefined();
    expect(secret.props.defaultValue).toBeUndefined();
  }
  expect(renderer.root.findAllByType("input").find(input => input.props.name === "csrfToken")?.props.value).toBe("test-csrf");
  await act(() => renderer.unmount());
});

test("configured Settings reports validation metadata and requires explicit deletion confirmation", async () => {
  const renderer = await render(configured);
  expect(text(renderer.root)).toContain("Configured");
  expect(text(renderer.root)).toContain("Last validated");
  expect(buttons(renderer)).toContain("Replace credential pair");
  expect(buttons(renderer)).toContain("Delete credential pair");
  const confirmation = renderer.root.findAllByType("input").find(input => input.props.name === "confirmation");
  expect(confirmation?.props).toMatchObject({ type: "checkbox", value: "delete", required: true });
  expect(text(renderer.root)).not.toContain("AIza");
  expect(text(renderer.root)).not.toContain("ts_live");
  await act(() => renderer.unmount());
});

test("unreadable and failed states explain recovery without exposing submitted values", async () => {
  const renderer = await render({
    state: "unreadable",
    configuredAt: "2026-09-18T12:00:00.000Z",
    updatedAt: "2026-09-18T12:00:00.000Z",
  }, {
    area: "credentials",
    error: "The credential pair could not be validated.",
    fieldErrors: { geminiKey: "Gemini rejected this key." },
  });
  expect(text(renderer.root)).toContain("Needs re-entry");
  expect(text(renderer.root)).toContain("Enter and validate both keys again");
  expect(text(renderer.root)).toContain("Gemini rejected this key");
  expect(renderer.root.findByProps({ name: "geminiKey" }).props).toMatchObject({
    "aria-invalid": true,
    "aria-describedby": "gemini-key-error",
  });
  expect(buttons(renderer)).toContain("Save credential pair");
  expect(buttons(renderer)).toContain("Delete credential pair");
  await act(() => renderer.unmount());
});

test("submitted controls stay disabled until credential mutation settles", async () => {
  const loaderData = { csrfToken: "test-csrf", username: "admin", today: "2026-09-19", credentials: configured, connection: disconnected };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const router = createMemoryRouter([{
    path: "/settings/ai",
    id: "ai",
    Component: () => createElement(AiSettings, { loaderData: useLoaderData(), actionData: undefined } as never),
    loader: () => loaderData,
    action: async () => { await gate; return {}; },
  }], { initialEntries: ["/settings/ai"], hydrationData: { loaderData: { ai: loaderData } } });
  let renderer!: ReactTestRenderer;
  await act(() => { renderer = create(createElement(RouterProvider, { router })); });
  const form = new FormData();
  form.set("intent", "save");
  let submitted!: Promise<void>;
  await act(async () => { submitted = router.navigate("/settings/ai", { formMethod: "post", formData: form }); });
  const controls = renderer.root.findAllByType("button").filter(button => button.props.name === "intent");
  expect(controls).toHaveLength(3);
  for (const button of controls) expect(button.props.disabled).toBe(true);
  expect(buttons(renderer)).toContain("Validating…");
  await act(async () => { release(); await submitted; });
  for (const button of renderer.root.findAllByType("button").filter(button => button.props.name === "intent")) expect(button.props.disabled).toBe(false);
  await act(() => renderer.unmount());
  router.dispose();
});

test("the active Pi connection controls remain available beside the encrypted credential form", async () => {
  const connected = await render(unconfigured, undefined, { ...disconnected, connected: true });
  expect(text(connected.root)).toContain("Active Pi analyzer");
  expect(buttons(connected)).toContain("Reconnect OpenAI");
  expect(buttons(connected)).toContain("Disconnect");
  await act(() => connected.unmount());

  const authorizationUrl = "https://auth.openai.com/oauth/authorize?state=test";
  const waiting = await render(unconfigured, undefined, {
    ...disconnected,
    busy: true,
    attempt: { id: "attempt-1", state: "waiting", authorizationUrl },
  });
  expect(text(waiting.root)).toContain("approve access with your OpenAI account");
  expect(buttons(waiting)).toContain("Cancel sign-in");
  const link = waiting.root.findAllByType("a").find(candidate => candidate.props.href === authorizationUrl);
  expect(link?.props).toMatchObject({ target: "_blank", rel: "noreferrer" });
  await act(() => waiting.unmount());
});

test.each([
  [{ ...disconnected, busy: true }, "another session", undefined],
  [{ ...disconnected, busy: true, attempt: { id: "1", state: "starting" } }, "Getting your secure OpenAI link", "Cancel sign-in"],
  [{ ...disconnected, busy: true, attempt: { id: "1", state: "disconnecting" } }, "Disconnecting", undefined],
  [{ ...disconnected, supported: false }, "does not support sign-in here", undefined],
  [{ ...disconnected, error: "Storage unavailable." }, "Storage unavailable.", "Connect OpenAI"],
  [{ ...disconnected, attempt: { id: "1", state: "cancelled" } }, "No active sign-in.", "Connect OpenAI"],
  [{ ...disconnected, connected: true, attempt: { id: "1", state: "cancelled" } }, "previous connection is still saved", "Reconnect OpenAI"],
] satisfies [Connection, string, string | undefined][])("Pi status remains understandable during the credential expand step: %j", async (connection, message, expectedButton) => {
  const renderer = await render(unconfigured, undefined, connection);
  expect(text(renderer.root)).toContain(message);
  if (expectedButton) expect(buttons(renderer)).toContain(expectedButton);
  await act(() => renderer.unmount());
});

test("Pi action conflicts remain scoped to the connection card", async () => {
  const renderer = await render(unconfigured, { area: "pi", error: "Already in progress." });
  const connection = renderer.root.findByProps({ "aria-labelledby": "connection-heading" });
  expect(text(connection)).toContain("Already in progress.");
  const credentials = renderer.root.findByProps({ "aria-labelledby": "credentials-heading" });
  expect(text(credentials)).not.toContain("Already in progress.");
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
