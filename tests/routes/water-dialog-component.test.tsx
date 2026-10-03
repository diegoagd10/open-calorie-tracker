import { createElement, type ReactNode } from "react";
import { createRoutesStub } from "react-router";
import { act, create, type ReactTestRenderer, type ReactTestRendererJSON } from "react-test-renderer";
import { beforeEach, expect, test, vi } from "vitest";

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
});

async function render(event?: { id: number; ounces: string }) {
  const Routes = createRoutesStub([{
    path: "/",
    Component: () => createElement(WaterDialog, {
      actionHref: "/water-events",
      closeHref: "/?date=2026-08-31",
      csrfToken: "csrf",
      event,
      initialLocalLogDate: "2026-08-31T12:00",
      maxLocalLogDate: "2026-08-31T12:00",
      returnDate: "2026-08-31",
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
    .toBe("Enter when the water was consumed; it cannot be in the future.");

  fetcher.data = { error: "invalid_amount" };
  expect(text(await render())).toContain("Enter an amount from 0.001 to 500 fl oz, with at most three decimals.");
  fetcher.data = { error: "something_else" };
  expect(text(await render())).toContain("The water amount could not be saved.");
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
