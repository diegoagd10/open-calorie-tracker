import { createElement } from "react";
import { createRoutesStub } from "react-router";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, test, vi } from "vitest";
import { parseApiKeyFields } from "../../app/api-keys/validation";
import ApiKeysSettings from "../../app/routes/settings.api-keys";

// Once a second permission exists, the form must stop granting every scope implicitly.
vi.mock("../../app/api-keys/presets", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../app/api-keys/presets")>(),
  API_KEY_SCOPES: [
    { scope: "daily-log:read", label: "Read Food Log" },
    { scope: "daily-log:write", label: "Write Food Log" },
  ],
  isApiKeyScope: (value: string) => value === "daily-log:read" || value === "daily-log:write",
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const key = {
  id: 7,
  name: "Muse",
  maskedKey: "oct_ab12••••9f3k",
  scopes: ["daily-log:write"],
  createdAt: "2026-09-28T11:30:00.000Z",
  expiresAt: null,
  lastUsedAt: null,
  expired: false,
};
const loaderData = {
  csrfToken: "csrf-token",
  isAdministrator: false,
  today: "2026-09-28",
  timeZone: "UTC",
  mcpUrl: "https://calories.example/mcp",
  apiUrl: "https://calories.example/api/v1/daily-log",
  created: false,
  updated: false,
  deleted: false,
  keys: [key],
};

async function render(data: object, initialEntry: string) {
  const Routes = createRoutesStub([{ path: "/settings/api-keys", id: "subject", Component: ApiKeysSettings as never }]);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(Routes, { initialEntries: [initialEntry], hydrationData: { loaderData: { subject: data } } }));
  });
  return renderer;
}

function scopeInputs(renderer: ReactTestRenderer) {
  return renderer.root.findAll((node) => node.type === "input" && node.props.name === "scope")
    .map((node) => ({ type: node.props.type as string, value: node.props.value as string, checked: node.props.defaultChecked as boolean, disabled: Boolean(node.props.disabled) }));
}

test("with several permissions, creating a key offers each as an unchecked, selectable scope", async () => {
  const renderer = await render({ ...loaderData, view: "new" }, "/settings/api-keys?view=new");
  expect(scopeInputs(renderer)).toEqual([
    { type: "checkbox", value: "daily-log:read", checked: false, disabled: false },
    { type: "checkbox", value: "daily-log:write", checked: false, disabled: false },
  ]);
  expect(renderer.root.findAll((node) => node.type === "small").map((node) => node.children.join(""))).not.toContain("More permissions coming soon");
  await act(() => renderer.unmount());
});

test("with several permissions, editing a key checks only the scopes it already has", async () => {
  const editing = { key, expiration: "never", expirations: [{ value: "never", label: "No expiration", expiresAt: null }] };
  const renderer = await render({ ...loaderData, view: "edit", editing }, "/settings/api-keys?view=edit&key=7");
  expect(scopeInputs(renderer)).toEqual([
    { type: "checkbox", value: "daily-log:read", checked: false, disabled: false },
    { type: "checkbox", value: "daily-log:write", checked: true, disabled: false },
  ]);
  await act(() => renderer.unmount());
});

test("with several permissions, a submission keeps exactly the scopes that were checked", () => {
  const form = (scopes: string[]) => {
    const data = new FormData();
    data.set("name", "Muse");
    data.set("expiration", "never");
    for (const scope of scopes) data.append("scope", scope);
    return parseApiKeyFields(data);
  };
  expect(form(["daily-log:write"])).toEqual({ success: true, data: { name: "Muse", scopes: ["daily-log:write"], expiration: "never" } });
  expect(form([])).toEqual({ success: false, errors: { scopes: "Choose at least one permission." } });
});
