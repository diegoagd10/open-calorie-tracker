import AxeBuilder from "@axe-core/playwright";
import type { Page, BrowserContext } from "@playwright/test";
import { bootstrapOrSignInBrowserTestUser, signInProvisionedMember, expect, test, submitPasswordLogin } from "./reset-database";
import { playwrightBrowserPorts } from "../../scripts/catalog-browser-runtime";

const password = "correct horse battery staple";
const publicOrigin = `https://localhost:${playwrightBrowserPorts.public}`;
const lanOrigin = `http://127.0.0.1:${playwrightBrowserPorts.lan}`;

async function enroll(context: BrowserContext, page: Page, name: string) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "usb", hasResidentKey: true, hasUserVerification: true,
    isUserVerified: true, automaticPresenceSimulation: true,
  } });
  await page.goto("/settings/security");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByLabel("Key name").fill(name);
  await page.getByRole("button", { name: "Enroll and enable key login" }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  return { cdp, authenticatorId };
}

for (const method of ["password", "key"]) {
  test(`administrator ${method} proof recovers retained member keys and revokes public and LAN sessions`, async ({ context, page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Virtual authenticators require public Chromium CDP.");
    await page.setViewportSize({ width: 390, height: 844 });
    await bootstrapOrSignInBrowserTestUser(page, "recovery.admin", password);
    await page.getByRole("button", { name: "Finish setup" }).click();
    await expect(page).toHaveURL("/");
    const adminKey = await enroll(context, page, "Administrator key");
    const memberContext = await browser.newContext({ baseURL: publicOrigin, ignoreHTTPSErrors: true });
    const lanContext = await browser.newContext({ baseURL: lanOrigin });
    try {
      const member = await memberContext.newPage();
      await signInProvisionedMember(member, "recovery.member", password);
      await member.getByRole("button", { name: "Finish setup" }).click();
      await expect(member).toHaveURL(`${publicOrigin}/`);
      const memberKey = await enroll(memberContext, member, "Lost member key");
      await member.route("**/key-ceremony", async (route) => {
        if ((route.request().postDataJSON() as { action: string }).action !== "addition-finish") return route.continue();
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await memberKey.cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: memberKey.authenticatorId });
        await memberKey.cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
          protocol: "ctap2", transport: "usb", hasResidentKey: true, hasUserVerification: true,
          isUserVerified: true, automaticPresenceSimulation: true,
        } });
        await route.fulfill({ response });
      });
      await member.getByLabel("Key name").fill("Retained backup key");
      await member.getByRole("button", { name: "Add another key" }).click();
      await expect(member.getByText("Retained backup key", { exact: true })).toBeVisible();
      await member.unroute("**/key-ceremony");
      // The same opaque session is valid on either listener; recovery must revoke both cookie paths.
      const sessionCookie = (await memberContext.cookies()).find((cookie) => cookie.name === "__Host-calorie_session")!;
      await lanContext.addCookies([{ name: "calorie_lan_session", value: sessionCookie.value, url: lanOrigin }]);
      const lanMember = await lanContext.newPage();
      await lanMember.goto("/");
      await expect(lanMember).toHaveURL(`${lanOrigin}/`);
      await member.goto("/settings/users");
      await expect(member.getByRole("heading", { name: "Page not found" })).toBeVisible();
      await page.goto("/settings/users");
      await page.getByRole("button", { name: "Disable key login for recovery.member", exact: true }).focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText("password and every saved key remain unchanged");
      await page.getByRole("button", { name: "Cancel recovery" }).click();
      await expect(dialog).not.toBeVisible();
      await page.getByRole("button", { name: "Disable key login for recovery.member", exact: true }).click();
      await page.getByLabel("Confirm member username").fill("recovery.member");
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      if (method === "password") {
        await page.getByLabel("Your administrator password").fill("incorrect password");
        await page.getByRole("button", { name: "Confirm with administrator password" }).click();
        await expect(page.getByRole("alert")).toContainText("recovery failed");
        await page.getByLabel("Your administrator password").fill(password);
      }
      await page.getByRole("button", { name: `Confirm with administrator ${method}` }).click();
      await expect(page.getByRole("status")).toContainText("key login disabled");
      await member.goto("/");
      await expect(member).toHaveURL(`${publicOrigin}/login`);
      await lanMember.goto("/");
      await expect(lanMember).toHaveURL(`${lanOrigin}/login`);
      await submitPasswordLogin(member, "recovery.member", password);
      await expect(member).toHaveURL(`${publicOrigin}/`);
      await member.goto("/settings/security");
      await expect(member.getByText("Lost member key", { exact: true })).toBeVisible();

      await member.getByRole("button", { name: "Delete Lost member key", exact: true }).click();
      await member.getByLabel("Current account password").fill(password);
      await member.getByRole("button", { name: "Confirm deletion", exact: true }).click();
      await expect(member).toHaveURL(`${publicOrigin}/login`);
      await submitPasswordLogin(member, "recovery.member", password);
      await expect(member).toHaveURL(`${publicOrigin}/`);
      await member.goto("/settings/security");
      await expect(member.getByText("Lost member key", { exact: true })).toHaveCount(0);
      await member.getByRole("button", { name: "Re-enable key login", exact: true }).click();
      await expect(member.getByRole("heading", { name: "Key login is enabled" })).toBeVisible();
      await expect(member.getByText("Retained backup key", { exact: true })).toBeVisible();
      await memberKey.cdp.detach();
      await page.goto("/settings/goals");
      await page.getByRole("button", { name: "Sign out" }).click();
      // Public HTTPS sends key accounts to their key; LAN still offers the password form.
      await page.goto(`${lanOrigin}/login`);
      await submitPasswordLogin(page, "recovery.admin", password);
      await expect(page.getByRole("alert")).toContainText("The username or password is incorrect.");
      await adminKey.cdp.detach();
    } finally {
      await memberContext.close();
      await lanContext.close();
    }
  });
}
