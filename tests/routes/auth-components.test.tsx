import { createElement } from "react";
import { createRoutesStub } from "react-router";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, test } from "vitest";

import ChangePassword, {
  headers as passwordHeaders,
  meta as passwordMeta,
} from "../../app/routes/account.password";
import Login, {
  headers as loginHeaders,
  meta as loginMeta,
} from "../../app/routes/login";
import Register, {
  headers as registerHeaders,
  meta as registerMeta,
} from "../../app/routes/register";
import SecuritySettings from "../../app/routes/settings.security";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function renderRoute(
  Component: (props: never) => React.JSX.Element,
  path: string,
  loaderData: object,
  actionData?: object,
): Promise<ReactTestRenderer> {
  const Routes = createRoutesStub([{
    Component: Component as never,
    id: "subject",
    path,
  }]);
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      createElement(Routes, {
        hydrationData: {
          actionData: actionData ? { subject: actionData } : undefined,
          loaderData: { subject: loaderData },
        },
        initialEntries: [path],
      }),
    );
  });
  return renderer!;
}

function input(renderer: ReactTestRenderer, name: string) {
  return renderer.root.findAllByType("input").find(
    (candidate) => candidate.props.name === name,
  )!;
}

function text(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAll((node) => typeof node.type === "string")
    .flatMap((node) => node.children)
    .filter((child): child is string => typeof child === "string")
    .join(" ");
}

describe("authentication route metadata", () => {
  test.each([
    [loginMeta, "Sign in · Open Calorie Tracker", "Sign in to your private account"],
    [registerMeta, "Register · Open Calorie Tracker", "Create a private account"],
    [
      passwordMeta,
      "Change password · Open Calorie Tracker",
      "Change your private account password",
    ],
  ] as const)("publishes an exact title and description", (meta, title, content) => {
    expect(meta()).toEqual([
      { title },
      { content, name: "description" },
    ]);
  });

  test.each([loginHeaders, registerHeaders, passwordHeaders])(
    "prevents authentication pages from being cached",
    (headers) => {
      expect(headers()).toEqual({ "Cache-Control": "no-store" });
    },
  );
});

function buttons(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType("button").map((button) =>
    button.children.join(""),
  );
}

describe("login component", () => {
  test("starts on the username step without a password or an error", async () => {
    const renderer = await renderRoute(
      Login,
      "/login",
      { csrfToken: "login-csrf", publicKeyUrl: null },
    );
    expect(input(renderer, "username").props).toMatchObject({
      autoComplete: "username",
      defaultValue: "",
      id: "login-username",
      maxLength: 30,
      required: true,
    });
    expect(input(renderer, "csrfToken").props).toMatchObject({
      type: "hidden",
      value: "login-csrf",
    });
    expect(input(renderer, "password")).toBeUndefined();
    // Before hydration the step posts to the action instead of leaking the token in a URL.
    expect(renderer.root.findByType("form").props).toMatchObject({
      method: "post",
      noValidate: true,
    });
    expect(buttons(renderer)).toEqual(["Next"]);
    expect(text(renderer)).toContain("Private account access");
    expect(renderer.root.findAllByType("nav")).toHaveLength(0);
    expect(renderer.root.findAllByType("a")).toHaveLength(0);
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    renderer.unmount();
  });

  test("returns a password failure to the password step and Back retires it", async () => {
    const renderer = await renderRoute(
      Login,
      "/login",
      { csrfToken: "login-csrf", publicKeyUrl: null },
      { error: "Credentials rejected", username: "Attempted.User" },
    );
    expect(input(renderer, "csrfToken").props).toMatchObject({
      type: "hidden",
      value: "login-csrf",
    });
    expect(input(renderer, "username").props).toMatchObject({
      type: "hidden",
      value: "Attempted.User",
    });
    expect(input(renderer, "password").props).toMatchObject({
      autoComplete: "current-password",
      id: "login-password",
      required: true,
      type: "password",
    });
    expect(renderer.root.findByType("form").props).toMatchObject({
      method: "post",
      noValidate: true,
    });
    expect(buttons(renderer)).toEqual(["Sign in", "Back"]);
    expect(renderer.root.findByProps({ role: "alert" }).children)
      .toContain("Credentials rejected");
    expect(text(renderer)).toContain("Couldn’t sign in");
    expect(text(renderer)).not.toContain("Attempted.User");

    const back = renderer.root.findAllByType("button")
      .find((button) => button.children.includes("Back"))!;
    act(() => (back.props as { onClick(): void }).onClick());
    expect(input(renderer, "username").props.defaultValue)
      .toBe("Attempted.User");
    expect(input(renderer, "password")).toBeUndefined();
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    renderer.unmount();
  });

  test("a username-only action result opens the password step without an alert", async () => {
    const renderer = await renderRoute(
      Login,
      "/login",
      { csrfToken: "login-csrf", publicKeyUrl: null },
      { error: "", username: "No.Script" },
    );
    expect(input(renderer, "username").props.value).toBe("No.Script");
    expect(input(renderer, "password").props.type).toBe("password");
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    renderer.unmount();
  });

  test("keeps the combined form on the LAN entry", async () => {
    const renderer = await renderRoute(
      Login,
      "/login",
      { csrfToken: "login-csrf", publicKeyUrl: "https://tracker.example/login" },
      { error: "Credentials rejected", username: "Attempted.User" },
    );
    expect(input(renderer, "username").props.defaultValue)
      .toBe("Attempted.User");
    expect(input(renderer, "password").props.type).toBe("password");
    expect(buttons(renderer)).toEqual(["Sign in"]);
    expect(renderer.root.findByType("a").props.href)
      .toBe("https://tracker.example/login");
    expect(renderer.root.findByProps({ role: "alert" }).children)
      .toContain("Credentials rejected");
    renderer.unmount();
  });
});

