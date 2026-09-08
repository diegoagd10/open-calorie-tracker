import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { parseCookies } from "../../app/auth/http.server";
import { PersistentRateLimiter } from "../../app/auth/rate-limiter.server";
import {
  getApplicationDatabase,
  initializeApplicationDatabase,
  shutdownApplicationDatabase,
} from "../../app/database/runtime.server";
import { users } from "../../app/database/schema.server";
import {
  action as registerAction,
  loader as registerLoader,
} from "../../app/routes/register";
import { loader as homeLoader } from "../../app/routes/home";
import { loader as loginLoader } from "../../app/routes/login";

const origin = "http://localhost:3000";
const password = "correct horse battery staple";
let temporaryDirectory: string;
let authenticatedCookie: string;

function routeArgs(request: Request, pattern = "/register") {
  return {
    context: new RouterContextProvider(),
    params: {},
    pattern,
    request,
    url: new URL(request.url),
  };
}

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "calory-bootstrap-route-"));
  process.env.APPLICATION_URL = origin;
  process.env.DATABASE_PATH = path.join(temporaryDirectory, "application.sqlite");
  initializeApplicationDatabase();
});

afterAll(async () => {
  shutdownApplicationDatabase();
  await rm(temporaryDirectory, { force: true, recursive: true });
  delete process.env.APPLICATION_URL;
  delete process.env.DATABASE_PATH;
  vi.restoreAllMocks();
});

