import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { PersistentRateLimiter } from "../../app/auth/rate-limiter.server";
import {
  parseCookies,
  requirePreAuthenticationCsrf,
  serializeSessionCookie,
  type getAuthenticatedSession,
} from "../../app/auth/http.server";
import {
  getAuthenticationService,
  getPreAuthenticationCsrfService,
} from "../../app/auth/runtime.server";
import {
  getApplicationDatabase,
  initializeApplicationDatabase,
  shutdownApplicationDatabase,
} from "../../app/database/runtime.server";
import {
  action as passwordAction,
  loader as passwordLoader,
} from "../../app/routes/account.password";
import {
  action as loginAction,
  loader as loginLoader,
} from "../../app/routes/login";
import {
  action as logoutAction,
  loader as logoutLoader,
} from "../../app/routes/logout";
import {
  action as registerAction,
  loader as registerLoader,
} from "../../app/routes/register";

type Session = NonNullable<Awaited<ReturnType<typeof getAuthenticatedSession>>> & {
  absoluteExpiresAt: Date;
};

const origin = "http://localhost:3000";
const password = "correct horse battery staple";
let temporaryDirectory: string;
const sessions = new Map<string, Session>();

function routeArgs(request: Request, pattern: string) {
  return {
    context: new RouterContextProvider(),
    params: {},
    pattern,
    request,
    url: new URL(request.url),
  };
}

function post(pathname: string, body: URLSearchParams, cookie?: string) {
  const headers = new Headers({ Origin: origin });
  if (cookie) headers.set("Cookie", cookie);
  return new Request(`${origin}${pathname}`, { body, headers, method: "POST" });
}

function cookieFor(session: Session): string {
  return serializeSessionCookie(session).split(";", 1)[0];
}

async function issuePreAuthentication(
  loader: typeof loginLoader | typeof registerLoader,
  pathname: "/login" | "/register",
) {
  const result = await loader(
    routeArgs(new Request(`${origin}${pathname}`), pathname),
  );
  expect(result).not.toBeInstanceOf(Response);
  if (result instanceof Response) throw new Error("anonymous form redirected");
  const csrfToken = result.data.csrfToken;
  const cookie = new Headers(result.init?.headers)
    .get("Set-Cookie")
    ?.split(";", 1)[0];
  if (!cookie) throw new Error("pre-authentication cookie was not issued");
  return { cookie, csrfToken };
}

async function seedAccount(username: string): Promise<Session> {
  const result = await getAuthenticationService().register(
    username,
    password,
    `198.51.100.${sessions.size + 10}`,
  );
  if (!result.ok) throw new Error(`could not seed ${username}`);
  const session = result.session as Session;
  sessions.set(username, session);
  return session;
}

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "calory-auth-routes-"));
  process.env.APPLICATION_URL = origin;
  process.env.DATABASE_PATH = path.join(temporaryDirectory, "application.sqlite");
  initializeApplicationDatabase();
  await seedAccount("login.owner");
  await seedAccount("password.owner");
  await seedAccount("logout.owner");
  await seedAccount("rate.password");
  await seedAccount("stale.password");
});

afterAll(async () => {
  shutdownApplicationDatabase();
  await rm(temporaryDirectory, { force: true, recursive: true });
  delete process.env.APPLICATION_URL;
  delete process.env.DATABASE_PATH;
});

