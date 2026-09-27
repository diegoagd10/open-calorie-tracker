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

describe("login component", () => {
  test("submits credentials back to an in-progress authorization request", async () => {
    const loginAction = "/login?next=%2Foauth%2Fauthorize%3Fclient_id%3Dexample";
    const renderer = await renderRoute(Login, "/login", {
      csrfToken: "login-csrf", loginAction, returnPath: "/oauth/authorize?client_id=example", publicKeyUrl: null,
    });
    expect(renderer.root.findByType("form").props.action).toBe(loginAction);
    renderer.unmount();
  });

  test("renders its complete submission contract without an error", async () => {
    const renderer = await renderRoute(
      Login,
      "/login",
      { csrfToken: "login-csrf" },
    );
    expect(input(renderer, "csrfToken").props).toMatchObject({
      type: "hidden",
      value: "login-csrf",
    });
    expect(input(renderer, "username").props).toMatchObject({
      autoComplete: "username",
      id: "login-username",
      maxLength: 30,
      required: true,
    });
    expect(input(renderer, "username").props.defaultValue).toBeUndefined();
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
    expect(renderer.root.findAllByType("button").find((button) => button.props.type === "submit")!.children.join(""))
      .toBe("Sign in");
    expect(renderer.root.findAllByType("nav")).toHaveLength(0);
    expect(renderer.root.findAllByType("a")).toHaveLength(0);
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    renderer.unmount();
  });

  test("preserves the attempted username and announces a failure", async () => {
    const renderer = await renderRoute(
      Login,
      "/login",
      { csrfToken: "login-csrf" },
      { error: "Credentials rejected", username: "Attempted.User" },
    );
    expect(input(renderer, "username").props.defaultValue)
      .toBe("Attempted.User");
    expect(renderer.root.findByProps({ role: "alert" }).children)
      .toContain("Credentials rejected");
    expect(text(renderer)).toContain("Couldn’t sign in");
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
    expect(
      renderer.root.findAllByProps({ href: "/" }),
    ).toHaveLength(0);
    const forms = renderer.root.findAllByType("form");
    expect(forms).toHaveLength(2);
    expect(forms.at(-1)?.props).toMatchObject({ action: "/logout" });
    expect(text(renderer)).toContain("Sign out");
    expect(text(renderer)).not.toContain("temporary member passphrase");
    renderer.unmount();
  });
});
