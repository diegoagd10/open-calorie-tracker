import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./reset-database";

const validPassword = "correct horse 🔐 battery";
const replacementPassword = "replacement passphrase 🔐";
const applicationOrigin = "https://localhost:4173";
const administrator = "alice.user";

test.describe.configure({ mode: "serial" });

async function finishInitialSetup(page: Page) {
  await expect(page).toHaveURL("/setup");
  await page.getByLabel("Time zone").fill("UTC");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
}

async function signIn(
  page: Page,
  username = administrator,
  password = validPassword,
) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
}

async function sessionCookie(context: BrowserContext) {
  return (await context.cookies()).find(
    (cookie) => cookie.name === "__Host-calorie_session",
  );
}

test("a mobile visitor claims an empty instance and completes nutrition setup", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.1" });
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/");
  await expect(page).toHaveURL("/register");
  await expect(page.getByRole("navigation", { name: "Account access" }))
    .toHaveCount(0);
  expect(
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.getByLabel("Username").fill(" invalid user ");
  await page.getByLabel("Password", { exact: true }).fill(validPassword);
  await page.getByLabel("Confirm password").fill(validPassword);
  await page.getByRole("button", { name: "Create private account" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Use 3–30 ASCII letters, digits, dot, hyphen, or underscore.",
  );

  await page.getByLabel("Username").fill("Alice.User");
  await page.getByRole("button", { name: "Create private account" }).click();
  await finishInitialSetup(page);
  await expect(
    page.getByRole("heading", { name: "Today's Food Log" }),
  ).toBeVisible();
  expect((await sessionCookie(context))?.httpOnly).toBe(true);
  expect((await sessionCookie(context))?.secure).toBe(true);
  expect((await sessionCookie(context))?.sameSite).toBe("Lax");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.setViewportSize({ height: 720, width: 1280 });
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByText(`Private to ${administrator}`)).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("link", { name: "Register" })).toHaveCount(0);
});

test("a claimed instance redirects anonymous registration and hides it from authenticated users", async ({
  page,
  request,
}) => {
  await page.goto("/register");
  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("link", { name: "Register" })).toHaveCount(0);

  const rejectedPost = await request.post("/register", {
    form: { password: "short" },
    maxRedirects: 0,
  });
  expect(rejectedPost.status()).toBe(302);
  expect(rejectedPost.headers().location).toBe("/login");

  await signIn(page);
  const notFound = await page.goto("/register");
  expect(notFound?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" }))
    .toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("login failures remain generic and session-bound CSRF protects logout", async ({
  context,
  page,
  request,
}) => {
  const loginWithoutCsrf = await request.post("/login", {
    form: { password: validPassword, username: administrator },
    headers: { Origin: applicationOrigin },
  });
  expect(loginWithoutCsrf.status()).toBe(403);

  await page.goto("/login");
  await page.getByLabel("Username").fill(administrator);
  await page.getByLabel("Password", { exact: true }).fill("wrong password value");
  await page.getByRole("button", { name: "Sign in" }).click();
  const existingAccountError = await page.getByRole("alert").textContent();
  await page.getByLabel("Username").fill("missing.account");
  await page.getByRole("button", { name: "Sign in" }).click();
  expect(await page.getByRole("alert").textContent()).toBe(existingAccountError);

  await page.getByLabel("Username").fill(administrator);
  await page.getByLabel("Password", { exact: true }).fill(validPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
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
  expect(await sessionCookie(context)).toBeDefined();
});

test("password rotation revokes other devices and the previous credential", async ({
  browser,
  context,
  page,
}) => {
  await signIn(page);
  const originalCookie = await sessionCookie(context);
  if (!originalCookie) throw new Error("login omitted session cookie");

  const otherContext = await browser.newContext({
    baseURL: applicationOrigin,
    extraHTTPHeaders: { "X-Test-Client-IP": "203.0.113.41" },
  });
  const otherPage = await otherContext.newPage();
  await signIn(otherPage);

  await page.goto("/account/password");
  await page.getByLabel("Current password").fill(validPassword);
  await page
    .getByLabel("New password", { exact: true })
    .fill(replacementPassword);
  await page.getByLabel("Confirm new password").fill(replacementPassword);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("status")).toContainText("Password changed");
  expect((await sessionCookie(context))?.value).not.toBe(originalCookie.value);

  await otherPage.reload();
  await expect(otherPage).toHaveURL("/login");

  const replayContext = await browser.newContext({ baseURL: applicationOrigin });
  await replayContext.addCookies([originalCookie]);
  const replayPage = await replayContext.newPage();
  await replayPage.goto("/");
  await expect(replayPage).toHaveURL("/login");
  await replayPage.getByLabel("Username").fill(administrator);
  await replayPage.getByLabel("Password", { exact: true }).fill(validPassword);
  await replayPage.getByRole("button", { name: "Sign in" }).click();
  await expect(replayPage.getByRole("alert")).toContainText(
    "The username or password is incorrect.",
  );
  await replayPage.getByLabel("Password", { exact: true }).fill(replacementPassword);
  await replayPage.getByRole("button", { name: "Sign in" }).click();
  await expect(replayPage).toHaveURL("/");

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await replayContext.close();
  await otherContext.close();
});
