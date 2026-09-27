import { createElement } from "react";
import { createRoutesStub } from "react-router";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, test } from "vitest";
import OAuthConsent from "../../app/routes/oauth.authorize";
import OAuthClientsSettings from "../../app/routes/settings.oauth-clients";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function renderRoute(Component: (props: never) => React.JSX.Element | null, path: string, loaderData: object, actionData?: object, initialEntry = path) {
  const Routes = createRoutesStub([{ path, id: "subject", Component: Component as never }]);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(Routes, {
      initialEntries: [initialEntry],
      hydrationData: {
        loaderData: { subject: loaderData },
        actionData: actionData ? { subject: actionData } : undefined,
      },
    }));
  });
  return renderer;
}

function visibleText(renderer: ReactTestRenderer) {
  return renderer.root.findAll((node) => typeof node.type === "string")
    .flatMap((node) => node.children)
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

test("consent names the client and read permission before approval or denial", async () => {
  const renderer = await renderRoute(OAuthConsent, "/oauth/authorize", {
    client: { id: "public-client-id", name: "Daily Log CLI" },
    permission: "Read your daily Food Log", scope: "daily-log:read",
    csrfToken: "csrf-token", action: "/oauth/authorize?client_id=public-client-id",
  });
  const content = visibleText(renderer);
  expect(content).toContain("Daily Log CLI");
  expect(content).toContain("read your daily food log");
  expect(content).toContain("cannot edit your Food Log");
  expect(renderer.root.findAllByType("button").map((button) => button.props.value as string)).toEqual(["approve", "deny"]);
  await act(() => renderer.unmount());
});

test("account settings review client IDs and show registration validation feedback", async () => {
  const client = {
    id: "public-client-id", name: "Daily Log CLI", type: "public" as const,
    redirectUris: ["http://127.0.0.1:4567/callback"], createdAt: "2026-09-26T12:00:00.000Z",
  };
  const renderer = await renderRoute(OAuthClientsSettings, "/settings/oauth-clients", {
    csrfToken: "csrf-token", clients: [client], connections: [], view: "list",
  });
  const content = visibleText(renderer);
  expect(content).toContain(client.name);
  expect(content).toContain(client.id);
  expect(content).toContain(client.redirectUris[0]);
  expect(content).toContain("No client secret");
  expect(content).toContain("Register client");
  expect(renderer.root.findAllByProps({ name: "intent", value: "register" })).toHaveLength(0);
  await act(() => renderer.unmount());

  const empty = await renderRoute(OAuthClientsSettings, "/settings/oauth-clients", {
    csrfToken: "csrf-token", clients: [], connections: [], view: "new",
  }, { errors: { name: "Enter a name of 1 to 80 printable characters.", redirectUris: "Enter one to ten redirect URIs, one per line." } }, "/settings/oauth-clients?view=new");
  expect(visibleText(empty)).toContain("Register a client");
  expect(empty.root.findAllByProps({ role: "alert" })).toHaveLength(2);
  expect(empty.root.findAllByProps({ name: "intent", value: "register" })).toHaveLength(1);
  await act(() => empty.unmount());

  const failed = await renderRoute(OAuthClientsSettings, "/settings/oauth-clients", {
    csrfToken: "csrf-token", clients: [], connections: [], view: "new",
  }, { error: "The client could not be registered. Please try again." }, "/settings/oauth-clients?view=new");
  expect(visibleText(failed)).toContain("The client could not be registered.");
  await act(() => failed.unmount());
});

test("account settings show connected clients, their permission, and revoke controls", async () => {
  const clientId = "a".repeat(32);
  const renderer = await renderRoute(OAuthClientsSettings, "/settings/oauth-clients", {
    csrfToken: "csrf-token", clients: [], view: "list",
    connections: [{ clientId, name: "Phone app", scope: "daily-log:read", connectedAt: "2026-09-26T12:00:00.000Z" }],
  });
  const content = visibleText(renderer);
  expect(content).toContain("Connected clients");
  expect(content).toContain("Phone app");
  expect(content).toContain("Read your daily Food Log");
  expect(renderer.root.findAllByType("button").map((button) => button.children.join(""))).toContain("Revoke Phone app");
  expect(renderer.root.findAllByProps({ name: "clientId", value: clientId })).toHaveLength(1);
  await act(() => renderer.unmount());
});

test("confidential registration displays the secret once while the ordinary client list omits it", async () => {
  const client = {
    id: "c".repeat(32), name: "Server reader", type: "confidential" as const,
    redirectUris: ["https://server.example/callback"], createdAt: "2026-09-26T12:00:00.000Z",
  };
  const secret = "s".repeat(43);
  const registered = await renderRoute(OAuthClientsSettings, "/settings/oauth-clients", {
    csrfToken: "csrf-token", clients: [client], connections: [], view: "new",
  }, { client, clientSecret: secret }, "/settings/oauth-clients?view=new");
  expect(visibleText(registered)).toContain("Client registered");
  expect(visibleText(registered)).toContain("View registered clients");
  expect(visibleText(registered)).toContain(client.id);
  expect(visibleText(registered)).toContain("Copy this secret now");
  expect(visibleText(registered)).toContain(secret);
  expect(registered.root.findAllByProps({ name: "intent", value: "register" })).toHaveLength(0);
  await act(() => registered.unmount());

  const listed = await renderRoute(OAuthClientsSettings, "/settings/oauth-clients", {
    csrfToken: "csrf-token", clients: [client], connections: [], view: "list",
  });
  expect(visibleText(listed)).toContain("Confidential server client");
  expect(visibleText(listed)).not.toContain(secret);
  await act(() => listed.unmount());
});
