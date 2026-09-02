import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, expect, test } from "vitest";

import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import {
  initializeApplicationDatabase,
  shutdownApplicationDatabase,
} from "../../app/database/runtime.server";
import {
  loader as passwordLoader,
} from "../../app/routes/account.password";
import {
  action as homeAction,
  loader as homeLoader,
} from "../../app/routes/home";
import { loader as loginLoader } from "../../app/routes/login";
import { action as logoutAction } from "../../app/routes/logout";
import { loader as registerLoader } from "../../app/routes/register";
import {
  action as goalsAction,
  loader as goalsLoader,
} from "../../app/routes/settings.goals";
import {
  action as usersAction,
  loader as usersLoader,
} from "../../app/routes/settings.users";
import {
  action as setupAction,
  loader as setupLoader,
} from "../../app/routes/setup";

const origin = "http://localhost:3000";
const initialPassword = "temporary account passphrase";
let temporaryDirectory: string;
let restrictedCookie: string;
let restrictedCsrf: string;

function routeArgs(request: Request, pattern: string) {
  return {
    context: new RouterContextProvider(),
    params: {},
    pattern,
    request,
    url: new URL(request.url),
  };
}

async function capture(result: Promise<unknown>): Promise<unknown> {
  return result.catch((error: unknown) => error);
}

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "calory-onboarding-access-"));
  process.env.APPLICATION_URL = origin;
  process.env.DATABASE_PATH = path.join(temporaryDirectory, "application.sqlite");
  initializeApplicationDatabase();
  const authentication = getAuthenticationService();
  const administrator = await authentication.register(
    "onboarding.admin",
    "administrator passphrase",
    "203.0.113.210",
  );
  if (!administrator.ok) throw new Error("administrator fixture failed");
  const provisioned = await authentication.provisionMember(
    "restricted.member",
    initialPassword,
  );
  if (!provisioned.ok) throw new Error("member fixture failed");
  const login = await authentication.login(
    "restricted.member",
    initialPassword,
    "203.0.113.211",
  );
  if (!login.ok) throw new Error("restricted login fixture failed");
  restrictedCookie = serializeSessionCookie(login.session).split(";", 1)[0];
  restrictedCsrf = login.session.csrfToken;
});

afterAll(async () => {
  shutdownApplicationDatabase();
  await rm(temporaryDirectory, { force: true, recursive: true });
  delete process.env.APPLICATION_URL;
  delete process.env.DATABASE_PATH;
});

test("restricted sessions can open only password change and are denied every ordinary page", async () => {
  const request = (pathname: string) =>
    new Request(`${origin}${pathname}`, {
      headers: { Cookie: restrictedCookie },
    });
  for (const [pathname, loader] of [
    ["/", homeLoader],
    ["/setup", setupLoader],
    ["/settings/goals", goalsLoader],
    ["/settings/users", usersLoader],
  ] as const) {
    const result = await capture(
      loader(routeArgs(request(pathname), pathname)),
    );
    expect(result, pathname).toBeInstanceOf(Response);
    expect((result as Response).headers.get("Location"), pathname)
      .toBe("/account/password");
  }

  const login = await loginLoader(
    routeArgs(request("/login"), "/login"),
  );
  expect(login).toBeInstanceOf(Response);
  expect((login as Response).headers.get("Location"))
    .toBe("/account/password");

  const registration = await capture(
    registerLoader(routeArgs(request("/register"), "/register")),
  );
  expect(registration).toBeInstanceOf(Response);
  expect((registration as Response).headers.get("Location"))
    .toBe("/account/password");

  const password = await passwordLoader(
    routeArgs(request("/account/password"), "/account/password"),
  );
  expect(password).toEqual({
    csrfToken: restrictedCsrf,
    passwordChangeRequired: true,
    username: "restricted.member",
  });
});

test("restricted sessions cannot invoke ordinary mutations but can log out", async () => {
  for (const [pathname, action] of [
    ["/", homeAction],
    ["/setup", setupAction],
    ["/settings/goals", goalsAction],
    ["/settings/users", usersAction],
  ] as const) {
    const result = await capture(
      action(
        routeArgs(
          new Request(`${origin}${pathname}`, {
            body: new URLSearchParams({ csrfToken: restrictedCsrf }),
            headers: { Cookie: restrictedCookie, Origin: origin },
            method: "POST",
          }),
          pathname,
        ),
      ),
    );
    expect(result, pathname).toBeInstanceOf(Response);
    expect((result as Response).headers.get("Location"), pathname)
      .toBe("/account/password");
  }

  const logout = await logoutAction(
    routeArgs(
      new Request(`${origin}/logout`, {
        body: new URLSearchParams({ csrfToken: restrictedCsrf }),
        headers: { Cookie: restrictedCookie, Origin: origin },
        method: "POST",
      }),
      "/logout",
    ),
  );
  expect(logout.headers.get("Location")).toBe("/login");
});
