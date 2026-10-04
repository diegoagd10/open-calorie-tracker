import { createElement } from "react";
import { createRoutesStub } from "react-router";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, test } from "vitest";

import Goals, {
  headers,
  meta,
} from "../../app/daily-goal/routes/settings.goals";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const loaderData = {
  csrfToken: "goals-csrf",
  isAdministrator: false,
  today: "2026-08-31",
  username: "goal.owner",
  values: {
    calorieTarget: "2050",
    waterTarget: "67.628",
    proteinTarget: "120",
    carbohydrateTarget: "230",
    fatTarget: "70",
    fiberTarget: "25",
    sugarMaximum: "50",
    sodiumMaximum: "2300",
  },
};

async function renderGoals(actionData?: unknown): Promise<ReactTestRenderer> {
  const Routes = createRoutesStub([
    { Component: Goals, id: "goals", path: "/settings/goals" },
  ]);
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      createElement(Routes, {
        hydrationData: {
          actionData: actionData ? { goals: actionData } : undefined,
          loaderData: { goals: loaderData },
        },
        initialEntries: ["/settings/goals"],
      }),
    );
  });
  return renderer!;
}

function input(renderer: ReactTestRenderer, name: string) {
  return renderer.root.findAllByType("input").find((candidate) => candidate.props.name === name)!;
}

function nodeText(node: ReactTestRenderer["root"]): string {
  return node.children
    .flatMap((child) =>
      typeof child === "string" ? child : nodeText(child),
    )
    .join("");
}

test("goals route publishes private uncached metadata", () => {
  expect(meta()).toEqual([
    { title: "Goals · Open Calorie Tracker" },
    {
      content: "Set the private Daily Goal every Food Log day is measured against",
      name: "description",
    },
  ]);
  expect(headers()).toEqual({ "Cache-Control": "no-store" });
});

test("goals shows only the Daily Goal target inputs, with no units, effective date, or history", async () => {
  const renderer = await renderGoals();
  expect(renderer.root.findAllByProps({ name: "csrfToken" }).every((node) => node.props.value === "goals-csrf"))
    .toBe(true);
  expect(
    renderer.root.findAllByType("form").at(-1)!.findAllByType("input").map((node) => node.props.name as string),
  ).toEqual([
    "csrfToken",
    "calorieTarget",
    "waterTarget",
    "proteinTarget",
    "carbohydrateTarget",
    "fatTarget",
    "fiberTarget",
    "sugarMaximum",
    "sodiumMaximum",
  ]);
  for (const name of ["displayUnits", "effectiveDate", "waterSourceUnits", "waterSourceValue"]) {
    expect(input(renderer, name)).toBeUndefined();
  }
  expect(renderer.root.findAllByProps({ "aria-labelledby": "goal-history-heading" })).toHaveLength(0);
  expect(input(renderer, "waterTarget").props).toMatchObject({
    defaultValue: "67.628",
    inputMode: "decimal",
    max: "500",
    min: "0.001",
    required: true,
    step: "0.001",
    type: "number",
  });
  expect(input(renderer, "sodiumMaximum").props).toMatchObject({
    defaultValue: "2300",
    max: "100000",
    min: "1",
    step: "1",
  });
  expect(input(renderer, "proteinTarget").props).toMatchObject({
    defaultValue: "120",
    max: "2000",
    min: "0.001",
    step: "0.001",
  });
  expect(input(renderer, "calorieTarget").props).toMatchObject({ defaultValue: "2050", max: "20000" });
  expect(renderer.root.findAllByType("em").map((node) => nodeText(node)))
    .toEqual(["kcal", "fl oz", "g", "g", "g", "g", "g", "mg"]);
  expect(renderer.root.findAllByType("label").map((node) => nodeText(node)).filter((text) => !text.startsWith("Theme")))
    .toEqual(expect.arrayContaining([
      "Calories targetkcal",
      "Water targetfl oz",
      "Protein targetg",
      "Carbohydrate targetg",
      "Fat targetg",
      "Fiber targetg",
      "Sugar maximumg",
      "Sodium maximummg",
    ]));
  expect(renderer.root.findAllByType("h2").map((node) => nodeText(node))).toContain("Daily Goal");
  expect(renderer.root.findAllByType("button").map((node) => nodeText(node))).toContain("Save Daily Goal");
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(renderer.root.findAllByProps({ role: "status" })).toHaveLength(0);
  expect(renderer.root.findByProps({ "aria-label": "Daily Goal context" })).toBeDefined();
  expect(renderer.root.findAllByType("small").some(
    (node) => node.children.join("") === "Private to goal.owner",
  )).toBe(true);
  renderer.unmount();
});

test.each([
  "calorieTarget",
  "waterTarget",
  "proteinTarget",
  "sodiumMaximum",
] as const)("goals associates a %s error only with that input", async (field) => {
  const renderer = await renderGoals({ error: { field, message: `${field} rejected` } });
  expect(input(renderer, field).props).toMatchObject({
    "aria-describedby": "daily-goal-error",
    "aria-invalid": true,
  });
  const alert = renderer.root.findByProps({ role: "alert" });
  expect(alert.props.id).toBe("daily-goal-error");
  expect(alert.children.join("")).toBe(`${field} rejected`);
  for (const candidate of renderer.root.findAllByType("input").filter((node) => node.props.name !== field)) {
    expect(candidate.props["aria-invalid"]).toBeUndefined();
    expect(candidate.props["aria-describedby"]).toBeUndefined();
  }
  renderer.unmount();
});

test("goals announces a saved Daily Goal", async () => {
  const renderer = await renderGoals({ message: "Daily Goal saved. Every day now uses it." });
  expect(renderer.root.findByProps({ role: "status" }).children.join(""))
    .toBe("Daily Goal saved. Every day now uses it.");
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  renderer.unmount();
});
