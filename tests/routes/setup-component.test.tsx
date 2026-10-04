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

function input(renderer: ReactTestRenderer, name: string) {
  return renderer.root.findAllByType("input").find((candidate) => candidate.props.name === name)!;
}

test("setup asks only for the time zone and the Daily Goal, with no units selector", async () => {
  expect(meta()).toEqual([
    { title: "Set up your Food Log · Open Calorie Tracker" },
    { name: "description", content: "Choose your time zone and set your Daily Goal" },
  ]);
  expect(headers()).toEqual({ "Cache-Control": "no-store" });
  const renderer = await renderSetup();
  expect(renderer.root.findAllByType("input").map((node) => node.props.name as string)).toEqual([
    "csrfToken",
    "timeZone",
    "calorieTarget",
    "waterTarget",
    "proteinTarget",
    "carbohydrateTarget",
    "fatTarget",
    "fiberTarget",
    "sugarMaximum",
    "sodiumMaximum",
  ]);
  expect(renderer.root.findAllByType("fieldset")).toHaveLength(0);
  expect(input(renderer, "csrfToken").props.value).toBe("component-csrf");
  expect(input(renderer, "timeZone").props.value).toBe(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  expect(input(renderer, "waterTarget").props).toMatchObject({
    defaultValue: "80",
    max: "500",
    min: "0.001",
    step: "0.001",
  });
  expect(input(renderer, "calorieTarget").props.defaultValue).toBe("2050");
  expect(input(renderer, "proteinTarget").props).toMatchObject({
    defaultValue: "120",
    max: "2000",
    min: "0.001",
    step: "0.001",
  });
  expect(input(renderer, "sodiumMaximum").props).toMatchObject({
    defaultValue: "2300",
    max: "100000",
    min: "1",
    step: "1",
  });
  for (const control of renderer.root.findAllByType("input")) {
    expect(control.props["aria-invalid"]).toBeUndefined();
  }
  expect(renderer.root.findAllByType("label")).toHaveLength(9);
  expect(renderer.root.findAllByType("em").map((node) => node.children.join("")))
    .toEqual(["kcal", "fl oz", "g", "g", "g", "g", "g", "mg"]);
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  renderer.unmount();
});

test("setup connects a time zone error to the time zone input only", async () => {
  const renderer = await renderSetup({ error: "timeZone failed", field: "timeZone" });
  expect(input(renderer, "timeZone").props).toMatchObject({
    "aria-describedby": "setup-error time-zone-help",
    "aria-invalid": true,
  });
  expect(renderer.root.findByProps({ id: "setup-error" }).children.join("")).toBe("timeZone failed");
  expect(input(renderer, "waterTarget").props["aria-invalid"]).toBeUndefined();
  renderer.unmount();
});

test("setup connects a goal error to that goal input only", async () => {
  const renderer = await renderSetup({ error: "waterTarget failed", field: "waterTarget" });
  expect(input(renderer, "waterTarget").props).toMatchObject({
    "aria-describedby": "daily-goal-error",
    "aria-invalid": true,
  });
  expect(renderer.root.findByProps({ id: "daily-goal-error" }).children.join("")).toBe("waterTarget failed");
  expect(input(renderer, "timeZone").props["aria-invalid"]).toBeUndefined();
  expect(input(renderer, "timeZone").props["aria-describedby"]).toBe("time-zone-help");
  expect(input(renderer, "proteinTarget").props["aria-invalid"]).toBeUndefined();
  expect(renderer.root.findAllByProps({ id: "setup-error" })).toHaveLength(0);
  renderer.unmount();
});

test("the time zone can be edited", async () => {
  const renderer = await renderSetup();
  await act(async () =>
    input(renderer, "timeZone").props.onChange({
      target: { value: "Pacific/Honolulu" },
    }),
  );
  expect(input(renderer, "timeZone").props.value).toBe("Pacific/Honolulu");
  renderer.unmount();
});