describe("registration component", () => {
  test("renders the exact account-creation controls", async () => {
    const renderer = await renderRoute(
      Register,
      "/register",
      { csrfToken: "register-csrf" },
    );
    expect(input(renderer, "csrfToken").props).toMatchObject({
      type: "hidden",
      value: "register-csrf",
    });
    expect(input(renderer, "username").props).toMatchObject({
      "aria-describedby": "register-username-help",
      autoComplete: "username",
      id: "register-username",
      maxLength: 30,
      pattern: "[A-Za-z0-9._-]+",
      required: true,
    });
    expect(input(renderer, "password").props).toMatchObject({
      "aria-describedby": "register-password-help",
      autoComplete: "new-password",
      id: "register-password",
      required: true,
      type: "password",
    });
    expect(input(renderer, "confirmPassword").props).toMatchObject({
      autoComplete: "new-password",
      id: "register-confirm-password",
      required: true,
      type: "password",
    });
    expect(text(renderer)).toContain(
      "3–30 letters, digits, dot, hyphen, or underscore.",
    );
    expect(text(renderer)).toContain(
      "12–128 characters; spaces, Unicode, paste, and password managers are supported.",
    );
    expect(renderer.root.findAllByType("button").find((button) => button.props.type === "submit")!.children.join(""))
      .toBe("Create private account");
    expect(
      renderer.root.findAllByProps({ "aria-label": "Account access" }),
    ).toHaveLength(0);
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    renderer.unmount();
  });

  test("preserves the username and exposes the route error", async () => {
    const renderer = await renderRoute(
      Register,
      "/register",
      { csrfToken: "register-csrf" },
      { error: "Username unavailable", username: "Taken.User" },
    );
    expect(input(renderer, "username").props.defaultValue).toBe("Taken.User");
    expect(renderer.root.findByProps({ role: "alert" }).children.join(""))
      .toBe("Username unavailable");
    renderer.unmount();
  });
});