describe("registration route", () => {
  test("redirects an already authenticated account", async () => {
    const session = sessions.get("login.owner")!;
    const result = await registerLoader(
      routeArgs(
        new Request(`${origin}/register`, {
          headers: { Cookie: cookieFor(session) },
        }),
        "/register",
      ),
    );
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("Location")).toBe("/");
  });

  test.each([
    [
      { confirmPassword: password, password, username: "bad user" },
      "Use 3–30 ASCII letters, digits, dot, hyphen, or underscore.",
    ],
    [
      { confirmPassword: "short", password: "short", username: "new.user" },
      "Password must contain 12–128 characters.",
    ],
    [
      { confirmPassword: "different password", password, username: "new.user" },
      "Passwords do not match.",
    ],
  ])("returns the specific safe validation error %#", async (fields, error) => {
    const preAuth = await issuePreAuthentication(registerLoader, "/register");
    const result = await registerAction(
      routeArgs(
        post(
          "/register",
          new URLSearchParams({ ...fields, csrfToken: preAuth.csrfToken }),
          preAuth.cookie,
        ),
        "/register",
      ),
    );
    expect(result).toMatchObject({
      data: { error, username: fields.username },
      init: { status: 400 },
    });
  });

  test("never accepts an omitted confirmation for any valid password text", async () => {
    const csrf = await issuePreAuthentication(registerLoader, "/register");
    const result = await registerAction(
      routeArgs(
        post(
          "/register",
          new URLSearchParams({
            csrfToken: csrf.csrfToken,
            password: "Stryker was here!",
            username: "missing.confirmation.boundary",
          }),
          csrf.cookie,
        ),
        "/register",
      ),
    );
    expect(result).toMatchObject({
      data: {
        error: "Passwords do not match.",
        username: "missing.confirmation.boundary",
      },
      init: { status: 400 },
    });
  });

  test.each([
    [{ confirmPassword: password, password }, "", "Use 3–30 ASCII letters"],
    [
      { confirmPassword: password, username: "missing.password" },
      "missing.password",
      "Password must contain 12–128 characters",
    ],
    [
      { password, username: "missing.confirmation" },
      "missing.confirmation",
      "Passwords do not match",
    ],
  ])("maps a missing registration field to its contract %#", async (
    fields,
    username,
    error,
  ) => {
    const csrf = await issuePreAuthentication(registerLoader, "/register");
    const result = await registerAction(
      routeArgs(
        post(
          "/register",
          new URLSearchParams({ ...fields, csrfToken: csrf.csrfToken }),
          csrf.cookie,
        ),
        "/register",
      ),
    );
    expect(result).toMatchObject({
      data: { username },
      init: { status: 400 },
    });
    if (result instanceof Response) throw new Error("Expected registration data");
    expect(result.data.error).toContain(error);
  });

  test("normalizes a new account and rejects a case-insensitive duplicate", async () => {
    const firstCsrf = await issuePreAuthentication(registerLoader, "/register");
    const firstCsrfRequest = new Request(`${origin}/register`, {
      headers: { Cookie: firstCsrf.cookie },
    });
    expect(() => requirePreAuthenticationCsrf(
      firstCsrfRequest,
      firstCsrf.csrfToken,
    )).not.toThrow();
    const rejectedCandidate = (() => {
      try {
        requirePreAuthenticationCsrf(firstCsrfRequest, "wrong-csrf");
        return undefined;
      } catch (error) {
        return error;
      }
    })();
    expect(rejectedCandidate).toBeInstanceOf(Response);
    expect((rejectedCandidate as Response).status).toBe(403);
    await expect((rejectedCandidate as Response).text()).resolves.toBe(
      "CSRF token rejected.",
    );
    const first = await registerAction(
      routeArgs(
        post(
          "/register",
          new URLSearchParams({
            confirmPassword: password,
            csrfToken: firstCsrf.csrfToken,
            password,
            username: "Route.NewUser",
          }),
          firstCsrf.cookie,
        ),
        "/register",
      ),
    );
    expect(first).toBeInstanceOf(Response);
    expect((first as Response).status).toBe(302);
    expect((first as Response).headers.get("Location")).toBe("/");
    expect((first as Response).headers.get("Set-Cookie"))
      .toContain("__Host-calorie_session=");
    expect((first as Response).headers.get("Set-Cookie"))
      .toContain("__Host-calorie_auth_csrf=; Path=/; Max-Age=0;");
    const revokedToken = parseCookies(firstCsrf.cookie).get(
      "__Host-calorie_auth_csrf",
    );
    expect(getPreAuthenticationCsrfService().verify(
      revokedToken,
      firstCsrf.csrfToken,
    )).toBe(false);

    const duplicateCsrf = await issuePreAuthentication(registerLoader, "/register");
    const duplicate = await registerAction(
      routeArgs(
        post(
          "/register",
          new URLSearchParams({
            confirmPassword: password,
            csrfToken: duplicateCsrf.csrfToken,
            password,
            username: "ROUTE.NEWUSER",
          }),
          duplicateCsrf.cookie,
        ),
        "/register",
      ),
    );
    expect(duplicate).toMatchObject({
      data: {
        error:
          "That username is already registered. Usernames are compared case-insensitively.",
        username: "ROUTE.NEWUSER",
      },
      init: { status: 409 },
    });
  });

  test("returns a specific registration rate-limit response", async () => {
    const limiter = new PersistentRateLimiter(
      getApplicationDatabase().getClient(),
    );
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(limiter.consume("registration", "203.0.113.210", 5, 60_000))
        .toBe(true);
    }
    const csrf = await issuePreAuthentication(registerLoader, "/register");
    const request = post(
      "/register",
      new URLSearchParams({
        confirmPassword: password,
        csrfToken: csrf.csrfToken,
        password,
        username: "rate.register",
      }),
      csrf.cookie,
    );
    request.headers.set("X-Open-Calory-Client-IP", "203.0.113.210");
    const result = await registerAction(
      routeArgs(request, "/register"),
    );
    expect(result).toMatchObject({
      data: {
        error: "Too many registration attempts. Try again later.",
        username: "rate.register",
      },
      init: { status: 429 },
    });
  });
});

