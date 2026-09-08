/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- react-test-renderer exposes host props as any */
import { createElement } from "react";
import { createRoutesStub } from "react-router";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, test } from "vitest";

import Setup, { meta, headers } from "../../app/routes/setup";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function renderSetup(
  actionData?: { error: string; field: string },
): Promise<ReactTestRenderer> {
  const Routes = createRoutesStub([
    { Component: Setup, id: "setup", path: "/setup" },
  ]);
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      createElement(Routes, {
        hydrationData: {
          actionData: actionData ? { setup: actionData } : undefined,
          loaderData: { setup: { csrfToken: "component-csrf" } },
        },
        initialEntries: ["/setup"],
      }),
    );
  });
  return renderer!;
}

function input(renderer: ReactTestRenderer, name: string, value?: string) {
  return renderer.root.findAllByType("input").find((candidate) =>
    candidate.props.name === name &&
    (value === undefined || candidate.props.value === value),
  )!;
}

test("setup renders the complete control contract", async () => {
  expect(meta()).toEqual([
    { title: "Set up your Food Log · Open Calorie Tracker" },
    { name: "description", content: "Choose display units and set your initial Food Log goals" },
  ]);
  expect(headers()).toEqual({ "Cache-Control": "no-store" });
  const renderer = await renderSetup();
  expect(input(renderer, "csrfToken").props.value).toBe("component-csrf");
  expect(input(renderer, "displayUnits", "us").props.checked).toBe(true);
  expect(input(renderer, "displayUnits", "metric").props.checked).toBe(false);
  expect(input(renderer, "displayUnits", "us").props["aria-invalid"])
    .toBeUndefined();
  expect(input(renderer, "displayUnits", "metric").props["aria-invalid"])
    .toBeUndefined();
  expect(input(renderer, "displayUnits", "us").props["aria-describedby"])
    .toBeUndefined();
  expect(input(renderer, "displayUnits", "metric").props["aria-describedby"])
    .toBeUndefined();
  expect(input(renderer, "timeZone").props.value).toBe(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  expect(input(renderer, "water").props).toMatchObject({
    max: "500",
    min: "0.001",
    step: "0.001",
    value: "80",
  });
  expect(input(renderer, "protein").props).toMatchObject({
    defaultValue: "120",
    max: "2000",
    min: "0.001",
    step: "0.001",
  });
  expect(input(renderer, "protein").props["aria-invalid"]).toBeUndefined();
  expect(input(renderer, "protein").props["aria-describedby"]).toBeUndefined();
  expect(input(renderer, "sodium").props).toMatchObject({
    defaultValue: "2300",
    max: "100000",
    min: "1",
    step: "1",
  });
  expect(renderer.root.findAllByType("label")).toHaveLength(11);
  expect(renderer.root.findAllByType("em").map((node) => node.children.join("")))
    .toEqual(["kcal", "fl oz", "g", "g", "g", "g", "g", "mg"]);
  renderer.unmount();
});

test.each([
  ["displayUnits", ["us", "metric"], "setup-error"],
  ["timeZone", [undefined], "setup-error time-zone-help"],
  ["water", [undefined], "setup-error"],
] as const)(
  "setup connects a %s error to exactly the affected controls",
  async (field, values, description) => {
    const renderer = await renderSetup({ error: `${field} failed`, field });
    const affected = values.map((value) => input(renderer, field, value));
    for (const control of affected) {
      expect(control.props["aria-invalid"]).toBe(true);
      expect(control.props["aria-describedby"]).toBe(description);
    }
    expect(
      renderer.root.findByProps({ id: "setup-error" }).children.join(""),
    ).toBe(`${field} failed`);
    if (field !== "displayUnits") {
      expect(input(renderer, "displayUnits", "us").props["aria-invalid"])
        .toBeUndefined();
    }
    if (field !== "timeZone") {
      expect(input(renderer, "timeZone").props["aria-invalid"]).toBeUndefined();
      expect(input(renderer, "timeZone").props["aria-describedby"]).toBe(
        "time-zone-help",
      );
    }
    expect(input(renderer, "protein").props["aria-invalid"]).toBeUndefined();
    expect(input(renderer, "protein").props["aria-describedby"])
      .toBeUndefined();
    renderer.unmount();
  },
);

test("unit controls update default water while preserving a customized draft", async () => {
  const renderer = await renderSetup();
  await act(async () => input(renderer, "displayUnits", "metric").props.onChange());
  expect(input(renderer, "displayUnits", "us").props.checked).toBe(false);
  expect(input(renderer, "displayUnits", "metric").props.checked).toBe(true);
  expect(input(renderer, "water").props).toMatchObject({
    max: "15000",
    value: "2366",
  });
  expect(renderer.root.findAllByType("em")[1].children.join("")).toBe("ml");

  await act(async () =>
    input(renderer, "water").props.onChange({ target: { value: "2600" } }),
  );
  await act(async () => input(renderer, "displayUnits", "us").props.onChange());
  expect(input(renderer, "displayUnits", "us").props.checked).toBe(true);
  expect(input(renderer, "displayUnits", "metric").props.checked).toBe(false);
  expect(input(renderer, "water").props.value).toBe("2600");

  await act(async () =>
    input(renderer, "timeZone").props.onChange({
      target: { value: "Pacific/Honolulu" },
    }),
  );
  expect(input(renderer, "timeZone").props.value).toBe("Pacific/Honolulu");
  renderer.unmount();
});
