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

test("administrator confirms suspension, signs out another device, and reactivates the member", async ({
  browser,
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.188" });
  await bootstrapOrSignInBrowserTestUser(
    page,
    "access.admin",
    validPassword,
  );
  await finishSetup(page);
  await provisionBrowserTestMember("suspended.member", validPassword);

  const memberContext = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    extraHTTPHeaders: { "X-Test-Client-IP": "203.0.113.189" },
  });
  const memberPage = await memberContext.newPage();
  await memberPage.goto("/login");
  await memberPage.getByLabel("Username").fill("suspended.member");
  await memberPage.getByLabel("Password", { exact: true }).fill(validPassword);
  await memberPage.getByRole("button", { name: "Sign in" }).click();
  await expect(memberPage).toHaveURL("/setup");
  await finishSetup(memberPage);

  const otherMemberContext = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    extraHTTPHeaders: { "X-Test-Client-IP": "203.0.113.190" },
  });
  const otherMemberPage = await otherMemberContext.newPage();
  await otherMemberPage.goto("/login");
  await otherMemberPage.getByLabel("Username").fill("suspended.member");
  await otherMemberPage.getByLabel("Password", { exact: true })
    .fill(validPassword);
  await otherMemberPage.getByRole("button", { name: "Sign in" }).click();
  await expect(otherMemberPage).toHaveURL("/");

  await page.goto("/settings/users");
  const memberRow = page.getByRole("listitem").filter({
    hasText: "suspended.member",
  });
  const disableButton = memberRow.getByRole("button", {
    name: "Disable suspended.member",
  });
  await disableButton.click();
  const dialog = page.getByRole("dialog", {
    name: "Disable suspended.member",
  });
  await expect(dialog).toContainText(
    "Enter the complete normalized username suspended.member",
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(disableButton).toBeFocused();

  await disableButton.click();
  await dialog.getByLabel("Normalized username").fill("Suspended.Member");
  await dialog.getByRole("button", { name: "Disable member" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Enter suspended.member exactly to confirm.",
  );
  await expect(memberRow).toContainText("Active");
  await otherMemberPage.reload();
  await expect(otherMemberPage).toHaveURL("/");

  await disableButton.click();
  await page.setViewportSize({ height: 844, width: 320 });
  await dialog.getByLabel("Normalized username").fill("suspended.member");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await dialog.getByRole("button", { name: "Disable member" }).click();
  await expect(page.getByRole("status")).toContainText(
    "suspended.member was disabled",
  );
  await expect(memberRow).toContainText("Disabled");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await memberPage.reload();
  await expect(memberPage).toHaveURL("/login");
  await otherMemberPage.reload();
  await expect(otherMemberPage).toHaveURL("/login");
  await memberRow.getByRole("button", {
    name: "Reactivate suspended.member",
  }).click();
  await expect(page.getByRole("status")).toContainText(
    "suspended.member was reactivated",
  );
  await expect(memberRow).toContainText("Active");

  await otherMemberPage.getByLabel("Username").fill("suspended.member");
  await otherMemberPage.getByLabel("Password", { exact: true })
    .fill(validPassword);
  await otherMemberPage.getByRole("button", { name: "Sign in" }).click();
  await expect(otherMemberPage).toHaveURL("/");

  await memberContext.close();
  await otherMemberContext.close();
});

test("administrator deliberately deletes an active member and its live session", async ({
  browser,
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.193" });
  await bootstrapOrSignInBrowserTestUser(
    page,
    "deletion.admin",
    validPassword,
  );
  await finishSetup(page);
  await provisionBrowserTestMember("deleted.member", validPassword);

  const memberContext = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    extraHTTPHeaders: { "X-Test-Client-IP": "203.0.113.194" },
  });
  const memberPage = await memberContext.newPage();
  await memberPage.goto("/login");
  await memberPage.getByLabel("Username").fill("deleted.member");
  await memberPage.getByLabel("Password", { exact: true }).fill(validPassword);
  await memberPage.getByRole("button", { name: "Sign in" }).click();
  await expect(memberPage).toHaveURL("/setup");
  await finishSetup(memberPage);

  await page.goto("/settings/users");
  const memberRow = page.getByRole("listitem").filter({
    hasText: "deleted.member",
  });
  const deleteButton = memberRow.getByRole("button", {
    name: "Delete deleted.member",
  });
  await deleteButton.click();
  const dialog = page.getByRole("dialog", { name: "Delete deleted.member" });
  await expect(dialog).toContainText("account and nutrition data");
  await expect(dialog).toContainText("cannot be recovered");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(deleteButton).toBeFocused();

  await deleteButton.click();
  await dialog.getByLabel("Complete username").fill("Deleted.Member");
  await dialog.getByRole("button", { name: "Permanently delete member" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Enter deleted.member exactly",
  );
  await expect(memberRow).toBeVisible();
  await memberPage.reload();
  await expect(memberPage).toHaveURL("/");

  await page.setViewportSize({ height: 844, width: 320 });
  await deleteButton.click();
  await dialog.getByLabel("Complete username").fill("deleted.member");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await dialog.getByRole("button", { name: "Permanently delete member" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "deleted.member was permanently deleted",
  );
  await expect(memberRow).toHaveCount(0);

  await memberPage.reload();
  await expect(memberPage).toHaveURL("/login");
  await memberPage.getByLabel("Username").fill("deleted.member");
  await memberPage.getByLabel("Password", { exact: true }).fill(validPassword);
  await memberPage.getByRole("button", { name: "Sign in" }).click();
  await expect(memberPage.getByRole("alert")).toContainText(
    "The username or password is incorrect",
  );
  await memberContext.close();
});

test("administrator can permanently delete a disabled member", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.195" });
  await bootstrapOrSignInBrowserTestUser(
    page,
    "disabled-deletion.admin",
    validPassword,
  );
  await finishSetup(page);
  await provisionBrowserTestMember("disabled-delete.member", validPassword);
  const database = openBrowserTestDatabase();
  database.prepare(
    `UPDATE users SET access_state = 'disabled'
     WHERE username_normalized = 'disabled-delete.member'`,
  ).run();
  database.close();

  await page.goto("/settings/users");
  const memberRow = page.getByRole("listitem").filter({
    hasText: "disabled-delete.member",
  });
  await expect(memberRow).toContainText("Disabled");
  await memberRow.getByRole("button", {
    name: "Delete disabled-delete.member",
  }).click();
  const dialog = page.getByRole("dialog", {
    name: "Delete disabled-delete.member",
  });
  await dialog.getByLabel("Complete username").fill("disabled-delete.member");
  await dialog.getByRole("button", { name: "Permanently delete member" })
    .click();

  await expect(page.getByRole("status")).toContainText(
    "disabled-delete.member was permanently deleted",
  );
  await expect(memberRow).toHaveCount(0);
});
