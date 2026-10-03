import { createElement } from "react";
import { createRoutesStub } from "react-router";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, test } from "vitest";
import { parseApiKeyFields } from "../../app/api-keys/validation";
import ApiKeysSettings from "../../app/routes/settings.api-keys";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const key = {
  id: 7,
  name: "Muse",
  maskedKey: "oct_ab12••••9f3k",
  scopes: ["water-events:write"],
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

function scopeLabels(renderer: ReactTestRenderer) {
  return renderer.root.findAll((node) => node.type === "label" && node.findAll((child) => child.props.name === "scope").length > 0)
    .map((node) => node.children.filter((child) => typeof child === "string").join(""));
}

test("creating a key offers every permission, including Log water, as an unchecked, selectable scope", async () => {
  const renderer = await render({ ...loaderData, view: "new" }, "/settings/api-keys?view=new");
  const inputs = scopeInputs(renderer);
  expect(inputs).toContainEqual({ type: "checkbox", value: "daily-log:read", checked: false, disabled: false });
  expect(inputs).toContainEqual({ type: "checkbox", value: "water-events:write", checked: false, disabled: false });
  expect(inputs.every((input) => input.type === "checkbox" && !input.checked && !input.disabled)).toBe(true);
  expect(scopeLabels(renderer)).toEqual(expect.arrayContaining(["Read Food Log", "Log water"]));
  expect(JSON.stringify(renderer.toJSON())).not.toContain("coming soon");
  await act(() => renderer.unmount());
});

test("editing a key checks only the scopes it already has, so Log water can be granted or removed", async () => {
  const editing = { key, expiration: "never", expirations: [{ value: "never", label: "No expiration", expiresAt: null }] };
  const renderer = await render({ ...loaderData, view: "edit", editing }, "/settings/api-keys?view=edit&key=7");
  const inputs = scopeInputs(renderer);
  expect(inputs).toContainEqual({ type: "checkbox", value: "daily-log:read", checked: false, disabled: false });
  expect(inputs).toContainEqual({ type: "checkbox", value: "water-events:write", checked: true, disabled: false });
  expect(inputs.filter((input) => input.checked).map((input) => input.value)).toEqual(["water-events:write"]);
  await act(() => renderer.unmount());
});

test("a submission keeps exactly the scopes that were checked and requires at least one", () => {
  const form = (scopes: string[]) => {
    const data = new FormData();
    data.set("name", "Muse");
    data.set("expiration", "never");
    for (const scope of scopes) data.append("scope", scope);
    return parseApiKeyFields(data);
  };
  expect(form(["water-events:write"])).toEqual({ success: true, data: { name: "Muse", scopes: ["water-events:write"], expiration: "never" } });
  expect(form(["daily-log:read", "water-events:write"])).toEqual({ success: true, data: { name: "Muse", scopes: ["daily-log:read", "water-events:write"], expiration: "never" } });
  expect(form([])).toEqual({ success: false, errors: { scopes: "Choose at least one permission." } });
});

test("the at-least-one-permission error clears as soon as a permission is checked", async () => {
  const Routes = createRoutesStub([{ path: "/settings/api-keys", id: "subject", Component: ApiKeysSettings as never }]);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(Routes, {
      initialEntries: ["/settings/api-keys?view=new"],
      hydrationData: { loaderData: { subject: { ...loaderData, view: "new" } }, actionData: { subject: { errors: { scopes: "Choose at least one permission." } } } },
    }));
  });
  const alerts = () => renderer.root.findAll((node) => node.type === "p" && node.props.role === "alert").map((node) => node.children.join(""));
  expect(alerts()).toContain("Choose at least one permission.");

  const logWater = renderer.root.find((node) => node.type === "input" && node.props.value === "water-events:write");
  const check = logWater.props.onChange as (event: { currentTarget: { checked: boolean } }) => void;
  await act(async () => check({ currentTarget: { checked: true } }));
  expect(alerts()).not.toContain("Choose at least one permission.");

  await act(async () => check({ currentTarget: { checked: false } }));
  expect(alerts()).toContain("Choose at least one permission.");
  await act(() => renderer.unmount());
});
