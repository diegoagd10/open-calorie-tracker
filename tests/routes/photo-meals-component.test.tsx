/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- react-test-renderer host props are untyped */
import { createElement, type ComponentProps } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PhotoCorrection, PhotoMeals } from "../../app/routes/photo-meals";

const state = vi.hoisted(() => ({
  fetcher: {
    state: "idle",
    data: undefined as { error?: string; id?: string } | undefined,
    submit: vi.fn(),
  },
  revalidator: { state: "idle", revalidate: vi.fn() },
  navigate: vi.fn(),
}));
vi.mock("react-router", () => ({
  useFetcher: () => ({
    ...state.fetcher,
    Form: (props: Record<string, unknown>) => createElement("form", props),
  }),
  useRevalidator: () => state.revalidator,
  useNavigate: () => state.navigate,
  Link: ({ to, ...props }: Record<string, unknown>) =>
    createElement("a", { ...props, href: to }),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
type Meal = ComponentProps<typeof PhotoMeals>["meals"][number];
const meal: Meal = {
  id: "meal&photo",
  entryId: 42,
  name: "Renamed dinner",
  foodLogDate: "2026-09-04",
  status: "succeeded",
  stage: "Preparing result",
  attemptId: "attempt-one",
  startedAt: "2026-09-05T03:59:00.000Z",
  finishedAt: "2026-09-05T03:59:10.000Z",
  error: null,
  energyMilliKcal: 250400,
  result: {
    name: "AI dinner",
    consumedFraction: 0.5,
    assumptions: ["Estimated rice weight"],
    components: [
      {
        id: "rice",
        name: "Rice",
        quantity: 200,
        unit: "g",
        includes: [],
        source: { kind: "usda", fdcId: "700" },
        supplements: [
          {
            nutrient: "proteinGrams",
            amount: 5,
            reason: "Missing from reference",
          },
        ],
        nutrition: {
          energyKcal: 250,
          proteinGrams: 5,
          carbohydrateGrams: 50,
          fatGrams: 2,
        },
      },
      {
        id: "butter",
        name: "Butter",
        quantity: 5,
        unit: "g",
        includes: [],
        source: { kind: "ai", reason: "No suitable match" },
        supplements: [],
        nutrition: {
          energyKcal: 36,
          proteinGrams: 0,
          carbohydrateGrams: 0,
          fatGrams: 4,
        },
      },
    ],
  },
};
let renderer: ReactTestRenderer;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-05T03:59:00.000Z"));
  state.fetcher.state = "idle";
  state.fetcher.data = undefined;
  state.revalidator.state = "idle";
  vi.clearAllMocks();
});
afterEach(async () => {
  if (renderer) await act(() => renderer.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function render(meals: Meal[] = [meal]) {
  await act(() => {
    renderer = create(
      createElement(PhotoMeals, {
        meals,
        date: "2026-09-04",
        csrfToken: "csrf-photo",
      }),
    );
  });
}
function text() {
  return JSON.stringify(renderer.toJSON());
}
function buttons() {
  return renderer.root
    .findAllByType("button")
    .map((button) => button.children.join(""));
}

test("completed photo cards use edited names, private image URLs, rounded calories and owned entry links", async () => {
  await render();
  expect(renderer.root.findByType("article").props["aria-label"]).toBe(
    "Renamed dinner",
  );
  expect(renderer.root.findByType("img").props).toMatchObject({
    src: "/photo-analysis?id=meal%26photo&image=1",
    alt: "Your plate",
  });
  expect(renderer.root.findByType("a").props).toMatchObject({
    href: "/?date=2026-09-04&entry=42",
    "data-entry-editor-trigger": true,
  });
  expect(text()).toContain("250 kcal");
  expect(buttons()).toEqual([]);
  expect(renderer.root.findAllByType("progress")).toHaveLength(0);
  await act(() => {
    vi.advanceTimersByTime(2000);
  });
  expect(state.revalidator.revalidate).not.toHaveBeenCalled();
  expect(
    renderer.root.findByProps({ "aria-label": "Take plate photo" }).props,
  ).toMatchObject({
    type: "file",
    capture: "environment",
    accept: "image/jpeg,image/png,image/webp",
    disabled: false,
  });
});

test("active cards block entry access, announce progress and elapsed time, and poll only when idle", async () => {
  await render([
    { ...meal, status: "active", stage: "Consulting USDA", finishedAt: null },
  ]);
  expect(renderer.root.findAllByType("a")).toHaveLength(0);
  expect(renderer.root.findByType("progress").props["aria-label"]).toBe(
    "Consulting USDA",
  );
  expect(renderer.root.findByProps({ role: "status" }).children).toEqual([
    "Consulting USDA",
  ]);
  expect(buttons()).toEqual(["Cancel analysis"]);
  expect(text()).toContain("Previous nutrition retained");
  expect(renderer.root.findByType("form").props).toMatchObject({
    action: "/photo-analysis",
    method: "post",
  });
  for (const [name, value] of Object.entries({
    csrfToken: "csrf-photo",
    id: meal.id,
    attemptId: meal.attemptId,
    idempotencyKey: "retry:attempt-one",
  }))
    expect(renderer.root.findByProps({ name }).props).toMatchObject({
      type: "hidden",
      value,
    });
  expect(renderer.root.findByType("button").props).toMatchObject({
    name: "intent",
    value: "cancel",
    disabled: false,
  });
  await act(() => {
    vi.advanceTimersByTime(2200);
  });
  expect(text()).toContain('"2"," seconds elapsed"');
  expect(state.revalidator.revalidate).toHaveBeenCalledTimes(2);
  state.revalidator.state = "loading";
  await act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(state.revalidator.revalidate).toHaveBeenCalledTimes(2);
  await act(() => renderer.unmount());
  state.revalidator.state = "idle";
  expect(vi.getTimerCount()).toBe(0);
  await act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(state.revalidator.revalidate).toHaveBeenCalledTimes(2);
});

test("new pending and unsuccessful cards display no nutrition and expose recovery actions", async () => {
  state.fetcher.state = "submitting";
  state.fetcher.data = { error: "Request rejected" };
  await render([
    {
      ...meal,
      name: null,
      entryId: null,
      result: null,
      status: "failed",
      error: "Analysis timed out",
      energyMilliKcal: null,
    },
  ]);
  expect(text()).toContain("Plate photo");
  expect(text()).not.toContain("kcal");
  expect(text()).toContain("Analysis timed out");
  expect(text()).toContain("Request rejected");
  const actions = renderer.root.findAllByType("button");
  expect(actions.map((button) => button.props.value)).toEqual([
    "retry",
    "delete",
  ]);
  expect(actions.every((button) => button.props.disabled === true)).toBe(true);
});

test("capture uploads the selected date and CSRF once, previews progress, and retries the identical request", async () => {
  const createUrl = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue("blob:photo-preview");
  const revokeUrl = vi
    .spyOn(URL, "revokeObjectURL")
    .mockImplementation(() => {});
  await render([]);
  const file = new File([new Uint8Array(12)], "plate.png", {
    type: "image/png",
  });
  const target = { files: [file], value: "selected" };
  await act(() =>
    renderer.root
      .findByProps({ "aria-label": "Take plate photo" })
      .props.onChange({ target }),
  );
  expect(createUrl).toHaveBeenCalledWith(file);
  expect(target.value).toBe("");
  const [body, options] = state.fetcher.submit.mock.calls[0] as [
    FormData,
    unknown,
  ];
  expect(options).toEqual({
    action: "/photo-analysis",
    method: "post",
    encType: "multipart/form-data",
  });
  expect(Object.fromEntries(body)).toMatchObject({
    intent: "start",
    date: "2026-09-04",
    csrfToken: "csrf-photo",
    photo: file,
    idempotencyKey: expect.any(String),
  });
  expect(String(body.get("idempotencyKey"))).toMatch(/^[a-f0-9-]{36}$/);
  state.fetcher.state = "submitting";
  await act(() =>
    renderer.update(
      createElement(PhotoMeals, {
        meals: [],
        date: "2026-09-04",
        csrfToken: "csrf-photo",
      }),
    ),
  );
  expect(
    renderer.root.findByProps({ "aria-label": "Take plate photo" }).props
      .disabled,
  ).toBe(true);
  expect(renderer.root.findByType("img").props).toMatchObject({
    src: "blob:photo-preview",
    alt: "Plate being uploaded",
  });
  expect(renderer.root.findByType("progress").props["aria-label"]).toBe(
    "Uploading photo",
  );
  expect(text()).toContain("Uploading photo…");
  expect(text()).toContain("Keep this page open until upload finishes.");
  state.fetcher.state = "idle";
  state.fetcher.data = { error: "Upload failed" };
  await act(() =>
    renderer.update(
      createElement(PhotoMeals, {
        meals: [],
        date: "2026-09-04",
        csrfToken: "csrf-photo",
      }),
    ),
  );
  expect(text()).toContain("Upload failed");
  await act(() => renderer.root.findByType("button").props.onClick());
  expect(state.fetcher.submit.mock.calls[1]).toEqual([body, options]);
  await act(() => renderer.unmount());
  expect(revokeUrl).toHaveBeenCalledWith("blob:photo-preview");
});

test("empty capture does nothing and oversized photos explain the limit before uploading", async () => {
  await render([]);
  const change = renderer.root.findByProps({ "aria-label": "Take plate photo" })
    .props.onChange;
  await act(() => change({ target: { files: undefined } }));
  await act(() => change({ target: { files: [] } }));
  expect(state.fetcher.submit).not.toHaveBeenCalled();
  await act(() => change({ target: { files: [{ size: 8388609 }] } }));
  expect(text()).toContain("Choose a photo up to 8 MB.");
  expect(buttons()).toEqual([]);
  expect(state.fetcher.submit).not.toHaveBeenCalled();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:maximum");
  await act(() =>
    change({
      target: {
        files: [
          new File([new Uint8Array(8388608)], "max.png", { type: "image/png" }),
        ],
        value: "selected",
      },
    }),
  );
  expect(state.fetcher.submit).toHaveBeenCalledTimes(1);
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
});

test("correction details retain provenance and the repeatable form submits the owned entry", async () => {
  await act(() => {
    renderer = create(
      createElement(PhotoCorrection, { meal, csrfToken: "csrf-photo" }),
    );
  });
  expect(renderer.root.findByType("img").props).toMatchObject({
    alt: "Original plate",
    src: "/photo-analysis?id=meal%26photo&image=1",
  });
  expect(renderer.root.findByType("summary").children).toEqual([
    "Components, sources and assumptions",
  ]);
  for (const value of [
    "Consumed fraction:",
    "0.5",
    "Rice",
    "200",
    "USDA FDC 700",
    "AI estimate for ",
    "proteinGrams",
    "Missing from reference",
    "AI estimate: No suitable match",
    "Estimated rice weight",
  ])
    expect(text()).toContain(value);
  expect(buttons()).toEqual(["Correct with AI"]);
  expect(state.navigate).not.toHaveBeenCalled();
  await act(() => renderer.root.findByType("button").props.onClick());
  expect(renderer.root.findByType("form").props).toMatchObject({
    action: "/photo-analysis",
    method: "post",
  });
  for (const [name, value] of Object.entries({
    csrfToken: "csrf-photo",
    entryId: 42,
    intent: "correct",
  }))
    expect(renderer.root.findByProps({ name }).props).toMatchObject({
      type: "hidden",
      value,
    });
  expect(
    renderer.root.findByProps({ name: "idempotencyKey" }).props.value,
  ).toMatch(/^[a-f0-9-]{36}$/);
  expect(renderer.root.findByType("textarea").props).toMatchObject({
    name: "correction",
    required: true,
    maxLength: 2000,
    autoFocus: true,
    placeholder: "For example: it has butter",
  });
  expect(buttons()).toEqual(["Apply correction"]);
  expect(renderer.root.findByType("button").props.disabled).toBe(false);
  state.fetcher.state = "submitting";
  state.fetcher.data = { id: meal.id };
  await act(() =>
    renderer.update(
      createElement(PhotoCorrection, { meal, csrfToken: "csrf-photo" }),
    ),
  );
  expect(buttons()).toEqual(["Starting correction…"]);
  expect(renderer.root.findByType("button").props.disabled).toBe(true);
  expect(state.navigate).not.toHaveBeenCalled();
  state.fetcher.state = "idle";
  state.fetcher.data = { error: "Try again" };
  await act(() =>
    renderer.update(
      createElement(PhotoCorrection, { meal, csrfToken: "csrf-photo" }),
    ),
  );
  expect(renderer.root.findByProps({ role: "alert" }).children).toEqual([
    "Try again",
  ]);
  expect(state.navigate).not.toHaveBeenCalled();
  state.fetcher.data = { id: meal.id };
  await act(() =>
    renderer.update(
      createElement(PhotoCorrection, { meal, csrfToken: "csrf-photo" }),
    ),
  );
  expect(state.navigate).toHaveBeenCalledWith("/?date=2026-09-04");
});

test("recovery controls stay usable when idle and lock while their request submits", async () => {
  const failed = { ...meal, status: "failed" as const, error: "Retry this analysis" };
  await render([failed]);
  expect(renderer.root.findAllByType("button").map(button => button.props.disabled)).toEqual([false, false]);
  state.fetcher.state = "submitting";
  await act(() => renderer.update(createElement(PhotoMeals, { meals: [{ ...meal, status: "active" }], date: "2026-09-04", csrfToken: "csrf-photo" })));
  const cancel = renderer.root.findAllByType("button").find(button => button.props.value === "cancel")!;
  expect(cancel.props.disabled).toBe(true);
});

test("polling follows active status changes among multiple meals and stops when they finish", async () => {
  await render([meal]);
  expect(vi.getTimerCount()).toBe(0);
  const pending: Meal = { ...meal, id: "pending-photo", entryId: null, name: null, result: null, energyMilliKcal: null, status: "active", stage: "Analyzing photo", finishedAt: null };
  await act(() => renderer.update(createElement(PhotoMeals, { meals: [meal, pending], date: "2026-09-04", csrfToken: "csrf-photo" })));
  const card = renderer.root.findByProps({ "aria-label": "Plate photo" });
  expect(card.findAllByType("small").map(node => node.children.join(""))).toEqual(["AI photo estimate", "0 seconds elapsed"]);
  await act(() => { vi.advanceTimersByTime(1000); });
  expect(state.revalidator.revalidate).toHaveBeenCalledTimes(1);
  await act(() => renderer.update(createElement(PhotoMeals, { meals: [meal, { ...pending, status: "failed", error: "Try again" }], date: "2026-09-04", csrfToken: "csrf-photo" })));
  expect(vi.getTimerCount()).toBe(0);
  await act(() => { vi.advanceTimersByTime(2000); });
  expect(state.revalidator.revalidate).toHaveBeenCalledTimes(1);
});
