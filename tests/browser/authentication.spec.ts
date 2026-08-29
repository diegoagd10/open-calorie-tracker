import { expect, test } from "@playwright/test";

const validPassword = "correct horse 🔐 battery";
const applicationOrigin = "http://127.0.0.1:4173";

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

  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { name: "Your private application space" }),
  ).toBeVisible();
  await expect(page.getByText("Signed in as alice.user")).toBeVisible();
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
  await expect(page).toHaveURL("/");

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

test("registration validation and login failures are accessible and specific only when safe", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.3" });
  await page.goto("/register");

  await page.getByLabel("Username").fill("not valid");
  await page.getByLabel("Password", { exact: true }).fill(validPassword);
  await page.getByLabel("Confirm password").fill(validPassword);
  await page.getByRole("button", { name: "Create private account" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Use 3–30 ASCII letters, digits, dot, hyphen, or underscore.",
  );

  await page.getByLabel("Username").fill("Validation.User");
  await page.getByRole("button", { name: "Create private account" }).click();
  await expect(page).toHaveURL("/");
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
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.4" });
  await page.goto("/register");
  await page.getByLabel("Username").fill("csrf.user");
  await page.getByLabel("Password", { exact: true }).fill(validPassword);
  await page.getByLabel("Confirm password").fill(validPassword);
  await page.getByRole("button", { name: "Create private account" }).click();
  await expect(page).toHaveURL("/");

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

  await page.reload();
  await expect(page.getByText("Signed in as csrf.user")).toBeVisible();
});

test("authentication abuse limits survive across HTTP requests", async ({
  request,
}) => {
  const loginHeaders = {
    Origin: applicationOrigin,
    "X-Test-Client-IP": "203.0.113.10",
  };

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await request.post("/login", {
      form: { password: validPassword, username: "missing.user" },
      headers: loginHeaders,
    });
    expect(response.status()).toBe(401);
    expect(await response.text()).toContain(
      "The username or password is incorrect.",
    );
  }

  const blockedLogin = await request.post("/login", {
    form: { password: validPassword, username: "missing.user" },
    headers: loginHeaders,
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
    const response = await request.post("/register", {
      form: {
        confirmPassword: validPassword,
        password: validPassword,
        username: "limited.user",
      },
      headers: registrationHeaders,
    });
    expect([200, 409]).toContain(response.status());
  }

  const blockedRegistration = await request.post("/register", {
    form: {
      confirmPassword: validPassword,
      password: validPassword,
      username: "another.user",
    },
    headers: registrationHeaders,
  });
  expect(blockedRegistration.status()).toBe(429);
  expect(await blockedRegistration.text()).toContain(
    "Too many registration attempts. Try again later.",
  );
});
