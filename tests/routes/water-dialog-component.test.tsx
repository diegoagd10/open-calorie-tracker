import { createElement, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { createRoutesStub } from "react-router";
import { act, create, type ReactTestRenderer, type ReactTestRendererJSON } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type FetcherState = { data?: { error: string }; formData?: FormData; state: "idle" | "submitting" };
const fetcher: FetcherState = { state: "idle" };

vi.mock("react-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-router")>();
  const Form = ({ children, ...props }: { children: ReactNode }) => createElement("form", props, children);
  return { ...original, useFetcher: () => ({ ...fetcher, Form }) };
});

const { WaterDialog } = await import("../../app/water-event/components/water-dialog");

beforeEach(() => {
  Object.assign(fetcher, { data: undefined, formData: undefined, state: "idle" });
  vi.spyOn(performance, "now").mockReturnValue(1_000);
});

afterEach(() => vi.restoreAllMocks());

async function render(event?: { id: number; ounces: string }, initialLocalLogDate = "2026-08-31T12:00") {
  const Routes = createRoutesStub([{
    path: "/",
    Component: () => createElement(WaterDialog, {
      actionHref: "/water-events",
      closeHref: "/?date=2026-08-31",
      csrfToken: "csrf",
      event,
      initialLocalLogDate,
      maxLocalLogDate: "2026-08-31T12:00",
      returnDate: "2026-08-31",
      timeZone: "America/New_York",
    }),
  }]);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(Routes, { initialEntries: ["/"] }));
  });
  return renderer;
}

type RenderedNode = string | ReactTestRendererJSON | ReactTestRendererJSON[] | null;

