/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- react-test-renderer host props are untyped */
/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- react-test-renderer host props are untyped */
import { createHash } from "node:crypto";

import { createElement } from "react";
import {
  createMemoryRouter,
  createRoutesStub,
  RouterProvider,
} from "react-router";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, test } from "vitest";

import { buildCalendarMonth } from "../../app/food-log/date";
import Home from "../../app/routes/home";
import styles from "../../app/food-log.module.css";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

class TestElement {
  isConnected = true;
  offsetParent: object | null = {};
  tagName = "BUTTON";
  getAttribute() {
    return null;
  }
  getAttributeNames() {
    return [];
  }
  hasAttribute() {
    return false;
  }
  focus() {
    (globalThis.document as unknown as { activeElement: TestElement }).activeElement = this;
  }
  querySelector(selector: string) {
    queriedSelectors.push(selector);
    return modalFocusables[0] ?? null;
  }
  querySelectorAll(selector: string) {
    queriedAllSelectors.push(selector);
    return modalFocusables;
  }
}
const queriedSelectors: string[] = [];
const queriedAllSelectors: string[] = [];
const modalFocusables = [
  new TestElement(),
  new TestElement(),
  new TestElement(),
  new TestElement(),
];
modalFocusables[1].offsetParent = null;
let lastNodeMock: TestElement | undefined;
let documentRestoreTarget: TestElement | null = null;
const documentSelectors: string[] = [];
(globalThis as unknown as { HTMLElement: typeof TestElement })
  .HTMLElement = TestElement;
(globalThis as typeof globalThis & { document: Document }).document = {
  activeElement: new TestElement(),
  body: { style: { overflow: "" } },
  querySelector: (selector: string) => {
    documentSelectors.push(selector);
    return documentRestoreTarget;
  },
} as unknown as Document;
(globalThis as typeof globalThis & { requestAnimationFrame: typeof requestAnimationFrame })
  .requestAnimationFrame = (callback) => {
    callback(0);
    return 1;
  };
(globalThis as typeof globalThis & { cancelAnimationFrame: typeof cancelAnimationFrame })
  .cancelAnimationFrame = () => undefined;

const completeGoal = {
  calorieTargetMilliKcal: 2_050_000,
  carbohydrateTargetMilligrams: 230_000,
  effectiveDate: "2026-08-31",
  fatTargetMilligrams: 70_000,
  fiberTargetMilligrams: 25_000,
  proteinTargetMilligrams: 120_000,
  sodiumMaximumMilligrams: 2_300,
  sugarMaximumMilligrams: 50_000,
  waterTargetMicroliters: 2_365_882,
};

const emptyTotals = {
  carbohydrateMilligrams: { isIncomplete: false, known: 0 },
  energyMilliKcal: { isIncomplete: false, known: 0 },
  fatMilligrams: { isIncomplete: false, known: 0 },
  fiberMilligrams: { isIncomplete: false, known: 0 },
  proteinMilligrams: { isIncomplete: false, known: 0 },
  sodiumMilligrams: { isIncomplete: false, known: 0 },
  sugarMilligrams: { isIncomplete: false, known: 0 },
};

const baseFoodLog = {
  displayUnits: "us" as const,
  entries: [],
  events: [],
  goal: completeGoal,
  isFuture: false,
  nutritionTotals: emptyTotals,
  selectedDate: "2026-08-31",
  timeZone: "America/New_York",
  today: "2026-08-31",
  waterTotalMicroliters: 0,
};

const baseLoaderData = {
  calendar: undefined,
  catalog: undefined,
  copyDialog: undefined,
  copyError: undefined,
  copyIdempotencyKeys: {},
  csrfToken: "home-component-csrf",
  foodEntryEditor: undefined,
  foodLog: baseFoodLog,
  nearbyDates: [
    { date: "2026-08-30", isFuture: false, isSelected: false },
    { date: "2026-08-31", isFuture: false, isSelected: true },
    { date: "2026-09-01", isFuture: true, isSelected: false },
  ],
  notice: undefined,
  username: "home.component",
  waterDialog: undefined,
};

async function renderHome(
  loaderOverrides: Record<string, unknown> = {},
  actionData?: Record<string, unknown>,
  initialPath = "/",
): Promise<ReactTestRenderer> {
  const loaderData = { ...baseLoaderData, ...loaderOverrides };
  const Routes = createRoutesStub([{
    Component: Home,
    id: "home",
    loader: () => baseLoaderData,
    path: "/",
  }]);
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      createElement(Routes, {
        hydrationData: {
          actionData: actionData ? { home: actionData } : undefined,
          loaderData: { home: loaderData },
        },
        initialEntries: [initialPath],
      }),
      {
        createNodeMock: () => {
          lastNodeMock = new TestElement();
          return lastNodeMock;
        },
      },
    );
  });
  return renderer!;
}

async function renderPendingHome(
  loaderOverrides: Record<string, unknown>,
  navigation: { formData?: FormData; to: string },
) {
  const loaderData = { ...baseLoaderData, ...loaderOverrides };
  const never = new Promise<never>(() => undefined);
  const PendingHome = () => Home({ actionData: undefined, loaderData } as never);
  const router = createMemoryRouter(
    [
      {
        action: () => never,
        Component: PendingHome,
        id: "home",
        loader: () => never,
        path: "/",
      },
    ],
    {
      hydrationData: { loaderData: { home: loaderData } },
      initialEntries: ["/"],
    },
  );
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(createElement(RouterProvider, { router }), {
      createNodeMock: () => {
        lastNodeMock = new TestElement();
        return lastNodeMock;
      },
    });
  });
  await act(async () => {
    void router.navigate(navigation.to, navigation.formData
      ? { formData: navigation.formData, formMethod: "post" }
      : undefined);
    await Promise.resolve();
  });
  return renderer!;
}

function input(renderer: ReactTestRenderer, name: string) {
  return renderer.root.findAllByType("input").find(
    (candidate) => candidate.props.name === name,
  )!;
}

function nodeText(node: ReactTestRenderer["root"]): string {
  return node.children
    .flatMap((child) =>
      typeof child === "string" ? child : nodeText(child),
    )
    .join("");
}

function allText(renderer: ReactTestRenderer): string {
  return nodeText(renderer.root).replace(/\s+/g, " ").trim();
}

function semanticDom(renderer: ReactTestRenderer): string {
  function normalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalize);
    if (value === null || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    const props = Object.fromEntries(
      Object.entries((record.props ?? {}) as Record<string, unknown>)
        .filter(([, prop]) => typeof prop !== "function")
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, prop]) => [name, normalize(prop)]),
    );
    return {
      children: normalize(record.children),
      props,
      type: record.type,
    };
  }
  return createHash("sha256")
    .update(JSON.stringify(normalize(renderer.toJSON())))
    .digest("hex");
}

test("home renders today's empty log and all goal progress contracts", async () => {
  const renderer = await renderHome();
  expect(semanticDom(renderer)).toMatchSnapshot();
  expect(renderer.root.findByType("h1").props["aria-label"])
    .toBe("Today's Food Log");
  expect(renderer.root.findByType("h1").children.join("")).toBe("Today");
  expect(allText(renderer)).toContain("Monday, August 31, 2026");
  expect(allText(renderer)).toContain("No entries for this day");
  expect(allText(renderer)).toContain(
    "Start today’s Food Log with food or water when you’re ready.",
  );
  expect(renderer.root.findAllByType("button").filter(
    (button) => ["add-food", "add-water"].includes(button.props.value),
  )).toHaveLength(2);
  expect(renderer.root.findByProps({ "aria-label": "Calorie progress" }).props)
    .toMatchObject({
      "aria-valuemax": 2050,
      "aria-valuemin": 0,
      "aria-valuenow": 0,
      "aria-valuetext": "0 of 2,050 kcal target",
      role: "progressbar",
      style: { "--progress": "0%" },
    });
  expect(renderer.root.findByProps({ "aria-label": "Water progress" }).props)
    .toMatchObject({
      "aria-valuemin": 0,
      "aria-valuenow": 0,
      "aria-valuetext": "0 of 80 fl oz target",
      role: "progressbar",
      style: { "--progress": "0%" },
    });
  expect(renderer.root.findAllByType("article").map((node) => node.props["aria-label"]))
    .toEqual([
      "Protein: 0 of 120 g target",
      "Carbohydrate: 0 of 230 g target",
      "Fat: 0 of 70 g target",
      "Fiber: 0 of 25 g target",
      "Sugar: 0 of 50 g maximum",
      "Sodium: 0 of 2,300 mg maximum",
    ]);
  const pageButtons = renderer.root.findByProps({ "aria-label": "Nutrition pages" })
    .findAllByType("button");
  expect(pageButtons.map((button) => button.props["aria-pressed"]))
    .toEqual([true, false]);
  await act(async () => pageButtons[1].props.onClick());
  expect(semanticDom(renderer)).toMatchSnapshot();
  expect(pageButtons.map((button) => button.props["aria-pressed"]))
    .toEqual([false, true]);
  await act(async () => pageButtons[0].props.onClick());
  expect(pageButtons.map((button) => button.props["aria-pressed"]))
    .toEqual([true, false]);
  expect(renderer.root.findAllByProps({ role: "status" })).toHaveLength(0);
  expect(renderer.root.findAllByProps({ "aria-current": "page" })
    .map((node) => node.props.to)
    .filter(Boolean)).toContain("/?date=2026-08-31");
  await act(async () => renderer.unmount());
});