describe("password component", () => {
  test("returns to Account security after opening Change account password", async () => {
    const securityData = {
      csrfToken: "password-csrf",
      credentials: [],
      enabled: false,
      isAdministrator: false,
      preview: false,
      today: "2026-10-09",
      username: "account.owner",
    };
    const Routes = createRoutesStub([
      {
        Component: SecuritySettings as never,
        id: "security",
        loader: () => securityData,
        path: "/settings/security",
      },
      {
        Component: ChangePassword as never,
        loader: () => ({
          csrfToken: "password-csrf",
          keyLoginEnabled: false,
          passwordChangeRequired: false,
          username: "account.owner",
        }),
        path: "/account/password",
      },
      { Component: () => <h1>Daily log</h1>, path: "/" },
    ]);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(Routes, {
        hydrationData: { loaderData: { security: securityData } },
        initialEntries: ["/settings/security"],
      }));
    });
    const clickLink = async (label: string) => {
      const link = renderer.root.findAllByType("a").find(
        (candidate) => candidate.children.join("").includes(label),
      )!;
      await act(async () => {
        (link.props as {
          onClick(event: {
            button: number;
            defaultPrevented: boolean;
            preventDefault(): void;
          }): void;
        }).onClick({ button: 0, defaultPrevented: false, preventDefault() {} });
      });
    };
    try {
      await clickLink("Change account password");
      expect(renderer.root.findAllByType(ChangePassword)).toHaveLength(1);
      expect(input(renderer, "currentPassword").props.type).toBe("password");

      await clickLink("Back to account");
      expect(renderer.root.findAllByType(SecuritySettings)).toHaveLength(1);
      expect(renderer.root.findByProps({ id: "security-title" }).children)
        .toEqual(["Account security"]);
      expect(renderer.root.findAllByType(ChangePassword)).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  test.each([
    [undefined, undefined, undefined],
    [{ error: "Current password rejected" }, "Current password rejected", undefined],
    [{ changed: true }, undefined, "Password changed."],
  ] as const)(
    "renders the password state %#",
    async (actionData, expectedError, expectedStatus) => {
      const renderer = await renderRoute(
        ChangePassword,
        "/account/password",
        {
          csrfToken: "password-csrf",
          passwordChangeRequired: false,
          username: "account.owner",
        },
        actionData,
      );
      expect(input(renderer, "csrfToken").props.value).toBe("password-csrf");
      expect(input(renderer, "username").props).toMatchObject({
        autoComplete: "username",
        type: "hidden",
        value: "account.owner",
      });
      expect(input(renderer, "currentPassword").props).toMatchObject({
        autoComplete: "current-password",
        id: "current-password",
        required: true,
        type: "password",
      });
      expect(input(renderer, "newPassword").props).toMatchObject({
        "aria-describedby": "new-password-help",
        autoComplete: "new-password",
        id: "new-password",
        required: true,
        type: "password",
      });
      expect(input(renderer, "confirmNewPassword").props).toMatchObject({
        autoComplete: "new-password",
        id: "confirm-new-password",
        required: true,
        type: "password",
      });
      const errors = renderer.root.findAllByProps({ role: "alert" });
      expect(errors.map((node) => node.children.join("")))
        .toEqual(expectedError ? [expectedError] : []);
      const statuses = renderer.root.findAllByProps({ role: "status" });
      expect(statuses).toHaveLength(expectedStatus ? 1 : 0);
      if (expectedStatus) {
        expect(text(renderer)).toContain(expectedStatus);
        expect(text(renderer)).toContain("Other sessions were revoked.");
      }
      expect(text(renderer)).toContain(
        "Changing the password revokes other sessions and rotates this one.",
      );
      renderer.unmount();
    },
  );

  test("mandatory password onboarding exposes only replacement and logout", async () => {
    const renderer = await renderRoute(
      ChangePassword,
      "/account/password",
      {
        csrfToken: "restricted-csrf",
        passwordChangeRequired: true,
        username: "invited.member",
      },
    );
    expect(text(renderer)).toContain("Set your private password");
    expect(text(renderer)).toContain(
      "Replace the temporary password before continuing.",
    );
    expect(input(renderer, "currentPassword").props.autoFocus).toBe(true);
    expect(renderer.root.findAllByType("a")).toHaveLength(0);
    const forms = renderer.root.findAllByType("form");
    expect(forms).toHaveLength(2);
    expect(forms.at(-1)?.props).toMatchObject({ action: "/logout" });
    expect(text(renderer)).toContain("Sign out");
    expect(text(renderer)).not.toContain("temporary member passphrase");
    renderer.unmount();
  });
});