describe("login route", () => {
  test("redirects an existing session and otherwise issues a form session", async () => {
    const authenticated = await loginLoader(
      routeArgs(
        new Request(`${origin}/login`, {
          headers: { Cookie: cookieFor(sessions.get("login.owner")!) },
        }),
        "/login",
      ),
    );
    expect(authenticated).toBeInstanceOf(Response);
    expect((authenticated as Response).headers.get("Location")).toBe("/");

    const anonymous = await issuePreAuthentication(loginLoader, "/login");
    expect(anonymous.csrfToken).not.toBe("");
    expect(anonymous.cookie).toContain("__Host-calorie_auth_csrf=");
  });

  test("uses one generic failure and establishes a valid session", async () => {
    const invalidCsrf = await issuePreAuthentication(loginLoader, "/login");
    const invalid = await loginAction(
      routeArgs(
        post(
          "/login",
          new URLSearchParams({
            csrfToken: invalidCsrf.csrfToken,
            password,
            username: "bad user",
          }),
          invalidCsrf.cookie,
        ),
        "/login",
      ),
    );
    expect(invalid).toMatchObject({
      data: {
        error: "The username or password is incorrect.",
        username: "bad user",
      },
      init: { status: 400 },
    });

    const wrongCsrf = await issuePreAuthentication(loginLoader, "/login");
    const wrong = await loginAction(
      routeArgs(
        post(
          "/login",
          new URLSearchParams({
            csrfToken: wrongCsrf.csrfToken,
            password: "incorrect password value",
            username: "login.owner",
          }),
          wrongCsrf.cookie,
        ),
        "/login",
      ),
    );
    expect(wrong).toMatchObject({
      data: {
        error: "The username or password is incorrect.",
        username: "login.owner",
      },
      init: { status: 401 },
    });

    const validCsrf = await issuePreAuthentication(loginLoader, "/login");
    const valid = await loginAction(
      routeArgs(
        post(
          "/login",
          new URLSearchParams({
            csrfToken: validCsrf.csrfToken,
            password,
            username: "LOGIN.OWNER",
          }),
          validCsrf.cookie,
        ),
        "/login",
      ),
    );
    expect(valid).toBeInstanceOf(Response);
    expect((valid as Response).headers.get("Location")).toBe("/");
    expect((valid as Response).headers.get("Set-Cookie"))
      .toContain("__Host-calorie_session=");
  });

  test.each([
    [{ password }, "", 400],
    [{ username: "login.owner" }, "login.owner", 400],
  ])("rejects missing login fields %#", async (fields, username, status) => {
    const csrf = await issuePreAuthentication(loginLoader, "/login");
    const result = await loginAction(
      routeArgs(
        post(
          "/login",
          new URLSearchParams({ ...fields, csrfToken: csrf.csrfToken }),
          csrf.cookie,
        ),
        "/login",
      ),
    );
    expect(result).toMatchObject({
      data: {
        error: "The username or password is incorrect.",
        username,
      },
      init: { status },
    });
  });

  test("returns a specific login rate-limit response", async () => {
    const limiter = new PersistentRateLimiter(
      getApplicationDatabase().getClient(),
    );
    const subject = "203.0.113.211\0rate.login";
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(limiter.consume("login-failure", subject, 10, 60_000)).toBe(true);
    }
    const csrf = await issuePreAuthentication(loginLoader, "/login");
    const request = post(
      "/login",
      new URLSearchParams({
        csrfToken: csrf.csrfToken,
        password,
        username: "rate.login",
      }),
      csrf.cookie,
    );
    request.headers.set("X-Open-Calory-Client-IP", "203.0.113.211");
    const result = await loginAction(routeArgs(request, "/login"));
    expect(result).toMatchObject({
      data: {
        error: "Too many sign-in attempts. Try again later.",
        username: "rate.login",
      },
      init: { status: 429 },
    });
  });
});