test("daily nutrients support guarded touch swipes, cancellation, and both directions", async () => {
  const renderer = await renderHome();
  const carousel = () =>
    renderer.root.findByProps({ "aria-label": "Daily nutrient progress" });
  const track = () => carousel().findAllByType("div").find(
    (node) => typeof node.props.style?.transform === "string",
  )!;
  const event = (
    pointerId: number,
    clientX: number,
    clientY: number,
    pointerType = "touch",
  ) => ({
    clientX,
    clientY,
    currentTarget: {
      getBoundingClientRect: () => ({ width: 200 }),
    },
    pointerId,
    pointerType,
    preventDefault: () => undefined,
  });

  await act(async () => carousel().props.onPointerDown(event(1, 100, 100, "mouse")));
  await act(async () => carousel().props.onPointerMove(event(1, 20, 100)));
  expect(track().props.style.transform).toContain("+ 0px");

  let boundaryPreventions = 0;
  const boundaryEvent = (pointerId: number, clientX: number, clientY: number) => ({
    ...event(pointerId, clientX, clientY),
    preventDefault: () => {
      boundaryPreventions += 1;
    },
  });
  await act(async () => carousel().props.onPointerDown(event(10, 100, 100)));
  await act(async () => carousel().props.onPointerMove(boundaryEvent(10, 95, 95)));
  await act(async () => carousel().props.onPointerMove(boundaryEvent(10, 80, 100)));
  expect(boundaryPreventions).toBe(1);
  await act(async () => carousel().props.onPointerCancel());

  boundaryPreventions = 0;
  await act(async () => carousel().props.onPointerDown(event(11, 100, 100)));
  await act(async () => carousel().props.onPointerMove(boundaryEvent(11, 94, 95)));
  expect(boundaryPreventions).toBe(1);
  await act(async () => carousel().props.onPointerCancel());

  boundaryPreventions = 0;
  await act(async () => carousel().props.onPointerDown(event(12, 100, 100)));
  await act(async () => carousel().props.onPointerMove(boundaryEvent(12, 95, 94)));
  await act(async () => carousel().props.onPointerMove(boundaryEvent(12, 80, 100)));
  expect(boundaryPreventions).toBe(0);

  boundaryPreventions = 0;
  await act(async () => carousel().props.onPointerDown(event(13, 100, 100)));
  await act(async () => carousel().props.onPointerMove(boundaryEvent(13, 94, 94)));
  expect(boundaryPreventions).toBe(0);

  await act(async () => carousel().props.onPointerDown(event(1, 100, 100)));
  await act(async () => carousel().props.onPointerMove(event(2, 20, 100)));
  await act(async () => carousel().props.onPointerMove(event(1, 96, 96)));
  expect(track().props.style.transform).toContain("+ 0px");
  await act(async () => carousel().props.onPointerMove(event(1, 98, 80)));
  await act(async () => carousel().props.onPointerMove(event(1, 20, 100)));
  expect(track().props.style.transform).toContain("+ 0px");

  let prevented = 0;
  const horizontal = event(3, 50, 100);
  horizontal.preventDefault = () => {
    prevented += 1;
  };
  await act(async () => carousel().props.onPointerDown(event(3, 100, 100)));
  await act(async () => carousel().props.onPointerMove(horizontal));
  expect(prevented).toBe(1);
  expect(track().props.style.transform).toContain("-50px");
  await act(async () => carousel().props.onPointerUp(event(4, 20, 100)));
  expect(track().props.style.transform).toContain("-50px");
  await act(async () => carousel().props.onPointerCancel());
  expect(track().props.style.transform).toContain("+ 0px");
  const cancelledClass = track().props.className;
  await act(async () => carousel().props.onPointerDown(event(14, 100, 100)));
  expect(track().props.className).not.toBe(cancelledClass);
  await act(async () => carousel().props.onPointerCancel());

  await act(async () => carousel().props.onPointerUp(event(99, 20, 100)));

  await act(async () => carousel().props.onPointerDown(event(5, 100, 100)));
  await act(async () => carousel().props.onPointerUp(event(5, 20, 100)));
  expect(track().props.style.transform).toContain("+ 0px");

  await act(async () => carousel().props.onPointerDown(event(6, 100, 100)));
  await act(async () => carousel().props.onPointerMove(event(6, 60, 100)));
  const movingClass = track().props.className;
  await act(async () => carousel().props.onPointerUp(event(6, 60, 100)));
  expect(track().props.style.transform).toContain("-50%");
  expect(track().props.style.transform).toContain("+ 0px");
  expect(track().props.className).not.toBe(movingClass);
  expect(
    renderer.root.findByProps({ "aria-label": "Show fiber, sugar, and sodium" })
      .props["aria-pressed"],
  ).toBe(true);

  await act(async () => carousel().props.onPointerDown(event(7, 100, 100)));
  await act(async () => carousel().props.onPointerMove(event(7, 40, 100)));
  expect(track().props.style.transform).toContain("+ 0px");
  await act(async () => carousel().props.onPointerUp(event(7, 40, 100)));
  expect(
    renderer.root.findByProps({ "aria-label": "Show fiber, sugar, and sodium" })
      .props["aria-pressed"],
  ).toBe(true);
  await act(async () => carousel().props.onPointerDown(event(17, 100, 100)));
  await act(async () => carousel().props.onPointerCancel());
  const settlingClass = track().props.className;
  await act(async () =>
    renderer.root.findByProps({
      "aria-label": "Show protein, carbohydrate, and fat",
    }).props.onClick()
  );
  expect(track().props.className).not.toBe(settlingClass);

  await act(async () => carousel().props.onPointerDown(event(8, 100, 100)));
  await act(async () => carousel().props.onPointerMove(event(8, 160, 100)));
  await act(async () => carousel().props.onPointerUp(event(8, 180, 100)));
  expect(track().props.style.transform).toContain("0%");
  expect(track().props.style.transform).toContain("+ 0px");

  await act(async () => carousel().props.onPointerDown(event(9, 100, 100)));
  await act(async () => carousel().props.onPointerMove(event(9, 160, 100)));
  expect(track().props.style.transform).toContain("+ 0px");
  await act(async () => carousel().props.onPointerCancel());
  await act(async () => renderer.unmount());
});

test("home distinguishes past, future, no-goal, and incomplete summaries", async () => {
  const pastFoodLog = {
    ...baseFoodLog,
    displayUnits: "metric" as const,
    goal: undefined,
    nutritionTotals: {
      ...emptyTotals,
      energyMilliKcal: { isIncomplete: true, known: 1_234_567 },
      proteinMilligrams: { isIncomplete: true, known: 12_345 },
    },
    selectedDate: "2026-08-30",
    waterTotalMicroliters: 236_588,
  };
  const past = await renderHome({
    foodLog: pastFoodLog,
    nearbyDates: [{ date: "2026-08-30", isFuture: false, isSelected: true }],
    notice: "Food Entry updated. Daily totals refreshed.",
  }, { message: "Visible route message" });
  expect(semanticDom(past)).toMatchSnapshot();
  expect(past.root.findByType("h1").props["aria-label"])
    .toBe("Food Log for Sunday, August 30, 2026");
  expect(past.root.findByType("h1").children.join("")).toBe("Food Log");
  expect(allText(past)).toContain("1,234.6 known / No active goal");
  expect(allText(past)).toContain("Protein12.345 known / No active goalIncomplete");
  expect(allText(past)).toContain("1 equivalent glass");
  expect(allText(past)).toContain("/ No active goal");
  expect(allText(past)).toContain("Food Entry updated. Daily totals refreshed.");
  expect(allText(past)).toContain("Visible route message");
  expect(past.root.findAllByProps({ "aria-label": "Calorie progress" }))
    .toHaveLength(0);
  expect(past.root.findAllByProps({ "aria-label": "Water progress" }))
    .toHaveLength(0);
  await act(async () => past.unmount());

  const futureFoodLog = {
    ...baseFoodLog,
    isFuture: true,
    selectedDate: "2026-09-01",
  };
  const future = await renderHome({
    foodLog: futureFoodLog,
    nearbyDates: [{ date: "2026-09-01", isFuture: true, isSelected: true }],
  });
  expect(semanticDom(future)).toMatchSnapshot();
  expect(future.root.findByType("h1").props["aria-label"])
    .toBe("Food Log for Tuesday, September 1, 2026");
  expect(allText(future)).toContain("Future day");
  expect(allText(future)).toContain(
    "food and water can only be recorded today or in the past.",
  );
  expect(future.root.findAllByType("button").filter(
    (button) => ["add-food", "add-water"].includes(button.props.value),
  )).toHaveLength(0);
  await act(async () => future.unmount());
});

test("home renders calendar navigation, selected dates, and future days", async () => {
  const renderer = await renderHome({
    calendar: {
      days: [
        { date: "2026-08-30", day: 30, isFuture: false, isSelected: true, isToday: false },
        { date: "2026-08-31", day: 31, isFuture: false, isSelected: false, isToday: true },
        { date: "2026-09-01", day: 1, isFuture: true, isSelected: false, isToday: false },
      ],
      label: "August 2026",
      leadingEmptyDays: 2,
      nextMonth: undefined,
      previousMonth: "2026-07",
    },
  });
  expect(semanticDom(renderer)).toMatchSnapshot();
  expect(renderer.root.findByType("h1").props["aria-label"])
    .toBe("Food Log history");
  expect(renderer.root.findByType("h1").children.join("")).toBe("History");
  expect(renderer.root.findAllByProps({ "aria-current": "page" })
    .map((node) => node.props.to)
    .filter(Boolean)).toContain("/?date=2026-08-31&calendar=2026-08");
  expect(renderer.root.findByProps({ "aria-label": "Previous month" }).props.to)
    .toBe("/?date=2026-08-31&calendar=2026-07");
  expect(renderer.root.findByProps({ "aria-label": "Next month" }).props.disabled)
    .toBe(true);
  expect(renderer.root.findByProps({ "aria-label": "Sunday, August 30" }).props)
    .toMatchObject({ "aria-current": "date", to: "/?date=2026-08-30" });
  expect(renderer.root.findByProps({ "aria-label": "Tuesday, September 1" }).props)
    .toMatchObject({ disabled: true, type: "button" });
  expect(renderer.root.findAllByProps({ "aria-hidden": "true" }).filter(
    (node) => String(node.props.key ?? "").startsWith("empty-"),
  )).toHaveLength(0);
  expect(allText(renderer)).toContain("SunMonTueWedThuFriSat");
  await act(async () => renderer.unmount());

  const withNext = await renderHome({
    calendar: {
      days: [],
      label: "July 2026",
      leadingEmptyDays: 0,
      nextMonth: "2026-08",
      previousMonth: "2026-06",
    },
  });
  expect(semanticDom(withNext)).toMatchSnapshot();
  expect(withNext.root.findByProps({ "aria-label": "Next month" }).props.to)
    .toBe("/?date=2026-08-31&calendar=2026-08");
  await act(async () => withNext.unmount());
});

