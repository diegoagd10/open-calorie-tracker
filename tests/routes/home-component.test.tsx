/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- react-test-renderer host props are untyped */
/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- react-test-renderer host props are untyped */
import { createHash } from "node:crypto";

import { createElement } from "react";
import {
  createMemoryRouter,
  createRoutesStub,
  RouterProvider,
  useLoaderData,
} from "react-router";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, test, vi } from "vitest";

import { buildCalendarMonth, getNearbyLocalDates } from "../../app/food-log/date";
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
  lastFocusOptions: FocusOptions | undefined;
  lastScrollOptions: ScrollIntoViewOptions | undefined;
  scrollIntoView(options?: ScrollIntoViewOptions) { this.lastScrollOptions = options; }
  focus(options?: FocusOptions) {
    this.lastFocusOptions = options;
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
  manualEntrySaved: false,
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

function withSavedSearchResults(overrides: Record<string, unknown>) {
  const catalog = overrides.catalog;
  if (
    catalog &&
    typeof catalog === "object" &&
    "mode" in catalog &&
    catalog.mode === "search" &&
    !("savedResults" in catalog)
  ) {
    return { ...overrides, catalog: { ...catalog, savedResults: [] } };
  }
  return overrides;
}

async function renderHome(
  loaderOverrides: Record<string, unknown> = {},
  actionData?: Record<string, unknown>,
  initialPath = "/",
): Promise<ReactTestRenderer> {
  const loaderData = { ...baseLoaderData, ...withSavedSearchResults(loaderOverrides) };
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
  const loaderData = { ...baseLoaderData, ...withSavedSearchResults(loaderOverrides) };
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
    "Use the floating food or water action when you’re ready.",
  );
  const quickLog = renderer.root.findByProps({
    "aria-label": "Quick log",
    role: "group",
  });
  expect(quickLog.props.className).toBe(styles.quickLogActions);
  expect(
    renderer.root
      .findByProps({ className: styles.floatingUtilities })
      .findByProps({ "aria-label": "Quick log" }),
  ).toBe(quickLog);
  expect(
    quickLog.findAllByType("button").map((button) => ({
      label: button.props["aria-label"],
      value: button.props.value,
    })),
  ).toEqual([
    { label: "Add Food", value: "add-food" },
    { label: "Add Water", value: "add-water" },
  ]);
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
  expect(future.root.findAllByProps({ "aria-label": "Quick log" }))
    .toHaveLength(0);
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
  expect(renderer.root.findAllByProps({ "aria-label": "Quick log" }))
    .toHaveLength(0);
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
    preset8Count: 0,
    preset16Count: 1,
    preset24Count: 0,
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

test("historical Food Entries expose copy in the editor, not the daily log", async () => {
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
    foodEntryEditor: { ...editableEntry, foodLogDate: "2026-08-29", id: 91, name: "Historical yogurt" },
    foodLog: {
      ...baseFoodLog,
      entries: [historicalFood],
      events: [historicalFood, waterEvent],
      selectedDate: "2026-08-29",
    },
  });

  expect(historical.root.findAllByProps({ "aria-label": "More actions for Historical yogurt" })).toHaveLength(0);
  expect(historical.root.findByProps({ "aria-label": "Copy entry" }).type).toBe("button");
  await act(async () =>
    historical.root.findByProps({ "aria-label": "Copy entry" }).props.onClick(),
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
    historical.root.findAll(
      (node) =>
        typeof node.props["aria-label"] === "string" &&
        node.props["aria-label"] === "Copy entry",
    ),
  ).toHaveLength(1);
  await act(async () => historical.unmount());

  const today = await renderHome({
    copyIdempotencyKeys: {},
    foodEntryEditor: { ...editableEntry, id: 91, name: "Historical yogurt" },
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
        node.props["aria-label"] === "Copy entry",
    ),
  ).toHaveLength(0);
  await act(async () => today.unmount());

  const copyForm = new FormData();
  copyForm.set("entryId", "91");
  copyForm.set("intent", "copy-food-to-today");
  const pending = await renderPendingHome(
    {
      copyIdempotencyKeys: { [historicalFood.id]: "copy:historical-key" },
      foodEntryEditor: { ...editableEntry, foodLogDate: "2026-08-29", id: 91, name: "Historical yogurt" },
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
      .findByProps({ "aria-label": "Copy entry" })
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
  expect(allText(renderer)).toContain("Search food");
  expect(allText(renderer)).toContain("My foods");
  expect(allText(renderer)).toContain("Scan barcode");
  expect(allText(renderer)).toContain("Manual");
  const methods = renderer.root.findByProps({ "aria-label": "Add Food methods" });
  expect(methods.findByProps({ "aria-label": "Take photo · AI calories" })).toBeDefined();
  expect(allText(renderer)).toContain("AI estimates calories and saves to your log");
  expect(allText(renderer)).toContain("Photo privacy");
  expect(allText(renderer)).toContain("It does not delete data retained by your AI provider.");
  expect(allText(renderer)).not.toContain("Nothing changes in your Food Log until a later confirmation step.");
  expect(renderer.root.findByProps({
    href: "/?date=2026-08-31&food=search",
  })).toBeDefined();
  expect(renderer.root.findByProps({
    href: "/?date=2026-08-31&food=my",
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

test("Add Food disables only AI photo capture and presents role-appropriate recovery", async () => {
  const member = await renderHome({
    catalog: { mode: "choose", query: "" },
    photoAnalysisReadiness: {
      state: "unavailable",
      reason: "AI photo analysis is not available right now.",
    },
  });
  expect(member.root.findByProps({ "aria-label": "Take photo · AI calories" }).props.disabled).toBe(true);
  expect(member.root.findByProps({ "aria-label": "Add Food methods" }).children).toHaveLength(5);
  expect(allText(member)).toContain("AI photo analysis is not available right now.");
  expect(allText(member)).toContain("Search food");
  expect(allText(member)).toContain("Manual");
  expect(member.root.findAllByProps({ href: "/settings/ai" })).toHaveLength(0);
  await act(async () => member.unmount());

  const administrator = await renderHome({
    catalog: { mode: "choose", query: "" },
    photoAnalysisReadiness: {
      state: "unavailable",
      reason: "Configure Gemini and TypeSafe credentials.",
      destination: "/settings/ai",
    },
  });
  expect(administrator.root.findByProps({ "aria-label": "Take photo · AI calories" }).props.disabled).toBe(true);
  expect(allText(administrator)).toContain("Configure Gemini and TypeSafe credentials.");
  expect(administrator.root.findByProps({ "aria-label": "Why AI photo is unavailable" })).toBeDefined();
  expect(administrator.root.findByProps({ "aria-label": "AI photo unavailable" }).props.role).toBe("note");
  expect(administrator.root.findByProps({ href: "/settings/ai" })).toBeDefined();
  await act(async () => administrator.unmount());
});

test("manual Food Entry form keeps entered totals when quantity changes and restores invalid drafts", async () => {
  const catalog = {
    idempotencyKey: "manual-form-key",
    mode: "manual" as const,
    query: "",
  };
  queriedSelectors.length = 0;
  const renderer = await renderHome({ catalog });

  expect(queriedSelectors).toContain('input[name="name"]:not([disabled])');
  expect(nodeText(renderer.root.findByProps({ className: styles.dialogChip }))).toBe("Manual");
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
  expect(detail.root.findByProps({ name: "selectedMeasurementId" }).props.value).toBe("serving");
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
  expect(missingMeasurement.root.findByProps({ name: "selectedMeasurementId" }).props.value).toBe("");
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

test("local barcode nutrition preview scales the selected source measure and quantity", async () => {
  const renderer = await renderHome({ catalog: { barcode: barcodeFood.barcode, mode: "barcode", query: "", idempotencyKey: "volume-review", food: {
    ...barcodeFood, authoritativeBaseUnit: "ml", authoritativeBaseQuantityMicrounits: 100_000_000,
    measurements: [{ id: "ml", label: "1 ml", unit: "ml", baseQuantityMicrounits: 1_000_000 }, { id: "100ml", label: "100 ml", unit: "ml", baseQuantityMicrounits: 100_000_000 }],
  } } });
  const measurement = renderer.root.findByProps({ name: "selectedMeasurementId" });
  expect(measurement.props["aria-label"]).toBe("Measurement");
  expect(measurement.props.disabled).toBe(false);
  expect(measurement.findAllByType("option").map(option => [option.props.value, nodeText(option)])).toEqual([["ml", "1 ml"], ["100ml", "100 ml"]]);
  expect(allText(renderer)).toContain("Example Foods");
  await act(() => measurement.props.onChange({ currentTarget: { value: "100ml" } }));
  await act(() => input(renderer, "quantity").props.onChange({ currentTarget: { value: "2.5" } }));
  expect(nodeText(renderer.root.findByType("dl"))).toContain("450 kcal");
  expect(nodeText(renderer.root.findByType("dl"))).toContain("60 g");
  expect(renderer.root.findAllByType("button").find(button => nodeText(button) === "Add to Food Log")?.props.disabled).toBe(false);
  await act(() => measurement.props.onChange({ currentTarget: { value: "unknown" } }));
  expect(nodeText(renderer.root.findByType("dl"))).toContain("0 kcal");
  expect(renderer.root.findAllByType("button").find(button => nodeText(button) === "Add to Food Log")?.props.disabled).toBe(true);
  await act(() => renderer.unmount());
});

test.each([
  ["ambiguous_nutrition_basis", "Calculation unavailable: this export does not establish whether nutrition is per 100 g or 100 ml. Package size and serving text cannot resolve it."],
  ["conflicting_nutrition_bases", "Calculation unavailable: the product has conflicting nutrition bases."],
  ["calories_unavailable", "Calculation unavailable: calories are missing or have an unsupported unit."],
  ["nutrition_not_provided", "Calculation unavailable: nutrition is not provided for this product."],
  ["unsupported_barcode", "This product does not have a supported commercial barcode."],
  ["constructor", "Calculation unavailable for this product."],
  [undefined, "Calculation unavailable for this product."],
] as const)("an unavailable barcode reports %s and cannot submit nutrition", async (reason, message) => {
  const renderer = await renderHome({ catalog: { barcode: barcodeFood.barcode, mode: "barcode", query: "", idempotencyKey: "unavailable", food: { ...barcodeFood, brand: null, isSelectable: false, calculationUnavailableReason: reason, measurements: [] } } });
  expect(allText(renderer)).not.toContain("Example Foods");
  expect(nodeText(renderer.root.findByProps({ role: "alert" }))).toBe(message);
  expect(renderer.root.findByProps({ name: "selectedMeasurementId" }).props.disabled).toBe(true);
  expect(renderer.root.findAllByType("dl")).toHaveLength(0);
  expect(renderer.root.findAllByType("button").find(button => nodeText(button) === "Add to Food Log")?.props.disabled).toBe(true);
  await act(() => renderer.unmount());
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
    catalog: {
      mode: "search",
      query: "yogurt",
      results,
    },
  });
  expect(semanticDom(renderer)).toMatchSnapshot();
  expect(renderer.root.findByProps({ "aria-label": "Food search results" }))
    .toBeDefined();
  expect(allText(renderer)).not.toContain("Basic foods");
  expect(allText(renderer)).not.toContain("Packaged products");
  expect(allText(renderer)).not.toContain("Open Food Facts");
  expect(renderer.root.findAllByProps({ "aria-label": "Food type filter" }))
    .toHaveLength(0);
  expect(queriedSelectors).toContain(
    'input:not([type="hidden"]):not([disabled]), button:not([disabled]), select:not([disabled]), a[href]',
  );
  expect(renderer.root.findByProps({ href: "/?date=2026-08-31&food=1001&query=yogurt&provider=usda-fdc" }))
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
    catalog: {
      mode: "search",
      query: "",
      results: [results[0]],
    },
  });
  expect(queryless.root.findByProps({
    href: "/?date=2026-08-31&food=1001&provider=usda-fdc",
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

test("home catalog search renders a flat USDA result list with one attribution", async () => {
  const usdaResult = {
    barcode: null,
    brand: "Example Farm",
    catalogGeneration: "usda-generation",
    dataType: "Foundation",
    isSelectable: true,
    measurementSummary: "100 g",
    name: "Egg, whole, raw",
    provider: "usda-fdc",
    providerFoodId: "1234",
    providerPublishedDate: "2026-08-01",
  } as const;
  const renderer = await renderHome({
    catalog: {
      mode: "search",
      query: "egg",
      results: [usdaResult],
    },
  });

  expect(renderer.root.findAllByProps({ name: "filter" })).toHaveLength(0);
  expect(renderer.root.findByProps({
    href: "/?date=2026-08-31&food=1234&query=egg&provider=usda-fdc",
  })).toBeDefined();
  expect(allText(renderer)).toContain("Example Farm · 100 g · 2026-08-01");
  expect(allText(renderer)).toContain("USDA FoodData Central");
  expect(allText(renderer)).not.toContain("Open Food Facts");
  expect(renderer.root.findAllByProps({ className: styles.catalogType }))
    .toHaveLength(0);
  await act(async () => renderer.unmount());

  const empty = await renderHome({
    catalog: {
      mode: "search",
      query: "missing food",
      results: [],
    },
  });
  expect(allText(empty)).toContain("No foods found");
  expect(allText(empty)).toContain("USDA FoodData Central");
  await act(async () => empty.unmount());
});

test("legacy OFF detail links use the complete barcode-backed review behavior", async () => {
  const renderer = await renderHome({
    catalog: {
      food: barcodeFood,
      idempotencyKey: "off-search-detail",
      mode: "detail",
      query: "example cereal",
    },
  });

  expect(allText(renderer)).toContain(`Barcode ${barcodeFood.barcode}`);
  expect(allText(renderer)).toContain("Fiber");
  expect(allText(renderer)).toContain("Sugar");
  expect(allText(renderer)).toContain("Sodium");
  expect(input(renderer, "quantity").props).toMatchObject({
    min: "0.000001",
    step: "0.000001",
  });
  expect(renderer.root.findByProps({
    href: "/?date=2026-08-31&food=search&query=example+cereal",
  })).toBeDefined();
  expect(input(renderer, "provider").props.value).toBe("open-food-facts");
  expect(input(renderer, "providerFoodId").props.value).toBe(
    barcodeFood.providerFoodId,
  );
  await act(async () => renderer.unmount());
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

  const deleteButton = renderer.root.findByProps({ "aria-label": "Delete entry" });
  const focusTarget = modalFocusables[0];
  queriedSelectors.length = 0;
  focusTarget.lastFocusOptions = undefined;
  focusTarget.lastScrollOptions = undefined;
  await act(async () => deleteButton.props.onClick());
  expect(queriedSelectors).toEqual(['button[name="intent"][value="delete-food"]']);
  expect(document.activeElement).toBe(focusTarget);
  expect(focusTarget.lastFocusOptions).toEqual({ preventScroll: true });
  expect(focusTarget.lastScrollOptions).toEqual({ block: "nearest" });
  expect(semanticDom(renderer)).toMatchSnapshot();
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(2);
  expect(allText(renderer)).toContain("Delete this Food Entry?");
  const keepButton = renderer.root.findAllByType("button").find(
    (button) => nodeText(button) === "Keep it",
  )!;
  queriedSelectors.length = 0;
  await act(async () => keepButton.props.onClick());
  expect(queriedSelectors).toEqual([]);
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

const savedTortilla = {
  carbohydrateMilligrams: 18_000,
  energyMilliKcal: 100_000,
  fatMilligrams: 2_000,
  fiberMilligrams: null,
  id: 77,
  name: "Mexican tortilla",
  proteinMilligrams: 3_000,
  quantityMicrounits: 2_000_000,
  selectedMeasurementLabel: "1 serving",
  sodiumMilligrams: 25,
  sugarMilligrams: 0,
};

test("My foods can be browsed and searched before selecting a saved food", async () => {
  const listed = await renderHome({
    catalog: { mode: "my", query: "", results: [savedTortilla] },
  });
  expect(allText(listed)).toContain("Mexican tortilla");
  expect(allText(listed)).toContain("1 serving × 2");
  expect(listed.root.findByProps({
    href: "/?date=2026-08-31&food=saved%3A77",
  })).toBeDefined();
  expect(input(listed, "query").props.defaultValue).toBe("");
  await act(async () => listed.unmount());

  const noMatches = await renderHome({
    catalog: { mode: "my", query: "rice", results: [] },
  });
  expect(allText(noMatches)).toContain("No matching foods");
  await act(async () => noMatches.unmount());

  const noFoods = await renderHome({
    catalog: { mode: "my", query: "", results: [] },
  });
  expect(allText(noFoods)).toContain("No foods saved yet");
  expect(allText(noFoods)).toContain("Open an older manual entry");
  await act(async () => noFoods.unmount());

  const searched = await renderHome({
    catalog: {
      mode: "search",
      query: "tortilla",
      results: [{
        brand: null,
        catalogGeneration: "current-generation",
        isSelectable: false,
        measurementSummary: null,
        name: "Unusable catalog tortilla",
        provider: "usda-fdc",
        providerFoodId: "9999",
        providerPublishedDate: null,
      }],
      savedResults: [savedTortilla],
    },
  });
  expect(allText(searched)).toContain("My foods");
  expect(allText(searched)).toContain("Mexican tortilla");
  expect(allText(searched)).toContain("Nutrition unavailable");
  expect(allText(searched)).not.toContain("No foods found");
  await act(async () => searched.unmount());
});

test("saved food review keeps its recorded values and targets the displayed day", async () => {
  const catalog = {
    food: savedTortilla,
    idempotencyKey: "saved-review-key",
    mode: "saved",
    query: "",
  };
  const reviewed = await renderHome({
    catalog,
    foodLog: { ...baseFoodLog, selectedDate: "2026-08-29" },
  });
  expect(allText(reviewed)).toContain("Mexican tortilla");
  expect(allText(reviewed)).toContain("Review the saved values before adding this food to");
  expect(allText(reviewed)).toContain("100");
  expect(allText(reviewed)).toContain("Unknown");
  expect(input(reviewed, "date").props.value).toBe("2026-08-29");
  expect(input(reviewed, "savedFoodId").props.value).toBe(77);
  expect(input(reviewed, "idempotencyKey").props.value).toBe("saved-review-key");
  expect(reviewed.root.findByProps({ value: "log-saved-food" }).props.disabled)
    .toBe(false);
  await act(async () => reviewed.unmount());

  const formData = new FormData();
  formData.set("intent", "log-saved-food");
  const pending = await renderPendingHome(
    { catalog },
    { formData, to: "/?date=2026-08-31&food=saved%3A77" },
  );
  expect(allText(pending)).toContain("Adding…");
  expect(pending.root.findByProps({ value: "log-saved-food" }).props.disabled)
    .toBe(true);
  await act(async () => pending.unmount());
});

test("an older manual entry offers a top action to save its independent food", async () => {
  const manualEntry = { ...editableEntry, provider: "manual" };
  const unsaved = await renderHome({
    foodEntryEditor: manualEntry,
    manualEntrySaved: false,
  });
  expect(allText(unsaved)).toContain("Add to My foods");
  expect(unsaved.root.findByProps({ value: "save-manual-food" }).type)
    .toBe("button");
  await act(async () => unsaved.unmount());

  const saved = await renderHome({
    foodEntryEditor: manualEntry,
    manualEntrySaved: true,
  });
  expect(allText(saved)).toContain("In My foods");
  expect(allText(saved)).toContain("Changes to this daily entry do not change the saved food");
  expect(saved.root.findAllByProps({ value: "save-manual-food" })).toHaveLength(0);
  await act(async () => saved.unmount());
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
  expect(input(createDialog, "waterSelection").props.value).toBe("presets");
  expect(allText(createDialog)).toContain("Select water amount");
  const large = createDialog.root.findAllByType("button").find(
    (button) => nodeText(button).includes("Large"),
  )!;
  await act(async () => large.props.onClick());
  expect(input(createDialog, "waterSelection").props.value).toBe("presets");
  expect(input(createDialog, "waterPreset24Count").props.value).toBe(1);
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
    value: "24",
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
    preset8Count: 0,
    preset16Count: 1,
    preset24Count: 0,
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
  expect(input(edit, "waterSelection").props.value).toBe("exact");
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
    preset16Count: 0,
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
  expect(allText(metricCreate)).toContain("Select water amount");
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

test("water preset counts reset after Exact and grouped edits open with the total", async () => {
  const createDialog = await renderHome({
    foodLog: { ...baseFoodLog, displayUnits: "metric" },
    waterDialog: { mode: "create" },
  });
  const bottle = createDialog.root.findAllByType("button").find(
    (button) => nodeText(button).includes("Bottle"),
  )!;
  await act(async () => bottle.props.onClick());
  await act(async () => bottle.props.onClick());
  expect(input(createDialog, "waterPreset16Count").props.value).toBe(2);
  expect(allText(createDialog)).toContain("2 servings");
  expect(allText(createDialog)).toContain("Add 946 ml");
  const exact = createDialog.root.findAllByType("button").find(
    (button) => nodeText(button).includes("ExactamountCustom"),
  )!;
  await act(async () => exact.props.onClick());
  expect(input(createDialog, "waterAmount").props.value).toBe("946.352");
  await act(async () => bottle.props.onClick());
  expect(input(createDialog, "waterPreset16Count").props.value).toBe(0);
  expect(allText(createDialog)).toContain("Tap a size to add a serving.");
  await act(async () => createDialog.unmount());

  const editDialog = await renderHome({
    waterDialog: {
      mode: "edit",
      event: {
        amountMicroliters: 946_352,
        foodLogDate: "2026-08-31",
        id: 54,
        localEventTime: "13:15:00",
        preset8Count: 0,
        preset16Count: 2,
        preset24Count: 0,
        updatedAt: "2026-08-31T13:15:00.000Z",
      },
    },
  });
  expect(input(editDialog, "waterSelection").props.value).toBe("exact");
  expect(input(editDialog, "waterAmount").props.value).toBe("32");
  const glass = editDialog.root.findAllByType("button").find(
    (button) => nodeText(button).includes("Glass"),
  )!;
  await act(async () => glass.props.onClick());
  expect(input(editDialog, "waterSelection").props.value).toBe("8");
  await act(async () => editDialog.unmount());
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
  expect(pendingEditor.root.findByProps({ "aria-label": "Saving changes" }).props.disabled).toBe(true);
  await act(async () => pendingEditor.unmount());

  const deleteFood = new FormData();
  deleteFood.set("entryId", "41");
  deleteFood.set("intent", "delete-food");
  const deletingEditor = await renderPendingHome(
    { foodEntryEditor: editableEntry },
    { formData: deleteFood, to: "/" },
  );
  const revealFoodDelete = deletingEditor.root.findByProps({ "aria-label": "Delete entry" });
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
  expect(idleEditor.root.findByProps({ "aria-label": "Save changes" }).props.disabled).toBe(false);
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
  expect(allText(idleWater)).toContain("Select water amount");
  await act(async () => idleWater.unmount());

  const search = await renderPendingHome(
    { catalog: { mode: "search", query: "", results: [] } },
    { to: "/?food=search&query=yogurt" },
  );
  expect(semanticDom(search)).toMatchSnapshot();
  expect(allText(search)).toContain("Searching USDA foods");
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
  expect(allText(unrelated)).toContain("Searching USDA foods");
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
  expect(documentSelectors).toContain('[data-entry-editor-trigger][href="/?date=2026-08-28&entry=93"]');
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

test("photo meals share the food and water timeline in event order and expose correction details", async () => {
  const photoMeal = {
    id: "photo-home", name: "Photo dinner", entryId: editableEntry.id, foodLogDate: "2026-08-31", status: "succeeded", stage: "Preparing result", attemptId: "photo-attempt", startedAt: "2026-08-31T12:00:00.000Z", finishedAt: "2026-08-31T12:00:05.000Z", error: null, energyMilliKcal: 59000,
    result: { name: "Original dinner", consumedFraction: 1, components: [], assumptions: [] },
  };
  const food = { ...editableEntry, name: "Photo dinner", kind: "food", provider: "ai-photo", selectedMeasurementLabel: "Analyzed plate" };
  const copiedFood = { ...food, id: 77, name: "Copied photo" };
  const water = { id: editableEntry.id, kind: "water", amountMicroliters: 237000, foodLogDate: "2026-08-31", localEventTime: "12:05:00" };
  const renderer = await renderHome({ photoMeals: [photoMeal], foodLog: { ...baseFoodLog, entries: [food, copiedFood], events: [copiedFood, food, water] }, foodEntryEditor: editableEntry });
  expect(renderer.root.findAllByType("a").filter(node => node.props.href === "/?date=2026-08-31&entry=41")).toHaveLength(1);
  const timeline = renderer.root.findByProps({ className: styles.entryList });
  const actionsAndEntries = timeline.findAll(node => node.type === "button" || node.type === "a");
  expect(actionsAndEntries.map(node => nodeText(node))).toEqual([
    expect.stringContaining("Copied photo"), expect.stringContaining("Photo dinner"),
    expect.stringContaining("Water"),
  ]);
  const photoLink = timeline.findAllByType("a").find(node => node.props.href === "/?date=2026-08-31&entry=41")!;
  expect(photoLink.props.className).toBe(styles.foodEntryCard);
  expect(nodeText(photoLink.findByProps({ className: styles.foodEntryContent }))).toBe("Photo dinnerAI photo estimateAnalyzed plate × 1");
  expect(nodeText(photoLink.findByProps({ className: styles.foodEntryEnergy }))).toBe("59 kcal");
  expect(timeline.findAllByType("img")).toHaveLength(0);
  expect(timeline.findAllByType("time").map(node => [node.props.dateTime, nodeText(node)])).toEqual([
    ["2026-08-31T12:00:00", "12:00 PM"],
    ["2026-08-31T12:00:00", "12:00 PM"],
    ["2026-08-31T12:05:00", "12:05 PM"],
  ]);
  expect(allText(renderer)).toContain("Copied photo");
  expect(allText(renderer)).toContain("AI photo estimate");
  expect(allText(renderer)).toContain("Correct with AI");
  expect(allText(renderer)).toContain("Water");
  expect(renderer.root.findByProps({ "aria-label": "Photo analysis details" })).toBeDefined();
  await act(async () => renderer.unmount());
  const pending = await renderHome({ photoMeals: [{ ...photoMeal, status: "active", entryId: null, name: null, result: null, energyMilliKcal: null }] });
  expect(allText(pending)).not.toContain("No entries for this day");
  expect(allText(pending)).toContain("Cancel analysis");
  expect(nodeText(pending.root.findByProps({ className: styles.entryList }))).toContain("Cancel analysis");
  await act(async () => pending.unmount());
  for (const status of ["active", "failed", "canceled", "succeeded"]) {
    const active = status === "active";
    const terminalError = status === "failed" || status === "canceled";
    const state = await renderHome({
      photoMeals: [{ ...photoMeal, status, error: terminalError ? "Correction stopped" : null }],
      foodEntryEditor: editableEntry,
      copyIdempotencyKeys: { [food.id]: "copy-photo" },
      foodLog: { ...baseFoodLog, entries: [food, copiedFood], events: [copiedFood, food, water] },
    });
    expect(state.root.findByType("fieldset").props.disabled).toBe(active);
    const log = state.root.findByProps({ className: styles.entryList });
    const rows = log.findAllByType("article");
    expect(rows).toHaveLength(3);
    const row = rows.find(node => nodeText(node).includes("Photo dinner"))!;
    expect(row.props["aria-busy"]).toBe(active || undefined);
    expect(row.findAllByType("a")).toHaveLength(active ? 0 : 1);
    expect(row.findAllByType("progress")).toHaveLength(active ? 1 : 0);
    expect(row.findAllByType("strong").map(nodeText)).toEqual(["Photo dinner"]);
    expect(nodeText(row.findByProps({ className: styles.foodEntryEnergy }))).toBe("59 kcal");
    const buttons = row.findAllByType("button").map(nodeText);
    expect(buttons).toEqual(active ? ["Cancel analysis"] : terminalError ? ["Retry analysis", "Delete photo meal"] : []);
    if (active) {
      expect(row.findByProps({ className: styles.foodEntryContent }).type).toBe("div");
      expect(nodeText(row.findByProps({ className: styles.foodEntryContent }))).toContain("Updating this meal with AI");
      expect(nodeText(row)).toContain("Previous nutrition retained");
    } else {
      expect(row.findByType("a").props.className).toBe(styles.foodEntryCard);
      expect(nodeText(row).includes("Correction stopped")).toBe(terminalError);
    }
    expect(log.findAllByType("a").some(node => nodeText(node).includes("Copied photo"))).toBe(true);
    expect(log.findAllByType("a").some(node => node.props.href === "/?date=2026-08-31&water=41")).toBe(true);
    await act(async () => state.unmount());
  }
  const data = { ...baseLoaderData, photoMeals: [photoMeal], copyIdempotencyKeys: { [food.id]: "copy-photo" }, foodLog: { ...baseFoodLog, entries: [food, copiedFood], events: [copiedFood, food] } };
  let finishRequest!: (value: Response) => void;
  let finishNavigation!: (value: typeof data) => void;
  const response = new Promise<Response>(resolve => { finishRequest = resolve; });
  const navigation = new Promise<typeof data>(resolve => { finishNavigation = resolve; });
  const router = createMemoryRouter([
    { id: "home", path: "/", Component: () => Home({ loaderData: useLoaderData(), actionData: undefined } as never), loader: () => navigation },
    { path: "/photo-analysis", action: () => response },
  ], { initialEntries: ["/?date=2026-08-31&entry=41"], hydrationData: { loaderData: { home: { ...data, foodEntryEditor: editableEntry } } } });
  let requestView!: ReactTestRenderer;
  await act(() => { requestView = create(createElement(RouterProvider, { router }), { createNodeMock: () => new TestElement() }); });
  await act(() => requestView.root.findAllByType("button").find(node => nodeText(node) === "Correct with AI")!.props.onClick());
  const form = requestView.root.findAll(node => node.props.action === "/photo-analysis" && typeof node.props.fetcherKey === "string")[0];
  const formData = new FormData();
  formData.set("intent", "correct");
  formData.set("entryId", "41");
  formData.set("correction", "Diet soda");
  let submission!: Promise<void>;
  await act(() => {
    form.props.onSubmit();
    submission = router.fetch(form.props.fetcherKey, "home", "/photo-analysis", { formData, formMethod: "post" });
  });
  expect(requestView.root.findByType("fieldset").props.disabled).toBe(true);
  expect(requestView.root.findByType("textarea").props.disabled).toBe(true);
  await act(async () => { finishNavigation(data); await Promise.resolve(); });
  expect(requestView.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
  const busyLog = requestView.root.findByProps({ className: styles.entryList });
  expect(busyLog.findAllByType("article")).toHaveLength(2);
  const busyRow = busyLog.findByProps({ "aria-busy": true });
  expect(nodeText(busyRow)).toContain("Starting correction. Previous nutrition retained.");
  expect(busyRow.findByType("progress").props["aria-label"]).toBe("Starting correction");
  expect(busyRow.findAllByType("a")).toHaveLength(0);
  expect(busyRow.findAllByType("button")).toHaveLength(0);
  expect(busyLog.findByType("a").props.href).toBe("/?date=2026-08-31&entry=77");
  await act(async () => { finishRequest(Response.json({ error: "Request rejected" }, { status: 400 })); await submission; });
  expect(nodeText(busyLog.findByProps({ role: "alert" }))).toContain("Correction could not start: Request rejected");
  expect(busyLog.findAllByType("a")).toHaveLength(2);
  expect(busyLog.findAllByType("progress")).toHaveLength(0);
  await act(() => requestView.unmount());
  router.dispose();
});

test("touch date navigation follows the finger and settles by week while preserving taps and scrolling", async () => {
  vi.useFakeTimers();
  const loadDate = (date: string) => ({
    ...baseLoaderData,
    nearbyDates: getNearbyLocalDates(date, "2026-08-31"),
    foodLog: { ...baseFoodLog, selectedDate: date },
  });
  const loaderData = loadDate("2026-08-30");
  const router = createMemoryRouter([{
    path: "/",
    Component: () => Home({ loaderData: useLoaderData(), actionData: undefined } as never),
    loader: ({ request }) => loadDate(new URL(request.url).searchParams.get("date")!),
  }], { hydrationData: { loaderData: { "0": loaderData } }, initialEntries: ["/?date=2026-08-30"] });
  let renderer!: ReactTestRenderer;
  try {
    await act(() => { renderer = create(createElement(RouterProvider, { router })); });
    const rail = () => renderer.root.findByProps({ "aria-label": "Nearby dates" });
    const track = () => renderer.root.findAllByType("div").find((node) => String(node.props.className).split(" ").includes(styles.dateTrack))!;
    const captured: number[] = [];
    let railWidth = 350;
    const event = (overrides: Record<string, unknown> = {}) => ({
      pointerType: "touch", isPrimary: true, pointerId: 1, clientX: 150, clientY: 100,
      currentTarget: { setPointerCapture: (id: number) => captured.push(id), getBoundingClientRect: () => ({ width: railWidth }) },
      ...overrides,
    });
    const tapPrevented = (detail = 1) => {
      let prevented = false;
      rail().props.onClickCapture({ detail, preventDefault: () => { prevented = true; } });
      return prevented;
    };
    expect(tapPrevented()).toBe(false);
    await act(() => rail().props.onPointerCancel(event()));
    await act(() => { rail().props.onPointerDown(event()); rail().props.onPointerMove(event({ clientX: 157, clientY: 107 })); });
    expect(captured).toEqual([]);
    expect(track().props.style.transform).toBe("translateX(calc(-100% + 0px))");
    await act(() => { rail().props.onPointerMove(event({ clientX: 158, clientY: 108 })); rail().props.onPointerMove(event({ clientX: 200 })); });
    expect(captured).toEqual([]);
    await act(() => { rail().props.onPointerDown(event()); rail().props.onPointerMove(event({ clientX: 158 })); });
    expect(captured).toEqual([1]);
    expect(track().props.style.transform).toBe("translateX(calc(-100% + 8px))");
    await act(() => rail().props.onPointerMove(event({ clientX: 160, clientY: 200 })));
    expect(captured).toEqual([1]);
    expect(track().props.style.transform).toBe("translateX(calc(-100% + 10px))");
    await act(() => rail().props.onPointerCancel(event({ pointerId: 2 })));
    expect(track().props.style.transform).toBe("translateX(calc(-100% + 10px))");
    const lost = event();
    await act(() => rail().props.onLostPointerCapture({ ...lost, target: {} }));
    expect(track().props.style.transform).toBe("translateX(calc(-100% + 10px))");
    await act(() => rail().props.onLostPointerCapture({ ...lost, target: lost.currentTarget }));
    expect(track().props.style.transform).toBe("translateX(calc(-100% + 0px))");
    expect(track().props.className).toContain(styles.dateTrackSettling);
    await act(() => rail().props.onPointerDown(event()));
    expect(track().props.className).not.toContain(styles.dateTrackSettling);
    await act(() => rail().props.onPointerUp(event({ clientX: 250 })));
    await act(async () => { await vi.advanceTimersByTimeAsync(220); });
    expect(router.state.location.search).toBe("?date=2026-08-30");
    captured.length = 0;
    for (const begin of [{ pointerType: "mouse" }, { isPrimary: false }]) {
      await act(() => { rail().props.onPointerDown(event(begin)); rail().props.onPointerMove(event({ clientX: 50 })); rail().props.onPointerUp(event({ clientX: 50 })); });
      expect(router.state.location.search).toBe("?date=2026-08-30");
      expect(captured).toEqual([]);
    }
    await act(() => { rail().props.onPointerDown(event()); rail().props.onPointerMove(event({ clientX: 154, clientY: 140 })); rail().props.onPointerUp(event({ clientX: 50 })); });
    expect(tapPrevented()).toBe(false);
    expect(track().props.style.transform).toBe("translateX(calc(-100% + 0px))");

    await act(() => { rail().props.onPointerDown(event()); rail().props.onPointerMove(event({ pointerId: 2, clientX: 50 })); rail().props.onPointerUp(event({ pointerId: 2, clientX: 50 })); });
    expect(captured).toEqual([]);
    await act(() => rail().props.onPointerMove(event({ clientX: 120 })));
    expect(track().props.style.transform).toBe("translateX(calc(-100% + -30px))");
    expect(captured).toEqual([1]);
    expect(tapPrevented()).toBe(true);
    expect(tapPrevented(0)).toBe(false);
    await act(() => rail().props.onPointerCancel(event({ pointerId: 2 })));
    expect(track().props.style.transform).toBe("translateX(calc(-100% + -30px))");
    const target = event().currentTarget;
    await act(() => rail().props.onLostPointerCapture(event({ currentTarget: target, target: {} })));
    expect(track().props.style.transform).toBe("translateX(calc(-100% + -30px))");
    await act(() => rail().props.onLostPointerCapture(event({ currentTarget: target, target })));
    expect(track().props.className).toContain(styles.dateTrackSettling);
    expect(track().props.style.transform).toBe("translateX(calc(-100% + 0px))");

    await act(() => rail().props.onPointerDown(event()));
    expect(track().props.className).not.toContain(styles.dateTrackSettling);
    await act(() => rail().props.onPointerMove(event({ clientX: 157, clientY: 107 })));
    expect(tapPrevented()).toBe(false);
    expect(track().props.style.transform).toBe("translateX(calc(-100% + 0px))");
    await act(() => rail().props.onPointerMove(event({ clientX: 158, clientY: 100 })));
    expect(track().props.style.transform).toBe("translateX(calc(-100% + 8px))");
    await act(() => rail().props.onPointerMove(event({ clientX: 150, clientY: 200 })));
    expect(track().props.style.transform).toBe("translateX(calc(-100% + 0px))");
    await act(() => rail().props.onPointerCancel(event()));
    await act(() => { rail().props.onPointerDown(event()); rail().props.onPointerMove(event({ clientX: 158, clientY: 108 })); });
    expect(tapPrevented()).toBe(false);
    await act(() => rail().props.onPointerMove(event({ clientX: 170 })));
    expect(track().props.style.transform).toBe("translateX(calc(-100% + 0px))");

    async function drag(dx: number) {
      await act(() => { rail().props.onPointerDown(event()); rail().props.onPointerMove(event({ clientX: 150 + dx })); });
      await act(() => rail().props.onPointerUp(event({ clientX: 150 + dx })));
    }
    await drag(-20);
    expect(track().props.style.transform).toBe("translateX(calc(-100% + 0px))");
    await act(async () => { await vi.advanceTimersByTimeAsync(220); });
    expect(router.state.location.search).toBe("?date=2026-08-30");

    await drag(64);
    expect(track().props.className).toContain(styles.dateTrackSettling);
    expect(track().props.style.transform).toBe("translateX(calc(-100% + 350px))");
    expect(router.state.location.search).toBe("?date=2026-08-30");
    await act(async () => { await vi.advanceTimersByTimeAsync(220); });
    expect(router.state.location.search).toBe("?date=2026-08-23");
    expect(router.state.preventScrollReset).toBe(true);
    expect(track().props.style.transform).toBe("translateX(calc(-100% + 0px))");
    await drag(-64);
    expect(track().props.style.transform).toBe("translateX(calc(-100% + -350px))");
    await act(async () => { await vi.advanceTimersByTimeAsync(220); });
    expect(router.state.location.search).toBe("?date=2026-08-30");
    await drag(-100);
    await act(async () => { await vi.advanceTimersByTimeAsync(220); });
    expect(router.state.location.search).toBe("?date=2026-08-31");
    await act(() => { rail().props.onPointerDown(event()); rail().props.onPointerMove(event({ clientX: 50 })); });
    expect(track().props.style.transform).toBe("translateX(calc(-100% + -20px))");
    await act(() => rail().props.onPointerMove(event({ clientX: -500 })));
    expect(track().props.style.transform).toBe("translateX(calc(-100% + -42px))");
    await act(() => rail().props.onPointerUp(event({ clientX: 50 })));
    await act(async () => { await vi.advanceTimersByTimeAsync(220); });
    expect(router.state.location.search).toBe("?date=2026-08-31");
    await act(() => { rail().props.onPointerDown(event()); rail().props.onPointerUp(event()); });
    expect(tapPrevented()).toBe(false);
    await act(() => { rail().props.onPointerDown(event()); rail().props.onPointerMove(event({ clientX: -1000 })); });
    expect(track().props.style.transform).toBe("translateX(calc(-100% + -42px))");
    await act(() => rail().props.onPointerCancel(event()));
    railWidth = 200;
    await drag(40);
    expect(track().props.style.transform).toBe("translateX(calc(-100% + 200px))");
    expect(track().props.className).toContain(styles.dateTrackSettling);
    await act(async () => { await vi.advanceTimersByTimeAsync(219); });
    expect(router.state.location.search).toBe("?date=2026-08-31");
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(router.state.location.search).toBe("?date=2026-08-24");
    const matchMedia = vi.fn((query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" }));
    vi.stubGlobal("window", { matchMedia });
    await drag(-40);
    expect(track().props.style.transform).toBe("translateX(calc(-100% + -200px))");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(router.state.location.search).toBe("?date=2026-08-31");
    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
    await drag(40);
    await act(() => renderer.unmount());
    await act(async () => { await vi.advanceTimersByTimeAsync(220); });
    expect(router.state.location.search).toBe("?date=2026-08-31");
  } finally {
    await act(() => renderer?.unmount());
    router.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
