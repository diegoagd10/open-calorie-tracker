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

import { buildCalendarMonth, getNearbyLocalDates } from "../../app/shared/local-date";
import Home from "../../app/routes/home";
import eventStyles from "../../app/food-event/food-event.module.css";
import styles from "../../app/food-log.module.css";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

class TestElement {
  isConnected = true;
  open = false;
  showModal() { this.open = true; }
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
  userId: 1,
  calorieTarget: 2_050_000,
  waterTarget: "80",
  proteinTarget: 120_000,
  carbohydrateTarget: 230_000,
  fatTarget: 70_000,
  fiberTarget: 25_000,
  sugarMaximum: 50_000,
  sodiumMaximum: 2_300,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
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
  events: [],
  foodEvents: [],
  goal: completeGoal,
  isFuture: false,
  nutritionTotals: emptyTotals,
  selectedDate: "2026-08-31",
  timeZone: "America/New_York",
  today: "2026-08-31",
  waterTotalOunces: "0",
};

const baseLoaderData = {
  barcodeLookup: "enabled",
  calendar: undefined,
  csrfToken: "home-component-csrf",
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

function withSearchFavorites(overrides: Record<string, unknown>) {
  const addFood = overrides.addFood;
  if (
    addFood &&
    typeof addFood === "object" &&
    "mode" in addFood &&
    addFood.mode === "search" &&
    !("favorites" in addFood)
  ) {
    return { ...overrides, addFood: { ...addFood, favorites: [] } };
  }
  return overrides;
}

/** A complete Food Event as the read model serves it; tests override what they exercise. */
function foodEvent(change: Record<string, unknown> = {}) {
  return {
    authority: {
      nutrition: {
        carbohydrateMilligrams: { amount: 3.5, fixedPointMultiplier: 1_000 },
        energyMilliKcal: { amount: 59, fixedPointMultiplier: 1_000 },
        fatMilligrams: { amount: 0, fixedPointMultiplier: 1_000 },
        fiberMilligrams: null,
        proteinMilligrams: { amount: 10.5, fixedPointMultiplier: 1_000 },
        sodiumMilligrams: { amount: 36, fixedPointMultiplier: 1 },
        sugarMilligrams: { amount: 3.5, fixedPointMultiplier: 1_000 },
      },
      quantityMicrounits: 100_000_000,
      unit: "g",
    },
    copiedFromId: null,
    createdAt: "2026-08-31T16:00:00.000Z",
    editedName: null,
    favoriteId: null,
    id: 41,
    kind: "food",
    logDate: "2026-08-31T16:00:00.000Z",
    measurement: { baseQuantityMicrounits: 100_000_000, id: "base", label: "100 g", unit: "g" },
    measurements: [
      { baseQuantityMicrounits: 100_000_000, id: "base", label: "100 g", unit: "g" },
      { baseQuantityMicrounits: 170_000_000, id: "serving", label: "1 container", unit: "g" },
    ],
    name: "Editable yogurt",
    nutrients: {
      carbohydrateMilligrams: 3_001,
      energyMilliKcal: 59_000,
      fatMilligrams: 0,
      fiberMilligrams: null,
      proteinMilligrams: 10_100,
      sodiumMilligrams: 36,
      sugarMilligrams: 3_500,
    },
    originalName: "Editable yogurt",
    quantityMicrounits: 1_000_000,
    source: {
      barcode: null,
      brand: null,
      dataType: "Branded",
      marketCountry: null,
      modifiedDate: null,
      provider: "usda-fdc",
      providerFoodId: "1001",
      publishedDate: null,
    },
    updatedAt: "2026-08-31T16:00:00.000Z",
    ...change,
  };
}

/** A manual food's source, as a manual Food Event or favorite records it. */
const manualSource = {
  barcode: null,
  brand: null,
  dataType: "User entered",
  marketCountry: null,
  modifiedDate: null,
  provider: "manual",
  providerFoodId: "manual-food",
  publishedDate: null,
};

async function renderHome(
  loaderOverrides: Record<string, unknown> = {},
  actionData?: Record<string, unknown>,
  initialPath = "/",
): Promise<ReactTestRenderer> {
  const loaderData = { ...baseLoaderData, ...withSearchFavorites(loaderOverrides) };
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

/**
 * Home under a memory router with a `/food-events` route, so a test can submit a dialog's keyed
 * fetcher and see what the mounted dialog shows for the action's answer.
 */
async function renderFoodHome(
  loaderOverrides: Record<string, unknown>,
  foodAction: () => unknown = () => new Promise(() => undefined),
) {
  const loaderData = { ...baseLoaderData, ...withSearchFavorites(loaderOverrides) };
  const router = createMemoryRouter(
    [
      { Component: () => Home({ actionData: undefined, loaderData } as never), id: "home", loader: () => loaderData, path: "/" },
      { action: foodAction, id: "food-events", path: "/food-events" },
    ],
    { hydrationData: { loaderData: { home: loaderData } }, initialEntries: ["/"] },
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
  const submit = async (key: string, fields: Record<string, string>) => {
    const formData = new FormData();
    for (const [name, value] of Object.entries(fields)) formData.set(name, value);
    await act(async () => {
      void router.fetch(key, "home", "/food-events", { formData, formMethod: "post" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  return { renderer: renderer!, router, submit };
}

async function renderPendingHome(
  loaderOverrides: Record<string, unknown>,
  navigation: { formData?: FormData; to: string },
) {
  const loaderData = { ...baseLoaderData, ...withSearchFavorites(loaderOverrides) };
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
  expect(allText(renderer)).toContain("Add food or water when you’re ready.");
  const emptyDayActions = renderer.root.findByProps({
    "aria-label": "Add to this day",
    role: "group",
  });
  expect(
    emptyDayActions.findAllByType("button").map((button) => button.props.value),
  ).toEqual(["add-food", "add-water"]);
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
  // Floating actions plus the empty day's own actions; CSS shows one set per width.
  expect(renderer.root.findAllByType("button").filter(
    (button) => ["add-food", "add-water"].includes(button.props.value),
  )).toHaveLength(4);
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
      "aria-valuetext": "0 fl oz of 80 fl oz target",
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

test("nutrients stay exposed to assistive technology until the layout is measured", async () => {
  // No window here, as in server rendering or a browser without JavaScript.
  const renderer = await renderHome();
  const carousel = renderer.root.findByProps({ "aria-label": "Daily nutrient progress" });
  expect(carousel.findAll((node) => node.props["aria-hidden"] === true)).toHaveLength(0);
  expect(carousel.findAll((node) => node.type === "article")).toHaveLength(6);
  await act(async () => renderer.unmount());
});

test("wide screens expose all six daily nutrients without page controls", async () => {
  const listeners = new Set<() => void>();
  const media = {
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    matches: true,
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal("window", { matchMedia: vi.fn(() => media) });
  try {
    const renderer = await renderHome();
    expect(renderer.root.findAllByProps({ "aria-label": "Nutrition pages" })).toHaveLength(0);
    const carousel = renderer.root.findByProps({ "aria-label": "Daily nutrient progress" });
    expect(carousel.findAll((node) => node.props["aria-hidden"] === true)).toHaveLength(0);

    media.matches = false;
    await act(async () => listeners.forEach((listener) => listener()));
    expect(renderer.root.findAllByProps({ "aria-label": "Nutrition pages" }).length).toBeGreaterThan(0);
    await act(async () => renderer.unmount());
    expect(listeners.size).toBe(0);
  } finally {
    vi.unstubAllGlobals();
  }
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
    goal: null,
    nutritionTotals: {
      ...emptyTotals,
      energyMilliKcal: { isIncomplete: true, known: 1_234_567 },
      proteinMilligrams: { isIncomplete: true, known: 12_345 },
    },
    selectedDate: "2026-08-30",
    waterTotalOunces: "8",
  };
  const past = await renderHome({
    foodLog: pastFoodLog,
    nearbyDates: [{ date: "2026-08-30", isFuture: false, isSelected: true }],
    notice: "Water Event deleted. Daily total updated.",
  }, { message: "Visible route message" });
  expect(semanticDom(past)).toMatchSnapshot();
  expect(past.root.findByType("h1").props["aria-label"])
    .toBe("Food Log for Sunday, August 30, 2026");
  expect(past.root.findByType("h1").children.join("")).toBe("Food Log");
  expect(allText(past)).toContain("1,234.6 known / No active goal");
  expect(allText(past)).toContain("Protein12.345 known / No active goalIncomplete");
  expect(allText(past)).toContain("8 fl oz");
  expect(allText(past)).not.toContain(" ml");
  expect(allText(past)).toContain("/ No active goal");
  expect(past.root.findAllByProps({ role: "status" }).map((node) => node.children.join("")))
    .toContain("Water Event deleted. Daily total updated.");
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

test("week strip and calendar compare each logged day with the Daily Goal's calories", async () => {
  const dailyCalories = {
    "2026-08-29": { eventCount: 2, goalMilliKcal: 2_000_000, isIncomplete: false, knownMilliKcal: 2_345_600 },
    "2026-08-30": { eventCount: 1, goalMilliKcal: 2_000_000, isIncomplete: true, knownMilliKcal: 640_000 },
    "2026-08-31": { eventCount: 1, goalMilliKcal: null, isIncomplete: false, knownMilliKcal: 95_000 },
    "2026-08-28": { eventCount: 0, goalMilliKcal: 2_000_000, isIncomplete: false, knownMilliKcal: 0 },
  };
  const week = await renderHome({
    dailyCalories,
    nearbyDates: [
      { date: "2026-08-28", isFuture: false, isSelected: false },
      { date: "2026-08-29", isFuture: false, isSelected: false },
      { date: "2026-08-30", isFuture: false, isSelected: true },
    ],
  });
  const rail = week.root.findByProps({ "aria-label": "Nearby dates" });
  const tones = rail.findAll((node) => node.type === "em").map((node) => [
    node.props["data-calorie-tone"],
    node.children.join(""),
  ]);
  // An incomplete day under its goal stays undecided rather than "within".
  expect(tones).toEqual([
    ["over", "2,346 kcal"],
    ["incomplete", "640 kcal known"],
  ]);
  expect(rail.findAll((node) => node.props.style?.["--progress"] !== undefined)
    .map((node) => node.props.style["--progress"])).toEqual(["100.0%", "32.0%"]);
  await act(async () => week.unmount());

  const history = await renderHome({
    calendar: {
      days: [
        { date: "2026-08-29", day: 29, isFuture: false, isSelected: false, isToday: false },
        { date: "2026-08-31", day: 31, isFuture: false, isSelected: true, isToday: true },
        { date: "2026-09-01", day: 1, isFuture: true, isSelected: false, isToday: false },
      ],
      label: "August 2026",
      leadingEmptyDays: 6,
      nextMonth: undefined,
      previousMonth: "2026-07",
    },
    dailyCalories,
  });
  expect(history.root.findByProps({ "aria-label": "Saturday, August 29, 2,346 kcal" }).props)
    .toMatchObject({ "data-calorie-tone": "over", to: "/?date=2026-08-29" });
  expect(history.root.findByProps({ "aria-label": "Monday, August 31, 95 kcal" }).props["data-calorie-tone"])
    .toBe("logged");
  expect(history.root.findAll((node) => node.props.style?.["--progress"] !== undefined)
    .map((node) => node.props.style["--progress"])).toEqual(["100.0%"]);
  await act(async () => history.unmount());
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
  const timelineFood = foodEvent({
    id: 11,
    logDate: "2026-08-31T04:05:00.000Z",
    measurement: { baseQuantityMicrounits: 100_000_000, id: "base", label: "100 g", unit: "g" },
    name: "Timeline yogurt",
    nutrients: { ...foodEvent().nutrients, energyMilliKcal: 59_000 },
    quantityMicrounits: 1_500_000,
    source: { ...foodEvent().source, dataType: "Open Food Facts", provider: "open-food-facts" },
  });
  const waterEvent = {
    createdAt: "2026-08-31T17:07:00.000Z",
    id: 12,
    kind: "water" as const,
    logDate: "2026-08-31T17:07:00.000Z",
    ounces: "16",
    updatedAt: "2026-08-31T17:07:00.000Z",
    userId: 1,
  };
  const unknownEnergyEvent = foodEvent({
    ...timelineFood,
    id: 14,
    name: "Unknown energy food",
    nutrients: { ...timelineFood.nutrients, energyMilliKcal: null },
  });
  const renderer = await renderHome({
    foodLog: {
      ...baseFoodLog,
      events: [timelineFood, waterEvent, unknownEnergyEvent],
      foodEvents: [timelineFood, { ...timelineFood, id: 13, name: "Second food" }],
      nutritionTotals: {
        carbohydrateMilligrams: { isIncomplete: false, known: 300_000 },
        energyMilliKcal: { isIncomplete: false, known: 3_000_000 },
        fatMilligrams: { isIncomplete: false, known: 90_000 },
        fiberMilligrams: { isIncomplete: false, known: 30_000 },
        proteinMilligrams: { isIncomplete: true, known: 150_000 },
        sodiumMilligrams: { isIncomplete: false, known: 3_000 },
        sugarMilligrams: { isIncomplete: false, known: 60_000 },
      },
      waterTotalOunces: "101.442",
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
  const foodTime = renderer.root.findAllByType("time")[0];
  expect(foodTime.props.dateTime).toBe("2026-08-31T04:05:00.000Z");
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
      "aria-valuemax": 80,
      "aria-valuenow": 80,
      style: { "--progress": "100%" },
    });
  expect(renderer.root.findAllByType("button").filter(
    (button) => ["add-food", "add-water"].includes(button.props.value),
  )).toHaveLength(2);
  await act(async () => renderer.unmount());

  const singular = await renderHome({
    foodLog: {
      ...baseFoodLog,
      events: [timelineFood],
      foodEvents: [timelineFood],
      nutritionTotals: {
        ...emptyTotals,
        energyMilliKcal: { isIncomplete: true, known: 1_025_000 },
        proteinMilligrams: { isIncomplete: false, known: 60_000 },
        sodiumMilligrams: { isIncomplete: false, known: 1_150 },
      },
      waterTotalOunces: "40",
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
      "aria-valuenow": 40,
      style: { "--progress": "50%" },
    });
  await act(async () => singular.unmount());
});

test("historical Food Entries expose copy in the editor, not the daily log", async () => {
  const historicalFood = foodEvent({ id: 91, logDate: "2026-08-29T12:05:00.000Z", name: "Historical yogurt" });
  const waterEvent = {
    id: 92,
    kind: "water" as const,
    logDate: "2026-08-29T12:10:00.000Z",
    ounces: "8",
  };
  const historicalLog = {
    ...baseFoodLog,
    events: [historicalFood, waterEvent],
    foodEvents: [historicalFood],
    selectedDate: "2026-08-29",
  };
  const historical = await renderHome({
    editor: { canCopy: true, event: historicalFood },
    foodLog: historicalLog,
  });

  expect(historical.root.findAllByProps({ "aria-label": "More actions for Historical yogurt" })).toHaveLength(0);
  expect(historical.root.findByProps({ "aria-label": "Copy entry" }).type).toBe("button");
  await act(async () =>
    historical.root.findByProps({ "aria-label": "Copy entry" }).props.onClick(),
  );
  expect(
    historical.root.findByProps({ "data-entry-editor-trigger": true }).props.to,
  ).toBe("/?date=2026-08-29&entry=91");
  const copyToToday = historical.root.findAllByType("form").find(
    (form) => form.findAllByProps({ name: "intent", value: "copy" }).length > 0,
  )!;
  expect(copyToToday.props.action).toBe("/food-events");
  expect(copyToToday.findAllByType("input").map((field) => [field.props.name, field.props.value])).toEqual([
    ["csrfToken", "home-component-csrf"],
    ["intent", "copy"],
    ["id", 91],
    ["date", "2026-08-29"],
  ]);
  expect(
    historical.root.findAllByType("button").find(
      (button) => nodeText(button) === "Copy to today",
    )?.props,
  ).toMatchObject({ disabled: false, type: "submit" });
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
    editor: { canCopy: false, event: { ...historicalFood, logDate: "2026-08-31T12:05:00.000Z" } },
  });
  expect(
    today.root.findAll(
      (node) =>
        typeof node.props["aria-label"] === "string" &&
        node.props["aria-label"] === "Copy entry",
    ),
  ).toHaveLength(0);
  await act(async () => today.unmount());

  const pending = await renderFoodHome({
    editor: { canCopy: true, event: historicalFood },
    foodLog: historicalLog,
  });
  await act(async () =>
    pending.renderer.root
      .findByProps({ "aria-label": "Copy entry" })
      .props.onClick(),
  );
  await pending.submit("food-event:copy-to-today", { date: "2026-08-29", id: "91", intent: "copy" });
  expect(
    pending.renderer.root.findAllByType("button").find(
      (button) => nodeText(button) === "Copying…",
    )?.props.disabled,
  ).toBe(true);
  await act(async () => pending.renderer.unmount());

  const refused = await renderFoodHome({
    editor: { canCopy: true, event: historicalFood },
    foodLog: historicalLog,
  }, () => ({ code: "not_found", message: "Food event not found." }));
  await act(async () =>
    refused.renderer.root.findByProps({ "aria-label": "Copy entry" }).props.onClick(),
  );
  await refused.submit("food-event:copy-to-today", { date: "2026-08-29", id: "91", intent: "copy" });
  expect(nodeText(refused.renderer.root.findByProps({ role: "alert" }))).toBe("Food event not found.");
  await act(async () => refused.renderer.unmount());
});

function copyDialogModel(event: ReturnType<typeof foodEvent>, sourceDate: string, today: string, destinationDate?: string) {
  const calendar = buildCalendarMonth(sourceDate.slice(0, 7), today, destinationDate ?? "");
  return {
    calendar: {
      ...calendar,
      days: calendar.days.map((day) => ({ ...day, isSource: day.date === sourceDate })),
    },
    destinationDate,
    event,
    sourceDate,
  };
}

test("copy-date dialog exposes eligible calendar days and requires confirmation", async () => {
  const event = foodEvent({ id: 93, logDate: "2026-08-28T16:00:00.000Z", name: "Historical yogurt" });
  const renderer = await renderHome(
    {
      copy: copyDialogModel(event, "2026-08-28", "2026-08-30", "2026-08-29"),
      foodLog: {
        ...baseFoodLog,
        selectedDate: "2026-08-28",
        today: "2026-08-30",
      },
    },
    undefined,
    "/?date=2026-08-28&copy=93&copyDate=2026-08-29",
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
  expect(input(renderer, "intent").props.value).toBe("copy");
  expect(input(renderer, "id").props.value).toBe(93);
  expect(input(renderer, "date").props.value).toBe("2026-08-28");
  expect(
    renderer.root.findAllByType("button").find(
      (button) => nodeText(button) === "Copy",
    )?.props.disabled,
  ).toBe(false);
  expect(allText(renderer)).toContain("Cancel");
  await act(async () => renderer.unmount());
});

test("home labels user-entered Food Entries as Manual", async () => {
  const manualEntry = foodEvent({
    id: 19,
    measurement: { baseQuantityMicrounits: 1_000_000, id: "serving", label: "1 serving", unit: "serving" },
    name: "Tortillas",
    quantityMicrounits: 3_000_000,
    source: manualSource,
  });
  const renderer = await renderHome({
    foodLog: {
      ...baseFoodLog,
      events: [manualEntry],
      foodEvents: [manualEntry],
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
  catalogGeneration: "00000000-0000-4000-8000-000000001001",
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
  catalogGeneration: "a".repeat(64),
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

/** The fields a save form posts, in document order. */
function formFields(form: ReactTestRenderer["root"]) {
  return form.findAll((node) => (node.type === "input" || node.type === "select") && typeof node.props.name === "string")
    .map((field) => field.props.name as string);
}

test("Add Food offers My foods, Search food, Scan barcode and Manual as a list of four rows", async () => {
  const renderer = await renderHome({ addFood: { mode: "choose" } });
  expect(semanticDom(renderer)).toMatchSnapshot();
  const methods = renderer.root.findByProps({ "aria-label": "Add Food methods" });
  expect(methods.children.map(method => typeof method === "string" ? method : nodeText(method))).toEqual(["My foods", "Search food", "Scan barcode", "Manual"]);
  expect(methods.findAll(node => typeof node.props.href === "string").map(node => node.props.href)).toEqual([
    "/?date=2026-08-31&food=my",
    "/?date=2026-08-31&food=search",
    "/?date=2026-08-31&food=barcode",
    "/?date=2026-08-31&food=manual",
  ]);
  expect(allText(renderer)).not.toMatch(/photo|\bAI\b/i);
  expect(allText(renderer)).not.toContain("Nothing changes in your Food Log until a later confirmation step.");
  expect(renderer.root.findAllByType("img")).toHaveLength(0);
  await act(async () => renderer.unmount());
});

test("without a barcode contact, members see no Scan barcode and administrators get a setup pop-up", async () => {
  const member = await renderHome({ addFood: { mode: "choose" }, barcodeLookup: "hidden" });
  const memberMethods = member.root.findByProps({ "aria-label": "Add Food methods" });
  expect(memberMethods.children.map(method => typeof method === "string" ? method : nodeText(method))).toEqual(["My foods", "Search food", "Manual"]);
  expect(allText(member)).not.toMatch(/barcode/i);
  await act(async () => member.unmount());

  const admin = await renderHome({ addFood: { mode: "choose" }, barcodeLookup: "admin-setup" });
  const scan = admin.root.findByProps({ "aria-haspopup": "dialog" });
  expect(scan.type).toBe("button");
  expect(nodeText(scan)).toBe("Scan barcode");
  expect(admin.root.findAll(node => node.props.href === "/?date=2026-08-31&food=barcode")).toHaveLength(0);
  expect(admin.root.findAllByType("dialog")).toHaveLength(0);
  await act(async () => (scan.props as { onClick: () => void }).onClick());
  const popup = admin.root.findByType("dialog");
  expect(lastNodeMock?.open).toBe(true);
  expect(nodeText(popup)).toContain("Barcode scanning is not enabled");
  expect(nodeText(popup)).toContain("Open Food Facts requires a contact email before this app can look up barcodes. Add one in Food Catalogs to enable scanning for every member.");
  expect(popup.findByProps({ href: "/settings/catalogs" }).children.map(child => typeof child === "string" ? child : nodeText(child)).join("")).toBe("Go to Food Catalogs →");
  const stopped = vi.fn();
  (popup.props as { onKeyDown: (event: { stopPropagation: () => void }) => void }).onKeyDown({ stopPropagation: stopped });
  expect(stopped).toHaveBeenCalled();
  await act(async () => (popup.findByProps({ children: "Cancel" }).props as { onClick: () => void }).onClick());
  expect(admin.root.findAllByType("dialog")).toHaveLength(0);
  await act(async () => (admin.root.findByProps({ "aria-haspopup": "dialog" }).props as { onClick: () => void }).onClick());
  const cancelEvent = { preventDefault: vi.fn() };
  await act(async () => (admin.root.findByType("dialog").props as { onCancel: (event: typeof cancelEvent) => void }).onCancel(cancelEvent));
  expect(cancelEvent.preventDefault).toHaveBeenCalled();
  expect(admin.root.findAllByType("dialog")).toHaveLength(0);
  await act(async () => admin.unmount());
});

test("the manual form keeps entered totals when quantity changes, saves to My foods by default, and keeps a refused draft", async () => {
  queriedSelectors.length = 0;
  const { renderer, submit } = await renderFoodHome(
    { addFood: { mode: "manual" } },
    () => ({ code: "invalid_nutrition", message: "Enter the calories for this quantity; zero is allowed." }),
  );

  expect(queriedSelectors).toContain('input[name="name"]:not([disabled])');
  expect(nodeText(renderer.root.findByProps({ className: eventStyles.dialogChip }))).toBe("Manual");
  expect(allText(renderer)).toContain("Add food manually");
  expect(allText(renderer)).toContain("1 serving");
  expect(input(renderer, "name").props.required).toBe(true);
  expect(input(renderer, "energyKcal").props.required).toBe(true);
  expect(input(renderer, "proteinGrams").props.required).toBe(false);
  expect(input(renderer, "quantity").props.value).toBe("1");
  for (const name of ["name", "energyKcal", "proteinGrams", "carbohydrateGrams", "fatGrams", "fiberGrams", "sugarGrams", "sodiumMilligrams"]) {
    expect(input(renderer, name).props.value).toBe("");
  }
  expect(renderer.root.findByProps({ className: eventStyles.backToResults }).props.to).toBe("/?date=2026-08-31&food=choose");
  expect(renderer.root.findByType("fieldset").props.disabled).toBe(false);
  expect(allText(renderer)).toContain("Add to Food Log");
  for (const name of ["energyKcal", "proteinGrams", "carbohydrateGrams", "fatGrams", "fiberGrams", "sugarGrams", "sodiumMilligrams"]) {
    expect(input(renderer, name).props).toMatchObject({
      max: name === "sodiumMilligrams" ? "9999999" : "999999.999",
      step: name === "sodiumMilligrams" ? "1" : "0.001",
    });
  }
  const form = renderer.root.findAllByType("form").find((candidate) => candidate.props.action === "/food-events")!;
  expect(form).toBeDefined();
  expect([input(renderer, "intent").props.value, input(renderer, "method").props.value, input(renderer, "date").props.value])
    .toEqual(["log", "manual", "2026-08-31"]);
  const favorite = input(renderer, "saveAsFavorite");
  expect(favorite.props).toMatchObject({ checked: true, type: "checkbox" });
  expect(allText(renderer)).toContain("Save to My foods");
  await act(async () => favorite.props.onChange({ target: { checked: false } }));
  expect(input(renderer, "saveAsFavorite").props.checked).toBe(false);

  await act(async () => input(renderer, "name").props.onChange({ target: { value: "Tortilla" } }));
  await act(async () => input(renderer, "energyKcal").props.onChange({ target: { value: "180" } }));
  await act(async () => input(renderer, "proteinGrams").props.onChange({ target: { value: "6" } }));
  await act(async () => input(renderer, "quantity").props.onChange({ target: { value: "3" } }));
  expect(input(renderer, "quantity").props.value).toBe("3");
  expect(input(renderer, "name").props.value).toBe("Tortilla");
  expect(input(renderer, "energyKcal").props.value).toBe("180");
  expect(input(renderer, "proteinGrams").props.value).toBe("6");

  await submit("food-event:add", { intent: "log", method: "manual", name: "Tortilla" });
  expect(allText(renderer)).toContain("Enter the calories for this quantity; zero is allowed.");
  expect(input(renderer, "name").props.value).toBe("Tortilla");
  expect(input(renderer, "energyKcal").props.value).toBe("180");
  expect(input(renderer, "quantity").props.value).toBe("3");
  expect(input(renderer, "saveAsFavorite").props.checked).toBe(false);
  await act(async () => renderer.unmount());
});

test("barcode mode separates confirmation from scanning while keeping errors recoverable", async () => {
  for (const addFood of [
    { barcode: "", mode: "barcode" },
    {
      barcode: "0000000000004",
      message: "Open Food Facts is unavailable right now. Retry in a moment.",
      mode: "barcode",
      title: "Open Food Facts is unavailable",
    },
  ] as const) {
    const renderer = await renderHome({ addFood });
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
    addFood: { barcode: "034000470693", food: barcodeFood, mode: "barcode" },
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
  expect(input(detail, "method").props.value).toBe("barcode");
  expect(input(detail, "providerFoodId").props.value).toBe("0034000470693");
  expect(input(detail, "reviewVersion").props.value).toBe(barcodeFood.catalogGeneration);
  expect(detail.root.findByProps({ name: "measurementId" }).props.value).toBe("serving");
  expect(input(detail, "quantity").props.value).toBe("1");
  const confirmationForm = detail.root.findAllByType("form").find(
    (form) => form.props.action === "/food-events",
  )!;
  expect(formFields(confirmationForm).sort()).toEqual([
    "csrfToken",
    "date",
    "intent",
    "measurementId",
    "method",
    "providerFoodId",
    "quantity",
    "reviewVersion",
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
    addFood: {
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
      mode: "barcode",
    },
  });
  expect(semanticDom(unnamed)).toMatchSnapshot();
  expect(allText(unnamed)).toContain("Unnamed product · 0000000000006");
  expect(allText(unnamed)).toContain("6 g");
  await act(async () => unnamed.unmount());

  const failedConfirmation = await renderFoodHome(
    { addFood: { barcode: "034000470693", food: barcodeFood, mode: "barcode" } },
    () => ({ code: "source_unavailable", message: "Open Food Facts isn't responding; try again or log it manually." }),
  );
  await failedConfirmation.submit("food-event:add", { intent: "log", method: "barcode" });
  expect(failedConfirmation.renderer.root.findByProps({ role: "alert" })).toBeDefined();
  expect(allText(failedConfirmation.renderer)).toContain(
    "Open Food Facts isn't responding; try again or log it manually.",
  );
  expect(failedConfirmation.renderer.root.findByProps({ role: "dialog" })).toBeDefined();
  await act(async () => failedConfirmation.renderer.unmount());

  const missingMeasurement = await renderHome({
    addFood: { barcode: "034000470693", food: { ...barcodeFood, measurements: [] }, mode: "barcode" },
  });
  expect(missingMeasurement.root.findByProps({ name: "measurementId" }).props.value).toBe("");
  await act(async () => missingMeasurement.unmount());
});

test("barcode entry validates client-side and exposes only matching navigation as pending", async () => {
  const renderer = await renderHome({
    addFood: { barcode: "", mode: "barcode" },
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
    { addFood: { barcode: "034000470693", mode: "barcode" } },
    { to: "/?food=barcode&barcode=034000470693" },
  );
  expect(allText(pending)).toContain("Checking Open Food Facts");
  await act(async () => pending.unmount());

  const otherNavigation = await renderPendingHome(
    { addFood: { barcode: "034000470693", mode: "barcode" } },
    { to: "/?food=search&query=yogurt" },
  );
  expect(allText(otherNavigation)).not.toContain("Checking Open Food Facts");
  await act(async () => otherNavigation.unmount());

  const unknownNavigation = await renderPendingHome(
    { addFood: { barcode: "034000470693", mode: "barcode" } },
    { to: "/?unrelated=1" },
  );
  expect(allText(unknownNavigation)).not.toContain("Checking Open Food Facts");
  await act(async () => unknownNavigation.unmount());
});

test("local barcode nutrition preview scales the selected source measure and quantity", async () => {
  const renderer = await renderHome({ addFood: { barcode: barcodeFood.barcode, mode: "barcode", food: {
    ...barcodeFood, authoritativeBaseUnit: "ml", authoritativeBaseQuantityMicrounits: 100_000_000,
    measurements: [{ id: "ml", label: "1 ml", unit: "ml", baseQuantityMicrounits: 1_000_000 }, { id: "100ml", label: "100 ml", unit: "ml", baseQuantityMicrounits: 100_000_000 }],
  } } });
  const measurement = renderer.root.findByProps({ name: "measurementId" });
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
  const renderer = await renderHome({ addFood: { barcode: barcodeFood.barcode, mode: "barcode", food: { ...barcodeFood, brand: null, isSelectable: false, calculationUnavailableReason: reason, measurements: [] } } });
  expect(allText(renderer)).not.toContain("Example Foods");
  expect(nodeText(renderer.root.findByProps({ role: "alert" }))).toBe(message);
  expect(renderer.root.findByProps({ name: "measurementId" }).props.disabled).toBe(true);
  expect(renderer.root.findAllByType("dl")).toHaveLength(0);
  expect(renderer.root.findAllByType("button").find(button => nodeText(button) === "Add to Food Log")?.props.disabled).toBe(true);
  await act(() => renderer.unmount());
});

test("USDA search validates its controlled query before navigation", async () => {
  const renderer = await renderHome({
    addFood: { mode: "search", query: "", results: [] },
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
  for (const [addFood, expected] of states) {
    const renderer = await renderHome({ addFood });
    expect(semanticDom(renderer)).toMatchSnapshot();
    expect(renderer.root.findByProps({ role: "dialog" }).props["aria-labelledby"])
      .toBe("food-dialog-title");
    expect(allText(renderer)).toContain("Add Food");
    expect(allText(renderer)).toContain(expected);
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
    addFood: {
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
    addFood: {
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
    addFood: {
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
    addFood: {
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
  expect(renderer.root.findAllByProps({ className: eventStyles.catalogType }))
    .toHaveLength(0);
  await act(async () => renderer.unmount());

  const empty = await renderHome({
    addFood: {
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
    addFood: {
      food: barcodeFood,
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
  expect(input(renderer, "method").props.value).toBe("barcode");
  expect(input(renderer, "providerFoodId").props.value).toBe(
    barcodeFood.providerFoodId,
  );
  await act(async () => renderer.unmount());
});

test("home catalog detail recalculates previews and exposes the save contract", async () => {
  const renderer = await renderHome({
    addFood: {
      food: catalogFood,
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
  const saveForm = renderer.root.findAllByType("form").find((form) => form.props.action === "/food-events")!;
  expect(formFields(saveForm)).toEqual([
    "csrfToken", "intent", "method", "date", "providerFoodId", "reviewVersion", "measurementId", "quantity",
  ]);
  expect(input(renderer, "method").props.value).toBe("lookup");
  expect(input(renderer, "reviewVersion").props.value).toBe(catalogFood.catalogGeneration);
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

  const select = renderer.root.findByProps({ name: "measurementId" });
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
    addFood: {
      food: {
        ...catalogFood,
        brand: null,
        measurements: [],
        nutritionPerAuthoritativeBase: {
          ...catalogFood.nutritionPerAuthoritativeBase,
          energyMilliKcal: null,
        },
      },
      mode: "detail",
      query: "none",
    },
  });
  expect(semanticDom(unavailableMeasurement)).toMatchSnapshot();
  expect(unavailableMeasurement.root.findByProps({
    name: "measurementId",
  }).props.value)
    .toBe("");
  expect(allText(unavailableMeasurement)).toContain("Not reported");
  expect(unavailableMeasurement.root.findAllByType("p").map(nodeText))
    .toContain("USDA FoodData Central");
  await act(async () => unavailableMeasurement.unmount());
});

test("home food editor exposes saved fields, recalculation, and delete confirmation", async () => {
  const { renderer, submit } = await renderFoodHome(
    { editor: { canCopy: false, event: foodEvent() } },
    () => ({ code: "invalid_input", message: "Editor validation message" }),
  );
  expect(semanticDom(renderer)).toMatchSnapshot();
  expect(renderer.root.findByProps({ role: "dialog" }).props["aria-labelledby"])
    .toBe("edit-food-entry-title");
  const form = renderer.root.findByProps({ id: "food-entry-edit-form" });
  expect(form.props.action).toBe("/food-events");
  expect(formFields(form)).toEqual([
    "csrfToken", "date", "id", "expectedUpdatedAt", "name", "measurementId", "quantity",
    "energyKcal", "proteinGrams", "carbohydrateGrams", "fatGrams", "fiberGrams", "sugarGrams", "sodiumMilligrams",
  ]);
  expect(input(renderer, "expectedUpdatedAt").props.value).toBe("2026-08-31T16:00:00.000Z");
  expect(renderer.root.findByProps({ "aria-label": "Save changes" }).props).toMatchObject({ name: "intent", value: "update" });
  expect(input(renderer, "name").props.value).toBe("Editable yogurt");
  expect(input(renderer, "quantity").props.value).toBe("1");
  expect(input(renderer, "energyKcal").props.value).toBe("59");
  expect(input(renderer, "fiberGrams").props.value).toBe("");
  expect(input(renderer, "sodiumMilligrams").props.value).toBe("36");

  await submit("food-event:edit", { intent: "update" });
  expect(allText(renderer)).toContain("Editor validation message");

  await act(async () =>
    input(renderer, "name").props.onChange({ target: { value: "Renamed yogurt" } }),
  );
  expect(input(renderer, "name").props.value).toBe("Renamed yogurt");
  await act(async () =>
    input(renderer, "energyKcal").props.onChange({ target: { value: "61" } }),
  );
  expect(input(renderer, "energyKcal").props.value).toBe("61");
  const select = renderer.root.findByProps({ name: "measurementId" });
  await act(async () => select.props.onChange({ target: { value: "serving" } }));
  expect(semanticDom(renderer)).toMatchSnapshot();
  expect(input(renderer, "energyKcal").props.value).toBe("100.3");
  expect(input(renderer, "proteinGrams").props.value).toBe("17.85");
  expect(input(renderer, "fiberGrams").props.value).toBe("");

  await act(async () => select.props.onChange({ target: { value: "missing" } }));
  expect(renderer.root.findByProps({ name: "measurementId" }).props.value)
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
  expect(queriedSelectors).toEqual(['button[name="intent"][value="delete"]']);
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

test("a stale editor reloads the current version, and an event deleted elsewhere closes the editor", async () => {
  const current = foodEvent({ name: "Changed elsewhere", nutrients: { ...foodEvent().nutrients, energyMilliKcal: 80_000 }, updatedAt: "2026-08-31T16:05:00.000Z" });
  const stale = await renderFoodHome(
    { editor: { canCopy: false, event: foodEvent() } },
    () => ({ code: "edit_conflict", event: current, message: "This Food Event changed after you opened it. Review it and try again." }),
  );
  await act(async () => input(stale.renderer, "name").props.onChange({ target: { value: "My rejected draft" } }));
  await stale.submit("food-event:edit", { intent: "update" });
  expect(input(stale.renderer, "name").props.value).toBe("Changed elsewhere");
  expect(input(stale.renderer, "energyKcal").props.value).toBe("80");
  expect(input(stale.renderer, "expectedUpdatedAt").props.value).toBe("2026-08-31T16:05:00.000Z");
  expect(allText(stale.renderer)).toContain("This Food Event changed after you opened it. Review it and try again.");
  await act(async () => stale.renderer.unmount());

  const deleted = await renderFoodHome(
    { editor: { canCopy: false, event: foodEvent() }, foodLog: { ...baseFoodLog, selectedDate: "2026-08-30" } },
    () => ({ code: "not_found", message: "Food event not found." }),
  );
  await deleted.submit("food-event:edit", { intent: "delete" });
  expect(deleted.router.state.location.search).toBe("?date=2026-08-30");
  await act(async () => deleted.renderer.unmount());
});

test("manual Food Entry editor keeps calories required", async () => {
  const renderer = await renderHome({
    editor: { canCopy: false, event: foodEvent({ source: manualSource }) },
  });

  expect(input(renderer, "energyKcal").props.required).toBe(true);
  expect(input(renderer, "proteinGrams").props.required).toBeUndefined();
  await act(async () => renderer.unmount());
});

const savedTortilla = {
  createdAt: "2026-08-27T12:00:00.000Z",
  id: 77,
  name: "Mexican tortilla",
  snapshot: {
    ...foodEvent(),
    measurement: { baseQuantityMicrounits: 1_000_000, id: "serving", label: "1 serving", unit: "serving" },
    nutrients: {
      carbohydrateMilligrams: 18_000,
      energyMilliKcal: 100_000,
      fatMilligrams: 2_000,
      fiberMilligrams: null,
      proteinMilligrams: 3_000,
      sodiumMilligrams: 25,
      sugarMilligrams: 0,
    },
    quantityMicrounits: 2_000_000,
    source: manualSource,
  },
  sourceEventId: 5,
};

test("My foods can be browsed and searched before selecting a saved food", async () => {
  const listed = await renderHome({
    addFood: { favorites: [savedTortilla], mode: "my", query: "" },
  });
  expect(allText(listed)).toContain("Mexican tortilla");
  expect(allText(listed)).toContain("1 serving × 2");
  expect(allText(listed)).toContain("100 kcal");
  expect(listed.root.findByProps({
    href: "/?date=2026-08-31&food=saved%3A77",
  })).toBeDefined();
  expect(input(listed, "query").props.defaultValue).toBe("");
  await act(async () => listed.unmount());

  const noMatches = await renderHome({
    addFood: { favorites: [], mode: "my", query: "rice" },
  });
  expect(allText(noMatches)).toContain("No matching foods");
  await act(async () => noMatches.unmount());

  const noFoods = await renderHome({
    addFood: { favorites: [], mode: "my", query: "" },
  });
  expect(allText(noFoods)).toContain("No foods saved yet");
  expect(allText(noFoods)).toContain("Save a manual food here when you add it");
  expect(allText(noFoods)).toContain("open an older manual entry");
  await act(async () => noFoods.unmount());

  const searched = await renderHome({
    addFood: {
      favorites: [savedTortilla],
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
    },
  });
  expect(allText(searched)).toContain("My foods");
  expect(allText(searched)).toContain("Mexican tortilla");
  expect(allText(searched)).toContain("Nutrition unavailable");
  expect(allText(searched)).not.toContain("No foods found");
  await act(async () => searched.unmount());
});

test("saved food review keeps its recorded values and targets the displayed day", async () => {
  const addFood = { favorite: savedTortilla, mode: "saved", query: "" };
  const reviewed = await renderHome({
    addFood,
    foodLog: { ...baseFoodLog, selectedDate: "2026-08-29" },
  });
  expect(allText(reviewed)).toContain("Mexican tortilla");
  expect(allText(reviewed)).toContain("Review the saved values before adding this food to");
  expect(allText(reviewed)).toContain("Saturday, August 29, 2026");
  expect(allText(reviewed)).toContain("100");
  expect(allText(reviewed)).toContain("Unknown");
  expect(input(reviewed, "date").props.value).toBe("2026-08-29");
  expect(input(reviewed, "favoriteId").props.value).toBe(77);
  expect(input(reviewed, "method").props.value).toBe("favorite");
  const addButton = () => reviewed.root.findByProps({ role: "dialog" }).findAllByType("button").find((button) => button.props.type === "submit")!;
  expect(addButton().props.disabled).toBe(false);
  await act(async () => reviewed.unmount());

  const pending = await renderFoodHome({ addFood });
  await pending.submit("food-event:add", { intent: "log", method: "favorite" });
  expect(allText(pending.renderer)).toContain("Adding…");
  expect(pending.renderer.root.findByProps({ role: "dialog" }).findAllByType("button").find((button) => button.props.type === "submit")!.props.disabled)
    .toBe(true);
  // Only catalog saves replace the dialog with a pending row.
  expect(pending.renderer.root.findAllByProps({ "aria-label": "Adding food to Daily log" })).toHaveLength(0);
  await act(async () => pending.renderer.unmount());
});

test("an older manual entry offers a top action to save its independent food", async () => {
  const unsaved = await renderHome({
    editor: { canCopy: false, event: foodEvent({ source: manualSource }) },
  });
  expect(allText(unsaved)).toContain("Add to My foods");
  const favoriteForm = unsaved.root.findAllByType("form").find((form) =>
    form.findAllByProps({ name: "intent", value: "add-favorite" }).length > 0)!;
  expect(favoriteForm.props.action).toBe("/food-events");
  expect(favoriteForm.findAllByType("input").map((field) => [field.props.name, field.props.value])).toEqual([
    ["csrfToken", "home-component-csrf"],
    ["intent", "add-favorite"],
    ["id", 41],
    ["date", "2026-08-31"],
  ]);
  await act(async () => unsaved.unmount());

  const saved = await renderHome({
    editor: { canCopy: false, event: foodEvent({ favoriteId: 7, source: manualSource }) },
  });
  expect(allText(saved)).toContain("In My foods");
  expect(allText(saved)).toContain("Changes to this daily entry do not change the saved food");
  expect(saved.root.findAllByProps({ value: "add-favorite" })).toHaveLength(0);
  await act(async () => saved.unmount());

  const catalog = await renderHome({ editor: { canCopy: false, event: foodEvent() } });
  expect(allText(catalog)).not.toContain("My foods");
  await act(async () => catalog.unmount());
});

test("home water dialog creates with a consumption time and edits only the amount", async () => {
  queriedSelectors.length = 0;
  documentSelectors.length = 0;
  const waterPreviousFocus = new TestElement();
  (globalThis.document as unknown as { activeElement: TestElement }).activeElement =
    waterPreviousFocus;
  const createDialog = await renderHome({
    waterDialog: { initialLocalLogDate: "2026-08-31T12:00", maxLocalLogDate: "2026-08-31T12:00" },
  });
  expect(semanticDom(createDialog)).toMatchSnapshot();
  expect(allText(createDialog)).toContain("Add Water");
  expect(queriedSelectors).toContain('input:not([type="hidden"])');
  expect(createDialog.root.findAll((node) => node.type === "form" && node.props.action === "/water-events")).toHaveLength(1);
  expect(input(createDialog, "intent").props.value).toBe("save");
  expect(input(createDialog, "returnDate").props.value).toBe("2026-08-31");
  expect(input(createDialog, "csrfToken").props.value).toBe("home-component-csrf");
  expect(input(createDialog, "localLogDate").props).toMatchObject({
    defaultValue: "2026-08-31T12:00",
    max: "2026-08-31T12:00",
    required: true,
    type: "datetime-local",
  });
  expect(input(createDialog, "ounces").props).toMatchObject({
    defaultValue: "",
    max: "500",
    min: "0.001",
    step: "0.001",
    type: "number",
  });
  expect(input(createDialog, "id")).toBeUndefined();
  expect(allText(createDialog)).toContain("Add water");
  expect(allText(createDialog)).not.toContain("Delete");
  waterPreviousFocus.isConnected = false;
  documentRestoreTarget = new TestElement();
  await act(async () => createDialog.unmount());
  expect(documentSelectors).toContain(
    "[data-water-editor-trigger], [data-water-dialog-trigger]",
  );

  const event = {
    createdAt: "2026-08-31T17:15:00.000Z",
    id: 51,
    logDate: "2026-08-31T17:15:00.000Z",
    ounces: "16",
    updatedAt: "2026-08-31T17:15:00.000Z",
    userId: 1,
  };
  const edit = await renderHome({
    foodLog: { ...baseFoodLog, waterEvents: [event], waterTotalOunces: "16" },
    waterDialog: {
      event,
      initialLocalLogDate: "2026-08-31T12:00",
      maxLocalLogDate: "2026-08-31T12:00",
    },
  });
  expect(allText(edit)).toContain("Edit Water Event");
  expect(input(edit, "id").props.value).toBe(51);
  expect(input(edit, "ounces").props.defaultValue).toBe("16");
  expect(input(edit, "localLogDate")).toBeUndefined();
  expect(allText(edit)).toContain("Save amount");
  expect(edit.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(allText(edit)).not.toContain("Delete this Water Event?");
  const revealDelete = edit.root.findAllByType("button").find(
    (button) => nodeText(button) === "Delete",
  )!;
  await act(async () => revealDelete.props.onClick());
  expect(allText(edit)).toContain("Delete this Water Event?");
  expect(allText(edit)).toContain("The daily water total will decrease by this amount.");
  expect(input(edit, "eventIds").props.value).toBe(51);
  expect(edit.root.findAllByProps({ name: "intent", value: "delete" })).toHaveLength(1);
  const keep = edit.root.findAllByType("button").find(
    (button) => nodeText(button) === "Keep it",
  )!;
  await act(async () => keep.props.onClick());
  expect(allText(edit)).not.toContain("Delete this Water Event?");
  await act(async () => edit.unmount());

  const precise = await renderHome({
    foodLog: { ...baseFoodLog, goal: { ...completeGoal, waterTarget: "67.628" }, waterTotalOunces: "8.125" },
  });
  expect(allText(precise)).toContain("8.125 fl oz");
  expect(allText(precise)).toContain("/ 67.628 fl oz");
  expect(allText(precise)).not.toContain(" ml");
  await act(async () => precise.unmount());
});
test("home renders submission and navigation pending states", async () => {
  const existing = foodEvent({ id: 71, name: "Existing food" });
  const pendingFood = await renderFoodHome({
    addFood: { food: catalogFood, mode: "detail", query: "yogurt" },
    foodLog: { ...baseFoodLog, events: [existing], foodEvents: [existing] },
  });
  await pendingFood.submit("food-event:add", { intent: "log", method: "lookup" });
  expect(semanticDom(pendingFood.renderer)).toMatchSnapshot();
  expect(allText(pendingFood.renderer)).toContain("Plain Greek yogurt");
  expect(pendingFood.renderer.root.findByProps({
    "aria-label": "Adding food to Daily log",
  })).toBeDefined();
  // The dialog waits hidden, so a refusal can reappear with what was chosen.
  const dialogWrapper = pendingFood.renderer.root.findAll((node) => node.type === "div" && node.props.hidden === true);
  expect(dialogWrapper).toHaveLength(1);
  expect(dialogWrapper[0].findAllByProps({ role: "dialog" })).toHaveLength(1);
  expect(pendingFood.renderer.root.findByProps({ className: `${styles.shell} ${styles.foodLogShell}` }).props.inert)
    .toBeUndefined();
  await act(async () => pendingFood.renderer.unmount());

  const openFoodFactsPending = await renderFoodHome({
    addFood: { barcode: "034000470693", food: barcodeFood, mode: "barcode" },
  });
  await openFoodFactsPending.submit("food-event:add", { intent: "log", method: "barcode" });
  expect(nodeText(openFoodFactsPending.renderer.root.findByProps({ "aria-label": "Adding food to Daily log" })))
    .toContain("Example cereal");
  await act(async () => openFoodFactsPending.renderer.unmount());

  const unnamedPendingFood = await renderFoodHome({});
  await unnamedPendingFood.submit("food-event:add", { intent: "log", method: "lookup" });
  expect(allText(unnamedPendingFood.renderer)).toContain("Selected food");
  await act(async () => unnamedPendingFood.renderer.unmount());

  const pendingEditor = await renderFoodHome({ editor: { canCopy: false, event: foodEvent() } });
  await pendingEditor.submit("food-event:edit", { intent: "update" });
  expect(semanticDom(pendingEditor.renderer)).toMatchSnapshot();
  expect(pendingEditor.renderer.root.findByType("fieldset").props.disabled).toBe(true);
  expect(pendingEditor.renderer.root.findByProps({ "aria-label": "Saving changes" }).props.disabled).toBe(true);
  await act(async () => pendingEditor.renderer.unmount());

  const deletingEditor = await renderFoodHome({ editor: { canCopy: false, event: foodEvent() } });
  const revealFoodDelete = deletingEditor.renderer.root.findByProps({ "aria-label": "Delete entry" });
  await act(async () => revealFoodDelete.props.onClick());
  await deletingEditor.submit("food-event:edit", { intent: "delete" });
  expect(allText(deletingEditor.renderer)).toContain("Deleting…");
  await act(async () => deletingEditor.renderer.unmount());

  // Another dialog's submission leaves the editor editable.
  const idleEditor = await renderFoodHome({ editor: { canCopy: false, event: foodEvent() } });
  await idleEditor.submit("food-event:add", { intent: "log", method: "manual" });
  expect(idleEditor.renderer.root.findByType("fieldset").props.disabled).toBe(false);
  expect(idleEditor.renderer.root.findByProps({ "aria-label": "Save changes" }).props.disabled).toBe(false);
  await act(async () => idleEditor.renderer.unmount());

  const search = await renderPendingHome(
    { addFood: { mode: "search", query: "", results: [] } },
    { to: "/?food=search&query=yogurt" },
  );
  expect(semanticDom(search)).toMatchSnapshot();
  expect(allText(search)).toContain("Searching USDA foods");
  await act(async () => search.unmount());

  const detail = await renderPendingHome(
    { addFood: { mode: "search", query: "yogurt", results: [] } },
    { to: "/?food=1001&query=yogurt" },
  );
  expect(semanticDom(detail)).toMatchSnapshot();
  expect(detail.root.findByProps({ "aria-label": "Loading food details" }))
    .toBeDefined();
  await act(async () => detail.unmount());

  const unrelated = await renderPendingHome(
    { addFood: { mode: "search", query: "", results: [] } },
    { to: "/?other=1" },
  );
  expect(allText(unrelated)).toContain("Searching USDA foods");
  expect(unrelated.root.findAllByProps({ "aria-label": "Loading food details" }))
    .toHaveLength(0);
  await act(async () => unrelated.unmount());

  const detailCatalogDuringLoad = await renderPendingHome(
    { addFood: { food: catalogFood, mode: "detail", query: "yogurt" } },
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
  const renderer = await renderHome({ editor: { event: foodEvent(), canCopy: false } });
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
    addFood: { mode: "search", query: "", results: [] },
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
  const event = foodEvent({ id: 93, logDate: "2026-08-28T16:00:00.000Z", name: "Historical yogurt" });
  const { renderer, submit } = await renderFoodHome(
    { copy: copyDialogModel(event, "2026-08-28", "2026-09-05", "2026-08-29") },
    () => ({ code: "future_date", message: "Future Food Logs cannot be changed" }),
  );
  expect(queriedSelectors).toContain("[data-copy-calendar-day]");
  await submit("food-event:copy", { intent: "copy" });
  const dialog = renderer.root.findByProps({ role: "dialog" });
  expect(dialog.props.className).toBe(styles.foodDialog);
  expect(nodeText(dialog.findByProps({ role: "alert" }))).toBe("Future Food Logs cannot be changed");
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

test("copy confirmation needs a destination and locks only while this copy submits", async () => {
  const event = foodEvent({ id: 93, logDate: "2026-08-28T16:00:00.000Z", name: "Historical yogurt" });
  const empty = await renderHome({ copy: copyDialogModel(event, "2026-08-28", "2026-08-30") });
  const confirm = (renderer: ReactTestRenderer) => renderer.root.findByProps({ role: "dialog" }).findAllByType("button").find((button) => button.props.type === "submit")!;
  expect(allText(empty)).toContain("Choose an eligible date");
  expect(input(empty, "destinationDate")).toBeUndefined();
  expect(confirm(empty).props.disabled).toBe(true);
  expect(nodeText(confirm(empty))).toBe("Copy");
  expect(empty.root.findByProps({ "aria-label": "Sunday, August 30" }).props.className).toBe(`${styles.calendarDay} ${styles.calendarToday}`);
  await act(async () => empty.unmount());
  for (const [key, pending] of [
    ["food-event:copy", true],
    ["food-event:copy-to-today", false],
  ] as const) {
    const { renderer, submit } = await renderFoodHome({ copy: copyDialogModel(event, "2026-08-28", "2026-08-30", "2026-08-30") });
    await submit(key, { intent: "copy" });
    expect(confirm(renderer).props.disabled).toBe(pending);
    expect(nodeText(confirm(renderer))).toBe(pending ? "Copying…" : "Copy");
    await act(async () => renderer.unmount());
  }
});

test("manual entry submission disables editing only for its own submission", async () => {
  for (const [key, pending] of [["food-event:add", true], ["food-event:copy-to-today", false]] as const) {
    const { renderer, submit } = await renderFoodHome({ addFood: { mode: "manual" } });
    await submit(key, { intent: "log", method: "manual" });
    expect(renderer.root.findByType("fieldset").props.disabled).toBe(pending);
    expect(allText(renderer)).toContain(pending ? "Adding…" : "Add to Food Log");
    // A manual save keeps its dialog open rather than showing a pending row.
    expect(renderer.root.findAllByProps({ "aria-label": "Adding food to Daily log" })).toHaveLength(0);
    await act(async () => renderer.unmount());
  }
});

test("a former photo meal reads as a manual entry in the timeline and opens the manual editor", async () => {
  const formerEstimate = foodEvent({
    authority: { ...foodEvent().authority, quantityMicrounits: 1_000_000, unit: "serving" },
    measurement: { baseQuantityMicrounits: 1_000_000, id: "plate", label: "Analyzed plate", unit: "serving" },
    measurements: [{ baseQuantityMicrounits: 1_000_000, id: "plate", label: "Analyzed plate", unit: "serving" }],
    name: "Chicken rice bowl",
    source: manualSource,
  });
  const water = { id: 41, kind: "water", logDate: "2026-08-31T16:05:00.000Z", ounces: "8" };
  const renderer = await renderHome({
    editor: { canCopy: false, event: formerEstimate },
    foodLog: { ...baseFoodLog, events: [water, formerEstimate], foodEvents: [formerEstimate] },
  });
  const timeline = renderer.root.findByProps({ className: styles.entryList });
  expect(timeline.findAllByType("article")).toHaveLength(2);
  const entryLink = timeline.findAllByType("a").find(node => node.props.href === "/?date=2026-08-31&entry=41")!;
  expect(entryLink.props.className).toBe(styles.foodEntryCard);
  expect(nodeText(entryLink.findByProps({ className: styles.foodEntryContent }))).toBe("Chicken rice bowlManualAnalyzed plate × 1");
  expect(nodeText(entryLink.findByProps({ className: styles.foodEntryEnergy }))).toBe("59 kcal");
  expect(timeline.findAllByType("button")).toHaveLength(0);
  expect(timeline.findAllByProps({ role: "status" })).toHaveLength(0);
  expect(renderer.root.findByType("fieldset").props.disabled).toBe(false);
  expect(input(renderer, "name").props.value).toBe("Chicken rice bowl");
  expect(renderer.root.findByProps({ value: "add-favorite" }).type).toBe("input");
  expect(allText(renderer)).not.toMatch(/photo|\bAI\b|Analysis/i);
  await act(async () => renderer.unmount());
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