test("home renders food and water timeline entries with factual units", async () => {
  const foodEvent = {
    amountMicroliters: undefined,
    dataType: "Branded",
    energyMilliKcal: 59_000,
    foodLogDate: "2026-08-31",
    id: 11,
    kind: "food" as const,
    localEventTime: "00:05:00",
    name: "Timeline yogurt",
    provider: "open-food-facts",
    quantityMicrounits: 1_500_000,
    selectedMeasurementLabel: "100 g",
  };
  const waterEvent = {
    amountMicroliters: 473_176,
    foodLogDate: "2026-08-31",
    id: 12,
    kind: "water" as const,
    localEventTime: "13:07:00",
  };
  const unknownEnergyEvent = {
    ...foodEvent,
    energyMilliKcal: null,
    id: 14,
    name: "Unknown energy food",
  };
  const renderer = await renderHome({
    foodLog: {
      ...baseFoodLog,
      entries: [foodEvent, { ...foodEvent, id: 13, name: "Second food" }],
      events: [foodEvent, waterEvent, unknownEnergyEvent],
      nutritionTotals: {
        carbohydrateMilligrams: { isIncomplete: false, known: 300_000 },
        energyMilliKcal: { isIncomplete: false, known: 3_000_000 },
        fatMilligrams: { isIncomplete: false, known: 90_000 },
        fiberMilligrams: { isIncomplete: false, known: 30_000 },
        proteinMilligrams: { isIncomplete: true, known: 150_000 },
        sodiumMilligrams: { isIncomplete: false, known: 3_000 },
        sugarMilligrams: { isIncomplete: false, known: 60_000 },
      },
      waterTotalMicroliters: 3_000_000,
    },
  }, { message: "Timeline action completed" });
  expect(semanticDom(renderer)).toMatchSnapshot();
  expect(allText(renderer)).toContain("12:05 AM");
  expect(allText(renderer)).toContain("1:07 PM");
  expect(allText(renderer)).toContain("Timeline yogurt");
  expect(allText(renderer)).toContain("Open Food Facts");
  expect(allText(renderer)).toContain("100 g × 1.5");
  expect(allText(renderer)).toContain("59 kcal");
  expect(allText(renderer)).toContain("16 fl oz");
  expect(allText(renderer)).toContain("Unknown energy food");
  expect(allText(renderer)).toContain("— kcal");
  expect(allText(renderer)).toContain("Timeline action completed");
  expect(renderer.root.findAllByProps({ "data-entry-editor-trigger": true })[0].props.to)
    .toBe("/?date=2026-08-31&entry=11");
  expect(renderer.root.findByProps({ "data-water-editor-trigger": true }).props.to)
    .toBe("/?date=2026-08-31&water=12");
  expect(allText(renderer)).toContain("2 Food Entries");
  expect(renderer.root.findByProps({ "aria-label": "Calorie progress" }).props)
    .toMatchObject({
      "aria-valuemax": 2050,
      "aria-valuenow": 2050,
      style: { "--progress": "100%" },
    });
  expect(renderer.root.findByProps({ "aria-label": "Protein progress" }).props)
    .toMatchObject({
      "aria-valuemax": 120,
      "aria-valuenow": 120,
      "aria-valuetext": "Protein: 150 known of 120 g target; incomplete",
      style: { "--progress": "100%" },
    });
  expect(renderer.root.findByProps({ "aria-label": "Sodium progress" }).props)
    .toMatchObject({
      "aria-valuemax": 2300,
      "aria-valuenow": 2300,
      style: { "--progress": "100%" },
    });
  expect(renderer.root.findByProps({ "aria-label": "Water progress" }).props)
    .toMatchObject({
      "aria-valuemax": 79.99998765788172,
      "aria-valuenow": 79.99998765788172,
      style: { "--progress": "100%" },
    });
  expect(renderer.root.findAllByType("button").filter(
    (button) => ["add-food", "add-water"].includes(button.props.value),
  )).toHaveLength(2);
  await act(async () => renderer.unmount());

  const singular = await renderHome({
    foodLog: {
      ...baseFoodLog,
      entries: [foodEvent],
      events: [foodEvent],
      nutritionTotals: {
        ...emptyTotals,
        energyMilliKcal: { isIncomplete: true, known: 1_025_000 },
        proteinMilligrams: { isIncomplete: false, known: 60_000 },
        sodiumMilligrams: { isIncomplete: false, known: 1_150 },
      },
      waterTotalMicroliters: 1_182_941,
    },
  });
  expect(allText(singular)).toContain("1 Food Entry");
  expect(allText(singular)).not.toContain("1 Food Entries");
  expect(singular.root.findByProps({ "aria-label": "Calorie progress" }).props)
    .toMatchObject({
      "aria-valuenow": 1025,
      "aria-valuetext": "1,025 known of 2,050 kcal target; incomplete",
      style: { "--progress": "50%" },
    });
  expect(singular.root.findByProps({ "aria-label": "Protein progress" }).props)
    .toMatchObject({ "aria-valuenow": 60, style: { "--progress": "50%" } });
  expect(singular.root.findByProps({ "aria-label": "Sodium progress" }).props)
    .toMatchObject({ "aria-valuenow": 1150, style: { "--progress": "50%" } });
  expect(singular.root.findByProps({ "aria-label": "Water progress" }).props)
    .toMatchObject({
      "aria-valuenow": 39.99999382894086,
      style: { "--progress": "50%" },
    });
  await act(async () => singular.unmount());
});

test("historical Food Entries expose a copy menu without changing card editing", async () => {
  const historicalFood = {
    amountMicroliters: undefined,
    dataType: "Branded",
    energyMilliKcal: 59_000,
    foodLogDate: "2026-08-29",
    id: 91,
    kind: "food" as const,
    localEventTime: "08:05:00",
    name: "Historical yogurt",
    provider: "usda-fdc",
    quantityMicrounits: 1_000_000,
    selectedMeasurementLabel: "100 g",
  };
  const waterEvent = {
    amountMicroliters: 236_588,
    foodLogDate: "2026-08-29",
    id: 92,
    kind: "water" as const,
    localEventTime: "08:10:00",
  };
  const historical = await renderHome({
    copyIdempotencyKeys: { [historicalFood.id]: "copy:historical-key" },
    foodLog: {
      ...baseFoodLog,
      entries: [historicalFood],
      events: [historicalFood, waterEvent],
      selectedDate: "2026-08-29",
    },
  });

  expect(
    historical.root.findByProps({
      "aria-label": "More actions for Historical yogurt",
    }).type,
  ).toBe("button");
  await act(async () =>
    historical.root
      .findByProps({ "aria-label": "More actions for Historical yogurt" })
      .props.onClick(),
  );
  expect(
    historical.root.findByProps({ "data-entry-editor-trigger": true }).props.to,
  ).toBe("/?date=2026-08-29&entry=91");
  expect(input(historical, "entryId").props.value).toBe(91);
  expect(input(historical, "idempotencyKey").props.value).toBe(
    "copy:historical-key",
  );
  expect(
    historical.root.findAllByType("button").find(
      (button) => nodeText(button) === "Copy to today",
    )?.props,
  ).toMatchObject({
    disabled: false,
    name: "intent",
    value: "copy-food-to-today",
  });
  expect(
    historical.root.findAllByType("a").find(
      (link) => nodeText(link) === "Copy to another date…",
    )?.props,
  ).toMatchObject({
    href: "/?date=2026-08-29&copy=91",
  });
  expect(
    historical.root.findByProps({
      "aria-label": "More actions for Historical yogurt",
    }).props["data-copy-date-trigger"],
  ).toBe(91);
  expect(
    historical.root.findAll(
      (node) =>
        typeof node.props["aria-label"] === "string" &&
        node.props["aria-label"].startsWith("More actions for"),
    ),
  ).toHaveLength(1);
  await act(async () => historical.unmount());

  const today = await renderHome({
    copyIdempotencyKeys: {},
    foodLog: {
      ...baseFoodLog,
      entries: [{ ...historicalFood, foodLogDate: "2026-08-31" }],
      events: [{ ...historicalFood, foodLogDate: "2026-08-31" }, waterEvent],
    },
  });
  expect(
    today.root.findAll(
      (node) =>
        typeof node.props["aria-label"] === "string" &&
        node.props["aria-label"].startsWith("More actions for"),
    ),
  ).toHaveLength(0);
  await act(async () => today.unmount());

  const copyForm = new FormData();
  copyForm.set("entryId", "91");
  copyForm.set("intent", "copy-food-to-today");
  const pending = await renderPendingHome(
    {
      copyIdempotencyKeys: { [historicalFood.id]: "copy:historical-key" },
      foodLog: {
        ...baseFoodLog,
        entries: [historicalFood],
        events: [historicalFood],
        selectedDate: "2026-08-29",
      },
    },
    { formData: copyForm, to: "/" },
  );
  await act(async () =>
    pending.root
      .findByProps({ "aria-label": "More actions for Historical yogurt" })
      .props.onClick(),
  );
  expect(
    pending.root.findAllByType("button").find(
      (button) => nodeText(button) === "Copying…",
    )?.props.disabled,
  ).toBe(true);
  await act(async () => pending.unmount());
});

test("copy-date dialog exposes eligible calendar days and requires confirmation", async () => {
  const entry = {
    foodLogDate: "2026-08-28",
    id: 93,
    name: "Historical yogurt",
  };
  const calendar = buildCalendarMonth("2026-08", "2026-08-30", "2026-08-29");
  const renderer = await renderHome(
    {
      copyDialog: {
        calendar: {
          ...calendar,
          days: calendar.days.map((day) => ({
            ...day,
            isSource: day.date === entry.foodLogDate,
          })),
        },
        destinationDate: "2026-08-29",
        entry,
        idempotencyKey: `copy:${entry.id}:dialog-action`,
      },
      foodLog: {
        ...baseFoodLog,
        selectedDate: entry.foodLogDate,
        today: "2026-08-30",
      },
    },
    undefined,
    `/?date=${entry.foodLogDate}&copy=${entry.id}&copyDate=2026-08-29`,
  );

  expect(renderer.root.findByProps({ role: "dialog" }).props).toMatchObject({
    "aria-labelledby": "copy-food-entry-title",
    "aria-modal": "true",
  });
  expect(allText(renderer)).toContain("Copy Historical yogurt");
  expect(allText(renderer)).toContain("Saturday, August 29, 2026");
  expect(
    renderer.root.findByProps({ "aria-label": "Friday, August 28" }).props,
  ).toMatchObject({ disabled: true });
  expect(
    renderer.root.findByProps({ "aria-label": "Monday, August 31" }).props,
  ).toMatchObject({ disabled: true });
  expect(input(renderer, "destinationDate").props.value).toBe("2026-08-29");
  expect(
    renderer.root.findAllByType("button").find(
      (button) => button.props.value === "copy-food-to-date",
    )?.props.disabled,
  ).toBe(false);
  expect(allText(renderer)).toContain("Cancel");
  await act(async () => renderer.unmount());
});

test("home labels user-entered Food Entries as Manual", async () => {
  const manualEntry = {
    dataType: "User entered",
    energyMilliKcal: 180_000,
    foodLogDate: "2026-08-31",
    id: 19,
    kind: "food" as const,
    localEventTime: "12:00:00",
    name: "Tortillas",
    provider: "manual",
    quantityMicrounits: 3_000_000,
    selectedMeasurementLabel: "1 serving",
  };
  const renderer = await renderHome({
    foodLog: {
      ...baseFoodLog,
      entries: [manualEntry],
      events: [manualEntry],
    },
  });

  expect(allText(renderer)).toContain("TortillasManual1 serving × 3");
  expect(allText(renderer)).not.toContain("USDA FoodData Central · User entered");
  await act(async () => renderer.unmount());
});

const catalogFood = {
  authoritativeBaseQuantityMicrounits: 100_000_000,
  authoritativeBaseUnit: "g",
  barcode: "0012345678905",
  brand: "Example Dairy",
  dataType: "Branded",
  isSelectable: true,
  marketCountry: "United States",
  measurementSummary: "1 container · 170 g",
  measurements: [
    { baseQuantityMicrounits: 170_000_000, id: "serving", label: "1 container", unit: "g" },
    { baseQuantityMicrounits: 100_000_000, id: "base", label: "100 g", unit: "g" },
  ],
  name: "Plain Greek yogurt",
  nutritionPerAuthoritativeBase: {
    carbohydrateMilligrams: { amount: 3.5, fixedPointMultiplier: 1_000 },
    energyMilliKcal: { amount: 59, fixedPointMultiplier: 1_000 },
    fatMilligrams: { amount: 0, fixedPointMultiplier: 1_000 },
    fiberMilligrams: null,
    proteinMilligrams: { amount: 10.5, fixedPointMultiplier: 1_000 },
    sodiumMilligrams: { amount: 36, fixedPointMultiplier: 1 },
    sugarMilligrams: { amount: 3.5, fixedPointMultiplier: 1_000 },
  },
  originalName: "Plain Greek yogurt",
  provider: "usda-fdc",
  providerFoodId: "1001",
  providerModifiedDate: "2026-04-02",
  providerPublishedDate: "2026-04-01",
};

