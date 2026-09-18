import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page } from "@playwright/test";
import { bootstrapOrSignInBrowserTestUser, signInProvisionedMember, expect, test } from "./reset-database";

const password = "correct horse battery staple";
const replacement = "new private fallback password";

async function virtualKey(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "usb", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { cdp, authenticatorId };
}

test("forgotten fallback replacement requires a fresh key, supports cancellation/retry, and works after deliberate disable", async ({ context, page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Public Chromium CDP exercises real WebAuthn.");
  await page.setViewportSize({ width: 390, height: 844 });
  const { cdp, authenticatorId } = await virtualKey(context, page);
  await bootstrapOrSignInBrowserTestUser(page, "fallback.owner", password);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/settings/security");
  await page.getByLabel("Key name").fill("My fallback key");
  await page.getByRole("button", { name: "Enroll and enable key login" }).click();
  await expect(page.getByRole("heading", { name: "Key login is enabled" })).toBeVisible();
  const older = await browser.newContext({ storageState: await context.storageState(), baseURL: new URL(page.url()).origin, ignoreHTTPSErrors: true });
  const olderPage = await older.newPage();
  await page.getByRole("link", { name: "Change account password" }).click();
  await expect(page.getByLabel("Current password", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/You do not need the old password/)).toBeVisible();
  await page.getByLabel("New password", { exact: true }).fill(replacement);
  await page.getByLabel("Confirm new password").fill(replacement);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled: false });
  await page.getByRole("button", { name: "Change password", exact: true }).click();
  await page.getByRole("button", { name: "Cancel key prompt" }).click();
  await expect(page.getByRole("alert")).toContainText(/cancelled|retry/i);
  await olderPage.goto("/");
  await expect(olderPage).toHaveURL("/");
  await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled: true });
  await page.getByRole("button", { name: "Change password", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Password changed.");
  await expect(page.getByLabel("New password", { exact: true })).toHaveValue("");
  await olderPage.reload();
  await expect(olderPage).toHaveURL("/login");
  await olderPage.getByLabel("Username").fill("fallback.owner");
  await olderPage.getByLabel("Password", { exact: true }).fill(replacement);
  await olderPage.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(olderPage.getByRole("alert")).toContainText("incorrect");
  await older.close();
  await page.goto("/settings/security");
  await expect(page.getByText("My fallback key", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Disable key login", exact: true }).click();
  await expect(page).toHaveURL("/login");
  await page.getByLabel("Username").fill("fallback.owner");
  await page.getByLabel("Password", { exact: true }).fill(replacement);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("/");
  await cdp.detach();
});

test("a reset member uses their key to finish mandatory password replacement without gaining application access first", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Public Chromium CDP exercises real WebAuthn.");
  await bootstrapOrSignInBrowserTestUser(page, "fallback.admin", password);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
  const member = await browser.newContext({ baseURL: new URL(page.url()).origin, ignoreHTTPSErrors: true });
  const memberPage = await member.newPage();
  const { cdp } = await virtualKey(member, memberPage);
  await signInProvisionedMember(memberPage, "fallback.member", password);
  await memberPage.getByRole("button", { name: "Finish setup" }).click();
  await expect(memberPage).toHaveURL("/");
  await memberPage.goto("/settings/security");
  await memberPage.getByLabel("Key name").fill("Member key");
  await memberPage.getByRole("button", { name: "Enroll and enable key login" }).click();
  await expect(memberPage.getByRole("heading", { name: "Key login is enabled" })).toBeVisible();
  await page.goto("/settings/users");
  await page.getByRole("button", { name: "Reset password for fallback.member" }).click();
  const dialog = page.getByRole("dialog", { name: "Reset password for fallback.member" });
  await dialog.getByLabel("New temporary password").fill("temporary reset password");
  await dialog.getByLabel("Confirm temporary password").fill("temporary reset password");
  await dialog.getByRole("button", { name: "Reset password", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("fallback.member password was reset");
  await memberPage.goto("/");
  await expect(memberPage).toHaveURL("/login");
  await memberPage.getByLabel("Username").fill("fallback.member");
  await memberPage.getByRole("button", { name: "Use registered key", exact: true }).click();
  await expect(memberPage).toHaveURL("/account/password");
  await memberPage.goto("/settings/security");
  await expect(memberPage).toHaveURL("/account/password");
  await expect(memberPage.getByLabel("Current password", { exact: true })).toHaveCount(0);
  await memberPage.getByLabel("New password", { exact: true }).fill("temporary reset password");
  await memberPage.getByLabel("Confirm new password").fill("temporary reset password");
  await memberPage.getByRole("button", { name: "Set password and continue" }).click();
  await expect(memberPage.getByRole("alert")).toContainText("different from the temporary password");
  await memberPage.getByLabel("New password", { exact: true }).fill(replacement);
  await memberPage.getByLabel("Confirm new password").fill(replacement);
  await memberPage.getByRole("button", { name: "Set password and continue" }).click();
  await expect(memberPage).toHaveURL("/");
  await memberPage.goto("/settings/security");
  await expect(memberPage.getByRole("heading", { name: "Key login is enabled" })).toBeVisible();
  await expect(memberPage.getByText("Member key", { exact: true })).toBeVisible();
  await cdp.detach();
  await member.close();
});
