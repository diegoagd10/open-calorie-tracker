import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";

import {
  bootstrapOrSignInBrowserTestUser,
  expect,
  openBrowserTestDatabase,
  provisionBrowserTestMember,
  signInProvisionedMember,
  test,
} from "./reset-database";

const validPassword = "correct horse 🔐 battery";

async function tabTo(page: Page, locator: Locator) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await page.keyboard.press("Tab");
    if (await locator.evaluate((element) => element === document.activeElement)) {
      return;
    }
  }
  throw new Error("Target was not reachable with the keyboard");
}

async function finishSetup(page: Page) {
  await page.getByLabel("Time zone").fill("America/New_York");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
}

test("administrator opens the safe member directory from Settings", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.182" });
  await bootstrapOrSignInBrowserTestUser(
    page,
    "directory.admin",
    validPassword,
  );
  await finishSetup(page);
  await provisionBrowserTestMember("zebra.member", validPassword);
  await provisionBrowserTestMember("alpha.member", validPassword);

  const database = openBrowserTestDatabase();
  database.prepare(
    `UPDATE users
     SET access_state = 'disabled', created_at = '2026-08-31T10:00:00.000Z'
     WHERE username_normalized = 'zebra.member'`,
  ).run();
  database.prepare(
    `UPDATE users
     SET created_at = '2026-09-01T11:00:00.000Z'
     WHERE username_normalized = 'alpha.member'`,
  ).run();
  database.close();

  await page.getByRole("link", { name: "Settings" }).click();
  const usersLink = page.getByRole("link", { name: /Users/ });
  await expect(usersLink).toHaveAttribute("href", "/settings/users");
  await page.locator("body").press("Home");
  await tabTo(page, usersLink);
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL("/settings/users");
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  const memberRows = page.getByRole("listitem");
  await expect(memberRows).toHaveCount(2);
  await expect(memberRows.nth(0)).toContainText("alpha.member");
  await expect(memberRows.nth(0)).toContainText("Active");
  await expect(memberRows.nth(1)).toContainText("zebra.member");
  await expect(memberRows.nth(1)).toContainText("Disabled");
  await expect(page.getByText("directory.admin")).toHaveCount(1);
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create member" })).toBeVisible();

  await page.setViewportSize({ height: 844, width: 320 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(memberRows.nth(1)).toBeVisible();

  const accessibilityScan = await new AxeBuilder({ page }).analyze();
  expect(accessibilityScan.violations).toEqual([]);
});

test("member cannot discover or directly open the member directory", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.183" });
  await bootstrapOrSignInBrowserTestUser(
    page,
    "existing.admin",
    validPassword,
  );
  await context.clearCookies();
  await signInProvisionedMember(page, "ordinary.member", validPassword);
  await finishSetup(page);

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("link", { name: /Users/ })).toHaveCount(0);

  const response = await page.goto("/settings/users");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" }))
    .toBeVisible();
});

test("administrator provisions a member through mandatory password onboarding and setup", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.184" });
  await bootstrapOrSignInBrowserTestUser(
    page,
    "provisioning.admin",
    validPassword,
  );
  await finishSetup(page);
  await page.goto("/settings/users");

  const username = page.getByLabel("Username");
  await page.locator("body").press("Home");
  await tabTo(page, username);
  await username.fill("Invited.Member");
  await page.keyboard.press("Tab");
  await page.keyboard.type("temporary member passphrase");
  await page.keyboard.press("Tab");
  await page.keyboard.type("temporary member passphrase");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("status")).toContainText(
    "invited.member was created",
  );
  await expect(page.locator('input[name="password"]')).toHaveValue("");
  await expect(page.locator('input[name="confirmPassword"]')).toHaveValue("");
  const invitedMember = page.getByRole("listitem").filter({
    hasText: "invited.member",
  });
  await expect(invitedMember).toContainText("Password change required");
  await expect(invitedMember).toContainText("Active");

  await context.clearCookies();
  await page.goto("/login");
  await page.getByLabel("Username").fill("invited.member");
  await page.getByLabel("Password", { exact: true }).fill(
    "temporary member passphrase",
  );
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/account/password");
  await expect(page.getByRole("heading", { name: "Set your private password" }))
    .toBeVisible();
  await expect(page.getByLabel("Current password")).toBeFocused();

  await page.setViewportSize({ height: 844, width: 320 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByLabel("Current password").fill(
    "temporary member passphrase",
  );
  await page.keyboard.press("Tab");
  await page.keyboard.type("private replacement passphrase");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/setup");

  await finishSetup(page);
  await expect(page.getByRole("heading", { name: "Food Log" })).toBeVisible();
  const directUsersResponse = await page.goto("/settings/users");
  expect(directUsersResponse?.status()).toBe(404);
});