const barcodeFood = {
  ...catalogFood,
  authoritativeBaseQuantityMicrounits: 1_000_000,
  authoritativeBaseUnit: "serving",
  barcode: "0034000470693",
  brand: "Example Foods",
  dataType: "Open Food Facts",
  marketCountry: "United States",
  measurementSummary: "1 serving",
  measurements: [
    {
      baseQuantityMicrounits: 1_000_000,
      id: "serving",
      label: "1 serving",
      unit: "serving",
    },
  ],
  name: "Example cereal",
  nutritionPerAuthoritativeBase: {
    carbohydrateMilligrams: { amount: 24, fixedPointMultiplier: 1_000 },
    energyMilliKcal: { amount: 180, fixedPointMultiplier: 1_000 },
    fatMilligrams: { amount: 0, fixedPointMultiplier: 1_000 },
    fiberMilligrams: { amount: 2, fixedPointMultiplier: 1_000 },
    proteinMilligrams: null,
    sodiumMilligrams: { amount: 150, fixedPointMultiplier: 1 },
    sugarMilligrams: { amount: 5, fixedPointMultiplier: 1_000 },
  },
  originalName: "Example cereal",
  provider: "open-food-facts",
  providerFoodId: "0034000470693",
  providerModifiedDate: null,
  providerPublishedDate: null,
};

test("Add Food offers search, barcode, and manual paths before any provider runs", async () => {
  const renderer = await renderHome({ catalog: { mode: "choose", query: "" } });
  expect(semanticDom(renderer)).toMatchSnapshot();
  expect(allText(renderer)).toContain("Search for food");
  expect(allText(renderer)).toContain("Scan barcode");
  expect(allText(renderer)).toContain("Manual");
  expect(renderer.root.findByProps({
    href: "/?date=2026-08-31&food=search",
  })).toBeDefined();
  expect(renderer.root.findByProps({
    href: "/?date=2026-08-31&food=barcode",
  })).toBeDefined();
  expect(renderer.root.findByProps({
    href: "/?date=2026-08-31&food=manual",
  })).toBeDefined();
  expect(renderer.root.findAllByType("img")).toHaveLength(0);
  await act(async () => renderer.unmount());
});

test("manual Food Entry form keeps entered totals when quantity changes and restores invalid drafts", async () => {
  const catalog = {
    idempotencyKey: "manual-form-key",
    mode: "manual" as const,
    query: "",
  };
  const renderer = await renderHome({ catalog });

  expect(allText(renderer)).toContain("Add food manually");
  expect(allText(renderer)).toContain("1 serving");
  expect(input(renderer, "name").props.required).toBe(true);
  expect(input(renderer, "energyKcal").props.required).toBe(true);
  expect(input(renderer, "proteinGrams").props.required).toBe(false);
  expect(input(renderer, "quantity").props.value).toBe("1");
  for (const name of ["name", "energyKcal", "proteinGrams", "carbohydrateGrams", "fatGrams", "fiberGrams", "sugarGrams", "sodiumMilligrams"]) {
    expect(input(renderer, name).props.value).toBe("");
  }
  expect(renderer.root.findByProps({ className: styles.backToResults }).props.to).toBe("/?date=2026-08-31&food=choose");
  expect(renderer.root.findByType("fieldset").props.disabled).toBe(false);
  expect(allText(renderer)).toContain("Add to Food Log");
  for (const name of ["energyKcal", "proteinGrams", "carbohydrateGrams", "fatGrams", "fiberGrams", "sugarGrams", "sodiumMilligrams"]) {
    expect(input(renderer, name).props).toMatchObject({
      max: name === "sodiumMilligrams" ? "9999999" : "999999.999",
      step: name === "sodiumMilligrams" ? "1" : "0.001",
    });
  }
  await act(async () => input(renderer, "name").props.onChange({ target: { value: "Tortilla" } }));
  expect(input(renderer, "name").props.value).toBe("Tortilla");

  expect(input(renderer, "idempotencyKey").props.value).toBe("manual-form-key");
  expect(input(renderer, "intent").props.value).toBe("log-manual-food");

  await act(async () =>
    input(renderer, "energyKcal").props.onChange({
      target: { value: "180" },
    }),
  );
  await act(async () =>
    input(renderer, "proteinGrams").props.onChange({
      target: { value: "6" },
    }),
  );
  await act(async () =>
    input(renderer, "quantity").props.onChange({
      target: { value: "3" },
    }),
  );
  expect(input(renderer, "quantity").props.value).toBe("3");
  expect(input(renderer, "name").props.value).toBe("Tortilla");
  expect(input(renderer, "energyKcal").props.value).toBe("180");
  expect(input(renderer, "proteinGrams").props.value).toBe("6");
  await act(async () => renderer.unmount());

  const draft = {
    carbohydrateGrams: "20.1",
    date: "2026-08-31",
    energyKcal: "-180",
    fatGrams: "4",
    fiberGrams: "2",
    idempotencyKey: "manual-draft-key",
    intent: "log-manual-food",
    name: "Incomplete tortilla",
    proteinGrams: "6",
    quantity: "3",
    sodiumMilligrams: "100",
    sugarGrams: "1.5",
  };
  const invalid = await renderHome(
    { catalog },
    {
      manualFoodDraft: draft,
      message: "The Food Entry request is invalid.",
      tone: "error",
    },
  );
  expect(input(invalid, "name").props.value).toBe("Incomplete tortilla");
  for (const name of ["energyKcal", "proteinGrams", "carbohydrateGrams", "fatGrams", "fiberGrams", "sugarGrams", "sodiumMilligrams"] as const) {
    expect(input(invalid, name).props.value).toBe(draft[name]);
  }

  expect(input(invalid, "quantity").props.value).toBe("3");
  expect(input(invalid, "idempotencyKey").props.value).toBe("manual-draft-key");
  expect(allText(invalid)).toContain("The Food Entry request is invalid.");
  await act(async () => invalid.unmount());
});

test("barcode mode separates confirmation from scanning while keeping errors recoverable", async () => {
  for (const catalog of [
    { barcode: "", mode: "barcode", query: "" },
    {
      barcode: "0000000000004",
      message: "Open Food Facts is unavailable right now. Retry in a moment.",
      mode: "barcode",
      query: "",
      title: "Open Food Facts is unavailable",
    },
  ] as const) {
    const renderer = await renderHome({ catalog });
    expect(semanticDom(renderer)).toMatchSnapshot();
    expect(input(renderer, "barcode")).toBeDefined();
    expect(allText(renderer)).toContain("Enter barcode");
    expect(allText(renderer)).toContain("Use camera");
    expect(allText(renderer)).toContain("Frames stay on this device");
    expect(renderer.root.findByProps({
      href: "/?date=2026-08-31&food=search",
    })).toBeDefined();
    expect(renderer.root.findAllByType("img")).toHaveLength(0);
    await act(async () => renderer.unmount());
  }

  const detail = await renderHome({
    catalog: {
      barcode: "034000470693",
      food: barcodeFood,
      idempotencyKey: "off-detail",
      mode: "barcode",
      query: "",
    },
  });
  const text = allText(detail);
  expect(semanticDom(detail)).toMatchSnapshot();
  expect(text).toContain("Example cereal");
  expect(text).toContain("0034000470693");
  expect(text).toContain("Open Food Facts");
  expect(text).toContain("1 serving");
  expect(text).toContain("180 kcal");
  expect(text).toContain("24 g");
  expect(text).toContain("0 g");
  expect(text).toContain("Not reported");
  expect(text).toContain("Fiber2 g");
  expect(text).toContain("Sugar5 g");
  expect(text).toContain("Sodium150 mg");
  expect(text).toContain("Add to Food Log");
  expect(text).not.toContain("Enter barcode");
  expect(text).not.toContain("Use camera");
  expect(input(detail, "barcode")).toBeUndefined();
  expect(detail.root.findByProps({
    href: "/?date=2026-08-31&food=barcode",
  })).toBeDefined();
  expect(input(detail, "idempotencyKey").props.value).toBe("off-detail");
  expect(input(detail, "provider").props.value).toBe("open-food-facts");
  expect(input(detail, "providerFoodId").props.value).toBe("0034000470693");
  expect(input(detail, "selectedMeasurementId").props.value).toBe("serving");
  expect(input(detail, "quantity").props.value).toBe("1");
  const confirmationForm = detail.root.findAllByType("form").find(
    (form) =>
      form.findAllByProps({ name: "intent" })[0]?.props.value === "log-food",
  )!;
  expect(
    confirmationForm
      .findAllByType("input")
      .map((field) => field.props.name)
      .sort(),
  ).toEqual([
    "csrfToken",
    "date",
    "idempotencyKey",
    "intent",
    "provider",
    "providerFoodId",
    "quantity",
    "selectedMeasurementId",
  ]);
  await act(async () =>
    input(detail, "quantity").props.onChange({
      currentTarget: { value: "0.5" },
    }),
  );
  expect(nodeText(detail.root.findByType("dl"))).toContain("90 kcal");
  expect(nodeText(detail.root.findByType("dl"))).toContain("12 g");
  expect(nodeText(detail.root.findByType("dl"))).toContain("75 mg");
  await act(async () =>
    input(detail, "quantity").props.onChange({
      currentTarget: { value: "2" },
    }),
  );
  expect(nodeText(detail.root.findByType("dl"))).toContain("360 kcal");
  expect(nodeText(detail.root.findByType("dl"))).toContain("48 g");
  await act(async () =>
    input(detail, "quantity").props.onChange({ currentTarget: { value: "" } }),
  );
  expect(
    detail.root.findAllByType("button").find(
      (button) => nodeText(button) === "Add to Food Log",
    )!.props.disabled,
  ).toBe(true);
  expect(nodeText(detail.root.findByType("dl"))).toContain("0 kcal");
  await act(async () => detail.unmount());

  const unnamed = await renderHome({
    catalog: {
      barcode: "0000000000006",
      food: {
        ...barcodeFood,
        barcode: "0000000000006",
        name: "Unnamed product",
        nutritionPerAuthoritativeBase: {
          ...barcodeFood.nutritionPerAuthoritativeBase,
          proteinMilligrams: { amount: 6, fixedPointMultiplier: 1_000 },
        },
        originalName: "Unnamed product",
        providerFoodId: "0000000000006",
      },
      idempotencyKey: "off-unnamed",
      mode: "barcode",
      query: "",
    },
  });
  expect(semanticDom(unnamed)).toMatchSnapshot();
  expect(allText(unnamed)).toContain("Unnamed product · 0000000000006");
  expect(allText(unnamed)).toContain("6 g");
  await act(async () => unnamed.unmount());

  const failedConfirmation = await renderHome(
    {
      catalog: {
        barcode: "034000470693",
        food: barcodeFood,
        idempotencyKey: "off-error",
        mode: "barcode",
        query: "",
      },
    },
    {
      message: "Open Food Facts is unavailable right now. Retry in a moment.",
      tone: "error",
    },
  );
  expect(failedConfirmation.root.findByProps({ role: "alert" })).toBeDefined();
  expect(allText(failedConfirmation)).toContain(
    "Open Food Facts is unavailable right now. Retry in a moment.",
  );
  await act(async () => failedConfirmation.unmount());

  const missingMeasurement = await renderHome({
    catalog: {
      barcode: "034000470693",
      food: { ...barcodeFood, measurements: [] },
      idempotencyKey: "off-no-measurement",
      mode: "barcode",
      query: "",
    },
  });
  expect(input(missingMeasurement, "selectedMeasurementId").props.value).toBe("");
  await act(async () => missingMeasurement.unmount());
});

