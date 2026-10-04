import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub, RouterContextProvider } from "react-router";
import { afterAll, expect, test } from "vitest";

import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import {
  initializeApplicationDatabase,
  shutdownApplicationDatabase,
} from "../../app/database/runtime.server";
import { getDailyGoalService } from "../../app/daily-goal/index.server";
import Setup, {
  action as setupAction,
  loader as setupLoader,
} from "../../app/routes/setup";

const originalEnvironment = {
  applicationUrl: process.env.APPLICATION_URL,
  databasePath: process.env.DATABASE_PATH,
  setupNow: process.env.SETUP_TEST_NOW,
};
let temporaryDirectory: string | undefined;

afterAll(async () => {
  shutdownApplicationDatabase();
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }

  restoreEnvironment("APPLICATION_URL", originalEnvironment.applicationUrl);
  restoreEnvironment("DATABASE_PATH", originalEnvironment.databasePath);
  restoreEnvironment("SETUP_TEST_NOW", originalEnvironment.setupNow);
});

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function routeArgs(request: Request) {
  return {
    context: new RouterContextProvider(),
    params: {},
    pattern: "/setup",
    request,
    url: new URL(request.url),
  };
}

function setupFields(csrfToken: string, overrides: Record<string, string> = {}) {
  return new URLSearchParams({
    calorieTarget: "2050",
    carbohydrateTarget: "230",
    csrfToken,
    fatTarget: "70",
    fiberTarget: "25",
    proteinTarget: "120",
    sodiumMaximum: "2300",
    sugarMaximum: "50",
    timeZone: "Pacific/Honolulu",
    waterTarget: "80",
    ...overrides,
  });
}

function post(body: URLSearchParams, cookie: string) {
  return new Request("http://localhost:3000/setup", {
    body,
    headers: { Cookie: cookie, Origin: "http://localhost:3000" },
    method: "POST",
  });
}

