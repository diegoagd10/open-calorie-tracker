import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { PersistentRateLimiter } from "../../app/auth/rate-limiter.server";
import type { AuthenticatedSession } from "../../app/auth/authentication.server";
import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
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
import { seedAuthenticatedAccount } from "../support/authentication";

type Session = AuthenticatedSession;

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
  loader: typeof loginLoader,
  pathname: "/login",
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
  const session = await seedAuthenticatedAccount(
    getAuthenticationService(),
    getApplicationDatabase().getClient(),
    username,
    password,
    `198.51.100.${sessions.size + 10}`,
    sessions.size === 0 ? "admin" : "member",
  );
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

  test("a disabled account with valid credentials receives a dedicated login failure", async () => {
    const authentication = getAuthenticationService();
    await expect(
      authentication.provisionMember("disabled.login", password),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      authentication.disableMemberAccess(
        sessions.get("login.owner")!.user,
        "disabled.login",
        "disabled.login",
      ),
    ).resolves.toEqual({ ok: true });

    const disabledCsrf = await issuePreAuthentication(loginLoader, "/login");
    const disabled = await loginAction(
      routeArgs(
        post(
          "/login",
          new URLSearchParams({
            csrfToken: disabledCsrf.csrfToken,
            password,
            username: "disabled.login",
          }),
          disabledCsrf.cookie,
        ),
        "/login",
      ),
    );
    expect(disabled).toMatchObject({
      data: { error: "Your account has been disabled." },
      init: { status: 403 },
    });

    const attempts = [
      { password: "incorrect password value", username: "disabled.login" },
      { password, username: "missing.login" },
    ];
    const failures = [];
    for (const attempt of attempts) {
      const csrf = await issuePreAuthentication(loginLoader, "/login");
      failures.push(await loginAction(
        routeArgs(
          post(
            "/login",
            new URLSearchParams({ ...attempt, csrfToken: csrf.csrfToken }),
            csrf.cookie,
          ),
          "/login",
        ),
      ));
    }

    for (const [index, failure] of failures.entries()) {
      expect(failure).toMatchObject({
        data: { error: "The username or password is incorrect." },
        init: { status: 401 },
      });
      expect((failure as { data: { username: string } }).data.username)
        .toBe(attempts[index]?.username);
    }
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
      passwordChangeRequired: false,
      username: "password.owner",
    });

    const invalidCsrf = await passwordAction(
      routeArgs(
        post(
          "/account/password",
          new URLSearchParams({
            confirmNewPassword: "replacement passphrase",
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
            confirmNewPassword: "replacement passphrase",
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
            confirmNewPassword: "short",
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

    const mismatchedConfirmation = await passwordAction(
      routeArgs(
        post(
          "/account/password",
          new URLSearchParams({
            confirmNewPassword: "different replacement password",
            csrfToken: session.csrfToken,
            currentPassword: password,
            newPassword: "replacement passphrase",
          }),
          cookieFor(session),
        ),
        "/account/password",
      ),
    );
    expect(mismatchedConfirmation).toMatchObject({
      data: { error: "New passwords do not match." },
      init: { status: 400 },
    });

    const wrongCurrent = await passwordAction(
      routeArgs(
        post(
          "/account/password",
          new URLSearchParams({
            confirmNewPassword: "replacement passphrase",
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
            confirmNewPassword: "replacement passphrase",
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
            confirmNewPassword: "replacement passphrase",
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
        confirmNewPassword: "replacement passphrase",
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

  test("restricted login requires the temporary password and continues to setup with a rotated session", async () => {
    const authentication = getAuthenticationService();
    const initialPassword = "temporary member passphrase";
    const nextPassword = "private replacement passphrase";
    expect(await authentication.provisionMember("invited.member", initialPassword))
      .toMatchObject({ ok: true });
    const preAuthentication = await issuePreAuthentication(loginLoader, "/login");
    const login = await loginAction(
      routeArgs(
        post(
          "/login",
          new URLSearchParams({
            csrfToken: preAuthentication.csrfToken,
            password: initialPassword,
            username: "invited.member",
          }),
          preAuthentication.cookie,
        ),
        "/login",
      ),
    );
    expect(login).toBeInstanceOf(Response);
    expect((login as Response).headers.get("Location"))
      .toBe("/account/password");
    const loginCookie = (login as Response).headers.get("Set-Cookie")
      ?.split(",", 1)[0]
      .split(";", 1)[0];
    if (!loginCookie) throw new Error("restricted session cookie missing");
    const loginToken = decodeURIComponent(
      loginCookie.split("=").slice(1).join("="),
    );
    const restrictedSession = await authentication.authenticate(loginToken);
    if (!restrictedSession) throw new Error("restricted session unavailable");
    expect(restrictedSession.user.passwordChangeRequired).toBe(true);

    const incorrect = await passwordAction(
      routeArgs(
        post(
          "/account/password",
          new URLSearchParams({
            confirmNewPassword: nextPassword,
            csrfToken: restrictedSession.csrfToken,
            currentPassword: "incorrect temporary password",
            newPassword: nextPassword,
          }),
          loginCookie,
        ),
        "/account/password",
      ),
    );
    expect(incorrect).toMatchObject({
      data: { error: "The current password is incorrect." },
      init: { status: 400 },
    });

    const reused = await passwordAction(
      routeArgs(
        post(
          "/account/password",
          new URLSearchParams({
            confirmNewPassword: initialPassword,
            csrfToken: restrictedSession.csrfToken,
            currentPassword: initialPassword,
            newPassword: initialPassword,
          }),
          loginCookie,
        ),
        "/account/password",
      ),
    );
    expect(reused).toMatchObject({
      data: {
        error: "Choose a password different from the temporary password.",
      },
      init: { status: 400 },
    });
    await expect(authentication.authenticate(loginToken)).resolves
      .toMatchObject({ user: { passwordChangeRequired: true } });

    const changed = await passwordAction(
      routeArgs(
        post(
          "/account/password",
          new URLSearchParams({
            confirmNewPassword: nextPassword,
            csrfToken: restrictedSession.csrfToken,
            currentPassword: initialPassword,
            newPassword: nextPassword,
          }),
          loginCookie,
        ),
        "/account/password",
      ),
    );
    expect(changed).toBeInstanceOf(Response);
    expect((changed as Response).headers.get("Location")).toBe("/setup");
    const replacementCookie = (changed as Response).headers.get("Set-Cookie");
    expect(replacementCookie).toContain("__Host-calorie_session=");
    expect(replacementCookie).not.toContain(loginToken);
    await expect(authentication.authenticate(loginToken)).resolves.toBeUndefined();
    const replacementToken = decodeURIComponent(
      replacementCookie!.split(";", 1)[0].split("=").slice(1).join("="),
    );
    await expect(authentication.authenticate(replacementToken)).resolves
      .toMatchObject({ user: { passwordChangeRequired: false } });
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