test("barcode entry validates client-side and exposes only matching navigation as pending", async () => {
  const renderer = await renderHome({
    catalog: { barcode: "", mode: "barcode", query: "" },
  });
  const barcodeInput = input(renderer, "barcode");
  const form = renderer.root.findAllByType("form").find((candidate) =>
    candidate.findAllByProps({ name: "barcode" }).length > 0
  )!;
  let prevented = 0;
  const submitEvent = () => ({
    defaultPrevented: true,
    nativeEvent: { submitter: null },
    preventDefault: () => {
      prevented += 1;
    },
  });
  await act(async () => form.props.onSubmit(submitEvent()));
  expect(prevented).toBe(1);
  expect(allText(renderer)).toContain("Barcode not valid");
  expect(barcodeInput.props["aria-invalid"]).toBe(true);
  expect(barcodeInput.props["aria-describedby"]).toBe("barcode-input-error");

  await act(async () => barcodeInput.props.onChange({
    currentTarget: { value: "034000470693" },
  }));
  expect(input(renderer, "barcode").props["aria-invalid"]).toBeUndefined();
  await act(async () => form.props.onSubmit(submitEvent()));
  expect(prevented).toBe(1);
  await act(async () => renderer.unmount());

  const pending = await renderPendingHome(
    { catalog: { barcode: "034000470693", mode: "barcode", query: "" } },
    { to: "/?food=barcode&barcode=034000470693" },
  );
  expect(allText(pending)).toContain("Checking Open Food Facts");
  await act(async () => pending.unmount());

  const otherNavigation = await renderPendingHome(
    { catalog: { barcode: "034000470693", mode: "barcode", query: "" } },
    { to: "/?food=search&query=yogurt" },
  );
  expect(allText(otherNavigation)).not.toContain("Checking Open Food Facts");
  await act(async () => otherNavigation.unmount());

  const unknownNavigation = await renderPendingHome(
    { catalog: { barcode: "034000470693", mode: "barcode", query: "" } },
    { to: "/?unrelated=1" },
  );
  expect(allText(unknownNavigation)).not.toContain("Checking Open Food Facts");
  await act(async () => unknownNavigation.unmount());
});

test("USDA search validates its controlled query before navigation", async () => {
  const renderer = await renderHome({
    catalog: { mode: "search", query: "", results: [] },
  });
  const queryInput = input(renderer, "query");
  const form = renderer.root.findAllByType("form").find((candidate) =>
    candidate.findAllByProps({ name: "query" }).length > 0
  )!;
  let prevented = 0;
  const submitEvent = () => ({
    defaultPrevented: true,
    nativeEvent: { submitter: null },
    preventDefault: () => {
      prevented += 1;
    },
  });
  await act(async () => form.props.onSubmit(submitEvent()));
  expect(prevented).toBe(1);
  expect(allText(renderer)).toContain(
    "Enter a trimmed food search from 2 to 100 characters.",
  );
  await act(async () => queryInput.props.onChange({
    currentTarget: { value: "yogurt" },
  }));
  await act(async () => form.props.onSubmit(submitEvent()));
  expect(prevented).toBe(1);
  await act(async () => renderer.unmount());
});

test("home catalog renders initial, empty, failure, and selectable result states", async () => {
  queriedSelectors.length = 0;
  documentSelectors.length = 0;
  const states = [
    [{ mode: "search", query: "", results: [] }, "Find a food"],
    [{ mode: "search", query: "none", results: [] }, "No foods found"],
    [
      { message: "Catalog failed", mode: "search", query: "error", results: [], title: "Search unavailable" },
      "Search unavailable",
    ],
    [
      { message: "Untitled failure", mode: "search", query: "error", results: [] },
      "Search unavailable",
    ],
  ] as const;
  for (const [catalog, expected] of states) {
    const renderer = await renderHome({ catalog });
    expect(semanticDom(renderer)).toMatchSnapshot();
    expect(renderer.root.findByProps({ role: "dialog" }).props["aria-labelledby"])
      .toBe("food-dialog-title");
    expect(allText(renderer)).toContain("Add Food");
    expect(allText(renderer)).toContain(expected);
    expect(input(renderer, "csrfToken").props.value).toBe("home-component-csrf");
    await act(async () => renderer.unmount());
  }

  const results = [
    {
      barcode: null,
      brand: "Example Dairy",
      dataType: "Branded",
      isSelectable: true,
      measurementSummary: "100 g",
      name: "Selectable yogurt",
      provider: "usda-fdc",
      providerFoodId: "1001",
      providerPublishedDate: "2026-04-01",
    },
    {
      barcode: null,
      brand: null,
      dataType: "Foundation",
      isSelectable: false,
      measurementSummary: null,
      name: "Unsafe food",
      provider: "usda-fdc",
      providerFoodId: "9999",
      providerPublishedDate: null,
    },
  ];
  const catalogPreviousFocus = new TestElement();
  (globalThis.document as unknown as { activeElement: TestElement }).activeElement =
    catalogPreviousFocus;
  const renderer = await renderHome({
    catalog: { mode: "search", query: "yogurt", results },
  });
  expect(semanticDom(renderer)).toMatchSnapshot();
  expect(renderer.root.findByProps({ "aria-label": "USDA search results" }))
    .toBeDefined();
  expect(queriedSelectors).toContain(
    'input:not([type="hidden"]):not([disabled]), button:not([disabled]), select:not([disabled]), a[href]',
  );
  expect(renderer.root.findByProps({ href: "/?date=2026-08-31&food=1001&query=yogurt" }))
    .toBeDefined();
  expect(allText(renderer)).toContain("Example Dairy · 100 g");
  expect(allText(renderer)).toContain("Hidden in production");
  expect(renderer.root.findByProps({ "aria-disabled": "true" })).toBeDefined();
  const searchInput = input(renderer, "query");
  const searchForm = renderer.root.findAllByType("form").find(
    (form) => form.props.method === "get",
  )!;
  let preventedSearches = 0;
  const searchEvent = {
    defaultPrevented: false,
    nativeEvent: { submitter: null },
    preventDefault() {
      preventedSearches += 1;
      this.defaultPrevented = true;
    },
  };
  await act(async () => searchInput.props.onChange({
    currentTarget: { value: "x" },
  }));
  await act(async () => searchForm.props.onSubmit(searchEvent));
  expect(preventedSearches).toBe(1);
  expect(input(renderer, "query").props).toMatchObject({
    "aria-describedby": "food-search-error",
    "aria-invalid": true,
    value: "x",
  });
  expect(allText(renderer)).toContain(
    "Enter a trimmed food search from 2 to 100 characters.",
  );
  await act(async () => searchInput.props.onChange({
    currentTarget: { value: "valid query" },
  }));
  expect(preventedSearches).toBe(1);
  expect(input(renderer, "query").props["aria-invalid"]).toBeUndefined();
  catalogPreviousFocus.isConnected = false;
  documentRestoreTarget = new TestElement();
  (globalThis.document as unknown as { activeElement: TestElement }).activeElement =
    catalogPreviousFocus;
  await act(async () => renderer.unmount());
  expect(documentSelectors).toContain("[data-food-dialog-trigger]");

  const queryless = await renderHome({
    catalog: { mode: "search", query: "", results: [results[0]] },
  });
  expect(queryless.root.findByProps({
    href: "/?date=2026-08-31&food=1001",
  })).toBeDefined();
  await act(async () => queryless.unmount());

  const idleFallback = await renderHome({
    catalog: {
      message: "Food disappeared",
      mode: "search",
      query: "a",
      results: [],
      title: "Food no longer available",
    },
  }, undefined, "/?food=1001&query=a");
  expect(allText(idleFallback)).toContain("Food no longer available");
  expect(idleFallback.root.findAllByProps({ "aria-label": "Loading food details" }))
    .toHaveLength(0);
  await act(async () => idleFallback.unmount());
});

test("home catalog detail recalculates previews and exposes the log contract", async () => {
  const renderer = await renderHome({
    catalog: {
      food: catalogFood,
      idempotencyKey: "detail-idempotency",
      mode: "detail",
      query: "yogurt",
    },
  });
  expect(semanticDom(renderer)).toMatchSnapshot();
  expect(allText(renderer)).toContain("Plain Greek yogurt");
  expect(allText(renderer)).toContain("USDA FoodData Central · Example Dairy");
  expect(renderer.root.findAllByType("p").map(nodeText)).toContain(
    "USDA FoodData Central · Example Dairy",
  );
  expect(allText(renderer)).toContain("Saved as a Nutrition Snapshot");
  expect(input(renderer, "idempotencyKey").props.value).toBe("detail-idempotency");
  expect(input(renderer, "provider").props.value).toBe("usda-fdc");
  expect(renderer.root.findAllByProps({ name: "pendingFoodName" })).toHaveLength(0);
  expect(input(renderer, "providerFoodId").props.value).toBe("1001");
  expect(input(renderer, "quantity").props.value).toBe("1");
  expect(allText(renderer)).toContain("100.3 kcal");
  expect(allText(renderer)).toContain("17.9 g");
  expect(allText(renderer)).toContain("6 g");
  expect(allText(renderer)).toContain("0 g");

  await act(async () =>
    input(renderer, "quantity").props.onChange({ currentTarget: { value: "" } }),
  );
  expect(nodeText(renderer.root.findByType("dl"))).toContain("0 kcal");
  await act(async () =>
    input(renderer, "quantity").props.onChange({ currentTarget: { value: "-1" } }),
  );
  expect(nodeText(renderer.root.findByType("dl"))).toContain("0 kcal");

  const select = renderer.root.findByProps({ name: "selectedMeasurementId" });
  await act(async () => select.props.onChange({ currentTarget: { value: "base" } }));
  await act(async () =>
    input(renderer, "quantity").props.onChange({ currentTarget: { value: "2" } }),
  );
  expect(semanticDom(renderer)).toMatchSnapshot();
  expect(select.props.value).toBe("base");
  expect(input(renderer, "quantity").props.value).toBe("2");
  expect(allText(renderer)).toContain("118 kcal");
  expect(allText(renderer)).toContain("21 g");
  await act(async () => renderer.unmount());

  const unavailableMeasurement = await renderHome({
    catalog: {
      food: {
        ...catalogFood,
        brand: null,
        measurements: [],
        nutritionPerAuthoritativeBase: {
          ...catalogFood.nutritionPerAuthoritativeBase,
          energyMilliKcal: null,
        },
      },
      idempotencyKey: "no-measurement",
      mode: "detail",
      query: "none",
    },
  });
  expect(semanticDom(unavailableMeasurement)).toMatchSnapshot();
  expect(unavailableMeasurement.root.findByProps({
    name: "selectedMeasurementId",
  }).props.value)
    .toBe("");
  expect(allText(unavailableMeasurement)).toContain("Not reported");
  expect(unavailableMeasurement.root.findAllByType("p").map(nodeText))
    .toContain("USDA FoodData Central");
  await act(async () => unavailableMeasurement.unmount());
});

