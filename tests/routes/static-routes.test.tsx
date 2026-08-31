/* eslint-disable @typescript-eslint/no-unsafe-return -- react-test-renderer host props are untyped */
import { createElement, type ReactNode } from "react";
import { createRoutesStub } from "react-router";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, test } from "vitest";

import { AppNavigation } from "../../app/app-navigation";
import { AuthShell } from "../../app/auth/auth-shell";
import routeConfig from "../../app/routes";
import { loader as liveLoader } from "../../app/routes/health.live";
import { UiIcon, type UiIconName } from "../../app/ui-icon";

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

describe("static route contracts", () => {
  test("the liveness endpoint returns an uncached live response", async () => {
    const response = liveLoader();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "live" });
  });

  test("the complete public route table maps URLs to their modules", () => {
    expect(routeConfig).toEqual([
      { file: "./routes/home.tsx", index: true },
      { file: "./routes/login.tsx", path: "login" },
      { file: "./routes/logout.tsx", path: "logout" },
      { file: "./routes/register.tsx", path: "register" },
      { file: "./routes/setup.tsx", path: "setup" },
      { file: "./routes/settings.goals.tsx", path: "settings/goals" },
      { file: "./routes/account.password.tsx", path: "account/password" },
      { file: "./routes/health.live.ts", path: "health/live" },
      { file: "./routes/health.ready.ts", path: "health/ready" },
    ]);
  });
});

describe("shared route components", () => {
  test.each([
    ["login", "page", undefined, true, false],
    ["register", undefined, "page", false, true],
  ] as const)(
    "authentication shell marks only %s active",
    async (activePage, loginCurrent, registerCurrent, loginActive, registerActive) => {
      const renderer = await renderInRoute(
        createElement(
          AuthShell,
          {
            activePage,
            children: createElement("p", null, "Form contents"),
          },
        ),
      );
      const links = renderer.root.findAllByType("a");
      expect(links).toHaveLength(2);
      expect(links[0].props).toMatchObject({
        "aria-current": loginCurrent,
        href: "/login",
      });
      expect(links[1].props).toMatchObject({
        "aria-current": registerCurrent,
        href: "/register",
      });
      expect(String(links[0].props.className).includes("activeTab"))
        .toBe(loginActive);
      expect(String(links[1].props.className).includes("activeTab"))
        .toBe(registerActive);
      expect(links[loginActive ? 1 : 0].props.className).not.toContain(
        "Stryker was here!",
      );
      expect(renderer.root.findByProps({ id: "auth-title" }).children.join(""))
        .toBe("Private account access");
      expect(renderer.root.findByType("p").children.join(""))
        .toBe("Form contents");
      renderer.unmount();
    },
  );

  test.each(["log", "history", "settings"] as const)(
    "application navigation marks only %s active",
    async (active) => {
      const renderer = await renderInRoute(
        createElement(AppNavigation, {
          active,
          csrfToken: "navigation-csrf",
          selectedDate: "2026-08-30",
          today: "2026-08-31",
          username: "route-user",
        }),
      );
      const links = renderer.root.findAllByType("a");
      const destinations = links.map((link) => link.props.href);
      expect(destinations).toEqual([
        "/?date=2026-08-31",
        "/?date=2026-08-30&calendar=2026-08",
        "/settings/goals",
        "/account/password",
        "/?date=2026-08-31",
        "/?date=2026-08-30&calendar=2026-08",
        "/settings/goals",
      ]);
      const activeLinks = links.filter(
        (link) => link.props["aria-current"] === "page",
      );
      expect(activeLinks)
        .toHaveLength(2);
      const expectedHref =
        active === "log"
          ? "/?date=2026-08-31"
          : active === "history"
            ? "/?date=2026-08-30&calendar=2026-08"
            : "/settings/goals";
      expect(
        activeLinks.every((link) => link.props.href === expectedHref),
      ).toBe(true);
      expect(renderer.root.findByProps({ name: "csrfToken" }).props.value)
        .toBe("navigation-csrf");
      expect(
        renderer.root.findAllByType("small").some((node) =>
          node.children.join("").includes("route-user"),
        ),
      ).toBe(true);
      renderer.unmount();
    },
  );

  test.each([
    ["lock", ["rect", "path"]],
    ["settings", ["circle", "path"]],
    ["calendar", ["rect", "path"]],
    ["utensils", ["path"]],
    ["water", ["path"]],
    ["log", ["rect", "path"]],
    ["plus", ["path"]],
    ["external", ["path"]],
    ["info", ["circle", "path"]],
  ] satisfies [UiIconName, string[]][])(
    "%s icon exposes its exact accessible vector contract",
    async (name, childTypes) => {
      const renderer = await renderInRoute(createElement(UiIcon, { name }));
      const svg = renderer.root.findByType("svg");
      expect(svg.props).toMatchObject({
        "aria-hidden": "true",
        fill: "none",
        focusable: "false",
        stroke: "currentColor",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: "1.8",
        viewBox: "0 0 24 24",
      });
      expect(svg.children.map((child) =>
        typeof child === "string" ? child : child.type,
      )).toEqual(childTypes);
      if (name === "settings") {
        expect(renderer.root.findByType("circle").props).toMatchObject({
          cx: "12",
          cy: "12",
          r: "3",
        });
      }
      renderer.unmount();
    },
  );
});