test("a new account completes setup through the route interface", async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "calory-setup-route-"));
  process.env.APPLICATION_URL = "http://localhost:3000";
  process.env.DATABASE_PATH = path.join(
    temporaryDirectory,
    "application.sqlite",
  );
  process.env.SETUP_TEST_NOW = "2026-01-01T09:30:00.000Z";
  initializeApplicationDatabase();

  const anonymousLoader = await setupLoader(
    routeArgs(new Request("http://localhost:3000/setup")),
  );
  expect(anonymousLoader).toBeInstanceOf(Response);
  expect((anonymousLoader as Response).headers.get("Location")).toBe("/login");

  const anonymousAction = await setupAction(
    routeArgs(
      new Request("http://localhost:3000/setup", {
        body: setupFields("anonymous"),
        headers: { Origin: "http://localhost:3000" },
        method: "POST",
      }),
    ),
  );
  expect(anonymousAction).toBeInstanceOf(Response);
  expect((anonymousAction as Response).headers.get("Location")).toBe("/login");
  expect((anonymousAction as Response).headers.get("Set-Cookie")).toContain(
    "Max-Age=0",
  );

  const registration = await getAuthenticationService().register(
    "setup.route",
    "correct horse battery staple",
    "203.0.113.80",
  );
  expect(registration.ok).toBe(true);
  if (!registration.ok) throw new Error("route fixture registration failed");

  const cookie = serializeSessionCookie(registration.session).split(";", 1)[0];

  const invalidOrigin = await setupAction(
    routeArgs(
      new Request("http://localhost:3000/setup", {
        body: setupFields(registration.session.csrfToken),
        headers: { Cookie: cookie, Origin: "https://attacker.example" },
        method: "POST",
      }),
    ),
  ).catch((error: unknown) => error);
  expect(invalidOrigin).toBeInstanceOf(Response);
  expect((invalidOrigin as Response).status).toBe(403);

  const invalidCsrf = await setupAction(
    routeArgs(
      new Request("http://localhost:3000/setup", {
        body: setupFields("wrong-csrf-token"),
        headers: { Cookie: cookie, Origin: "http://localhost:3000" },
        method: "POST",
      }),
    ),
  ).catch((error: unknown) => error);
  expect(invalidCsrf).toBeInstanceOf(Response);
  expect((invalidCsrf as Response).status).toBe(403);
  await expect((invalidCsrf as Response).text()).resolves.toBe(
    "CSRF token rejected.",
  );

  const initialResult = await setupLoader(
    routeArgs(
      new Request("http://localhost:3000/setup", {
        headers: { Cookie: cookie },
      }),
    ),
  );
  expect(initialResult).not.toBeInstanceOf(Response);
  if (initialResult instanceof Response) {
    throw new Error("new account was redirected away from setup");
  }
  expect(initialResult).toEqual({ csrfToken: registration.session.csrfToken });

  const SetupRoute = createRoutesStub([
    { Component: Setup, id: "setup", path: "/setup" },
  ]);
  const markup = renderToStaticMarkup(
    createElement(SetupRoute, {
      hydrationData: { loaderData: { setup: initialResult } },
      initialEntries: ["/setup"],
    }),
  );
  expect(markup).toContain("Set up your Food Log");
  expect(markup).toContain('name="csrfToken"');
  expect(markup).toContain(`value="${registration.session.csrfToken}"`);
  expect(markup).toMatch(/name="timeZone"[^>]*value="UTC"/);
  expect(markup).toContain("Only what the log needs");
  expect(markup).not.toContain('name="email"');
  expect(markup).not.toContain('name="displayUnits"');
  expect(markup).not.toContain("Display units");
  expect(markup).toContain('type="number" name="waterTarget" value="80"/><em>fl oz</em>');

  const invalidResult = await setupAction(
    routeArgs(post(setupFields(registration.session.csrfToken, { waterTarget: "500.001" }), cookie)),
  );
  expect(invalidResult).toMatchObject({
    data: {
      error: "Water must be from 0.001 to 500 fl oz.",
      field: "waterTarget",
    },
    init: { status: 400 },
  });

  const invalidTimeZone = await setupAction(
    routeArgs(post(setupFields(registration.session.csrfToken, { timeZone: "Mars/Olympus" }), cookie)),
  );
  expect(invalidTimeZone).toMatchObject({
    data: {
      error: "Enter a valid IANA time zone, such as America/New_York.",
      field: "timeZone",
    },
    init: { status: 400 },
  });

  const stillIncomplete = await setupLoader(
    routeArgs(
      new Request("http://localhost:3000/setup", {
        headers: { Cookie: cookie },
      }),
    ),
  );
  expect(stillIncomplete).not.toBeInstanceOf(Response);

  const completed = await setupAction(
    routeArgs(
      new Request("http://localhost:3000/setup", {
        body: setupFields(registration.session.csrfToken),
        headers: {
          Cookie: cookie,
          Origin: "http://localhost:3000",
        },
        method: "POST",
      }),
    ),
  );
  expect(completed).toBeInstanceOf(Response);
  if (!(completed instanceof Response)) {
    throw new Error("valid setup did not redirect");
  }
  expect(completed.status).toBe(302);
  expect(completed.headers.get("Location")).toBe("/");
  expect(getDailyGoalService().read(registration.session.user.id)).toMatchObject({
    calorieTarget: 2_050_000,
    waterTarget: "80",
    sodiumMaximum: 2_300,
  });

  const afterCompletion = await setupLoader(
    routeArgs(
      new Request("http://localhost:3000/setup", {
        headers: { Cookie: cookie },
      }),
    ),
  );
  expect(afterCompletion).toBeInstanceOf(Response);
  if (!(afterCompletion instanceof Response)) {
    throw new Error("completed setup remained available");
  }
  expect(afterCompletion.status).toBe(302);
  expect(afterCompletion.headers.get("Location")).toBe("/");

  const repeatedAction = await setupAction(
    routeArgs(
      new Request("http://localhost:3000/setup", {
        body: setupFields("invalid-after-completion"),
        headers: { Cookie: cookie, Origin: "http://localhost:3000" },
        method: "POST",
      }),
    ),
  );
  expect(repeatedAction).toBeInstanceOf(Response);
  expect((repeatedAction as Response).headers.get("Location")).toBe("/");
});
