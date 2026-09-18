import {
  Children,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { createRoutesStub, Outlet } from "react-router";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, test } from "vitest";

import App, { ErrorBoundary, Layout, links } from "../../app/root";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function renderInRoute(children: ReactNode): Promise<ReactTestRenderer> {
  const Component = () => children;
  const Routes = createRoutesStub([{ Component, path: "/" }]);
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(createElement(Routes, { initialEntries: ["/"] }));
  });
  return renderer!;
}

test("root publishes the complete installable-app link contract", () => {
  expect(links()).toEqual([
    { href: "", rel: "stylesheet" },
    {
      href: "/favicon.png",
      rel: "icon",
      sizes: "64x64",
      type: "image/png",
    },
    {
      href: "/apple-touch-icon.png",
      rel: "apple-touch-icon",
      sizes: "180x180",
    },
    { href: "/manifest.webmanifest", rel: "manifest" },
  ]);
});

test("root layout exposes the document and mobile metadata", async () => {
  let documentLayout: ReturnType<typeof Layout> | undefined;
  const Probe = () => {
    documentLayout = Layout({ children: createElement("p", null, "Route body") });
    return null;
  };
  const renderer = await renderInRoute(createElement(Probe));
  const layout = documentLayout! as ReactElement<{ lang: string; children: ReactNode }>;
  expect(layout.type).toBe("html");
  expect(layout.props.lang).toBe("en");
  const [head, body] = Children.toArray(layout.props.children) as ReactElement<{
    children?: ReactNode;
  }>[];
  expect(head.type).toBe("head");
  expect(body.type).toBe("body");
  const metas = Children.toArray(head.props.children)
    .filter((child): child is ReactElement<Record<string, unknown>> =>
      isValidElement<Record<string, unknown>>(child) && child.type === "meta",
    )
    .map((element) => element.props);
  expect(metas).toEqual(expect.arrayContaining([
    { charSet: "utf-8" },
    { content: "width=device-width, initial-scale=1", name: "viewport" },
    { content: "#111820", name: "theme-color" },
    { content: "yes", name: "apple-mobile-web-app-capable" },
    { content: "yes", name: "mobile-web-app-capable" },
    { content: "Open Calorie Tracker", name: "apple-mobile-web-app-title" },
    { content: "default", name: "apple-mobile-web-app-status-bar-style" },
    { content: "telephone=no", name: "format-detection" },
  ]));
  const bodyChildren = Children.toArray(body.props.children) as ReactElement<{
    children?: ReactNode;
  }>[];
  expect(bodyChildren[0]).toMatchObject({
    props: { children: "Route body" },
    type: "p",
  });
  renderer.unmount();
});

test("root app renders its nested route outlet", async () => {
  const Routes = createRoutesStub([
    {
      Component: App,
      children: [{ Component: () => createElement("p", null, "Nested route"), index: true }],
      path: "/",
    },
  ]);
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(createElement(Routes, { initialEntries: ["/"] }));
  });
  expect(renderer!.root.findByType("p").children.join(""))
    .toBe("Nested route");
  expect(renderer!.root.findByType(Outlet)).toBeDefined();
  renderer!.unmount();
});

test.each([
  [
    { data: "missing", internal: false, status: 404, statusText: "Not Found" },
    "Page not found",
    "This page does not exist.",
  ],
  [
    { data: "failure", internal: false, status: 500, statusText: "Failure" },
    "Something went wrong",
    "The application could not complete this request.",
  ],
  [null, "Something went wrong", "The application could not complete this request."],
  [new Error("unexpected"), "Something went wrong", "The application could not complete this request."],
] as const)("root error boundary renders safe error state %#", async (
  error,
  heading,
  message,
) => {
  const renderer = await renderInRoute(createElement(ErrorBoundary, { error }));
  expect(renderer.root.findByProps({ id: "error-heading" }).children.join(""))
    .toBe(heading);
  expect(renderer.root.findAllByType("p").map((node) => node.children.join("")))
    .toEqual(["Open Calorie Tracker", message]);
  renderer.unmount();
});
