import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const validPassword = "correct horse 🔐 battery";
const applicationOrigin = "http://127.0.0.1:4173";

async function finishInitialSetup(page: Page) {
  await expect(page).toHaveURL("/setup");
  await page.getByLabel("Time zone").fill("UTC");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
}

async function fetchCsrfToken(
  request: APIRequestContext,
  path: "/login" | "/register",
  headers: Record<string, string>,
): Promise<{ cookie: string; token: string }> {
  const response = await request.get(path, { headers });
  expect(response.status()).toBe(200);
  const cookie = response.headers()["set-cookie"]?.split(";", 1)[0];
  const match = (await response.text()).match(
    /<input[^>]+name="csrfToken"[^>]+value="([^"]+)"/,
  );
  if (!cookie || !match?.[1]) {
    throw new Error("authentication form omitted its CSRF session");
  }
  return { cookie, token: match[1] };
}

test("a visitor can register with a normalized username", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.1" });
  await page.goto("/register");

  await page.getByLabel("Username").fill("Alice.User");
  await page.getByLabel("Password", { exact: true }).fill(validPassword);
  await page.getByLabel("Confirm password").fill(validPassword);
  await page.getByRole("button", { name: "Create private account" }).click();
  await finishInitialSetup(page);

  await expect(
    page.getByRole("heading", { name: "Today's Food Log" }),
  ).toBeVisible();
  await expect(page.getByText("Signed in as alice.user")).toBeVisible();
  const accessibilityScan = await new AxeBuilder({ page }).analyze();
  expect(accessibilityScan.violations).toEqual([]);
});

test("a returning user can sign in and revoke the current session", async ({
  browser,
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.2" });
  await page.goto("/");
  await expect(page).toHaveURL("/login");

  await page.goto("/register");
  await page.getByLabel("Username").fill("Bob.User");
  await page.getByLabel("Password", { exact: true }).fill(validPassword);
  await page.getByLabel("Confirm password").fill(validPassword);
  await page.getByRole("button", { name: "Create private account" }).click();
  await finishInitialSetup(page);

  const issuedCookie = (await context.cookies()).find(
    (cookie) => cookie.name === "__Host-calorie_session",
  );
  expect(issuedCookie).toMatchObject({
    domain: "127.0.0.1",
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure: true,
  });

  const secondContext = await browser.newContext({
    baseURL: applicationOrigin,
    extraHTTPHeaders: { "X-Test-Client-IP": "203.0.113.22" },
  });
  const secondDevice = await secondContext.newPage();
  await secondDevice.goto("/login");
  await secondDevice.getByLabel("Username").fill("bob.user");
  await secondDevice
    .getByLabel("Password", { exact: true })
    .fill(validPassword);
  await secondDevice.getByRole("button", { name: "Sign in" }).click();
  await expect(secondDevice).toHaveURL("/");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");
  await secondDevice.reload();
  await expect(secondDevice.getByText("Signed in as bob.user")).toBeVisible();

  await context.addCookies([
    {
      domain: "127.0.0.1",
      httpOnly: true,
      name: "__Host-calorie_session",
      path: "/",
      sameSite: "Lax",
      secure: true,
      value: issuedCookie?.value ?? "",
    },
  ]);
  await page.goto("/");
  await expect(page).toHaveURL("/login");

  await page.getByLabel("Username").fill("BOB.USER");
  await page.getByLabel("Password", { exact: true }).fill(validPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByText("Signed in as bob.user")).toBeVisible();
  await secondContext.close();
});

test("changing a password rotates this phone and revokes every other session", async ({
  browser,
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.40" });
  await page.goto("/register");
  await page.getByLabel("Username").fill("Password.Owner");
  await page.getByLabel("Password", { exact: true }).fill(validPassword);
  await page.getByLabel("Confirm password").fill(validPassword);
  await page.getByRole("button", { name: "Create private account" }).click();
  await finishInitialSetup(page);

  const originalCookie = (await context.cookies()).find(
    (cookie) => cookie.name === "__Host-calorie_session",
  );
  if (!originalCookie) throw new Error("registration omitted session cookie");

  const otherPhoneContext = await browser.newContext({
    baseURL: applicationOrigin,
    extraHTTPHeaders: { "X-Test-Client-IP": "203.0.113.41" },
  });
  const otherPhone = await otherPhoneContext.newPage();
  await otherPhone.goto("/login");
  await otherPhone.getByLabel("Username").fill("password.owner");
  await otherPhone
    .getByLabel("Password", { exact: true })
    .fill(validPassword);
  await otherPhone.getByRole("button", { name: "Sign in" }).click();
  await expect(otherPhone).toHaveURL("/");

  await page.goto("/account/password?changed=1");
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.goto("/");
  await page.getByRole("link", { name: "Change password" }).click();
  await page.getByLabel("Current password").fill("incorrect current password");
  await page
    .getByLabel("New password", { exact: true })
    .fill("replacement passphrase 🔐");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "The current password is incorrect.",
  );

  await page.getByLabel("Current password").fill(validPassword);
  await page
    .getByLabel("New password", { exact: true })
    .fill("replacement passphrase 🔐");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Password changed" }),
  ).toBeVisible();
  await expect(page.getByLabel("Current password")).toHaveValue("");
  await expect(page.getByLabel("New password", { exact: true })).toHaveValue(
    "",
  );

  const rotatedCookie = (await context.cookies()).find(
    (cookie) => cookie.name === "__Host-calorie_session",
  );
  expect(rotatedCookie?.value).not.toBe(originalCookie.value);

  await otherPhone.reload();
  await expect(otherPhone).toHaveURL("/login");

  const replayContext = await browser.newContext({
    baseURL: applicationOrigin,
    extraHTTPHeaders: { "X-Test-Client-IP": "203.0.113.42" },
  });
  await replayContext.addCookies([originalCookie]);
  const replay = await replayContext.newPage();
  await replay.goto("/");
  await expect(replay).toHaveURL("/login");
  await replay.getByLabel("Username").fill("password.owner");
  await replay.getByLabel("Password", { exact: true }).fill(validPassword);
  await replay.getByRole("button", { name: "Sign in" }).click();
  await expect(replay.getByRole("alert")).toContainText(
    "The username or password is incorrect.",
  );
  await replay
    .getByLabel("Password", { exact: true })
    .fill("replacement passphrase 🔐");
  await replay.getByRole("button", { name: "Sign in" }).click();
  await expect(replay).toHaveURL("/");

  const accessibilityScan = await new AxeBuilder({ page }).analyze();
  expect(accessibilityScan.violations).toEqual([]);
  await replayContext.close();
  await otherPhoneContext.close();
});

