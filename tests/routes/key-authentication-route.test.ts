import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createRoutesStub, RouterContextProvider } from "react-router";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import {
  parseCookies,
  serializeSessionCookie,
} from "../../app/auth/http.server";
import {
  getApplicationDatabase,
  initializeApplicationDatabase,
  shutdownApplicationDatabase,
} from "../../app/database/runtime.server";
import { getGoalSetupService } from "../../app/setup/runtime.server";
import { requestPolicyContext } from "../../app/runtime.server";
import SecuritySettings, {
  headers as securityHeaders,
  meta as securityMeta,
} from "../../app/routes/settings.security";
import Login from "../../app/routes/login";
import Users, { loader as usersLoader } from "../../app/routes/settings.users";
import * as browserProvider from "@simplewebauthn/browser";
import { action } from "../../app/routes/key-ceremony";
import { loader as securityLoader } from "../../app/routes/settings.security";
import ChangePassword, { loader as passwordLoader, action as changePassword } from "../../app/routes/account.password";
import {
  action as passwordLogin,
  loader as loginLoader,
} from "../../app/routes/login";
import { seedAuthenticatedAccount } from "../support/authentication";
import { authenticator } from "../support/webauthn";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";

const origin = "https://tracker.example";
const password = "correct horse battery staple";

test("account-password routes replace a forgotten fallback using action-scoped key proof, not a password", async () => {
  const owner = await enabledAccount("fallback.route");
  const token = parseCookies(owner.enabledCookie).get("__Host-calorie_session")!;
  const session = (await getAuthenticationService().authenticate(token))!;
  expect(await passwordLoader(args(new Request(`${origin}/account/password`, { headers: { Cookie: owner.enabledCookie } }), "/account/password"))).toMatchObject({ keyLoginEnabled: true });
  const passwordAttempt = await changePassword(args(new Request(`${origin}/account/password`, {
    method: "POST", headers: { Origin: origin, Cookie: owner.enabledCookie },
    body: new URLSearchParams({ csrfToken: session.csrfToken, currentPassword: password, newPassword: "replacement fallback password", confirmNewPassword: "replacement fallback password" }),
  }), "/account/password"));
  expect(passwordAttempt).toMatchObject({ init: { status: 400 }, data: { error: "Verify a registered key to replace your fallback password." } });
  const start = await action(args(post({ action: "password-start", csrfToken: session.csrfToken }, owner.enabledCookie)));
  expect(start.status).toBe(200);
  const { options } = await start.json() as { options: PublicKeyCredentialRequestOptionsJSON };
  const finish = await action(args(post({ action: "password-finish", csrfToken: session.csrfToken,
    newPassword: "replacement fallback password", confirmNewPassword: "replacement fallback password", response: owner.key.assertion(options, 2),
  }, `${owner.enabledCookie}; ${cookies(start)}`)));
  expect(finish.status).toBe(200);
  expect(await finish.json()).toEqual({ nextPath: "/account/password" });
  expect(await getAuthenticationService().authenticate(token)).toBeUndefined();
  const rotated = parseCookies(cookies(finish)).get("__Host-calorie_session")!;
  expect(getAuthenticationService().keys.status(rotated)).toMatchObject({ enabled: true, credentials: [{ id: owner.key.id }] });
});

test("fallback replacement follows authenticated password-cookie rotation without post-commit pre-authentication writes", async () => {
  const owner = await enabledAccount("fallback.csrf");
  const service = getAuthenticationService();
  const token = parseCookies(owner.enabledCookie).get("__Host-calorie_session")!;
  const session = (await service.authenticate(token))!;
  const preAuth = await loginLoader(args(new Request(`${origin}/login`), "/login"));
  if (preAuth instanceof Response) throw new Error("login redirected");
  const preAuthCookie = new Headers(preAuth.init?.headers).get("Set-Cookie")!.split(";", 1)[0];
  const start = await action(args(post({ action: "password-start", csrfToken: session.csrfToken }, owner.enabledCookie)));
  const { options } = await start.json() as { options: PublicKeyCredentialRequestOptionsJSON };
  const database = getApplicationDatabase().getClient();
  database.$client.exec("CREATE TRIGGER refuse_pre_auth_cleanup BEFORE DELETE ON pre_authentication_csrf_sessions BEGIN SELECT RAISE(ABORT, 'storage failure'); END");
  try {
    const finish = await action(args(post({ action: "password-finish", csrfToken: session.csrfToken, response: owner.key.assertion(options, 2), newPassword: "replacement fallback password", confirmNewPassword: "replacement fallback password" }, `${owner.enabledCookie}; ${cookies(start)}; ${preAuthCookie}`)));
    expect(finish.status).toBe(200);
    const rotated = parseCookies(cookies(finish)).get("__Host-calorie_session")!;
    expect(await service.authenticate(rotated)).toMatchObject({ user: { passwordChangeRequired: false } });
  } finally {
    database.$client.exec("DROP TRIGGER refuse_pre_auth_cleanup");
  }
});

test("removal route binds the target, clears revoked cookies, and restores final-key password login", async () => {
  const owner = await enabledAccount("remove.route");
  const token = parseCookies(owner.enabledCookie).get("__Host-calorie_session")!;
  const session = (await getAuthenticationService().authenticate(token))!;
  const start = await action(args(post({ action: "remove-start", csrfToken: session.csrfToken, credentialId: owner.key.id }, owner.enabledCookie)));
  expect(start.status).toBe(200);
  const { options } = await start.json() as { options: PublicKeyCredentialRequestOptionsJSON };
  const finish = await action(args(post({ action: "remove-finish", csrfToken: session.csrfToken, credentialId: owner.key.id, response: owner.key.assertion(options, 2) }, `${owner.enabledCookie}; ${cookies(start)}`)));
  expect(await finish.json()).toEqual({ nextPath: "/login" });
  expect(finish.headers.getSetCookie().some((cookie) => cookie.startsWith("__Host-calorie_session=;") && cookie.includes("Max-Age=0"))).toBe(true);
  expect(await getAuthenticationService().authenticate(token)).toBeUndefined();
  expect((await getAuthenticationService().login("remove.route", password, "remove.route")).ok).toBe(true);
});
let directory: string;
function args(request: Request, pattern = "/key-ceremony") {
  return {
    request,
    context: new RouterContextProvider(),
    params: {},
    pattern,
    url: new URL(request.url),
  };
}
function post(
  body: Record<string, unknown>,
  cookie = "",
  entryOrigin = origin,
) {
  return new Request(`${entryOrigin}/key-ceremony`, {
    method: "POST",
    headers: {
      Origin: entryOrigin,
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}
async function account(username: string, role: "admin" | "member" = "member") {
  const session = await seedAuthenticatedAccount(
    getAuthenticationService(),
    getApplicationDatabase().getClient(),
    username,
    password,
    username,
    role,
  );
  getGoalSetupService().completeInitial(session.user.id, {
    displayUnits: "us",
    timeZone: "UTC",
    calorieTargetMilliKcal: 2_000_000,
    carbohydrateTargetMilligrams: 200_000,
    fatTargetMilligrams: 60_000,
    fiberTargetMilligrams: 30_000,
    proteinTargetMilligrams: 100_000,
    sodiumMaximumMilligrams: 2_000,
    sugarMaximumMilligrams: 40_000,
    waterTargetMicroliters: 2_000_000,
  });
  return session;
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "key-routes-"));
  vi.stubEnv("APPLICATION_URL", origin);
  vi.stubEnv("DATABASE_PATH", path.join(directory, "app.sqlite"));
  vi.stubEnv("WEBAUTHN_ENROLLMENT_PREVIEW", "1");
  initializeApplicationDatabase();
});
afterAll(async () => {
  shutdownApplicationDatabase();
  vi.unstubAllEnvs();
  await rm(directory, { force: true, recursive: true });
});