function collect(node: RenderedNode): string {
  if (node === null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(collect).join("");
  return (node.children ?? []).map(collect).join("");
}

function text(renderer: ReactTestRenderer): string {
  return collect(renderer.toJSON());
}

function intent(value: string): FormData {
  const formData = new FormData();
  formData.set("intent", value);
  return formData;
}

test("a rejected save shows its message while the dialog keeps what was typed", async () => {
  fetcher.data = { error: "invalid_log_date" };
  const dialog = await render();
  expect(dialog.root.findByProps({ role: "alert" }).children.join(""))
    .toBe("The consumption time could not be recorded. Please reopen the dialog and try again.");

  fetcher.data = { error: "invalid_amount" };
  expect(text(await render())).toContain("Enter an amount from 0.001 to 500 fl oz, with at most three decimals.");
  fetcher.data = { error: "something_else" };
  expect(text(await render())).toContain("The water amount could not be saved.");
});

test("presets select one submitted amount and Custom keeps its draft when switching", async () => {
  const dialog = await render();
  const save = dialog.root.findByProps({ type: "submit" });
  expect(save.props.disabled).toBe(true);
  expect(dialog.root.findByProps({ name: "localLogDate" }).props.type).toBe("hidden");
  expect(text(dialog)).not.toContain("Consumed at");

  for (const amount of ["8", "11", "16", "24"]) {
    const choice = dialog.root.findByProps({ "aria-label": `${amount} fl oz` });
    await act(async () => { (choice.props.onClick as () => void)(); });
    expect(choice.props["aria-pressed"]).toBe(true);
    expect(dialog.root.findAllByProps({ "aria-pressed": true })).toHaveLength(1);
    expect(dialog.root.findByProps({ name: "ounces" }).props.value).toBe(amount);
    expect(save.props.disabled).toBe(false);
  }

  const custom = dialog.root.findByProps({ "aria-controls": "water-custom-amount" });
  await act(async () => { (custom.props.onClick as () => void)(); });
  const amountInput = dialog.root.findByProps({ name: "ounces" });
  expect(amountInput.props.type).toBe("number");
  expect(save.props.disabled).toBe(true);
  await act(async () => {
    (amountInput.props.onChange as (event: ChangeEvent<HTMLInputElement>) => void)(
      { currentTarget: { value: "12.5" } } as ChangeEvent<HTMLInputElement>,
    );
  });
  expect(save.props.disabled).toBe(false);
  await act(async () => {
    (dialog.root.findByProps({ "aria-label": "8 fl oz" }).props.onClick as () => void)();
  });
  expect(dialog.root.findByProps({ name: "ounces" }).props.value).toBe("8");
  await act(async () => { (custom.props.onClick as () => void)(); });
  expect(dialog.root.findAllByProps({ name: "ounces" })).toHaveLength(1);
  expect(dialog.root.findByProps({ name: "ounces" }).props.value).toBe("12.5");
});

test.each(["0", "500.001", "1.0001", "1e2"])("Custom refuses %s before saving", async (amount) => {
  const dialog = await render({ id: 51, ounces: amount });
  expect(dialog.root.findByProps({ type: "submit" }).props.disabled).toBe(true);
  expect(dialog.root.findByProps({ name: "ounces" }).props["aria-invalid"]).toBe(true);
  expect(text(dialog)).toContain("Enter an amount from 0.001 to 500 fl oz, with at most three decimals.");
});

test.each(["0.001", "500", "20.25"])("editing %s opens Custom with the saved amount", async (amount) => {
  const dialog = await render({ id: 51, ounces: amount });
  expect(dialog.root.findByProps({ "aria-controls": "water-custom-amount" }).props["aria-pressed"]).toBe(true);
  expect(dialog.root.findByProps({ name: "ounces" }).props.value).toBe(amount);
  expect(dialog.root.findByProps({ type: "submit" }).props.disabled).toBe(false);
  expect(dialog.root.findAllByProps({ name: "localLogDate" })).toHaveLength(0);
});

test("today's consumption time advances at submission; historical and edited times stay unchanged", async () => {
  const now = await render();
  vi.spyOn(performance, "now").mockReturnValue(91_000);
  const localDate = { value: "2026-08-31T12:00" };
  const submission = {
    currentTarget: { elements: { namedItem: () => localDate } },
  } as unknown as FormEvent<HTMLFormElement>;
  (now.root.findByType("form").props.onSubmit as (event: FormEvent<HTMLFormElement>) => void)(submission);
  expect(localDate.value).toBe("2026-08-31T12:01");

  const historical = await render(undefined, "2026-08-30T12:00");
  localDate.value = "2026-08-30T12:00";
  (historical.root.findByType("form").props.onSubmit as (event: FormEvent<HTMLFormElement>) => void)(submission);
  expect(localDate.value).toBe("2026-08-30T12:00");

  const edited = await render({ id: 51, ounces: "16" });
  (edited.root.findByType("form").props.onSubmit as (event: FormEvent<HTMLFormElement>) => void)(submission);
  expect(localDate.value).toBe("2026-08-30T12:00");
});

test("a pending save or delete disables the form and names what is happening", async () => {
  Object.assign(fetcher, { formData: intent("save"), state: "submitting" });
  const saving = await render();
  expect(saving.root.findByType("fieldset").props.disabled).toBe(true);
  expect(text(saving)).toContain("Saving…");

  Object.assign(fetcher, { formData: intent("delete"), state: "submitting" });
  const deleting = await render({ id: 51, ounces: "16" });
  const reveal = deleting.root.findAllByType("button").find((button) => button.children.includes("Delete"))!;
  await act(async () => {
    (reveal.props.onClick as () => void)();
  });
  expect(text(deleting)).toContain("Deleting…");
  expect(text(deleting)).toContain("Save amount");
  // The confirmation text is the alert; a form cannot carry role="alert".
  const confirmation = deleting.root.findByProps({ role: "alert" });
  expect(confirmation.type).toBe("div");
  expect(collect(confirmation.children as never)).toContain("Delete this Water Event?");

  Object.assign(fetcher, { formData: undefined, state: "idle" });
  const idle = await render();
  expect(idle.root.findByType("fieldset").props.disabled).toBe(false);
  expect(text(idle)).toContain("Add water");
  expect(idle.root.findAllByProps({ role: "alert" })).toHaveLength(0);
});