describe("password route", () => {
  test("loads account identity and rejects anonymous and invalid requests", async () => {
    const session = sessions.get("password.owner")!;
    const anonymous = await passwordLoader(
      routeArgs(new Request(`${origin}/account/password`), "/account/password"),
    );
    expect(anonymous).toBeInstanceOf(Response);
    expect((anonymous as Response).headers.get("Location")).toBe("/login");

    const anonymousAction = await passwordAction(
      routeArgs(
        post(
          "/account/password",
          new URLSearchParams({ currentPassword: password }),
        ),
        "/account/password",
      ),
    );
    expect(anonymousAction).toBeInstanceOf(Response);
    expect((anonymousAction as Response).headers.get("Location"))
      .toBe("/login");
    expect((anonymousAction as Response).headers.get("Set-Cookie"))
      .toContain("Max-Age=0");

    const loaded = await passwordLoader(
      routeArgs(
        new Request(`${origin}/account/password`, {
          headers: { Cookie: cookieFor(session) },
        }),
        "/account/password",
      ),
    );
    expect(loaded).toEqual({
      csrfToken: session.csrfToken,
      username: "password.owner",
    });

    const invalidCsrf = await passwordAction(
      routeArgs(
        post(
          "/account/password",
          new URLSearchParams({
            csrfToken: "wrong",
            currentPassword: password,
            newPassword: "replacement passphrase",
          }),
          cookieFor(session),
        ),
        "/account/password",
      ) as never,
    ).catch((error: unknown) => error);
    expect(invalidCsrf).toBeInstanceOf(Response);
    expect((invalidCsrf as Response).status).toBe(403);
    await expect((invalidCsrf as Response).text()).resolves.toBe(
      "CSRF token rejected.",
    );

    const missingPasswords = await passwordAction(
      routeArgs(
        post(
          "/account/password",
          new URLSearchParams({ csrfToken: session.csrfToken }),
          cookieFor(session),
        ),
        "/account/password",
      ),
    );
    expect(missingPasswords).toMatchObject({
      data: { error: "Enter your current password." },
      init: { status: 400 },
    });

    const invalidCurrent = await passwordAction(
      routeArgs(
        post(
          "/account/password",
          new URLSearchParams({
            csrfToken: session.csrfToken,
            currentPassword: "",
            newPassword: "replacement passphrase",
          }),
          cookieFor(session),
        ),
        "/account/password",
      ),
    );
    expect(invalidCurrent).toMatchObject({
      data: { error: "Enter your current password." },
      init: { status: 400 },
    });

    const invalidNew = await passwordAction(
      routeArgs(
        post(
          "/account/password",
          new URLSearchParams({
            csrfToken: session.csrfToken,
            currentPassword: password,
            newPassword: "short",
          }),
          cookieFor(session),
        ),
        "/account/password",
      ),
    );
    expect(invalidNew).toMatchObject({
      data: { error: "New password must contain 12–128 characters." },
      init: { status: 400 },
    });

    const wrongCurrent = await passwordAction(
      routeArgs(
        post(
          "/account/password",
          new URLSearchParams({
            csrfToken: session.csrfToken,
            currentPassword: "incorrect current password",
            newPassword: "replacement passphrase",
          }),
          cookieFor(session),
        ),
        "/account/password",
      ),
    );
    expect(wrongCurrent).toMatchObject({
      data: { error: "The current password is incorrect." },
      init: { status: 400 },
    });
  });

  test("changes the password and rotates the current session", async () => {
    const session = sessions.get("password.owner")!;
    const changed = await passwordAction(
      routeArgs(
        post(
          "/account/password",
          new URLSearchParams({
            csrfToken: session.csrfToken,
            currentPassword: password,
            newPassword: "replacement passphrase",
          }),
          cookieFor(session),
        ),
        "/account/password",
      ),
    );
    expect(changed).toMatchObject({ data: { changed: true } });
    if (changed instanceof Response) throw new Error("Expected password data");
    const replacementCookie = new Headers(changed.init?.headers).get("Set-Cookie");
    expect(replacementCookie).toContain("__Host-calorie_session=");
    expect(replacementCookie).not.toContain(session.token);
  });

  test("reports password-change rate limits and concurrent session loss", async () => {
    const rateSession = sessions.get("rate.password")!;
    const limiter = new PersistentRateLimiter(
      getApplicationDatabase().getClient(),
    );
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(
        limiter.consume(
          "password-change-failure",
          String(rateSession.user.id),
          5,
          60_000,
        ),
      ).toBe(true);
    }
    const limited = await passwordAction(
      routeArgs(
        post(
          "/account/password",
          new URLSearchParams({
            csrfToken: rateSession.csrfToken,
            currentPassword: password,
            newPassword: "replacement passphrase",
          }),
          cookieFor(rateSession),
        ),
        "/account/password",
      ),
    );
    expect(limited).toMatchObject({
      data: { error: "Too many password attempts. Try again later." },
      init: { status: 429 },
    });

    const staleSession = sessions.get("stale.password")!;
    const request = post(
      "/account/password",
      new URLSearchParams({
        csrfToken: staleSession.csrfToken,
        currentPassword: password,
        newPassword: "replacement passphrase",
      }),
      cookieFor(staleSession),
    );
    const originalFormData = request.formData.bind(request);
    request.formData = async () => {
      getAuthenticationService().revokeSession(staleSession.token);
      return originalFormData();
    };
    const stale = await passwordAction(
      routeArgs(request, "/account/password"),
    );
    expect(stale).toBeInstanceOf(Response);
    expect((stale as Response).headers.get("Location")).toBe("/login");
    expect((stale as Response).headers.get("Set-Cookie"))
      .toContain("Max-Age=0");
  });

  test("rejects an omitted new password even with the correct current password", async () => {
    const session = await seedAccount("missing.new.password");
    const result = await passwordAction(
      routeArgs(
        post(
          "/account/password",
          new URLSearchParams({
            csrfToken: session.csrfToken,
            currentPassword: password,
          }),
          cookieFor(session),
        ),
        "/account/password",
      ),
    );
    expect(result).toMatchObject({
      data: { error: "New password must contain 12–128 characters." },
      init: { status: 400 },
    });
  });
});

