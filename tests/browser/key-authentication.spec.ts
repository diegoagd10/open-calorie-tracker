import AxeBuilder from "@axe-core/playwright";
import {
  bootstrapOrSignInBrowserTestUser,
  expect,
  test,
} from "./reset-database";

const password = "correct horse battery staple";
test("first key enrollment and username/key login use real WebAuthn and replace password access", async ({
  context,
  page,
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Virtual authenticators use Chromium CDP on the public HTTPS entry.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "usb",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  );
  await bootstrapOrSignInBrowserTestUser(page, "key.owner", password);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
  const older = await browser.newContext({
    baseURL: "https://localhost:4173",
    ignoreHTTPSErrors: true,
  });
  const otherPage = await older.newPage();
  await otherPage.goto("/login");
  await otherPage.getByLabel("Username").fill("key.owner");
  await otherPage.getByLabel("Password", { exact: true }).fill(password);
  await otherPage.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(otherPage).toHaveURL("/");
  await page.goto("/settings/security");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByLabel("Key name").fill("My YubiKey");
  await page
    .getByRole("button", { name: "Enroll and enable key login" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Key login is enabled" }),
  ).toBeVisible();
  await expect(page.getByText("My YubiKey", { exact: true })).toBeVisible();
  await otherPage.goto("/");
  await expect(otherPage).toHaveURL("/login");
  await older.close();
  // Logout retains the key and clears only this session.
  await page.goto("/settings/goals");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");
  await page.getByLabel("Username").fill("key.owner");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("incorrect");
  await page.getByLabel("Password", { exact: true }).fill("");
  await page
    .getByRole("button", { name: "Use registered key", exact: true })
    .click();
  await expect(page).toHaveURL("/");
  expect(
    (await cdp.send("WebAuthn.getCredentials", { authenticatorId }))
      .credentials,
  ).toHaveLength(1);
  await page.goto("http://127.0.0.1:4174/login");
  await expect(
    page.getByRole("link", { name: "Use key sign-in on public HTTPS" }),
  ).toHaveAttribute("href", "https://localhost:4173/login");
  await expect(
    page.getByRole("button", { name: "Use registered key" }),
  ).toHaveCount(0);
  await cdp.detach();
});

test("cancelled enrollment leaves password mode usable and permits retry", async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Virtual authenticator cancellation uses Chromium CDP.");
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "usb", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: false } });
  await bootstrapOrSignInBrowserTestUser(page, "cancel.owner", password);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/settings/security");
  await page.getByLabel("Key name").fill("Proton Pass");
  await page.getByRole("button", { name: "Enroll and enable key login" }).click();
  await page.getByRole("button", { name: "Cancel key prompt" }).click({ timeout: 5000 });
  await expect(page.getByRole("alert")).toContainText(/cancelled|retry/i);
  await expect(page.getByRole("heading", { name: "Password login is enabled" })).toBeVisible();
  await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled: true });
  await page.getByRole("button", { name: "Enroll and enable key login" }).click();
  await expect(page.getByRole("heading", { name: "Key login is enabled" })).toBeVisible();
  await cdp.detach();
});