test("registration validation and login failures are accessible and specific only when safe", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.3" });
  await page.goto("/register");

  await page.getByLabel("Username").fill(" validation.user ");
  await page.getByLabel("Password", { exact: true }).fill(validPassword);
  await page.getByLabel("Confirm password").fill(validPassword);
  await page.getByRole("button", { name: "Create private account" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Use 3–30 ASCII letters, digits, dot, hyphen, or underscore.",
  );

  await page.getByLabel("Username").fill("Validation.User");
  await page.getByRole("button", { name: "Create private account" }).click();
  await finishInitialSetup(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");

  await page.goto("/register");
  await page.getByLabel("Username").fill("VALIDATION.USER");
  await page.getByLabel("Password", { exact: true }).fill(validPassword);
  await page.getByLabel("Confirm password").fill(validPassword);
  await page.getByRole("button", { name: "Create private account" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "That username is already registered.",
  );

  await page.goto("/login");
  await page.getByLabel("Username").fill("validation.user");
  await page.getByLabel("Password", { exact: true }).fill("wrong password value");
  await page.getByRole("button", { name: "Sign in" }).click();
  const existingUserError = await page.getByRole("alert").textContent();

  await page.getByLabel("Username").fill("missing.account");
  await page.getByLabel("Password", { exact: true }).fill("wrong password value");
  await page.getByRole("button", { name: "Sign in" }).click();
  expect(await page.getByRole("alert").textContent()).toBe(existingUserError);
});

test("logout rejects cross-origin requests and invalid session-bound CSRF values", async ({
  context,
  page,
  request,
}) => {
  const loginWithoutCsrf = await request.post("/login", {
    form: { password: validPassword, username: "missing.user" },
    headers: { Origin: applicationOrigin },
  });
  expect(loginWithoutCsrf.status()).toBe(403);

  const registrationWithoutCsrf = await request.post("/register", {
    form: {
      confirmPassword: "short",
      password: "short",
      username: "csrf.rejected",
    },
    headers: { Origin: applicationOrigin },
  });
  expect(registrationWithoutCsrf.status()).toBe(403);

  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.4" });
  await page.goto("/register");
  await page.getByLabel("Username").fill("csrf.user");
  await page.getByLabel("Password", { exact: true }).fill(validPassword);
  await page.getByLabel("Confirm password").fill(validPassword);
  await page.getByRole("button", { name: "Create private account" }).click();
  await finishInitialSetup(page);

  const wrongOrigin = await page.request.post("/logout", {
    form: { csrfToken: "invalid" },
    headers: { Origin: "https://attacker.invalid" },
  });
  expect(wrongOrigin.status()).toBe(403);

  const wrongCsrfStatus = await page.evaluate(async () => {
    const response = await fetch("/logout", {
      body: new URLSearchParams({ csrfToken: "invalid" }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    return response.status;
  });
  expect(wrongCsrfStatus).toBe(403);

  await page.goto("/account/password");
  await page.locator('input[name="csrfToken"]').evaluate((input) => {
    if (input instanceof HTMLInputElement) input.value = "invalid";
  });
  await page.getByLabel("Current password").fill(validPassword);
  await page
    .getByLabel("New password", { exact: true })
    .fill("replacement passphrase 🔐");
  const rejectedPasswordChange = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/account/password"),
  );
  await page.getByRole("button", { name: "Change password" }).click();
  expect((await rejectedPasswordChange).status()).toBe(403);

  await page.goto("/");
  await expect(page.getByText("Signed in as csrf.user")).toBeVisible();
});

test("authentication abuse limits survive across HTTP requests", async ({
  request,
}) => {
  const loginHeaders = {
    Origin: applicationOrigin,
    "X-Test-Client-IP": "203.0.113.10",
  };
  const loginCsrf = await fetchCsrfToken(
    request,
    "/login",
    loginHeaders,
  );

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await request.post("/login", {
      form: {
        csrfToken: loginCsrf.token,
        password: validPassword,
        username: "missing.user",
      },
      headers: { ...loginHeaders, Cookie: loginCsrf.cookie },
    });
    expect(response.status()).toBe(401);
    expect(await response.text()).toContain(
      "The username or password is incorrect.",
    );
  }

  const blockedLogin = await request.post("/login", {
    form: {
      csrfToken: loginCsrf.token,
      password: validPassword,
      username: "missing.user",
    },
    headers: { ...loginHeaders, Cookie: loginCsrf.cookie },
  });
  expect(blockedLogin.status()).toBe(429);
  expect(await blockedLogin.text()).toContain(
    "Too many sign-in attempts. Try again later.",
  );

  const registrationHeaders = {
    Origin: applicationOrigin,
    "X-Test-Client-IP": "203.0.113.20",
  };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const registrationCsrf = await fetchCsrfToken(
      request,
      "/register",
      registrationHeaders,
    );
    const response = await request.post("/register", {
      form: {
        confirmPassword: validPassword,
        csrfToken: registrationCsrf.token,
        password: validPassword,
        username: "limited.user",
      },
      headers: {
        ...registrationHeaders,
        Cookie: registrationCsrf.cookie,
      },
    });
    expect([200, 409]).toContain(response.status());
  }

  const blockedRegistrationCsrf = await fetchCsrfToken(
    request,
    "/register",
    registrationHeaders,
  );
  const blockedRegistration = await request.post("/register", {
    form: {
      confirmPassword: validPassword,
      csrfToken: blockedRegistrationCsrf.token,
      password: validPassword,
      username: "another.user",
    },
    headers: {
      ...registrationHeaders,
      Cookie: blockedRegistrationCsrf.cookie,
    },
  });
  expect(blockedRegistration.status()).toBe(429);
  expect(await blockedRegistration.text()).toContain(
    "Too many registration attempts. Try again later.",
  );
});