describe("administrator bootstrap route", () => {
  test("anonymous navigation to an empty instance leads to registration", async () => {
    const homeResult = await homeLoader(routeArgs(new Request(origin), "/"));
    expect(homeResult).toBeInstanceOf(Response);
    expect((homeResult as Response).headers.get("Location")).toBe("/register");

    const loginResult = await loginLoader(
      routeArgs(new Request(`${origin}/login`), "/login"),
    );
    expect(loginResult).toBeInstanceOf(Response);
    expect((loginResult as Response).headers.get("Location"))
      .toBe("/register");
  });

  test("an open bootstrap preserves validation, Origin, CSRF, and rate limits", async () => {
    const loadForm = async () => {
      const loaded = await registerLoader(
        routeArgs(new Request(`${origin}/register`)),
      );
      if (loaded instanceof Response) throw new Error("empty instance redirected");
      const cookie = new Headers(loaded.init?.headers)
        .get("Set-Cookie")
        ?.split(";", 1)[0];
      if (!cookie) throw new Error("missing CSRF cookie");
      return { cookie, csrfToken: loaded.data.csrfToken };
    };

    const invalidForm = await loadForm();
    const invalid = await registerAction(
      routeArgs(
        new Request(`${origin}/register`, {
          body: new URLSearchParams({
            confirmPassword: password,
            csrfToken: invalidForm.csrfToken,
            password,
            username: "bad user",
          }),
          headers: { Cookie: invalidForm.cookie, Origin: origin },
          method: "POST",
        }),
      ),
    );
    expect(invalid).toMatchObject({ init: { status: 400 }, data: { username: "bad user", error: "Use 3–30 ASCII letters, digits, dot, hyphen, or underscore." } });
    for (const [username, suppliedPassword, confirmation, error] of [
      ["valid.owner", "short", "short", "Password must contain 12–128 characters."],
      ["valid.owner", password, "different password", "Passwords do not match."],
    ]) {
      const form = await loadForm();
      const response = await registerAction(routeArgs(new Request(`${origin}/register`, {
        method: "POST", headers: { Cookie: form.cookie, Origin: origin },
        body: new URLSearchParams({ username, password: suppliedPassword, confirmPassword: confirmation, csrfToken: form.csrfToken }),
      })));
      expect(response).toMatchObject({ init: { status: 400 }, data: { username, error } });
    }

    const rejectedOrigin = await registerAction(
      routeArgs(
        new Request(`${origin}/register`, {
          body: new URLSearchParams({ csrfToken: invalidForm.csrfToken, username: "valid.owner", password, confirmPassword: password }),
          headers: { Cookie: invalidForm.cookie, Origin: "https://attacker.example" },
          method: "POST",
        }),
      ),
    ).catch((error: unknown) => error);
    expect(rejectedOrigin).toBeInstanceOf(Response);
    expect((rejectedOrigin as Response).status).toBe(403);

    const invalidCsrfForm = await loadForm();
    const rejectedCsrf = await registerAction(
      routeArgs(
        new Request(`${origin}/register`, {
          body: new URLSearchParams({ csrfToken: "wrong-token" }),
          headers: { Cookie: invalidCsrfForm.cookie, Origin: origin },
          method: "POST",
        }),
      ),
    ).catch((error: unknown) => error);
    expect(rejectedCsrf).toBeInstanceOf(Response);
    expect((rejectedCsrf as Response).status).toBe(403);

    const limitedIp = "203.0.113.83";
    const limiter = new PersistentRateLimiter(
      getApplicationDatabase().getClient(),
    );
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(limiter.consume("registration", limitedIp, 5, 60_000)).toBe(true);
    }
    const limitedForm = await loadForm();
    const limited = await registerAction(
      routeArgs(
        new Request(`${origin}/register`, {
          body: new URLSearchParams({
            confirmPassword: password,
            csrfToken: limitedForm.csrfToken,
            password,
            username: "limited.owner",
          }),
          headers: {
            Cookie: limitedForm.cookie,
            Origin: origin,
            "X-Open-Calory-Client-IP": limitedIp,
          },
          method: "POST",
        }),
      ),
    );
    expect(limited).toMatchObject({ init: { status: 429 }, data: { username: "limited.owner", error: "Too many registration attempts. Try again later." } });
    const rejectedEvents = vi.mocked(console.log).mock.calls.map(([message]) => JSON.parse(String(message)) as { event: string; reason: string });
    expect(rejectedEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "invalid-origin" }),
      expect.objectContaining({ reason: "invalid-input" }),
      expect.objectContaining({ reason: "invalid-csrf" }),
    ]));
    expect(getApplicationDatabase().getClient().select().from(users).all())
      .toEqual([]);
  });

  test("concurrent route actions create one administrator and redirect the loser", async () => {
    const forms = await Promise.all(
      ["Bootstrap.Owner", "Bootstrap.Rival"].map(async (username, index) => {
        const loaded = await registerLoader(
          routeArgs(new Request(`${origin}/register`)),
        );
        expect(loaded).not.toBeInstanceOf(Response);
        if (loaded instanceof Response) throw new Error("empty instance redirected");

        const cookie = new Headers(loaded.init?.headers)
          .get("Set-Cookie")
          ?.split(";", 1)[0];
        if (!cookie) throw new Error("missing CSRF cookie");
        return {
          clientIp: `203.0.113.${80 + index}`,
          cookie,
          csrfToken: loaded.data.csrfToken,
          username,
        };
      }),
    );

    const results = await Promise.all(
      forms.map((form) =>
        registerAction(
          routeArgs(
            new Request(`${origin}/register`, {
              body: new URLSearchParams({
                confirmPassword: password,
                csrfToken: form.csrfToken,
                password,
                username: form.username,
              }),
              headers: {
                Cookie: form.cookie,
                Origin: origin,
                "X-Open-Calory-Client-IP": form.clientIp,
              },
              method: "POST",
            }),
          ),
        ),
      ),
    );
    const winnerIndex = results.findIndex(
      (result) => result instanceof Response && result.headers.get("Location") === "/",
    );
    const loserIndex = results.findIndex(
      (result) =>
        result instanceof Response && result.headers.get("Location") === "/login",
    );
    expect(winnerIndex).toBeGreaterThanOrEqual(0);
    expect(loserIndex).toBeGreaterThanOrEqual(0);
    expect(winnerIndex).not.toBe(loserIndex);

    const winner = results[winnerIndex];
    if (!(winner instanceof Response)) throw new Error("bootstrap did not redirect");
    const sessionToken = parseCookies(winner.headers.get("Set-Cookie")).get(
      "__Host-calorie_session",
    );
    expect(sessionToken).toBeDefined();
    authenticatedCookie = `__Host-calorie_session=${encodeURIComponent(sessionToken!)}`;

    expect(
      getApplicationDatabase().getClient().select().from(users).all(),
    ).toMatchObject([
      {
        role: "admin",
        usernameNormalized: forms[winnerIndex].username.toLowerCase(),
      },
    ]);
    const event = vi.mocked(console.log).mock.calls
      .map(([record]) => JSON.parse(String(record)) as Record<string, unknown>)
      .find((record) =>
        record.event === "administrator_bootstrap" &&
        record.outcome === "succeeded",
      );
    expect(event).toMatchObject({
      outcome: "succeeded",
      userId: expect.any(Number) as unknown,
      username: forms[winnerIndex].username.toLowerCase(),
    });
    expect(JSON.stringify(event)).not.toContain(password);
    expect(JSON.stringify(event)).not.toContain(sessionToken);
    for (const form of forms) {
      expect(JSON.stringify(event)).not.toContain(form.csrfToken);
    }
  });

  test("a claimed instance redirects anonymous GET and POST before validation", async () => {
    const getResult = await registerLoader(
      routeArgs(new Request(`${origin}/register`)),
    );
    expect(getResult).toBeInstanceOf(Response);
    expect((getResult as Response).status).toBe(302);
    expect((getResult as Response).headers.get("Location")).toBe("/login");

    const postResult = await registerAction(
      routeArgs(
        new Request(`${origin}/register`, {
          body: new URLSearchParams({ password: "short" }),
          method: "POST",
        }),
      ),
    );
    expect(postResult).toBeInstanceOf(Response);
    expect((postResult as Response).status).toBe(302);
    expect((postResult as Response).headers.get("Location")).toBe("/login");
    expect(vi.mocked(console.log).mock.calls.some(([record]) => {
      const event = JSON.parse(String(record)) as Record<string, unknown>;
      return event.event === "administrator_bootstrap" &&
        event.outcome === "rejected" && event.reason === "claimed-instance";
    })).toBe(true);
  });

  test("an authenticated registration request is not found", async () => {
    for (const method of ["GET", "POST"] as const) {
      const request = new Request(`${origin}/register`, {
        headers: { Cookie: authenticatedCookie },
        method,
      });
      const result = await (method === "GET" ? registerLoader : registerAction)(
        routeArgs(request),
      ).catch((error: unknown) => error);
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(404);
    }
  });
});