async function enabledAccount(
  username: string,
  role: "admin" | "member" = "member",
) {
  const session = await account(username, role);
  const cookie = serializeSessionCookie(session).split(";", 1)[0];
  const key = authenticator();
  const start = await action(
    args(
      post(
        {
          action: "register-start",
          csrfToken: session.csrfToken,
          name: "My key",
        },
        cookie,
      ),
    ),
  );
  expect(start.status).toBe(200);
  const options = (
    (await start.json()) as { options: PublicKeyCredentialCreationOptionsJSON }
  ).options;
  const browserCookie = cookies(start);
  expect(start.headers.get("Set-Cookie")).toContain(
    "HttpOnly; Secure; SameSite=Strict",
  );
  const registered = await action(
    args(
      post(
        {
          action: "register-finish",
          csrfToken: session.csrfToken,
          response: key.registration(options),
        },
        `${cookie}; ${browserCookie}`,
      ),
    ),
  );
  const proof = (
    (await registered.json()) as {
      options: PublicKeyCredentialRequestOptionsJSON;
    }
  ).options;
  const enabled = await action(
    args(
      post(
        {
          action: "enable-finish",
          csrfToken: session.csrfToken,
          response: key.assertion(proof),
        },
        `${cookie}; ${browserCookie}`,
      ),
    ),
  );
  expect(enabled.status).toBe(200);
  expect(await enabled.json()).toEqual({ nextPath: "/settings/security" });
  return { session, cookie, key, enabledCookie: cookies(enabled) };
}

test("both roles enroll only their own first key, rotate secure cookies and then sign in with username/key", async () => {
  for (const [username, role] of [
    ["admin.owner", "admin"],
    ["member.owner", "member"],
  ] as const) {
    const { key, cookie, enabledCookie } = await enabledAccount(username, role);
    const stale = await securityLoader(
      args(
        new Request(`${origin}/settings/security`, {
          headers: { Cookie: cookie },
        }),
        "/settings/security",
      ),
    ).catch((error: unknown) => error);
    expect(stale).toBeInstanceOf(Response);
    expect((stale as Response).headers.get("Location")).toBe("/login");
    const settings = await securityLoader(
      args(
        new Request(`${origin}/settings/security`, {
          headers: { Cookie: enabledCookie },
        }),
        "/settings/security",
      ),
    );
    expect(settings).toMatchObject({
      enabled: true,
      credentials: [{ name: "My key" }],
    });
    const login = await loginLoader(
      args(new Request(`${origin}/login`), "/login"),
    );
    if (login instanceof Response) throw new Error("login redirected");
    const csrf = login.data.csrfToken;
    const loginCookie = new Headers(login.init?.headers)
      .get("Set-Cookie")!
      .split(";", 1)[0];
    const bypass = await passwordLogin(
      args(
        new Request(`${origin}/login`, {
          method: "POST",
          headers: { Cookie: loginCookie, Origin: origin },
          body: new URLSearchParams({ csrfToken: csrf, username, password }),
        }),
        "/login",
      ),
    );
    expect(bypass).toMatchObject({ init: { status: 401 } });
    const start = await action(
      args(
        post({ action: "login-start", csrfToken: csrf, username }, loginCookie),
      ),
    );
    const proof = (
      (await start.json()) as { options: PublicKeyCredentialRequestOptionsJSON }
    ).options;
    const finished = await action(
      args(
        post(
          {
            action: "login-finish",
            csrfToken: csrf,
            response: key.assertion(proof, 2),
          },
          `${loginCookie}; ${cookies(start)}`,
        ),
      ),
    );
    expect(finished.status).toBe(200);
    expect(await finished.json()).toEqual({ nextPath: "/" });
    expect(finished.headers.get("Set-Cookie")).toContain(
      "__Host-calorie_session=",
    );
    const replay = await action(
      args(
        post(
          {
            action: "login-finish",
            csrfToken: csrf,
            response: key.assertion(proof, 2),
          },
          `${loginCookie}; ${cookies(start)}`,
        ),
      ),
    ).catch((error: unknown) => error);
    expect((replay as Response).status).toBe(403);
  }
});