const editableEntry = {
  authoritativeBaseQuantityMicrounits: 100_000_000,
  authoritativeNutrition: {
    carbohydrateMilligrams: { amount: 3.5, fixedPointMultiplier: 1_000 },
    energyMilliKcal: { amount: 59, fixedPointMultiplier: 1_000 },
    fatMilligrams: { amount: 0, fixedPointMultiplier: 1_000 },
    fiberMilligrams: null,
    proteinMilligrams: { amount: 10.5, fixedPointMultiplier: 1_000 },
    sodiumMilligrams: { amount: 36, fixedPointMultiplier: 1 },
    sugarMilligrams: { amount: 3.5, fixedPointMultiplier: 1_000 },
  },
  carbohydrateMilligrams: 3_001,
  dataType: "Branded",
  energyMilliKcal: 59_000,
  fatMilligrams: 0,
  fiberMilligrams: null,
  foodLogDate: "2026-08-31",
  id: 41,
  localEventTime: "12:00:00",
  name: "Editable yogurt",
  proteinMilligrams: 10_100,
  providerFoodId: "1001",
  quantityMicrounits: 1_000_000,
  selectedMeasurementId: "base",
  sodiumMilligrams: 36,
  sugarMilligrams: 3_500,
  supportedMeasurements: [
    { baseQuantityMicrounits: 100_000_000, id: "base", label: "100 g", unit: "g" },
    { baseQuantityMicrounits: 170_000_000, id: "serving", label: "1 container", unit: "g" },
  ],
  updatedAt: "2026-08-31T12:00:00.000Z",
};

test("home food editor exposes saved fields, recalculation, and delete confirmation", async () => {
  const renderer = await renderHome({ foodEntryEditor: editableEntry }, {
    message: "Editor validation message",
  });
  expect(semanticDom(renderer)).toMatchSnapshot();
  expect(renderer.root.findByProps({ role: "dialog" }).props["aria-labelledby"])
    .toBe("edit-food-entry-title");
  expect(input(renderer, "name").props.value).toBe("Editable yogurt");
  expect(input(renderer, "quantity").props.value).toBe("1");
  expect(input(renderer, "energyKcal").props.value).toBe("59");
  expect(input(renderer, "fiberGrams").props.value).toBe("");
  expect(input(renderer, "sodiumMilligrams").props.value).toBe("36");
  expect(allText(renderer)).toContain("Editor validation message");

  await act(async () =>
    input(renderer, "name").props.onChange({ target: { value: "Renamed yogurt" } }),
  );
  expect(input(renderer, "name").props.value).toBe("Renamed yogurt");
  await act(async () =>
    input(renderer, "energyKcal").props.onChange({ target: { value: "61" } }),
  );
  expect(input(renderer, "energyKcal").props.value).toBe("61");
  const select = renderer.root.findByProps({ name: "selectedMeasurementId" });
  await act(async () => select.props.onChange({ target: { value: "serving" } }));
  expect(semanticDom(renderer)).toMatchSnapshot();
  expect(input(renderer, "energyKcal").props.value).toBe("100.3");
  expect(input(renderer, "proteinGrams").props.value).toBe("17.85");
  expect(input(renderer, "fiberGrams").props.value).toBe("");

  await act(async () => select.props.onChange({ target: { value: "missing" } }));
  expect(renderer.root.findByProps({ name: "selectedMeasurementId" }).props.value)
    .toBe("missing");
  expect(input(renderer, "energyKcal").props.value).toBe("100.3");
  await act(async () =>
    input(renderer, "quantity").props.onChange({ target: { value: "" } }),
  );
  expect(input(renderer, "quantity").props.value).toBe("");
  expect(input(renderer, "energyKcal").props.value).toBe("100.3");

  const deleteButton = renderer.root.findAllByType("button").find(
    (button) => nodeText(button) === "Delete entry",
  )!;
  await act(async () => deleteButton.props.onClick());
  expect(semanticDom(renderer)).toMatchSnapshot();
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(2);
  expect(allText(renderer)).toContain("Delete this Food Entry?");
  const keepButton = renderer.root.findAllByType("button").find(
    (button) => nodeText(button) === "Keep it",
  )!;
  await act(async () => keepButton.props.onClick());
  expect(allText(renderer)).not.toContain("Delete this Food Entry?");
  await act(async () => renderer.unmount());
});

test("manual Food Entry editor keeps calories required", async () => {
  const renderer = await renderHome({
    foodEntryEditor: { ...editableEntry, provider: "manual" },
  });

  expect(input(renderer, "energyKcal").props.required).toBe(true);
  expect(input(renderer, "proteinGrams").props.required).toBeUndefined();
  await act(async () => renderer.unmount());
});

test("home water dialogs cover create, presets, exact values, edit, and deletion", async () => {
  queriedSelectors.length = 0;
  documentSelectors.length = 0;
  const waterPreviousFocus = new TestElement();
  (globalThis.document as unknown as { activeElement: TestElement }).activeElement =
    waterPreviousFocus;
  const createDialog = await renderHome({ waterDialog: { mode: "create" } });
  expect(semanticDom(createDialog)).toMatchSnapshot();
  expect(allText(createDialog)).toContain("Add Water");
  expect(queriedSelectors).toContain("button:not([disabled])");
  expect(input(createDialog, "waterSelection").props.value).toBe("8");
  expect(allText(createDialog)).toContain("Add 8 fl oz");
  const large = createDialog.root.findAllByType("button").find(
    (button) => nodeText(button).includes("Large"),
  )!;
  await act(async () => large.props.onClick());
  expect(input(createDialog, "waterSelection").props.value).toBe("24");
  expect(allText(createDialog)).toContain("Add 24 fl oz");
  const exact = createDialog.root.findAllByType("button").find(
    (button) => nodeText(button).includes("ExactamountCustom"),
  )!;
  await act(async () => exact.props.onClick());
  expect(input(createDialog, "waterSelection").props.value).toBe("exact");
  expect(input(createDialog, "waterAmount").props).toMatchObject({
    "aria-label": "Amount fl oz",
    max: "500",
    min: "0.001",
    step: "0.001",
    value: "12",
  });
  await act(async () =>
    input(createDialog, "waterAmount").props.onChange({ target: { value: "13.5" } }),
  );
  expect(semanticDom(createDialog)).toMatchSnapshot();
  expect(input(createDialog, "waterAmount").props.value).toBe("13.5");
  expect(allText(createDialog)).toContain("Add exact amount");
  waterPreviousFocus.isConnected = false;
  documentRestoreTarget = new TestElement();
  await act(async () => createDialog.unmount());
  expect(documentSelectors).toContain(
    "[data-water-editor-trigger], [data-water-dialog-trigger]",
  );

  const event = {
    amountMicroliters: 473_176,
    foodLogDate: "2026-08-31",
    id: 51,
    localEventTime: "13:15:00",
    updatedAt: "2026-08-31T13:15:00.000Z",
  };
  const edit = await renderHome({
    foodLog: {
      ...baseFoodLog,
      displayUnits: "metric",
      waterTotalMicroliters: 3_000_000,
    },
    waterDialog: { event, mode: "edit" },
  }, { message: "Water validation message" });
  expect(semanticDom(edit)).toMatchSnapshot();
  expect(allText(edit)).toContain("Edit Water Event");
  expect(input(edit, "waterSelection").props.value).toBe("16");
  expect(input(edit, "eventId").props.value).toBe(51);
  expect(input(edit, "waterEventTime").props.defaultValue).toBe("13:15");
  expect(allText(edit)).toContain("Water validation message");
  expect(edit.root.findByProps({ "aria-label": "Water progress" }).props)
    .toMatchObject({
      "aria-valuemax": 2365.882,
      "aria-valuenow": 2365.882,
      "aria-valuetext": "3,000 of 2,365.882 ml target",
      style: { "--progress": "100%" },
    });
  const deleteButton = edit.root.findAllByType("button").find(
    (button) => nodeText(button) === "Delete Water Event",
  )!;
  await act(async () => deleteButton.props.onClick());
  expect(semanticDom(edit)).toMatchSnapshot();
  expect(allText(edit)).toContain("Delete this Water Event?");
  expect(allText(edit)).toContain("The daily water total will decrease by this amount.");
  const keepButton = edit.root.findAllByType("button").find(
    (button) => nodeText(button) === "Keep it",
  )!;
  await act(async () => keepButton.props.onClick());
  expect(allText(edit)).not.toContain("Delete this Water Event?");
  await act(async () => edit.unmount());

  const customEvent = {
    ...event,
    amountMicroliters: 400_010,
    id: 52,
    updatedAt: "2026-08-31T13:16:00.000Z",
  };
  const custom = await renderHome({
    foodLog: {
      ...baseFoodLog,
      displayUnits: "metric",
      waterTotalMicroliters: 3_000_000,
    },
    waterDialog: { event: customEvent, mode: "edit" },
  });
  expect(semanticDom(custom)).toMatchSnapshot();
  expect(input(custom, "waterSelection").props.value).toBe("exact");
  expect(input(custom, "waterAmount").props.value).toBe("400.01");
  await act(async () => custom.unmount());

  const trailingZeros = await renderHome({
    foodLog: { ...baseFoodLog, displayUnits: "metric" },
    waterDialog: {
      event: { ...customEvent, amountMicroliters: 400_100, id: 53 },
      mode: "edit",
    },
  });
  expect(input(trailingZeros, "waterAmount").props.value).toBe("400.1");
  await act(async () => trailingZeros.unmount());

  const metricCreate = await renderHome({
    foodLog: {
      ...baseFoodLog,
      displayUnits: "metric",
      events: [{ ...event, kind: "water" }],
      waterTotalMicroliters: 1_000_000,
    },
    waterDialog: { mode: "create" },
  });
  expect(allText(metricCreate)).toContain("Add 237 ml");
  expect(allText(metricCreate)).toContain("473.176 ml");
  expect(metricCreate.root.findByProps({ "aria-label": "Water progress" }).props)
    .toMatchObject({ "aria-valuenow": 1000 });
  const metricExact = metricCreate.root.findAllByType("button").find(
    (button) => nodeText(button).includes("ExactamountCustom"),
  )!;
  await act(async () => metricExact.props.onClick());
  expect(input(metricCreate, "waterAmount").props.value).toBe("355");
  expect(allText(metricCreate)).toContain("237mlGlass");
  expect(allText(metricCreate)).toContain("473mlBottle");
  expect(allText(metricCreate)).toContain("710mlLarge");
  await act(async () => metricCreate.unmount());

  const actionEditor = await renderHome({}, {
    message: "Reloaded conflicting Water Event",
    waterEventEditor: event,
  });
  expect(allText(actionEditor)).toContain("Edit Water Event");
  expect(allText(actionEditor)).toContain("Reloaded conflicting Water Event");
  expect(input(actionEditor, "eventId").props.value).toBe(51);
  await act(async () => actionEditor.unmount());
});