describe("logout route", () => {
  test("redirects GET, clears anonymous sessions, and revokes a valid session", async () => {
    expect(logoutLoader().headers.get("Location")).toBe("/");

    const anonymous = await logoutAction(
      routeArgs(
        post("/logout", new URLSearchParams({ csrfToken: "unused" })),
        "/logout",
      ),
    );
    expect(anonymous.headers.get("Location")).toBe("/login");
    expect(anonymous.headers.get("Set-Cookie")).toContain("Max-Age=0");

    const session = sessions.get("logout.owner")!;
    const rejected = await logoutAction(
      routeArgs(
        post(
          "/logout",
          new URLSearchParams({ csrfToken: "wrong" }),
          cookieFor(session),
        ),
        "/logout",
      ) as never,
    ).catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(Response);
    expect((rejected as Response).status).toBe(403);
    await expect((rejected as Response).text()).resolves.toBe(
      "CSRF token rejected.",
    );

    const valid = await logoutAction(
      routeArgs(
        post(
          "/logout",
          new URLSearchParams({ csrfToken: session.csrfToken }),
          cookieFor(session),
        ),
        "/logout",
      ),
    );
    expect(valid.headers.get("Location")).toBe("/login");
    expect(valid.headers.get("Set-Cookie")).toContain("Max-Age=0");
    await expect(getAuthenticationService().authenticate(session.token))
      .resolves.toBeUndefined();
  });

  test("rejects a missing CSRF field for an authenticated session", async () => {
    const session = sessions.get("login.owner")!;
    const result = await logoutAction(
      routeArgs(
        post("/logout", new URLSearchParams(), cookieFor(session)),
        "/logout",
      ) as never,
    ).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    await expect((result as Response).text()).resolves.toBe(
      "CSRF token rejected.",
    );
  });
});

test.each([
  ["login", loginAction],
  ["register", registerAction],
  ["account/password", passwordAction],
  ["logout", logoutAction],
] as const)("%s action rejects a cross-origin request before side effects", async (
  pathname,
  action,
) => {
  const request = new Request(`${origin}/${pathname}`, {
    body: new URLSearchParams(),
    headers: { Origin: "https://attacker.example" },
    method: "POST",
  });
  const result = await action(
    routeArgs(request, `/${pathname}`) as never,
  ).catch((error: unknown) => error);
  expect(result).toBeInstanceOf(Response);
  expect((result as Response).status).toBe(403);
  await expect((result as Response).text()).resolves.toBe(
    "Request origin rejected.",
  );
});
