/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- react-test-renderer host props are untyped */
import { createElement } from "react";
import { createRoutesStub } from "react-router";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, test } from "vitest";

import Goals, {
  headers,
  meta,
} from "../../app/routes/settings.goals";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const loaderData = {
  csrfToken: "goals-csrf",
  displayUnits: "us" as const,
  fields: {
    calories: "2050",
    carbohydrate: "230",
    effectiveDate: "2026-08-31",
    fat: "70",
    fiber: "25",
    protein: "120",
    sodium: "2300",
    sugar: "50",
    water: "80",
  },
  goal: {
    calorieTargetMilliKcal: 2_050_000,
    carbohydrateTargetMilligrams: 230_000,
    createdAt: "2026-08-31T12:00:00.000Z",
    effectiveDate: "2026-08-31",
    fatTargetMilligrams: 70_000,
    fiberTargetMilligrams: 25_000,
    id: 1,
    proteinTargetMilligrams: 120_000,
    sodiumMaximumMilligrams: 2_300,
    sugarMaximumMilligrams: 50_000,
    waterTargetMicroliters: 2_365_882,
  },
  timeZone: "America/New_York",
  today: "2026-08-31",
  username: "goal.owner",
};

async function renderGoals(actionData?: {
  error?: string;
  field?: string;
  message?: string;
}): Promise<ReactTestRenderer> {
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

function input(renderer: ReactTestRenderer, name: string, value?: string) {
  return renderer.root.findAllByType("input").find(
    (candidate) =>
      candidate.props.name === name &&
      (value === undefined || candidate.props.value === value),
  )!;
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
      content: "Replace private goals from an effective local date",
      name: "description",
    },
  ]);
  expect(headers()).toEqual({ "Cache-Control": "no-store" });
});

test("goals renders the complete effective-dated form contract", async () => {
  const renderer = await renderGoals();
  expect(renderer.root.findAllByProps({ name: "csrfToken" })).toHaveLength(3);
  expect(
    renderer.root
      .findAllByProps({ name: "csrfToken" })
      .every((node) => node.props.value === "goals-csrf"),
  ).toBe(true);
  expect(input(renderer, "waterSourceUnits").props.value).toBe("us");
  expect(input(renderer, "waterSourceValue").props.value).toBe("80");
  expect(input(renderer, "displayUnits", "us").props.checked).toBe(true);
  expect(input(renderer, "displayUnits", "metric").props.checked).toBe(false);
  expect(input(renderer, "effectiveDate").props).toMatchObject({
    min: "2026-08-31",
    required: true,
    type: "date",
    value: "2026-08-31",
  });
  expect(input(renderer, "water").props).toMatchObject({
    inputMode: "decimal",
    max: "500",
    min: "0.001",
    required: true,
    step: "0.001",
    type: "number",
    value: "80",
  });
  expect(input(renderer, "sodium").props).toMatchObject({
    max: "100000",
    min: "1",
    step: "1",
    value: "2300",
  });
  expect(input(renderer, "protein").props).toMatchObject({
    max: "2000",
    min: "0.001",
    step: "0.001",
    value: "120",
  });
  expect(renderer.root.findAllByType("em").map((node) => nodeText(node)))
    .toEqual(["kcal", "fl oz", "g", "g", "g", "g", "g", "mg"]);
  expect(renderer.root.findAllByType("label").map((node) => nodeText(node)))
    .toEqual([
      "US",
      "Metric",
      "Effective dateToday or a future date in America/New_York",
      "Calories  targetkcal",
      "Water  targetfl oz",
      "Protein  targetg",
      "Carbohydrate  targetg",
      "Fat  targetg",
      "Fiber  targetg",
      "Sugar  maximumg",
      "Sodium  maximummg",
    ]);
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(renderer.root.findAllByProps({ role: "status" })).toHaveLength(0);
  expect(renderer.root.findByProps({ "aria-label": "Goal Version context" }))
    .toBeDefined();
  expect(
    renderer.root.findAllByType("strong").map((node) => node.children.join("")),
  ).toEqual(expect.arrayContaining(["2026-08-31", "America/New_York"]));
  expect(renderer.root.findAllByType("small").some(
    (node) => node.children.join("") === "Private to goal.owner",
  )).toBe(true);
  renderer.unmount();
});

test.each([
  "displayUnits",
  "effectiveDate",
  "water",
  "protein",
  "sodium",
] as const)("goals associates a %s error only with that field", async (field) => {
  const renderer = await renderGoals({ error: `${field} rejected`, field });
  const affected =
    field === "displayUnits"
      ? [input(renderer, field, "us"), input(renderer, field, "metric")]
      : [input(renderer, field)];
  expect(affected.every((node) => node.props["aria-invalid"] === true))
    .toBe(true);
  expect(
    affected.every(
      (node) => node.props["aria-describedby"] === "goal-settings-error",
    ),
  ).toBe(true);
  expect(renderer.root.findByProps({ role: "alert" }).children.join(""))
    .toBe(`${field} rejected`);
  const unaffected = field === "protein" ? "water" : "protein";
  expect(input(renderer, unaffected).props["aria-invalid"]).toBeUndefined();
  expect(input(renderer, unaffected).props["aria-describedby"]).toBeUndefined();
  for (const candidate of renderer.root.findAllByType("input").filter(
    (node) =>
      node.props.name !== field &&
      !["csrfToken", "waterSourceUnits", "waterSourceValue"].includes(
        node.props.name,
      ),
  )) {
    expect(candidate.props["aria-invalid"]).toBeUndefined();
    expect(candidate.props["aria-describedby"]).toBeUndefined();
  }
  renderer.unmount();
});

test("goals announces successful persistence", async () => {
  const renderer = await renderGoals({ message: "Goal Version saved." });
  expect(renderer.root.findByProps({ role: "status" }).children.join(""))
    .toBe("Goal Version saved.");
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  renderer.unmount();
});

test("changing units converts water from the last user-authored source", async () => {
  const renderer = await renderGoals();
  await act(async () => input(renderer, "displayUnits", "metric").props.onChange());
  expect(input(renderer, "displayUnits", "us").props.checked).toBe(false);
  expect(input(renderer, "displayUnits", "metric").props.checked).toBe(true);
  expect(input(renderer, "water").props).toMatchObject({
    max: "15000",
    value: "2365.882",
  });
  expect(renderer.root.findAllByType("em").map((node) => nodeText(node))[1])
    .toBe("ml");
  expect(input(renderer, "waterSourceUnits").props.value).toBe("us");
  expect(input(renderer, "waterSourceValue").props.value).toBe("80");

  await act(async () =>
    input(renderer, "water").props.onChange({ target: { value: "2400" } }),
  );
  expect(input(renderer, "waterSourceUnits").props.value).toBe("metric");
  expect(input(renderer, "waterSourceValue").props.value).toBe("2400");
  await act(async () => input(renderer, "displayUnits", "us").props.onChange());
  expect(input(renderer, "water").props.value).toBe("81.154");

  await act(async () =>
    input(renderer, "effectiveDate").props.onChange({
      target: { value: "2026-09-01" },
    }),
  );
  await act(async () =>
    input(renderer, "protein").props.onChange({ target: { value: "125" } }),
  );
  expect(input(renderer, "effectiveDate").props.value).toBe("2026-09-01");
  expect(input(renderer, "protein").props.value).toBe("125");
  expect(input(renderer, "waterSourceUnits").props.value).toBe("metric");
  expect(input(renderer, "waterSourceValue").props.value).toBe("2400");
  renderer.unmount();
});