test("route origin, CSRF, anonymous enrollment, setup and cross-account target guards reject requests", async () => {
  await expect(
    action(
      args(
        post({ action: "register-start", csrfToken: "invalid", name: "Key" }),
      ),
    ),
  ).rejects.toMatchObject({ status: 401 });
  const session = await account("guard.owner");
  const cookie = serializeSessionCookie(session).split(";", 1)[0];
  await expect(
    action(
      args(
        post(
          { action: "register-start", csrfToken: "invalid", name: "Key" },
          cookie,
        ),
      ),
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    action(
      args(
        post(
          {
            action: "register-start",
            csrfToken: session.csrfToken,
            name: "Key",
          },
          cookie,
          "https://attacker.example",
        ),
      ),
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    action(
      args(
        post(
          {
            action: "register-start",
            csrfToken: session.csrfToken,
            name: "Key",
            userId: 1,
          },
          cookie,
        ),
      ),
    ),
  ).rejects.toMatchObject({ status: 400 });
  const unready = await seedAuthenticatedAccount(
    getAuthenticationService(),
    getApplicationDatabase().getClient(),
    "setup.owner",
    password,
    "setup",
  );
  const redirect = await securityLoader(
    args(
      new Request(`${origin}/settings/security`, {
        headers: { Cookie: serializeSessionCookie(unready).split(";", 1)[0] },
      }),
      "/settings/security",
    ),
  );
  expect((redirect as Response).headers.get("Location")).toBe("/setup");
});

test("non-loopback HTTP LAN redirects personal security without tokens and cannot submit any key ceremony or bypass mode", async () => {
  const { enabledCookie } = await enabledAccount("lan.owner");
  const lanOrigin = "http://192.168.50.12:3000";
  await requestPolicyContext.run(
    { entry: "lan", origin: lanOrigin },
    async () => {
      const lanCookie = `calorie_lan_session=${parseCookies(enabledCookie).get("__Host-calorie_session")!}`;
      const page = await loginLoader(
        args(new Request(`${lanOrigin}/login`), "/login"),
      );
      if (page instanceof Response) throw new Error("login redirected");
      expect(page.data.publicKeyUrl).toBe(`${origin}/login`);
      const cookie = new Headers(page.init?.headers)
        .get("Set-Cookie")!
        .split(";", 1)[0];
      const bypass = await passwordLogin(
        args(
          new Request(`${lanOrigin}/login`, {
            method: "POST",
            headers: { Origin: lanOrigin, Cookie: cookie },
            body: new URLSearchParams({
              username: "lan.owner",
              password,
              csrfToken: page.data.csrfToken,
            }),
          }),
          "/login",
        ),
      );
      expect(bypass).toMatchObject({ init: { status: 401 } });
      expect(
        (
          await action(
            args(
              post(
                {
                  action: "login-start",
                  csrfToken: page.data.csrfToken,
                  username: "lan.owner",
                },
                cookie,
                lanOrigin,
              ),
            ),
          )
        ).status,
      ).toBe(403);
      expect(
        (await securityLoader(
          args(
            new Request(`${lanOrigin}/settings/security`, {
              headers: { Cookie: lanCookie },
            }),
            "/settings/security",
          ),
        )) as Response,
      ).toHaveProperty("status", 302);
    },
  );
});

// Vitest has no navigator.credentials; this provider adapter still signs real protocol responses.
vi.mock("@simplewebauthn/browser", async (original) => ({
  ...(await original<typeof import("@simplewebauthn/browser")>()),
  startRegistration: vi.fn(),
  startAuthentication: vi.fn(),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderPage(
  Component: (props: never) => React.JSX.Element,
  pathname: string,
  loaderData: object,
  loader?: () => unknown,
) {
  const Routes = createRoutesStub([
    { Component: Component as never, id: "subject", path: pathname, loader },
  ]);
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      createElement(Routes, {
        initialEntries: [pathname],
        hydrationData: { loaderData: { subject: loaderData } },
      }),
    );
  });
  return renderer!;
}
function formSubmit(renderer: ReactTestRenderer) {
  return (
    renderer.root.findAllByType("form")[0].props as {
      onSubmit: (event: {
        preventDefault(): void;
        currentTarget: object;
        defaultPrevented?: boolean;
      }) => void;
    }
  ).onSubmit;
}
function allText(renderer: ReactTestRenderer) {
  return renderer.root
    .findAll((node) => typeof node.type === "string")
    .flatMap((node) => node.children)
    .filter((child): child is string => typeof child === "string")
    .join(" ");
}
function browserTransport(initialCookie: string) {
  const jar = new Map<string, string>();
  const outcomes: { action: string; status: number }[] = [];
  for (const [name, value] of parseCookies(initialCookie)) jar.set(name, value);
  const cookie = () =>
    [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const request = new Request(`${origin}${url}`, {
      ...init,
      headers: { ...init.headers, Origin: origin, Cookie: cookie() },
    });
    const response = await action(args(request)).catch((error: unknown) => {
      if (error instanceof Response) return error;
      throw error;
    });
    for (const serialized of response.headers.getSetCookie()) {
      for (const [name, value] of parseCookies(serialized.split(";", 1)[0])) {
        if (value) jar.set(name, value);
        else jar.delete(name);
      }
    }
    outcomes.push({ action: (JSON.parse(String(init.body)) as { action: string }).action, status: response.status });
    return response;
  });
  const NativeFormData = FormData;
  vi.stubGlobal(
    "FormData",
    class extends NativeFormData {
      constructor(fields?: object) {
        super();
        for (const [name, value] of Object.entries(fields ?? {}))
          this.set(name, String(value));
      }
    },
  );
  const assign = vi.fn();
  const installNavigation = () =>
    vi.stubGlobal("window", { location: { assign } });
  return { cookie, assign, installNavigation, outcomes };
}

test.each([false, true])("fallback-password UI verifies a fresh key and completes replacement with restriction=%s", async (restricted) => {
  const owner = await enabledAccount(`password.ui.${restricted}`);
  const service = getAuthenticationService();
  let cookie = owner.enabledCookie;
  let counter = 2;
  if (restricted) {
    await service.resetMemberPassword(owner.session.user, owner.session.user.username, "temporary replacement password");
    const proof = await service.keys.beginLogin(owner.session.user.username, "ui-reset-login", "192.0.2.5");
    cookie = serializeSessionCookie(await service.keys.finishLogin("ui-reset-login", owner.key.assertion(proof, counter++))).split(";", 1)[0];
  }
  const transport = browserTransport(cookie);
  const load = () => passwordLoader(args(new Request(`${origin}/account/password`, { headers: { Cookie: transport.cookie() } }), "/account/password"));
  const pageData = await load();
  if (pageData instanceof Response) throw new Error("password settings redirected");
  const renderer = await renderPage(ChangePassword, "/account/password", pageData, load);
  transport.installNavigation();
  expect(renderer.root.findAllByProps({ name: "currentPassword" })).toHaveLength(0);
  expect(allText(renderer)).toContain("You do not need the old password");
  vi.mocked(browserProvider.startAuthentication).mockRejectedValueOnce(new DOMException("cancelled", "NotAllowedError"));
  const fields = { newPassword: "replacement fallback password", confirmNewPassword: "replacement fallback password", reset: vi.fn() };
  await act(async () => {
    formSubmit(renderer)({ defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, currentTarget: fields });
    await vi.waitFor(() => expect(transport.outcomes).toContainEqual({ action: "cancel", status: 200 }));
  });
  expect(renderer.root.findByProps({ role: "alert" }).children.join("")).toContain("cancelled");
  vi.mocked(browserProvider.startAuthentication).mockImplementation(async ({ optionsJSON }) => owner.key.assertion(optionsJSON, counter));
  await act(async () => {
    formSubmit(renderer)({ defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, currentTarget: fields });
    await vi.waitFor(() => expect((service.keys.status(parseCookies(transport.cookie()).get("__Host-calorie_session")!)).enabled).toBe(true));
    await vi.waitFor(() => expect((service.verifyCredentials(owner.session.user.username, "replacement fallback password"))).resolves.toMatchObject({ matches: true }));
  });
  expect(await load()).toMatchObject({ keyLoginEnabled: true, passwordChangeRequired: false });
  expect(allText(renderer)).toContain(restricted ? "Set your private password" : "Password changed.");
  expect(transport.assign.mock.calls).toEqual(restricted ? [["/setup"]] : []);
  await act(async () => renderer.unmount());
});

test("security UI and login UI complete real route ceremonies without an account password", async () => {
  const owner = await account("ui.owner");
  const cookie = serializeSessionCookie(owner).split(";", 1)[0];
  const pageData = await securityLoader(
    args(
      new Request(`${origin}/settings/security`, {
        headers: { Cookie: cookie },
      }),
      "/settings/security",
    ),
  );
  if (pageData instanceof Response)
    throw new Error("security settings redirected");
  expect(securityHeaders()["Cache-Control"]).toBe("no-store");
  expect(securityMeta()[0]).toHaveProperty(
    "title",
    "Account security · Open Calorie Tracker",
  );
  const renderer = await renderPage(
    SecuritySettings,
    "/settings/security",
    pageData,
  );
  const transport = browserTransport(cookie);
  transport.installNavigation();
  const key = authenticator();
  vi.mocked(browserProvider.startRegistration).mockImplementation(
    async ({ optionsJSON }) => key.registration(optionsJSON),
  );
  vi.mocked(browserProvider.startAuthentication).mockImplementation(
    async ({ optionsJSON }) => key.assertion(optionsJSON),
  );
  await act(async () => {
    formSubmit(renderer)({
      preventDefault() {},
      currentTarget: { name: "Proton Pass" },
    });
    await vi.waitFor(() =>
      expect(transport.assign).toHaveBeenCalledWith("/settings/security"),
    );
  });
  const enabled = await securityLoader(
    args(
      new Request(`${origin}/settings/security`, {
        headers: { Cookie: transport.cookie() },
      }),
      "/settings/security",
    ),
  );
  expect(enabled).toMatchObject({
    enabled: true,
    credentials: [{ name: "Proton Pass" }],
  });
  await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
  const loggedOut = await loginLoader(
    args(new Request(`${origin}/login`), "/login"),
  );
  if (loggedOut instanceof Response) throw new Error("login redirected");
  const loginPage = await renderPage(Login, "/login", loggedOut.data);
  const loginTransport = browserTransport(
    new Headers(loggedOut.init?.headers).get("Set-Cookie")!.split(";", 1)[0],
  );
  loginTransport.installNavigation();
  vi.mocked(browserProvider.startAuthentication).mockImplementation(
    async ({ optionsJSON }) => key.assertion(optionsJSON, 2),
  );
  const keyButton = loginPage.root
    .findAllByType("button")
    .find((node) => node.children.includes("Use registered key"))!;
  await act(async () => {
    (
      keyButton.props as {
        onClick(event: { currentTarget: { form: object } }): void;
      }
    ).onClick({ currentTarget: { form: { username: "ui.owner" } } });
    await vi.waitFor(() =>
      expect(loginTransport.assign).toHaveBeenCalledWith("/"),
    );
  });
  expect(
    parseCookies(loginTransport.cookie()).get("__Host-calorie_session"),
  ).toBeTruthy();
  await act(async () => loginPage.unmount());
});

test.each([
  [
    "registration cancellation",
    "registration",
    new DOMException("cancelled", "NotAllowedError"),
  ],
  [
    "assertion unavailable",
    "assertion",
    new Error("Key provider unavailable. Retry."),
  ],
  ["unknown provider error", "registration", "offline"],
] as const)(
  "security UI handles %s and leaves password access available",
  async (_name, stage, error) => {
    const owner = await account(
      `ui.failure.${stage}.${typeof error === "string" ? "string" : error.name.toLowerCase()}`.slice(
        0,
        30,
      ),
    );
    const cookie = serializeSessionCookie(owner).split(";", 1)[0];
    const pageData = await securityLoader(
      args(
        new Request(`${origin}/settings/security`, {
          headers: { Cookie: cookie },
        }),
        "/settings/security",
      ),
    );
    if (pageData instanceof Response) throw new Error("settings redirected");
    const renderer = await renderPage(
      SecuritySettings,
      "/settings/security",
      pageData,
    );
    const transport = browserTransport(cookie);
    transport.installNavigation();
    const key = authenticator();
    vi.mocked(browserProvider.startRegistration).mockImplementation(
      async ({ optionsJSON }) => {
        if (stage === "registration") throw error;
        return key.registration(optionsJSON);
      },
    );
    vi.mocked(browserProvider.startAuthentication).mockRejectedValue(error);
    await act(async () => {
      formSubmit(renderer)({
        preventDefault() {},
        currentTarget: { name: "My key" },
      });
      await vi.waitFor(() => expect(transport.assign).not.toHaveBeenCalled());
    });
    await vi.waitFor(() =>
      expect(allText(renderer)).toMatch(/cancelled|unavailable|retry/i),
    );
    expect(getAuthenticationService().keys.status(owner.token)).toEqual({
      enabled: false,
      credentials: [],
    });
    expect(
      (
        await getAuthenticationService().login(
          owner.user.username,
          password,
          "198.51.100.67",
        )
      ).ok,
    ).toBe(true);
    await act(async () => renderer.unmount());
  },
);

test("security page shows enabled credential names and omits preview enrollment when off", async () => {
  for (const pageData of [
    {
      enabled: true,
      preview: true,
      credentials: [{ id: "key", name: "My YubiKey", createdAt: "2026-09-13" }],
    },
    { enabled: false, preview: false, credentials: [] },
  ]) {
    const renderer = await renderPage(SecuritySettings, "/settings/security", {
      ...pageData,
      username: "owner",
      csrfToken: "csrf",
    });
    expect(renderer.root.findAllByType("form")).toHaveLength(
      pageData.preview ? 1 : 0,
    );
    expect(allText(renderer)).toContain(
      pageData.enabled ? "Key login is enabled" : "Password login is enabled",
    );
    await act(async () => renderer.unmount());
  }
});

test("invalid login input returns a retryable UI outcome and the LAN UI links to public HTTPS", async () => {
  const loaded = await loginLoader(
    args(new Request(`${origin}/login`), "/login"),
  );
  if (loaded instanceof Response) throw new Error("login redirected");
  const renderer = await renderPage(Login, "/login", loaded.data);
  const transport = browserTransport(
    new Headers(loaded.init?.headers).get("Set-Cookie")!.split(";", 1)[0],
  );
  transport.installNavigation();
  const button = renderer.root
    .findAllByType("button")
    .find((node) => node.children.includes("Use registered key"))!;
  await act(async () => {
    (
      button.props as {
        onClick(event: { currentTarget: { form: object } }): void;
      }
    ).onClick({ currentTarget: { form: { username: "bad username" } } });
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  await vi.waitFor(() => expect(allText(renderer)).toContain("Retry"));
  expect(transport.assign).not.toHaveBeenCalled();
  await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
  const lan = await renderPage(Login, "/login", {
    csrfToken: "csrf",
    publicKeyUrl: `${origin}/login`,
  });
  expect(allText(lan)).toContain("Use key sign-in on public HTTPS");
  await act(async () => lan.unmount());
});

test("key routes enforce bounded bodies, CSRF, expired cookies, rate limits and redact storage failures", async () => {
  const owner = await account("edge.owner");
  const cookie = serializeSessionCookie(owner).split(";", 1)[0];
  const empty = new Request(`${origin}/key-ceremony`, {
    method: "POST",
    headers: { Origin: origin },
  });
  await expect(action(args(empty))).rejects.toMatchObject({ status: 400 });
  const declaredLarge = post(
    { action: "register-start", csrfToken: owner.csrfToken },
    cookie,
  );
  declaredLarge.headers.set("Content-Length", "32769");
  await expect(action(args(declaredLarge))).rejects.toMatchObject({
    status: 413,
  });
  await expect(
    action(
      args(
        post(
          {
            action: "register-start",
            csrfToken: owner.csrfToken,
            name: "x".repeat(33_000),
          },
          cookie,
        ),
      ),
    ),
  ).rejects.toMatchObject({ status: 413 });
  await expect(
    action(args(post({ action: "cancel", csrfToken: "wrong" }, cookie))),
  ).rejects.toMatchObject({ status: 403 });
  const missing = await action(
    args(
      post(
        { action: "register-finish", csrfToken: owner.csrfToken, response: {} },
        cookie,
      ),
    ),
  );
  expect(missing.status).toBe(400);
  const database = getApplicationDatabase().getClient();
  database.$client.exec(
    "CREATE TRIGGER refuse_ceremony BEFORE INSERT ON webauthn_ceremonies BEGIN SELECT RAISE(ABORT, 'private fixture storage detail'); END",
  );
  try {
    const failed = await action(
      args(
        post({ action: "register-start", csrfToken: owner.csrfToken }, cookie),
      ),
    );
    // Missing names fail clearly; no body fields imply authority.
    expect(failed.status).toBe(400);
    const storageFailed = await action(
      args(
        post(
          { action: "register-start", csrfToken: owner.csrfToken, name: "Key" },
          cookie,
        ),
      ),
    );
    expect(await storageFailed.json()).toEqual({
      error: "Key request failed. Retry.",
    });
  } finally {
    database.$client.exec("DROP TRIGGER refuse_ceremony");
  }
  const loaded = await loginLoader(
    args(new Request(`${origin}/login`), "/login"),
  );
  if (loaded instanceof Response) throw new Error("login redirected");
  const loginCookie = new Headers(loaded.init?.headers)
    .get("Set-Cookie")!
    .split(";", 1)[0];
  await expect(
    action(
      args(
        post(
          { action: "login-start", csrfToken: "wrong", username: "missing" },
          loginCookie,
        ),
      ),
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    action(args(post({ action: "cancel", csrfToken: "wrong" }, loginCookie))),
  ).rejects.toMatchObject({ status: 403 });
  let last: Response | undefined;
  for (let attempt = 0; attempt < 21; attempt++) {
    const request = post(
      {
        action: "login-start",
        csrfToken: loaded.data.csrfToken,
        username: "missing.edge",
      },
      loginCookie,
    );
    request.headers.set("X-Open-Calory-Client-IP", "198.51.100.52");
    last = await action(args(request));
  }
  expect(last?.status).toBe(429);
});

test("a key assertion after password reset keeps mandatory password replacement guards", async () => {
  const { key } = await enabledAccount("restricted.owner");
  const service = getAuthenticationService();
  expect(
    (
      await service.resetMemberPassword(
        {
          id: 1,
          username: "admin.owner",
          role: "admin",
          passwordChangeRequired: false,
        },
        "restricted.owner",
        "temporary replacement password",
      )
    ).ok,
  ).toBe(true);
  const loaded = await loginLoader(
    args(new Request(`${origin}/login`), "/login"),
  );
  if (loaded instanceof Response) throw new Error("login redirected");
  const cookie = new Headers(loaded.init?.headers)
    .get("Set-Cookie")!
    .split(";", 1)[0];
  const started = await action(
    args(
      post(
        {
          action: "login-start",
          csrfToken: loaded.data.csrfToken,
          username: "restricted.owner",
        },
        cookie,
      ),
    ),
  );
  const proof = (
    (await started.json()) as { options: PublicKeyCredentialRequestOptionsJSON }
  ).options;
  const completed = await action(
    args(
      post(
        {
          action: "login-finish",
          csrfToken: loaded.data.csrfToken,
          response: key.assertion(proof, 2),
        },
        `${cookie}; ${cookies(started)}`,
      ),
    ),
  );
  expect(await completed.json()).toEqual({ nextPath: "/account/password" });
  await expect(
    securityLoader(
      args(
        new Request(`${origin}/settings/security`, {
          headers: { Cookie: cookies(completed) },
        }),
        "/settings/security",
      ),
    ),
  ).rejects.toMatchObject({ status: 302 });
  const restrictedCookie = cookies(completed);
  const token = parseCookies(restrictedCookie).get("__Host-calorie_session")!;
  const restricted = (await service.authenticate(token))!;
  const start = await action(args(post({ action: "password-start", csrfToken: restricted.csrfToken }, restrictedCookie)));
  const { options } = await start.json() as { options: PublicKeyCredentialRequestOptionsJSON };
  expect((await action(args(post({ action: "cancel", csrfToken: restricted.csrfToken }, `${restrictedCookie}; ${cookies(start)}`)))).status).toBe(200);
  const retry = await action(args(post({ action: "password-start", csrfToken: restricted.csrfToken }, restrictedCookie)));
  const retriedOptions = (await retry.json() as { options: PublicKeyCredentialRequestOptionsJSON }).options;
  const replaced = await action(args(post({ action: "password-finish", csrfToken: restricted.csrfToken, response: key.assertion(retriedOptions, 3), newPassword: "replacement fallback password", confirmNewPassword: "replacement fallback password" }, `${restrictedCookie}; ${cookies(retry)}`)));
  expect(await replaced.json()).toEqual({ nextPath: "/setup" });
  const newToken = parseCookies(cookies(replaced)).get("__Host-calorie_session")!;
  expect(await service.authenticate(newToken)).toMatchObject({ user: { passwordChangeRequired: false } });
  await expect(service.keys.finishPasswordChange(token, "missing", key.assertion(options, 3), "another replacement password")).rejects.toThrow();
});

test.each(["short", "confirmation", "wrong-purpose", "other-key", "other-session"])("password-replacement routes reject %s without changing password, mode, or saved keys", async (failure) => {
  const owner = await enabledAccount(`fallback.${failure}`);
  const token = parseCookies(owner.enabledCookie).get("__Host-calorie_session")!;
  const session = (await getAuthenticationService().authenticate(token))!;
  const other = await enabledAccount(`other.${failure}`);
  const otherToken = parseCookies(other.enabledCookie).get("__Host-calorie_session")!;
  const otherSession = (await getAuthenticationService().authenticate(otherToken))!;
  const start = await action(args(post({ action: failure === "wrong-purpose" ? "disable-start" : "password-start", csrfToken: session.csrfToken }, owner.enabledCookie)));
  const { options } = await start.json() as { options: PublicKeyCredentialRequestOptionsJSON };
  const assertion = (failure === "other-key" ? other.key : owner.key).assertion(options, 2);
  const body = { action: "password-finish", csrfToken: failure === "other-session" ? otherSession.csrfToken : session.csrfToken,
    newPassword: failure === "short" ? "short" : "replacement fallback password", confirmNewPassword: failure === "confirmation" ? "mismatched fallback password" : "replacement fallback password", response: assertion };
  const cookie = `${failure === "other-session" ? other.enabledCookie : owner.enabledCookie}; ${cookies(start)}`;
  const finish = await action(args(post(body, cookie)));
  expect(finish.status).toBe(400);
  expect(finish.headers.getSetCookie().some((value) => value.startsWith("__Host-calorie_session="))).toBe(false);
  const replay = await action(args(post({ ...body, newPassword: "replacement fallback password", confirmNewPassword: "replacement fallback password" }, cookie)));
  expect(replay.status).toBe(400);
  expect((await getAuthenticationService().verifyCredentials(session.user.username, password)).matches).toBe(true);
  expect(getAuthenticationService().keys.status(session.token)).toMatchObject({ enabled: true, credentials: [{ id: owner.key.id }] });
});

test("adding a key through the route requires a scoped fresh assertion", async () => {
  const { enabledCookie, key } = await enabledAccount("route.addition");
  const loaded = await securityLoader(
    args(
      new Request(`${origin}/settings/security`, {
        headers: { Cookie: enabledCookie },
      }),
      "/settings/security",
    ),
  );
  if (loaded instanceof Response) throw new Error("settings redirected");
  const start = await action(
    args(
      post(
        {
          action: "addition-start",
          csrfToken: loaded.csrfToken,
          name: "Backup",
        },
        enabledCookie,
      ),
    ),
  );
  expect(start.status).toBe(200);
  const proof = (await start.json()) as {
    options: PublicKeyCredentialRequestOptionsJSON;
  };
  const cookie = `${enabledCookie}; ${cookies(start)}`;
  const authorized = await action(
    args(
      post(
        {
          action: "addition-finish",
          csrfToken: loaded.csrfToken,
          response: key.assertion(proof.options, 2),
        },
        cookie,
      ),
    ),
  );
  expect(authorized.status).toBe(200);
  const options = (await authorized.json()) as {
    options: PublicKeyCredentialCreationOptionsJSON;
  };
  const backup = authenticator();
  const registered = await action(
    args(
      post(
        {
          action: "register-finish",
          csrfToken: loaded.csrfToken,
          response: backup.registration(options.options),
        },
        cookie,
      ),
    ),
  );
  expect(registered.status).toBe(200);
  const verification = (await registered.json()) as {
    options: PublicKeyCredentialRequestOptionsJSON;
  };
  const finished = await action(
    args(
      post(
        {
          action: "enable-finish",
          csrfToken: loaded.csrfToken,
          response: backup.assertion(verification.options),
        },
        cookie,
      ),
    ),
  );
  expect(finished.status).toBe(200);
  const settings = await securityLoader(
    args(
      new Request(`${origin}/settings/security`, {
        headers: { Cookie: cookies(finished) },
      }),
      "/settings/security",
    ),
  );
  expect(settings).toMatchObject({
    enabled: true,
    credentials: [{ name: "My key" }, { name: "Backup" }],
  });
});

test("another account cannot list or complete a signed-in enrollment ceremony", async () => {
  const owner = await account("addition.owner");
  const other = await account("addition.other");
  const cookie = serializeSessionCookie(owner).split(";", 1)[0];
  const otherCookie = serializeSessionCookie(other).split(";", 1)[0];
  const start = await action(
    args(
      post(
        {
          action: "register-start",
          csrfToken: owner.csrfToken,
          name: "Private key",
        },
        cookie,
      ),
    ),
  );
  const { options } = (await start.json()) as {
    options: PublicKeyCredentialCreationOptionsJSON;
  };
  const key = authenticator();
  const rejected = await action(
    args(
      post(
        {
          action: "register-finish",
          csrfToken: other.csrfToken,
          response: key.registration(options),
        },
        `${otherCookie}; ${cookies(start)}`,
      ),
    ),
  );
  expect(rejected.status).toBe(400);
  for (const userCookie of [cookie, otherCookie]) {
    const settings = await securityLoader(
      args(
        new Request(`${origin}/settings/security`, {
          headers: { Cookie: userCookie },
        }),
        "/settings/security",
      ),
    );
    expect(settings).toMatchObject({ enabled: false, credentials: [] });
  }
  const targeted = await action(
    args(
      post(
        {
          action: "register-start",
          csrfToken: other.csrfToken,
          name: "Foreign target",
          userId: owner.user.id,
        },
        otherCookie,
      ),
    ),
  ).catch((error: unknown) => error);
  expect(targeted).toBeInstanceOf(Response);
  expect((targeted as Response).status).toBe(400);
});

test("a credential already owned by another account cannot be saved through verified enrollment", async () => {
  const { key } = await enabledAccount("credential.owner");
  const other = await account("credential.other");
  const cookie = serializeSessionCookie(other).split(";", 1)[0];
  const start = await action(
    args(
      post(
        {
          action: "register-start",
          csrfToken: other.csrfToken,
          name: "Copied credential",
        },
        cookie,
      ),
    ),
  );
  const { options } = (await start.json()) as {
    options: PublicKeyCredentialCreationOptionsJSON;
  };
  const pendingCookie = `${cookie}; ${cookies(start)}`;
  const registered = await action(
    args(
      post(
        {
          action: "register-finish",
          csrfToken: other.csrfToken,
          response: key.registration(options),
        },
        pendingCookie,
      ),
    ),
  );
  const verification = (await registered.json()) as {
    options: PublicKeyCredentialRequestOptionsJSON;
  };
  const rejected = await action(
    args(
      post(
        {
          action: "enable-finish",
          csrfToken: other.csrfToken,
          response: key.assertion(verification.options),
        },
        pendingCookie,
      ),
    ),
  );
  expect(rejected.status).toBe(400);
  const settings = await securityLoader(
    args(
      new Request(`${origin}/settings/security`, {
        headers: { Cookie: cookie },
      }),
      "/settings/security",
    ),
  );
  expect(settings).toMatchObject({ enabled: false, credentials: [] });
});

test.each([true, false])(
  "security UI adds a verified key while preserving enabled=%s",
  async (enabled) => {
    const { session, key, enabledCookie } = await enabledAccount(
      `ui.addition.${enabled}`,
    );
    if (!enabled) {
      // Disabled-key fixture: the explicit enable/disable toggle ships in the next slice.
      getApplicationDatabase()
        .getClient()
        .$client.prepare(
          "UPDATE users SET key_login_enabled = 0, authentication_version = authentication_version + 1 WHERE id = ?",
        )
        .run(session.user.id);
    }
    const loaded = await securityLoader(
      args(
        new Request(`${origin}/settings/security`, {
          headers: { Cookie: enabledCookie },
        }),
        "/settings/security",
      ),
    );
    if (loaded instanceof Response) throw new Error("settings redirected");
    const renderer = await renderPage(
      SecuritySettings,
      "/settings/security",
      loaded,
    );
    const transport = browserTransport(enabledCookie);
    transport.installNavigation();
    const backup = authenticator();
    let registrationStarted!: () => void;
    let continueRegistration!: () => void;
    const started = new Promise<void>((resolve) => {
      registrationStarted = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      continueRegistration = resolve;
    });
    vi.mocked(browserProvider.startRegistration).mockImplementation(
      async ({ optionsJSON }) => {
        registrationStarted();
        await proceed;
        return backup.registration(optionsJSON);
      },
    );
    vi.mocked(browserProvider.startAuthentication).mockImplementation(
      async ({ optionsJSON }) =>
        optionsJSON.allowCredentials?.some(
          (credential) => credential.id === backup.id,
        )
          ? backup.assertion(optionsJSON)
          : key.assertion(optionsJSON, 2),
    );
    await act(async () => {
      formSubmit(renderer)({
        preventDefault() {},
        currentTarget: { name: "UI backup" },
      });
      await started;
    });
    expect(allText(renderer)).toContain(
      enabled ? "Verify an existing key" : "Password login stays enabled",
    );
    await act(async () => {
      continueRegistration();
      await vi.waitFor(() =>
        expect(transport.assign).toHaveBeenCalledWith("/settings/security"),
      );
    });
    const settings = await securityLoader(
      args(
        new Request(`${origin}/settings/security`, {
          headers: { Cookie: transport.cookie() },
        }),
        "/settings/security",
      ),
    );
    expect(settings).toMatchObject({
      enabled,
      credentials: [{ name: "My key" }, { name: "UI backup" }],
    });
    await act(async () => renderer.unmount());
  },
);

test("addition start denies missing names and unauthenticated or cross-site requests", async () => {
  const { enabledCookie } = await enabledAccount("addition.protected");
  const settings = await securityLoader(
    args(
      new Request(`${origin}/settings/security`, {
        headers: { Cookie: enabledCookie },
      }),
      "/settings/security",
    ),
  );
  if (settings instanceof Response) throw new Error("settings redirected");
  const unnamed = await action(
    args(
      post(
        { action: "addition-start", csrfToken: settings.csrfToken },
        enabledCookie,
      ),
    ),
  );
  expect(unnamed.status).toBe(400);
  expect(await unnamed.json()).toMatchObject({
    error: "Name your key using 1–80 characters.",
  });
  const anonymous = await action(
    args(
      post({
        action: "addition-start",
        csrfToken: settings.csrfToken,
        name: "Backup",
      }),
    ),
  ).catch((error: unknown) => error);
  expect((anonymous as Response).status).toBe(401);
  const forged = await action(
    args(
      post(
        { action: "addition-start", csrfToken: "forged", name: "Backup" },
        enabledCookie,
      ),
    ),
  ).catch((error: unknown) => error);
  expect((forged as Response).status).toBe(403);
});

test("mode routes disable to password sign-in and re-enable retained keys without a password field", async () => {
  const { enabledCookie, key } = await enabledAccount("toggle.route");
  async function settings(cookie: string) {
    const loaded = await securityLoader(args(new Request(`${origin}/settings/security`, { headers: { Cookie: cookie } }), "/settings/security"));
    if (loaded instanceof Response) throw new Error("settings redirected");
    return loaded;
  }
  async function toggle(cookie: string, enabled: boolean, counter: number) {
    const loaded = await settings(cookie);
    const prefix = enabled ? "re-enable" : "disable";
    const start = await action(args(post({ action: `${prefix}-start`, csrfToken: loaded.csrfToken }, cookie)));
    expect(start.status).toBe(200);
    const { options } = await start.json() as { options: PublicKeyCredentialRequestOptionsJSON };
    return action(args(post({ action: `${prefix}-finish`, csrfToken: loaded.csrfToken, response: key.assertion(options, counter) }, `${cookie}; ${cookies(start)}`)));
  }
  const disabled = await toggle(enabledCookie, false, 2);
  expect(await disabled.json()).toEqual({ nextPath: "/login" });
  expect(disabled.headers.get("Set-Cookie")).toContain("__Host-calorie_session=;");
  const login = await getAuthenticationService().login("toggle.route", password, "192.0.2.70");
  if (!login.ok) throw new Error("password login failed");
  const passwordCookie = serializeSessionCookie(login.session).split(";", 1)[0];
  expect(await settings(passwordCookie)).toMatchObject({ enabled: false, credentials: [{ id: key.id }] });
  const enabled = await toggle(passwordCookie, true, 3);
  expect(enabled.status).toBe(200);
  expect(await enabled.json()).toEqual({ nextPath: "/settings/security" });
  expect(await settings(cookies(enabled))).toMatchObject({ enabled: true, credentials: [{ id: key.id }] });
});

test.each([false, true])("mode toggle UI to enabled=%s handles cancellation and retries without a password", async (enabled) => {
  const owner = await enabledAccount(`toggle.ui.${enabled}`);
  let cookie = owner.enabledCookie;
  if (enabled) {
    const session = await getAuthenticationService().authenticate(parseCookies(cookie).get("__Host-calorie_session"));
    if (!session) throw new Error("missing session");
    const proof = await getAuthenticationService().keys.beginModeChange(session.token, "disable-ui", false);
    await getAuthenticationService().keys.finishModeChange(session.token, "disable-ui", false, owner.key.assertion(proof, 2));
    const login = await getAuthenticationService().login(`toggle.ui.${enabled}`, password, "192.0.2.72");
    if (!login.ok) throw new Error("password login failed");
    cookie = serializeSessionCookie(login.session).split(";", 1)[0];
  }
  const loaded = await securityLoader(args(new Request(`${origin}/settings/security`, { headers: { Cookie: cookie } }), "/settings/security"));
  if (loaded instanceof Response) throw new Error("settings redirected");
  const renderer = await renderPage(SecuritySettings, "/settings/security", loaded);
  const transport = browserTransport(cookie);
  transport.installNavigation();
  expect(renderer.root.findAllByType("input").some((input) => input.props.type === "password")).toBe(false);
  const toggle = () => renderer.root.findAllByType("button").find((node) => node.children.includes(enabled ? "Re-enable key login" : "Disable key login"))!;
  vi.mocked(browserProvider.startAuthentication).mockRejectedValueOnce(new DOMException("cancelled", "NotAllowedError"));
  await act(async () => {
    (toggle().props as { onClick(): void }).onClick();
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(allText(renderer)).toContain("cancelled");
  });
  expect(getAuthenticationService().keys.status(parseCookies(transport.cookie()).get("__Host-calorie_session")!).enabled).toBe(!enabled);
  let finish!: () => void;
  const proceed = new Promise<void>((resolve) => { finish = resolve; });
  vi.mocked(browserProvider.startAuthentication).mockImplementation(async ({ optionsJSON }) => { await proceed; return owner.key.assertion(optionsJSON, 3); });
  await act(async () => { (toggle().props as { onClick(): void }).onClick(); });
  expect(allText(renderer)).toContain("Verify any saved key");
  await act(async () => {
    finish();
    await vi.waitFor(() => expect(transport.assign).toHaveBeenCalledWith(enabled ? "/settings/security" : "/login"));
  });
  await act(async () => renderer.unmount());
});

test.each(["disable-start", "re-enable-start", "remove-start", "remove-finish"])("%s preserves authenticated CSRF, origin and anonymous guards", async (modeAction) => {
  await expect(action(args(post({ action: modeAction, csrfToken: "bad" })))).rejects.toMatchObject({ status: 401 });
  const session = await account(`protected.${modeAction}`);
  const cookie = serializeSessionCookie(session).split(";", 1)[0];
  await expect(action(args(post({ action: modeAction, csrfToken: "bad" }, cookie)))).rejects.toMatchObject({ status: 403 });
  const wrongOrigin = post({ action: modeAction, csrfToken: session.csrfToken }, cookie);
  wrongOrigin.headers.set("Origin", "https://attacker.example");
  await expect(action(args(wrongOrigin))).rejects.toMatchObject({ status: 403 });
});

test.each([true, false])("removal UI in key mode=%s explains final-key passwords, permits cancel, and retries fresh verification", async (enabled) => {
  const username = `remove.ui.${enabled}`;
  const owner = await enabledAccount(username);
  let cookie = owner.enabledCookie;
  if (!enabled) {
    const current = (await getAuthenticationService().authenticate(parseCookies(cookie).get("__Host-calorie_session")))!;
    const proof = await getAuthenticationService().keys.beginModeChange(current.token, "disable-removal-ui", false);
    await getAuthenticationService().keys.finishModeChange(current.token, "disable-removal-ui", false, owner.key.assertion(proof, 2));
    const login = await getAuthenticationService().login(username, password, username);
    if (!login.ok) throw new Error("password login failed");
    cookie = serializeSessionCookie(login.session).split(";", 1)[0];
  }
  const loaded = await securityLoader(args(new Request(`${origin}/settings/security`, { headers: { Cookie: cookie } }), "/settings/security"));
  if (loaded instanceof Response) throw new Error("settings redirected");
  const renderer = await renderPage(SecuritySettings, "/settings/security", loaded);
  const transport = browserTransport(cookie);
  transport.installNavigation();
  const button = (name: string) => renderer.root.findAllByType("button").find((node) => (node.props["aria-label"] ?? node.children.join("")) === name)!;
  await act(async () => { (button("Delete My key").props as { onClick(): void }).onClick(); });
  expect(allText(renderer)).toContain("Deleting your final key restores password sign-in");
  await act(async () => { (button("Cancel deletion").props as { onClick(): void }).onClick(); });
  expect(allText(renderer)).not.toContain("Confirm deletion");
  vi.mocked(browserProvider.startAuthentication).mockRejectedValueOnce(new DOMException("cancelled", "NotAllowedError"));
  await act(async () => { (button("Delete My key").props as { onClick(): void }).onClick(); });
  const submit = async (password: string) => {
    const form = renderer.root.findAllByType("form").find((node) => node.props["aria-labelledby"] === "remove-key-title")!;
    await act(async () => { (form.props as { onSubmit(event: { preventDefault(): void; currentTarget: object }): void }).onSubmit({ preventDefault() {}, currentTarget: { password } }); });
  };
  await submit("incorrect password");
  await vi.waitFor(async () => { await act(async () => {}); expect(renderer.root.findAll((node) => node.props.role === "alert")).toHaveLength(1); });
  expect(transport.assign).not.toHaveBeenCalled();
  expect(getAuthenticationService().keys.status(parseCookies(transport.cookie()).get("__Host-calorie_session")!).credentials).toHaveLength(1);
  vi.mocked(browserProvider.startAuthentication).mockImplementation(async ({ optionsJSON }) => owner.key.assertion(optionsJSON, 3));
  await submit(password);
  await vi.waitFor(() => expect(transport.assign).toHaveBeenCalledWith("/login"));
  expect((await getAuthenticationService().login(username, password, username)).ok).toBe(true);
  await act(async () => renderer.unmount());
});

test("personal removal rejects another owner's target and another session's proof, and logs no credential material", async () => {
  const owner = await enabledAccount("remove.owner");
  const foreign = await enabledAccount("remove.foreign");
  async function sessionFor(cookie: string) {
    return (await getAuthenticationService().authenticate(parseCookies(cookie).get("__Host-calorie_session")))!;
  }
  const current = await sessionFor(owner.enabledCookie);
  const other = await sessionFor(foreign.enabledCookie);
  const deniedTarget = await action(args(post({ action: "remove-start", csrfToken: other.csrfToken, credentialId: owner.key.id }, foreign.enabledCookie)));
  expect(deniedTarget.status).toBe(400);
  const start = await action(args(post({ action: "remove-start", csrfToken: current.csrfToken, credentialId: owner.key.id }, owner.enabledCookie)));
  const { options } = await start.json() as { options: PublicKeyCredentialRequestOptionsJSON };
  const response = owner.key.assertion(options, 2);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const rejected = await action(args(post({ action: "remove-finish", csrfToken: other.csrfToken, credentialId: owner.key.id, response }, `${foreign.enabledCookie}; ${cookies(start)}`)));
  expect(rejected.status).toBe(400);
  expect(getAuthenticationService().keys.status(current.token).credentials).toHaveLength(1);
  const audit = log.mock.calls.map((call) => String(call[0])).join("\n");
  expect(audit).toContain("key_removal");
  for (const secret of [owner.key.id, options.challenge, response.response.signature, current.token, password]) expect(audit).not.toContain(secret);
});

test("member recovery routes require administrator authority, target confirmation, CSRF and fresh password proof", async () => {
  const service = getAuthenticationService();
  getApplicationDatabase().getClient().$client.exec("DELETE FROM users WHERE role = 'admin'");
  const administrator = await account("recovery.route.admin", "admin");
  const member = await enabledAccount("recovery.route.member");
  const memberSession = (await service.authenticate(parseCookies(member.enabledCookie).get("__Host-calorie_session")))!;
  const adminCookie = serializeSessionCookie(administrator).split(";", 1)[0];
  const fields = { csrfToken: administrator.csrfToken, targetUserId: memberSession.user.id, username: "recovery.route.member", confirmationUsername: "recovery.route.member", proofMethod: "password" };
  await expect(action(args(post({ ...fields, action: "recovery-start" })))).rejects.toMatchObject({ status: 302 });
  await expect(action(args(post({ ...fields, action: "recovery-start", csrfToken: memberSession.csrfToken }, member.enabledCookie)))).rejects.toMatchObject({ status: 404 });
  await expect(action(args(post({ ...fields, action: "recovery-start", csrfToken: "bad" }, adminCookie)))).rejects.toMatchObject({ status: 403 });
  const unconfirmed = await action(args(post({ ...fields, action: "recovery-start", confirmationUsername: "wrong" }, adminCookie)));
  expect(unconfirmed.status).toBe(400);
  const start = await action(args(post({ ...fields, action: "recovery-start" }, adminCookie)));
  expect(start.status).toBe(200);
  expect(await start.json()).toEqual({});
  const finish = await action(args(post({ ...fields, action: "recovery-finish", password }, `${adminCookie}; ${cookies(start)}`)));
  expect(finish.status).toBe(200);
  expect(await finish.json()).toEqual({ outcome: "disabled", nextPath: "/settings/users" });
  expect(finish.headers.get("Set-Cookie")).not.toContain("__Host-calorie_session=");
  expect(await service.authenticate(memberSession.token)).toBeUndefined();
  const login = await service.login("recovery.route.member", password, "192.0.2.95");
  if (!login.ok) throw new Error("password recovery failed");
  expect(service.keys.status(login.session.token)).toMatchObject({ enabled: false, credentials: [{ id: member.key.id }] });
});

test.each(["password", "key"] as const)("member recovery UI retries fresh %s proof, prevents duplicate submission and reports already-disabled mode", async (method) => {
  vi.mocked(browserProvider.startAuthentication).mockReset();
  getApplicationDatabase().getClient().$client.exec("DELETE FROM users WHERE role = 'admin'");
  const admin = await enabledAccount(`recovery.ui.admin.${method}`, "admin");
  const member = await enabledAccount(`recovery.ui.member.${method}`);
  const service = getAuthenticationService();
  const loaded = await usersLoader(args(new Request(`${origin}/settings/users`, { headers: { Cookie: admin.enabledCookie } }), "/settings/users"));
  const renderer = await renderPage(Users, "/settings/users", loaded);
  const transport = browserTransport(admin.enabledCookie);
  const trigger = { focus: vi.fn() };
  const open = async () => { await act(async () => {
    (renderer.root.findByProps({ "aria-label": `Disable key login for recovery.ui.member.${method}` }).props as { onClick(event: object): void }).onClick({ currentTarget: trigger });
  }); };
  const cancel = () => renderer.root.findAllByType("button").find((node) => node.children.includes("Cancel recovery"))!;
  await open();
  await act(async () => { (cancel().props as { onClick(): void }).onClick(); });
  expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
  expect(trigger.focus).toHaveBeenCalledOnce();
  await open();
  await act(async () => { (renderer.root.findByType("dialog").props as { onCancel(): void }).onCancel(); });
  expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
  await open();
  const submit = async (fields: object, proofMethod: string | null = method) => {
    await act(async () => {
      (renderer.root.findByType("dialog").findByType("form").props as {
        onSubmit(event: object): void;
      }).onSubmit({ preventDefault() {}, currentTarget: fields, nativeEvent: { submitter: proofMethod ? { getAttribute: () => proofMethod } : null } });
    });
  };
  const fields = { confirmationUsername: `recovery.ui.member.${method}`, administratorPassword: password };
  await submit({}, null);
  await vi.waitFor(async () => { await act(async () => {}); expect(allText(renderer)).toContain("exactly to confirm"); });
  if (method === "key") vi.mocked(browserProvider.startAuthentication).mockRejectedValueOnce(new DOMException("cancelled", "NotAllowedError"));
  await submit({ ...fields, administratorPassword: "incorrect password" });
  await vi.waitFor(async () => { await act(async () => {}); expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(1); });
  expect(service.keys.status(parseCookies(member.enabledCookie).get("__Host-calorie_session")!).enabled).toBe(true);
  let continueProof!: () => void;
  const proceed = new Promise<void>((resolve) => { continueProof = resolve; });
  const originalFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if ((JSON.parse(String(init.body)) as { action: string }).action === "recovery-finish") await proceed;
    return originalFetch(url, init);
  });
  vi.mocked(browserProvider.startAuthentication).mockImplementation(async ({ optionsJSON }) => admin.key.assertion(optionsJSON, 2));
  const attemptsBefore = transport.outcomes.filter((outcome) => outcome.action === "recovery-start").length;
  await submit(fields);
  await submit(fields); // A second click while proof is pending must have no effect.
  expect(allText(renderer)).toContain("Verifying administrator proof");
  expect(transport.outcomes.filter((outcome) => outcome.action === "recovery-start")).toHaveLength(attemptsBefore + 1);
  continueProof();
  await vi.waitFor(async () => { await act(async () => {}); expect(allText(renderer)).toContain("key login disabled. Password and saved keys are preserved"); });
  expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
  expect(await service.authenticate(parseCookies(member.enabledCookie).get("__Host-calorie_session"))).toBeUndefined();
  vi.mocked(browserProvider.startAuthentication).mockImplementation(async ({ optionsJSON }) => admin.key.assertion(optionsJSON, 3));
  await open();
  await submit(fields);
  await vi.waitFor(async () => { await act(async () => {}); expect(allText(renderer)).toContain("key login was already disabled"); });
  await open();
  await act(async () => { (renderer.root.findByType("dialog").props as { onClose(): void }).onClose(); });
  expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
  await act(async () => renderer.unmount());
});

test("LAN member management guides administrator recovery to public HTTPS without proof tokens", async () => {
  getApplicationDatabase().getClient().$client.exec("DELETE FROM users WHERE role = 'admin'");
  const admin = await account("recovery.lan.admin", "admin");
  await account("recovery.lan.member");
  const lanOrigin = "http://192.168.50.12:3000";
  const loaded = await requestPolicyContext.run({ entry: "lan", origin: lanOrigin }, () => usersLoader(args(new Request(`${lanOrigin}/settings/users`, { headers: { Cookie: `calorie_lan_session=${admin.token}` } }), "/settings/users")));
  expect(loaded.recoveryPublicUrl).toBe(`${origin}/settings/users`);
  const renderer = await renderPage(Users, "/settings/users", loaded);
  expect(renderer.root.findAllByType("a").some((node) => node.props.href === `${origin}/settings/users`)).toBe(true);
  expect(renderer.root.findAllByType("button").some((node) => String(node.props["aria-label"]).startsWith("Disable key login"))).toBe(false);
  await act(async () => renderer.unmount());
});
