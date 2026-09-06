import { createElement } from "react";
import { createRoutesStub } from "react-router";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, test, vi } from "vitest";
import AiSettings from "../../app/routes/settings.ai";
import type { PiConnectionService } from "../../app/photo-analysis/pi-connection.server";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Connection = Awaited<ReturnType<PiConnectionService["read"]>>;
const disconnected: Connection = { supported: true, connected: false, busy: false, error: undefined, attempt: undefined };
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
  await act(() => renderer.unmount());
});

test("waiting renders the one-time code and external approval link, polls, and only offers cancel", async () => {
  vi.useFakeTimers();
  const { renderer, load } = await render({ ...disconnected, busy: true, attempt: { id: "attempt-1", state: "waiting", userCode: "ABCD-1234", verificationUri: "https://auth.openai.com/codex/device" } });
  try {
    expect(text(renderer.root)).toContain("ABCD-1234");
    expect(buttons(renderer)).toContain("Cancel sign-in");
    expect(buttons(renderer)).not.toContain("Connect OpenAI");
    const link = renderer.root.findAllByType("a").find(link => link.props.href === "https://auth.openai.com/codex/device");
    expect(link?.props.target).toBe("_blank");
    expect(link?.props.rel).toBe("noreferrer");
    expect(renderer.root.findAllByType("input").find(input => input.props.name === "attemptId")?.props.value).toBe("attempt-1");
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(load).toHaveBeenCalledTimes(2);
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
  [{ ...disconnected, busy: true, attempt: { id: "1", state: "starting" } }, "Getting your sign-in code"],
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