test("home renders submission and navigation pending states", async () => {
  const logFood = new FormData();
  logFood.set("intent", "log-food");
  const pendingFood = await renderPendingHome(
    {
      catalog: {
        food: catalogFood,
        idempotencyKey: "pending",
        mode: "detail",
        query: "yogurt",
      },
      foodLog: {
        ...baseFoodLog,
        events: [{
          dataType: "Branded",
          energyMilliKcal: 59_000,
          foodLogDate: "2026-08-31",
          id: 71,
          kind: "food",
          localEventTime: "12:00:00",
          name: "Existing food",
          quantityMicrounits: 1_000_000,
          selectedMeasurementLabel: "100 g",
        }],
      },
    },
    { formData: logFood, to: "/" },
  );
  expect(semanticDom(pendingFood)).toMatchSnapshot();
  expect(allText(pendingFood)).toContain("Plain Greek yogurt");
  expect(pendingFood.root.findByProps({
    "aria-label": "Adding food to Daily log",
  })).toBeDefined();
  expect(pendingFood.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
  await act(async () => pendingFood.unmount());

  const openFoodFactsPending = await renderPendingHome(
    {
      catalog: {
        barcode: "034000470693",
        food: barcodeFood,
        idempotencyKey: "off-pending",
        mode: "barcode",
        query: "",
      },
    },
    { formData: logFood, to: "/" },
  );
  expect(allText(openFoodFactsPending)).toContain("Example cereal");
  await act(async () => openFoodFactsPending.unmount());

  const unnamedLogFood = new FormData();
  unnamedLogFood.set("intent", "log-food");
  const unnamedPendingFood = await renderPendingHome({}, {
    formData: unnamedLogFood,
    to: "/",
  });
  expect(allText(unnamedPendingFood)).toContain("Selected food");
  await act(async () => unnamedPendingFood.unmount());

  const updateFood = new FormData();
  updateFood.set("entryId", "41");
  updateFood.set("intent", "update-food");
  const pendingEditor = await renderPendingHome(
    { foodEntryEditor: editableEntry },
    { formData: updateFood, to: "/" },
  );
  expect(semanticDom(pendingEditor)).toMatchSnapshot();
  expect(pendingEditor.root.findByType("fieldset").props.disabled).toBe(true);
  expect(allText(pendingEditor)).toContain("Saving…");
  await act(async () => pendingEditor.unmount());

  const deleteFood = new FormData();
  deleteFood.set("entryId", "41");
  deleteFood.set("intent", "delete-food");
  const deletingEditor = await renderPendingHome(
    { foodEntryEditor: editableEntry },
    { formData: deleteFood, to: "/" },
  );
  const revealFoodDelete = deletingEditor.root.findAllByType("button").find(
    (button) => nodeText(button) === "Delete entry",
  )!;
  await act(async () => revealFoodDelete.props.onClick());
  expect(allText(deletingEditor)).toContain("Deleting…");
  await act(async () => deletingEditor.unmount());

  const wrongFood = new FormData();
  wrongFood.set("entryId", "999");
  wrongFood.set("intent", "update-food");
  const idleEditor = await renderPendingHome(
    { foodEntryEditor: editableEntry },
    { formData: wrongFood, to: "/" },
  );
  expect(idleEditor.root.findByType("fieldset").props.disabled).toBe(false);
  expect(allText(idleEditor)).toContain("Save changes");
  await act(async () => idleEditor.unmount());

  const createWater = new FormData();
  createWater.set("intent", "create-water");
  const pendingWater = await renderPendingHome(
    { waterDialog: { mode: "create" } },
    { formData: createWater, to: "/" },
  );
  expect(semanticDom(pendingWater)).toMatchSnapshot();
  expect(pendingWater.root.findByType("fieldset").props.disabled).toBe(true);
  expect(allText(pendingWater)).toContain("Adding…");
  await act(async () => pendingWater.unmount());

  const updateWater = new FormData();
  updateWater.set("eventId", "51");
  updateWater.set("intent", "update-water");
  const pendingWaterEdit = await renderPendingHome(
    {
      waterDialog: {
        event: {
          amountMicroliters: 473_176,
          foodLogDate: "2026-08-31",
          id: 51,
          localEventTime: "13:15:00",
          updatedAt: "2026-08-31T13:15:00.000Z",
        },
        mode: "edit",
      },
    },
    { formData: updateWater, to: "/" },
  );
  expect(pendingWaterEdit.root.findByType("fieldset").props.disabled).toBe(true);
  expect(allText(pendingWaterEdit)).toContain("Saving…");
  await act(async () => pendingWaterEdit.unmount());

  const deleteWater = new FormData();
  deleteWater.set("eventId", "51");
  deleteWater.set("intent", "delete-water");
  const deletingWater = await renderPendingHome(
    {
      waterDialog: {
        event: {
          amountMicroliters: 473_176,
          foodLogDate: "2026-08-31",
          id: 51,
          localEventTime: "13:15:00",
          updatedAt: "2026-08-31T13:15:00.000Z",
        },
        mode: "edit",
      },
    },
    { formData: deleteWater, to: "/" },
  );
  const revealWaterDelete = deletingWater.root.findAllByType("button").find(
    (button) => nodeText(button) === "Delete Water Event",
  )!;
  await act(async () => revealWaterDelete.props.onClick());
  expect(allText(deletingWater)).toContain("Deleting…");
  await act(async () => deletingWater.unmount());

  const wrongWater = new FormData();
  wrongWater.set("eventId", "999");
  wrongWater.set("intent", "update-water");
  const idleWater = await renderPendingHome(
    { waterDialog: { mode: "create" } },
    { formData: wrongWater, to: "/" },
  );
  expect(idleWater.root.findByType("fieldset").props.disabled).toBe(false);
  expect(allText(idleWater)).toContain("Add 8 fl oz");
  await act(async () => idleWater.unmount());

  const search = await renderPendingHome(
    { catalog: { mode: "search", query: "", results: [] } },
    { to: "/?food=search&query=yogurt" },
  );
  expect(semanticDom(search)).toMatchSnapshot();
  expect(allText(search)).toContain("Searching USDA FoodData Central");
  await act(async () => search.unmount());

  const detail = await renderPendingHome(
    { catalog: { mode: "search", query: "yogurt", results: [] } },
    { to: "/?food=1001&query=yogurt" },
  );
  expect(semanticDom(detail)).toMatchSnapshot();
  expect(detail.root.findByProps({ "aria-label": "Loading food details" }))
    .toBeDefined();
  await act(async () => detail.unmount());

  const unrelated = await renderPendingHome(
    { catalog: { mode: "search", query: "", results: [] } },
    { to: "/?other=1" },
  );
  expect(allText(unrelated)).toContain("Searching USDA FoodData Central");
  expect(unrelated.root.findAllByProps({ "aria-label": "Loading food details" }))
    .toHaveLength(0);
  await act(async () => unrelated.unmount());

  const detailCatalogDuringLoad = await renderPendingHome(
    {
      catalog: {
        food: catalogFood,
        idempotencyKey: "loading-detail",
        mode: "detail",
        query: "yogurt",
      },
    },
    { to: "/?food=1001&query=yogurt" },
  );
  expect(allText(detailCatalogDuringLoad)).toContain("Plain Greek yogurt");
  expect(detailCatalogDuringLoad.root.findAllByProps({
    "aria-label": "Loading food details",
  })).toHaveLength(0);
  await act(async () => detailCatalogDuringLoad.unmount());
});

test("home modal keyboard and backdrop behavior is observable", async () => {
  queriedSelectors.length = 0;
  queriedAllSelectors.length = 0;
  documentSelectors.length = 0;
  documentRestoreTarget = null;
  const previousFocus = new TestElement();
  (globalThis.document as unknown as { activeElement: TestElement }).activeElement =
    previousFocus;
  globalThis.document.body.style.overflow = "scroll";
  const renderer = await renderHome({ foodEntryEditor: editableEntry });
  expect(globalThis.document.body.style.overflow).toBe("hidden");
  expect(globalThis.document.activeElement).toBe(modalFocusables[0]);
  expect(queriedSelectors).toContain("input:not([disabled])");
  const dialog = renderer.root.findByProps({ role: "dialog" });
  let prevented = 0;
  (globalThis.document as unknown as { activeElement: TestElement }).activeElement =
    modalFocusables[0];
  await act(async () => dialog.props.onKeyDown({
    key: "Tab",
    preventDefault: () => { prevented += 1; },
    shiftKey: true,
  }));
  expect(prevented).toBe(1);
  expect(globalThis.document.activeElement).toBe(modalFocusables[3]);

  await act(async () => dialog.props.onKeyDown({
    key: "Tab",
    preventDefault: () => { prevented += 1; },
    shiftKey: false,
  }));
  expect(prevented).toBe(2);
  expect(globalThis.document.activeElement).toBe(modalFocusables[0]);
  expect(queriedAllSelectors).toContain(
    'button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), a[href]',
  );

  (globalThis.document as unknown as { activeElement: TestElement }).activeElement =
    modalFocusables[3];
  await act(async () => dialog.props.onKeyDown({
    key: "Tab",
    preventDefault: () => { prevented += 1; },
    shiftKey: true,
  }));
  expect(prevented).toBe(2);
  expect(globalThis.document.activeElement).toBe(modalFocusables[3]);

  (globalThis.document as unknown as { activeElement: TestElement }).activeElement =
    modalFocusables[2];
  await act(async () => dialog.props.onKeyDown({
    key: "Tab",
    preventDefault: () => { prevented += 1; },
    shiftKey: false,
  }));
  expect(prevented).toBe(2);
  expect(globalThis.document.activeElement).toBe(modalFocusables[2]);

  (globalThis.document as unknown as { activeElement: TestElement }).activeElement =
    modalFocusables[3];
  await act(async () => dialog.props.onKeyDown({
    key: "Enter",
    preventDefault: () => { prevented += 1; },
    shiftKey: false,
  }));
  expect(prevented).toBe(2);
  expect(globalThis.document.activeElement).toBe(modalFocusables[3]);
  expect(lastNodeMock).toBeDefined();
  previousFocus.isConnected = false;
  documentRestoreTarget = new TestElement();
  await act(async () => dialog.props.onKeyDown({
    key: "Escape",
    preventDefault: () => { prevented += 1; },
    shiftKey: false,
  }));
  expect(prevented).toBe(3);
  expect(renderer.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
  expect(documentSelectors).toContain("[data-entry-editor-trigger]");
  expect(globalThis.document.activeElement).toBe(documentRestoreTarget);
  await act(async () => renderer.unmount());
  expect(globalThis.document.body.style.overflow).not.toBe("hidden");
});

test("home modal closes only from a direct backdrop click", async () => {
  const connectedPreviousFocus = new TestElement();
  documentRestoreTarget = null;
  (globalThis.document as unknown as { activeElement: TestElement }).activeElement =
    connectedPreviousFocus;
  const renderer = await renderHome({
    catalog: { mode: "search", query: "", results: [] },
  });
  const backdrop = renderer.root.findAllByType("div").find(
    (node) => typeof node.props.onClick === "function",
  )!;
  await act(async () => backdrop.props.onClick({
    currentTarget: {},
    target: {},
  }));
  expect(renderer.root.findAllByProps({ role: "dialog" })).toHaveLength(1);
  const backdropElement = {};
  await act(async () => backdrop.props.onClick({
    currentTarget: backdropElement,
    target: backdropElement,
  }));
  expect(renderer.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
  expect(globalThis.document.activeElement).toBe(connectedPreviousFocus);
  await act(async () => renderer.unmount());
});

test("copy calendar links preserve the source and destination, highlight dates and restore focus", async () => {
  queriedSelectors.length = 0;
  documentSelectors.length = 0;
  const originalFocus = new TestElement();
  originalFocus.focus();
  const entry = { foodLogDate: "2026-08-28", id: 93, name: "Historical yogurt" };
  const calendar = buildCalendarMonth("2026-08", "2026-09-05", "2026-08-29");
  const renderer = await renderHome({
    copyDialog: {
      calendar: { ...calendar, days: calendar.days.map((day) => ({ ...day, isSource: day.date === entry.foodLogDate })) },
      destinationDate: "2026-08-29", entry, idempotencyKey: "copy:93:calendar",
    },
  }, { tone: "error", message: "The copy could not be saved. Try again." });
  expect(queriedSelectors).toContain("[data-copy-calendar-day]");
  const dialog = renderer.root.findByProps({ role: "dialog" });
  expect(dialog.props.className).toBe(`${styles.foodDialog} ${styles.copyFoodDialog}`);
  expect(nodeText(dialog.findByProps({ role: "alert" }))).toBe("The copy could not be saved. Try again.");
  expect(dialog.findByProps({ "aria-label": "Previous month" }).props.to).toBe("/?date=2026-08-28&copy=93&copyDate=2026-08-29&copyMonth=2026-07");
  expect(dialog.findByProps({ "aria-label": "Next month" }).props.to).toBe("/?date=2026-08-28&copy=93&copyDate=2026-08-29&copyMonth=2026-09");
  const grid = dialog.findByProps({ "aria-label": "August 2026 destination calendar" });
  expect(grid.findAllByProps({ className: styles.weekday }).map(nodeText)).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  expect(grid.findAllByProps({ "aria-hidden": "true" })).toHaveLength(6);
  const selected = grid.findByProps({ "aria-label": "Saturday, August 29" });
  expect(selected.props).toMatchObject({
    "aria-current": "date", className: `${styles.calendarDay} ${styles.calendarSelected}`,
    to: "/?date=2026-08-28&copy=93&copyDate=2026-08-29&copyMonth=2026-08",
  });
  expect(grid.findByProps({ "aria-label": "Sunday, August 30" }).props).toMatchObject({
    "aria-current": undefined, className: styles.calendarDay,
    to: "/?date=2026-08-28&copy=93&copyDate=2026-08-30&copyMonth=2026-08",
  });
  expect(grid.findByProps({ "aria-label": "Friday, August 28" }).props).toMatchObject({ disabled: true, className: styles.calendarFuture });
  originalFocus.isConnected = false;
  await act(async () => renderer.unmount());
  expect(documentSelectors).toContain('[data-copy-date-trigger="93"]');
  originalFocus.isConnected = true;
});

test("copy confirmation needs a destination and locks only while submitting this entry", async () => {
  const entry = { foodLogDate: "2026-08-28", id: 93, name: "Historical yogurt" };
  const calendar = buildCalendarMonth("2026-08", "2026-08-30", "2026-08-30");
  const copyDialog = {
    calendar: { ...calendar, days: calendar.days.map((day) => ({ ...day, isSource: day.date === entry.foodLogDate })) },
    destinationDate: undefined as string | undefined, entry, idempotencyKey: "copy:93:pending",
  };
  const empty = await renderHome({ copyDialog });
  const confirm = (renderer: ReactTestRenderer) => renderer.root.findAllByType("button").find((button) => button.props.value === "copy-food-to-date")!;
  expect(allText(empty)).toContain("Choose an eligible date");
  expect(input(empty, "destinationDate").props.value).toBe("");
  expect(confirm(empty).props.disabled).toBe(true);
  expect(nodeText(confirm(empty))).toBe("Copy");
  expect(empty.root.findByProps({ "aria-label": "Sunday, August 30" }).props.className).toBe(`${styles.calendarDay} ${styles.calendarToday} ${styles.calendarSelected}`);
  await act(async () => empty.unmount());
  for (const [intent, entryId, pending] of [
    ["copy-food-to-date", "93", true],
    ["copy-food-to-date", "94", false],
    ["copy-food-to-today", "93", false],
  ] as const) {
    const formData = new FormData();
    formData.set("intent", intent);
    formData.set("entryId", entryId);
    const renderer = await renderPendingHome({ copyDialog: { ...copyDialog, destinationDate: "2026-08-30" } }, { formData, to: "/" });
    expect(confirm(renderer).props.disabled).toBe(pending);
    expect(nodeText(confirm(renderer))).toBe(pending ? "Copying…" : "Copy");
    await act(async () => renderer.unmount());
  }
});

test("manual entry submission disables editing only for the manual action", async () => {
  for (const intent of ["log-manual-food", "copy-food-to-today"]) {
    const formData = new FormData();
    formData.set("intent", intent);
    const renderer = await renderPendingHome({ catalog: { mode: "manual", query: "", idempotencyKey: "manual-pending" } }, { formData, to: "/" });
    expect(renderer.root.findByType("fieldset").props.disabled).toBe(intent === "log-manual-food");
    expect(allText(renderer)).toContain(intent === "log-manual-food" ? "Adding…" : "Add to Food Log");
    await act(async () => renderer.unmount());
  }
});

test("photo meals appear once beside independent food and water events and expose correction details", async () => {
  const photoMeal = {
    id: "photo-home", name: "Photo dinner", entryId: editableEntry.id, foodLogDate: "2026-08-31", status: "succeeded", stage: "Preparing result", attemptId: "photo-attempt", startedAt: "2026-08-31T12:00:00.000Z", finishedAt: "2026-08-31T12:00:05.000Z", error: null, energyMilliKcal: 59000,
    result: { name: "Original dinner", consumedFraction: 1, components: [], assumptions: [] },
  };
  const food = { ...editableEntry, kind: "food", provider: "ai-photo", selectedMeasurementLabel: "Analyzed plate" };
  const copiedFood = { ...food, id: 77, name: "Copied photo" };
  const water = { id: editableEntry.id, kind: "water", amountMicroliters: 237000, foodLogDate: "2026-08-31", localEventTime: "12:05:00" };
  const renderer = await renderHome({ photoMeals: [photoMeal], foodLog: { ...baseFoodLog, entries: [food, copiedFood], events: [food, copiedFood, water] }, foodEntryEditor: editableEntry });
  expect(renderer.root.findAllByType("a").filter(node => node.props.href === "/?date=2026-08-31&entry=41")).toHaveLength(1);
  expect(allText(renderer)).toContain("Copied photo");
  expect(allText(renderer)).toContain("AI photo estimate");
  expect(allText(renderer)).toContain("Correct with AI");
  expect(allText(renderer)).toContain("Water");
  expect(renderer.root.findByProps({ "aria-label": "Photo analysis details" })).toBeDefined();
  await act(async () => renderer.unmount());
  const pending = await renderHome({ photoMeals: [{ ...photoMeal, status: "active", entryId: null, name: null, result: null, energyMilliKcal: null }] });
  expect(allText(pending)).not.toContain("No entries for this day");
  expect(allText(pending)).toContain("Cancel analysis");
  await act(async () => pending.unmount());
});

test("touch date navigation distinguishes taps, vertical scrolling, cancellation and horizontal swipes", async () => {
  const loaderData = { ...baseLoaderData, foodLog: { ...baseFoodLog, selectedDate: "2026-08-30" } };
  const router = createMemoryRouter([{ path: "/", Component: () => Home({ loaderData, actionData: undefined } as never), loader: () => loaderData }], { hydrationData: { loaderData: { "0": loaderData } }, initialEntries: ["/?date=2026-08-30"] });
  let renderer!: ReactTestRenderer;
  await act(() => { renderer = create(createElement(RouterProvider, { router })); });
  const rail = () => renderer.root.findByProps({ "aria-label": "Nearby dates" });
  let captured: number[] = [];
  const event = (overrides: Record<string, unknown> = {}) => ({ pointerType: "touch", isPrimary: true, pointerId: 1, clientX: 100, clientY: 100, currentTarget: { setPointerCapture: (id: number) => captured.push(id) }, ...overrides });
  const tapPrevented = () => {
    let prevented = false;
    rail().props.onClickCapture({ detail: 1, preventDefault: () => { prevented = true; } });
    return prevented;
  };
  expect(tapPrevented()).toBe(false);
  for (const begin of [{ pointerType: "mouse" }, { isPrimary: false }]) {
    await act(() => { rail().props.onPointerDown(event(begin)); rail().props.onPointerMove(event({ clientX: 160 })); rail().props.onPointerUp(event({ clientX: 160 })); });
    expect(router.state.location.search).toBe("?date=2026-08-30"); expect(captured).toEqual([]);
  }
  await act(() => { rail().props.onPointerDown(event()); rail().props.onPointerMove(event({ pointerId: 2, clientX: 160 })); rail().props.onPointerUp(event({ pointerId: 2, clientX: 160 })); });
  expect(captured).toEqual([]); expect(router.state.location.search).toBe("?date=2026-08-30");
  await act(() => { rail().props.onPointerDown(event()); rail().props.onPointerMove(event({ clientX: 107, clientY: 107 })); });
  expect(captured).toEqual([]); expect(tapPrevented()).toBe(false);
  await act(() => { rail().props.onPointerMove(event({ clientX: 108, clientY: 107 })); });
  expect(captured).toEqual([1]); expect(tapPrevented()).toBe(true);
  let keyboardPrevented = false;
  rail().props.onClickCapture({ detail: 0, preventDefault: () => { keyboardPrevented = true; } });
  expect(keyboardPrevented).toBe(false);
  await act(() => { rail().props.onPointerMove(event({ clientX: 108, clientY: 200 })); });
  expect(captured).toEqual([1, 1]);
  await act(() => { rail().props.onPointerCancel(); rail().props.onPointerUp(event({ clientX: 160 })); });
  expect(router.state.location.search).toBe("?date=2026-08-30");
  for (const [x, y] of [[107, 108], [108, 108], [105, 140]]) {
    captured = [];
    await act(() => { rail().props.onPointerDown(event()); rail().props.onPointerMove(event({ clientX: x, clientY: y })); rail().props.onPointerUp(event({ clientX: 160 })); });
    expect(captured).toEqual([]); expect(router.state.location.search).toBe("?date=2026-08-30"); expect(tapPrevented()).toBe(false);
  }
  for (const [x, y] of [[139, 100], [140, 140], [140, 150]]) {
    await act(() => { rail().props.onPointerDown(event()); rail().props.onPointerUp(event({ clientX: x, clientY: y })); });
    expect(router.state.location.search).toBe("?date=2026-08-30");
  }
  await act(() => { rail().props.onPointerDown(event()); rail().props.onPointerUp(event({ clientX: 140 })); });
  expect(router.state.location.search).toBe("?date=2026-08-29"); expect(router.state.preventScrollReset).toBe(true); expect(tapPrevented()).toBe(true);
  await act(() => { rail().props.onPointerDown(event()); rail().props.onPointerUp(event({ clientX: 60 })); });
  expect(router.state.location.search).toBe("?date=2026-08-31");
  await act(() => renderer.unmount()); router.dispose();
});
